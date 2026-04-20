use super::render::UiPalette;
use super::review::ReviewHint;
use super::*;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use std::path::Path;

pub(super) struct FileMetaSegments {
    pub(super) spans: Vec<Span<'static>>,
    pub(super) display_width: usize,
}

impl FileMetaSegments {
    pub(super) fn empty() -> Self {
        Self {
            spans: Vec::new(),
            display_width: 0,
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.spans.is_empty()
    }
}

struct FileMetaColumns {
    status_width: usize,
    diff_width: usize,
    badge_width: usize,
    age_width: usize,
}

impl FileMetaColumns {
    fn display_width(&self) -> usize {
        let mut width = 1 + self.status_width + 1 + self.diff_width;
        if self.badge_width > 0 {
            width += 1 + self.badge_width;
        }
        if self.age_width > 0 {
            width += 1 + self.age_width;
        }
        width
    }
}

pub(super) fn split_display_path(file: &crate::shared::models::FileView) -> (String, String) {
    let path = Path::new(&file.rel_path);
    let mut file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    if file.entry_kind.is_container() && !file_name.ends_with('/') {
        file_name.push('/');
    }
    let parent = path
        .parent()
        .map(|parent| {
            let value = parent.to_string_lossy().to_string();
            if value == "." || value.is_empty() {
                "/".to_string()
            } else {
                value
            }
        })
        .unwrap_or_else(|| "/".to_string());
    (file_name, parent)
}

pub(super) fn build_file_meta_segments(
    file: &crate::shared::models::FileView,
    diff_stat: &DiffStatSummary,
    review_hint: Option<&ReviewHint>,
    test_mapping: Option<&TestMappingEntry>,
    changed_test_file: bool,
    colors: UiPalette,
    area_width: usize,
) -> FileMetaSegments {
    let columns = file_meta_columns(diff_stat, review_hint, test_mapping, changed_test_file);
    let columns_width = columns.display_width();
    if columns_width == 0 || columns_width > area_width.saturating_sub(3) {
        return FileMetaSegments::empty();
    }
    let hide_age = area_width < columns_width + 20;
    let mut spans = Vec::new();
    let mut display_width = 0usize;

    spans.push(Span::raw(" "));
    display_width += 1;

    spans.push(Span::styled(
        pad_left(&diff_stat.status, columns.status_width),
        Style::default()
            .fg(change_color_from_status(&diff_stat.status))
            .add_modifier(Modifier::BOLD),
    ));
    display_width += columns.status_width;

    spans.push(Span::raw(" "));
    display_width += 1;
    spans.extend(render_diff_delta_column(diff_stat, columns.diff_width));
    display_width += columns.diff_width;

    if let Some((label, color)) = render_test_mapping_badge(test_mapping, changed_test_file, colors)
    {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            pad_right(&label, columns.badge_width),
            Style::default().fg(color),
        ));
        display_width += 1 + columns.badge_width;
    } else if let Some(hint) = review_hint {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            pad_right(hint.label, columns.badge_width),
            Style::default().fg(review_hint_color(hint)),
        ));
        display_width += 1 + columns.badge_width;
    } else if columns.badge_width > 0 {
        spans.push(Span::raw(" "));
        spans.push(Span::raw(" ".repeat(columns.badge_width)));
        display_width += 1 + columns.badge_width;
    }

    if !hide_age {
        let age = time_ago(file.last_modified_at_ms);
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            pad_left(&age, columns.age_width),
            Style::default().fg(colors.muted),
        ));
        display_width += 1 + columns.age_width;
    }

    FileMetaSegments {
        spans,
        display_width,
    }
}

pub(super) fn render_file_secondary_line(
    file: &crate::shared::models::FileView,
    diff_stat: &DiffStatSummary,
    review_hint: Option<&ReviewHint>,
    test_mapping: Option<&TestMappingEntry>,
    changed_test_file: bool,
    colors: UiPalette,
) -> Line<'static> {
    let age = pad_left(&time_ago(file.last_modified_at_ms), 5);
    let mut spans = render_diff_stat_spans(diff_stat);
    if let Some(hint) = review_hint {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(
            hint.label,
            Style::default().fg(review_hint_color(hint)),
        ));
    }
    if let Some((label, color)) = render_test_mapping_badge(test_mapping, changed_test_file, colors)
    {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(label, Style::default().fg(color)));
    }
    spans.push(Span::raw(" "));
    spans.push(Span::styled(age, Style::default().fg(colors.muted)));
    Line::from(spans)
}

pub(super) fn render_file_meta_line(
    file: &crate::shared::models::FileView,
    diff_stat: &DiffStatSummary,
    review_hint: Option<&ReviewHint>,
    test_mapping: Option<&TestMappingEntry>,
    changed_test_file: bool,
    colors: UiPalette,
) -> Line<'static> {
    let mut spans = vec![Span::raw("  ")];
    spans.extend(
        render_file_secondary_line(
            file,
            diff_stat,
            review_hint,
            test_mapping,
            changed_test_file,
            colors,
        )
        .spans,
    );
    Line::from(spans)
}

pub(super) fn review_hint_color(hint: &ReviewHint) -> Color {
    match hint.level {
        crate::ui::tui::review::ReviewRiskLevel::High => STOPPED,
        crate::ui::tui::review::ReviewRiskLevel::Medium => INFERRED,
    }
}

pub(super) fn render_test_mapping_badge(
    test_mapping: Option<&TestMappingEntry>,
    changed_test_file: bool,
    colors: UiPalette,
) -> Option<(String, Color)> {
    if changed_test_file {
        return Some(("TEST".to_string(), ACTIVE));
    }

    let mapping = test_mapping?;
    let (label, color) = match mapping.status.as_str() {
        "changed" => ("TM changed", ACTIVE),
        "exists" => ("TM ok", ACTIVE),
        "inline" => ("TM inline", ACTIVE),
        "missing" => ("TM miss", STOPPED),
        "unknown" => ("TM ?", INFERRED),
        _ => ("TM ...", colors.muted),
    };
    Some((label.to_string(), color))
}

pub(super) fn render_diff_stat_spans(diff_stat: &DiffStatSummary) -> Vec<Span<'static>> {
    let mut spans = vec![Span::styled(
        pad_right(&diff_stat.status, 2),
        Style::default()
            .fg(change_color_from_status(diff_stat.status.as_str()))
            .add_modifier(Modifier::BOLD),
    )];
    if let Some(add) = diff_stat.additions {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(format!("+{add}"), Style::default().fg(ACTIVE)));
    }
    if let Some(del) = diff_stat.deletions {
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            format!("-{del}"),
            Style::default().fg(STOPPED),
        ));
    }
    spans.push(Span::styled(
        pad_right(
            "",
            9usize.saturating_sub(diff_stat_display_width(diff_stat)),
        ),
        Style::default(),
    ));
    spans
}

fn file_meta_columns(
    diff_stat: &DiffStatSummary,
    review_hint: Option<&ReviewHint>,
    test_mapping: Option<&TestMappingEntry>,
    changed_test_file: bool,
) -> FileMetaColumns {
    let badge_width = test_mapping_badge_label(test_mapping, changed_test_file)
        .map(|label| label.chars().count())
        .or_else(|| review_hint.map(|hint| hint.label.chars().count()))
        .unwrap_or(0)
        .max(4);
    FileMetaColumns {
        status_width: diff_stat.status.chars().count().max(1),
        diff_width: diff_delta_display_width(diff_stat).max(7),
        badge_width,
        age_width: 4,
    }
}

fn test_mapping_badge_label(
    test_mapping: Option<&TestMappingEntry>,
    changed_test_file: bool,
) -> Option<&'static str> {
    if changed_test_file {
        return Some("TEST");
    }

    let mapping = test_mapping?;
    Some(match mapping.status.as_str() {
        "changed" => "TM changed",
        "exists" => "TM ok",
        "inline" => "TM inline",
        "missing" => "TM miss",
        "unknown" => "TM ?",
        _ => "TM ...",
    })
}

fn diff_delta_display_width(diff_stat: &DiffStatSummary) -> usize {
    let mut width = 0usize;
    if let Some(add) = diff_stat.additions {
        width += format!("+{add}").len();
    }
    if diff_stat.additions.is_some() && diff_stat.deletions.is_some() {
        width += 1;
    }
    if let Some(del) = diff_stat.deletions {
        width += format!("-{del}").len();
    }
    if width == 0 {
        diff_stat.status.len()
    } else {
        width
    }
}

fn render_diff_delta_column(diff_stat: &DiffStatSummary, width: usize) -> Vec<Span<'static>> {
    let mut spans = Vec::new();
    let add_text = diff_stat
        .additions
        .map(|add| format!("+{add}"))
        .unwrap_or_default();
    let del_text = diff_stat
        .deletions
        .map(|del| format!("-{del}"))
        .unwrap_or_default();
    if add_text.is_empty() && del_text.is_empty() {
        spans.push(Span::raw(" ".repeat(width)));
        return spans;
    }

    let gap = if !add_text.is_empty() && !del_text.is_empty() {
        " "
    } else {
        ""
    };
    let visible_width = add_text.len() + gap.len() + del_text.len();
    let padding = width.saturating_sub(visible_width);
    spans.push(Span::raw(" ".repeat(padding)));
    if !add_text.is_empty() {
        spans.push(Span::styled(add_text, Style::default().fg(ACTIVE)));
    }
    if !gap.is_empty() {
        spans.push(Span::raw(gap));
    }
    if !del_text.is_empty() {
        spans.push(Span::styled(del_text, Style::default().fg(STOPPED)));
    }
    spans
}

fn diff_stat_display_width(diff_stat: &DiffStatSummary) -> usize {
    let mut width = diff_stat.status.len();
    if let Some(add) = diff_stat.additions {
        width += 1 + format!("+{add}").len();
    }
    if let Some(del) = diff_stat.deletions {
        width += 1 + format!("-{del}").len();
    }
    width
}

fn change_color_from_status(status: &str) -> Color {
    match status {
        "D" => STOPPED,
        "A" => ACTIVE,
        "SUB" => Color::Rgb(111, 170, 189),
        "DIR" => Color::Rgb(126, 156, 181),
        _ => INFERRED,
    }
}

pub(super) fn shorten_path(path: &str, max_len: usize) -> String {
    if path.chars().count() <= max_len {
        return path.to_string();
    }
    let keep = max_len.saturating_sub(3);
    let tail = path
        .chars()
        .rev()
        .take(keep)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("...{tail}")
}

pub(super) fn compact_rel_path(path: &str, max_len: usize) -> String {
    if max_len == 0 {
        return String::new();
    }
    if path.chars().count() <= max_len {
        return path.to_string();
    }

    let normalized = path.trim_matches('/');
    let segments = normalized
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.is_empty() || segments.len() == 1 {
        return shorten_path(path, max_len);
    }

    let file_name = segments.last().copied().unwrap_or(path);
    if file_name.chars().count() + 4 >= max_len {
        if let Some(parent) = segments.get(segments.len().saturating_sub(2)).copied() {
            let prefix = format!(".../{parent}/");
            let remaining = max_len.saturating_sub(prefix.chars().count());
            if remaining >= 8 {
                return format!("{prefix}{}", shorten_path(file_name, remaining));
            }
        }
        return shorten_path(file_name, max_len);
    }

    let mut best = format!(".../{file_name}");

    let tail_limit = segments.len().saturating_sub(1);
    for keep_tail_count in 2..=tail_limit {
        let tail = segments[segments.len() - keep_tail_count..].join("/");
        let candidate = format!(".../{tail}");
        if candidate.chars().count() <= max_len {
            best = candidate;
        } else {
            break;
        }
    }

    let mut prefix = Vec::new();
    let head_limit = segments.len().saturating_sub(2);
    for segment in segments.iter().take(head_limit) {
        prefix.push(*segment);
        let candidate = format!("{}/{}", prefix.join("/"), best);
        if candidate.chars().count() <= max_len {
            best = candidate;
        } else {
            break;
        }
    }

    best
}

fn pad_right(value: &str, width: usize) -> String {
    format!("{value:<width$}")
}

fn pad_left(value: &str, width: usize) -> String {
    format!("{value:>width$}")
}

fn time_ago(timestamp_ms: i64) -> String {
    let delta = (chrono::Utc::now().timestamp_millis() - timestamp_ms).max(0) / 1000;
    if delta < 60 {
        "<1m".to_string()
    } else if delta < 3600 {
        format!("{}m", delta / 60)
    } else if delta < 86_400 {
        format!("{}h", delta / 3600)
    } else {
        format!("{}d", delta / 86_400)
    }
}

#[cfg(test)]
fn truncate_short(value: &str, max_len: usize) -> String {
    if value.chars().count() <= max_len {
        value.to_string()
    } else {
        let keep = max_len.saturating_sub(3);
        let truncated = value.chars().take(keep).collect::<String>();
        format!("{truncated}...")
    }
}

#[cfg(test)]
#[path = "render_tests.rs"]
mod tests;
