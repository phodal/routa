use crate::ipc::RuntimeFeed;
use crate::models::DEFAULT_TUI_POLL_MS;
use crate::observe;
use crate::repo::RepoContext;
use crate::state::{FocusPane, RuntimeState};
use anyhow::{Context, Result};
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap};
use ratatui::{DefaultTerminal, Frame};
use std::io::stdout;
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
        "follow={} mode={}",
        state.follow_mode,
        if state.group_by_session {
            "session"
        } else {
            "global"
        }
    )));
    lines.push(Line::from(""));

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
        "keys: Tab focus  j/k move  s group  r follow  q quit",
    ));

    let detail = Paragraph::new(lines)
        .block(
            Block::default()
                .title("Detail")
                .borders(Borders::ALL)
                .border_style(focus_style(state.focus == FocusPane::Detail)),
        )
        .wrap(Wrap { trim: true });
    frame.render_widget(detail, area);
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

#[allow(dead_code)]
pub fn default_poll_ms() -> u64 {
    DEFAULT_TUI_POLL_MS
}
