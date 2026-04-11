use crate::models::{
    AgentStats, AttributionConfidence, AttributionEvent, DetectedAgent, DirtyRepoEntry, EntryKind,
    EventLogEntry, EventSource, FileView, FitnessEvent, GitEvent, HookEvent, RuntimeMessage,
    SessionView, DEFAULT_INFERENCE_WINDOW_MS, EVENT_LOG_LIMIT,
};
use chrono::Utc;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusPane {
    /// Unmanaged-run / session list (new harness vocabulary layered on top of sessions)
    Runs,
    Files,
    Detail,
    Fitness,
}

const RESPONSIVE_FOCUS_COMPACT: [FocusPane; 2] = [FocusPane::Files, FocusPane::Detail];
const RESPONSIVE_FOCUS_FULL: [FocusPane; 4] = [
    FocusPane::Runs,
    FocusPane::Files,
    FocusPane::Detail,
    FocusPane::Fitness,
];

impl FocusPane {
    #[allow(dead_code)]
    pub fn label(self) -> &'static str {
        match self {
            FocusPane::Runs => "Runs",
            FocusPane::Files => "Files",
            FocusPane::Detail => "Detail",
            FocusPane::Fitness => "Fitness",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetailMode {
    File,
    Diff,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeMode {
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FitnessViewMode {
    Fast,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventLogFilter {
    All,
    Hook,
    Git,
    Watch,
    Attribution,
}

impl EventLogFilter {
    pub fn label(self) -> &'static str {
        match self {
            EventLogFilter::All => "all",
            EventLogFilter::Hook => "hook",
            EventLogFilter::Git => "git",
            EventLogFilter::Watch => "watch",
            EventLogFilter::Attribution => "attrib",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileListMode {
    Global,
    UnknownConflict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunSortMode {
    Recent,
    Started,
    Files,
    Name,
}

impl RunSortMode {
    pub fn label(self) -> &'static str {
        match self {
            RunSortMode::Recent => "recent",
            RunSortMode::Started => "started",
            RunSortMode::Files => "files",
            RunSortMode::Name => "name",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunFilterMode {
    All,
    Active,
    Attention,
}

impl RunFilterMode {
    pub fn label(self) -> &'static str {
        match self {
            RunFilterMode::All => "all",
            RunFilterMode::Active => "active",
            RunFilterMode::Attention => "attention",
        }
    }
}

pub const UNKNOWN_SESSION_ID: &str = "__unknown__";
const PAGE_STEP: usize = 10;
const DETAIL_PAGE_STEP: u16 = 12;

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct SessionListItem {
    pub session_id: String,
    pub display_name: String,
    pub client: String,
    pub source: Option<String>,
    pub model: Option<String>,
    pub status: String,
    pub tmux_pane: Option<String>,
    pub started_at_ms: i64,
    pub last_seen_at_ms: i64,
    pub touched_files_count: usize,
    pub exact_count: usize,
    pub inferred_count: usize,
    pub unknown_count: usize,
    pub agent_summary: Option<String>,
    pub last_event_name: Option<String>,
    pub last_tool_name: Option<String>,
    pub attached_agent_key: Option<String>,
    pub is_synthetic_agent_run: bool,
    pub is_unknown_bucket: bool,
}

#[derive(Debug)]
pub struct RuntimeState {
    pub repo_root: String,
    pub repo_name: String,
    pub branch: String,
    pub ahead_count: Option<usize>,
    pub worktree_count: Option<usize>,
    pub sessions: BTreeMap<String, SessionView>,
    pub files: BTreeMap<String, FileView>,
    pub event_log: VecDeque<EventLogEntry>,
    pub follow_mode: bool,
    pub file_list_mode: FileListMode,
    pub run_sort_mode: RunSortMode,
    pub run_filter_mode: RunFilterMode,
    pub focus: FocusPane,
    pub detail_mode: DetailMode,
    pub theme_mode: ThemeMode,
    pub fitness_view_mode: FitnessViewMode,
    pub event_log_filter: EventLogFilter,
    pub detail_scroll: u16,
    pub detail_scroll_cache: BTreeMap<String, u16>,
    pub fitness_scroll: u16,
    pub selected_run: usize,
    pub selected_session: usize,
    pub selected_file: usize,
    pub last_refresh_at_ms: i64,
    pub last_file_hook_at_ms: Option<i64>,
    pub runtime_transport: String,
    pub search_query: String,
    pub search_active: bool,
    pub detected_agents: Vec<DetectedAgent>,
    pub agent_stats: AgentStats,
    cached_session_items: Vec<SessionListItem>,
    cached_file_item_keys: Vec<String>,
    cached_unmatched_agent_keys: Vec<String>,
}

impl RuntimeState {
    pub fn new(repo_root: String, repo_name: String, branch: String) -> Self {
        let mut state = Self {
            repo_root,
            repo_name,
            branch,
            ahead_count: None,
            worktree_count: None,
            sessions: BTreeMap::new(),
            files: BTreeMap::new(),
            event_log: VecDeque::new(),
            follow_mode: true,
            file_list_mode: FileListMode::Global,
            run_sort_mode: RunSortMode::Recent,
            run_filter_mode: RunFilterMode::All,
            focus: FocusPane::Runs,
            detail_mode: DetailMode::Diff,
            theme_mode: ThemeMode::Dark,
            fitness_view_mode: FitnessViewMode::Fast,
            event_log_filter: EventLogFilter::All,
            detail_scroll: 0,
            detail_scroll_cache: BTreeMap::new(),
            fitness_scroll: 0,
            selected_run: 0,
            selected_session: 0,
            selected_file: 0,
            last_refresh_at_ms: Utc::now().timestamp_millis(),
            last_file_hook_at_ms: None,
            runtime_transport: "feed".to_string(),
            search_query: String::new(),
            search_active: false,
            detected_agents: Vec::new(),
            agent_stats: AgentStats::default(),
            cached_session_items: Vec::new(),
            cached_file_item_keys: Vec::new(),
            cached_unmatched_agent_keys: Vec::new(),
        };
        state.rebuild_views();
        state
    }

    pub fn apply_message(&mut self, message: RuntimeMessage) {
        self.last_refresh_at_ms = message.observed_at_ms();
        match message {
            RuntimeMessage::Hook(event) => self.apply_hook_event(event),
            RuntimeMessage::Git(event) => self.apply_git_event(event),
            RuntimeMessage::Attribution(event) => self.apply_attribution_event(event),
            RuntimeMessage::Fitness(event) => self.apply_fitness_event(event),
        }
        self.clamp_selection();
    }

    pub fn sync_dirty_files(&mut self, dirty: Vec<DirtyRepoEntry>) {
        let now_ms = Utc::now().timestamp_millis();
        let inferred_session_id = self.single_active_session_id(now_ms);
        let seen: BTreeSet<String> = dirty.iter().map(|(p, _, _, _)| p.clone()).collect();
        let mut watch_events = Vec::new();
        let mut attrib_events = Vec::new();

        for file in self.files.values_mut() {
            if !seen.contains(&file.rel_path) && file.dirty {
                watch_events.push(format!("watch clean {}", file.rel_path));
                file.dirty = false;
                file.state_code = "clean".to_string();
            }
        }

        for (rel_path, state_code, mtime_ms, entry_kind) in dirty {
            let file = self
                .files
                .entry(rel_path.clone())
                .or_insert_with(|| FileView {
                    rel_path: rel_path.clone(),
                    dirty: true,
                    state_code: state_code.clone(),
                    entry_kind,
                    last_modified_at_ms: now_ms,
                    last_session_id: None,
                    confidence: AttributionConfidence::Unknown,
                    conflicted: false,
                    touched_by: BTreeSet::new(),
                    recent_events: Vec::new(),
                });
            let was_dirty = file.dirty;
            let previous_state = file.state_code.clone();
            let previous_mtime = file.last_modified_at_ms;
            file.dirty = true;
            file.state_code = state_code.clone();
            file.entry_kind = entry_kind;
            if let Some(mtime) = mtime_ms {
                file.last_modified_at_ms = mtime;
            }
            let changed_on_disk = mtime_ms
                .map(|mtime| mtime != previous_mtime)
                .unwrap_or(false);
            if let Some(session_id) = inferred_session_id.as_ref() {
                if file.last_session_id.as_deref() != Some(session_id.as_str())
                    && (matches!(
                        file.confidence,
                        AttributionConfidence::Unknown | AttributionConfidence::Inferred
                    ) || file.last_session_id.is_none())
                {
                    file.last_session_id = Some(session_id.clone());
                    file.confidence = AttributionConfidence::Inferred;
                }
                file.touched_by.insert(session_id.clone());
            }
            if changed_on_disk || !was_dirty || previous_state != state_code {
                file.recent_events.insert(
                    0,
                    match inferred_session_id.as_ref() {
                        Some(session_id) => {
                            format!("watch {} {}", file.state_code, short_session(session_id))
                        }
                        None => format!("watch {}", file.state_code),
                    },
                );
                file.recent_events.truncate(8);
            }
            if !was_dirty || previous_state != state_code || changed_on_disk {
                watch_events.push(format!("watch {} {}", file.state_code, rel_path));
                if inferred_session_id.is_none()
                    && (file.last_session_id.is_none()
                        || matches!(file.confidence, AttributionConfidence::Unknown))
                {
                    attrib_events.push(format!("miss {}", rel_path));
                }
            }
        }
        self.last_refresh_at_ms = now_ms;
        self.prune_stale_sessions();
        for event in watch_events {
            self.push_watch_event(now_ms, event);
        }
        for event in attrib_events {
            self.push_attribution_event(now_ms, event);
        }
        self.clamp_selection();
    }

    #[cfg(test)]
    pub fn session_items(&self) -> &[SessionListItem] {
        &self.cached_session_items
    }

    pub fn runs(&self) -> &[SessionListItem] {
        &self.cached_session_items
    }

    pub fn selected_workspace_scope_label(&self) -> String {
        self.selected_workspace_path()
            .map(|path| canonical_repo_identity(&path))
            .unwrap_or_else(|| canonical_repo_identity(&self.repo_root))
    }

    pub fn selected_workspace_agent_count(&self) -> usize {
        let workspace = self
            .selected_workspace_path()
            .unwrap_or_else(|| self.repo_root.clone());
        let workspace_id = canonical_repo_identity(&workspace);
        self.detected_agents
            .iter()
            .filter(|agent| {
                agent
                    .cwd
                    .as_deref()
                    .is_some_and(|cwd| canonical_repo_identity(cwd) == workspace_id)
            })
            .count()
    }

    fn compute_session_items(&self) -> Vec<SessionListItem> {
        let agent_matches = self.compute_agent_match_state();
        let mut items: Vec<_> = self
            .sessions
            .values()
            .filter(|session| self.matches_session_search(session))
            .map(|session| {
                let (exact_count, inferred_count, unknown_count) =
                    self.session_confidence_counts(&session.session_id);
                SessionListItem {
                    session_id: session.session_id.clone(),
                    display_name: session_display_name(session),
                    client: session.client.clone(),
                    source: session.source.clone(),
                    model: session.model.clone(),
                    status: session.status.clone(),
                    tmux_pane: session.tmux_pane.clone(),
                    started_at_ms: session.started_at_ms,
                    last_seen_at_ms: session.last_seen_at_ms,
                    touched_files_count: session
                        .touched_files
                        .len()
                        .max(exact_count + inferred_count + unknown_count),
                    exact_count,
                    inferred_count,
                    unknown_count,
                    agent_summary: agent_matches.session_summary(&session.session_id),
                    last_event_name: session.last_event_name.clone(),
                    last_tool_name: session.last_tool_name.clone(),
                    attached_agent_key: None,
                    is_synthetic_agent_run: false,
                    is_unknown_bucket: false,
                }
            })
            .collect();
        let now_ms = Utc::now().timestamp_millis();
        items.extend(
            self.unmatched_agents_for_runs(&agent_matches)
                .into_iter()
                .filter(|agent| self.matches_detected_agent_search(agent))
                .map(|agent| SessionListItem {
                    session_id: format!("agent:{}:{}", agent.name.to_ascii_lowercase(), agent.pid),
                    display_name: format!("{}#{}", agent.name, agent.pid),
                    client: agent.name.to_ascii_lowercase(),
                    source: Some("process-scan".to_string()),
                    model: None,
                    status: agent.status.to_ascii_lowercase(),
                    tmux_pane: None,
                    started_at_ms: now_ms.saturating_sub((agent.uptime_seconds as i64) * 1000),
                    last_seen_at_ms: now_ms,
                    touched_files_count: 0,
                    exact_count: 0,
                    inferred_count: 0,
                    unknown_count: 0,
                    agent_summary: Some(format!(
                        "agent {}#{}",
                        agent.name.to_ascii_lowercase(),
                        agent.pid
                    )),
                    last_event_name: Some("process-scan".to_string()),
                    last_tool_name: None,
                    attached_agent_key: Some(agent.key.clone()),
                    is_synthetic_agent_run: true,
                    is_unknown_bucket: false,
                }),
        );
        let unknown_count = self
            .files
            .values()
            .filter(|file| {
                file.conflicted
                    || matches!(file.confidence, AttributionConfidence::Unknown)
                    || file.last_session_id.is_none()
                    || file.touched_by.is_empty()
            })
            .filter(|file| self.matches_file_search(file))
            .count();
        if unknown_count > 0 {
            items.push(SessionListItem {
                session_id: UNKNOWN_SESSION_ID.to_string(),
                display_name: "Unknown / review".to_string(),
                client: "unknown".to_string(),
                source: None,
                model: None,
                status: "unknown".to_string(),
                tmux_pane: None,
                started_at_ms: self.last_refresh_at_ms,
                last_seen_at_ms: self.last_refresh_at_ms,
                touched_files_count: unknown_count,
                exact_count: 0,
                inferred_count: 0,
                unknown_count,
                agent_summary: None,
                last_event_name: Some("review".to_string()),
                last_tool_name: None,
                attached_agent_key: None,
                is_synthetic_agent_run: false,
                is_unknown_bucket: true,
            });
        }
        items.retain(|item| self.matches_run_filter(item));
        items.sort_by(|a, b| compare_run_items(a, b, self.run_sort_mode));
        items
    }

    #[cfg(test)]
    pub fn selected_session_id(&self) -> Option<String> {
        self.cached_session_items
            .get(self.selected_session)
            .map(|session| session.session_id.clone())
    }

    /// Selected item in the Runs pane (maps to a session in unmanaged mode).
    #[allow(dead_code)]
    pub fn selected_run_item(&self) -> Option<&SessionListItem> {
        self.cached_session_items.get(self.selected_run)
    }

    #[cfg(test)]
    pub fn unmatched_agents(&self) -> Vec<&DetectedAgent> {
        self.cached_unmatched_agent_keys
            .iter()
            .filter_map(|key| self.detected_agents.iter().find(|agent| &agent.key == key))
            .collect()
    }

    fn compute_file_item_keys(&self) -> Vec<String> {
        let mut items: Vec<_> = self
            .files
            .values()
            .filter(|file| file.dirty || file.conflicted)
            .filter(|file| self.matches_selected_workspace_file_scope(file))
            .filter(|file| self.matches_file_search(file))
            .collect();
        match self.file_list_mode {
            FileListMode::Global => {}
            FileListMode::UnknownConflict => {
                items.retain(|file| {
                    file.conflicted
                        || matches!(file.confidence, AttributionConfidence::Unknown)
                        || file.touched_by.len() > 1
                        || file.last_session_id.is_none()
                });
            }
        }
        items.sort_by(|a, b| {
            b.last_modified_at_ms
                .cmp(&a.last_modified_at_ms)
                .then_with(|| a.rel_path.cmp(&b.rel_path))
        });
        items
            .into_iter()
            .map(|file| file.rel_path.clone())
            .collect()
    }

    pub fn file_items(&self) -> Vec<&FileView> {
        self.cached_file_item_keys
            .iter()
            .filter_map(|key| self.files.get(key))
            .collect()
    }

    pub fn selected_file(&self) -> Option<&FileView> {
        self.cached_file_item_keys
            .get(self.selected_file)
            .and_then(|key| self.files.get(key))
    }

    #[allow(dead_code)]
    pub fn selected_file_position(&self) -> Option<(usize, usize)> {
        let len = self.cached_file_item_keys.len();
        if len == 0 {
            None
        } else {
            Some((self.selected_file.min(len - 1), len))
        }
    }

    pub fn cycle_focus_for_width(&mut self, width: u16) {
        let panes = focus_panes_for_width(width);
        let index = panes
            .iter()
            .position(|pane| *pane == self.focus)
            .unwrap_or(0);
        self.focus = panes[(index + 1) % panes.len()];
    }

    pub fn sync_focus_for_width(&mut self, width: u16) {
        let panes = focus_panes_for_width(width);
        if !panes.contains(&self.focus) {
            self.focus = panes[0];
        }
    }

    pub fn move_selection_up(&mut self) {
        match self.focus {
            FocusPane::Runs => {
                self.set_selected_run(self.selected_run.saturating_sub(1));
            }
            FocusPane::Files => {
                self.selected_file = self.selected_file.saturating_sub(1);
            }
            FocusPane::Detail => {
                self.set_detail_scroll(self.detail_scroll.saturating_sub(1));
            }
            FocusPane::Fitness => {
                self.fitness_scroll = self.fitness_scroll.saturating_sub(1);
            }
        }
    }

    pub fn move_selection_down(&mut self) {
        match self.focus {
            FocusPane::Runs => {
                let len = self.cached_session_items.len();
                if len > 0 {
                    self.set_selected_run((self.selected_run + 1).min(len - 1));
                }
            }
            FocusPane::Files => {
                let len = self.cached_file_item_keys.len();
                if len > 0 {
                    self.selected_file = (self.selected_file + 1).min(len - 1);
                }
            }
            FocusPane::Detail => {
                self.set_detail_scroll(self.detail_scroll.saturating_add(1));
            }
            FocusPane::Fitness => {
                self.fitness_scroll = self.fitness_scroll.saturating_add(1);
            }
        }
    }

    pub fn page_up(&mut self) {
        match self.focus {
            FocusPane::Runs => {
                self.set_selected_run(self.selected_run.saturating_sub(PAGE_STEP));
            }
            FocusPane::Files => {
                self.selected_file = self.selected_file.saturating_sub(PAGE_STEP);
                self.restore_detail_scroll_for_selection();
            }
            FocusPane::Detail => {
                self.set_detail_scroll(self.detail_scroll.saturating_sub(DETAIL_PAGE_STEP));
            }
            FocusPane::Fitness => {
                self.fitness_scroll = self.fitness_scroll.saturating_sub(DETAIL_PAGE_STEP);
            }
        }
    }

    pub fn page_down(&mut self) {
        match self.focus {
            FocusPane::Runs => {
                let len = self.cached_session_items.len();
                if len > 0 {
                    self.set_selected_run((self.selected_run + PAGE_STEP).min(len - 1));
                }
            }
            FocusPane::Files => {
                let len = self.cached_file_item_keys.len();
                if len > 0 {
                    self.selected_file = (self.selected_file + PAGE_STEP).min(len - 1);
                    self.restore_detail_scroll_for_selection();
                }
            }
            FocusPane::Detail => {
                self.set_detail_scroll(self.detail_scroll.saturating_add(DETAIL_PAGE_STEP));
            }
            FocusPane::Fitness => {
                self.fitness_scroll = self.fitness_scroll.saturating_add(DETAIL_PAGE_STEP);
            }
        }
    }

    pub fn toggle_follow_mode(&mut self) {
        self.follow_mode = !self.follow_mode;
    }

    pub fn set_runtime_transport(&mut self, transport: impl Into<String>) {
        self.runtime_transport = transport.into();
    }

    pub fn set_ahead_count(&mut self, count: Option<usize>) {
        self.ahead_count = count;
    }

    pub fn set_worktree_count(&mut self, count: Option<usize>) {
        self.worktree_count = count;
    }

    pub fn should_run_fallback_scan(&self, now_ms: i64, idle_window_ms: i64) -> bool {
        match self.last_file_hook_at_ms {
            Some(last_hook_ms) => now_ms.saturating_sub(last_hook_ms) >= idle_window_ms,
            None => true,
        }
    }

    pub fn set_detected_agents(&mut self, agents: Vec<DetectedAgent>) {
        self.agent_stats = crate::detect::calculate_stats(&agents);
        self.detected_agents = agents;
        self.clamp_selection();
    }

    pub fn toggle_theme_mode(&mut self) {
        self.theme_mode = match self.theme_mode {
            ThemeMode::Dark => ThemeMode::Light,
            ThemeMode::Light => ThemeMode::Dark,
        };
    }

    pub fn set_event_log_filter(&mut self, filter: EventLogFilter) {
        self.event_log_filter = filter;
    }

    pub fn cancel_search(&mut self) {
        self.search_active = false;
    }

    pub fn clear_search(&mut self) {
        self.search_active = false;
        self.search_query.clear();
        self.clamp_selection();
    }

    pub fn push_search_char(&mut self, ch: char) {
        self.search_active = true;
        self.search_query.push(ch);
        self.clamp_selection();
    }

    pub fn pop_search_char(&mut self) {
        self.search_query.pop();
        self.clamp_selection();
    }

    pub fn cycle_file_list_mode(&mut self) {
        self.file_list_mode = match self.file_list_mode {
            FileListMode::Global => FileListMode::UnknownConflict,
            FileListMode::UnknownConflict => FileListMode::Global,
        };
        self.rebuild_views();
        self.selected_file = 0;
        self.restore_detail_scroll_for_selection();
    }

    pub fn cycle_run_sort_mode(&mut self) {
        self.run_sort_mode = match self.run_sort_mode {
            RunSortMode::Recent => RunSortMode::Started,
            RunSortMode::Started => RunSortMode::Files,
            RunSortMode::Files => RunSortMode::Name,
            RunSortMode::Name => RunSortMode::Recent,
        };
        self.rebuild_views();
        self.set_selected_run(0);
    }

    pub fn cycle_run_filter_mode(&mut self) {
        self.run_filter_mode = match self.run_filter_mode {
            RunFilterMode::All => RunFilterMode::Active,
            RunFilterMode::Active => RunFilterMode::Attention,
            RunFilterMode::Attention => RunFilterMode::All,
        };
        self.rebuild_views();
        self.set_selected_run(0);
    }

    pub fn toggle_detail_mode(&mut self) {
        self.detail_mode = match self.detail_mode {
            DetailMode::Diff => DetailMode::File,
            DetailMode::File => DetailMode::Diff,
        };
        self.restore_detail_scroll_for_selection();
    }

    pub fn select_prev_file(&mut self) {
        let len = self.cached_file_item_keys.len();
        if len == 0 {
            return;
        }
        self.selected_file = self.selected_file.saturating_sub(1);
        self.restore_detail_scroll_for_selection();
    }

    pub fn select_next_file(&mut self) {
        let len = self.cached_file_item_keys.len();
        if len == 0 {
            return;
        }
        self.selected_file = (self.selected_file + 1).min(len - 1);
        self.restore_detail_scroll_for_selection();
    }

    #[cfg(test)]
    pub fn selected_file_assignment_message(&self) -> Option<RuntimeMessage> {
        let session_id = self.selected_session_id()?;
        if session_id == UNKNOWN_SESSION_ID {
            return None;
        }
        if self
            .selected_run_item()
            .is_some_and(|item| item.is_synthetic_agent_run)
        {
            return None;
        }
        let file = self.selected_file()?;
        Some(RuntimeMessage::Attribution(AttributionEvent {
            repo_root: self.repo_root.clone(),
            observed_at_ms: Utc::now().timestamp_millis(),
            rel_path: file.rel_path.clone(),
            session_id,
            confidence: AttributionConfidence::Inferred.as_str().to_string(),
            reason: "manual-assign".to_string(),
        }))
    }

    pub fn visible_event_log_items(&self) -> Vec<&EventLogEntry> {
        self.event_log
            .iter()
            .filter(|entry| match self.event_log_filter {
                EventLogFilter::All => true,
                EventLogFilter::Hook => entry.source == EventSource::Hook,
                EventLogFilter::Git => entry.source == EventSource::Git,
                EventLogFilter::Watch => entry.source == EventSource::Watch,
                EventLogFilter::Attribution => entry.source == EventSource::Attribution,
            })
            .collect()
    }

    #[cfg(test)]
    pub fn refresh_views(&mut self) {
        self.clamp_selection();
    }

    fn apply_hook_event(&mut self, event: HookEvent) {
        if !event.file_paths.is_empty() {
            self.last_file_hook_at_ms = Some(event.observed_at_ms);
        }
        {
            let session = self
                .sessions
                .entry(event.session_id.clone())
                .or_insert_with(|| SessionView {
                    session_id: event.session_id.clone(),
                    display_name: event.session_display_name.clone(),
                    cwd: event.cwd.clone(),
                    model: event.model.clone(),
                    client: event.client.clone(),
                    transcript_path: event.transcript_path.clone(),
                    source: event.session_source.clone(),
                    started_at_ms: event.observed_at_ms,
                    last_seen_at_ms: event.observed_at_ms,
                    status: "active".to_string(),
                    tmux_pane: event.tmux_pane.clone(),
                    touched_files: BTreeSet::new(),
                    last_turn_id: event.turn_id.clone(),
                    last_event_name: Some(event.event_name.clone()),
                    last_tool_name: event.tool_name.clone(),
                });

            session.cwd = event.cwd.clone();
            if event.session_display_name.is_some() {
                session.display_name = event.session_display_name.clone();
            }
            session.model = event.model.clone().or_else(|| session.model.clone());
            session.client = event.client.clone();
            if event.transcript_path.is_some() {
                session.transcript_path = event.transcript_path.clone();
            }
            if event.session_source.is_some() {
                session.source = event.session_source.clone();
            }
            session.last_seen_at_ms = event.observed_at_ms;
            session.last_turn_id = event.turn_id.clone();
            session.last_event_name = Some(event.event_name.clone());
            session.last_tool_name = event.tool_name.clone();
            session.tmux_pane = event
                .tmux_pane
                .clone()
                .or_else(|| session.tmux_pane.clone());
            session.status = if is_stop_event(&event.event_name) {
                "stopped".to_string()
            } else {
                "active".to_string()
            };
        }

        self.push_event(
            event.observed_at_ms,
            EventSource::Hook,
            format!(
                "{} {} {}",
                short_session(&event.session_id),
                event.event_name,
                event.tool_name.unwrap_or_else(|| "-".to_string())
            ),
        );

        for rel_path in event.file_paths {
            if let Some(session) = self.sessions.get_mut(&event.session_id) {
                session.touched_files.insert(rel_path.clone());
            }
            let file = self
                .files
                .entry(rel_path.clone())
                .or_insert_with(|| FileView {
                    rel_path: rel_path.clone(),
                    dirty: true,
                    state_code: "modify".to_string(),
                    entry_kind: EntryKind::File,
                    last_modified_at_ms: event.observed_at_ms,
                    last_session_id: Some(event.session_id.clone()),
                    confidence: AttributionConfidence::Exact,
                    conflicted: false,
                    touched_by: BTreeSet::new(),
                    recent_events: Vec::new(),
                });
            if let Some(existing_session) = &file.last_session_id {
                if existing_session != &event.session_id {
                    file.conflicted = true;
                }
            }
            file.dirty = true;
            file.last_modified_at_ms = event.observed_at_ms;
            file.last_session_id = Some(event.session_id.clone());
            file.confidence = AttributionConfidence::Exact;
            file.touched_by.insert(event.session_id.clone());
            file.recent_events.insert(
                0,
                format!("{} {}", event.event_name, short_session(&event.session_id)),
            );
            file.recent_events.truncate(8);
        }
    }

    fn apply_git_event(&mut self, event: GitEvent) {
        self.push_event(
            event.observed_at_ms,
            EventSource::Git,
            format!(
                "git {} {}",
                event.event_name,
                event.branch.unwrap_or_else(|| "-".to_string())
            ),
        );
        if matches!(
            event.event_name.as_str(),
            "post-commit"
                | "post-checkout"
                | "post-merge"
                | "git-reset"
                | "git-restore"
                | "git-checkout"
        ) {
            for file in self.files.values_mut() {
                file.dirty = false;
                file.state_code = "clean".to_string();
            }
        }
    }

    fn apply_attribution_event(&mut self, event: AttributionEvent) {
        let file = self
            .files
            .entry(event.rel_path.clone())
            .or_insert_with(|| FileView {
                rel_path: event.rel_path.clone(),
                dirty: true,
                state_code: "modify".to_string(),
                entry_kind: EntryKind::File,
                last_modified_at_ms: event.observed_at_ms,
                last_session_id: Some(event.session_id.clone()),
                confidence: AttributionConfidence::from_str(&event.confidence),
                conflicted: false,
                touched_by: BTreeSet::new(),
                recent_events: Vec::new(),
            });
        file.last_session_id = Some(event.session_id.clone());
        file.last_modified_at_ms = event.observed_at_ms;
        file.confidence = AttributionConfidence::from_str(&event.confidence);
        file.conflicted = false;
        file.touched_by.insert(event.session_id.clone());
        file.recent_events.insert(
            0,
            format!("{} {}", event.reason, short_session(&event.session_id)),
        );
        file.recent_events.truncate(8);

        if let Some(session) = self.sessions.get_mut(&event.session_id) {
            session.touched_files.insert(event.rel_path.clone());
            session.last_seen_at_ms = event.observed_at_ms;
        }

        self.push_attribution_event(
            event.observed_at_ms,
            format!(
                "assign {} {}",
                short_session(&event.session_id),
                event.rel_path
            ),
        );
    }

    fn apply_fitness_event(&mut self, event: FitnessEvent) {
        let score = event
            .final_score
            .map(|value| format!("{value:.1}%"))
            .unwrap_or_else(|| "-".to_string());
        self.push_event(
            event.observed_at_ms,
            EventSource::Fitness,
            format!("fitness {} {} {}", event.mode, event.status, score),
        );
    }

    pub fn push_watch_event(&mut self, observed_at_ms: i64, message: String) {
        self.push_event(observed_at_ms, EventSource::Watch, message);
    }

    pub fn push_attribution_event(&mut self, observed_at_ms: i64, message: String) {
        self.push_event(observed_at_ms, EventSource::Attribution, message);
    }

    fn push_event(&mut self, observed_at_ms: i64, source: EventSource, message: String) {
        self.event_log.push_front(EventLogEntry {
            observed_at_ms,
            source,
            message,
        });
        while self.event_log.len() > EVENT_LOG_LIMIT {
            self.event_log.pop_back();
        }
    }

    fn prune_stale_sessions(&mut self) {
        let cutoff = Utc::now().timestamp_millis() - DEFAULT_INFERENCE_WINDOW_MS;
        for session in self.sessions.values_mut() {
            if session.status != "stopped" {
                session.status = if session.last_seen_at_ms >= cutoff {
                    "active".to_string()
                } else {
                    "idle".to_string()
                };
            }
        }
    }

    fn single_active_session_id(&self, now_ms: i64) -> Option<String> {
        let cutoff = now_ms - DEFAULT_INFERENCE_WINDOW_MS;
        let mut active = self
            .sessions
            .values()
            .filter(|session| session.status != "stopped" && session.last_seen_at_ms >= cutoff)
            .map(|session| session.session_id.clone());
        let first = active.next()?;
        if active.next().is_some() {
            None
        } else {
            Some(first)
        }
    }

    fn clamp_selection(&mut self) {
        self.rebuild_views();
        let session_len = self.cached_session_items.len();
        if session_len == 0 {
            self.selected_run = 0;
            self.selected_session = 0;
        } else {
            self.selected_run = self.selected_run.min(session_len - 1);
            self.selected_session = self.selected_session.min(session_len - 1);
        }

        self.cached_file_item_keys = self.compute_file_item_keys();
        let file_len = self.cached_file_item_keys.len();
        if file_len == 0 {
            self.selected_file = 0;
        } else {
            self.selected_file = self.selected_file.min(file_len - 1);
        }
        self.restore_detail_scroll_for_selection();
    }

    fn rebuild_views(&mut self) {
        self.cached_session_items = self.compute_session_items();
        let session_len = self.cached_session_items.len();
        if session_len == 0 {
            self.selected_run = 0;
            self.selected_session = 0;
        } else {
            self.selected_run = self.selected_run.min(session_len - 1);
            self.selected_session = self.selected_session.min(session_len - 1);
        }
        self.cached_unmatched_agent_keys = self.compute_unmatched_agent_keys();
        self.cached_file_item_keys = self.compute_file_item_keys();
    }

    fn matches_run_filter(&self, item: &SessionListItem) -> bool {
        match self.run_filter_mode {
            RunFilterMode::All => true,
            RunFilterMode::Active => item.status == "active",
            RunFilterMode::Attention => {
                item.is_unknown_bucket
                    || item.is_synthetic_agent_run
                    || item.unknown_count > 0
                    || matches!(
                        item.status.as_str(),
                        "idle" | "unknown" | "stopped" | "ended"
                    )
            }
        }
    }

    fn set_selected_run(&mut self, index: usize) {
        self.selected_run = index;
        self.selected_session = index;
        self.cached_file_item_keys = self.compute_file_item_keys();
        let file_len = self.cached_file_item_keys.len();
        if file_len == 0 {
            self.selected_file = 0;
        } else {
            self.selected_file = self.selected_file.min(file_len - 1);
        }
        self.restore_detail_scroll_for_selection();
    }

    fn unmatched_agents_for_runs<'a>(
        &'a self,
        matches: &AgentMatchState,
    ) -> Vec<&'a DetectedAgent> {
        self.detected_agents
            .iter()
            .filter(|agent| !matches.matched_agent_keys.contains(&agent.key))
            .filter(|agent| is_repo_local_agent(agent, &self.repo_root))
            .collect()
    }

    pub(crate) fn selected_workspace_path(&self) -> Option<String> {
        let run = self.selected_run_item()?;
        if let Some(agent) = run
            .attached_agent_key
            .as_ref()
            .and_then(|key| self.detected_agents.iter().find(|agent| &agent.key == key))
        {
            return agent.cwd.clone().or_else(|| Some(self.repo_root.clone()));
        }
        if run.is_unknown_bucket {
            return Some(self.repo_root.clone());
        }
        self.sessions
            .get(&run.session_id)
            .map(|session| session.cwd.clone())
            .or_else(|| Some(self.repo_root.clone()))
    }

    fn matches_selected_workspace_file_scope(&self, _file: &FileView) -> bool {
        let workspace_id = self
            .selected_workspace_path()
            .map(|path| canonical_repo_identity(&path))
            .unwrap_or_else(|| canonical_repo_identity(&self.repo_root));
        workspace_id == canonical_repo_identity(&self.repo_root)
    }

    fn matches_session_search(&self, session: &SessionView) -> bool {
        if self.search_query.is_empty() {
            return true;
        }
        let needle = self.search_query.to_ascii_lowercase();
        session.session_id.to_ascii_lowercase().contains(&needle)
            || session
                .display_name
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .contains(&needle)
            || session
                .model
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .contains(&needle)
            || session
                .tmux_pane
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .contains(&needle)
    }

    fn matches_detected_agent_search(&self, agent: &DetectedAgent) -> bool {
        if self.search_query.is_empty() {
            return true;
        }
        let needle = self.search_query.to_ascii_lowercase();
        agent.name.to_ascii_lowercase().contains(&needle)
            || agent.vendor.to_ascii_lowercase().contains(&needle)
            || agent.pid.to_string().contains(&needle)
            || agent.command.to_ascii_lowercase().contains(&needle)
            || agent
                .cwd
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .contains(&needle)
    }

    fn matches_file_search(&self, file: &FileView) -> bool {
        if self.search_query.is_empty() {
            return true;
        }
        let needle = self.search_query.to_ascii_lowercase();
        file.rel_path.to_ascii_lowercase().contains(&needle)
            || file
                .last_session_id
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .contains(&needle)
            || file.state_code.to_ascii_lowercase().contains(&needle)
    }

    fn set_detail_scroll(&mut self, value: u16) {
        self.detail_scroll = value;
        if matches!(self.detail_mode, DetailMode::File | DetailMode::Diff) {
            if let Some(file) = self.selected_file() {
                self.detail_scroll_cache
                    .insert(file.rel_path.clone(), self.detail_scroll);
            }
        }
    }

    fn restore_detail_scroll_for_selection(&mut self) {
        if matches!(self.detail_mode, DetailMode::File | DetailMode::Diff) {
            if let Some(file) = self.selected_file() {
                self.detail_scroll = self
                    .detail_scroll_cache
                    .get(&file.rel_path)
                    .copied()
                    .unwrap_or(0);
                return;
            }
        }
        self.detail_scroll = 0;
    }

    fn session_confidence_counts(&self, session_id: &str) -> (usize, usize, usize) {
        let mut exact_count = 0;
        let mut inferred_count = 0;
        let mut unknown_count = 0;

        for file in self.files.values().filter(|file| {
            file.dirty
                && (file.last_session_id.as_deref() == Some(session_id)
                    || file.touched_by.contains(session_id))
        }) {
            if file.conflicted {
                unknown_count += 1;
                continue;
            }
            match file.confidence {
                AttributionConfidence::Exact => exact_count += 1,
                AttributionConfidence::Inferred => inferred_count += 1,
                AttributionConfidence::Unknown => unknown_count += 1,
            }
        }

        (exact_count, inferred_count, unknown_count)
    }

    fn compute_unmatched_agent_keys(&self) -> Vec<String> {
        let matches = self.compute_agent_match_state();
        self.detected_agents
            .iter()
            .filter(|agent| !matches.matched_agent_keys.contains(&agent.key))
            .map(|agent| agent.key.clone())
            .collect()
    }

    fn compute_agent_match_state(&self) -> AgentMatchState {
        let mut session_matches: BTreeMap<String, SessionAgentMatch> = BTreeMap::new();
        let visible_sessions: Vec<_> = self
            .sessions
            .values()
            .filter(|session| self.matches_session_search(session))
            .collect();

        for agent in &self.detected_agents {
            let mut scored: Vec<_> = visible_sessions
                .iter()
                .filter_map(|session| {
                    let score = session_agent_match_score(session, agent);
                    (score > 0).then_some((score, session.session_id.as_str()))
                })
                .collect();
            if scored.is_empty() {
                continue;
            }
            scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(b.1)));
            let best = scored[0].0;
            let runner_up = scored.get(1).map(|item| item.0).unwrap_or(0);
            let best_session_id = scored[0].1.to_string();

            if best >= 5 && best > runner_up {
                session_matches
                    .entry(best_session_id)
                    .or_default()
                    .matched_agents
                    .push(agent_label(agent));
                session_matches
                    .entry(scored[0].1.to_string())
                    .or_default()
                    .matched_agent_keys
                    .insert(agent.key.clone());
            } else {
                for (_, session_id) in scored.into_iter().filter(|(score, _)| *score == best) {
                    *session_matches
                        .entry(session_id.to_string())
                        .or_default()
                        .candidate_vendors
                        .entry(agent.name.to_ascii_lowercase())
                        .or_insert(0) += 1;
                }
            }
        }

        let matched_agent_keys = session_matches
            .values()
            .flat_map(|entry| entry.matched_agent_keys.iter().cloned())
            .collect();

        AgentMatchState {
            session_matches,
            matched_agent_keys,
        }
    }
}

fn focus_panes_for_width(width: u16) -> &'static [FocusPane] {
    if width < 165 {
        &RESPONSIVE_FOCUS_COMPACT
    } else {
        &RESPONSIVE_FOCUS_FULL
    }
}

#[derive(Debug, Default)]
struct SessionAgentMatch {
    matched_agents: Vec<String>,
    matched_agent_keys: BTreeSet<String>,
    candidate_vendors: BTreeMap<String, usize>,
}

#[derive(Debug, Default)]
struct AgentMatchState {
    session_matches: BTreeMap<String, SessionAgentMatch>,
    matched_agent_keys: BTreeSet<String>,
}

impl AgentMatchState {
    fn session_summary(&self, session_id: &str) -> Option<String> {
        let entry = self.session_matches.get(session_id)?;
        if !entry.matched_agents.is_empty() {
            let preview = entry
                .matched_agents
                .iter()
                .take(2)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ");
            if entry.matched_agents.len() > 2 {
                Some(format!(
                    "agents {} +{}",
                    preview,
                    entry.matched_agents.len() - 2
                ))
            } else if entry.matched_agents.len() == 1 {
                Some(format!("agent {preview}"))
            } else {
                Some(format!("agents {preview}"))
            }
        } else if !entry.candidate_vendors.is_empty() {
            let vendors = entry
                .candidate_vendors
                .iter()
                .map(|(vendor, count)| {
                    if *count > 1 {
                        format!("{vendor} x{count}")
                    } else {
                        vendor.clone()
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            Some(format!("candidates {vendors}"))
        } else {
            None
        }
    }
}

fn compare_run_items(
    a: &SessionListItem,
    b: &SessionListItem,
    sort_mode: RunSortMode,
) -> std::cmp::Ordering {
    let primary = match sort_mode {
        RunSortMode::Recent => b.last_seen_at_ms.cmp(&a.last_seen_at_ms),
        RunSortMode::Started => b.started_at_ms.cmp(&a.started_at_ms),
        RunSortMode::Files => b
            .touched_files_count
            .cmp(&a.touched_files_count)
            .then_with(|| b.unknown_count.cmp(&a.unknown_count)),
        RunSortMode::Name => a
            .display_name
            .to_ascii_lowercase()
            .cmp(&b.display_name.to_ascii_lowercase()),
    };

    a.is_unknown_bucket
        .cmp(&b.is_unknown_bucket)
        .then_with(|| a.is_synthetic_agent_run.cmp(&b.is_synthetic_agent_run))
        .then(primary)
        .then_with(|| b.last_seen_at_ms.cmp(&a.last_seen_at_ms))
        .then_with(|| a.session_id.cmp(&b.session_id))
}

fn is_repo_local_agent(agent: &DetectedAgent, repo_root: &str) -> bool {
    agent.cwd.as_deref().is_some_and(|cwd| {
        let repo_root = normalize_match_path(repo_root);
        let cwd = normalize_match_path(cwd);
        cwd == repo_root
            || path_contains(&repo_root, &cwd)
            || canonical_repo_identity(&cwd) == canonical_repo_identity(&repo_root)
    })
}

fn session_display_name(session: &SessionView) -> String {
    session
        .display_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| short_session(&session.session_id))
}

fn short_session(session_id: &str) -> String {
    if session_id.len() <= 10 {
        session_id.to_string()
    } else {
        session_id[0..10].to_string()
    }
}

fn is_stop_event(event_name: &str) -> bool {
    matches!(
        event_name,
        "Stop" | "stop" | "SessionStop" | "session-stop" | "exit" | "quit"
    )
}

fn session_agent_match_score(session: &SessionView, agent: &DetectedAgent) -> usize {
    let mut score = 0;

    let session_client = session.client.to_ascii_lowercase();
    let agent_vendor = agent.vendor.to_ascii_lowercase();
    let agent_name = agent.name.to_ascii_lowercase();
    if session_client == agent_vendor
        || session_client == agent_name
        || (session_client == "codex" && (agent_vendor == "openai" || agent_name == "codex"))
        || (session_client == "claude" && (agent_vendor == "anthropic" || agent_name == "claude"))
        || (session_client == "qoder" && (agent_vendor == "qoder" || agent_name == "qoder"))
        || (session_client == "auggie" && (agent_vendor == "auggie" || agent_name == "auggie"))
    {
        score += 3;
    }

    if let Some(agent_cwd) = agent.cwd.as_deref() {
        let session_cwd = normalize_match_path(&session.cwd);
        let agent_cwd = normalize_match_path(agent_cwd);
        if session_cwd == agent_cwd {
            score += 3;
        } else if path_contains(&session_cwd, &agent_cwd) || path_contains(&agent_cwd, &session_cwd)
        {
            score += 2;
        }
    }

    let command = agent.command.to_ascii_lowercase();
    if command.contains(&session.session_id.to_ascii_lowercase()) {
        score += 3;
    }
    if let Some(display_name) = session.display_name.as_deref() {
        let lowered = display_name.to_ascii_lowercase();
        if !lowered.is_empty() && command.contains(&lowered) {
            score += 2;
        }
    }
    if let Some(stem) = session
        .transcript_path
        .as_deref()
        .and_then(|path| Path::new(path).file_stem())
        .and_then(|stem| stem.to_str())
    {
        let lowered = stem.to_ascii_lowercase();
        if !lowered.is_empty() && command.contains(&lowered) {
            score += 2;
        }
    }

    score
}

fn normalize_match_path(path: &str) -> String {
    path.trim_end_matches('/').to_string()
}

fn canonical_repo_identity(path: &str) -> String {
    let normalized = normalize_match_path(path);
    let basename = normalized.rsplit('/').next().unwrap_or(normalized.as_str());

    let canonical = basename
        .split_once("-broken-")
        .map(|(prefix, _)| prefix)
        .or_else(|| basename.split_once("-remote-").map(|(prefix, _)| prefix))
        .unwrap_or(basename);

    canonical.to_string()
}

fn path_contains(base: &str, candidate: &str) -> bool {
    candidate
        .strip_prefix(base)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

fn agent_label(agent: &DetectedAgent) -> String {
    format!("{}#{}", agent.name.to_ascii_lowercase(), agent.pid)
}

#[path = "state_fitness.rs"]
mod fitness;
