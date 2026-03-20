//! Folder Slug — Unified path-to-slug algorithm for local storage.
//!
//! Converts absolute paths to slug format for use as directory names
//! under `~/.routa/projects/{folder-slug}/`.
//!
//! Algorithm:
//! 1. Strip leading path separators (/ or \)
//! 2. Replace all path separators with hyphens
//! 3. Collapse consecutive separators into a single hyphen
//!
//! Examples:
//!   /Users/john/my-project → Users-john-my-project
//!   C:\Users\john\project  → C-Users-john-project
//!
//! The same algorithm is implemented in TypeScript for consistency.

use std::path::PathBuf;

/// Convert an absolute path to a folder slug.
///
/// # Examples
/// ```
/// use routa_core::storage::to_folder_slug;
/// assert_eq!(to_folder_slug("/Users/john/my-project"), "Users-john-my-project");
/// assert_eq!(to_folder_slug("C:\\Users\\john\\project"), "C:-Users-john-project");
/// assert_eq!(to_folder_slug("/Users//john///project"), "Users-john-project");
/// assert_eq!(to_folder_slug("/Users/john/project/"), "Users-john-project");
/// ```
pub fn to_folder_slug(absolute_path: &str) -> String {
    // Strip leading separators
    let cleaned = absolute_path.trim_start_matches(['/', '\\']);
    // Strip trailing separators (avoids trailing hyphen in slug)
    let cleaned = cleaned.trim_end_matches(['/', '\\']);
    // Replace consecutive separators with a single hyphen
    let mut result = String::with_capacity(cleaned.len());
    let mut last_was_sep = false;
    for c in cleaned.chars() {
        if c == ':' {
            // Skip colons (Windows drive letters like C: or E:)
            continue;
        }
        if c == '/' || c == '\\' {
            if !last_was_sep {
                result.push('-');
            }
            last_was_sep = true;
        } else {
            result.push(c);
            last_was_sep = false;
        }
    }
    result
}

/// Get the base storage directory for a project.
///
/// Returns `~/.routa/projects/{folder-slug}`
pub fn get_project_storage_dir(absolute_path: &str) -> PathBuf {
    let slug = to_folder_slug(absolute_path);
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
    home.join(".routa").join("projects").join(slug)
}

/// Get the sessions directory for a project.
///
/// Returns `~/.routa/projects/{folder-slug}/sessions`
pub fn get_sessions_dir(absolute_path: &str) -> PathBuf {
    get_project_storage_dir(absolute_path).join("sessions")
}

/// Get the traces directory for a project.
///
/// Returns `~/.routa/projects/{folder-slug}/traces`
pub fn get_traces_dir(absolute_path: &str) -> PathBuf {
    get_project_storage_dir(absolute_path).join("traces")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_unix_path() {
        assert_eq!(
            to_folder_slug("/Users/john/my-project"),
            "Users-john-my-project"
        );
    }

    #[test]
    fn test_windows_path() {
        assert_eq!(
            to_folder_slug("C:\\Users\\john\\project"),
            "C-Users-john-project"
        );
    }

    #[test]
    fn test_consecutive_separators() {
        assert_eq!(
            to_folder_slug("/Users//john///project"),
            "Users-john-project"
        );
    }

    #[test]
    fn test_mixed_separators() {
        assert_eq!(to_folder_slug("/Users/john\\project"), "Users-john-project");
    }

    #[test]
    fn test_trailing_separator() {
        // Trailing separator is stripped to avoid slug mismatch
        assert_eq!(to_folder_slug("/Users/john/project/"), "Users-john-project");
    }

    #[test]
    fn test_trailing_slash_consistency() {
        // With or without trailing slash should produce the same slug
        assert_eq!(
            to_folder_slug("/Users/john/project/"),
            to_folder_slug("/Users/john/project")
        );
    }

    #[test]
    fn test_deterministic() {
        let path = "/Users/john/my-project";
        assert_eq!(to_folder_slug(path), to_folder_slug(path));
    }

    #[test]
    fn test_get_project_storage_dir() {
        let dir = get_project_storage_dir("/Users/john/my-project");
        assert!(dir.to_string_lossy().contains("Users-john-my-project"));
        assert!(dir.to_string_lossy().contains(".routa/projects"));
    }
    
    #[test]
    fn test_windows_drive_letter_colon_stripped() {
        assert_eq!(to_folder_slug("E:\\routa"), "E-routa");
        assert_eq!(to_folder_slug("D:\\my-workspace\\app"), "D-my-workspace-app");
    }

    #[test]
    fn test_windows_drive_colon_consistency() {
        // With or without drive letter should produce a valid slug (no colons)
        let slug = to_folder_slug("E:\\routa\\.routa\\repos\\keepongo--routa-project");
        assert!(!slug.contains(':'), "slug must not contain colons: {slug}");
        assert_eq!(slug, "E-routa-.routa-repos-keepongo--routa-project");
    }

    #[test]
    fn test_multiple_colons_stripped() {
        // Edge case: path with multiple colons
        assert_eq!(to_folder_slug("C:\\foo:bar\\baz"), "C-foobar-baz");
    }
}
