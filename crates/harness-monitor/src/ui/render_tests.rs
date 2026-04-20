use super::{
    compact_rel_path, render_diff_stat_spans, shorten_path, split_display_path, truncate_short,
};
use crate::shared::models::{AttributionConfidence, EntryKind, FileView};
use crate::ui::tui::{display_status_code, DiffStatSummary};
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
        last_task_id: None,
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
        last_task_id: None,
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

#[test]
fn submodule_diff_stat_uses_sub_label() {
    let file = FileView {
        rel_path: "tools/entrix".to_string(),
        dirty: true,
        state_code: "modify".to_string(),
        entry_kind: EntryKind::Submodule,
        last_modified_at_ms: 0,
        last_session_id: None,
        last_task_id: None,
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

    assert_eq!(spans[0].content.as_ref(), "SUB");
}

#[test]
fn shorten_path_handles_multibyte_text_without_panicking() {
    let value =
        "另外左边的 Runs 是不是建议显示用户最近的输入？这样选择的时候，就可以选择某个输入之后的文件变更了？";

    let shortened = shorten_path(value, 20);
    assert!(shortened.starts_with("..."));
    assert!(shortened.chars().count() <= 20);
}

#[test]
fn compact_rel_path_preserves_filename_and_tail_segments() {
    let value = "apps/desktop/src-tauri/gen/frontend/.placeholder";

    let shortened = compact_rel_path(value, 30);
    assert_eq!(shortened, ".../gen/frontend/.placeholder");
}

#[test]
fn compact_rel_path_prefers_tail_context_for_snapshot_files() {
    let value =
        "crates/harness-monitor/src/ui/snapshots/harness_monitor__ui__tui__tests__routa_watch_tui_summary.snap";

    let shortened = compact_rel_path(value, 56);
    assert!(shortened.starts_with(".../snapshots/"));
    assert!(shortened.ends_with("routa_watch_tui_summary.snap"));
}

#[test]
fn compact_rel_path_restores_some_prefix_when_space_allows() {
    let value =
        "crates/harness-monitor/src/ui/snapshots/harness_monitor__ui__tui__tests__routa_watch_tui_summary.snap";

    let shortened = compact_rel_path(value, 90);
    assert!(shortened.starts_with("crates/"));
    assert!(shortened.contains("/.../"));
    assert!(shortened.contains("/snapshots/"));
    assert!(shortened.ends_with("routa_watch_tui_summary.snap"));
}

#[test]
fn truncate_short_handles_multibyte_text_without_panicking() {
    let value = "中文标题也应该安全截断";

    let shortened = truncate_short(value, 8);
    assert!(shortened.ends_with("..."));
    assert!(shortened.chars().count() <= 8);
}
