use crate::shared::models::{
    AgentStats, AttributionConfidence, AttributionEvent, DetectedAgent, DirtyRepoEntry, EntryKind,
    EventLogEntry, EventSource, FileView, FitnessEvent, GitEvent, HookEvent, RuntimeMessage,
    SessionView, TaskView, DEFAULT_INFERENCE_WINDOW_MS, EVENT_LOG_LIMIT,
};
use chrono::Utc;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusPane {
    /// Unmanaged-run / session list (new harness vocabulary layered on top of sessions)
    Runs,
    Sessions,
    Files,
    Detail,
    Fitness,
}

const RESPONSIVE_FOCUS_COMPACT: [FocusPane; 3] =
    [FocusPane::Files, FocusPane::Detail, FocusPane::Fitness];
const RESPONSIVE_FOCUS_FULL: [FocusPane; 5] = [
    FocusPane::Runs,
    FocusPane::Sessions,
    FocusPane::Files,
    FocusPane::Detail,
    FocusPane::Fitness,
];

impl FocusPane {
    #[allow(dead_code)]
    pub fn label(self) -> &'static str {
        match self {
            FocusPane::Runs => "Runs",
            FocusPane::Sessions => "Sessions",
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

pub const UNKNOWN_SESSION_ID: &str = "__unknown__";
pub const ALL_RUNS_SESSION_ID: &str = "__all__";
pub const ALL_PROMPT_SESSIONS_ID: &str = "__all_prompt_sessions__";
const PAGE_STEP: usize = 10;
const DETAIL_PAGE_STEP: u16 = 12;

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct SessionListItem {
    pub session_id: String,
    pub display_name: String,
    pub task_id: Option<String>,
    pub task_title: Option<String>,
    pub prompt_preview: Option<String>,
    pub recovered_from_transcript: bool,
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
    pub is_all_runs_bucket: bool,
}

impl SessionListItem {
    pub fn primary_label(&self) -> &str {
        if self.is_all_runs_bucket {
            return "All";
        }
        if self.is_unknown_bucket {
            return "unassigned";
        }
        self.prompt_preview
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                self.task_title
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
            })
            .unwrap_or(&self.display_name)
    }

    pub fn has_task_context(&self) -> bool {
        self.prompt_preview
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            || self
                .task_title
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
            || self.task_id.is_some()
    }
}

#[derive(Debug, Clone)]
pub struct PromptSessionListItem {
    pub task_id: Option<String>,
    pub session_id: Option<String>,
    pub display_name: String,
    pub prompt_preview: Option<String>,
    pub recovered_from_transcript: bool,
    pub client: String,
    pub source: Option<String>,
    pub model: Option<String>,
    pub status: String,
    pub updated_at_ms: i64,
    pub changed_files_count: usize,
    pub recent_git_summary: Option<String>,
    pub is_all_prompt_bucket: bool,
}

impl PromptSessionListItem {
    pub fn primary_label(&self) -> &str {
        if self.is_all_prompt_bucket {
            return "All prompts";
        }
        self.prompt_preview
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(&self.display_name)
    }
}

#[derive(Debug)]
pub struct RuntimeState {
    pub repo_root: String,
    pub branch: String,
    pub branch_oid: Option<String>,
    pub ahead_count: Option<usize>,
    pub committed_change_summary: Option<(usize, usize)>,
    pub worktree_count: Option<usize>,
    pub tasks: BTreeMap<String, TaskView>,
    pub task_change_paths: BTreeMap<String, BTreeSet<String>>,
    pub task_git_activity: BTreeMap<String, Vec<String>>,
    pub sessions: BTreeMap<String, SessionView>,
    pub files: BTreeMap<String, FileView>,
    pub event_log: VecDeque<EventLogEntry>,
    pub follow_mode: bool,
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
    pub selected_prompt_session: usize,
    pub selected_file: usize,
    pub last_refresh_at_ms: i64,
    pub last_file_hook_at_ms: Option<i64>,
    pub runtime_transport: String,
    pub search_query: String,
    pub search_active: bool,
    pub detected_agents: Vec<DetectedAgent>,
    pub agent_stats: AgentStats,
    cached_session_items: Vec<SessionListItem>,
    cached_prompt_session_items: Vec<PromptSessionListItem>,
    cached_file_item_keys: Vec<String>,
    cached_unmatched_agent_keys: Vec<String>,
}

impl RuntimeState {
    pub fn new(repo_root: String, branch: String) -> Self {
        let mut state = Self {
            repo_root,
            branch,
            branch_oid: None,
            ahead_count: None,
            committed_change_summary: None,
            worktree_count: None,
            tasks: BTreeMap::new(),
            task_change_paths: BTreeMap::new(),
            task_git_activity: BTreeMap::new(),
            sessions: BTreeMap::new(),
            files: BTreeMap::new(),
            event_log: VecDeque::new(),
            follow_mode: true,
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
            selected_prompt_session: 0,
            selected_file: 0,
            last_refresh_at_ms: Utc::now().timestamp_millis(),
            last_file_hook_at_ms: None,
            runtime_transport: "feed".to_string(),
            search_query: String::new(),
            search_active: false,
            detected_agents: Vec::new(),
            agent_stats: AgentStats::default(),
            cached_session_items: Vec::new(),
            cached_prompt_session_items: Vec::new(),
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
                    last_task_id: None,
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
                    attrib_events.push(format!("miss {rel_path}"));
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

    pub fn prompt_sessions(&self) -> &[PromptSessionListItem] {
        &self.cached_prompt_session_items
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

    pub fn selected_prompt_session_item(&self) -> Option<&PromptSessionListItem> {
        self.cached_prompt_session_items
            .get(self.selected_prompt_session)
    }

    pub fn selected_prompt_task_id(&self) -> Option<&str> {
        self.selected_prompt_session_item()
            .filter(|item| !item.is_all_prompt_bucket)
            .and_then(|item| item.task_id.as_deref())
    }

    pub fn has_selected_prompt_scope(&self) -> bool {
        self.selected_prompt_task_id().is_some()
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

    pub fn task_for_file(&self, file: &FileView) -> Option<&TaskView> {
        if let Some(task_id) = self.selected_prompt_task_id() {
            if self
                .task_change_paths
                .get(task_id)
                .is_some_and(|paths| paths.contains(&file.rel_path))
            {
                if let Some(task) = self.tasks.get(task_id) {
                    return Some(task);
                }
            }
        }
        file.last_task_id
            .as_deref()
            .and_then(|task_id| self.tasks.get(task_id))
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

    pub fn set_runtime_transport(&mut self, transport: impl Into<String>) {
        self.runtime_transport = transport.into();
    }

    pub fn set_ahead_count(&mut self, count: Option<usize>) {
        self.ahead_count = count;
    }

    pub fn set_branch_oid(&mut self, branch_oid: Option<String>) {
        self.branch_oid = branch_oid;
    }

    pub fn set_committed_change_summary(&mut self, summary: Option<(usize, usize)>) {
        self.committed_change_summary = summary;
    }

    pub fn set_worktree_count(&mut self, count: Option<usize>) {
        self.worktree_count = count;
    }

    pub fn set_detected_agents(&mut self, agents: Vec<DetectedAgent>) {
        self.agent_stats = crate::observe::detect::calculate_stats(&agents);
        self.detected_agents = agents;
        self.clamp_selection();
    }

    #[cfg(test)]
    pub fn selected_file_assignment_message(&self) -> Option<RuntimeMessage> {
        let session_id = self.selected_session_id()?;
        if session_id == UNKNOWN_SESSION_ID {
            return None;
        }
        if session_id == ALL_RUNS_SESSION_ID {
            return None;
        }
        if self
            .selected_run_item()
            .is_some_and(|item| item.is_synthetic_agent_run || item.is_all_runs_bucket)
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

#[path = "state_fitness.rs"]
mod fitness;

#[path = "navigation.rs"]
mod navigation;

#[path = "views.rs"]
mod views;

#[path = "state_events.rs"]
mod events;
