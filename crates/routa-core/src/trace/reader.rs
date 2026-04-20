//! TraceReader — Query and read trace records from filesystem storage.
//!
//! Storage paths:
//! - New: `~/.routa/projects/{folder-slug}/traces/{day}/traces-{datetime}.jsonl`
//! - Legacy: `<workspace>/.routa/traces/{day}/traces-{datetime}.jsonl`
//!
//! Features:
//! - Filter traces by session, file, workspace, date range
//! - Retrieve individual traces by ID
//! - Export traces in standard Agent Trace JSON format
//! - Efficient file scanning with early termination on match
//! - Backward-compatible: searches both new and legacy paths

use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::types::TraceRecord;
use crate::storage::get_traces_dir;

/// Query parameters for filtering traces.
#[derive(Debug, Clone, Default)]
pub struct TraceQuery {
    /// Filter by session ID
    pub session_id: Option<String>,
    /// Filter by workspace ID
    pub workspace_id: Option<String>,
    /// Filter by file path
    pub file: Option<String>,
    /// Filter by event type
    pub event_type: Option<String>,
    /// Start date (ISO 8601 or YYYY-MM-DD)
    pub start_date: Option<String>,
    /// End date (ISO 8601 or YYYY-MM-DD)
    pub end_date: Option<String>,
    /// Maximum number of traces to return
    pub limit: Option<usize>,
    /// Skip N traces (for pagination)
    pub offset: Option<usize>,
}

/// TraceReader provides querying capabilities over stored traces.
#[derive(Clone)]
pub struct TraceReader {
    /// New trace directory: ~/.routa/projects/{slug}/traces
    new_base_dir: PathBuf,
    /// Legacy trace directory: {workspace}/.routa/traces
    legacy_base_dir: PathBuf,
}

impl TraceReader {
    /// Create a new TraceReader with the given workspace root.
    ///
    /// Reads from both `~/.routa/projects/{folder-slug}/traces/` (new)
    /// and `<workspace_root>/.routa/traces/` (legacy).
    pub fn new(workspace_root: impl AsRef<Path>) -> Self {
        let workspace_str = workspace_root.as_ref().to_string_lossy().to_string();
        let new_base_dir = get_traces_dir(&workspace_str);
        let legacy_base_dir = workspace_root.as_ref().join(".routa").join("traces");
        Self {
            new_base_dir,
            legacy_base_dir,
        }
    }

    /// Create a TraceReader with a custom base directory (used as legacy path).
    pub fn with_base_dir(base_dir: impl AsRef<Path>) -> Self {
        Self {
            new_base_dir: base_dir.as_ref().to_path_buf(),
            legacy_base_dir: base_dir.as_ref().to_path_buf(),
        }
    }

    /// Collect all trace base directories: new path, legacy path, and repo-specific ones.
    async fn get_all_trace_base_dirs(&self) -> Vec<PathBuf> {
        let mut dirs = Vec::new();

        // 1. New storage path: ~/.routa/projects/{slug}/traces/
        if self.new_base_dir.exists() {
            dirs.push(self.new_base_dir.clone());
        }

        // 2. Legacy path: {workspace}/.routa/traces/
        if self.legacy_base_dir.exists() && self.legacy_base_dir != self.new_base_dir {
            dirs.push(self.legacy_base_dir.clone());
        }

        // 3. Scan .routa/repos/*/.routa/traces/ for repo-specific trace directories
        if let Some(routa_dir) = self.legacy_base_dir.parent() {
            let repos_dir = routa_dir.join("repos");
            if let Ok(mut readdir) = tokio::fs::read_dir(&repos_dir).await {
                while let Ok(Some(entry)) = readdir.next_entry().await {
                    let repo_trace_dir = entry.path().join(".routa").join("traces");
                    if repo_trace_dir.exists() {
                        dirs.push(repo_trace_dir);
                    }
                }
            }
        }

        dirs
    }

    /// Query traces based on the provided filter parameters.
    ///
    /// Returns traces sorted by timestamp (newest first).
    /// Scans both the primary trace directory and all repo-specific directories.
    pub async fn query(&self, query: &TraceQuery) -> Result<Vec<TraceRecord>, TraceReadError> {
        let all_base_dirs = self.get_all_trace_base_dirs().await;
        if all_base_dirs.is_empty() {
            return Ok(Vec::new());
        }

        let mut traces = Vec::new();

        for base_dir in &all_base_dirs {
            let mut day_dirs = collect_dirs(base_dir).await.unwrap_or_default();
            day_dirs.sort_by(|a, b| b.cmp(a));

            let filtered_days =
                if let (Some(start), Some(end)) = (&query.start_date, &query.end_date) {
                    self.filter_days_by_range(&day_dirs, start, end)?
                } else if let Some(start) = &query.start_date {
                    self.filter_days_since(&day_dirs, start)?
                } else if let Some(end) = &query.end_date {
                    self.filter_days_until(&day_dirs, end)?
                } else {
                    day_dirs
                };

            for day_dir in filtered_days {
                let mut trace_files = collect_jsonl_files(&day_dir).await.unwrap_or_default();
                trace_files.sort_by(|a, b| b.cmp(a));

                for trace_file in trace_files {
                    let content = tokio::fs::read_to_string(&trace_file).await.map_err(|e| {
                        TraceReadError::Io(format!("Failed to read trace file: {e}"))
                    })?;

                    for line in content.lines() {
                        if let Ok(record) = serde_json::from_str::<TraceRecord>(line) {
                            if self.matches_query(&record, query) {
                                traces.push(record);
                            }
                        }
                    }
                }
            }
        }

        // Sort by timestamp (newest first) and apply pagination
        traces.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        let offset = query.offset.unwrap_or(0);
        let limit = query.limit.unwrap_or(traces.len());

        Ok(traces.into_iter().skip(offset).take(limit).collect())
    }

    /// Get a single trace by its ID.
    pub async fn get_by_id(&self, id: &str) -> Result<Option<TraceRecord>, TraceReadError> {
        let all_base_dirs = self.get_all_trace_base_dirs().await;

        for base_dir in &all_base_dirs {
            let day_dirs = collect_dirs(base_dir).await.unwrap_or_default();

            for day_dir in day_dirs {
                let trace_files = collect_jsonl_files(&day_dir).await.unwrap_or_default();

                for trace_file in trace_files {
                    let content = tokio::fs::read_to_string(&trace_file).await.map_err(|e| {
                        TraceReadError::Io(format!("Failed to read trace file: {e}"))
                    })?;

                    for line in content.lines() {
                        if let Ok(record) = serde_json::from_str::<TraceRecord>(line) {
                            if record.id == id {
                                return Ok(Some(record));
                            }
                        }
                    }
                }
            }
        }

        Ok(None)
    }

    /// Export traces matching the query in Agent Trace JSON format.
    ///
    /// Returns a JSON array of trace records.
    pub async fn export(&self, query: &TraceQuery) -> Result<Value, TraceReadError> {
        let traces = self.query(query).await?;
        let traces_json: Value = serde_json::to_value(traces).map_err(|e| {
            TraceReadError::Serialization(format!("Failed to serialize traces: {e}"))
        })?;
        Ok(traces_json)
    }

    /// Get trace statistics for a workspace.
    pub async fn stats(&self) -> Result<TraceStats, TraceReadError> {
        let all_base_dirs = self.get_all_trace_base_dirs().await;
        if all_base_dirs.is_empty() {
            return Ok(TraceStats::default());
        }

        let mut stats = TraceStats::default();

        for base_dir in &all_base_dirs {
            let day_dirs = collect_dirs(base_dir).await.unwrap_or_default();

            for day_dir in day_dirs {
                stats.total_days += 1;

                let trace_files = collect_jsonl_files(&day_dir).await.unwrap_or_default();
                stats.total_files += trace_files.len() as u32;

                for trace_file in trace_files {
                    let content = tokio::fs::read_to_string(&trace_file).await.map_err(|e| {
                        TraceReadError::Io(format!("Failed to read trace file: {e}"))
                    })?;

                    stats.total_records += content.lines().count();

                    for line in content.lines() {
                        if let Ok(record) = serde_json::from_str::<TraceRecord>(line) {
                            stats.sessions.insert(record.session_id.clone());
                            let event_type_str = format!("{:?}", record.event_type);
                            *stats.event_types.entry(event_type_str).or_insert(0) += 1;
                        }
                    }
                }
            }
        }

        stats.unique_sessions = stats.sessions.len() as u32;

        Ok(stats)
    }

    /// Check if a trace record matches the query parameters.
    fn matches_query(&self, record: &TraceRecord, query: &TraceQuery) -> bool {
        if let Some(ref session_id) = query.session_id {
            if &record.session_id != session_id {
                return false;
            }
        }

        if let Some(ref workspace_id) = query.workspace_id {
            if record.workspace_id.as_ref() != Some(workspace_id) {
                return false;
            }
        }

        if let Some(ref file) = query.file {
            let file_matches = record.files.iter().any(|f| &f.path == file);
            if !file_matches {
                return false;
            }
        }

        if let Some(ref event_type) = query.event_type {
            let record_type = format!("{:?}", record.event_type).to_lowercase();
            let query_lower = event_type.to_lowercase();
            if record_type != query_lower {
                // Also check snake_case variant
                let record_type_snake = to_snake_case(&format!("{:?}", record.event_type));
                if record_type_snake != query_lower {
                    return false;
                }
            }
        }

        true
    }

    /// Filter day directories by date range.
    fn filter_days_by_range(
        &self,
        day_dirs: &[PathBuf],
        start: &str,
        end: &str,
    ) -> Result<Vec<PathBuf>, TraceReadError> {
        let start_date = self.parse_date(start)?;
        let end_date = self.parse_date(end)?;

        Ok(day_dirs
            .iter()
            .filter(|path| {
                if let Some(date_str) = path.file_name().and_then(|n| n.to_str()) {
                    if let Ok(date) = self.parse_date(date_str) {
                        return date >= start_date && date <= end_date;
                    }
                }
                false
            })
            .cloned()
            .collect())
    }

    /// Filter day directories since a start date.
    fn filter_days_since(
        &self,
        day_dirs: &[PathBuf],
        start: &str,
    ) -> Result<Vec<PathBuf>, TraceReadError> {
        let start_date = self.parse_date(start)?;

        Ok(day_dirs
            .iter()
            .filter(|path| {
                if let Some(date_str) = path.file_name().and_then(|n| n.to_str()) {
                    if let Ok(date) = self.parse_date(date_str) {
                        return date >= start_date;
                    }
                }
                false
            })
            .cloned()
            .collect())
    }

    /// Filter day directories until an end date.
    fn filter_days_until(
        &self,
        day_dirs: &[PathBuf],
        end: &str,
    ) -> Result<Vec<PathBuf>, TraceReadError> {
        let end_date = self.parse_date(end)?;

        Ok(day_dirs
            .iter()
            .filter(|path| {
                if let Some(date_str) = path.file_name().and_then(|n| n.to_str()) {
                    if let Ok(date) = self.parse_date(date_str) {
                        return date <= end_date;
                    }
                }
                false
            })
            .cloned()
            .collect())
    }

    /// Parse a date string (YYYY-MM-DD or ISO 8601).
    fn parse_date(&self, date_str: &str) -> Result<chrono::NaiveDate, TraceReadError> {
        let trimmed = date_str.split('T').next().unwrap_or(date_str);
        chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
            .map_err(|e| TraceReadError::InvalidDate(format!("Invalid date '{date_str}': {e}")))
    }
}

/// Helper function to collect directories from a path.
async fn collect_dirs(path: &Path) -> Result<Vec<PathBuf>, TraceReadError> {
    let mut dirs = Vec::new();
    let mut readdir = tokio::fs::read_dir(path)
        .await
        .map_err(|e| TraceReadError::Io(format!("Failed to read directory: {e}")))?;

    while let Some(entry) = readdir
        .next_entry()
        .await
        .map_err(|e| TraceReadError::Io(format!("Failed to read dir entry: {e}")))?
    {
        let path = entry.path();
        if path.is_dir() {
            dirs.push(path);
        }
    }

    Ok(dirs)
}

/// Helper function to collect JSONL files from a path.
async fn collect_jsonl_files(path: &Path) -> Result<Vec<PathBuf>, TraceReadError> {
    let mut files = Vec::new();
    let mut readdir = tokio::fs::read_dir(path)
        .await
        .map_err(|e| TraceReadError::Io(format!("Failed to read directory: {e}")))?;

    while let Some(entry) = readdir
        .next_entry()
        .await
        .map_err(|e| TraceReadError::Io(format!("Failed to read dir entry: {e}")))?
    {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext == "jsonl" {
                    files.push(path);
                }
            }
        }
    }

    Ok(files)
}

/// Convert a string to snake_case.
fn to_snake_case(s: &str) -> String {
    s.chars()
        .enumerate()
        .map(|(i, c)| {
            if c.is_uppercase() {
                if i > 0 {
                    format!("_{}", c.to_lowercase().collect::<String>())
                } else {
                    c.to_lowercase().collect::<String>()
                }
            } else {
                c.to_string()
            }
        })
        .collect()
}

/// Statistics about stored traces.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct TraceStats {
    pub total_days: u32,
    pub total_files: u32,
    pub total_records: usize,
    pub unique_sessions: u32,
    #[serde(skip)]
    pub sessions: std::collections::HashSet<String>,
    pub event_types: HashMap<String, u32>,
}

/// Error type for trace reading operations.
#[derive(Debug, thiserror::Error)]
pub enum TraceReadError {
    #[error("IO error: {0}")]
    Io(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Invalid date: {0}")]
    InvalidDate(String),
}
