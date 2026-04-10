use super::*;
use crate::state::{FileListMode, FocusPane};
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap};
use std::path::Path;

#[derive(Clone, Copy)]
pub(super) struct UiPalette {
    bg: Color,
    surface: Color,
    border: Color,
    text: Color,
    muted: Color,
    accent: Color,
    selection_focus: Color,
    selection_blur: Color,
}

pub(super) fn palette(theme_mode: ThemeMode) -> UiPalette {
    match theme_mode {
        ThemeMode::Dark => UiPalette {
            bg: Color::Rgb(12, 19, 26),
            surface: Color::Rgb(21, 30, 39),
            border: Color::Rgb(69, 86, 104),
            text: Color::Rgb(219, 228, 236),
            muted: Color::Rgb(132, 149, 164),
            accent: Color::Rgb(157, 189, 213),
            selection_focus: Color::Rgb(73, 98, 122),
            selection_blur: Color::Rgb(45, 61, 78),
        },
        ThemeMode::Light => UiPalette {
            bg: Color::Rgb(238, 242, 246),
            surface: Color::Rgb(248, 250, 252),
            border: Color::Rgb(145, 161, 176),
            text: Color::Rgb(35, 50, 64),
            muted: Color::Rgb(101, 118, 135),
            accent: Color::Rgb(90, 126, 156),
            selection_focus: Color::Rgb(214, 225, 235),
            selection_blur: Color::Rgb(226, 234, 241),
        },
    }
}

pub(super) fn render(
    frame: &mut Frame,
    state: &RuntimeState,
    _feed: &RuntimeFeed,
    cache: &AppCache,
) {
    let colors = palette(state.theme_mode);
    frame.render_widget(
        Block::default().style(Style::default().bg(colors.bg).fg(colors.text)),
        frame.area(),
    );
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(8),
            Constraint::Length(5),
            Constraint::Length(1),
        ])
        .split(frame.area());

    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(28),
            Constraint::Percentage(34),
            Constraint::Percentage(38),
        ])
        .split(outer[1]);
    let center = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(62), Constraint::Percentage(38)])
        .split(columns[1]);

    render_title_bar(frame, outer[0], state);
    render_sessions(frame, columns[0], state);
    render_files(frame, center[0], state, cache);
    render_details_panel(frame, center[1], state, cache);
    render_preview_panel(frame, columns[2], state, cache);
    render_log(frame, outer[2], state);
    render_footer(frame, outer[3], state);
}

fn render_sessions(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let outer_block = panel_block("Sessions", state.focus == FocusPane::Sessions, colors);
    let inner = outer_block.inner(area);
    frame.render_widget(outer_block, area);
    let split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(6), Constraint::Length(5)])
        .split(inner);
    let items: Vec<ListItem> = state
        .session_items()
        .iter()
        .enumerate()
        .map(|(idx, session)| {
            let selected = idx == state.selected_session;
            let pane = session
                .tmux_pane
                .clone()
                .unwrap_or_else(|| if session.is_unknown_bucket { "?" } else { "-" }.to_string());
            let marker = if selected { ">" } else { " " };
            let primary = Line::from(vec![
                Span::styled(
                    format!("{marker} {}", shorten_path(&session.display_name, 22)),
                    row_style(selected, state.focus == FocusPane::Sessions, colors)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(" "),
                status_badge(&session.status),
            ]);
            let secondary = Line::from(vec![
                Span::styled(
                    if session.is_unknown_bucket {
                        "watch-only owner".to_string()
                    } else {
                        shorten_path(session.model.as_deref().unwrap_or("-"), 12)
                    },
                    Style::default().fg(colors.accent),
                ),
                Span::raw("  "),
                Span::styled(format!("pane {pane}"), Style::default().fg(colors.muted)),
                Span::raw("  "),
                Span::styled(
                    format!("{} ago", time_ago(session.last_seen_at_ms)),
                    Style::default().fg(colors.muted),
                ),
            ]);
            let tertiary = Line::from(vec![
                Span::styled(
                    format!("{} files", session.touched_files_count),
                    Style::default().fg(colors.text),
                ),
                Span::raw("  "),
                Span::styled(
                    format!(
                        "E:{} I:{} U:{}",
                        session.exact_count, session.inferred_count, session.unknown_count
                    ),
                    Style::default().fg(if session.unknown_count > 0 {
                        INFERRED
                    } else {
                        colors.muted
                    }),
                ),
            ]);
            let mut lines = vec![primary, secondary, tertiary];
            if let Some(agent_summary) = session.agent_summary.as_deref() {
                lines.push(Line::from(vec![
                    Span::styled("  ", Style::default()),
                    Span::styled(
                        agent_summary.to_string(),
                        Style::default().fg(colors.accent),
                    ),
                ]));
            }
            let mut item = ListItem::new(lines);
            if selected {
                item = item.style(row_style(
                    selected,
                    state.focus == FocusPane::Sessions,
                    colors,
                ));
            }
            item
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .borders(Borders::BOTTOM)
            .border_style(Style::default().fg(colors.border))
            .style(Style::default().bg(colors.surface)),
    );
    frame.render_widget(list, split[0]);

    let agent_lines = render_agent_lines(state, colors);
    frame.render_widget(
        Paragraph::new(agent_lines)
            .block(
                Block::default()
                    .title("Agents")
                    .borders(Borders::NONE)
                    .style(Style::default().bg(colors.surface).fg(colors.text)),
            )
            .style(Style::default().bg(colors.surface).fg(colors.text))
            .wrap(Wrap { trim: true }),
        split[1],
    );
}

fn render_files(
    frame: &mut Frame,
    area: ratatui::layout::Rect,
    state: &RuntimeState,
    cache: &AppCache,
) {
    let colors = palette(state.theme_mode);
    let outer_block = panel_block("Files", state.focus == FocusPane::Files, colors);
    let inner = outer_block.inner(area);
    frame.render_widget(outer_block, area);
    let split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Min(1),
        ])
        .split(inner);
    let tabs = render_file_mode_tabs(state, split[0].width);
    frame.render_widget(
        Paragraph::new(tabs).style(Style::default().bg(colors.surface).fg(colors.text)),
        split[0],
    );
    frame.render_widget(
        Paragraph::new(render_file_summary_line(state, colors))
            .style(Style::default().bg(colors.surface).fg(colors.muted)),
        split[1],
    );
    let items: Vec<ListItem> = state
        .file_items()
        .iter()
        .enumerate()
        .map(|(idx, file)| {
            let selected = idx == state.selected_file;
            let diff_stat = cache
                .diff_stat(file)
                .cloned()
                .unwrap_or_else(|| DiffStatSummary {
                    status: short_state_code(&file.state_code).to_string(),
                    additions: None,
                    deletions: None,
                });
            let (file_name, parent_dir) = split_display_path(&file.rel_path);
            let primary = Line::from(vec![Span::styled(
                format!(
                    "{} {}",
                    if selected { ">" } else { " " },
                    shorten_path(&file_name, 34)
                ),
                row_style(selected, state.focus == FocusPane::Files, colors)
                    .add_modifier(Modifier::BOLD),
            )]);
            let secondary = Line::from(Span::styled(
                format!("  {}", shorten_path(&parent_dir, 38)),
                Style::default().fg(colors.muted),
            ));
            let tertiary = render_file_secondary_line(file, &diff_stat, colors);
            let mut item = ListItem::new(vec![primary, secondary, tertiary]);
            if selected {
                item = item.style(row_style(selected, state.focus == FocusPane::Files, colors));
            }
            item
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .borders(Borders::TOP)
            .border_style(Style::default().fg(colors.border))
            .style(Style::default().bg(colors.surface)),
    );
    frame.render_widget(list, split[2]);
}

fn render_details_panel(frame: &mut Frame, area: Rect, state: &RuntimeState, cache: &AppCache) {
    let colors = palette(state.theme_mode);
    let mut lines = Vec::new();
    if let Some(file) = state.selected_file() {
        let facts = cache.file_facts(file);
        let (file_name, parent_dir) = split_display_path(&file.rel_path);
        let owner = file
            .last_session_id
            .as_deref()
            .and_then(|session_id| state.sessions.get(session_id))
            .map(session_display_label)
            .unwrap_or_else(|| "unknown".to_string());
        lines.push(Line::from(Span::styled(
            shorten_path(&file_name, 28),
            Style::default()
                .fg(colors.text)
                .add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(Span::styled(
            shorten_path(&parent_dir, 30),
            Style::default().fg(colors.muted),
        )));
        lines.push(Line::from(vec![
            Span::styled("Last by: ", Style::default().fg(colors.muted)),
            Span::styled(owner, Style::default().fg(colors.accent)),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Modified: ", Style::default().fg(colors.muted)),
            Span::styled(
                time_label(file.last_modified_at_ms),
                Style::default().fg(colors.text),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("State: ", Style::default().fg(colors.muted)),
            Span::styled(
                if file.dirty { "dirty" } else { "clean" },
                Style::default().fg(if file.dirty { ACTIVE } else { IDLE }),
            ),
            Span::raw("  "),
            Span::styled("Confidence: ", Style::default().fg(colors.muted)),
            Span::styled(
                confidence_summary_label(file),
                Style::default().fg(confidence_text_color(file.confidence.as_str())),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Lines: ", Style::default().fg(colors.muted)),
            Span::styled(
                facts
                    .map(|facts| facts.line_count.to_string())
                    .unwrap_or_else(|| "...".to_string()),
                Style::default().fg(colors.text),
            ),
            Span::raw("  "),
            Span::styled("Size: ", Style::default().fg(colors.muted)),
            Span::styled(
                facts
                    .map(|facts| format_bytes(facts.byte_size))
                    .unwrap_or_else(|| "...".to_string()),
                Style::default().fg(colors.text),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Created: ", Style::default().fg(colors.muted)),
            Span::styled(
                facts
                    .map(|facts| facts.created_at.clone())
                    .unwrap_or_else(|| "loading".to_string()),
                Style::default().fg(colors.text),
            ),
            Span::raw("  "),
            Span::styled("Git changes: ", Style::default().fg(colors.muted)),
            Span::styled(
                facts
                    .map(|facts| facts.git_change_count.to_string())
                    .unwrap_or_else(|| "...".to_string()),
                Style::default().fg(colors.text),
            ),
        ]));
        lines.push(Line::from(Span::styled(
            "Why",
            Style::default()
                .fg(colors.accent)
                .add_modifier(Modifier::BOLD),
        )));
        for reason in attribution_reason_lines(state, file).into_iter().take(3) {
            lines.push(Line::from(vec![
                Span::styled("- ", Style::default().fg(colors.muted)),
                Span::styled(reason, Style::default().fg(colors.text)),
            ]));
        }
        let candidates = attribution_candidate_lines(state, file);
        if !candidates.is_empty() {
            lines.push(Line::from(Span::styled(
                "Candidates",
                Style::default()
                    .fg(colors.accent)
                    .add_modifier(Modifier::BOLD),
            )));
            for candidate in candidates.into_iter().take(3) {
                lines.push(Line::from(vec![
                    Span::styled("- ", Style::default().fg(colors.muted)),
                    Span::styled(candidate, Style::default().fg(colors.text)),
                ]));
            }
        }
    } else {
        lines.push(Line::from(Span::styled(
            "No file selected",
            Style::default().fg(colors.muted),
        )));
        if let Some(session_id) = state.selected_session_id() {
            lines.push(Line::from(vec![
                Span::styled("Session: ", Style::default().fg(colors.muted)),
                Span::styled(session_id, Style::default().fg(colors.accent)),
            ]));
        }
    }

    let block = panel_block("Details", false, colors);
    frame.render_widget(
        Paragraph::new(lines)
            .block(block)
            .style(Style::default().bg(colors.surface).fg(colors.text))
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn render_preview_panel(frame: &mut Frame, area: Rect, state: &RuntimeState, cache: &AppCache) {
    let colors = palette(state.theme_mode);
    let title = match state.detail_mode {
        DetailMode::File => "File Preview",
        DetailMode::Diff => "Diff Preview",
    };
    let file_text = match state.detail_mode {
        DetailMode::File => state
            .selected_file()
            .and_then(|file| {
                cache
                    .detail_text(file, DetailMode::File)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "<loading file preview...>".to_string()),
        DetailMode::Diff => state
            .selected_file()
            .and_then(|file| {
                cache
                    .detail_text(file, DetailMode::Diff)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "<loading diff...>".to_string()),
    };
    let file_path = state.selected_file().map(|file| file.rel_path.as_str());
    let content = match state.detail_mode {
        DetailMode::File => highlight_code_text(file_path, &file_text, state.theme_mode),
        DetailMode::Diff => highlight_diff_text(file_path, &file_text, state.theme_mode),
    };
    frame.render_widget(
        Paragraph::new(content)
            .block(panel_block(title, state.focus == FocusPane::Detail, colors))
            .style(Style::default().bg(colors.surface).fg(colors.text))
            .wrap(Wrap { trim: false })
            .scroll((state.detail_scroll, 0)),
        area,
    );
}

fn render_log(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let items: Vec<ListItem> = state
        .visible_event_log_items()
        .iter()
        .take(3)
        .map(|entry| ListItem::new(render_event_line(entry, colors)))
        .collect();

    let list = List::new(items).block(panel_block(
        format!("Event Stream ({})", state.event_log_filter.label()),
        false,
        colors,
    ));
    frame.render_widget(Clear, area);
    frame.render_widget(list, area);
}

fn render_file_mode_tabs(state: &RuntimeState, width: u16) -> Line<'static> {
    let colors = palette(state.theme_mode);
    let modes = [
        FileListMode::BySession,
        FileListMode::Global,
        FileListMode::UnknownConflict,
    ];
    let mut spans = Vec::new();
    let compact = width < 34;
    for (idx, mode) in modes.iter().enumerate() {
        if idx > 0 {
            spans.push(Span::raw("  "));
        }
        let label = match (mode, compact) {
            (FileListMode::BySession, false) => " BY SESSION ",
            (FileListMode::BySession, true) => " SESSION ",
            (FileListMode::Global, _) => " GLOBAL ",
            (FileListMode::UnknownConflict, false) => " REVIEW UNKNOWN ",
            (FileListMode::UnknownConflict, true) => " UNKNOWN ",
        };
        let style = if *mode == state.file_list_mode {
            Style::default()
                .fg(colors.text)
                .bg(colors.border)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(colors.muted)
        };
        spans.push(Span::styled(label, style));
    }
    Line::from(spans)
}

fn render_footer(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let line = Line::from(vec![
        Span::styled("Tab", Style::default().fg(colors.accent)),
        Span::styled(" focus  ", Style::default().fg(colors.muted)),
        Span::styled("↑↓", Style::default().fg(colors.accent)),
        Span::styled(" select  ", Style::default().fg(colors.muted)),
        Span::styled("Enter", Style::default().fg(colors.accent)),
        Span::styled(" preview  ", Style::default().fg(colors.muted)),
        Span::styled("D", Style::default().fg(colors.accent)),
        Span::styled(" diff  ", Style::default().fg(colors.muted)),
        Span::styled("/", Style::default().fg(colors.accent)),
        Span::styled(
            if state.search_query.is_empty() {
                " search  "
            } else {
                " search:on  "
            },
            Style::default().fg(colors.muted),
        ),
        Span::styled("u", Style::default().fg(colors.accent)),
        Span::styled(" unknown  ", Style::default().fg(colors.muted)),
        Span::styled("a", Style::default().fg(colors.accent)),
        Span::styled(" assign  ", Style::default().fg(colors.muted)),
        Span::styled("o", Style::default().fg(colors.accent)),
        Span::styled(" open  ", Style::default().fg(colors.muted)),
        Span::styled("g", Style::default().fg(colors.accent)),
        Span::styled(" git diff  ", Style::default().fg(colors.muted)),
        Span::styled("PgUp/PgDn", Style::default().fg(colors.accent)),
        Span::styled(" scroll  ", Style::default().fg(colors.muted)),
        Span::styled("f", Style::default().fg(colors.accent)),
        Span::styled(
            if state.follow_mode {
                " follow:on  "
            } else {
                " follow:off  "
            },
            Style::default().fg(colors.muted),
        ),
        Span::styled("T", Style::default().fg(colors.accent)),
        Span::styled(" theme  ", Style::default().fg(colors.muted)),
        Span::styled("Esc", Style::default().fg(colors.accent)),
        Span::styled(" clear  ", Style::default().fg(colors.muted)),
        Span::styled("q", Style::default().fg(colors.accent)),
        Span::styled(" quit", Style::default().fg(colors.muted)),
    ]);
    frame.render_widget(
        Paragraph::new(line).style(Style::default().bg(colors.bg).fg(colors.text)),
        area,
    );
}

fn render_agent_lines(state: &RuntimeState, colors: UiPalette) -> Vec<Line<'static>> {
    let unmatched = state.unmatched_agents();
    if unmatched.is_empty() {
        if state.detected_agents.is_empty() {
            return vec![Line::from(Span::styled(
                "no repo-local agents detected",
                Style::default().fg(colors.muted),
            ))];
        }
        return vec![Line::from(Span::styled(
            "all repo-local agents matched to sessions",
            Style::default().fg(colors.muted),
        ))];
    }

    unmatched
        .iter()
        .take(3)
        .map(|agent| {
            let cwd = agent
                .cwd
                .as_deref()
                .map(short_cwd_label)
                .unwrap_or_else(|| "-".to_string());
            Line::from(vec![
                Span::styled(
                    agent.vendor.to_ascii_uppercase(),
                    Style::default().fg(colors.accent),
                ),
                Span::raw(" "),
                Span::styled(format!("#{}", agent.pid), Style::default().fg(colors.text)),
                Span::raw(" "),
                Span::styled(cwd, Style::default().fg(colors.muted)),
                Span::raw(" "),
                Span::styled(
                    shorten_path(agent.command.trim(), 16),
                    Style::default().fg(colors.muted),
                ),
            ])
        })
        .collect()
}

fn short_cwd_label(cwd: &str) -> String {
    Path::new(cwd)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| cwd.to_string())
}

fn render_title_bar(frame: &mut Frame, area: Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let search = if state.search_query.is_empty() {
        String::new()
    } else if state.search_active {
        format!("  search:/{}_", state.search_query)
    } else {
        format!("  search:/{}", state.search_query)
    };
    let dirty = state.file_items().len();
    let unknown = state
        .file_items()
        .into_iter()
        .filter(|file| {
            file.conflicted
                || matches!(
                    file.confidence,
                    crate::models::AttributionConfidence::Unknown
                )
                || file.last_session_id.is_none()
        })
        .count();
    let line = Line::from(vec![
        Span::styled(
            " AgentWatch ",
            Style::default()
                .fg(colors.text)
                .bg(colors.accent)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("  repo:{}  branch:{}  ", state.repo_name, state.branch),
            Style::default().fg(colors.text).bg(colors.surface),
        ),
        Span::styled(
            format!(
                "  {} · {}  ",
                current_view_label(state),
                if state.follow_mode {
                    "FOLLOW ON"
                } else {
                    "FOLLOW OFF"
                }
            ),
            Style::default()
                .fg(colors.accent)
                .bg(colors.surface)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("rpc:{}  ", state.runtime_transport),
            Style::default().fg(colors.accent).bg(colors.surface),
        ),
        Span::styled(
            format!("dirty:{}  unknown:{}  ", dirty, unknown),
            Style::default().fg(colors.text).bg(colors.surface),
        ),
        Span::styled(
            format!("synced {} ago  ", time_ago(state.last_refresh_at_ms)),
            Style::default().fg(colors.muted).bg(colors.surface),
        ),
        Span::styled(search, Style::default().fg(colors.muted).bg(colors.surface)),
    ]);
    frame.render_widget(
        Paragraph::new(line).style(Style::default().bg(colors.surface)),
        area,
    );
}

fn panel_block<T: Into<ratatui::text::Line<'static>>>(
    title: T,
    focused: bool,
    colors: UiPalette,
) -> Block<'static> {
    Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(panel_border_style(focused, colors))
        .style(Style::default().bg(colors.surface).fg(colors.text))
}

fn panel_border_style(active: bool, colors: UiPalette) -> Style {
    if active {
        Style::default()
            .fg(colors.accent)
            .bg(colors.surface)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(colors.border)
    }
}

fn row_style(selected: bool, focused: bool, colors: UiPalette) -> Style {
    if selected {
        Style::default()
            .fg(colors.text)
            .bg(if focused {
                colors.selection_focus
            } else {
                colors.selection_blur
            })
            .add_modifier(if focused {
                Modifier::BOLD
            } else {
                Modifier::empty()
            })
    } else {
        Style::default().fg(colors.text).bg(colors.surface)
    }
}

fn format_ts(timestamp_ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(timestamp_ms)
        .map(|dt| dt.format("%H:%M:%S").to_string())
        .unwrap_or_else(|| "--:--:--".to_string())
}

pub(super) fn time_ago(timestamp_ms: i64) -> String {
    let delta = (chrono::Utc::now().timestamp_millis() - timestamp_ms).max(0) / 1000;
    if delta < 60 {
        format!("{delta}s")
    } else if delta < 3600 {
        format!("{}m", delta / 60)
    } else if delta < 86_400 {
        format!("{}h", delta / 3600)
    } else {
        format!("{}d", delta / 86_400)
    }
}

fn time_label(timestamp_ms: i64) -> String {
    format!("{} ({})", format_ts(timestamp_ms), time_ago(timestamp_ms))
}

fn format_bytes(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{bytes} B")
    }
}

fn render_file_secondary_line(
    file: &crate::models::FileView,
    diff_stat: &DiffStatSummary,
    colors: UiPalette,
) -> Line<'static> {
    let age = pad_left(&time_ago(file.last_modified_at_ms), 5);
    let attribution = pad_right(&confidence_short_label(file), 9);
    let mut spans = render_diff_stat_spans(diff_stat);
    spans.push(Span::raw(" "));
    spans.push(Span::styled(age, Style::default().fg(colors.muted)));
    spans.push(Span::raw("  "));
    spans.push(Span::styled(
        attribution,
        Style::default().fg(confidence_text_color(file.confidence.as_str())),
    ));
    if file.conflicted {
        spans.push(Span::raw("  "));
        spans.push(Span::styled("CONFLICT", Style::default().fg(STOPPED)));
    }
    Line::from(spans)
}

fn render_file_summary_line(state: &RuntimeState, colors: UiPalette) -> Line<'static> {
    let files = state.file_items();
    let modified = files
        .iter()
        .filter(|file| short_state_code(&file.state_code) == "M")
        .count();
    let deleted = files
        .iter()
        .filter(|file| short_state_code(&file.state_code) == "D")
        .count();
    let exact = files
        .iter()
        .filter(|file| matches!(file.confidence, crate::models::AttributionConfidence::Exact))
        .count();
    let inferred = files
        .iter()
        .filter(|file| {
            matches!(
                file.confidence,
                crate::models::AttributionConfidence::Inferred
            )
        })
        .count();
    let unknown = files.len().saturating_sub(exact + inferred);
    Line::from(vec![
        Span::styled(
            format!("{} files", files.len()),
            Style::default().fg(colors.text),
        ),
        Span::styled(
            format!("  M:{} D:{}  ", modified, deleted),
            Style::default().fg(colors.muted),
        ),
        Span::styled(format!("E:{exact} "), Style::default().fg(ACTIVE)),
        Span::styled(format!("I:{inferred} "), Style::default().fg(INFERRED)),
        Span::styled(format!("U:{unknown}"), Style::default().fg(IDLE)),
    ])
}

fn render_event_line(entry: &crate::models::EventLogEntry, colors: UiPalette) -> Line<'static> {
    let (action, subject) = split_event_message(&entry.message);
    Line::from(vec![
        Span::styled(
            format_ts(entry.observed_at_ms),
            Style::default().fg(colors.muted),
        ),
        Span::raw("  "),
        Span::styled(
            pad_right(&entry.source.label().to_ascii_uppercase(), 6),
            Style::default()
                .fg(source_color(entry.source))
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" "),
        Span::styled(pad_right(&action, 8), Style::default().fg(colors.accent)),
        Span::raw(" "),
        Span::styled(subject, Style::default().fg(colors.text)),
    ])
}

fn split_event_message(message: &str) -> (String, String) {
    let mut parts = message.split_whitespace();
    let first = parts.next().unwrap_or("-");
    let second = parts.next().unwrap_or("-");
    let rest = parts.collect::<Vec<_>>().join(" ");
    if first == "watch" || first == "git" {
        (second.to_string(), rest)
    } else {
        (
            first.to_string(),
            [second, rest.as_str()].join(" ").trim().to_string(),
        )
    }
}

fn current_view_label(state: &RuntimeState) -> &'static str {
    match state.file_list_mode {
        FileListMode::BySession => "SESSION VIEW",
        FileListMode::Global => "GLOBAL VIEW",
        FileListMode::UnknownConflict => "REVIEW UNKNOWN",
    }
}

fn confidence_short_label(file: &crate::models::FileView) -> String {
    if file.conflicted {
        "CONFLICT".to_string()
    } else {
        file.confidence.as_str().to_ascii_uppercase()
    }
}

fn confidence_summary_label(file: &crate::models::FileView) -> &'static str {
    if file.conflicted {
        "low"
    } else {
        match file.confidence {
            crate::models::AttributionConfidence::Exact => "high",
            crate::models::AttributionConfidence::Inferred => "medium",
            crate::models::AttributionConfidence::Unknown => "low",
        }
    }
}

fn attribution_reason_lines(state: &RuntimeState, file: &crate::models::FileView) -> Vec<String> {
    if file.conflicted {
        return vec![
            "multiple sessions touched this file".to_string(),
            format!("{} candidate owners observed", file.touched_by.len()),
        ];
    }
    match file.confidence {
        crate::models::AttributionConfidence::Exact => vec![
            "matched a hook event with concrete file paths".to_string(),
            "session and file write aligned directly".to_string(),
        ],
        crate::models::AttributionConfidence::Inferred => vec![
            "watcher saw the change before a direct file hook".to_string(),
            "single active session existed inside the inference window".to_string(),
        ],
        crate::models::AttributionConfidence::Unknown => {
            let active_sessions = state
                .sessions
                .values()
                .filter(|session| session.status == "active")
                .count();
            let mut lines = vec!["watcher detected the file change only".to_string()];
            if active_sessions == 0 {
                lines.push("no active session hook matched in the window".to_string());
            } else if active_sessions > 1 {
                lines.push(format!(
                    "{active_sessions} active sessions overlapped the window"
                ));
            } else {
                lines.push("no concrete file-level hook matched the change".to_string());
            }
            lines
        }
    }
}

fn attribution_candidate_lines(
    state: &RuntimeState,
    file: &crate::models::FileView,
) -> Vec<String> {
    let parent_dir = Path::new(&file.rel_path)
        .parent()
        .map(|parent| parent.to_string_lossy().to_string());
    let mut candidates: Vec<_> = state
        .sessions
        .values()
        .filter(|session| session.status != "stopped")
        .map(|session| {
            let same_dir_count = parent_dir
                .as_deref()
                .map(|dir| {
                    session
                        .touched_files
                        .iter()
                        .filter(|path| path.starts_with(dir))
                        .count()
                })
                .unwrap_or(0);
            ((same_dir_count, session.last_seen_at_ms), session)
        })
        .collect();
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates
        .into_iter()
        .take(3)
        .map(|((same_dir_count, _), session)| {
            if same_dir_count > 0 {
                format!(
                    "{} · {} ago · {} same-dir",
                    session_display_label(session),
                    time_ago(session.last_seen_at_ms),
                    same_dir_count
                )
            } else {
                format!(
                    "{} · {} ago · {} files",
                    session_display_label(session),
                    time_ago(session.last_seen_at_ms),
                    session.touched_files.len()
                )
            }
        })
        .collect()
}

fn split_display_path(path: &str) -> (String, String) {
    let path = Path::new(path);
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
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

fn session_display_label(session: &crate::models::SessionView) -> String {
    session
        .display_name
        .clone()
        .unwrap_or_else(|| shorten_path(&session.session_id, 14))
}

fn pad_right(value: &str, width: usize) -> String {
    format!("{value:<width$}")
}

fn pad_left(value: &str, width: usize) -> String {
    format!("{value:>width$}")
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
        _ => INFERRED,
    }
}

fn confidence_text_color(label: &str) -> Color {
    match label {
        "exact" => ACTIVE,
        "inferred" => INFERRED,
        _ => IDLE,
    }
}

fn status_badge(status: &str) -> Span<'static> {
    let (label, color) = match status {
        "active" => (" ACTIVE ", ACTIVE),
        "stopped" => (" STOP ", STOPPED),
        "unknown" => (" UNKNOWN ", IDLE),
        "idle" => (" IDLE ", IDLE),
        _ => (" IDLE ", IDLE),
    };
    Span::styled(
        label,
        Style::default()
            .fg(Color::Rgb(18, 22, 28))
            .bg(color)
            .add_modifier(Modifier::BOLD),
    )
}

fn source_color(source: crate::models::EventSource) -> Color {
    match source {
        crate::models::EventSource::Hook => Color::Rgb(126, 156, 181),
        crate::models::EventSource::Git => INFERRED,
        crate::models::EventSource::Watch => ACTIVE,
        crate::models::EventSource::Attribution => Color::Rgb(188, 162, 104),
    }
}

fn shorten_path(path: &str, max_len: usize) -> String {
    if path.len() <= max_len {
        return path.to_string();
    }
    let keep = max_len.saturating_sub(3);
    format!("...{}", &path[path.len().saturating_sub(keep)..])
}
