use crate::observe;
use crate::observe::ipc::RuntimeFeed;
use crate::observe::repo::RepoContext;
use crate::shared::models::{FitnessEvent, RuntimeMessage, DEFAULT_TUI_POLL_MS};
use crate::ui::state::{DetailMode, EventLogFilter, RuntimeState, ThemeMode};
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
use std::sync::mpsc;
use std::sync::LazyLock;
use std::thread;
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
const REPO_STATUS_REFRESH_MS: u64 = 5000;
const AGENT_SCAN_REFRESH_MS: u64 = 15_000;
const FITNESS_AUTO_REFRESH_MS: u64 = 10 * 60 * 1000;
const FITNESS_CACHE_CHECK_MS: u64 = 1500;
const SCC_REFRESH_MS: u64 = 60 * 1000;
const FALLBACK_SCAN_REFRESH_MS: u64 = 15_000;
const FALLBACK_SCAN_IDLE_WINDOW_MS: i64 = 15_000;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct RepoStatusSummary {
    branch: Option<String>,
    ahead_count: Option<usize>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct BranchResolution {
    branch: Option<String>,
    upstream: Option<String>,
}

pub fn run(ctx: RepoContext, poll_interval_ms: u64) -> Result<()> {
    enable_raw_mode().context("enable raw mode")?;
    execute!(stdout(), EnterAlternateScreen).context("enter alternate screen")?;
    let mut terminal = ratatui::init();
    let result = run_loop(
        &mut terminal,
        ctx,
        poll_interval_ms.max(FALLBACK_SCAN_REFRESH_MS),
    );
    ratatui::restore();
    let _ = execute!(stdout(), LeaveAlternateScreen);
    let _ = disable_raw_mode();
    result
}

fn run_loop(terminal: &mut DefaultTerminal, ctx: RepoContext, poll_interval_ms: u64) -> Result<()> {
    let mut feed = RuntimeFeed::open(&ctx.runtime_event_path)?;
    ensure_runtime_service(&ctx)?;
    let repo_root = ctx.repo_root.to_string_lossy().to_string();
    let repo_status = read_repo_status(&ctx).unwrap_or_default();
    let branch = repo_status.branch.unwrap_or_else(|| "-".to_string());
    let mut state = RuntimeState::new(repo_root.clone(), branch);
    state.sync_focus_for_width(terminal.size()?.width);
    state.set_runtime_transport(read_runtime_transport(&ctx));
    state.set_ahead_count(repo_status.ahead_count);
    state.set_worktree_count(current_worktree_count(&ctx).ok());
    let mut cache = AppCache::new(&repo_root);
    cache.set_fitness_mode(state.fitness_view_mode);
    cache.request_scc_refresh(state.repo_root.clone(), false);
    let bootstrap_cutoff = bootstrap_history_cutoff(chrono::Utc::now().timestamp_millis());
    let (transcript_tx, transcript_rx) = mpsc::channel();
    let transcript_ctx = ctx.clone();
    thread::spawn(move || {
        let result = crate::observe::codex_transcript::bootstrap_codex_transcript_messages(
            &transcript_ctx.repo_root,
        )
        .unwrap_or_default();
        let _ = transcript_tx.send(result);
    });
    for message in feed.read_recent_since(bootstrap_cutoff)? {
        state.apply_message(message);
    }
    state.prune_stale_sessions();
    let mut last_poll = Instant::now() - Duration::from_millis(poll_interval_ms);
    let mut last_transport_refresh = Instant::now() - Duration::from_millis(TRANSPORT_REFRESH_MS);
    let mut last_repo_status_refresh =
        Instant::now() - Duration::from_millis(REPO_STATUS_REFRESH_MS);
    let mut last_agent_refresh = Instant::now() - Duration::from_millis(AGENT_SCAN_REFRESH_MS);
    let mut last_fitness_refresh = Instant::now();
    let mut last_fitness_cache_check =
        Instant::now() - Duration::from_millis(FITNESS_CACHE_CHECK_MS);
    let mut last_scc_refresh = Instant::now();
    if !cache.has_fitness_data() {
        cache.request_fitness_refresh(
            state.repo_root.clone(),
            state.fitness_cache_key(),
            false,
            fitness_run_mode_for(&state),
        );
    }

    loop {
        while event::poll(Duration::from_millis(0)).context("poll terminal events")? {
            if handle_event(&mut state, &mut cache)? {
                return Ok(());
            }
        }

        let mut force_scan = false;
        let now_ms = chrono::Utc::now().timestamp_millis();
        if last_poll.elapsed() >= Duration::from_millis(poll_interval_ms)
            && state.should_run_fallback_scan(now_ms, FALLBACK_SCAN_IDLE_WINDOW_MS)
        {
            let dirty = observe::scan_repo(&ctx)?;
            state.sync_dirty_files(dirty);
            last_poll = Instant::now();
        }

        for message in feed.read_new()? {
            if matches!(message, RuntimeMessage::Git(_)) {
                force_scan = true;
            }
            if let RuntimeMessage::Fitness(event) = &message {
                refresh_fitness_from_event(&mut state, &mut cache, event);
                last_fitness_refresh = Instant::now();
            }
            state.apply_message(message);
        }
        if let Ok(messages) = transcript_rx.try_recv() {
            let recovered_session_count = messages
                .iter()
                .filter_map(|message| match message {
                    RuntimeMessage::Hook(event) if event.event_name == "TranscriptRecover" => {
                        Some(event.session_id.clone())
                    }
                    _ => None,
                })
                .collect::<std::collections::BTreeSet<_>>()
                .len();
            for message in messages {
                if matches!(message, RuntimeMessage::Git(_)) {
                    force_scan = true;
                }
                state.apply_message(message);
            }
            state.push_hook_status_event(
                chrono::Utc::now().timestamp_millis(),
                format!("transcript backfill complete ({recovered_session_count} sessions)"),
            );
            state.prune_stale_sessions();
        }
        if force_scan {
            let dirty = observe::scan_repo(&ctx)?;
            state.sync_dirty_files(dirty);
            apply_repo_status(&mut state, read_repo_status(&ctx).ok());
            last_poll = Instant::now();
        }
        state.prune_stale_sessions();

        if last_transport_refresh.elapsed() >= Duration::from_millis(TRANSPORT_REFRESH_MS) {
            state.set_runtime_transport(read_runtime_transport(&ctx));
            last_transport_refresh = Instant::now();
        }
        if last_repo_status_refresh.elapsed() >= Duration::from_millis(REPO_STATUS_REFRESH_MS) {
            apply_repo_status(&mut state, read_repo_status(&ctx).ok());
            state.set_worktree_count(current_worktree_count(&ctx).ok());
            last_repo_status_refresh = Instant::now();
        }
        if last_agent_refresh.elapsed() >= Duration::from_millis(AGENT_SCAN_REFRESH_MS) {
            if let Ok(agents) = crate::observe::detect::scan_agents(&state.repo_root) {
                state.set_detected_agents(agents);
            }
            last_agent_refresh = Instant::now();
        }
        if last_fitness_refresh.elapsed() >= Duration::from_millis(FITNESS_AUTO_REFRESH_MS) {
            cache.request_fitness_refresh(
                state.repo_root.clone(),
                state.fitness_cache_key(),
                false,
                fitness_run_mode_for(&state),
            );
            last_fitness_refresh = Instant::now();
        }
        if last_fitness_cache_check.elapsed() >= Duration::from_millis(FITNESS_CACHE_CHECK_MS) {
            cache.request_fitness_refresh(
                state.repo_root.clone(),
                state.fitness_cache_key(),
                false,
                fitness_run_mode_for(&state),
            );
            last_fitness_cache_check = Instant::now();
        }
        if last_scc_refresh.elapsed() >= Duration::from_millis(SCC_REFRESH_MS) {
            cache.request_scc_refresh(state.repo_root.clone(), false);
            last_scc_refresh = Instant::now();
        }
        cache.sync_results();
        cache.warm_visible_files(&state);
        cache.warm_selected_detail(&state);
        cache.warm_test_mappings(&state);

        state.sync_focus_for_width(terminal.size()?.width);
        terminal.draw(|frame| render(frame, &state, &feed, &mut cache))?;

        if event::poll(Duration::from_millis(100)).context("poll terminal events")?
            && handle_event(&mut state, &mut cache)?
        {
            break;
        }
    }
    Ok(())
}

fn handle_event(state: &mut RuntimeState, cache: &mut AppCache) -> Result<bool> {
    match event::read().context("read terminal event")? {
        Event::Key(key) => {
            let viewport_width = crossterm::terminal::size()
                .map(|(width, _)| width)
                .unwrap_or(165);
            state.sync_focus_for_width(viewport_width);
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
                KeyCode::BackTab => state.cycle_focus_backward_for_width(viewport_width),
                KeyCode::Tab => state.cycle_focus_for_width(viewport_width),
                KeyCode::Char('j') | KeyCode::Down => state.move_selection_down(),
                KeyCode::Char('k') | KeyCode::Up => state.move_selection_up(),
                KeyCode::Char('h') | KeyCode::Left => state.select_prev_file(),
                KeyCode::Char('l') | KeyCode::Right => state.select_next_file(),
                KeyCode::Esc => state.clear_search(),
                KeyCode::Char('r') | KeyCode::Char('f') => state.toggle_follow_mode(),
                KeyCode::Char('g') | KeyCode::Char('G') => {
                    cache.request_fitness_refresh(
                        state.repo_root.clone(),
                        state.fitness_cache_key(),
                        true,
                        fitness_run_mode_for(state),
                    );
                    cache.request_scc_refresh(state.repo_root.clone(), true);
                }
                KeyCode::Char('m') | KeyCode::Char('M') => {
                    state.toggle_fitness_view_mode();
                    cache.set_fitness_mode(state.fitness_view_mode);
                    cache.request_fitness_refresh(
                        state.repo_root.clone(),
                        state.fitness_cache_key(),
                        false,
                        fitness_run_mode_for(state),
                    );
                }
                KeyCode::Char('s') => state.cycle_file_list_mode(),
                KeyCode::Char('S') => state.cycle_run_sort_mode(),
                KeyCode::Char('v') | KeyCode::Char('V') => state.cycle_run_filter_mode(),
                KeyCode::Char('u') => {
                    while !matches!(
                        state.file_list_mode,
                        crate::ui::state::FileListMode::UnknownConflict
                    ) {
                        state.cycle_file_list_mode();
                    }
                }
                KeyCode::Char('d') | KeyCode::Char('D') => state.toggle_detail_mode(),
                KeyCode::Char('t') | KeyCode::Char('T') => state.toggle_theme_mode(),
                KeyCode::Char('1') => state.set_event_log_filter(EventLogFilter::All),
                KeyCode::Char('2') => state.set_event_log_filter(EventLogFilter::Hook),
                KeyCode::Char('3') => state.set_event_log_filter(EventLogFilter::Git),
                KeyCode::Char('4') => state.set_event_log_filter(EventLogFilter::Watch),
                KeyCode::Char('5') => state.set_event_log_filter(EventLogFilter::Attribution),
                KeyCode::PageDown => state.page_down(),
                KeyCode::PageUp => state.page_up(),
                KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    return Ok(true);
                }
                _ => {}
            }
        }
        Event::Resize(width, _) => state.sync_focus_for_width(width),
        _ => {}
    }
    Ok(false)
}

fn fitness_run_mode_for(state: &RuntimeState) -> fitness::FitnessRunMode {
    match state.fitness_view_mode {
        crate::ui::state::FitnessViewMode::Fast => fitness::FitnessRunMode::Fast,
        crate::ui::state::FitnessViewMode::Full => fitness::FitnessRunMode::Full,
    }
}

fn refresh_fitness_from_event(
    state: &mut RuntimeState,
    cache: &mut AppCache,
    event: &FitnessEvent,
) {
    let matches_current_mode = matches!(
        (state.fitness_view_mode, event.mode.as_str()),
        (crate::ui::state::FitnessViewMode::Fast, "fast")
            | (crate::ui::state::FitnessViewMode::Full, "full")
    );
    if !matches_current_mode {
        return;
    }
    cache.request_fitness_refresh(
        state.repo_root.clone(),
        state.fitness_cache_key(),
        true,
        fitness_run_mode_for(state),
    );
}

fn apply_repo_status(state: &mut RuntimeState, repo_status: Option<RepoStatusSummary>) {
    let repo_status = repo_status.unwrap_or_default();
    state.branch = repo_status.branch.unwrap_or_else(|| "-".to_string());
    state.set_ahead_count(repo_status.ahead_count);
}

fn read_repo_status(ctx: &RepoContext) -> Result<RepoStatusSummary> {
    let branch_resolution = read_branch_resolution(ctx)?;
    let ahead_count = match branch_resolution.upstream.as_deref() {
        Some(upstream) => read_ahead_count(ctx, upstream).ok(),
        None => None,
    };

    Ok(RepoStatusSummary {
        branch: branch_resolution.branch,
        ahead_count,
    })
}

fn read_branch_resolution(ctx: &RepoContext) -> Result<BranchResolution> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&ctx.repo_root)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .arg("@{upstream}")
        .output()
        .context("run git rev-parse branch and upstream")?;
    if output.status.success() {
        let status = String::from_utf8(output.stdout).context("decode rev-parse output")?;
        return Ok(parse_branch_resolution(&status));
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(&ctx.repo_root)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()
        .context("run git rev-parse branch")?;
    if !output.status.success() {
        anyhow::bail!("git rev-parse branch failed");
    }

    let branch = String::from_utf8(output.stdout).context("decode branch output")?;
    Ok(BranchResolution {
        branch: normalize_branch_name(branch.trim()),
        upstream: None,
    })
}

fn parse_branch_resolution(output: &str) -> BranchResolution {
    let mut lines = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());

    BranchResolution {
        branch: lines.next().and_then(normalize_branch_name),
        upstream: lines.next().map(str::to_string),
    }
}

fn normalize_branch_name(branch: &str) -> Option<String> {
    match branch.trim() {
        "" | "HEAD" | "(detached)" => None,
        value => Some(value.to_string()),
    }
}

fn read_ahead_count(ctx: &RepoContext, upstream: &str) -> Result<usize> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&ctx.repo_root)
        .arg("rev-list")
        .arg("--left-right")
        .arg("--count")
        .arg(format!("HEAD...{upstream}"))
        .output()
        .context("run git rev-list --left-right --count HEAD...upstream")?;
    if !output.status.success() {
        anyhow::bail!("git rev-list --left-right --count failed");
    }

    let counts = String::from_utf8(output.stdout).context("decode rev-list output")?;
    Ok(parse_ahead_count(&counts).unwrap_or(0))
}

fn parse_ahead_count(counts: &str) -> Option<usize> {
    counts
        .split_whitespace()
        .next()
        .and_then(|count| count.parse::<usize>().ok())
}

fn current_worktree_count(ctx: &RepoContext) -> Result<usize> {
    let common_git_dir = common_git_dir(&ctx.git_dir);
    let worktrees_dir = common_git_dir.join("worktrees");
    let extra_worktrees = std::fs::read_dir(&worktrees_dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(|entry| entry.ok()))
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .count();

    Ok(extra_worktrees + 1)
}

fn common_git_dir(git_dir: &std::path::Path) -> std::path::PathBuf {
    if git_dir
        .parent()
        .and_then(|parent| parent.file_name())
        .is_some_and(|name| name == "worktrees")
    {
        return git_dir
            .parent()
            .and_then(|parent| parent.parent())
            .unwrap_or(git_dir)
            .to_path_buf();
    }

    git_dir.to_path_buf()
}

fn ensure_runtime_service(ctx: &RepoContext) -> Result<()> {
    if runtime_service_is_fresh(ctx) {
        return Ok(());
    }

    let Ok(current_exe) = env::current_exe() else {
        return Ok(());
    };
    let mut command = Command::new(current_exe);
    command
        .arg("--repo")
        .arg(&ctx.repo_root)
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let _ = command.spawn();

    Ok(())
}

fn runtime_service_is_fresh(ctx: &RepoContext) -> bool {
    crate::observe::ipc::read_service_info(&ctx.runtime_info_path)
        .ok()
        .flatten()
        .is_some_and(|info| chrono::Utc::now().timestamp_millis() - info.last_seen_at_ms < 2500)
}

fn read_runtime_transport(ctx: &RepoContext) -> String {
    let Some(info) = crate::observe::ipc::read_service_info(&ctx.runtime_info_path)
        .ok()
        .flatten()
        .filter(|info| chrono::Utc::now().timestamp_millis() - info.last_seen_at_ms < 2500)
    else {
        return fallback_runtime_transport(ctx);
    };

    match info.transport.as_str() {
        "socket" if crate::observe::ipc::socket_reachable(&ctx.runtime_socket_path) => {
            "socket".to_string()
        }
        "tcp" if crate::observe::ipc::tcp_reachable(&ctx.runtime_tcp_addr) => "tcp".to_string(),
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

#[path = "cache.rs"]
pub mod cache;
use cache::*;

#[path = "highlight.rs"]
mod highlight;

/// Bridge to evaluate::entrix (fitness execution module)
pub(crate) mod fitness {
    pub use crate::evaluate::entrix::*;
}

/// Bridge to govern::review (review hints module)
mod review {
    pub use crate::govern::review::*;
}

#[path = "panels.rs"]
mod panels;
use panels::*;

#[path = "render.rs"]
mod render;
use render::*;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
