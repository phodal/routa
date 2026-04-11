use super::{FitnessHistoryRecord, FITNESS_HISTORY_FILE};
use crate::repo;
use std::path::{Path, PathBuf};

pub(super) fn read_fitness_history_record(repo_root: &str) -> Option<FitnessHistoryRecord> {
    let path = fitness_history_path(repo_root)?;
    let payload = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&payload).ok()
}

pub(super) fn fitness_history_path(repo_root: &str) -> Option<PathBuf> {
    let event_path = repo::runtime_event_path(Path::new(repo_root));
    Some(event_path.parent()?.join(FITNESS_HISTORY_FILE))
}
