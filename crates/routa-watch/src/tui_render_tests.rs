use super::{render_diff_stat_spans, split_display_path};
use crate::models::{AttributionConfidence, EntryKind, FileView};
use crate::tui::{display_status_code, DiffStatSummary};
use std::collections::BTreeSet;

#[test]
fn split_display_path_marks_directories() {
    let file = FileView {
        rel_path: ".kiro/skills/developer-onboarding".to_string(),
        dirty: true,
        state_code: "untracked".to_string(),
        entry_kind: EntryKind::Directory,
        last_modified_at_ms: 0,
        last_session_id: None,
        confidence: AttributionConfidence::Unknown,
        conflicted: false,
        touched_by: BTreeSet::new(),
        recent_events: Vec::new(),
    };

    let (name, parent) = split_display_path(&file);

    assert_eq!(name, "developer-onboarding/");
    assert_eq!(parent, ".kiro/skills");
}

#[test]
fn directory_diff_stat_uses_dir_label() {
    let file = FileView {
        rel_path: ".kiro/skills/developer-onboarding".to_string(),
        dirty: true,
        state_code: "untracked".to_string(),
        entry_kind: EntryKind::Directory,
        last_modified_at_ms: 0,
        last_session_id: None,
        confidence: AttributionConfidence::Unknown,
        conflicted: false,
        touched_by: BTreeSet::new(),
        recent_events: Vec::new(),
    };

    let spans = render_diff_stat_spans(&DiffStatSummary {
        status: display_status_code(&file),
        additions: None,
        deletions: None,
    });

    assert_eq!(spans[0].content.as_ref(), "DIR");
}
