use super::*;
use chrono::Utc;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

impl RuntimeState {
    #[cfg(test)]
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
        let now_ms = Utc::now().timestamp_millis();
        let agent_matches = self.compute_agent_match_state();
        let mut items: Vec<_> = self
            .sessions
            .values()
            .filter(|session| self.matches_session_search(session))
            .filter(|session| self.session_is_current_run_context(session, now_ms))
            .map(|session| {
                let (exact_count, inferred_count, unknown_count) =
                    self.session_confidence_counts(session);
                let touched_files_count = exact_count + inferred_count + unknown_count;
                SessionListItem {
                    session_id: session.session_id.clone(),
                    display_name: session_display_name(session),
                    task_id: session.active_task_id.clone(),
                    task_title: session.active_task_title.clone(),
                    prompt_preview: session.last_prompt_preview.clone(),
                    recovered_from_transcript: session.active_task_recovered_from_transcript,
                    client: session.client.clone(),
                    source: session.source.clone(),
                    model: session.model.clone(),
                    status: session.status.clone(),
                    tmux_pane: session.tmux_pane.clone(),
                    started_at_ms: session.started_at_ms,
                    last_seen_at_ms: session.last_seen_at_ms,
                    touched_files_count,
                    exact_count,
                    inferred_count,
                    unknown_count,
                    agent_summary: agent_matches.session_summary(&session.session_id),
                    last_event_name: session.last_event_name.clone(),
                    last_tool_name: session.last_tool_name.clone(),
                    attached_agent_key: None,
                    is_synthetic_agent_run: false,
                    is_unknown_bucket: false,
                    is_all_runs_bucket: false,
                }
            })
            .collect();
        let hook_backed_session_count = items.len();
        items.extend(
            self.unmatched_agents_for_runs(&agent_matches)
                .into_iter()
                .filter(|_| hook_backed_session_count == 0)
                .filter(|agent| self.matches_detected_agent_search(agent))
                .map(|agent| SessionListItem {
                    session_id: format!("agent:{}:{}", agent.name.to_ascii_lowercase(), agent.pid),
                    display_name: format!("{}#{}", agent.name, agent.pid),
                    task_id: None,
                    task_title: None,
                    prompt_preview: None,
                    recovered_from_transcript: false,
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
                    is_all_runs_bucket: false,
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
                task_id: None,
                task_title: None,
                prompt_preview: None,
                recovered_from_transcript: false,
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
                is_all_runs_bucket: false,
            });
        }
        if !items.is_empty() {
            let (exact_count, inferred_count, unknown_count) = items.iter().fold(
                (0usize, 0usize, 0usize),
                |(exact, inferred, unknown), item| {
                    (
                        exact + item.exact_count,
                        inferred + item.inferred_count,
                        unknown + item.unknown_count,
                    )
                },
            );
            let touched_files_count = self
                .files
                .values()
                .filter(|file| file.dirty || file.conflicted)
                .count();
            let last_seen_at_ms = items
                .iter()
                .map(|item| item.last_seen_at_ms)
                .max()
                .unwrap_or(self.last_refresh_at_ms);
            items.push(SessionListItem {
                session_id: ALL_RUNS_SESSION_ID.to_string(),
                display_name: "All".to_string(),
                task_id: None,
                task_title: None,
                prompt_preview: None,
                recovered_from_transcript: false,
                client: "all".to_string(),
                source: Some("aggregate".to_string()),
                model: None,
                status: "active".to_string(),
                tmux_pane: None,
                started_at_ms: self.last_refresh_at_ms,
                last_seen_at_ms,
                touched_files_count,
                exact_count,
                inferred_count,
                unknown_count,
                agent_summary: None,
                last_event_name: Some("aggregate".to_string()),
                last_tool_name: None,
                attached_agent_key: None,
                is_synthetic_agent_run: false,
                is_unknown_bucket: false,
                is_all_runs_bucket: true,
            });
        }
        items.sort_by(compare_run_items);
        if let Some(index) = items.iter().position(|item| item.is_all_runs_bucket) {
            let all_item = items.remove(index);
            items.insert(0, all_item);
        }
        items
    }

    pub(super) fn compute_prompt_session_items(&self) -> Vec<PromptSessionListItem> {
        let Some(run) = self.selected_run_item() else {
            return Vec::new();
        };
        if run.is_unknown_bucket || run.is_synthetic_agent_run {
            return Vec::new();
        }

        let mut items: Vec<_> = self
            .tasks
            .values()
            .filter(|task| self.matches_task_search(task))
            .filter(|task| run.is_all_runs_bucket || task.session_id == run.session_id)
            .map(|task| {
                let session = self.sessions.get(&task.session_id);
                PromptSessionListItem {
                    task_id: Some(task.task_id.clone()),
                    session_id: Some(task.session_id.clone()),
                    display_name: task.title.clone(),
                    prompt_preview: task.prompt_preview.clone(),
                    recovered_from_transcript: task.recovered_from_transcript,
                    client: session
                        .map(|session| session.client.clone())
                        .unwrap_or_else(|| "unknown".to_string()),
                    source: session.and_then(|session| session.source.clone()),
                    model: session.and_then(|session| session.model.clone()),
                    status: task.status.clone(),
                    updated_at_ms: task.updated_at_ms,
                    changed_files_count: self
                        .task_change_paths
                        .get(&task.task_id)
                        .map(|paths| paths.len())
                        .unwrap_or(0),
                    recent_git_summary: self
                        .task_git_activity
                        .get(&task.task_id)
                        .and_then(|items| items.first().cloned()),
                    is_all_prompt_bucket: false,
                }
            })
            .collect();

        items.sort_by(|a, b| {
            b.updated_at_ms
                .cmp(&a.updated_at_ms)
                .then_with(|| a.task_id.cmp(&b.task_id))
        });

        if !items.is_empty() {
            let mut all_paths = BTreeSet::new();
            for item in &items {
                if let Some(task_id) = item.task_id.as_deref() {
                    if let Some(paths) = self.task_change_paths.get(task_id) {
                        all_paths.extend(paths.iter().cloned());
                    }
                }
            }
            let updated_at_ms = items
                .iter()
                .map(|item| item.updated_at_ms)
                .max()
                .unwrap_or(self.last_refresh_at_ms);
            items.insert(
                0,
                PromptSessionListItem {
                    task_id: Some(ALL_PROMPT_SESSIONS_ID.to_string()),
                    session_id: None,
                    display_name: "All prompts".to_string(),
                    prompt_preview: None,
                    recovered_from_transcript: false,
                    client: run.client.clone(),
                    source: run.source.clone(),
                    model: run.model.clone(),
                    status: "active".to_string(),
                    updated_at_ms,
                    changed_files_count: all_paths.len(),
                    recent_git_summary: None,
                    is_all_prompt_bucket: true,
                },
            );
        }

        items
    }

    #[cfg(test)]
    pub fn unmatched_agents(&self) -> Vec<&DetectedAgent> {
        self.cached_unmatched_agent_keys
            .iter()
            .filter_map(|key| self.detected_agents.iter().find(|agent| &agent.key == key))
            .collect()
    }

    pub(super) fn compute_file_item_keys(&self) -> Vec<String> {
        if let Some(task_id) = self.selected_prompt_task_id() {
            let mut items: Vec<_> = self
                .task_change_paths
                .get(task_id)
                .into_iter()
                .flat_map(|paths| paths.iter())
                .filter_map(|path| self.files.get(path))
                .filter(|file| self.matches_file_search(file))
                .collect();
            items.sort_by(|a, b| {
                b.dirty
                    .cmp(&a.dirty)
                    .then_with(|| b.last_modified_at_ms.cmp(&a.last_modified_at_ms))
                    .then_with(|| a.rel_path.cmp(&b.rel_path))
            });
            return items
                .into_iter()
                .map(|file| file.rel_path.clone())
                .collect();
        }

        let mut items: Vec<_> = self
            .files
            .values()
            .filter(|file| file.dirty || file.conflicted)
            .filter(|file| self.matches_file_search(file))
            .collect();
        items.sort_by(|a, b| {
            file_group_sort_key(a, &self.files)
                .cmp(&file_group_sort_key(b, &self.files))
                .then_with(|| b.last_modified_at_ms.cmp(&a.last_modified_at_ms))
                .then_with(|| a.rel_path.cmp(&b.rel_path))
        });
        items
            .into_iter()
            .map(|file| file.rel_path.clone())
            .collect()
    }

    pub(super) fn rebuild_views(&mut self) {
        self.cached_session_items = self.compute_session_items();
        let session_len = self.cached_session_items.len();
        if session_len == 0 {
            self.selected_run = 0;
            self.selected_session = 0;
        } else {
            self.selected_run = self.selected_run.min(session_len - 1);
            self.selected_session = self.selected_session.min(session_len - 1);
        }
        self.cached_prompt_session_items = self.compute_prompt_session_items();
        let prompt_len = self.cached_prompt_session_items.len();
        if prompt_len == 0 {
            self.selected_prompt_session = 0;
        } else {
            self.selected_prompt_session = self.selected_prompt_session.min(prompt_len - 1);
        }
        self.cached_unmatched_agent_keys = self.compute_unmatched_agent_keys();
        self.cached_file_item_keys = self.compute_file_item_keys();
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
        if run.is_all_runs_bucket {
            return Some(self.repo_root.clone());
        }
        self.sessions
            .get(&run.session_id)
            .map(|session| session.cwd.clone())
            .or_else(|| Some(self.repo_root.clone()))
    }

    fn matches_session_search(&self, session: &SessionView) -> bool {
        if self.search_query.is_empty() {
            return true;
        }
        let needle = self.search_query.to_ascii_lowercase();
        session.session_id.to_ascii_lowercase().contains(&needle)
            || session
                .last_prompt_preview
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .contains(&needle)
            || session
                .active_task_title
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .contains(&needle)
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

    fn matches_task_search(&self, task: &TaskView) -> bool {
        if self.search_query.is_empty() {
            return true;
        }
        let needle = self.search_query.to_ascii_lowercase();
        task.task_id.to_ascii_lowercase().contains(&needle)
            || task
                .prompt_preview
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .contains(&needle)
            || task.title.to_ascii_lowercase().contains(&needle)
            || task.objective.to_ascii_lowercase().contains(&needle)
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

    fn session_confidence_counts(&self, session: &SessionView) -> (usize, usize, usize) {
        let mut exact_count = 0;
        let mut inferred_count = 0;
        let mut unknown_count = 0;

        for file in self.files.values().filter(|file| {
            file.dirty
                && file_matches_session_run(
                    file,
                    &session.session_id,
                    session.active_task_id.as_deref(),
                )
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
        let now_ms = Utc::now().timestamp_millis();
        let visible_sessions: Vec<_> = self
            .sessions
            .values()
            .filter(|session| self.matches_session_search(session))
            .filter(|session| self.session_is_current_run_context(session, now_ms))
            .collect();

        for agent in &self.detected_agents {
            let mut scored: Vec<_> = visible_sessions
                .iter()
                .filter_map(|session| {
                    let score = session_agent_match_score(session, agent, now_ms);
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

    fn session_is_current_run_context(&self, session: &SessionView, now_ms: i64) -> bool {
        let cutoff = now_ms - DEFAULT_INFERENCE_WINDOW_MS;
        session.last_seen_at_ms >= cutoff || self.session_has_dirty_signal(&session.session_id)
    }

    fn session_has_dirty_signal(&self, session_id: &str) -> bool {
        self.sessions.get(session_id).is_some_and(|session| {
            let (exact_count, inferred_count, unknown_count) =
                self.session_confidence_counts(session);
            exact_count + inferred_count + unknown_count > 0
        })
    }
}

fn file_group_sort_key(
    file: &FileView,
    files: &BTreeMap<String, FileView>,
) -> (String, u8, String) {
    if file.entry_kind.is_submodule() {
        return (file.rel_path.clone(), 0, String::new());
    }

    if let Some(parent) = nearest_submodule_parent(file, files) {
        return (parent.rel_path.clone(), 1, file.rel_path.clone());
    }

    (file.rel_path.clone(), 0, String::new())
}

fn nearest_submodule_parent<'a>(
    file: &FileView,
    files: &'a BTreeMap<String, FileView>,
) -> Option<&'a FileView> {
    let mut current = Path::new(&file.rel_path).parent();
    while let Some(parent) = current {
        let key = parent.to_string_lossy().replace('\\', "/");
        if let Some(candidate) = files.get(&key) {
            if candidate.entry_kind.is_submodule() {
                return Some(candidate);
            }
        }
        current = parent.parent();
    }
    None
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

fn compare_run_items(a: &SessionListItem, b: &SessionListItem) -> std::cmp::Ordering {
    a.is_unknown_bucket
        .cmp(&b.is_unknown_bucket)
        .then_with(|| a.is_synthetic_agent_run.cmp(&b.is_synthetic_agent_run))
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

fn file_matches_session_run(file: &FileView, session_id: &str, task_id: Option<&str>) -> bool {
    if let Some(task_id) = task_id {
        if file.last_task_id.as_deref() == Some(task_id) {
            return true;
        }
        if file.last_task_id.is_some() {
            return false;
        }
    }
    file.last_session_id.as_deref() == Some(session_id) || file.touched_by.contains(session_id)
}

fn session_display_name(session: &SessionView) -> String {
    session
        .active_task_title
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            session
                .display_name
                .clone()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or_else(|| short_session(&session.session_id))
}

fn session_agent_match_score(session: &SessionView, agent: &DetectedAgent, now_ms: i64) -> usize {
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

    let agent_started_at_ms =
        now_ms.saturating_sub((agent.uptime_seconds as i64).saturating_mul(1000));
    let started_delta_ms = session
        .started_at_ms
        .saturating_sub(agent_started_at_ms)
        .unsigned_abs() as i64;
    if started_delta_ms <= 2 * 60 * 1000 {
        score += 5;
    } else if started_delta_ms <= 10 * 60 * 1000 {
        score += 3;
    } else if started_delta_ms <= 30 * 60 * 1000 {
        score += 1;
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
