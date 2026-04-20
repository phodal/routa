//! TraceWriter — JSONL append-only writer for trace storage.
//!
//! Storage path: `~/.routa/projects/{folder-slug}/traces/{day}/traces-{datetime}.jsonl`
//!
//! Features:
//! - Thread-safe async append
//! - Automatic directory creation
//! - Daily file rotation
//! - Graceful error handling (never fails the main flow)

use chrono::{Local, Utc};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use super::TraceRecord;
use crate::storage::get_traces_dir;

/// TraceWriter manages JSONL file writing for trace records.
#[derive(Clone)]
pub struct TraceWriter {
    /// Base directory for trace files (e.g., "~/.routa/projects/{slug}/traces")
    base_dir: PathBuf,
    /// Current open file (lazy-initialized)
    current_file: Arc<Mutex<Option<CurrentFile>>>,
}

struct CurrentFile {
    /// Date string (YYYY-MM-DD) for rotation
    date: String,
    /// File path
    path: PathBuf,
}

impl TraceWriter {
    /// Create a new TraceWriter with the given workspace root.
    ///
    /// Traces are stored in `~/.routa/projects/{folder-slug}/traces/`.
    pub fn new(workspace_root: impl AsRef<Path>) -> Self {
        let workspace_str = workspace_root.as_ref().to_string_lossy().to_string();
        let base_dir = get_traces_dir(&workspace_str);
        Self {
            base_dir,
            current_file: Arc::new(Mutex::new(None)),
        }
    }

    /// Create a TraceWriter with a custom base directory.
    pub fn with_base_dir(base_dir: impl AsRef<Path>) -> Self {
        Self {
            base_dir: base_dir.as_ref().to_path_buf(),
            current_file: Arc::new(Mutex::new(None)),
        }
    }

    /// Append a trace record to the current day's JSONL file.
    ///
    /// This method is designed to never fail the main flow:
    /// - Returns `Ok(())` even if writing fails (logs the error)
    /// - Automatically creates directories and rotates files
    pub async fn append(&self, record: &TraceRecord) -> Result<(), TraceWriteError> {
        let today = Local::now().format("%Y-%m-%d").to_string();

        // Get or create the file path for today
        let file_path = self.get_file_path(&today).await?;

        // Serialize the record to JSONL (single line)
        let json = serde_json::to_string(record)
            .map_err(|e| TraceWriteError::Serialization(e.to_string()))?;

        // Append to file
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
            .await
            .map_err(|e| TraceWriteError::Io(e.to_string()))?;

        file.write_all(json.as_bytes())
            .await
            .map_err(|e| TraceWriteError::Io(e.to_string()))?;
        file.write_all(b"\n")
            .await
            .map_err(|e| TraceWriteError::Io(e.to_string()))?;
        file.flush()
            .await
            .map_err(|e| TraceWriteError::Io(e.to_string()))?;

        Ok(())
    }

    /// Append a trace record, logging errors but never failing.
    ///
    /// Use this in production code paths where trace failures
    /// should not impact the main flow.
    pub async fn append_safe(&self, record: &TraceRecord) {
        if let Err(e) = self.append(record).await {
            tracing::warn!("[TraceWriter] Failed to write trace: {}", e);
        }
    }

    /// Get the file path for a given date, creating directories if needed.
    async fn get_file_path(&self, date: &str) -> Result<PathBuf, TraceWriteError> {
        let mut current = self.current_file.lock().await;

        // Check if we have a file for today
        if let Some(ref cf) = *current {
            if cf.date == date {
                return Ok(cf.path.clone());
            }
        }

        // Create directory for the day
        let day_dir = self.base_dir.join(date);
        fs::create_dir_all(&day_dir)
            .await
            .map_err(|e| TraceWriteError::Io(format!("Failed to create trace dir: {e}")))?;

        // Create filename with timestamp
        let datetime = Utc::now().format("%Y%m%d-%H%M%S").to_string();
        let filename = format!("traces-{datetime}.jsonl");
        let file_path = day_dir.join(filename);

        // Update current file
        *current = Some(CurrentFile {
            date: date.to_string(),
            path: file_path.clone(),
        });

        Ok(file_path)
    }

    /// Get the base directory for traces.
    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }
}

/// Error type for trace writing operations.
#[derive(Debug, thiserror::Error)]
pub enum TraceWriteError {
    #[error("IO error: {0}")]
    Io(String),
    #[error("Serialization error: {0}")]
    Serialization(String),
}
