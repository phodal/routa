//! ACP Runtime Manager — Downloads and manages Node.js and uv runtimes.
//!
//! Mirrors the Kotlin `AcpRuntimeManager` from the IntelliJ plugin.
//! Responsibilities:
//!   - Detect system-installed runtimes (node, npx, uv, uvx) via PATH
//!   - Download and cache managed runtimes in `{data_dir}/acp-agents/.runtimes/`
//!   - Platform detection and URL construction
//!
//! Runtime resolution priority (per RuntimeType):
//!   1. getManagedRuntime()  — check .runtimes/{node|uv}/{version}/
//!   2. getSystemRuntime()   — search system PATH
//!   3. ensureRuntime()      — auto-download when neither is available
//!
//! NPX/UVX mapping:
//!   - RuntimeType::Npx  → download Node.js, then find `npx` in the same dir
//!   - RuntimeType::Uvx  → download uv,      then find `uvx` in the same dir

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::Mutex;

use super::paths::AcpPaths;

// ─── Platform Constants ────────────────────────────────────────────────────

pub const DARWIN_X86_64: &str = "darwin-x86_64";
pub const DARWIN_AARCH64: &str = "darwin-aarch64";
pub const LINUX_X86_64: &str = "linux-x86_64";
pub const LINUX_AARCH64: &str = "linux-aarch64";
pub const WINDOWS_X86_64: &str = "windows-x86_64";
pub const WINDOWS_AARCH64: &str = "windows-aarch64";

/// Return the current platform string (e.g. `"darwin-aarch64"`).
pub fn current_platform() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => DARWIN_AARCH64,
        ("macos", "x86_64") => DARWIN_X86_64,
        ("linux", "aarch64") => LINUX_AARCH64,
        ("linux", "x86_64") => LINUX_X86_64,
        ("windows", "aarch64") => WINDOWS_AARCH64,
        ("windows", "x86_64") => WINDOWS_X86_64,
        _ => LINUX_X86_64, // safe fallback
    }
}

// ─── Runtime Type ──────────────────────────────────────────────────────────

/// Which runtime to locate or download.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeType {
    /// The `node` binary itself.
    Node,
    /// The `npx` binary that ships with Node.js.
    Npx,
    /// The `uv` binary from astral-sh/uv.
    Uv,
    /// The `uvx` binary that ships with uv.
    Uvx,
}

impl RuntimeType {
    /// CLI name of the binary.
    pub fn command_name(&self) -> &'static str {
        match self {
            RuntimeType::Node => "node",
            RuntimeType::Npx => "npx",
            RuntimeType::Uv => "uv",
            RuntimeType::Uvx => "uvx",
        }
    }

    /// Return a human-readable label.
    pub fn label(&self) -> &'static str {
        match self {
            RuntimeType::Node => "Node.js",
            RuntimeType::Npx => "npx",
            RuntimeType::Uv => "uv",
            RuntimeType::Uvx => "uvx",
        }
    }
}

// ─── Runtime Info ──────────────────────────────────────────────────────────

/// Resolved information for an available runtime.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RuntimeInfo {
    pub runtime_type: RuntimeType,
    pub version: Option<String>,
    pub path: PathBuf,
    pub is_managed: bool,
}

// ─── Manager ──────────────────────────────────────────────────────────────

/// Default Node.js version to download when none is found.
const DEFAULT_NODE_VERSION: &str = "22.12.0";

/// Default uv version to download when none is found.
const DEFAULT_UV_VERSION: &str = "0.5.11";

const NODE_DOWNLOAD_BASE: &str = "https://nodejs.org/dist";
const UV_DOWNLOAD_BASE: &str = "https://github.com/astral-sh/uv/releases/download";

/// Manages Node.js / uv runtime discovery and auto-download.
pub struct AcpRuntimeManager {
    paths: AcpPaths,
    /// Per-runtime-key download locks to prevent concurrent downloads.
    download_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl AcpRuntimeManager {
    /// Create a new runtime manager backed by the given `AcpPaths`.
    pub fn new(paths: AcpPaths) -> Self {
        Self {
            paths,
            download_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    // ── Public API ───────────────────────────────────────────────────────

    /// Returns `true` if the runtime is reachable (managed or system).
    pub async fn is_runtime_available(&self, rt: &RuntimeType) -> bool {
        self.get_runtime_path(rt).await.is_some()
    }

    /// Run `{binary} --version` and return the trimmed first line of output.
    /// Returns `None` if the runtime is not available or the command fails.
    pub async fn get_version(&self, rt: &RuntimeType) -> Option<String> {
        let path = self.get_runtime_path(rt).await?;
        let output = tokio::process::Command::new(&path)
            .arg("--version")
            .output()
            .await
            .ok()?;
        let combined = String::from_utf8_lossy(&output.stdout).to_string()
            + &String::from_utf8_lossy(&output.stderr);
        combined
            .lines()
            .next()
            .map(|l| l.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    /// Return the best path for a runtime: managed first, then system.
    pub async fn get_runtime_path(&self, rt: &RuntimeType) -> Option<PathBuf> {
        if let Some(info) = self.get_managed_runtime(rt).await {
            return Some(info.path);
        }
        self.get_system_runtime(rt).map(|i| i.path)
    }

    /// Locate the runtime on the system PATH.
    pub fn get_system_runtime(&self, rt: &RuntimeType) -> Option<RuntimeInfo> {
        let path_str = crate::shell_env::which(rt.command_name())?;
        Some(RuntimeInfo {
            runtime_type: rt.clone(),
            version: None,
            path: PathBuf::from(path_str),
            is_managed: false,
        })
    }

    /// Locate a previously downloaded (managed) runtime.
    pub async fn get_managed_runtime(&self, rt: &RuntimeType) -> Option<RuntimeInfo> {
        let (base, version) = self.base_and_version(rt);
        let runtime_dir = self.paths.runtime_dir(base, version);
        if !runtime_dir.exists() {
            return None;
        }
        let is_windows = std::env::consts::OS == "windows";
        let exe = self
            .find_executable_in(&runtime_dir, rt.command_name(), is_windows)
            .await?;
        Some(RuntimeInfo {
            runtime_type: rt.clone(),
            version: Some(version.to_string()),
            path: exe,
            is_managed: true,
        })
    }

    /// Ensure the runtime is available, downloading it if necessary.
    ///
    /// Returns a `RuntimeInfo` with the resolved path.
    pub async fn ensure_runtime(&self, rt: &RuntimeType) -> Result<RuntimeInfo, String> {
        // 1. Managed runtime already present?
        if let Some(info) = self.get_managed_runtime(rt).await {
            return Ok(info);
        }
        // 2. System runtime available?
        if let Some(info) = self.get_system_runtime(rt) {
            return Ok(info);
        }
        // 3. Download the base type, then locate the companion executable.
        let platform = current_platform();
        let (base, version) = self.base_and_version(rt);

        let _base_path = match base {
            "node" => self.download_node(version, platform).await?,
            "uv" => self.download_uv(version, platform).await?,
            other => return Err(format!("Unknown runtime base: {other}")),
        };

        // For Npx / Uvx we need the companion binary in the same tree.
        let is_windows = std::env::consts::OS == "windows";
        let runtime_dir = self.paths.runtime_dir(base, version);
        let exe = self
            .find_executable_in(&runtime_dir, rt.command_name(), is_windows)
            .await
            .ok_or_else(|| {
                format!(
                    "'{}' not found after downloading {} (looked in {:?})",
                    rt.command_name(),
                    base,
                    runtime_dir,
                )
            })?;

        Ok(RuntimeInfo {
            runtime_type: rt.clone(),
            version: Some(version.to_string()),
            path: exe,
            is_managed: true,
        })
    }

    // ── Node.js download ─────────────────────────────────────────────────

    /// Download and extract Node.js for `platform`.
    ///
    /// Returns the path to the `node` binary.
    ///
    /// Concurrent calls for the same version are serialised by a per-key
    /// mutex and will re-use the already-extracted binary.
    pub async fn download_node(&self, version: &str, platform: &str) -> Result<PathBuf, String> {
        let lock = self.get_lock(&format!("node-{version}")).await;
        let _guard = lock.lock().await;

        let runtime_dir = self.paths.runtime_dir("node", version);
        let is_windows = std::env::consts::OS == "windows";

        // Already present?
        if let Some(p) = self
            .find_executable_in(&runtime_dir, "node", is_windows)
            .await
        {
            return Ok(p);
        }

        tokio::fs::create_dir_all(&runtime_dir)
            .await
            .map_err(|e| format!("mkdir runtime_dir: {e}"))?;

        let (node_os, node_arch) = Self::node_platform(platform)?;
        let is_win = node_os == "win";
        let ext = if is_win { "zip" } else { "tar.gz" };
        let archive_base = format!("node-v{version}-{node_os}-{node_arch}");
        let url = format!("{NODE_DOWNLOAD_BASE}/v{version}/{archive_base}.{ext}");

        let download_dir = self.paths.downloads_dir().join("node").join(version);
        tokio::fs::create_dir_all(&download_dir)
            .await
            .map_err(|e| format!("mkdir download_dir: {e}"))?;
        let archive_path = download_dir.join(format!("{archive_base}.{ext}"));

        tracing::info!(
            "[AcpRuntimeManager] Downloading Node.js {}: {}",
            version,
            url
        );
        self.download_file(&url, &archive_path).await?;

        let arc = archive_path.clone();
        let dir = runtime_dir.clone();
        tokio::task::spawn_blocking(move || {
            if arc.to_string_lossy().ends_with(".zip") {
                Self::extract_zip_sync(&arc, &dir)
            } else {
                Self::extract_tgz_sync(&arc, &dir)
            }
        })
        .await
        .map_err(|e| format!("extract task panicked: {e}"))??;

        let _ = tokio::fs::remove_dir_all(&download_dir).await;

        let node_path = self
            .find_executable_in(&runtime_dir, "node", is_win)
            .await
            .ok_or_else(|| "node binary not found after extraction".to_string())?;

        self.make_executable(&node_path).await?;

        // Also chmod npx if present
        if let Some(npx) = self.find_executable_in(&runtime_dir, "npx", is_win).await {
            let _ = self.make_executable(&npx).await;
        }

        tracing::info!("[AcpRuntimeManager] Node.js ready: {:?}", node_path);
        Ok(node_path)
    }

    // ── uv download ──────────────────────────────────────────────────────

    /// Download and extract `uv` for `platform`.
    ///
    /// Returns the path to the `uv` binary.
    pub async fn download_uv(&self, version: &str, platform: &str) -> Result<PathBuf, String> {
        let lock = self.get_lock(&format!("uv-{version}")).await;
        let _guard = lock.lock().await;

        let runtime_dir = self.paths.runtime_dir("uv", version);
        let is_windows = std::env::consts::OS == "windows";

        if let Some(p) = self
            .find_executable_in(&runtime_dir, "uv", is_windows)
            .await
        {
            return Ok(p);
        }

        tokio::fs::create_dir_all(&runtime_dir)
            .await
            .map_err(|e| format!("mkdir runtime_dir: {e}"))?;

        let target = Self::uv_target(platform)?;
        let ext = if is_windows { "zip" } else { "tar.gz" };
        let archive_base = format!("uv-{target}");
        let url = format!("{UV_DOWNLOAD_BASE}/{version}/{archive_base}.{ext}");

        let download_dir = self.paths.downloads_dir().join("uv").join(version);
        tokio::fs::create_dir_all(&download_dir)
            .await
            .map_err(|e| format!("mkdir download_dir: {e}"))?;
        let archive_path = download_dir.join(format!("{archive_base}.{ext}"));

        tracing::info!("[AcpRuntimeManager] Downloading uv {}: {}", version, url);
        self.download_file(&url, &archive_path).await?;

        let arc = archive_path.clone();
        let dir = runtime_dir.clone();
        tokio::task::spawn_blocking(move || {
            if arc.to_string_lossy().ends_with(".zip") {
                Self::extract_zip_sync(&arc, &dir)
            } else {
                Self::extract_tgz_sync(&arc, &dir)
            }
        })
        .await
        .map_err(|e| format!("extract task panicked: {e}"))??;

        let _ = tokio::fs::remove_dir_all(&download_dir).await;

        let uv_path = self
            .find_executable_in(&runtime_dir, "uv", is_windows)
            .await
            .ok_or_else(|| "uv binary not found after extraction".to_string())?;

        self.make_executable(&uv_path).await?;
        if let Some(uvx) = self
            .find_executable_in(&runtime_dir, "uvx", is_windows)
            .await
        {
            let _ = self.make_executable(&uvx).await;
        }

        tracing::info!("[AcpRuntimeManager] uv ready: {:?}", uv_path);
        Ok(uv_path)
    }

    // ── Private helpers ──────────────────────────────────────────────────

    /// Determine the (base_name, version) pair for a RuntimeType.
    fn base_and_version(&self, rt: &RuntimeType) -> (&'static str, &'static str) {
        match rt {
            RuntimeType::Node | RuntimeType::Npx => ("node", DEFAULT_NODE_VERSION),
            RuntimeType::Uv | RuntimeType::Uvx => ("uv", DEFAULT_UV_VERSION),
        }
    }

    async fn get_lock(&self, key: &str) -> Arc<Mutex<()>> {
        let mut map = self.download_locks.lock().await;
        map.entry(key.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// Map our platform string to Node.js distribution (os, arch).
    fn node_platform(platform: &str) -> Result<(&'static str, &'static str), String> {
        match platform {
            DARWIN_AARCH64 => Ok(("darwin", "arm64")),
            DARWIN_X86_64 => Ok(("darwin", "x64")),
            LINUX_AARCH64 => Ok(("linux", "arm64")),
            LINUX_X86_64 => Ok(("linux", "x64")),
            WINDOWS_AARCH64 => Ok(("win", "arm64")),
            WINDOWS_X86_64 => Ok(("win", "x64")),
            other => Err(format!("Unsupported platform for Node.js: {other}")),
        }
    }

    /// Map our platform string to a uv Rust target triple.
    fn uv_target(platform: &str) -> Result<&'static str, String> {
        match platform {
            DARWIN_AARCH64 => Ok("aarch64-apple-darwin"),
            DARWIN_X86_64 => Ok("x86_64-apple-darwin"),
            LINUX_AARCH64 => Ok("aarch64-unknown-linux-gnu"),
            LINUX_X86_64 => Ok("x86_64-unknown-linux-gnu"),
            WINDOWS_AARCH64 => Ok("aarch64-pc-windows-msvc"),
            WINDOWS_X86_64 => Ok("x86_64-pc-windows-msvc"),
            other => Err(format!("Unsupported platform for uv: {other}")),
        }
    }

    async fn download_file(&self, url: &str, dest: &Path) -> Result<(), String> {
        let resp = reqwest::get(url)
            .await
            .map_err(|e| format!("HTTP GET {url}: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Download failed ({}) for {}", resp.status(), url));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Reading response body: {e}"))?;

        tokio::fs::write(dest, &bytes)
            .await
            .map_err(|e| format!("Writing {dest:?}: {e}"))?;

        tracing::info!(
            "[AcpRuntimeManager] Downloaded {} bytes → {:?}",
            bytes.len(),
            dest
        );
        Ok(())
    }

    /// Recursively find a named executable under `dir`.
    async fn find_executable_in(
        &self,
        dir: &Path,
        name: &str,
        is_windows: bool,
    ) -> Option<PathBuf> {
        let exe = if is_windows {
            format!("{name}.exe")
        } else {
            name.to_string()
        };

        let mut stack = vec![dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            let mut rd = tokio::fs::read_dir(&current).await.ok()?;
            while let Ok(Some(entry)) = rd.next_entry().await {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.file_name().map(|n| n == exe.as_str()).unwrap_or(false) {
                    return Some(path);
                }
            }
        }
        None
    }

    async fn make_executable(&self, _path: &Path) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = tokio::fs::metadata(_path)
                .await
                .map_err(|e| format!("metadata {_path:?}: {e}"))?
                .permissions();
            perms.set_mode(perms.mode() | 0o755);
            tokio::fs::set_permissions(_path, perms)
                .await
                .map_err(|e| format!("chmod {_path:?}: {e}"))?;
        }

        // Remove macOS quarantine
        #[cfg(target_os = "macos")]
        {
            let s = _path.to_string_lossy().to_string();
            let _ = tokio::process::Command::new("xattr")
                .args(["-d", "com.apple.quarantine", &s])
                .output()
                .await;
        }

        Ok(())
    }

    // Blocking extraction helpers (called via spawn_blocking) ─────────────

    fn extract_zip_sync(archive: &Path, dest: &Path) -> Result<(), String> {
        let f = std::fs::File::open(archive).map_err(|e| format!("open zip {archive:?}: {e}"))?;
        let mut z = zip::ZipArchive::new(f).map_err(|e| format!("read zip {archive:?}: {e}"))?;
        for i in 0..z.len() {
            let mut entry = z.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
            let out = dest.join(entry.mangled_name());
            if entry.name().ends_with('/') {
                std::fs::create_dir_all(&out).ok();
            } else {
                if let Some(p) = out.parent() {
                    std::fs::create_dir_all(p).ok();
                }
                let mut outf =
                    std::fs::File::create(&out).map_err(|e| format!("create {out:?}: {e}"))?;
                std::io::copy(&mut entry, &mut outf)
                    .map_err(|e| format!("extract {out:?}: {e}"))?;
            }
        }
        Ok(())
    }

    fn extract_tgz_sync(archive: &Path, dest: &Path) -> Result<(), String> {
        let f =
            std::fs::File::open(archive).map_err(|e| format!("open tar.gz {archive:?}: {e}"))?;
        let gz = flate2::read::GzDecoder::new(f);
        tar::Archive::new(gz)
            .unpack(dest)
            .map_err(|e| format!("unpack tar.gz {archive:?}: {e}"))
    }
}
