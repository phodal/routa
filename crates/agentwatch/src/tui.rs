use crate::ipc::RuntimeFeed;
use crate::models::{DEFAULT_INFERENCE_WINDOW_MS, DEFAULT_TUI_POLL_MS};
use crate::observe;
use crate::repo::RepoContext;
use crate::state::{DetailMode, EventLogFilter, FileListMode, FocusPane, RuntimeState, ThemeMode};
use anyhow::{Context, Result};
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::Color;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap};
use ratatui::{DefaultTerminal, Frame};
use std::io::stdout;
use std::path::Path;
use std::process::Command;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use syntect::easy::HighlightLines;
use syntect::highlighting::{Style as SyntectStyle, Theme, ThemeSet};
use syntect::parsing::SyntaxSet;
use syntect::util::LinesWithEndings;

static SYNTAX_SET: LazyLock<SyntaxSet> = LazyLock::new(SyntaxSet::load_defaults_newlines);
static LIGHT_THEME: LazyLock<Theme> = LazyLock::new(|| {
    let themes = ThemeSet::load_defaults();
    themes
        .themes
        .get("InspiredGitHub")
        .cloned()
        .or_else(|| themes.themes.values().next().cloned())
        .expect("at least one syntax theme")
});
static DARK_THEME: LazyLock<Theme> = LazyLock::new(|| {
    let themes = ThemeSet::load_defaults();
    themes
        .themes
        .get("base16-ocean.dark")
        .cloned()
        .or_else(|| themes.themes.get("base16-eighties.dark").cloned())
        .or_else(|| themes.themes.values().next().cloned())
        .expect("at least one syntax theme")
});

const BG: Color = Color::Rgb(15, 23, 30);
const SURFACE: Color = Color::Rgb(24, 33, 43);
const BORDER: Color = Color::Rgb(67, 84, 100);
const MUTED: Color = Color::Rgb(124, 141, 157);
const TEXT: Color = Color::Rgb(210, 220, 229);
const ACCENT: Color = Color::Rgb(126, 156, 181);
const ACTIVE: Color = Color::Rgb(102, 187, 106);
const INFERRED: Color = Color::Rgb(212, 181, 93);
const STOPPED: Color = Color::Rgb(201, 96, 87);
const IDLE: Color = Color::Rgb(122, 132, 143);

pub fn run(ctx: RepoContext, poll_interval_ms: u64) -> Result<()> {
    enable_raw_mode().context("enable raw mode")?;
    execute!(stdout(), EnterAlternateScreen).context("enter alternate screen")?;
    let mut terminal = ratatui::init();
    let result = run_loop(&mut terminal, ctx, poll_interval_ms.max(200));
    ratatui::restore();
    let _ = execute!(stdout(), LeaveAlternateScreen);
    let _ = disable_raw_mode();
    result
}

fn run_loop(terminal: &mut DefaultTerminal, ctx: RepoContext, poll_interval_ms: u64) -> Result<()> {
    let mut feed = RuntimeFeed::open(&ctx.runtime_event_path)?;
    let repo_root = ctx.repo_root.to_string_lossy().to_string();
    let repo_name = ctx
        .repo_root
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| repo_root.clone());
    let branch = current_branch(&ctx).unwrap_or_else(|_| "-".to_string());
    let mut state = RuntimeState::new(repo_root, repo_name, branch);
    let bootstrap_cutoff = chrono::Utc::now().timestamp_millis() - DEFAULT_INFERENCE_WINDOW_MS;
    for message in feed.read_recent_since(bootstrap_cutoff)? {
        state.apply_message(message);
    }
    let mut last_poll = Instant::now() - Duration::from_millis(poll_interval_ms);

    loop {
        if last_poll.elapsed() >= Duration::from_millis(poll_interval_ms) {
            let dirty = observe::scan_repo(&ctx)?;
            state.sync_dirty_files(dirty);
            last_poll = Instant::now();
        }

        for message in feed.read_new()? {
            state.apply_message(message);
        }

        terminal.draw(|frame| render(frame, &state, &feed))?;

        if event::poll(Duration::from_millis(100)).context("poll terminal events")? {
            if handle_event(&mut state, &ctx)? {
                break;
            }
        }
    }
    Ok(())
}

fn handle_event(state: &mut RuntimeState, ctx: &RepoContext) -> Result<bool> {
    match event::read().context("read terminal event")? {
        Event::Key(key) => match key.code {
            KeyCode::Char('q') => return Ok(true),
            KeyCode::Tab => state.cycle_focus(),
            KeyCode::Char('j') | KeyCode::Down => state.move_selection_down(),
            KeyCode::Char('k') | KeyCode::Up => state.move_selection_up(),
            KeyCode::Char('h') | KeyCode::Left => state.select_prev_file(),
            KeyCode::Char('l') | KeyCode::Right => state.select_next_file(),
            KeyCode::Enter => state.toggle_file_view(),
            KeyCode::Char('r') => state.toggle_follow_mode(),
            KeyCode::Char('s') => state.cycle_file_list_mode(),
            KeyCode::Char('d') | KeyCode::Char('D') => state.toggle_detail_mode(),
            KeyCode::Char('t') | KeyCode::Char('T') => state.toggle_theme_mode(),
            KeyCode::Char('1') => state.set_event_log_filter(EventLogFilter::All),
            KeyCode::Char('2') => state.set_event_log_filter(EventLogFilter::Hook),
            KeyCode::Char('3') => state.set_event_log_filter(EventLogFilter::Git),
            KeyCode::Char('4') => state.set_event_log_filter(EventLogFilter::Watch),
            KeyCode::Char('[') => jump_diff_hunk(state, ctx, false)?,
            KeyCode::Char(']') => jump_diff_hunk(state, ctx, true)?,
            KeyCode::PageDown => {
                for _ in 0..10 {
                    state.move_selection_down();
                }
            }
            KeyCode::PageUp => {
                for _ in 0..10 {
                    state.move_selection_up();
                }
            }
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                return Ok(true);
            }
            _ => {}
        },
        Event::Resize(_, _) => {}
        _ => {}
    }
    Ok(false)
}

fn render(frame: &mut Frame, state: &RuntimeState, feed: &RuntimeFeed) {
    frame.render_widget(Block::default().style(Style::default().bg(BG).fg(TEXT)), frame.area());
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(8),
            Constraint::Length(6),
            Constraint::Length(1),
        ])
        .split(frame.area());

    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(28),
            Constraint::Percentage(40),
            Constraint::Percentage(32),
        ])
        .split(outer[1]);

    render_title_bar(frame, outer[0], state);
    render_sessions(frame, columns[0], state);
    render_files(frame, columns[1], state);
    render_detail(frame, columns[2], state, feed);
    render_log(frame, outer[2], state);
    render_footer(frame, outer[3], state);
}

fn render_sessions(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let items: Vec<ListItem> = state
        .session_items()
        .iter()
        .enumerate()
        .map(|(idx, session)| {
            let model = session.model.clone().unwrap_or_else(|| "-".to_string());
            let selected = idx == state.selected_session;
            let badge = status_badge(&session.status);
            let pane = session.tmux_pane.clone().unwrap_or_else(|| "-".to_string());
            let primary = Line::from(vec![
                Span::styled(
                    shorten_path(&session.session_id, 12),
                    row_style(selected, state.focus == FocusPane::Sessions)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(" "),
                badge,
                Span::raw(" "),
                Span::styled(shorten_path(&model, 9), Style::default().fg(ACCENT)),
            ]);
            let secondary = Line::from(vec![
                Span::styled(format!("pane {pane}"), Style::default().fg(MUTED)),
                Span::raw("  "),
                Span::styled(
                    format!("{} ago", time_ago(session.last_seen_at_ms)),
                    Style::default().fg(MUTED),
                ),
                Span::raw("  "),
                Span::styled(
                    format!("{} files", session.touched_files.len()),
                    Style::default().fg(TEXT),
                ),
            ]);
            let lines = vec![primary, secondary];
            let mut item = ListItem::new(lines);
            if selected {
                item = item.style(row_style(selected, state.focus == FocusPane::Sessions));
            }
            item
        })
        .collect();

    let list = List::new(items).block(panel_block(
        "Sessions",
        state.focus == FocusPane::Sessions,
    ));
    frame.render_widget(list, area);
}

fn render_files(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let outer_block = panel_block("Files", state.focus == FocusPane::Files);
    let inner = outer_block.inner(area);
    frame.render_widget(outer_block, area);
    let split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1)])
        .split(inner);
    let tabs = render_file_mode_tabs(state);
    frame.render_widget(
        Paragraph::new(tabs)
            .style(Style::default().bg(SURFACE).fg(TEXT)),
        split[0],
    );
    let items: Vec<ListItem> = state
        .file_items()
        .iter()
        .enumerate()
        .map(|(idx, file)| {
            let selected = idx == state.selected_file;
            let primary = Line::from(vec![
                Span::styled(
                    shorten_path(&file.rel_path, 38),
                    row_style(selected, state.focus == FocusPane::Files)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(" "),
                confidence_badge(file.confidence.as_str()),
                Span::raw(" "),
                dirty_badge(file.dirty),
                if file.conflicted {
                    Span::styled(" !CONFLICT", Style::default().fg(STOPPED))
                } else {
                    Span::raw("")
                },
            ]);
            let secondary = Line::from(vec![
                Span::styled(file.state_code.clone(), Style::default().fg(MUTED)),
                Span::raw("  "),
                Span::styled(
                    time_label(file.last_modified_at_ms),
                    Style::default().fg(MUTED),
                ),
                Span::raw("  "),
                Span::styled(
                    file.last_session_id
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string()),
                    Style::default().fg(ACCENT),
                ),
            ]);
            let mut item = ListItem::new(vec![primary, secondary]);
            if selected {
                item = item.style(row_style(selected, state.focus == FocusPane::Files));
            }
            item
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .borders(Borders::TOP)
            .border_style(Style::default().fg(BORDER))
            .style(Style::default().bg(SURFACE)),
    );
    frame.render_widget(list, split[1]);
}

fn render_detail(
    frame: &mut Frame,
    area: ratatui::layout::Rect,
    state: &RuntimeState,
    _feed: &RuntimeFeed,
) {
    match state.detail_mode {
        DetailMode::File => {
            let sections = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Length(6), Constraint::Min(12)])
                .split(area);
            render_detail_summary(frame, sections[0], state);
            render_detail_body(frame, sections[1], state);
        }
        DetailMode::Diff => {
            let sections = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Length(6), Constraint::Length(6), Constraint::Min(10)])
                .split(area);
            render_detail_summary(frame, sections[0], state);
            render_recent_events(frame, sections[1], state);
            render_detail_body(frame, sections[2], state);
        }
        DetailMode::Summary => {
            let sections = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Length(7),
                    Constraint::Length(9),
                    Constraint::Min(8),
                ])
                .split(area);
            render_detail_summary(frame, sections[0], state);
            render_recent_events(frame, sections[1], state);
            render_detail_body(frame, sections[2], state);
        }
    }
}

fn render_detail_summary(frame: &mut Frame, area: Rect, state: &RuntimeState) {
    let mut lines = Vec::new();
    if let Some(file) = state.selected_file() {
        lines.push(Line::from(Span::styled(
            shorten_path(&file.rel_path, 32),
            Style::default().fg(TEXT).add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(vec![
            Span::styled("last by ", Style::default().fg(MUTED)),
            Span::styled(
                file.last_session_id
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()),
                Style::default().fg(ACCENT),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("modified ", Style::default().fg(MUTED)),
            Span::styled(time_label(file.last_modified_at_ms), Style::default().fg(TEXT)),
            Span::raw("  "),
            confidence_badge(file.confidence.as_str()),
        ]));
        lines.push(Line::from(vec![
            Span::styled("dirty ", Style::default().fg(MUTED)),
            dirty_badge(file.dirty),
            Span::raw("  "),
            if file.conflicted {
                Span::styled("conflicted", Style::default().fg(STOPPED))
            } else {
                Span::styled("single-owner", Style::default().fg(ACTIVE))
            },
        ]));
    } else {
        lines.push(Line::from(Span::styled(
            "No file selected",
            Style::default().fg(MUTED),
        )));
        if let Some(session_id) = state.selected_session_id() {
            lines.push(Line::from(vec![
                Span::styled("session ", Style::default().fg(MUTED)),
                Span::styled(session_id, Style::default().fg(ACCENT)),
            ]));
        }
    }

    let block = panel_block("Details", state.focus == FocusPane::Detail);
    frame.render_widget(
        Paragraph::new(lines)
            .block(block)
            .style(Style::default().bg(SURFACE).fg(TEXT))
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn render_recent_events(frame: &mut Frame, area: Rect, state: &RuntimeState) {
    let lines: Vec<Line> = state
        .selected_file()
        .map(|file| {
            let mut out = Vec::new();
            for event in file.recent_events.iter().take(6) {
                out.push(Line::from(vec![
                    Span::styled("• ", Style::default().fg(MUTED)),
                    Span::styled(event.clone(), Style::default().fg(TEXT)),
                ]));
            }
            if out.is_empty() {
                out.push(Line::from(Span::styled("no recent events", Style::default().fg(MUTED))));
            }
            out
        })
        .unwrap_or_else(|| vec![Line::from(Span::styled("select a file to inspect", Style::default().fg(MUTED)))]);
    frame.render_widget(
        Paragraph::new(lines)
            .block(panel_block("Recent Events", false))
            .style(Style::default().bg(SURFACE).fg(TEXT))
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn render_detail_body(frame: &mut Frame, area: Rect, state: &RuntimeState) {
    let title = match state.detail_mode {
        DetailMode::Summary => "Diff Summary",
        DetailMode::File => "File Preview",
        DetailMode::Diff => "Diff Summary",
    };
    let file_text = match state.detail_mode {
        DetailMode::File => state
            .selected_file()
            .map(|file| load_file_preview(&state.repo_root, file.rel_path.as_str()))
            .transpose()
            .unwrap_or_else(|err| Some(Some(format!("file preview failed: {err}"))))
            .flatten()
            .unwrap_or_else(|| "<no file content available>".to_string()),
        DetailMode::Summary | DetailMode::Diff => state
            .selected_file()
            .map(|file| {
                load_diff_text(
                    &state.repo_root,
                    file.rel_path.as_str(),
                    file.state_code.as_str(),
                )
            })
            .transpose()
            .unwrap_or_else(|err| Some(Some(format!("diff load failed: {err}"))))
            .flatten()
            .unwrap_or_else(|| "<no diff available>".to_string()),
    };
    let file_path = state.selected_file().map(|file| file.rel_path.as_str());
    let content = match state.detail_mode {
        DetailMode::File => highlight_code_text(file_path, &file_text, state.theme_mode),
        DetailMode::Summary | DetailMode::Diff => {
            let diff_slice = if state.detail_mode == DetailMode::Summary {
                file_text.lines().take(18).collect::<Vec<_>>().join("\n")
            } else {
                file_text
            };
            highlight_diff_text(file_path, &diff_slice, state.theme_mode)
        }
    };
    frame.render_widget(
        Paragraph::new(content)
            .block(panel_block(title, false))
            .style(Style::default().bg(SURFACE).fg(TEXT))
            .wrap(Wrap { trim: false })
            .scroll((state.detail_scroll, 0)),
        area,
    );
}

fn render_log(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let items: Vec<ListItem> = state
        .visible_event_log_items()
        .iter()
        .take(4)
        .map(|entry| {
            ListItem::new(Line::from(vec![
                Span::styled(format_ts(entry.observed_at_ms), Style::default().fg(MUTED)),
                Span::raw(" "),
                Span::styled(
                    format!("[{}]", entry.source.label()),
                    Style::default().fg(source_color(entry.source)),
                ),
                Span::raw(" "),
                Span::styled(entry.message.clone(), Style::default().fg(TEXT)),
            ]))
        })
        .collect();

    let list = List::new(items).block(
        panel_block(
            format!("Event Stream ({})", state.event_log_filter.label()),
            false,
        ),
    );
    frame.render_widget(Clear, area);
    frame.render_widget(list, area);
}

fn render_file_mode_tabs(state: &RuntimeState) -> Line<'static> {
    let modes = [
        FileListMode::BySession,
        FileListMode::Global,
        FileListMode::UnknownConflict,
    ];
    let mut spans = Vec::new();
    for (idx, mode) in modes.iter().enumerate() {
        if idx > 0 {
            spans.push(Span::raw("  "));
        }
        let style = if *mode == state.file_list_mode {
            Style::default().fg(TEXT).bg(BORDER).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(MUTED)
        };
        spans.push(Span::styled(format!(" {} ", mode.label()), style));
    }
    Line::from(spans)
}

fn render_footer(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let line = Line::from(vec![
        Span::styled("Tab", Style::default().fg(ACCENT)),
        Span::styled(" switch focus  ", Style::default().fg(MUTED)),
        Span::styled("↑↓", Style::default().fg(ACCENT)),
        Span::styled(" select  ", Style::default().fg(MUTED)),
        Span::styled("Enter", Style::default().fg(ACCENT)),
        Span::styled(" expand  ", Style::default().fg(MUTED)),
        Span::styled("/", Style::default().fg(ACCENT)),
        Span::styled(" search  ", Style::default().fg(MUTED)),
        Span::styled("r", Style::default().fg(ACCENT)),
        Span::styled(
            if state.follow_mode { " follow:on  " } else { " follow:off  " },
            Style::default().fg(MUTED),
        ),
        Span::styled("q", Style::default().fg(ACCENT)),
        Span::styled(" quit", Style::default().fg(MUTED)),
    ]);
    frame.render_widget(
        Paragraph::new(line).style(Style::default().bg(BG).fg(TEXT)),
        area,
    );
}

fn render_title_bar(frame: &mut Frame, area: Rect, state: &RuntimeState) {
    let line = Line::from(vec![
        Span::styled(" AgentWatch ", Style::default().fg(TEXT).bg(ACCENT).add_modifier(Modifier::BOLD)),
        Span::styled(
            format!("  repo:{}  branch:{}  ", state.repo_name, state.branch),
            Style::default().fg(TEXT).bg(SURFACE),
        ),
        Span::styled(
            if state.follow_mode { "WATCH" } else { "PAUSED" },
            Style::default()
                .fg(if state.follow_mode { ACTIVE } else { IDLE })
                .bg(SURFACE)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("  refreshed {} ago  ", time_ago(state.last_refresh_at_ms)),
            Style::default().fg(MUTED).bg(SURFACE),
        ),
    ]);
    frame.render_widget(Paragraph::new(line).style(Style::default().bg(SURFACE)), area);
}

fn panel_block<T: Into<ratatui::text::Line<'static>>>(title: T, focused: bool) -> Block<'static> {
    Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(panel_border_style(focused))
        .style(Style::default().bg(SURFACE).fg(TEXT))
}

fn panel_border_style(active: bool) -> Style {
    if active {
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(BORDER)
    }
}

fn row_style(selected: bool, focused: bool) -> Style {
    if selected {
        Style::default()
            .fg(TEXT)
            .bg(if focused { Color::Rgb(32, 44, 56) } else { Color::Rgb(27, 38, 49) })
    } else {
        Style::default().fg(TEXT).bg(SURFACE)
    }
}

fn format_ts(timestamp_ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(timestamp_ms)
        .map(|dt| dt.format("%H:%M:%S").to_string())
        .unwrap_or_else(|| "--:--:--".to_string())
}

fn time_ago(timestamp_ms: i64) -> String {
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

fn status_badge(status: &str) -> Span<'static> {
    let (label, color) = match status {
        "active" => (" ACTIVE ", ACTIVE),
        "stopped" => (" STOP ", STOPPED),
        "idle" => (" IDLE ", IDLE),
        _ => (" IDLE ", IDLE),
    };
    Span::styled(label, Style::default().fg(BG).bg(color).add_modifier(Modifier::BOLD))
}

fn confidence_badge(label: &str) -> Span<'static> {
    let (text, color) = match label {
        "exact" => (" EXACT ", ACTIVE),
        "inferred" => (" INFERRED ", INFERRED),
        _ => (" UNKNOWN ", IDLE),
    };
    Span::styled(text, Style::default().fg(BG).bg(color).add_modifier(Modifier::BOLD))
}

fn dirty_badge(dirty: bool) -> Span<'static> {
    if dirty {
        Span::styled(" DIRTY ", Style::default().fg(BG).bg(ACTIVE).add_modifier(Modifier::BOLD))
    } else {
        Span::styled(" CLEAN ", Style::default().fg(BG).bg(IDLE))
    }
}

fn source_color(source: crate::models::EventSource) -> Color {
    match source {
        crate::models::EventSource::Hook => ACCENT,
        crate::models::EventSource::Git => INFERRED,
        crate::models::EventSource::Watch => ACTIVE,
    }
}

fn current_branch(ctx: &RepoContext) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&ctx.repo_root)
        .arg("branch")
        .arg("--show-current")
        .output()
        .context("run git branch --show-current")?;
    if !output.status.success() {
        anyhow::bail!("git branch --show-current failed");
    }
    Ok(String::from_utf8(output.stdout)
        .context("decode branch output")?
        .trim()
        .to_string())
}

fn load_diff_text(repo_root: &str, rel_path: &str, state_code: &str) -> Result<Option<String>> {
    let path = Path::new(repo_root).join(rel_path);
    if state_code == "untracked" {
        if !path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(&path).context("read untracked file")?;
        let mut out = Vec::new();
        out.push(format!("+++ {}", rel_path));
        for line in content.lines().take(200) {
            out.push(format!("+{line}"));
        }
        return Ok(Some(out.join("\n")));
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("diff")
        .arg("--no-ext-diff")
        .arg("--no-color")
        .arg("--")
        .arg(rel_path)
        .output()
        .context("run git diff")?;

    if !output.status.success() {
        return Ok(None);
    }

    let text = String::from_utf8(output.stdout).context("decode git diff output")?;
    if text.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(text))
    }
}

fn load_file_preview(repo_root: &str, rel_path: &str) -> Result<Option<String>> {
    let path = Path::new(repo_root).join(rel_path);
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path).context("read file preview")?;
    let truncated = content.lines().take(400).collect::<Vec<_>>().join("\n");
    Ok(Some(truncated))
}

fn highlight_diff_text(file_path: Option<&str>, diff_text: &str, theme_mode: ThemeMode) -> Text<'static> {
    let syntax = file_path
        .and_then(|path| SYNTAX_SET.find_syntax_for_file(path).ok().flatten())
        .unwrap_or_else(|| SYNTAX_SET.find_syntax_plain_text());
    let mut highlighter = HighlightLines::new(syntax, syntax_theme(theme_mode));
    let mut lines = Vec::new();
    for raw in diff_text.lines() {
        let line = if raw.starts_with("+++") || raw.starts_with("---") {
            Line::from(Span::styled(
                raw.to_string(),
                Style::default().fg(Color::Yellow),
            ))
        } else if raw.starts_with("@@") {
            Line::from(Span::styled(
                raw.to_string(),
                Style::default().fg(Color::Cyan),
            ))
        } else if raw.starts_with('+') {
            build_diff_code_line('+', &raw[1..], Color::Green, &mut highlighter, theme_mode)
        } else if raw.starts_with('-') {
            build_diff_code_line('-', &raw[1..], Color::Red, &mut highlighter, theme_mode)
        } else if let Some(rest) = raw.strip_prefix(' ') {
            build_diff_code_line(' ', rest, Color::DarkGray, &mut highlighter, theme_mode)
        } else if raw.starts_with("diff --git") || raw.starts_with("index ") {
            Line::from(Span::styled(
                raw.to_string(),
                Style::default().fg(Color::DarkGray),
            ))
        } else {
            Line::from(raw.to_string())
        };
        lines.push(line);
    }
    Text::from(lines)
}

fn build_diff_code_line(
    prefix: char,
    code: &str,
    prefix_color: Color,
    highlighter: &mut HighlightLines<'_>,
    theme_mode: ThemeMode,
) -> Line<'static> {
    let mut spans = vec![Span::styled(
        prefix.to_string(),
        Style::default()
            .fg(prefix_color)
            .add_modifier(Modifier::BOLD),
    )];
    spans.extend(highlight_code_spans(code, highlighter, theme_mode));
    Line::from(spans)
}

fn highlight_code_text(file_path: Option<&str>, code: &str, theme_mode: ThemeMode) -> Text<'static> {
    let syntax = file_path
        .and_then(|path| SYNTAX_SET.find_syntax_for_file(path).ok().flatten())
        .unwrap_or_else(|| SYNTAX_SET.find_syntax_plain_text());
    let mut highlighter = HighlightLines::new(syntax, syntax_theme(theme_mode));
    let mut lines = Vec::new();
    for line in LinesWithEndings::from(code) {
        lines.push(Line::from(highlight_code_spans(
            line.trim_end_matches('\n'),
            &mut highlighter,
            theme_mode,
        )));
    }
    Text::from(lines)
}

fn highlight_code_spans(
    code: &str,
    highlighter: &mut HighlightLines<'_>,
    theme_mode: ThemeMode,
) -> Vec<Span<'static>> {
    match highlighter.highlight_line(code, &SYNTAX_SET) {
        Ok(regions) => regions
            .into_iter()
            .map(|(style, text)| {
                Span::styled(text.to_string(), syntect_to_ratatui(style, theme_mode))
            })
            .collect(),
        Err(_) => vec![Span::raw(code.to_string())],
    }
}

fn syntect_to_ratatui(style: SyntectStyle, theme_mode: ThemeMode) -> Style {
    let color = Color::Rgb(style.foreground.r, style.foreground.g, style.foreground.b);
    let color = match theme_mode {
        ThemeMode::Dark => normalize_dark_foreground(color),
        ThemeMode::Light => color,
    };
    Style::default().fg(color)
}

fn syntax_theme(theme_mode: ThemeMode) -> &'static Theme {
    match theme_mode {
        ThemeMode::Dark => &DARK_THEME,
        ThemeMode::Light => &LIGHT_THEME,
    }
}

fn normalize_dark_foreground(color: Color) -> Color {
    match color {
        Color::Rgb(r, g, b) => {
            let brightest = r.max(g).max(b);
            if brightest >= 95 {
                Color::Rgb(r, g, b)
            } else {
                let boost = 95u8.saturating_sub(brightest);
                Color::Rgb(
                    r.saturating_add(boost),
                    g.saturating_add(boost),
                    b.saturating_add(boost),
                )
            }
        }
        other => other,
    }
}

fn jump_diff_hunk(state: &mut RuntimeState, ctx: &RepoContext, forward: bool) -> Result<()> {
    let Some((rel_path, state_code)) = state
        .selected_file()
        .map(|file| (file.rel_path.clone(), file.state_code.clone()))
    else {
        return Ok(());
    };
    let diff_text = load_diff_text(&ctx.repo_root.to_string_lossy(), &rel_path, &state_code)?
        .unwrap_or_default();
    let hunks = diff_hunk_offsets(&diff_text);
    if hunks.is_empty() {
        return Ok(());
    }
    let current = state.detail_scroll as usize;
    let target = if forward {
        hunks.iter()
            .copied()
            .find(|offset| *offset > current)
            .unwrap_or(hunks[0])
    } else {
        hunks.iter()
            .copied()
            .rev()
            .find(|offset| *offset < current)
            .unwrap_or(*hunks.last().unwrap_or(&0))
    };
    state.detail_scroll = target.min(u16::MAX as usize) as u16;
    state
        .detail_scroll_cache
        .insert(rel_path, state.detail_scroll);
    Ok(())
}

fn diff_hunk_offsets(diff_text: &str) -> Vec<usize> {
    diff_text
        .lines()
        .enumerate()
        .filter_map(|(idx, line)| line.starts_with("@@").then_some(idx))
        .collect()
}

fn shorten_path(path: &str, max_len: usize) -> String {
    if path.len() <= max_len {
        return path.to_string();
    }
    let keep = max_len.saturating_sub(3);
    format!("...{}", &path[path.len().saturating_sub(keep)..])
}

#[allow(dead_code)]
pub fn default_poll_ms() -> u64 {
    DEFAULT_TUI_POLL_MS
}
