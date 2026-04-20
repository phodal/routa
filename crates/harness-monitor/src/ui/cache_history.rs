use super::{
    FitnessHistoryRecord, TestMappingHistoryRecord, FITNESS_HISTORY_FILE, TEST_MAPPING_HISTORY_FILE,
};
use crate::observe;
use crate::shared::models::{FitnessEvent, RuntimeMessage};
use std::path::{Path, PathBuf};

pub(super) fn read_fitness_history_record(repo_root: &str) -> Option<FitnessHistoryRecord> {
    let path = fitness_history_path(repo_root)?;
    let payload = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&payload).ok()
}

pub(super) fn fitness_history_path(repo_root: &str) -> Option<PathBuf> {
    let event_path = observe::repo::runtime_event_path(Path::new(repo_root));
    Some(event_path.parent()?.join(FITNESS_HISTORY_FILE))
}

pub(super) fn read_test_mapping_history_record(
    repo_root: &str,
) -> Option<TestMappingHistoryRecord> {
    let path = test_mapping_history_path(repo_root)?;
    let payload = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&payload).ok()
}

pub(super) fn test_mapping_history_path(repo_root: &str) -> Option<PathBuf> {
    let event_path = observe::repo::runtime_event_path(Path::new(repo_root));
    Some(event_path.parent()?.join(TEST_MAPPING_HISTORY_FILE))
}

pub(super) fn latest_fitness_mailbox_event(repo_root: &str, mode: &str) -> Option<FitnessEvent> {
    let mailbox_dir = observe::repo::runtime_fitness_mailbox_dir(Path::new(repo_root));
    let mut entries = std::fs::read_dir(mailbox_dir)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("json"))
        .collect::<Vec<_>>();
    entries.sort();
    for path in entries.into_iter().rev() {
        let payload = std::fs::read_to_string(&path).ok()?;
        let message: RuntimeMessage = serde_json::from_str(&payload).ok()?;
        let RuntimeMessage::Fitness(event) = message else {
            continue;
        };
        if event.mode == mode {
            return Some(event);
        }
    }
    None
}
