use crate::observe;
use crate::observe::ipc::RuntimeFeed;
use crate::observe::repo::RepoContext;
use crate::shared::models::{
    DetectedAgent, DirtyRepoEntry, FitnessEvent, RuntimeMessage, DEFAULT_TUI_POLL_MS,
};
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
use std::time::Duration;
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
const AGENT_SCAN_REFRESH_MS: u64 = 15_000;
const FITNESS_AUTO_REFRESH_MS: u64 = 10 * 60 * 1000;
const FITNESS_CACHE_CHECK_MS: u64 = 1500;
const SCC_REFRESH_MS: u64 = 60 * 1000;
const RECONCILE_SCAN_REFRESH_MS: u64 = 5_000;
const IDLE_REDRAW_MS: u64 = 1_000;
const RUNTIME_FEED_SIGNAL_MS: u64 = 120;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct RepoStatusSummary {
    branch: Option<String>,
    upstream: Option<String>,
    ahead_count: Option<usize>,
    committed_change_summary: Option<(usize, usize)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UiLoopAction {
    Continue,
    Quit,
    RefreshAll,
}

#[derive(Debug)]
enum UiSignal {
    Terminal(Event),
    Feed(Vec<RuntimeMessage>),
    TranscriptBootstrap(Vec<RuntimeMessage>),
    RepoSnapshot(RepoSnapshot),
    DetectedAgents(Vec<DetectedAgent>),
    RuntimeTransport(String),
    FitnessAutoRefresh,
    FitnessMailboxSync,
    SccRefresh,
    CacheResultsReady,
    Tick,
}

#[derive(Debug, Default)]
struct RepoSnapshot {
    dirty: Option<Vec<DirtyRepoEntry>>,
    repo_status: Option<RepoStatusSummary>,
    worktree_count: Option<usize>,
    warning: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RefreshCommand {
    RefreshNow,
}

pub fn run(ctx: RepoContext, poll_interval_ms: u64) -> Result<()> {
    enable_raw_mode().context("enable raw mode")?;
    execute!(stdout(), EnterAlternateScreen).context("enter alternate screen")?;
    let mut terminal = ratatui::init();
    let result = run_loop(
        &mut terminal,
        ctx,
        poll_interval_ms.max(RECONCILE_SCAN_REFRESH_MS),
    );
    ratatui::restore();
    let _ = execute!(stdout(), LeaveAlternateScreen);
    let _ = disable_raw_mode();
    result
}

fn run_loop(terminal: &mut DefaultTerminal, ctx: RepoContext, poll_interval_ms: u64) -> Result<()> {
    let render_feed = RuntimeFeed::open(&ctx.runtime_event_path)?;
    ensure_runtime_service(&ctx)?;
    let repo_root = ctx.repo_root.to_string_lossy().to_string();
    let mut state = RuntimeState::new(repo_root.clone(), "-".to_string());
    state.sync_focus_for_width(terminal.size()?.width);
    state.set_runtime_transport(read_runtime_transport(&ctx));
    let mut cache = AppCache::new(&repo_root);
    let cache_result_rx = cache.take_result_signal_rx();
    cache.set_fitness_mode(state.fitness_view_mode);
    cache.request_scc_refresh(state.repo_root.clone(), false);
    let bootstrap_cutoff = bootstrap_history_cutoff(chrono::Utc::now().timestamp_millis());
    let (signal_tx, signal_rx) = mpsc::channel();
    let (repo_refresh_tx, repo_refresh_rx) = mpsc::channel();
    let (agent_refresh_tx, agent_refresh_rx) = mpsc::channel();
    spawn_terminal_signal_thread(signal_tx.clone());
    if let Some(result_signal_rx) = cache_result_rx {
        spawn_cache_result_signal_thread(result_signal_rx, signal_tx.clone());
    }
    spawn_repo_snapshot_thread(
        ctx.clone(),
        signal_tx.clone(),
        repo_refresh_rx,
        Duration::from_millis(poll_interval_ms),
    );
    spawn_agent_scan_thread(
        state.repo_root.clone(),
        signal_tx.clone(),
        agent_refresh_rx,
        Duration::from_millis(AGENT_SCAN_REFRESH_MS),
    );
    spawn_interval_signal_thread(
        signal_tx.clone(),
        Duration::from_millis(TRANSPORT_REFRESH_MS),
        Duration::from_millis(TRANSPORT_REFRESH_MS),
        {
            let transport_ctx = ctx.clone();
            move || UiSignal::RuntimeTransport(read_runtime_transport(&transport_ctx))
        },
    );
    spawn_interval_signal_thread(
        signal_tx.clone(),
        Duration::from_millis(FITNESS_AUTO_REFRESH_MS),
        Duration::from_millis(FITNESS_AUTO_REFRESH_MS),
        || UiSignal::FitnessAutoRefresh,
    );
    spawn_interval_signal_thread(
        signal_tx.clone(),
        Duration::from_millis(FITNESS_CACHE_CHECK_MS),
        Duration::from_millis(FITNESS_CACHE_CHECK_MS),
        || UiSignal::FitnessMailboxSync,
    );
    spawn_interval_signal_thread(
        signal_tx.clone(),
        Duration::from_millis(SCC_REFRESH_MS),
        Duration::from_millis(SCC_REFRESH_MS),
        || UiSignal::SccRefresh,
    );
    spawn_interval_signal_thread(
        signal_tx.clone(),
        Duration::from_millis(IDLE_REDRAW_MS),
        Duration::from_millis(IDLE_REDRAW_MS),
        || UiSignal::Tick,
    );
    let transcript_ctx = ctx.clone();
    let transcript_signal_tx = signal_tx.clone();
    thread::spawn(move || {
        let mut result = crate::observe::codex_transcript::bootstrap_codex_transcript_messages(
            &transcript_ctx.repo_root,
        )
        .unwrap_or_default();
        result.extend(
            crate::observe::auggie_session::bootstrap_auggie_session_messages(
                &transcript_ctx.repo_root,
            )
            .unwrap_or_default(),
        );
        result.sort_by_key(RuntimeMessage::observed_at_ms);
        let _ = transcript_signal_tx.send(UiSignal::TranscriptBootstrap(result));
    });
    for message in render_feed.read_recent_since(bootstrap_cutoff)? {
        state.apply_message(message);
    }
    let background_feed = RuntimeFeed::open(&ctx.runtime_event_path)?;
    spawn_runtime_feed_thread(background_feed, signal_tx.clone());
    state.prune_stale_sessions();
    if !cache.has_fitness_data() {
        cache.request_fitness_refresh(
            state.repo_root.clone(),
            state.fitness_cache_key(),
            false,
            fitness_run_mode_for(&state),
        );
    }
    cache.sync_results();
    cache.warm_visible_files(&state);
    cache.warm_selected_detail(&state);
    cache.warm_test_mappings(&state);
    state.sync_focus_for_width(terminal.size()?.width);
    terminal.draw(|frame| render(frame, &state, &render_feed, &mut cache))?;

    loop {
        let mut needs_redraw = false;
        let Ok(signal) = signal_rx.recv() else {
            return Ok(());
        };
        if apply_ui_signal(
            signal,
            &mut state,
            &mut cache,
            &repo_refresh_tx,
            &agent_refresh_tx,
            &mut needs_redraw,
        )? == UiLoopAction::Quit
        {
            return Ok(());
        }
        while let Ok(signal) = signal_rx.try_recv() {
            if apply_ui_signal(
                signal,
                &mut state,
                &mut cache,
                &repo_refresh_tx,
                &agent_refresh_tx,
                &mut needs_redraw,
            )? == UiLoopAction::Quit
            {
                return Ok(());
            }
        }
        cache.warm_visible_files(&state);
        cache.warm_selected_detail(&state);
        cache.warm_test_mappings(&state);

        let width = terminal.size()?.width;
        state.sync_focus_for_width(width);
        if needs_redraw {
            terminal.draw(|frame| render(frame, &state, &render_feed, &mut cache))?;
        }
    }
}

fn handle_event(
    state: &mut RuntimeState,
    cache: &mut AppCache,
    event: Event,
) -> Result<UiLoopAction> {
    match event {
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
                return Ok(UiLoopAction::Continue);
            }
            match key.code {
                KeyCode::Char('q') => return Ok(UiLoopAction::Quit),
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
                    return Ok(UiLoopAction::RefreshAll);
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
                    return Ok(UiLoopAction::Quit);
                }
                _ => {}
            }
        }
        Event::Resize(width, _) => state.sync_focus_for_width(width),
        _ => {}
    }
    Ok(UiLoopAction::Continue)
}

fn apply_ui_signal(
    signal: UiSignal,
    state: &mut RuntimeState,
    cache: &mut AppCache,
    repo_refresh_tx: &mpsc::Sender<RefreshCommand>,
    agent_refresh_tx: &mpsc::Sender<RefreshCommand>,
    needs_redraw: &mut bool,
) -> Result<UiLoopAction> {
    match signal {
        UiSignal::Terminal(event) => match handle_event(state, cache, event)? {
            UiLoopAction::Quit => return Ok(UiLoopAction::Quit),
            UiLoopAction::RefreshAll => {
                request_refresh(repo_refresh_tx);
                request_refresh(agent_refresh_tx);
                *needs_redraw = true;
            }
            UiLoopAction::Continue => *needs_redraw = true,
        },
        UiSignal::Feed(messages) => {
            if !messages.is_empty() {
                *needs_redraw = true;
            }
            for message in messages {
                if matches!(message, RuntimeMessage::Git(_)) {
                    request_refresh(repo_refresh_tx);
                }
                if let RuntimeMessage::Fitness(event) = &message {
                    refresh_fitness_from_event(state, cache, event);
                }
                state.apply_message(message);
            }
            state.prune_stale_sessions();
        }
        UiSignal::TranscriptBootstrap(messages) => {
            if !messages.is_empty() {
                request_refresh(repo_refresh_tx);
            }
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
                    request_refresh(repo_refresh_tx);
                }
                state.apply_message(message);
            }
            state.push_hook_status_event(
                chrono::Utc::now().timestamp_millis(),
                format!("transcript backfill complete ({recovered_session_count} sessions)"),
            );
            state.prune_stale_sessions();
            *needs_redraw = true;
        }
        UiSignal::RepoSnapshot(snapshot) => {
            apply_repo_snapshot(state, snapshot);
            *needs_redraw = true;
        }
        UiSignal::DetectedAgents(agents) => {
            state.set_detected_agents(agents);
            *needs_redraw = true;
        }
        UiSignal::RuntimeTransport(transport) => {
            state.set_runtime_transport(transport);
            *needs_redraw = true;
        }
        UiSignal::FitnessAutoRefresh | UiSignal::FitnessMailboxSync => {
            cache.request_fitness_refresh(
                state.repo_root.clone(),
                state.fitness_cache_key(),
                false,
                fitness_run_mode_for(state),
            );
            *needs_redraw = true;
        }
        UiSignal::SccRefresh => {
            cache.request_scc_refresh(state.repo_root.clone(), false);
        }
        UiSignal::CacheResultsReady => {
            if cache.sync_results() {
                *needs_redraw = true;
            }
        }
        UiSignal::Tick => {
            state.prune_stale_sessions();
            *needs_redraw = true;
        }
    }
    Ok(UiLoopAction::Continue)
}

fn spawn_runtime_feed_thread(mut feed: RuntimeFeed, signal_tx: mpsc::Sender<UiSignal>) {
    thread::spawn(move || loop {
        match feed.read_new() {
            Ok(messages) => {
                if !messages.is_empty() && signal_tx.send(UiSignal::Feed(messages)).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
        thread::sleep(Duration::from_millis(RUNTIME_FEED_SIGNAL_MS));
    });
}

fn spawn_terminal_signal_thread(signal_tx: mpsc::Sender<UiSignal>) {
    thread::spawn(move || {
        while let Ok(event) = event::read() {
            if signal_tx.send(UiSignal::Terminal(event)).is_err() {
                break;
            }
        }
    });
}

fn spawn_cache_result_signal_thread(
    result_rx: mpsc::Receiver<()>,
    signal_tx: mpsc::Sender<UiSignal>,
) {
    thread::spawn(move || {
        while result_rx.recv().is_ok() {
            if signal_tx.send(UiSignal::CacheResultsReady).is_err() {
                break;
            }
        }
    });
}

fn spawn_interval_signal_thread<F>(
    signal_tx: mpsc::Sender<UiSignal>,
    initial_delay: Duration,
    interval: Duration,
    mut make_signal: F,
) where
    F: FnMut() -> UiSignal + Send + 'static,
{
    thread::spawn(move || {
        thread::sleep(initial_delay);
        loop {
            if signal_tx.send(make_signal()).is_err() {
                break;
            }
            thread::sleep(interval);
        }
    });
}

fn spawn_repo_snapshot_thread(
    ctx: RepoContext,
    signal_tx: mpsc::Sender<UiSignal>,
    refresh_rx: mpsc::Receiver<RefreshCommand>,
    interval: Duration,
) {
    thread::spawn(move || {
        let mut include_warning = true;
        loop {
            if signal_tx
                .send(UiSignal::RepoSnapshot(load_repo_snapshot(
                    &ctx,
                    include_warning,
                )))
                .is_err()
            {
                break;
            }
            include_warning = false;
            if !wait_for_refresh(&refresh_rx, interval) {
                break;
            }
        }
    });
}

fn spawn_agent_scan_thread(
    repo_root: String,
    signal_tx: mpsc::Sender<UiSignal>,
    refresh_rx: mpsc::Receiver<RefreshCommand>,
    interval: Duration,
) {
    thread::spawn(move || loop {
        if let Ok(agents) = crate::observe::detect::scan_agents(&repo_root) {
            if signal_tx.send(UiSignal::DetectedAgents(agents)).is_err() {
                break;
            }
        }
        if !wait_for_refresh(&refresh_rx, interval) {
            break;
        }
    });
}

fn wait_for_refresh(refresh_rx: &mpsc::Receiver<RefreshCommand>, interval: Duration) -> bool {
    match refresh_rx.recv_timeout(interval) {
        Ok(RefreshCommand::RefreshNow) => {
            while matches!(refresh_rx.try_recv(), Ok(RefreshCommand::RefreshNow)) {}
            true
        }
        Err(mpsc::RecvTimeoutError::Timeout) => true,
        Err(mpsc::RecvTimeoutError::Disconnected) => false,
    }
}

fn request_refresh(refresh_tx: &mpsc::Sender<RefreshCommand>) {
    let _ = refresh_tx.send(RefreshCommand::RefreshNow);
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
    let cache_key = state.fitness_cache_key();
    if cache.ingest_fitness_event(cache_key.clone(), event) {
        return;
    }
    cache.sync_fitness_from_runtime(
        state.repo_root.clone(),
        cache_key,
        fitness_run_mode_for(state),
    );
}

fn apply_repo_status(state: &mut RuntimeState, repo_status: Option<RepoStatusSummary>) {
    let repo_status = repo_status.unwrap_or_default();
    state.branch = repo_status.branch.unwrap_or_else(|| "-".to_string());
    state.set_ahead_count(repo_status.ahead_count);
    state.set_committed_change_summary(repo_status.committed_change_summary);
}

fn read_repo_status(ctx: &RepoContext) -> Result<RepoStatusSummary> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&ctx.repo_root)
        .arg("status")
        .arg("--porcelain=v2")
        .arg("--branch")
        .arg("--untracked-files=no")
        .output()
        .context("run git status --porcelain=v2 --branch")?;
    if !output.status.success() {
        anyhow::bail!("git status --porcelain=v2 --branch failed");
    }

    let status = String::from_utf8(output.stdout).context("decode branch status output")?;
    let mut summary = parse_repo_status(&status);
    summary.committed_change_summary = summary
        .upstream
        .as_deref()
        .and_then(|upstream| read_committed_change_summary(ctx, upstream).ok().flatten());
    Ok(summary)
}

fn parse_repo_status(output: &str) -> RepoStatusSummary {
    let mut branch = None;
    let mut upstream = None;
    let mut ahead_count = None;

    for line in output.lines().map(str::trim) {
        if let Some(value) = line.strip_prefix("# branch.head ") {
            branch = normalize_branch_name(value.trim());
        } else if let Some(value) = line.strip_prefix("# branch.upstream ") {
            upstream = Some(value.trim().to_string());
        } else if let Some(value) = line.strip_prefix("# branch.ab ") {
            ahead_count = parse_branch_ab(value);
        }
    }

    RepoStatusSummary {
        branch,
        upstream,
        ahead_count,
        committed_change_summary: None,
    }
}

fn read_committed_change_summary(
    ctx: &RepoContext,
    upstream_ref: &str,
) -> Result<Option<(usize, usize)>> {
    let range = format!("{upstream_ref}...HEAD");
    let output = Command::new("git")
        .arg("-C")
        .arg(&ctx.repo_root)
        .arg("diff")
        .arg("--shortstat")
        .arg(&range)
        .output()
        .with_context(|| format!("run git diff --shortstat {range}"))?;
    if !output.status.success() {
        anyhow::bail!("git diff --shortstat failed for {range}");
    }

    let stdout = String::from_utf8(output.stdout).context("decode git diff --shortstat output")?;
    Ok(parse_shortstat(&stdout))
}

fn parse_shortstat(output: &str) -> Option<(usize, usize)> {
    let mut additions = 0usize;
    let mut deletions = 0usize;
    let mut saw_metric = false;

    for segment in output.trim().split(',').map(str::trim) {
        let Some(value) = segment
            .split_whitespace()
            .next()
            .and_then(|value| value.parse::<usize>().ok())
        else {
            continue;
        };
        if segment.contains("insertion") {
            additions = value;
            saw_metric = true;
        } else if segment.contains("deletion") {
            deletions = value;
            saw_metric = true;
        }
    }

    saw_metric.then_some((additions, deletions))
}

fn normalize_branch_name(branch: &str) -> Option<String> {
    match branch.trim() {
        "" | "HEAD" | "(detached)" => None,
        value => Some(value.to_string()),
    }
}

fn parse_branch_ab(value: &str) -> Option<usize> {
    value
        .split_whitespace()
        .next()
        .and_then(|count| count.strip_prefix('+'))
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

fn load_repo_snapshot(ctx: &RepoContext, include_warning: bool) -> RepoSnapshot {
    let repo_status = read_repo_status(ctx).ok();
    let dirty = observe::scan_repo(ctx).ok();
    let worktree_count = current_worktree_count(ctx).ok();
    let warning = if include_warning && repo_status.is_none() && dirty.is_none() {
        Some("initial git scan unavailable".to_string())
    } else {
        None
    };
    RepoSnapshot {
        dirty,
        repo_status,
        worktree_count,
        warning,
    }
}

fn apply_repo_snapshot(state: &mut RuntimeState, snapshot: RepoSnapshot) {
    if let Some(dirty) = snapshot.dirty {
        state.sync_dirty_files(dirty);
    }
    apply_repo_status(state, snapshot.repo_status);
    state.set_worktree_count(snapshot.worktree_count);
    if let Some(warning) = snapshot.warning {
        state.push_hook_status_event(chrono::Utc::now().timestamp_millis(), warning);
    }
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

#[path = "run_details.rs"]
mod run_details;
use run_details::*;

#[path = "file_rows.rs"]
mod file_rows;
use file_rows::*;

#[path = "render.rs"]
mod render;
use render::*;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
#[cfg(test)]
#[path = "tests_runtime_matching.rs"]
mod tests_runtime_matching;
