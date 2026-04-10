use crate::models::{
    AttributionConfidence, EventLogEntry, FileView, GitEvent, HookEvent, RuntimeMessage,
    SessionView, DEFAULT_INFERENCE_WINDOW_MS, EVENT_LOG_LIMIT,
};
use chrono::Utc;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusPane {
    Sessions,
    Files,
    Detail,
}

#[derive(Debug)]
pub struct RuntimeState {
    pub repo_root: String,
    pub sessions: BTreeMap<String, SessionView>,
    pub files: BTreeMap<String, FileView>,
    pub event_log: VecDeque<EventLogEntry>,
    pub follow_mode: bool,
    pub group_by_session: bool,
    pub focus: FocusPane,
    pub selected_session: usize,
    pub selected_file: usize,
    pub last_refresh_at_ms: i64,
}

impl RuntimeState {
    pub fn new(repo_root: String) -> Self {
        Self {
            repo_root,
            sessions: BTreeMap::new(),
            files: BTreeMap::new(),
            event_log: VecDeque::new(),
            follow_mode: true,
            group_by_session: true,
            focus: FocusPane::Sessions,
            selected_session: 0,
            selected_file: 0,
            last_refresh_at_ms: Utc::now().timestamp_millis(),
        }
    }

    pub fn apply_message(&mut self, message: RuntimeMessage) {
        match message {
            RuntimeMessage::Hook(event) => self.apply_hook_event(event),
            RuntimeMessage::Git(event) => self.apply_git_event(event),
        }
        self.clamp_selection();
    }

    pub fn sync_dirty_files(&mut self, dirty: Vec<(String, String, Option<i64>)>) {
        let now_ms = Utc::now().timestamp_millis();
        let seen: BTreeSet<String> = dirty.iter().map(|(p, _, _)| p.clone()).collect();

        for file in self.files.values_mut() {
            if !seen.contains(&file.rel_path) {
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
            file.dirty = true;
            file.state_code = state_code;
            if let Some(mtime) = mtime_ms {
                file.last_modified_at_ms = mtime;
            }
        }
        self.last_refresh_at_ms = now_ms;
        self.prune_stale_sessions();
    }

    pub fn session_items(&self) -> Vec<&SessionView> {
        let mut items: Vec<_> = self.sessions.values().collect();
        items.sort_by(|a, b| {
            b.last_seen_at_ms
                .cmp(&a.last_seen_at_ms)
                .then_with(|| a.session_id.cmp(&b.session_id))
        });
        items
    }

    pub fn selected_session_id(&self) -> Option<String> {
        self.session_items()
            .get(self.selected_session)
            .map(|session| session.session_id.clone())
    }

    pub fn file_items(&self) -> Vec<&FileView> {
        let mut items: Vec<_> = self.files.values().collect();
        let selected = if self.group_by_session {
            self.selected_session_id()
        } else {
            None
        };
        if let Some(session_id) = selected {
            items.retain(|file| file.touched_by.contains(&session_id));
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
            FocusPane::Detail => {}
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
            FocusPane::Detail => {}
        }
    }

    pub fn toggle_follow_mode(&mut self) {
        self.follow_mode = !self.follow_mode;
    }

    pub fn toggle_group_mode(&mut self) {
        self.group_by_session = !self.group_by_session;
        self.selected_file = 0;
    }

    fn apply_hook_event(&mut self, event: HookEvent) {
        {
            let session = self
                .sessions
                .entry(event.session_id.clone())
                .or_insert_with(|| SessionView {
                    session_id: event.session_id.clone(),
                    cwd: event.cwd.clone(),
                    model: event.model.clone(),
                    client: event.client.clone(),
                    started_at_ms: event.observed_at_ms,
                    last_seen_at_ms: event.observed_at_ms,
                    status: "active".to_string(),
                    tmux_pane: event.tmux_pane.clone(),
                    touched_files: BTreeSet::new(),
                    last_turn_id: event.turn_id.clone(),
                });

            session.cwd = event.cwd.clone();
            session.model = event.model.clone().or_else(|| session.model.clone());
            session.client = event.client.clone();
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
            format!(
                "git {} {}",
                event.event_name,
                event.branch.unwrap_or_else(|| "-".to_string())
            ),
        );
        if matches!(
            event.event_name.as_str(),
            "post-commit" | "post-checkout" | "post-merge"
        ) {
            for file in self.files.values_mut() {
                file.dirty = false;
                file.state_code = "clean".to_string();
            }
        }
    }

    fn push_event(&mut self, observed_at_ms: i64, message: String) {
        self.event_log.push_front(EventLogEntry {
            observed_at_ms,
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
