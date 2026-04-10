use crate::ipc::{RuntimeFeed, RuntimeSocket};
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

const ACTIVE: Color = Color::Rgb(102, 187, 106);
const INFERRED: Color = Color::Rgb(212, 181, 93);
const STOPPED: Color = Color::Rgb(201, 96, 87);
const IDLE: Color = Color::Rgb(122, 132, 143);

#[derive(Clone, Copy)]
struct UiPalette {
    bg: Color,
    surface: Color,
    border: Color,
    text: Color,
    muted: Color,
    accent: Color,
    selection_focus: Color,
    selection_blur: Color,
}

fn palette(theme_mode: ThemeMode) -> UiPalette {
    match theme_mode {
        ThemeMode::Dark => UiPalette {
            bg: Color::Rgb(15, 23, 30),
            surface: Color::Rgb(24, 33, 43),
            border: Color::Rgb(67, 84, 100),
            text: Color::Rgb(210, 220, 229),
            muted: Color::Rgb(124, 141, 157),
            accent: Color::Rgb(126, 156, 181),
            selection_focus: Color::Rgb(32, 44, 56),
            selection_blur: Color::Rgb(27, 38, 49),
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
    let runtime_socket = match RuntimeSocket::bind(&ctx.runtime_socket_path) {
        Ok(socket) => Some(socket),
        Err(err) => {
            eprintln!(
                "agentwatch warning: runtime socket disabled, falling back to feed-only mode: {err}"
            );
            None
        }
    };
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
        if let Some(socket) = &runtime_socket {
            for message in socket.read_pending()? {
                state.apply_message(message);
            }
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
            Constraint::Percentage(27),
            Constraint::Percentage(39),
            Constraint::Percentage(34),
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
    let colors = palette(state.theme_mode);
    let items: Vec<ListItem> = state
        .session_items()
        .iter()
        .enumerate()
        .map(|(idx, session)| {
            let model = session.model.clone().unwrap_or_else(|| "-".to_string());
            let selected = idx == state.selected_session;
            let badge = status_badge(&session.status);
            let pane = session
                .tmux_pane
                .clone()
                .unwrap_or_else(|| if session.is_unknown_bucket { "?" } else { "-" }.to_string());
            let primary = Line::from(vec![
                Span::styled(
                    if session.is_unknown_bucket {
                        "Unknown".to_string()
                    } else {
                        shorten_path(&session.session_id, 12)
                    },
                    row_style(selected, state.focus == FocusPane::Sessions, colors)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(" "),
                badge,
                Span::raw(" "),
                Span::styled(
                    if session.is_unknown_bucket {
                        "watch".to_string()
                    } else {
                        shorten_path(&model, 9)
                    },
                    Style::default().fg(colors.accent),
                ),
            ]);
            let secondary = Line::from(vec![
                Span::styled(format!("pane {pane}"), Style::default().fg(colors.muted)),
                Span::raw("  "),
                Span::styled(
                    format!("{} ago", time_ago(session.last_seen_at_ms)),
                    Style::default().fg(colors.muted),
                ),
                Span::raw("  "),
                Span::styled(
                    format!("{} files", session.touched_files_count),
                    Style::default().fg(colors.text),
                ),
            ]);
            let lines = vec![primary, secondary];
            let mut item = ListItem::new(lines);
            if selected {
                item = item.style(row_style(selected, state.focus == FocusPane::Sessions, colors));
            }
            item
        })
        .collect();

    let list =
        List::new(items).block(panel_block("Sessions", state.focus == FocusPane::Sessions, colors));
    frame.render_widget(list, area);
}

fn render_files(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let outer_block = panel_block("Files", state.focus == FocusPane::Files, colors);
    let inner = outer_block.inner(area);
    frame.render_widget(outer_block, area);
    let split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1)])
        .split(inner);
    let tabs = render_file_mode_tabs(state, split[0].width);
    frame.render_widget(
        Paragraph::new(tabs).style(Style::default().bg(colors.surface).fg(colors.text)),
        split[0],
    );
    let items: Vec<ListItem> = state
        .file_items()
        .iter()
        .enumerate()
        .map(|(idx, file)| {
            let selected = idx == state.selected_file;
            let diff_stat = file_diff_stat(&state.repo_root, &file.rel_path, &file.state_code);
            let primary = Line::from(vec![
                Span::styled(
                    shorten_path(&file.rel_path, 38),
                    row_style(selected, state.focus == FocusPane::Files, colors)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(" "),
                if file.conflicted {
                    Span::styled(" !CONFLICT", Style::default().fg(STOPPED))
                } else {
                    Span::raw("")
                },
            ]);
            let secondary = render_file_secondary_line(file, &diff_stat, colors);
            let mut item = ListItem::new(vec![primary, secondary]);
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
                .constraints([Constraint::Length(8), Constraint::Min(12)])
                .split(area);
            render_detail_summary(frame, sections[0], state);
            render_detail_body(frame, sections[1], state);
        }
        DetailMode::Diff => {
            let sections = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Length(8), Constraint::Min(10)])
                .split(area);
            render_detail_summary(frame, sections[0], state);
            render_detail_body(frame, sections[1], state);
        }
        DetailMode::Summary => {
            let sections = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Length(8), Constraint::Min(8)])
                .split(area);
            render_detail_summary(frame, sections[0], state);
            render_detail_body(frame, sections[1], state);
        }
    }
}

fn render_detail_summary(frame: &mut Frame, area: Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
    let mut lines = Vec::new();
    if let Some(file) = state.selected_file() {
        let facts = collect_file_facts(&state.repo_root, &file.rel_path);
        lines.push(Line::from(Span::styled(
            shorten_path(&file.rel_path, 32),
            Style::default().fg(colors.text).add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(vec![
            Span::styled("last by ", Style::default().fg(colors.muted)),
            Span::styled(
                file.last_session_id
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()),
                Style::default().fg(colors.accent),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("modified ", Style::default().fg(colors.muted)),
            Span::styled(
                time_label(file.last_modified_at_ms),
                Style::default().fg(colors.text),
            ),
            Span::raw("  "),
            Span::styled("confidence ", Style::default().fg(colors.muted)),
            Span::styled(
                file.confidence.as_str(),
                Style::default().fg(confidence_text_color(file.confidence.as_str())),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("lines ", Style::default().fg(colors.muted)),
            Span::styled(facts.line_count.to_string(), Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled("size ", Style::default().fg(colors.muted)),
            Span::styled(format_bytes(facts.byte_size), Style::default().fg(colors.text)),
        ]));
        lines.push(Line::from(vec![
            Span::styled("created ", Style::default().fg(colors.muted)),
            Span::styled(facts.created_at, Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled("git changes ", Style::default().fg(colors.muted)),
            Span::styled(
                facts.git_change_count.to_string(),
                Style::default().fg(colors.text),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("owners ", Style::default().fg(colors.muted)),
            Span::styled(file.touched_by.len().to_string(), Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled("state ", Style::default().fg(colors.muted)),
            Span::styled(
                if file.dirty { "dirty" } else { "clean" },
                Style::default().fg(if file.dirty { ACTIVE } else { IDLE }),
            ),
        ]));
    } else {
        lines.push(Line::from(Span::styled(
            "No file selected",
            Style::default().fg(colors.muted),
        )));
        if let Some(session_id) = state.selected_session_id() {
            lines.push(Line::from(vec![
                Span::styled("session ", Style::default().fg(colors.muted)),
                Span::styled(session_id, Style::default().fg(colors.accent)),
            ]));
        }
    }

    let block = panel_block("Details", state.focus == FocusPane::Detail, colors);
    frame.render_widget(
        Paragraph::new(lines)
            .block(block)
            .style(Style::default().bg(colors.surface).fg(colors.text))
            .wrap(Wrap { trim: true }),
        area,
    );
}

fn render_detail_body(frame: &mut Frame, area: Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
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
            .block(panel_block(title, false, colors))
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
        .map(|entry| {
            ListItem::new(Line::from(vec![
                Span::styled(format_ts(entry.observed_at_ms), Style::default().fg(colors.muted)),
                Span::raw(" "),
                Span::styled(
                    format!("[{}]", entry.source.label()),
                    Style::default().fg(source_color(entry.source)),
                ),
                Span::raw(" "),
                Span::styled(entry.message.clone(), Style::default().fg(colors.text)),
            ]))
        })
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
            (FileListMode::UnknownConflict, false) => " UNKNOWN-CONFLICT ",
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
        Span::styled(" switch focus  ", Style::default().fg(colors.muted)),
        Span::styled("↑↓", Style::default().fg(colors.accent)),
        Span::styled(" select  ", Style::default().fg(colors.muted)),
        Span::styled("Enter", Style::default().fg(colors.accent)),
        Span::styled(" expand  ", Style::default().fg(colors.muted)),
        Span::styled("/", Style::default().fg(colors.accent)),
        Span::styled(" search  ", Style::default().fg(colors.muted)),
        Span::styled("T", Style::default().fg(colors.accent)),
        Span::styled(" theme  ", Style::default().fg(colors.muted)),
        Span::styled("r", Style::default().fg(colors.accent)),
        Span::styled(
            if state.follow_mode {
                " follow:on  "
            } else {
                " follow:off  "
            },
            Style::default().fg(colors.muted),
        ),
        Span::styled("q", Style::default().fg(colors.accent)),
        Span::styled(" quit", Style::default().fg(colors.muted)),
    ]);
    frame.render_widget(
        Paragraph::new(line).style(Style::default().bg(colors.bg).fg(colors.text)),
        area,
    );
}

fn render_title_bar(frame: &mut Frame, area: Rect, state: &RuntimeState) {
    let colors = palette(state.theme_mode);
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
            if state.follow_mode { "WATCH" } else { "PAUSED" },
            Style::default()
                .fg(if state.follow_mode { ACTIVE } else { IDLE })
                .bg(colors.surface)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("  files:{}  ", state.file_list_mode.label()),
            Style::default().fg(colors.accent).bg(colors.surface),
        ),
        Span::styled(
            format!("  refreshed {} ago  ", time_ago(state.last_refresh_at_ms)),
            Style::default().fg(colors.muted).bg(colors.surface),
        ),
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
        Style::default().fg(colors.accent).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(colors.border)
    }
}

fn row_style(selected: bool, focused: bool, colors: UiPalette) -> Style {
    if selected {
        Style::default().fg(colors.text).bg(if focused {
            colors.selection_focus
        } else {
            colors.selection_blur
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

struct FileFacts {
    line_count: usize,
    byte_size: u64,
    created_at: String,
    git_change_count: usize,
}

fn collect_file_facts(repo_root: &str, rel_path: &str) -> FileFacts {
    let path = Path::new(repo_root).join(rel_path);
    let content = std::fs::read_to_string(&path).ok();
    let line_count = content.as_ref().map(|text| text.lines().count()).unwrap_or(0);
    let byte_size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let (created_at, git_change_count) = git_file_history(repo_root, rel_path)
        .unwrap_or_else(|| ("untracked".to_string(), 0));
    FileFacts {
        line_count,
        byte_size,
        created_at,
        git_change_count,
    }
}

fn git_file_history(repo_root: &str, rel_path: &str) -> Option<(String, usize)> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("log")
        .arg("--follow")
        .arg("--format=%ad")
        .arg("--date=short")
        .arg("--")
        .arg(rel_path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let lines: Vec<&str> = stdout.lines().filter(|line| !line.trim().is_empty()).collect();
    let created_at = lines.last().copied().unwrap_or("untracked").to_string();
    Some((created_at, lines.len()))
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
    diff_stat: &str,
    colors: UiPalette,
) -> Line<'static> {
    let age = pad_left(&time_ago(file.last_modified_at_ms), 5);
    let owner = pad_right(
        &shorten_path(
            &file
                .last_session_id
                .clone()
                .unwrap_or_else(|| "unknown".to_string()),
            14,
        ),
        14,
    );
    Line::from(vec![
        Span::styled(pad_right(diff_stat, 8), Style::default().fg(change_color(&file.state_code))),
        Span::raw(" "),
        Span::styled(age, Style::default().fg(colors.muted)),
        Span::raw("  "),
        Span::styled(owner, Style::default().fg(colors.accent)),
    ])
}

fn pad_right(value: &str, width: usize) -> String {
    format!("{value:<width$}")
}

fn pad_left(value: &str, width: usize) -> String {
    format!("{value:>width$}")
}

fn file_diff_stat(repo_root: &str, rel_path: &str, state_code: &str) -> String {
    let status = match state_code {
        "delete" => "D",
        "add" | "untracked" => "A",
        "rename" => "R",
        _ => "M",
    };

    if state_code == "untracked" || state_code == "add" {
        let path = Path::new(repo_root).join(rel_path);
        let added = std::fs::read_to_string(path)
            .ok()
            .map(|text| text.lines().count())
            .unwrap_or(0);
        return format!("{status} +{added}");
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("diff")
        .arg("--numstat")
        .arg("--")
        .arg(rel_path)
        .output();
    if let Ok(output) = output {
        if output.status.success() {
            if let Ok(stdout) = String::from_utf8(output.stdout) {
                if let Some(line) = stdout.lines().find(|line| !line.trim().is_empty()) {
                    let cols: Vec<&str> = line.split_whitespace().collect();
                    if cols.len() >= 2 {
                        let add = cols[0];
                        let del = cols[1];
                        if add == "-" || del == "-" {
                            return status.to_string();
                        }
                        let add_num = add.parse::<usize>().unwrap_or(0);
                        let del_num = del.parse::<usize>().unwrap_or(0);
                        return match (add_num, del_num) {
                            (0, 0) => status.to_string(),
                            (0, d) => format!("{status} -{d}"),
                            (a, 0) => format!("{status} +{a}"),
                            (a, d) => format!("{status} +{a} -{d}"),
                        };
                    }
                }
            }
        }
    }

    status.to_string()
}

fn change_color(state_code: &str) -> Color {
    match state_code {
        "delete" => STOPPED,
        "add" | "untracked" => ACTIVE,
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

fn confidence_badge(label: &str) -> Span<'static> {
    let (text, color) = match label {
        "exact" => (" EXACT ", ACTIVE),
        "inferred" => (" INFERRED ", INFERRED),
        _ => (" UNKNOWN ", IDLE),
    };
    Span::styled(
        text,
        Style::default()
            .fg(Color::Rgb(18, 22, 28))
            .bg(color)
            .add_modifier(Modifier::BOLD),
    )
}

fn dirty_badge(dirty: bool) -> Span<'static> {
    if dirty {
        Span::styled(
            " DIRTY ",
            Style::default()
                .fg(Color::Rgb(18, 22, 28))
                .bg(ACTIVE)
                .add_modifier(Modifier::BOLD),
        )
    } else {
        Span::styled(" CLEAN ", Style::default().fg(Color::Rgb(18, 22, 28)).bg(IDLE))
    }
}

fn source_color(source: crate::models::EventSource) -> Color {
    match source {
        crate::models::EventSource::Hook => Color::Rgb(126, 156, 181),
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

fn highlight_diff_text(
    file_path: Option<&str>,
    diff_text: &str,
    theme_mode: ThemeMode,
) -> Text<'static> {
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

fn highlight_code_text(
    file_path: Option<&str>,
    code: &str,
    theme_mode: ThemeMode,
) -> Text<'static> {
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
        hunks
            .iter()
            .copied()
            .find(|offset| *offset > current)
            .unwrap_or(hunks[0])
    } else {
        hunks
            .iter()
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
