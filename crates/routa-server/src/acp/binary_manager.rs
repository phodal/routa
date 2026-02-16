//! ACP Binary Manager - Downloads and extracts binary agents.
//!
//! Handles:
//! - Downloading agent archives from URLs
//! - Extracting ZIP, TAR.GZ, TAR.BZ2 formats
//! - Setting executable permissions on Unix
//! - Removing macOS quarantine attributes

use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::paths::AcpPaths;
use super::registry_types::BinaryInfo;

/// Manages binary agent downloads and extraction.
pub struct AcpBinaryManager {
    paths: AcpPaths,
    /// Locks to prevent concurrent downloads of the same agent
    download_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl AcpBinaryManager {
    /// Create a new binary manager.
    pub fn new(paths: AcpPaths) -> Self {
        Self {
            paths,
            download_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Download and install a binary agent.
    /// Returns the path to the executable.
    pub async fn install_binary(
        &self,
        agent_id: &str,
        version: &str,
        binary_info: &BinaryInfo,
    ) -> Result<PathBuf, String> {
        // Get or create a lock for this agent
        let lock = {
            let mut locks = self.download_locks.lock().await;
            locks
                .entry(agent_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };

        // Hold the lock during download/extraction
        let _guard = lock.lock().await;

        let install_dir = self.paths.agent_version_dir(agent_id, version);
        let download_dir = self.paths.agent_download_dir(agent_id, version);

        // Check if already installed
        if install_dir.exists() {
            if let Some(exe) = self.find_executable(&install_dir, binary_info).await {
                tracing::info!("[AcpBinaryManager] Agent {} already installed at {:?}", agent_id, exe);
                return Ok(exe);
            }
        }

        // Create directories
        tokio::fs::create_dir_all(&download_dir)
            .await
            .map_err(|e| format!("Failed to create download dir: {}", e))?;
        tokio::fs::create_dir_all(&install_dir)
            .await
            .map_err(|e| format!("Failed to create install dir: {}", e))?;

        // Download the archive
        let archive_path = self.download_archive(&binary_info.archive, &download_dir).await?;

        // Extract the archive
        self.extract_archive(&archive_path, &install_dir).await?;

        // Find and prepare the executable
        let exe_path = self
            .find_executable(&install_dir, binary_info)
            .await
            .ok_or_else(|| "Could not find executable in extracted archive".to_string())?;

        // Set executable permissions and remove quarantine
        self.prepare_executable(&exe_path).await?;

        // Clean up download directory
        let _ = tokio::fs::remove_dir_all(&download_dir).await;

        tracing::info!("[AcpBinaryManager] Installed {} v{} at {:?}", agent_id, version, exe_path);
        Ok(exe_path)
    }

    /// Download an archive from a URL.
    async fn download_archive(&self, url: &str, download_dir: &Path) -> Result<PathBuf, String> {
        tracing::info!("[AcpBinaryManager] Downloading from {}", url);

        let response = reqwest::get(url)
            .await
            .map_err(|e| format!("Failed to download: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Download failed with status: {}", response.status()));
        }

        // Determine filename from URL or Content-Disposition
        let filename = url
            .split('/')
            .last()
            .unwrap_or("archive")
            .split('?')
            .next()
            .unwrap_or("archive");

        let archive_path = download_dir.join(filename);

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;

        tokio::fs::write(&archive_path, &bytes)
            .await
            .map_err(|e| format!("Failed to write archive: {}", e))?;

        tracing::info!("[AcpBinaryManager] Downloaded {} bytes to {:?}", bytes.len(), archive_path);
        Ok(archive_path)
    }

    /// Extract an archive to a directory.
    async fn extract_archive(&self, archive_path: &Path, install_dir: &Path) -> Result<(), String> {
        let archive_str = archive_path.to_string_lossy().to_lowercase();
        let archive_path = archive_path.to_path_buf();
        let install_dir = install_dir.to_path_buf();

        // Run extraction in blocking task
        tokio::task::spawn_blocking(move || {
            if archive_str.ends_with(".zip") {
                Self::extract_zip(&archive_path, &install_dir)
            } else if archive_str.ends_with(".tar.gz") || archive_str.ends_with(".tgz") {
                Self::extract_tar_gz(&archive_path, &install_dir)
            } else if archive_str.ends_with(".tar.bz2") || archive_str.ends_with(".tbz2") {
                Self::extract_tar_bz2(&archive_path, &install_dir)
            } else if archive_str.ends_with(".tar") {
                Self::extract_tar(&archive_path, &install_dir)
            } else {
                // Assume it's a raw binary
                let filename = archive_path.file_name().unwrap_or_default();
                let dest = install_dir.join(filename);
                std::fs::copy(&archive_path, &dest)
                    .map_err(|e| format!("Failed to copy binary: {}", e))?;
                Ok(())
            }
        })
        .await
        .map_err(|e| format!("Extract task failed: {}", e))?
    }

    fn extract_zip(archive: &Path, dest: &Path) -> Result<(), String> {
        let file = std::fs::File::open(archive)
            .map_err(|e| format!("Failed to open zip: {}", e))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("Failed to read zip: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("Failed to read zip entry: {}", e))?;
            let outpath = dest.join(file.mangled_name());

            if file.name().ends_with('/') {
                std::fs::create_dir_all(&outpath).ok();
            } else {
                if let Some(p) = outpath.parent() {
                    std::fs::create_dir_all(p).ok();
                }
                let mut outfile = std::fs::File::create(&outpath)
                    .map_err(|e| format!("Failed to create file: {}", e))?;
                std::io::copy(&mut file, &mut outfile)
                    .map_err(|e| format!("Failed to extract file: {}", e))?;
            }
        }
        Ok(())
    }

    fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<(), String> {
        let file = std::fs::File::open(archive)
            .map_err(|e| format!("Failed to open tar.gz: {}", e))?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut tar = tar::Archive::new(gz);
        tar.unpack(dest)
            .map_err(|e| format!("Failed to extract tar.gz: {}", e))?;
        Ok(())
    }

    fn extract_tar_bz2(archive: &Path, dest: &Path) -> Result<(), String> {
        let file = std::fs::File::open(archive)
            .map_err(|e| format!("Failed to open tar.bz2: {}", e))?;
        let bz2 = bzip2::read::BzDecoder::new(file);
        let mut tar = tar::Archive::new(bz2);
        tar.unpack(dest)
            .map_err(|e| format!("Failed to extract tar.bz2: {}", e))?;
        Ok(())
    }

    fn extract_tar(archive: &Path, dest: &Path) -> Result<(), String> {
        let file = std::fs::File::open(archive)
            .map_err(|e| format!("Failed to open tar: {}", e))?;
        let mut tar = tar::Archive::new(file);
        tar.unpack(dest)
            .map_err(|e| format!("Failed to extract tar: {}", e))?;
        Ok(())
    }

    /// Find the executable in the install directory.
    async fn find_executable(&self, install_dir: &Path, binary_info: &BinaryInfo) -> Option<PathBuf> {
        // If cmd (executable name) is specified, look for it
        if let Some(cmd) = &binary_info.cmd {
            // cmd might be "./codex-acp" or "codex-acp", strip the "./" prefix
            let exe_name = cmd.strip_prefix("./").unwrap_or(cmd);
            let direct = install_dir.join(exe_name);
            if direct.exists() {
                return Some(direct);
            }
            // Search recursively
            if let Some(found) = self.find_file_recursive(install_dir, exe_name).await {
                return Some(found);
            }
        }

        // Look for common executable patterns
        let mut entries = tokio::fs::read_dir(install_dir).await.ok()?;

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_file() {
                // Check if it's executable (on Unix) or has no extension (likely binary)
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Ok(meta) = path.metadata() {
                        if meta.permissions().mode() & 0o111 != 0 {
                            return Some(path);
                        }
                    }
                }
                #[cfg(windows)]
                {
                    if path.extension().map(|e| e == "exe").unwrap_or(false) {
                        return Some(path);
                    }
                }
            }
        }
        None
    }

    async fn find_file_recursive(&self, dir: &Path, name: &str) -> Option<PathBuf> {
        let mut stack = vec![dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            if let Ok(mut entries) = tokio::fs::read_dir(&current).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    if path.is_dir() {
                        stack.push(path);
                    } else if path.file_name().map(|n| n == name).unwrap_or(false) {
                        return Some(path);
                    }
                }
            }
        }
        None
    }

    /// Prepare the executable (set permissions, remove quarantine).
    async fn prepare_executable(&self, exe_path: &Path) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = tokio::fs::metadata(exe_path)
                .await
                .map_err(|e| format!("Failed to get metadata: {}", e))?
                .permissions();
            perms.set_mode(perms.mode() | 0o755);
            tokio::fs::set_permissions(exe_path, perms)
                .await
                .map_err(|e| format!("Failed to set permissions: {}", e))?;
        }

        // Remove macOS quarantine attribute
        #[cfg(target_os = "macos")]
        {
            let exe_str = exe_path.to_string_lossy().to_string();
            let _ = tokio::process::Command::new("xattr")
                .args(["-d", "com.apple.quarantine", &exe_str])
                .output()
                .await;
        }

        Ok(())
    }

    /// Uninstall a binary agent.
    pub async fn uninstall(&self, agent_id: &str) -> Result<(), String> {
        let agent_dir = self.paths.agent_dir(agent_id);
        if agent_dir.exists() {
            tokio::fs::remove_dir_all(&agent_dir)
                .await
                .map_err(|e| format!("Failed to remove agent directory: {}", e))?;
        }
        Ok(())
    }
}
