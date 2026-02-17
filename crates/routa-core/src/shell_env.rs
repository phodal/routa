//! Resolve the user's full shell PATH for desktop GUI apps.
//!
//! GUI applications may inherit a minimal PATH:
//! - macOS Finder/Dock: `/usr/bin:/bin:/usr/sbin:/sbin`
//! - Windows: usually fine, but may miss user-installed tools
//! - Linux: depends on the desktop environment
//!
//! This module recovers the user's login-shell PATH so we can find
//! CLI tools like `opencode`, `claude`, `gemini`, etc.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static FULL_PATH: OnceLock<String> = OnceLock::new();

/// Platform-specific PATH separator.
#[cfg(windows)]
const PATH_SEP: char = ';';
#[cfg(not(windows))]
const PATH_SEP: char = ':';

/// Get the user's full shell PATH.
/// Cached after the first call.
pub fn full_path() -> &'static str {
    FULL_PATH.get_or_init(resolve_full_path)
}

/// Resolve PATH by merging current PATH, login-shell PATH, and well-known dirs.
fn resolve_full_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let home = dirs::home_dir().unwrap_or_default();

    let mut seen = std::collections::HashSet::new();
    let mut parts: Vec<String> = Vec::new();

    let mut add = |p: &str| {
        if !p.is_empty() && seen.insert(p.to_string()) {
            parts.push(p.to_string());
        }
    };

    // 1. Try to get the real PATH from the user's login shell (Unix only)
    #[cfg(not(windows))]
    if let Some(shell_path) = resolve_unix_shell_path() {
        for p in shell_path.split(PATH_SEP) {
            add(p);
        }
    }

    // 2. Merge current process PATH
    for p in current.split(PATH_SEP) {
        add(p);
    }

    // 3. Add well-known directories
    for dir in well_known_dirs(&home) {
        let d = dir.to_string_lossy().to_string();
        if dir.is_dir() {
            add(&d);
        }
    }

    let result = parts.join(&PATH_SEP.to_string());
    tracing::info!("[shell_env] Resolved PATH ({} entries)", parts.len());
    result
}

/// Unix: try running the user's login shell to get $PATH.
#[cfg(not(windows))]
fn resolve_unix_shell_path() -> Option<String> {
    // Try the user's configured login shell first
    let login_shell = std::env::var("SHELL").unwrap_or_default();
    let shells_to_try: Vec<&str> = if login_shell.is_empty() {
        vec!["/bin/zsh", "/bin/bash", "/bin/sh"]
    } else {
        vec![&login_shell, "/bin/zsh", "/bin/bash", "/bin/sh"]
    };

    for shell in shells_to_try {
        if let Ok(output) = std::process::Command::new(shell)
            .args(["-l", "-c", "echo $PATH"])
            .output()
        {
            if output.status.success() {
                if let Ok(path) = String::from_utf8(output.stdout) {
                    let trimmed = path.trim().to_string();
                    if !trimmed.is_empty() {
                        return Some(trimmed);
                    }
                }
            }
        }
    }

    None
}

/// Well-known directories where user CLI tools may be installed.
fn well_known_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    // Cross-platform: home-relative dirs
    dirs.push(home.join(".local").join("bin"));
    dirs.push(home.join(".cargo").join("bin"));
    dirs.push(home.join(".opencode").join("bin"));
    dirs.push(home.join(".bun").join("bin"));
    dirs.push(home.join("bin"));
    dirs.push(home.join("go").join("bin"));
    dirs.push(home.join(".npm-global").join("bin"));

    #[cfg(target_os = "macos")]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/opt/homebrew/sbin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/local/sbin"));
    }

    #[cfg(target_os = "linux")]
    {
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/local/sbin"));
        dirs.push(PathBuf::from("/snap/bin"));
        // Linuxbrew / Homebrew on Linux
        dirs.push(home.join(".linuxbrew").join("bin"));
        dirs.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin"));
    }

    #[cfg(windows)]
    {
        // Common Windows install locations
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let lad = PathBuf::from(&local_app_data);
            dirs.push(lad.join("Programs"));
            dirs.push(lad.join("Microsoft").join("WinGet").join("Packages"));
        }
        if let Ok(app_data) = std::env::var("APPDATA") {
            let ad = PathBuf::from(&app_data);
            dirs.push(ad.join("npm"));
        }
        // Scoop
        dirs.push(home.join("scoop").join("shims"));
        // Chocolatey
        if let Ok(choco) = std::env::var("ChocolateyInstall") {
            dirs.push(PathBuf::from(choco).join("bin"));
        }
    }

    dirs
}

/// Run a `which`-like check for a command using the full PATH.
pub fn which(cmd: &str) -> Option<String> {
    let path = full_path();

    #[cfg(windows)]
    let extensions: Vec<&str> = {
        let pathext = std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD;.PS1".to_string());
        // Leak the string so we get 'static references — fine for a one-time init
        let leaked: &'static str = Box::leak(pathext.into_boxed_str());
        leaked.split(';').collect()
    };

    for dir in path.split(PATH_SEP) {
        let base = Path::new(dir).join(cmd);

        // On Unix: just check the exact name
        #[cfg(not(windows))]
        {
            if base.is_file() {
                return Some(base.to_string_lossy().to_string());
            }
        }

        // On Windows: check with each PATHEXT extension
        #[cfg(windows)]
        {
            // Check exact name first (e.g. cmd already has .exe)
            if base.is_file() {
                return Some(base.to_string_lossy().to_string());
            }
            for ext in &extensions {
                let with_ext = base.with_extension(ext.trim_start_matches('.'));
                if with_ext.is_file() {
                    return Some(with_ext.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}
