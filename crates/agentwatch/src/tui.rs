use crate::ipc::RuntimeFeed;
use crate::models::{RuntimeMessage, DEFAULT_TUI_POLL_MS};
use crate::observe;
use crate::repo::RepoContext;
use crate::state::{DetailMode, EventLogFilter, RuntimeState, ThemeMode};
use anyhow::{Context, Result};
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::style::Color;
use ratatui::{DefaultTerminal, Frame};
use std::env;
use std::io::stdout;
use std::process::{Command, Stdio};
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use syntect::highlighting::{Theme, ThemeSet};
use syntect::parsing::SyntaxSet;

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
const SESSION_BOOTSTRAP_WINDOW_MS: i64 = 24 * 60 * 60 * 1000;
const TRANSPORT_REFRESH_MS: u64 = 1200;

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
    ensure_runtime_service(&ctx)?;
    let repo_root = ctx.repo_root.to_string_lossy().to_string();
    let repo_name = ctx
        .repo_root
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| repo_root.clone());
    let branch = current_branch(&ctx).unwrap_or_else(|_| "-".to_string());
    let mut state = RuntimeState::new(repo_root, repo_name, branch);
    state.set_runtime_transport(read_runtime_transport(&ctx));
    let mut cache = AppCache::new();
    let bootstrap_cutoff = bootstrap_history_cutoff(chrono::Utc::now().timestamp_millis());
    for message in feed.read_recent_since(bootstrap_cutoff)? {
        state.apply_message(message);
    }
    let mut last_poll = Instant::now() - Duration::from_millis(poll_interval_ms);
    let mut last_transport_refresh = Instant::now() - Duration::from_millis(TRANSPORT_REFRESH_MS);

    loop {
        let mut force_scan = false;
        if last_poll.elapsed() >= Duration::from_millis(poll_interval_ms) {
            let dirty = observe::scan_repo(&ctx)?;
            state.sync_dirty_files(dirty);
            last_poll = Instant::now();
        }

        for message in feed.read_new()? {
            if matches!(message, crate::models::RuntimeMessage::Git(_)) {
                force_scan = true;
            }
            state.apply_message(message);
        }
        if force_scan {
            let dirty = observe::scan_repo(&ctx)?;
            state.sync_dirty_files(dirty);
            last_poll = Instant::now();
        }

        if last_transport_refresh.elapsed() >= Duration::from_millis(TRANSPORT_REFRESH_MS) {
            state.set_runtime_transport(read_runtime_transport(&ctx));
            last_transport_refresh = Instant::now();
        }
        cache.sync_results();
        cache.warm_visible_files(&state);
        cache.warm_selected_detail(&state);

        terminal.draw(|frame| render(frame, &state, &feed, &cache))?;

        if event::poll(Duration::from_millis(100)).context("poll terminal events")?
            && handle_event(&mut state, &ctx)?
        {
            break;
        }
    }
    Ok(())
}

fn handle_event(state: &mut RuntimeState, ctx: &RepoContext) -> Result<bool> {
    match event::read().context("read terminal event")? {
        Event::Key(key) => {
            if state.search_active {
                match key.code {
                    KeyCode::Esc => state.cancel_search(),
                    KeyCode::Enter => state.cancel_search(),
                    KeyCode::Backspace => state.pop_search_char(),
                    KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        state.clear_search()
                    }
                    KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                        state.push_search_char(ch)
                    }
                    _ => {}
                }
                return Ok(false);
            }
            match key.code {
                KeyCode::Char('q') => return Ok(true),
                KeyCode::Tab => state.cycle_focus(),
                KeyCode::Char('j') | KeyCode::Down => state.move_selection_down(),
                KeyCode::Char('k') | KeyCode::Up => state.move_selection_up(),
                KeyCode::Char('h') | KeyCode::Left => state.select_prev_file(),
                KeyCode::Char('l') | KeyCode::Right => state.select_next_file(),
                KeyCode::Enter => state.toggle_file_view(),
                KeyCode::Char('/') => state.begin_search(),
                KeyCode::Esc => state.clear_search(),
                KeyCode::Char('r') | KeyCode::Char('f') => state.toggle_follow_mode(),
                KeyCode::Char('s') => state.cycle_file_list_mode(),
                KeyCode::Char('u') => {
                    while !matches!(
                        state.file_list_mode,
                        crate::state::FileListMode::UnknownConflict
                    ) {
                        state.cycle_file_list_mode();
                    }
                }
                KeyCode::Char('d') | KeyCode::Char('D') => state.toggle_detail_mode(),
                KeyCode::Char('t') | KeyCode::Char('T') => state.toggle_theme_mode(),
                KeyCode::Char('a') => assign_selected_file(state, ctx)?,
                KeyCode::Char('o') => open_selected_file_in_editor(state, ctx)?,
                KeyCode::Char('g') => open_selected_file_git_diff(state, ctx)?,
                KeyCode::Char('1') => state.set_event_log_filter(EventLogFilter::All),
                KeyCode::Char('2') => state.set_event_log_filter(EventLogFilter::Hook),
                KeyCode::Char('3') => state.set_event_log_filter(EventLogFilter::Git),
                KeyCode::Char('4') => state.set_event_log_filter(EventLogFilter::Watch),
                KeyCode::Char('5') => state.set_event_log_filter(EventLogFilter::Attribution),
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
            }
        }
        Event::Resize(_, _) => {}
        _ => {}
    }
    Ok(false)
}

fn open_selected_file_in_editor(state: &RuntimeState, ctx: &RepoContext) -> Result<()> {
    let Some(file) = state.selected_file() else {
        return Ok(());
    };
    let editor = env::var("EDITOR").unwrap_or_else(|_| "vi".to_string());
    let file_path = ctx.repo_root.join(&file.rel_path);
    suspend_tui_command(Command::new(editor).arg(file_path))
}

fn assign_selected_file(state: &mut RuntimeState, ctx: &RepoContext) -> Result<()> {
    let Some(message) = state.selected_file_assignment_message() else {
        return Ok(());
    };
    send_runtime_message(ctx, &message)?;
    state.apply_message(message);
    Ok(())
}

fn open_selected_file_git_diff(state: &RuntimeState, ctx: &RepoContext) -> Result<()> {
    let Some(file) = state.selected_file() else {
        return Ok(());
    };
    let pager = env::var("PAGER").unwrap_or_else(|_| "less".to_string());
    let mut command = Command::new("sh");
    command.arg("-lc").arg(format!(
        "git -C {} diff -- {} | {}",
        shell_escape_path(&ctx.repo_root.to_string_lossy()),
        shell_escape_path(&file.rel_path),
        pager
    ));
    suspend_tui_command(&mut command)
}

fn suspend_tui_command(command: &mut Command) -> Result<()> {
    let _ = execute!(stdout(), LeaveAlternateScreen);
    let _ = disable_raw_mode();
    let status = command.status().context("run external command from tui")?;
    execute!(stdout(), EnterAlternateScreen).context("re-enter alternate screen")?;
    enable_raw_mode().context("re-enable raw mode")?;
    let _ = status;
    Ok(())
}

fn shell_escape_path(path: &str) -> String {
    format!("'{}'", path.replace('\'', "'\\''"))
}

fn send_runtime_message(ctx: &RepoContext, message: &RuntimeMessage) -> Result<()> {
    crate::ipc::send_socket_message(&ctx.runtime_socket_path, message)
        .or_else(|_| crate::ipc::send_tcp_message(&ctx.runtime_tcp_addr, message))
        .or_else(|_| crate::ipc::send_message(&ctx.runtime_event_path, message))
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

fn ensure_runtime_service(ctx: &RepoContext) -> Result<()> {
    if runtime_service_is_fresh(ctx) {
        return Ok(());
    }

    let current_exe = env::current_exe().context("resolve current agentwatch executable")?;
    let mut command = Command::new(current_exe);
    command
        .arg("--repo")
        .arg(&ctx.repo_root)
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let _child = command
        .spawn()
        .context("spawn agentwatch runtime service")?;

    let deadline = Instant::now() + Duration::from_millis(1200);
    while Instant::now() < deadline {
        if runtime_service_is_fresh(ctx) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(60));
    }

    Ok(())
}

fn runtime_service_is_fresh(ctx: &RepoContext) -> bool {
    crate::ipc::read_service_info(&ctx.runtime_info_path)
        .ok()
        .flatten()
        .is_some_and(|info| chrono::Utc::now().timestamp_millis() - info.last_seen_at_ms < 2500)
}

fn read_runtime_transport(ctx: &RepoContext) -> String {
    let Some(info) = crate::ipc::read_service_info(&ctx.runtime_info_path)
        .ok()
        .flatten()
        .filter(|info| chrono::Utc::now().timestamp_millis() - info.last_seen_at_ms < 2500)
    else {
        return fallback_runtime_transport(ctx);
    };

    match info.transport.as_str() {
        "socket" if crate::ipc::socket_reachable(&ctx.runtime_socket_path) => "socket".to_string(),
        "tcp" if crate::ipc::tcp_reachable(&ctx.runtime_tcp_addr) => "tcp".to_string(),
        "socket" | "tcp" => fallback_runtime_transport(ctx),
        "feed" => "feed".to_string(),
        other => other.to_string(),
    }
}

fn fallback_runtime_transport(ctx: &RepoContext) -> String {
    if ctx.runtime_event_path.exists() {
        "feed".to_string()
    } else {
        "down".to_string()
    }
}

fn bootstrap_history_cutoff(now_ms: i64) -> i64 {
    now_ms - SESSION_BOOTSTRAP_WINDOW_MS
}

#[allow(dead_code)]
pub fn default_poll_ms() -> u64 {
    DEFAULT_TUI_POLL_MS
}

#[path = "tui_cache.rs"]
mod cache;
use cache::*;

#[path = "tui_highlight.rs"]
mod highlight;
use highlight::*;

#[path = "tui_render.rs"]
mod render;
use render::*;

#[cfg(test)]
#[path = "tui_tests.rs"]
mod tests;
