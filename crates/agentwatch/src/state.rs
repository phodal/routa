use crate::models::{
    AttributionConfidence, AttributionEvent, EventLogEntry, EventSource, FileView, GitEvent,
    HookEvent, RuntimeMessage, SessionView, DEFAULT_INFERENCE_WINDOW_MS, EVENT_LOG_LIMIT,
};
use chrono::Utc;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusPane {
    Sessions,
    Files,
    Detail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetailMode {
    Summary,
    File,
    Diff,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeMode {
    Dark,
    Light,
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
    BySession,
    Global,
    UnknownConflict,
}

pub const UNKNOWN_SESSION_ID: &str = "__unknown__";

#[derive(Debug, Clone)]
pub struct SessionListItem {
    pub session_id: String,
    pub display_name: String,
    pub model: Option<String>,
    pub status: String,
    pub tmux_pane: Option<String>,
    pub last_seen_at_ms: i64,
    pub touched_files_count: usize,
    pub exact_count: usize,
    pub inferred_count: usize,
    pub unknown_count: usize,
    pub is_unknown_bucket: bool,
}

#[derive(Debug)]
pub struct RuntimeState {
    pub repo_root: String,
    pub repo_name: String,
    pub branch: String,
    pub sessions: BTreeMap<String, SessionView>,
    pub files: BTreeMap<String, FileView>,
    pub event_log: VecDeque<EventLogEntry>,
    pub follow_mode: bool,
    pub file_list_mode: FileListMode,
    pub focus: FocusPane,
    pub detail_mode: DetailMode,
    pub theme_mode: ThemeMode,
    pub event_log_filter: EventLogFilter,
    pub detail_scroll: u16,
    pub detail_scroll_cache: BTreeMap<String, u16>,
    pub selected_session: usize,
    pub selected_file: usize,
    pub last_refresh_at_ms: i64,
    pub runtime_transport: String,
    pub search_query: String,
    pub search_active: bool,
}

impl RuntimeState {
    pub fn new(repo_root: String, repo_name: String, branch: String) -> Self {
        Self {
            repo_root,
            repo_name,
            branch,
            sessions: BTreeMap::new(),
            files: BTreeMap::new(),
            event_log: VecDeque::new(),
            follow_mode: true,
            file_list_mode: FileListMode::BySession,
            focus: FocusPane::Sessions,
            detail_mode: DetailMode::Summary,
            theme_mode: ThemeMode::Dark,
            event_log_filter: EventLogFilter::All,
            detail_scroll: 0,
            detail_scroll_cache: BTreeMap::new(),
            selected_session: 0,
            selected_file: 0,
            last_refresh_at_ms: Utc::now().timestamp_millis(),
            runtime_transport: "feed".to_string(),
            search_query: String::new(),
            search_active: false,
        }
    }

    pub fn apply_message(&mut self, message: RuntimeMessage) {
        self.last_refresh_at_ms = message.observed_at_ms();
        match message {
            RuntimeMessage::Hook(event) => self.apply_hook_event(event),
            RuntimeMessage::Git(event) => self.apply_git_event(event),
            RuntimeMessage::Attribution(event) => self.apply_attribution_event(event),
        }
        self.clamp_selection();
    }

    pub fn sync_dirty_files(&mut self, dirty: Vec<(String, String, Option<i64>)>) {
        let now_ms = Utc::now().timestamp_millis();
        let inferred_session_id = self.single_active_session_id(now_ms);
        let seen: BTreeSet<String> = dirty.iter().map(|(p, _, _)| p.clone()).collect();
        let mut watch_events = Vec::new();
        let mut attrib_events = Vec::new();

        for file in self.files.values_mut() {
            if !seen.contains(&file.rel_path) && file.dirty {
                watch_events.push(format!("watch clean {}", file.rel_path));
                file.dirty = false;
                file.state_code = "clean".to_string();
            }
        }

        for (rel_path, state_code, mtime_ms) in dirty {
            let file = self
                .files
                .entry(rel_path.clone())
                .or_insert_with(|| FileView {
                    rel_path: rel_path.clone(),
                    dirty: true,
                    state_code: state_code.clone(),
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
    }

    pub fn session_items(&self) -> Vec<SessionListItem> {
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
                    model: session.model.clone(),
                    status: session.status.clone(),
                    tmux_pane: session.tmux_pane.clone(),
                    last_seen_at_ms: session.last_seen_at_ms,
                    touched_files_count: session
                        .touched_files
                        .len()
                        .max(exact_count + inferred_count + unknown_count),
                    exact_count,
                    inferred_count,
                    unknown_count,
                    is_unknown_bucket: false,
                }
            })
            .collect();
        items.sort_by(|a, b| {
            b.last_seen_at_ms
                .cmp(&a.last_seen_at_ms)
                .then_with(|| a.session_id.cmp(&b.session_id))
        });
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
                model: None,
                status: "unknown".to_string(),
                tmux_pane: None,
                last_seen_at_ms: self.last_refresh_at_ms,
                touched_files_count: unknown_count,
                exact_count: 0,
                inferred_count: 0,
                unknown_count,
                is_unknown_bucket: true,
            });
        }
        items
    }

    pub fn selected_session_id(&self) -> Option<String> {
        self.session_items()
            .get(self.selected_session)
            .map(|session| session.session_id.clone())
    }

    pub fn file_items(&self) -> Vec<&FileView> {
        let mut items: Vec<_> = self
            .files
            .values()
            .filter(|file| file.dirty || file.conflicted)
            .filter(|file| self.matches_file_search(file))
            .collect();
        match self.file_list_mode {
            FileListMode::BySession => {
                if let Some(session_id) = self.selected_session_id() {
                    if session_id == UNKNOWN_SESSION_ID {
                        items.retain(|file| {
                            file.conflicted
                                || matches!(file.confidence, AttributionConfidence::Unknown)
                                || file.last_session_id.is_none()
                                || file.touched_by.is_empty()
                        });
                    } else {
                        items.retain(|file| file.touched_by.contains(&session_id));
                    }
                }
            }
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
    }

    pub fn selected_file(&self) -> Option<&FileView> {
        let items = self.file_items();
        items.get(self.selected_file).copied()
    }

    #[allow(dead_code)]
    pub fn selected_file_position(&self) -> Option<(usize, usize)> {
        let len = self.file_items().len();
        if len == 0 {
            None
        } else {
            Some((self.selected_file.min(len - 1), len))
        }
    }

    pub fn cycle_focus(&mut self) {
        self.focus = match self.focus {
            FocusPane::Sessions => FocusPane::Files,
            FocusPane::Files => FocusPane::Detail,
            FocusPane::Detail => FocusPane::Sessions,
        };
    }

    pub fn move_selection_up(&mut self) {
        match self.focus {
            FocusPane::Sessions => {
                self.selected_session = self.selected_session.saturating_sub(1);
            }
            FocusPane::Files => {
                self.selected_file = self.selected_file.saturating_sub(1);
            }
            FocusPane::Detail => {
                self.set_detail_scroll(self.detail_scroll.saturating_sub(1));
            }
        }
    }

    pub fn move_selection_down(&mut self) {
        match self.focus {
            FocusPane::Sessions => {
                let len = self.session_items().len();
                if len > 0 {
                    self.selected_session = (self.selected_session + 1).min(len - 1);
                }
            }
            FocusPane::Files => {
                let len = self.file_items().len();
                if len > 0 {
                    self.selected_file = (self.selected_file + 1).min(len - 1);
                }
            }
            FocusPane::Detail => {
                self.set_detail_scroll(self.detail_scroll.saturating_add(1));
            }
        }
    }

    pub fn toggle_follow_mode(&mut self) {
        self.follow_mode = !self.follow_mode;
    }

    pub fn set_runtime_transport(&mut self, transport: impl Into<String>) {
        self.runtime_transport = transport.into();
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

    pub fn begin_search(&mut self) {
        self.search_active = true;
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
            FileListMode::BySession => FileListMode::Global,
            FileListMode::Global => FileListMode::UnknownConflict,
            FileListMode::UnknownConflict => FileListMode::BySession,
        };
        self.selected_file = 0;
        self.restore_detail_scroll_for_selection();
    }

    pub fn toggle_file_view(&mut self) {
        self.detail_mode = match self.detail_mode {
            DetailMode::Summary => DetailMode::File,
            DetailMode::File => DetailMode::Summary,
            DetailMode::Diff => DetailMode::File,
        };
        self.restore_detail_scroll_for_selection();
    }

    pub fn toggle_detail_mode(&mut self) {
        self.detail_mode = match self.detail_mode {
            DetailMode::Summary => DetailMode::Diff,
            DetailMode::File => DetailMode::Diff,
            DetailMode::Diff => DetailMode::Summary,
        };
        self.restore_detail_scroll_for_selection();
    }

    pub fn select_prev_file(&mut self) {
        let len = self.file_items().len();
        if len == 0 {
            return;
        }
        self.selected_file = self.selected_file.saturating_sub(1);
        self.restore_detail_scroll_for_selection();
    }

    pub fn select_next_file(&mut self) {
        let len = self.file_items().len();
        if len == 0 {
            return;
        }
        self.selected_file = (self.selected_file + 1).min(len - 1);
        self.restore_detail_scroll_for_selection();
    }

    pub fn selected_file_assignment_message(&self) -> Option<RuntimeMessage> {
        let session_id = self.selected_session_id()?;
        if session_id == UNKNOWN_SESSION_ID {
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

    fn apply_hook_event(&mut self, event: HookEvent) {
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
            format!("assign {} {}", short_session(&event.session_id), event.rel_path),
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
        let session_len = self.session_items().len();
        if session_len == 0 {
            self.selected_session = 0;
        } else {
            self.selected_session = self.selected_session.min(session_len - 1);
        }

        let file_len = self.file_items().len();
        if file_len == 0 {
            self.selected_file = 0;
        } else {
            self.selected_file = self.selected_file.min(file_len - 1);
        }
        self.restore_detail_scroll_for_selection();
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
