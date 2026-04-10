use crate::ipc::RuntimeFeed;
use crate::models::DEFAULT_TUI_POLL_MS;
use crate::observe;
use crate::repo::RepoContext;
use crate::state::{DetailMode, FocusPane, RuntimeState};
use anyhow::{Context, Result};
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::Color;
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap};
use ratatui::{DefaultTerminal, Frame};
use std::io::stdout;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

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
    let mut state = RuntimeState::new(ctx.repo_root.to_string_lossy().to_string());
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
            if handle_event(&mut state)? {
                break;
            }
        }
    }
    Ok(())
}

fn handle_event(state: &mut RuntimeState) -> Result<bool> {
    match event::read().context("read terminal event")? {
        Event::Key(key) => match key.code {
            KeyCode::Char('q') => return Ok(true),
            KeyCode::Tab => state.cycle_focus(),
            KeyCode::Char('j') | KeyCode::Down => state.move_selection_down(),
            KeyCode::Char('k') | KeyCode::Up => state.move_selection_up(),
            KeyCode::Char('r') => state.toggle_follow_mode(),
            KeyCode::Char('s') => state.toggle_group_mode(),
            KeyCode::Char('d') => state.toggle_detail_mode(),
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
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(8), Constraint::Length(8)])
        .split(frame.area());

    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(25),
            Constraint::Percentage(38),
            Constraint::Percentage(37),
        ])
        .split(outer[0]);

    render_sessions(frame, columns[0], state);
    render_files(frame, columns[1], state);
    render_detail(frame, columns[2], state, feed);
    render_log(frame, outer[1], state);
}

fn render_sessions(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let items: Vec<ListItem> = state
        .session_items()
        .iter()
        .enumerate()
        .map(|(idx, session)| {
            let marker = if idx == state.selected_session && state.focus == FocusPane::Sessions {
                ">"
            } else {
                " "
            };
            let model = session.model.clone().unwrap_or_else(|| "-".to_string());
            let line = format!(
                "{marker} {} [{}] {} files {}",
                session.session_id,
                session.status,
                session.touched_files.len(),
                model
            );
            ListItem::new(Line::from(line))
        })
        .collect();

    let title = if state.group_by_session {
        "Sessions (group)"
    } else {
        "Sessions"
    };

    let list = List::new(items).block(
        Block::default()
            .title(title)
            .borders(Borders::ALL)
            .border_style(focus_style(state.focus == FocusPane::Sessions)),
    );
    frame.render_widget(list, area);
}

fn render_files(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let items: Vec<ListItem> = state
        .file_items()
        .iter()
        .enumerate()
        .map(|(idx, file)| {
            let marker = if idx == state.selected_file && state.focus == FocusPane::Files {
                ">"
            } else {
                " "
            };
            let session = file
                .last_session_id
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            let line = format!(
                "{marker} {} [{} {} {}]",
                file.rel_path,
                if file.dirty { "dirty" } else { "clean" },
                file.confidence.as_str(),
                session
            );
            ListItem::new(Line::from(line))
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .title("Files")
            .borders(Borders::ALL)
            .border_style(focus_style(state.focus == FocusPane::Files)),
    );
    frame.render_widget(list, area);
}

fn render_detail(
    frame: &mut Frame,
    area: ratatui::layout::Rect,
    state: &RuntimeState,
    feed: &RuntimeFeed,
) {
    let mut lines = Vec::new();
    lines.push(Line::from(format!("repo: {}", state.repo_root)));
    lines.push(Line::from(format!(
        "event file: {}",
        feed.event_path().to_string_lossy()
    )));
    lines.push(Line::from(format!(
        "follow={} mode={} detail={}",
        state.follow_mode,
        if state.group_by_session {
            "session"
        } else {
            "global"
        },
        match state.detail_mode {
            DetailMode::Summary => "summary",
            DetailMode::Diff => "diff",
        },
    )));
    lines.push(Line::from(""));

    let title = match state.detail_mode {
        DetailMode::Summary => "Detail",
        DetailMode::Diff => "Diff",
    };

    match state.detail_mode {
        DetailMode::Summary => {
            if let Some(session_id) = state.selected_session_id() {
                lines.push(Line::from(Span::styled(
                    format!("session: {session_id}"),
                    Style::default().add_modifier(Modifier::BOLD),
                )));
            }

            if let Some(file) = state.selected_file() {
                lines.push(Line::from(format!("file: {}", file.rel_path)));
                lines.push(Line::from(format!(
                    "last session: {}",
                    file.last_session_id
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string())
                )));
                lines.push(Line::from(format!(
                    "confidence: {} conflicted={}",
                    file.confidence.as_str(),
                    file.conflicted
                )));
                lines.push(Line::from(format!(
                    "state: {} dirty={}",
                    file.state_code, file.dirty
                )));
                lines.push(Line::from("recent:"));
                for event in &file.recent_events {
                    lines.push(Line::from(format!("- {event}")));
                }
            } else {
                lines.push(Line::from("no file selected"));
            }
            lines.push(Line::from(""));
            lines.push(Line::from(
                "keys: Tab focus  j/k move  s group  d diff  r follow  q quit",
            ));
            let detail = Paragraph::new(lines)
                .block(
                    Block::default()
                        .title(title)
                        .borders(Borders::ALL)
                        .border_style(focus_style(state.focus == FocusPane::Detail)),
                )
                .wrap(Wrap { trim: true });
            frame.render_widget(detail, area);
        }
        DetailMode::Diff => {
            let diff_text = state
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
                .unwrap_or_else(|| "<no diff available>".to_string());

            let diff = Paragraph::new(highlight_diff_text(&diff_text))
                .block(
                    Block::default()
                        .title(title)
                        .borders(Borders::ALL)
                        .border_style(focus_style(state.focus == FocusPane::Detail)),
                )
                .wrap(Wrap { trim: false })
                .scroll((state.detail_scroll, 0));
            frame.render_widget(diff, area);
        }
    }
}

fn render_log(frame: &mut Frame, area: ratatui::layout::Rect, state: &RuntimeState) {
    let items: Vec<ListItem> = state
        .event_log
        .iter()
        .take(6)
        .map(|entry| {
            ListItem::new(Line::from(format!(
                "{} {}",
                format_ts(entry.observed_at_ms),
                entry.message
            )))
        })
        .collect();
    let list = List::new(items).block(Block::default().title("Event Log").borders(Borders::ALL));
    frame.render_widget(Clear, area);
    frame.render_widget(list, area);
}

fn focus_style(active: bool) -> Style {
    if active {
        Style::default().yellow().add_modifier(Modifier::BOLD)
    } else {
        Style::default()
    }
}

fn format_ts(timestamp_ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(timestamp_ms)
        .map(|dt| dt.format("%H:%M:%S").to_string())
        .unwrap_or_else(|| "--:--:--".to_string())
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

fn highlight_diff_text(diff_text: &str) -> Text<'static> {
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
            Line::from(Span::styled(
                raw.to_string(),
                Style::default().fg(Color::Green),
            ))
        } else if raw.starts_with('-') {
            Line::from(Span::styled(
                raw.to_string(),
                Style::default().fg(Color::Red),
            ))
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

#[allow(dead_code)]
pub fn default_poll_ms() -> u64 {
    DEFAULT_TUI_POLL_MS
}
