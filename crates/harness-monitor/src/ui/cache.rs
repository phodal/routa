use super::fitness;
use super::review::{RepoReviewHint, ReviewHint, ReviewTriggerCache};
use super::*;
use crate::feature_trace::{
    cache_key_for_session_trace, FeatureTraceCatalogs, SessionTraceMaterial,
};
use crate::observe::codex_transcript::recent_prompt_previews_from_transcript;
use crate::ui::state::{FitnessViewMode, FocusPane};
use ratatui::text::Text;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::Command;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

const FITNESS_HISTORY_SCHEMA_VERSION: u32 = 1;
const FITNESS_HISTORY_FILE: &str = "fitness-history.json";
const TEST_MAPPING_HISTORY_SCHEMA_VERSION: u32 = 1;
const TEST_MAPPING_HISTORY_FILE: &str = "test-mapping-history.json";
const TEST_MAPPING_HISTORY_CAPACITY: usize = 6;
const TEST_MAPPING_FULL_REFRESH_MAX_FILES: usize = 12;
const FITNESS_TREND_CAPACITY: usize = 12;
const INITIAL_FILE_PREVIEW_LINE_LIMIT: usize = 100;
const DIRECTORY_PREVIEW_ENTRY_LIMIT: usize = 200;
const TEST_MAPPING_STARTUP_DELAY_MS: i64 = 2_000;
const TEST_MAPPING_FAILURE_BACKOFF_MS: i64 = 30_000;

#[derive(Clone, Debug, Default)]
pub(super) struct SccSummary {
    pub(super) lines: usize,
    pub(super) code: usize,
}

#[derive(Debug, Deserialize)]
struct SccLanguageSummary {
    #[serde(rename = "Lines")]
    lines: usize,
    #[serde(rename = "Code")]
    code: usize,
}

#[derive(Clone, Debug, Default)]
pub struct DiffStatSummary {
    pub(super) status: String,
    pub additions: Option<usize>,
    pub deletions: Option<usize>,
}

#[derive(Clone, Debug)]
pub(super) struct DetailCacheEntry {
    pub(super) key: String,
    pub(super) text: String,
    pub(super) truncated: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FilePreviewScope {
    Head,
    Full,
}

impl FilePreviewScope {
    fn satisfies(self, requested: Self) -> bool {
        matches!(self, Self::Full) || self == requested
    }
}

#[derive(Clone, Debug)]
pub(super) struct FileFactsEntry {
    pub(super) key: String,
    pub(super) entry_kind: crate::shared::models::EntryKind,
    pub(super) line_count: usize,
    pub(super) byte_size: u64,
    pub(super) child_count: Option<usize>,
    pub(super) git_change_count: Option<usize>,
}

#[derive(Debug)]
enum PreviewCommand {
    LoadDetail {
        repo_root: String,
        rel_path: String,
        state_code: String,
        version: i64,
        mode: DetailMode,
        file_preview_scope: FilePreviewScope,
    },
}

#[derive(Debug)]
enum FactsCommand {
    RefreshStats {
        repo_root: String,
        files: Vec<(String, String, i64, crate::shared::models::EntryKind)>,
    },
    LoadFacts {
        repo_root: String,
        rel_path: String,
        version: i64,
        entry_kind: crate::shared::models::EntryKind,
    },
    LoadGitHistoryCount {
        repo_root: String,
        rel_path: String,
        version: i64,
        entry_kind: crate::shared::models::EntryKind,
    },
}

#[derive(Debug)]
enum EvalCommand {
    Fitness {
        repo_root: String,
        cache_key: String,
        mode: fitness::FitnessRunMode,
    },
    TestMapping {
        repo_root: String,
        files: Vec<String>,
        cache_key: String,
        full_cache_key: Option<String>,
        analysis_mode: TestMappingAnalysisMode,
    },
    Scc {
        repo_root: String,
    },
}

#[derive(Debug)]
enum BackgroundResult {
    Stats {
        entries: Vec<(String, DiffStatSummary)>,
    },
    Detail {
        entry: DetailCacheEntry,
        mode: DetailMode,
    },
    Facts {
        entry: FileFactsEntry,
    },
    GitHistoryCount {
        key: String,
        count: Option<usize>,
    },
    Fitness {
        result: Box<Result<fitness::FitnessSnapshot, String>>,
    },
    TestMapping {
        analysis_mode: TestMappingAnalysisMode,
        full_cache_key: Option<String>,
        result: Result<TestMappingSnapshot, String>,
    },
    Scc {
        result: Result<SccSummary, String>,
    },
}

#[derive(Debug, Default)]
struct PendingPreviewCommands {
    detail: Option<PendingDetail>,
}

#[derive(Debug, Default)]
struct PendingFactsCommands {
    stats: Option<PendingStats>,
    facts: Option<PendingFacts>,
    git_history: Option<PendingFacts>,
}

#[derive(Debug, Default)]
struct PendingEvalCommands {
    fitness: Option<(String, String, fitness::FitnessRunMode)>,
    test_mapping_fast: Option<(String, Vec<String>, String, Option<String>)>,
    test_mapping_full: Option<(String, Vec<String>, String, Option<String>)>,
    scc: Option<String>,
}

type PendingStats = (
    String,
    Vec<(String, String, i64, crate::shared::models::EntryKind)>,
);
type PendingDetail = (String, String, String, i64, DetailMode, FilePreviewScope);
type PendingFacts = (String, String, i64, crate::shared::models::EntryKind);

pub(super) struct AppCache {
    pub(super) diff_stats: BTreeMap<String, DiffStatSummary>,
    pub(super) preview_cache: BTreeMap<String, DetailCacheEntry>,
    pub(super) diff_cache: BTreeMap<String, DetailCacheEntry>,
    pub(super) facts_cache: BTreeMap<String, FileFactsEntry>,
    prompt_history_cache: BTreeMap<String, Vec<String>>,
    session_feature_trace_cache: BTreeMap<String, trace_parser::SessionAnalysis>,
    highlighted_detail_cache: BTreeMap<String, Text<'static>>,
    pending_stats_signature: Option<String>,
    pending_preview_request: Option<(String, FilePreviewScope)>,
    pending_diff_key: Option<String>,
    pending_facts_key: Option<String>,
    pending_git_history_key: Option<String>,
    pending_fitness: bool,
    pending_test_mapping_fast_key: Option<String>,
    pending_test_mapping_full_key: Option<String>,
    test_mapping_full_refresh_note: Option<String>,
    test_mapping_not_before_ms: Option<i64>,
    pending_scc: bool,
    queued_fitness_refresh: Option<(String, String, bool, fitness::FitnessRunMode)>,
    fitness_mode: fitness::FitnessRunMode,
    fitness_history_by_mode: BTreeMap<String, FitnessHistoryEntry>,
    fitness_is_running: bool,
    fitness_cache_key: Option<String>,
    fitness_repo_root: String,
    /// Timestamp (ms since epoch) of the last fitness trigger dispatch, used for
    /// debounce: rapid consecutive force-refresh requests within the debounce window
    /// are coalesced into a single queued run instead of launching immediately.
    fitness_last_triggered_ms: Option<i64>,
    feature_trace_catalogs: Option<FeatureTraceCatalogs>,
    feature_trace_load_attempted: bool,
    test_mapping_snapshot: Option<TestMappingSnapshot>,
    test_mapping_full_history: BTreeMap<String, TestMappingHistoryEntry>,
    scc_summary: Option<SccSummary>,
    review_triggers: ReviewTriggerCache,
    preview_worker_tx: Sender<PreviewCommand>,
    facts_worker_tx: Sender<FactsCommand>,
    eval_worker_tx: Sender<EvalCommand>,
    worker_rx: Receiver<BackgroundResult>,
    result_signal_rx: Option<Receiver<()>>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct FitnessHistoryEntry {
    #[serde(default)]
    snapshot: Option<fitness::FitnessSnapshot>,
    #[serde(default)]
    trend: Vec<f64>,
    #[serde(default)]
    last_run_ms: Option<i64>,
    #[serde(default)]
    last_error: Option<String>,
    #[serde(default)]
    cache_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FitnessHistoryRecord {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    histories: BTreeMap<String, FitnessHistoryEntry>,
    #[serde(default)]
    snapshot: Option<fitness::FitnessSnapshot>,
    #[serde(default)]
    trend: Vec<f64>,
    #[serde(default)]
    last_run_ms: Option<i64>,
    #[serde(default)]
    last_error: Option<String>,
    #[serde(default)]
    cache_key: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct TestMappingHistoryEntry {
    #[serde(default)]
    snapshot: Option<TestMappingSnapshot>,
    #[serde(default)]
    observed_at_ms: Option<i64>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct TestMappingHistoryRecord {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    histories: BTreeMap<String, TestMappingHistoryEntry>,
}

impl AppCache {
    pub(super) fn new(repo_root: &str) -> Self {
        let (preview_worker_tx, preview_worker_rx_cmd) = mpsc::channel();
        let (facts_worker_tx, facts_worker_rx_cmd) = mpsc::channel();
        let (eval_worker_tx, eval_worker_rx_cmd) = mpsc::channel();
        let (result_tx, worker_rx) = mpsc::channel();
        let (result_signal_tx, result_signal_rx) = mpsc::channel();
        let preview_result_tx = result_tx.clone();
        let facts_result_tx = result_tx.clone();
        let preview_result_signal_tx = result_signal_tx.clone();
        let facts_result_signal_tx = result_signal_tx.clone();
        thread::spawn(move || {
            preview_worker(
                preview_worker_rx_cmd,
                preview_result_tx,
                preview_result_signal_tx,
            )
        });
        thread::spawn(move || {
            facts_worker(facts_worker_rx_cmd, facts_result_tx, facts_result_signal_tx)
        });
        thread::spawn(move || eval_worker(eval_worker_rx_cmd, result_tx, result_signal_tx));
        let mut cache = Self {
            diff_stats: BTreeMap::new(),
            preview_cache: BTreeMap::new(),
            diff_cache: BTreeMap::new(),
            facts_cache: BTreeMap::new(),
            prompt_history_cache: BTreeMap::new(),
            session_feature_trace_cache: BTreeMap::new(),
            highlighted_detail_cache: BTreeMap::new(),
            pending_stats_signature: None,
            pending_preview_request: None,
            pending_diff_key: None,
            pending_facts_key: None,
            pending_git_history_key: None,
            pending_fitness: false,
            pending_test_mapping_fast_key: None,
            pending_test_mapping_full_key: None,
            test_mapping_full_refresh_note: None,
            test_mapping_not_before_ms: Some(
                chrono::Utc::now().timestamp_millis() + TEST_MAPPING_STARTUP_DELAY_MS,
            ),
            pending_scc: false,
            queued_fitness_refresh: None,
            fitness_mode: fitness::FitnessRunMode::Fast,
            fitness_history_by_mode: BTreeMap::new(),
            fitness_is_running: false,
            fitness_cache_key: None,
            fitness_repo_root: repo_root.to_string(),
            fitness_last_triggered_ms: None,
            feature_trace_catalogs: None,
            feature_trace_load_attempted: false,
            test_mapping_snapshot: None,
            test_mapping_full_history: BTreeMap::new(),
            scc_summary: None,
            review_triggers: ReviewTriggerCache::load(repo_root),
            preview_worker_tx,
            facts_worker_tx,
            eval_worker_tx,
            worker_rx,
            result_signal_rx: Some(result_signal_rx),
        };
        cache.load_fitness_history();
        cache.load_test_mapping_history();
        cache
    }

    pub(super) fn take_result_signal_rx(&mut self) -> Option<Receiver<()>> {
        self.result_signal_rx.take()
    }

    pub(super) fn has_fitness_data(&self) -> bool {
        self.active_fitness_history()
            .is_some_and(|entry| entry.snapshot.is_some() || !entry.trend.is_empty())
    }

    fn persist_fitness_history(&self) {
        let path = match fitness_history_path(&self.fitness_repo_root) {
            Some(path) => path,
            None => return,
        };
        let payload = serde_json::to_vec_pretty(&FitnessHistoryRecord {
            schema_version: FITNESS_HISTORY_SCHEMA_VERSION,
            histories: self.fitness_history_by_mode.clone(),
            snapshot: None,
            trend: Vec::new(),
            last_run_ms: None,
            last_error: None,
            cache_key: None,
        });
        let Ok(payload) = payload else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, payload);
    }

    fn load_fitness_history(&mut self) {
        let Some(record) = read_fitness_history_record(&self.fitness_repo_root) else {
            return;
        };
        if record.schema_version > FITNESS_HISTORY_SCHEMA_VERSION {
            return;
        }
        self.fitness_history_by_mode = record.histories;
        if self.fitness_history_by_mode.is_empty()
            && (record.snapshot.is_some()
                || !record.trend.is_empty()
                || record.last_run_ms.is_some()
                || record.last_error.is_some()
                || record.cache_key.is_some())
        {
            self.fitness_history_by_mode.insert(
                fitness::FitnessRunMode::Fast.as_str().to_string(),
                FitnessHistoryEntry {
                    snapshot: record.snapshot,
                    trend: record.trend,
                    last_run_ms: record.last_run_ms,
                    last_error: record.last_error,
                    cache_key: record.cache_key,
                },
            );
        }
        for entry in self.fitness_history_by_mode.values_mut() {
            if entry.trend.len() > FITNESS_TREND_CAPACITY {
                let overflow = entry.trend.len() - FITNESS_TREND_CAPACITY;
                entry.trend.drain(0..overflow);
            }
        }
        self.sync_cache_key_from_active_mode();
    }

    fn persist_test_mapping_history(&self) {
        let path = match test_mapping_history_path(&self.fitness_repo_root) {
            Some(path) => path,
            None => return,
        };
        let payload = serde_json::to_vec_pretty(&TestMappingHistoryRecord {
            schema_version: TEST_MAPPING_HISTORY_SCHEMA_VERSION,
            histories: self.test_mapping_full_history.clone(),
        });
        let Ok(payload) = payload else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, payload);
    }

    fn load_test_mapping_history(&mut self) {
        let Some(record) = read_test_mapping_history_record(&self.fitness_repo_root) else {
            return;
        };
        if record.schema_version > TEST_MAPPING_HISTORY_SCHEMA_VERSION {
            return;
        }
        self.test_mapping_full_history = record.histories;
        self.trim_test_mapping_history();
    }

    fn trim_test_mapping_history(&mut self) {
        if self.test_mapping_full_history.len() <= TEST_MAPPING_HISTORY_CAPACITY {
            return;
        }
        let mut entries = self
            .test_mapping_full_history
            .iter()
            .map(|(key, entry)| (key.clone(), entry.observed_at_ms.unwrap_or_default()))
            .collect::<Vec<_>>();
        entries.sort_by_key(|(_, observed_at_ms)| *observed_at_ms);
        let overflow = self.test_mapping_full_history.len() - TEST_MAPPING_HISTORY_CAPACITY;
        for (key, _) in entries.into_iter().take(overflow) {
            self.test_mapping_full_history.remove(&key);
        }
    }

    pub(super) fn sync_results(&mut self) -> bool {
        let mut changed = false;
        while let Ok(result) = self.worker_rx.try_recv() {
            changed = true;
            match result {
                BackgroundResult::Stats { entries } => {
                    self.diff_stats.extend(entries);
                    self.pending_stats_signature = None;
                }
                BackgroundResult::Detail { entry, mode } => match mode {
                    DetailMode::File => {
                        let entry_key = entry.key.clone();
                        let result_scope = if entry.truncated {
                            FilePreviewScope::Head
                        } else {
                            FilePreviewScope::Full
                        };
                        self.highlighted_detail_cache
                            .retain(|key, _| !key.starts_with(&entry_key));
                        self.preview_cache.insert(entry_key.clone(), entry);
                        if self.pending_preview_request.as_ref().is_some_and(
                            |(key, pending_scope)| {
                                key == &entry_key && result_scope.satisfies(*pending_scope)
                            },
                        ) {
                            self.pending_preview_request = None;
                        }
                    }
                    DetailMode::Diff => {
                        let entry_key = entry.key.clone();
                        self.highlighted_detail_cache
                            .retain(|key, _| !key.starts_with(&entry_key));
                        self.diff_cache.insert(entry_key, entry);
                        self.pending_diff_key = None;
                    }
                },
                BackgroundResult::Facts { entry } => {
                    self.facts_cache.insert(entry.key.clone(), entry);
                    self.pending_facts_key = None;
                }
                BackgroundResult::GitHistoryCount { key, count } => {
                    if let Some(entry) = self.facts_cache.get_mut(&key) {
                        entry.git_change_count = count;
                    }
                    if self.pending_git_history_key.as_deref() == Some(key.as_str()) {
                        self.pending_git_history_key = None;
                    }
                }
                BackgroundResult::Fitness { result } => {
                    let result = *result;
                    self.fitness_is_running = false;
                    match result {
                        Ok(snapshot) => {
                            let cache_key = self
                                .fitness_cache_key
                                .clone()
                                .unwrap_or_else(|| self.fitness_mode.as_str().to_string());
                            self.store_fitness_snapshot(
                                cache_key,
                                chrono::Utc::now().timestamp_millis(),
                                snapshot,
                            );
                        }
                        Err(message) => {
                            let entry = self.active_fitness_history_mut();
                            entry.last_run_ms = Some(chrono::Utc::now().timestamp_millis());
                            entry.last_error = Some(message);
                            self.pending_fitness = false;
                            self.persist_fitness_history();
                        }
                    }
                    if let Some((repo_root, cache_key, force, mode)) =
                        self.queued_fitness_refresh.take()
                    {
                        self.request_fitness_refresh(repo_root, cache_key, force, mode);
                    }
                }
                BackgroundResult::TestMapping {
                    analysis_mode,
                    full_cache_key,
                    result,
                } => match result {
                    Ok(snapshot) => {
                        match analysis_mode {
                            TestMappingAnalysisMode::Fast => {
                                self.pending_test_mapping_fast_key = None
                            }
                            TestMappingAnalysisMode::Full => {
                                self.pending_test_mapping_full_key = None;
                                self.test_mapping_full_refresh_note = None;
                            }
                        }
                        self.test_mapping_not_before_ms = None;
                        if analysis_mode == TestMappingAnalysisMode::Full {
                            self.store_test_mapping_full_snapshot(
                                full_cache_key,
                                chrono::Utc::now().timestamp_millis(),
                                snapshot.clone(),
                            );
                        }
                        self.test_mapping_snapshot = Some(snapshot);
                    }
                    Err(_) => {
                        match analysis_mode {
                            TestMappingAnalysisMode::Fast => {
                                self.pending_test_mapping_fast_key = None;
                                self.test_mapping_snapshot = None;
                            }
                            TestMappingAnalysisMode::Full => {
                                self.pending_test_mapping_full_key = None;
                                self.test_mapping_full_refresh_note = None;
                            }
                        }
                        self.test_mapping_not_before_ms = Some(
                            chrono::Utc::now().timestamp_millis() + TEST_MAPPING_FAILURE_BACKOFF_MS,
                        );
                    }
                },
                BackgroundResult::Scc { result } => {
                    self.pending_scc = false;
                    if let Ok(summary) = result {
                        self.scc_summary = Some(summary);
                    }
                }
            }
        }
        changed
    }

    pub(super) fn warm_visible_files(&mut self, state: &RuntimeState) {
        let files: Vec<(String, String, i64, crate::shared::models::EntryKind)> = state
            .file_items()
            .iter()
            .map(|file| {
                (
                    file.rel_path.clone(),
                    file.state_code.clone(),
                    file.last_modified_at_ms,
                    file.entry_kind,
                )
            })
            .collect();
        if files.is_empty() {
            self.pending_stats_signature = None;
            return;
        }
        let signature = files
            .iter()
            .map(|(path, code, version, entry_kind)| {
                format!(
                    "{path}:{code}:{version}:{}",
                    entry_kind_cache_token(*entry_kind)
                )
            })
            .collect::<Vec<_>>()
            .join("|");
        if self.pending_stats_signature.as_deref() == Some(signature.as_str()) {
            return;
        }
        let _ = self.facts_worker_tx.send(FactsCommand::RefreshStats {
            repo_root: state.repo_root.clone(),
            files,
        });
        self.pending_stats_signature = Some(signature);
    }

    pub(super) fn warm_selected_detail(&mut self, state: &RuntimeState) {
        let Some(file) = state.selected_file() else {
            self.pending_preview_request = None;
            self.pending_diff_key = None;
            self.pending_facts_key = None;
            self.pending_git_history_key = None;
            return;
        };
        let active_key = detail_cache_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
            state.detail_mode,
        );
        let requested_preview_scope = file_preview_scope_for(state);
        let active_loaded = match state.detail_mode {
            DetailMode::File => self.preview_cache.get(&active_key).is_some_and(|entry| {
                cached_file_preview_scope(entry).satisfies(requested_preview_scope)
            }),
            DetailMode::Diff => self.diff_cache.contains_key(&active_key),
        };
        let active_pending = match state.detail_mode {
            DetailMode::File => {
                self.pending_preview_request
                    .as_ref()
                    .is_some_and(|(key, pending_scope)| {
                        key == &active_key && pending_scope.satisfies(requested_preview_scope)
                    })
            }
            DetailMode::Diff => self.pending_diff_key.as_deref() == Some(active_key.as_str()),
        };
        if !active_loaded && !active_pending {
            let _ = self.preview_worker_tx.send(PreviewCommand::LoadDetail {
                repo_root: state.repo_root.clone(),
                rel_path: file.rel_path.clone(),
                state_code: file.state_code.clone(),
                version: file.last_modified_at_ms,
                mode: state.detail_mode,
                file_preview_scope: requested_preview_scope,
            });
            match state.detail_mode {
                DetailMode::File => {
                    self.pending_preview_request = Some((active_key, requested_preview_scope))
                }
                DetailMode::Diff => self.pending_diff_key = Some(active_key),
            }
        }

        let facts_key = facts_cache_key(&file.rel_path, file.last_modified_at_ms, file.entry_kind);
        if !self.facts_cache.contains_key(&facts_key)
            && self.pending_facts_key.as_deref() != Some(facts_key.as_str())
        {
            let _ = self.facts_worker_tx.send(FactsCommand::LoadFacts {
                repo_root: state.repo_root.clone(),
                rel_path: file.rel_path.clone(),
                version: file.last_modified_at_ms,
                entry_kind: file.entry_kind,
            });
            self.pending_facts_key = Some(facts_key.clone());
        }

        if state.focus == FocusPane::Detail
            && self
                .facts_cache
                .get(&facts_key)
                .is_some_and(|facts| facts.git_change_count.is_none())
            && self.pending_git_history_key.as_deref() != Some(facts_key.as_str())
        {
            let _ = self
                .facts_worker_tx
                .send(FactsCommand::LoadGitHistoryCount {
                    repo_root: state.repo_root.clone(),
                    rel_path: file.rel_path.clone(),
                    version: file.last_modified_at_ms,
                    entry_kind: file.entry_kind,
                });
            self.pending_git_history_key = Some(facts_key);
        }
    }

    pub(super) fn warm_test_mappings(&mut self, state: &RuntimeState) {
        let now_ms = chrono::Utc::now().timestamp_millis();
        if self
            .test_mapping_not_before_ms
            .is_some_and(|not_before_ms| now_ms < not_before_ms)
        {
            return;
        }

        let files = state
            .file_items()
            .iter()
            .filter(|file| file.dirty || file.conflicted)
            .map(|file| file.rel_path.clone())
            .collect::<Vec<_>>();
        if files.is_empty() {
            self.pending_test_mapping_fast_key = None;
            self.pending_test_mapping_full_key = None;
            self.test_mapping_full_refresh_note = None;
            self.test_mapping_snapshot = None;
            return;
        }

        let cache_key = test_mapping_cache_key(state);
        let full_cache_key = test_mapping_full_cache_key(state);
        let current_mode = self
            .test_mapping_snapshot
            .as_ref()
            .filter(|snapshot| snapshot.cache_key == cache_key)
            .map(|snapshot| snapshot.analysis_mode);
        if current_mode == Some(TestMappingAnalysisMode::Full) {
            return;
        }

        if let Some(full_cache_key) = full_cache_key.as_deref() {
            if let Some(snapshot) = self
                .test_mapping_full_history
                .get(full_cache_key)
                .and_then(|entry| entry.snapshot.clone())
                .filter(|snapshot| snapshot.cache_key == cache_key)
            {
                self.pending_test_mapping_fast_key = None;
                self.pending_test_mapping_full_key = None;
                self.test_mapping_full_refresh_note = None;
                self.test_mapping_not_before_ms = None;
                self.test_mapping_snapshot = Some(snapshot);
                return;
            }
        }

        if current_mode.is_none()
            && self.pending_test_mapping_fast_key.as_deref() != Some(cache_key.as_str())
        {
            let _ = self.eval_worker_tx.send(EvalCommand::TestMapping {
                repo_root: state.repo_root.clone(),
                files: files.clone(),
                cache_key: cache_key.clone(),
                full_cache_key: None,
                analysis_mode: TestMappingAnalysisMode::Fast,
            });
            self.pending_test_mapping_fast_key = Some(cache_key);
            return;
        }

        if current_mode == Some(TestMappingAnalysisMode::Fast)
            && self.pending_test_mapping_full_key.as_deref() != Some(cache_key.as_str())
        {
            if files.len() > TEST_MAPPING_FULL_REFRESH_MAX_FILES {
                self.pending_test_mapping_full_key = None;
                self.test_mapping_full_refresh_note = Some(format!(
                    "graph refresh skipped: {} dirty files exceeds budget {}",
                    files.len(),
                    TEST_MAPPING_FULL_REFRESH_MAX_FILES
                ));
                return;
            }
            let _ = self.eval_worker_tx.send(EvalCommand::TestMapping {
                repo_root: state.repo_root.clone(),
                files,
                cache_key: cache_key.clone(),
                full_cache_key,
                analysis_mode: TestMappingAnalysisMode::Full,
            });
            self.pending_test_mapping_full_key = Some(cache_key);
            self.test_mapping_full_refresh_note = None;
        }
    }

    pub(super) fn diff_stat<'a>(
        &'a self,
        file: &crate::shared::models::FileView,
    ) -> Option<&'a DiffStatSummary> {
        self.diff_stats.get(&diff_stat_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
            file.entry_kind,
        ))
    }

    pub(super) fn detail_text(
        &self,
        file: &crate::shared::models::FileView,
        mode: DetailMode,
    ) -> Option<&str> {
        let key = detail_cache_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
            mode,
        );
        match mode {
            DetailMode::File => self
                .preview_cache
                .get(&key)
                .map(|entry| entry.text.as_str()),
            DetailMode::Diff => self.diff_cache.get(&key).map(|entry| entry.text.as_str()),
        }
    }

    pub(super) fn file_facts(
        &self,
        file: &crate::shared::models::FileView,
    ) -> Option<&FileFactsEntry> {
        self.facts_cache.get(&facts_cache_key(
            &file.rel_path,
            file.last_modified_at_ms,
            file.entry_kind,
        ))
    }

    pub(super) fn request_fitness_refresh(
        &mut self,
        repo_root: String,
        cache_key: String,
        force: bool,
        mode: fitness::FitnessRunMode,
    ) {
        self.fitness_mode = mode;
        self.sync_cache_key_from_active_mode();
        if !force {
            let _ = self.try_load_latest_mailbox_snapshot(&repo_root, &cache_key, mode);
            return;
        }
        if self.fitness_is_running || self.pending_fitness {
            self.queued_fitness_refresh = Some((repo_root, cache_key, force, mode));
            return;
        }
        // Debounce: suppress identical force-refresh requests that arrive shortly
        // after the previous dispatch. Queueing while idle would strand the refresh
        // because there is no active run left to drain queued_fitness_refresh.
        const FITNESS_DEBOUNCE_MS: i64 = 500;
        let now_ms = chrono::Utc::now().timestamp_millis();
        if let Some(last_triggered_ms) = self.fitness_last_triggered_ms {
            let same_cache_key = self.fitness_cache_key.as_deref() == Some(cache_key.as_str());
            if same_cache_key && now_ms - last_triggered_ms < FITNESS_DEBOUNCE_MS {
                return;
            }
        }
        self.fitness_last_triggered_ms = Some(now_ms);
        self.fitness_cache_key = Some(cache_key.clone());
        self.active_fitness_history_mut().cache_key = Some(cache_key.clone());
        let _ = self.eval_worker_tx.send(EvalCommand::Fitness {
            repo_root,
            cache_key,
            mode,
        });
        self.fitness_is_running = true;
        self.active_fitness_history_mut().last_error = None;
        self.pending_fitness = true;
    }

    pub(super) fn sync_fitness_from_runtime(
        &mut self,
        repo_root: String,
        cache_key: String,
        mode: fitness::FitnessRunMode,
    ) {
        self.fitness_mode = mode;
        self.sync_cache_key_from_active_mode();
        let _ = self.try_load_latest_mailbox_snapshot(&repo_root, &cache_key, mode);
    }

    pub(super) fn ingest_fitness_event(
        &mut self,
        cache_key: String,
        event: &crate::shared::models::FitnessEvent,
    ) -> bool {
        if event.mode != self.fitness_mode.as_str() {
            return false;
        }
        let Some(artifact_path) = event.artifact_path.as_deref() else {
            return false;
        };
        let snapshot = fitness::load_fitness_snapshot_artifact(Path::new(artifact_path));
        let Ok(snapshot) = snapshot else {
            return false;
        };
        self.store_fitness_snapshot(cache_key, event.observed_at_ms, snapshot);
        true
    }

    pub(super) fn is_fitness_running(&self) -> bool {
        self.fitness_is_running
    }

    pub(super) fn fitness_snapshot(&self) -> Option<&fitness::FitnessSnapshot> {
        self.active_fitness_history()
            .and_then(|entry| entry.snapshot.as_ref())
    }

    pub(super) fn fitness_error(&self) -> Option<&str> {
        self.active_fitness_history()
            .and_then(|entry| entry.last_error.as_deref())
    }

    pub(super) fn fitness_last_run_ms(&self) -> Option<i64> {
        self.active_fitness_history()
            .and_then(|entry| entry.last_run_ms)
    }

    pub(super) fn fitness_trend(&self) -> &[f64] {
        self.active_fitness_history()
            .map(|entry| entry.trend.as_slice())
            .unwrap_or(&[])
    }

    pub(super) fn set_fitness_mode(&mut self, mode: FitnessViewMode) {
        self.fitness_mode = match mode {
            FitnessViewMode::Fast => fitness::FitnessRunMode::Fast,
            FitnessViewMode::Full => fitness::FitnessRunMode::Full,
        };
        self.sync_cache_key_from_active_mode();
    }

    pub(super) fn request_scc_refresh(&mut self, repo_root: String, force: bool) {
        if self.pending_scc {
            return;
        }
        if !force && self.scc_summary.is_none() {
            let _ = self.eval_worker_tx.send(EvalCommand::Scc { repo_root });
            self.pending_scc = true;
            return;
        }
        let _ = self.eval_worker_tx.send(EvalCommand::Scc { repo_root });
        self.pending_scc = true;
    }

    pub(super) fn scc_summary(&self) -> Option<&SccSummary> {
        self.scc_summary.as_ref()
    }

    #[cfg(test)]
    pub(super) fn set_fitness_snapshot_for_tests(
        &mut self,
        mode: fitness::FitnessRunMode,
        snapshot: fitness::FitnessSnapshot,
    ) {
        self.fitness_mode = mode;
        self.fitness_history_by_mode
            .entry(mode.as_str().to_string())
            .or_default()
            .snapshot = Some(snapshot);
        self.sync_cache_key_from_active_mode();
    }

    #[cfg(test)]
    pub(super) fn set_test_mapping_snapshot_for_tests(
        &mut self,
        cache_key: String,
        analysis_mode: TestMappingAnalysisMode,
        entries: Vec<TestMappingEntry>,
        skipped_test_files: Vec<String>,
    ) {
        self.test_mapping_snapshot = Some(build_test_mapping_snapshot(
            cache_key,
            analysis_mode,
            entries,
            skipped_test_files,
        ));
    }

    #[cfg(test)]
    pub(super) fn set_test_mapping_graph_pending_for_tests(&mut self, cache_key: String) {
        self.pending_test_mapping_full_key = Some(cache_key);
        self.test_mapping_full_refresh_note = None;
    }

    #[cfg(test)]
    pub(super) fn set_test_mapping_graph_note_for_tests(&mut self, note: String) {
        self.pending_test_mapping_full_key = None;
        self.test_mapping_full_refresh_note = Some(note);
    }

    #[cfg(test)]
    pub(super) fn set_session_feature_trace_for_tests(
        &mut self,
        material: SessionTraceMaterial,
        analysis: trace_parser::SessionAnalysis,
    ) {
        let cache_key = cache_key_for_session_trace(&material);
        self.session_feature_trace_cache.insert(cache_key, analysis);
    }

    fn active_fitness_history(&self) -> Option<&FitnessHistoryEntry> {
        self.fitness_history_by_mode.get(self.fitness_mode.as_str())
    }

    fn active_fitness_history_mut(&mut self) -> &mut FitnessHistoryEntry {
        self.fitness_history_by_mode
            .entry(self.fitness_mode.as_str().to_string())
            .or_default()
    }

    fn try_load_latest_mailbox_snapshot(
        &mut self,
        repo_root: &str,
        cache_key: &str,
        mode: fitness::FitnessRunMode,
    ) -> bool {
        let Some(event) = latest_fitness_mailbox_event(repo_root, mode.as_str()) else {
            return false;
        };
        self.ingest_fitness_event(cache_key.to_string(), &event)
    }

    fn store_fitness_snapshot(
        &mut self,
        cache_key: String,
        observed_at_ms: i64,
        snapshot: fitness::FitnessSnapshot,
    ) {
        let current_artifact = self
            .active_fitness_history()
            .and_then(|entry| entry.snapshot.as_ref())
            .and_then(|snapshot| snapshot.artifact_path.as_deref());
        let same_artifact =
            current_artifact.is_some() && current_artifact == snapshot.artifact_path.as_deref();

        let snapshot_score = snapshot.final_score;
        let entry = self.active_fitness_history_mut();
        entry.last_run_ms = Some(observed_at_ms);
        entry.last_error = None;
        entry.cache_key = Some(cache_key.clone());
        entry.snapshot = Some(snapshot);
        if !same_artifact {
            entry.trend.push(snapshot_score);
            if entry.trend.len() > FITNESS_TREND_CAPACITY {
                let overflow = entry.trend.len() - FITNESS_TREND_CAPACITY;
                entry.trend.drain(0..overflow);
            }
        }
        self.fitness_cache_key = Some(cache_key);
        self.fitness_is_running = false;
        self.pending_fitness = false;
        self.persist_fitness_history();
    }

    fn store_test_mapping_full_snapshot(
        &mut self,
        full_cache_key: Option<String>,
        observed_at_ms: i64,
        snapshot: TestMappingSnapshot,
    ) {
        let Some(full_cache_key) = full_cache_key else {
            return;
        };
        self.test_mapping_full_history.insert(
            full_cache_key,
            TestMappingHistoryEntry {
                snapshot: Some(snapshot),
                observed_at_ms: Some(observed_at_ms),
            },
        );
        self.trim_test_mapping_history();
        self.persist_test_mapping_history();
    }

    fn sync_cache_key_from_active_mode(&mut self) {
        self.fitness_cache_key = self
            .active_fitness_history()
            .and_then(|entry| entry.cache_key.clone());
    }

    pub(super) fn highlighted_detail_text(
        &mut self,
        file: &crate::shared::models::FileView,
        mode: DetailMode,
        theme_mode: ThemeMode,
    ) -> Option<&Text<'static>> {
        let render_key = detail_render_cache_key(file, mode, theme_mode);
        if !self.highlighted_detail_cache.contains_key(&render_key) {
            let raw = self.detail_text(file, mode)?;
            let rendered = match mode {
                DetailMode::File => {
                    super::highlight::highlight_code_text(Some(&file.rel_path), raw, theme_mode)
                }
                DetailMode::Diff => {
                    super::highlight::highlight_diff_text(Some(&file.rel_path), raw, theme_mode)
                }
            };
            self.highlighted_detail_cache
                .insert(render_key.clone(), rendered);
        }
        self.highlighted_detail_cache.get(&render_key)
    }

    pub(super) fn review_hint(&self, file: &crate::shared::models::FileView) -> Option<ReviewHint> {
        self.review_triggers.review_hint(file)
    }

    pub(super) fn transcript_prompt_history(
        &mut self,
        transcript_path: &str,
        limit: usize,
    ) -> Vec<String> {
        if limit == 0 {
            return Vec::new();
        }

        let modified_ms = std::fs::metadata(transcript_path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|dur| dur.as_millis() as i64)
            .unwrap_or_default();
        let cache_key = format!("{transcript_path}:{modified_ms}:{limit}");

        if !self.prompt_history_cache.contains_key(&cache_key) {
            let prompts = recent_prompt_previews_from_transcript(transcript_path, limit);
            self.prompt_history_cache.insert(cache_key.clone(), prompts);
        }

        self.prompt_history_cache
            .get(&cache_key)
            .cloned()
            .unwrap_or_default()
    }

    pub(super) fn session_feature_trace(
        &mut self,
        material: SessionTraceMaterial,
    ) -> Option<&trace_parser::SessionAnalysis> {
        if material.changed_files.is_empty() {
            return None;
        }

        let cache_key = cache_key_for_session_trace(&material);
        if !self.session_feature_trace_cache.contains_key(&cache_key) {
            let analysis = {
                let catalogs = self.ensure_feature_trace_catalogs()?;
                catalogs.analyze(&material)
            };
            self.session_feature_trace_cache
                .insert(cache_key.clone(), analysis);
        }

        self.session_feature_trace_cache.get(&cache_key)
    }

    pub(super) fn test_mapping(
        &self,
        file: &crate::shared::models::FileView,
    ) -> Option<&TestMappingEntry> {
        self.test_mapping_snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.by_file.get(&file.rel_path))
    }

    pub(super) fn is_changed_test_file(&self, file: &crate::shared::models::FileView) -> bool {
        if self::test_mapping::is_test_like_path(&file.rel_path) {
            return true;
        }
        self.test_mapping_snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.skipped_test_files.contains(&file.rel_path))
    }

    pub(super) fn test_mapping_status_counts(&self) -> Option<&BTreeMap<String, usize>> {
        self.test_mapping_snapshot
            .as_ref()
            .map(|snapshot| &snapshot.status_counts)
    }

    pub(super) fn test_mapping_analysis_mode(&self) -> Option<TestMappingAnalysisMode> {
        self.test_mapping_snapshot
            .as_ref()
            .map(|snapshot| snapshot.analysis_mode)
    }

    pub(super) fn test_mapping_graph_enrichment_pending(&self) -> bool {
        self.pending_test_mapping_full_key.is_some()
    }

    pub(super) fn test_mapping_graph_enrichment_note(&self) -> Option<&str> {
        self.test_mapping_full_refresh_note.as_deref()
    }
    pub(super) fn repo_review_hints(
        &self,
        files: &[&crate::shared::models::FileView],
    ) -> Vec<RepoReviewHint> {
        self.review_triggers
            .repo_review_hints(files, |file| self.diff_stat(file))
    }

    pub(super) fn repo_review_context_for_file(
        &self,
        file: &crate::shared::models::FileView,
        files: &[&crate::shared::models::FileView],
    ) -> Vec<RepoReviewHint> {
        self.review_triggers
            .repo_review_context_for_file(file, files, |entry| self.diff_stat(entry))
    }

    fn ensure_feature_trace_catalogs(&mut self) -> Option<&FeatureTraceCatalogs> {
        if !self.feature_trace_load_attempted {
            self.feature_trace_catalogs =
                FeatureTraceCatalogs::load(Path::new(&self.fitness_repo_root))
                    .ok()
                    .flatten();
            self.feature_trace_load_attempted = true;
        }
        self.feature_trace_catalogs.as_ref()
    }
}

fn parse_numstat(stdout: &str) -> BTreeMap<String, (Option<usize>, Option<usize>)> {
    let mut stats = BTreeMap::new();
    for line in stdout.lines().filter(|line| !line.trim().is_empty()) {
        let mut cols = line.split('\t');
        let Some(add) = cols.next() else {
            continue;
        };
        let Some(del) = cols.next() else {
            continue;
        };
        let Some(path) = cols.next() else {
            continue;
        };
        let additions = if add == "-" {
            None
        } else {
            add.parse::<usize>().ok()
        };
        let deletions = if del == "-" {
            None
        } else {
            del.parse::<usize>().ok()
        };
        stats.insert(path.to_string(), (additions, deletions));
    }
    stats
}

pub(super) fn diff_stat_key(
    rel_path: &str,
    state_code: &str,
    version: i64,
    entry_kind: crate::shared::models::EntryKind,
) -> String {
    format!(
        "{rel_path}:{state_code}:{version}:{}",
        entry_kind_cache_token(entry_kind)
    )
}

pub(super) fn detail_cache_key(
    rel_path: &str,
    state_code: &str,
    version: i64,
    mode: DetailMode,
) -> String {
    format!("{rel_path}:{state_code}:{version}:{mode:?}")
}

fn detail_render_cache_key(
    file: &crate::shared::models::FileView,
    mode: DetailMode,
    theme_mode: ThemeMode,
) -> String {
    format!(
        "{}:{theme_mode:?}",
        detail_cache_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
            mode
        )
    )
}

fn file_preview_scope_for(state: &RuntimeState) -> FilePreviewScope {
    if matches!(state.detail_mode, DetailMode::File) && state.detail_scroll > 0 {
        FilePreviewScope::Full
    } else {
        FilePreviewScope::Head
    }
}

fn cached_file_preview_scope(entry: &DetailCacheEntry) -> FilePreviewScope {
    if entry.truncated {
        FilePreviewScope::Head
    } else {
        FilePreviewScope::Full
    }
}

pub(super) fn facts_cache_key(
    rel_path: &str,
    version: i64,
    entry_kind: crate::shared::models::EntryKind,
) -> String {
    format!(
        "{rel_path}:{version}:{}:facts",
        entry_kind_cache_token(entry_kind)
    )
}

fn entry_kind_cache_token(entry_kind: crate::shared::models::EntryKind) -> &'static str {
    match entry_kind {
        crate::shared::models::EntryKind::File => "file",
        crate::shared::models::EntryKind::Directory => "dir",
        crate::shared::models::EntryKind::Submodule => "sub",
    }
}

pub(super) fn short_state_code(state_code: &str) -> &'static str {
    match state_code {
        "delete" => "D",
        "add" | "untracked" => "A",
        "rename" => "R",
        _ => "M",
    }
}

pub(super) fn display_status_code(file: &crate::shared::models::FileView) -> String {
    if file.entry_kind.is_submodule() {
        "SUB".to_string()
    } else if file.entry_kind.is_directory() {
        "DIR".to_string()
    } else {
        short_state_code(&file.state_code).to_string()
    }
}

fn compute_diff_stat(repo_root: &str, rel_path: &str, state_code: &str) -> DiffStatSummary {
    let path = Path::new(repo_root).join(rel_path);
    let entry_kind = crate::observe::entry_kind_for_repo_path(Path::new(repo_root), rel_path);
    let status = if entry_kind.is_submodule() {
        "SUB".to_string()
    } else if entry_kind.is_directory() {
        "DIR".to_string()
    } else {
        short_state_code(state_code).to_string()
    };

    if entry_kind.is_container() {
        return DiffStatSummary {
            status,
            additions: None,
            deletions: None,
        };
    }

    if state_code == "untracked" || state_code == "add" {
        let added = std::fs::read_to_string(path)
            .ok()
            .map(|text| text.lines().count())
            .unwrap_or(0);
        return DiffStatSummary {
            status,
            additions: Some(added),
            deletions: None,
        };
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("diff")
        .arg("--numstat")
        .arg("--")
        .arg(rel_path)
        .output();
    if let Ok(output) = output {
        if output.status.success() {
            if let Ok(stdout) = String::from_utf8(output.stdout) {
                if let Some(line) = stdout.lines().find(|line| !line.trim().is_empty()) {
                    let cols: Vec<&str> = line.split_whitespace().collect();
                    if cols.len() >= 2 {
                        let add = cols[0];
                        let del = cols[1];
                        if add == "-" || del == "-" {
                            return DiffStatSummary {
                                status,
                                additions: None,
                                deletions: None,
                            };
                        }
                        let add_num = add.parse::<usize>().unwrap_or(0);
                        let del_num = del.parse::<usize>().unwrap_or(0);
                        return match (add_num, del_num) {
                            (0, 0) => DiffStatSummary {
                                status,
                                additions: None,
                                deletions: None,
                            },
                            (0, d) => DiffStatSummary {
                                status,
                                additions: None,
                                deletions: Some(d),
                            },
                            (a, 0) => DiffStatSummary {
                                status,
                                additions: Some(a),
                                deletions: None,
                            },
                            (a, d) => DiffStatSummary {
                                status,
                                additions: Some(a),
                                deletions: Some(d),
                            },
                        };
                    }
                }
            }
        }
    }

    DiffStatSummary {
        status,
        additions: None,
        deletions: None,
    }
}

fn compute_diff_stats_batch(
    repo_root: &str,
    files: &[(String, String, i64, crate::shared::models::EntryKind)],
) -> Vec<(String, DiffStatSummary)> {
    let mut results = Vec::new();
    let mut git_paths = Vec::new();
    let mut git_entries = Vec::new();

    for (rel_path, state_code, version, entry_kind) in files {
        let key = diff_stat_key(rel_path, state_code, *version, *entry_kind);
        let path = Path::new(repo_root).join(rel_path);
        let status = if entry_kind.is_submodule() {
            "SUB".to_string()
        } else if entry_kind.is_directory() {
            "DIR".to_string()
        } else {
            short_state_code(state_code).to_string()
        };

        if entry_kind.is_container() {
            results.push((
                key,
                DiffStatSummary {
                    status,
                    additions: None,
                    deletions: None,
                },
            ));
            continue;
        }

        if state_code == "untracked" || state_code == "add" {
            let added = std::fs::read_to_string(&path)
                .ok()
                .map(|text| text.lines().count());
            results.push((
                key,
                DiffStatSummary {
                    status,
                    additions: added,
                    deletions: None,
                },
            ));
            continue;
        }

        if state_code == "rename" {
            results.push((key, compute_diff_stat(repo_root, rel_path, state_code)));
            continue;
        }

        git_paths.push(rel_path.clone());
        git_entries.push((key, rel_path.clone(), status));
    }

    let parsed = if git_paths.is_empty() {
        BTreeMap::new()
    } else {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo_root)
            .arg("diff")
            .arg("--numstat")
            .arg("--")
            .args(&git_paths)
            .output()
            .ok();
        output
            .filter(|output| output.status.success())
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|stdout| parse_numstat(&stdout))
            .unwrap_or_default()
    };

    for (key, rel_path, status) in git_entries {
        let (additions, deletions) = parsed.get(&rel_path).cloned().unwrap_or((None, None));
        results.push((
            key,
            DiffStatSummary {
                status,
                additions,
                deletions,
            },
        ));
    }

    results
}

fn send_background_result(
    tx: &Sender<BackgroundResult>,
    result_signal_tx: &Sender<()>,
    result: BackgroundResult,
) {
    if tx.send(result).is_ok() {
        let _ = result_signal_tx.send(());
    }
}

fn preview_worker(
    rx: Receiver<PreviewCommand>,
    tx: Sender<BackgroundResult>,
    result_signal_tx: Sender<()>,
) {
    while let Ok(command) = rx.recv() {
        let mut pending = PendingPreviewCommands::default();
        queue_preview_command(&mut pending, command);
        while let Ok(next) = rx.try_recv() {
            queue_preview_command(&mut pending, next);
        }
        if let Some((repo_root, rel_path, state_code, version, mode, file_preview_scope)) =
            pending.detail.take()
        {
            let (text, truncated) = match mode {
                DetailMode::File => {
                    load_file_preview(&repo_root, rel_path.as_str(), file_preview_scope)
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| ("<no file content available>".to_string(), false))
                }
                DetailMode::Diff => {
                    let text = load_diff_text(&repo_root, rel_path.as_str(), state_code.as_str())
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| "<no diff available>".to_string());
                    (text, false)
                }
            };
            send_background_result(
                &tx,
                &result_signal_tx,
                BackgroundResult::Detail {
                    entry: DetailCacheEntry {
                        key: detail_cache_key(&rel_path, &state_code, version, mode),
                        text,
                        truncated,
                    },
                    mode,
                },
            );
        }
    }
}

fn facts_worker(
    rx: Receiver<FactsCommand>,
    tx: Sender<BackgroundResult>,
    result_signal_tx: Sender<()>,
) {
    while let Ok(command) = rx.recv() {
        let mut pending = PendingFactsCommands::default();
        queue_facts_command(&mut pending, command);
        while let Ok(next) = rx.try_recv() {
            queue_facts_command(&mut pending, next);
        }
        if let Some((repo_root, files)) = pending.stats.take() {
            let mut seen = BTreeSet::new();
            let deduped_files = files
                .into_iter()
                .filter(|(rel_path, state_code, version, entry_kind)| {
                    let key = diff_stat_key(rel_path, state_code, *version, *entry_kind);
                    if !seen.insert(key.clone()) {
                        return false;
                    }
                    true
                })
                .collect::<Vec<_>>();
            let entries = compute_diff_stats_batch(&repo_root, &deduped_files);
            send_background_result(&tx, &result_signal_tx, BackgroundResult::Stats { entries });
        }
        if let Some((repo_root, rel_path, version, entry_kind)) = pending.facts.take() {
            send_background_result(
                &tx,
                &result_signal_tx,
                BackgroundResult::Facts {
                    entry: load_file_facts(&repo_root, &rel_path, version, entry_kind),
                },
            );
        }
        if let Some((repo_root, rel_path, version, entry_kind)) = pending.git_history.take() {
            send_background_result(
                &tx,
                &result_signal_tx,
                BackgroundResult::GitHistoryCount {
                    key: facts_cache_key(&rel_path, version, entry_kind),
                    count: git_file_change_count(&repo_root, &rel_path),
                },
            );
        }
    }
}

fn eval_worker(
    rx: Receiver<EvalCommand>,
    tx: Sender<BackgroundResult>,
    result_signal_tx: Sender<()>,
) {
    while let Ok(command) = rx.recv() {
        let mut pending = PendingEvalCommands::default();
        queue_eval_command(&mut pending, command);
        while let Ok(next) = rx.try_recv() {
            queue_eval_command(&mut pending, next);
        }
        if let Some((repo_root, cache_key, mode)) = pending.fitness.take() {
            let result = fitness::run_fitness(&repo_root, mode).map_err(|error| error.to_string());
            let _ = cache_key;
            send_background_result(
                &tx,
                &result_signal_tx,
                BackgroundResult::Fitness {
                    result: Box::new(result),
                },
            );
        }
        if let Some((repo_root, files, cache_key, full_cache_key)) =
            pending.test_mapping_fast.take()
        {
            let result = load_test_mapping_snapshot(
                &repo_root,
                &files,
                cache_key,
                TestMappingAnalysisMode::Fast,
            );
            send_background_result(
                &tx,
                &result_signal_tx,
                BackgroundResult::TestMapping {
                    analysis_mode: TestMappingAnalysisMode::Fast,
                    full_cache_key,
                    result,
                },
            );
        }
        if let Some((repo_root, files, cache_key, full_cache_key)) =
            pending.test_mapping_full.take()
        {
            let result = load_test_mapping_snapshot(
                &repo_root,
                &files,
                cache_key,
                TestMappingAnalysisMode::Full,
            );
            send_background_result(
                &tx,
                &result_signal_tx,
                BackgroundResult::TestMapping {
                    analysis_mode: TestMappingAnalysisMode::Full,
                    full_cache_key,
                    result,
                },
            );
        }
        if let Some(repo_root) = pending.scc.take() {
            send_background_result(
                &tx,
                &result_signal_tx,
                BackgroundResult::Scc {
                    result: run_scc_summary(&repo_root),
                },
            );
        }
    }
}

fn queue_preview_command(pending: &mut PendingPreviewCommands, command: PreviewCommand) {
    match command {
        PreviewCommand::LoadDetail {
            repo_root,
            rel_path,
            state_code,
            version,
            mode,
            file_preview_scope,
        } => {
            pending.detail = Some((
                repo_root,
                rel_path,
                state_code,
                version,
                mode,
                file_preview_scope,
            ));
        }
    }
}

fn queue_facts_command(pending: &mut PendingFactsCommands, command: FactsCommand) {
    match command {
        FactsCommand::RefreshStats { repo_root, files } => {
            pending.stats = Some((repo_root, files));
        }
        FactsCommand::LoadFacts {
            repo_root,
            rel_path,
            version,
            entry_kind,
        } => {
            pending.facts = Some((repo_root, rel_path, version, entry_kind));
        }
        FactsCommand::LoadGitHistoryCount {
            repo_root,
            rel_path,
            version,
            entry_kind,
        } => {
            pending.git_history = Some((repo_root, rel_path, version, entry_kind));
        }
    }
}

fn queue_eval_command(pending: &mut PendingEvalCommands, command: EvalCommand) {
    match command {
        EvalCommand::Fitness {
            repo_root,
            cache_key,
            mode,
        } => {
            pending.fitness = Some((repo_root, cache_key, mode));
        }
        EvalCommand::TestMapping {
            repo_root,
            files,
            cache_key,
            full_cache_key,
            analysis_mode,
        } => match analysis_mode {
            TestMappingAnalysisMode::Fast => {
                pending.test_mapping_fast = Some((repo_root, files, cache_key, full_cache_key));
            }
            TestMappingAnalysisMode::Full => {
                pending.test_mapping_full = Some((repo_root, files, cache_key, full_cache_key));
            }
        },
        EvalCommand::Scc { repo_root } => {
            pending.scc = Some(repo_root);
        }
    }
}

fn run_scc_summary(repo_root: &str) -> Result<SccSummary, String> {
    let mut command = Command::new("scc");
    command
        .arg("--no-cocomo")
        .arg("--no-complexity")
        .arg("--no-size")
        .arg("--no-gen")
        .arg("--format")
        .arg("json");
    let exclude_dirs = scc_exclude_dirs(repo_root);
    if !exclude_dirs.is_empty() {
        command.arg("--exclude-dir").arg(exclude_dirs.join(","));
    }
    command.arg(repo_root);

    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "scc failed".to_string()
        } else {
            stderr
        });
    }

    let summaries: Vec<SccLanguageSummary> =
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    Ok(SccSummary {
        lines: summaries.iter().map(|summary| summary.lines).sum(),
        code: summaries.into_iter().map(|summary| summary.code).sum(),
    })
}

fn scc_exclude_dirs(repo_root: &str) -> Vec<String> {
    let mut dirs = vec![".git".to_string(), ".hg".to_string(), ".svn".to_string()];
    dirs.extend(git_submodule_paths(repo_root));
    dirs
}

fn git_submodule_paths(repo_root: &str) -> Vec<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("ls-files")
        .arg("--stage")
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            if !line.starts_with("160000 ") {
                return None;
            }
            let path = line.split('\t').nth(1)?;
            Some(path.to_string())
        })
        .collect()
}

fn load_file_facts(
    repo_root: &str,
    rel_path: &str,
    version: i64,
    entry_kind: crate::shared::models::EntryKind,
) -> FileFactsEntry {
    let path = Path::new(repo_root).join(rel_path);
    let content = std::fs::read_to_string(&path).ok();
    let line_count = if entry_kind.is_container() {
        0
    } else {
        content
            .as_ref()
            .map(|text| text.lines().count())
            .unwrap_or(0)
    };
    let byte_size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let child_count = if entry_kind.is_container() {
        std::fs::read_dir(&path).ok().map(|entries| entries.count())
    } else {
        None
    };
    FileFactsEntry {
        key: facts_cache_key(rel_path, version, entry_kind),
        entry_kind,
        line_count,
        byte_size,
        child_count,
        git_change_count: None,
    }
}

fn git_file_change_count(repo_root: &str, rel_path: &str) -> Option<usize> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("log")
        .arg("--follow")
        .arg("--format=%H")
        .arg("--")
        .arg(rel_path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    Some(
        stdout
            .lines()
            .filter(|line| !line.trim().is_empty())
            .count(),
    )
}

#[cfg(test)]
mod scc_tests {
    use super::git_submodule_paths;
    use std::process::Command;
    use tempfile::tempdir;

    #[test]
    fn git_submodule_paths_reads_gitlinks() {
        let dir = tempdir().expect("tempdir");
        let init = Command::new("git")
            .args(["init", "--no-bare"])
            .arg(dir.path())
            .output()
            .expect("init repo");
        assert!(init.status.success(), "git init failed: {init:?}");

        let update_index = Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .arg("update-index")
            .arg("--add")
            .arg("--info-only")
            .arg("--cacheinfo")
            .arg("160000")
            .arg("a745c6f9664e4525be45e02582e7dc970158ec74")
            .arg("tools/entrix")
            .output()
            .expect("register gitlink");
        assert!(
            update_index.status.success(),
            "git update-index failed: {update_index:?}"
        );

        assert_eq!(
            git_submodule_paths(&dir.path().to_string_lossy()),
            vec!["tools/entrix"]
        );
    }
}

#[cfg(test)]
#[path = "cache_tests.rs"]
mod tests;

#[path = "cache_test_mapping.rs"]
mod test_mapping;
#[cfg(test)]
use self::test_mapping::build_test_mapping_snapshot;
use self::test_mapping::{
    load_test_mapping_snapshot, test_mapping_cache_key, test_mapping_full_cache_key,
};
pub(super) use self::test_mapping::{
    TestMappingAnalysisMode, TestMappingEntry, TestMappingSnapshot,
};

#[path = "cache_history.rs"]
mod history;
use history::{
    fitness_history_path, latest_fitness_mailbox_event, read_fitness_history_record,
    read_test_mapping_history_record, test_mapping_history_path,
};

pub(super) fn load_diff_text(
    repo_root: &str,
    rel_path: &str,
    state_code: &str,
) -> Result<Option<String>> {
    if let Some((submodule_path, nested_rel_path)) = submodule_context(repo_root, rel_path) {
        if nested_rel_path.is_empty() {
            return load_submodule_diff_text(repo_root, &submodule_path);
        }
        return load_submodule_nested_diff_text(
            repo_root,
            &submodule_path,
            &nested_rel_path,
            state_code,
        );
    }

    let path = Path::new(repo_root).join(rel_path);
    if std::fs::metadata(&path)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        let child_count = std::fs::read_dir(&path)
            .ok()
            .map(|entries| entries.count())
            .unwrap_or(0);
        return Ok(Some(format!(
            "<directory: {child_count} entries>\n{rel_path}"
        )));
    }
    if state_code == "untracked" {
        if !path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(&path).context("read untracked file")?;
        let mut out = Vec::new();
        out.push(format!("+++ {rel_path}"));
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

fn submodule_context(repo_root: &str, rel_path: &str) -> Option<(String, String)> {
    let repo_root = Path::new(repo_root);
    let rel_path = rel_path.replace('\\', "/");

    if crate::observe::entry_kind_for_repo_path(repo_root, &rel_path).is_submodule() {
        return Some((rel_path, String::new()));
    }

    let mut current = Path::new(&rel_path).parent();
    while let Some(parent) = current {
        let parent_rel = parent.to_string_lossy().replace('\\', "/");
        if crate::observe::entry_kind_for_repo_path(repo_root, &parent_rel).is_submodule() {
            let nested_rel = Path::new(&rel_path)
                .strip_prefix(parent)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            return Some((parent_rel, nested_rel));
        }
        current = parent.parent();
    }

    None
}

fn load_submodule_diff_text(repo_root: &str, rel_path: &str) -> Result<Option<String>> {
    let submodule_root = Path::new(repo_root).join(rel_path);
    if !submodule_root.exists() {
        return Ok(Some(format!("<submodule missing>\n{rel_path}")));
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(&submodule_root)
        .arg("status")
        .arg("--short")
        .arg("--untracked-files=all")
        .output()
        .context("run submodule git status")?;

    if !output.status.success() {
        return Ok(Some(format!("<submodule status unavailable>\n{rel_path}")));
    }

    let stdout = String::from_utf8(output.stdout).context("decode submodule status output")?;
    let entries = stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(200)
        .collect::<Vec<_>>();

    if entries.is_empty() {
        return Ok(Some(format!("<submodule clean>\n{rel_path}")));
    }

    let mut out = Vec::with_capacity(entries.len() + 2);
    out.push(format!("Submodule: {rel_path}"));
    out.push(String::new());
    out.extend(entries.into_iter().map(|line| line.to_string()));
    Ok(Some(out.join("\n")))
}

fn load_submodule_nested_diff_text(
    repo_root: &str,
    submodule_path: &str,
    nested_rel_path: &str,
    state_code: &str,
) -> Result<Option<String>> {
    let submodule_root = Path::new(repo_root).join(submodule_path);
    let nested_path = submodule_root.join(nested_rel_path);

    if state_code == "untracked" {
        if !nested_path.exists() {
            return Ok(None);
        }
        let content =
            std::fs::read_to_string(&nested_path).context("read untracked submodule file")?;
        let mut out = Vec::new();
        out.push(format!("+++ {nested_rel_path}"));
        for line in content.lines().take(200) {
            out.push(format!("+{line}"));
        }
        return Ok(Some(out.join("\n")));
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(&submodule_root)
        .arg("diff")
        .arg("--no-ext-diff")
        .arg("--no-color")
        .arg("--")
        .arg(nested_rel_path)
        .output()
        .context("run submodule nested git diff")?;

    if !output.status.success() {
        return Ok(None);
    }

    let text = String::from_utf8(output.stdout).context("decode submodule nested diff output")?;
    if text.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(text))
    }
}

fn load_file_preview(
    repo_root: &str,
    rel_path: &str,
    scope: FilePreviewScope,
) -> Result<Option<(String, bool)>> {
    let path = Path::new(repo_root).join(rel_path);
    if !path.exists() {
        return Ok(None);
    }
    if std::fs::metadata(&path)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        let mut entries = std::fs::read_dir(&path)
            .context("read directory preview")?
            .filter_map(|entry| entry.ok())
            .map(|entry| {
                let mut name = entry.file_name().to_string_lossy().to_string();
                if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                    name.push('/');
                }
                name
            })
            .collect::<Vec<_>>();
        entries.sort();
        let preview = if entries.is_empty() {
            "<directory is empty>".to_string()
        } else {
            entries
                .into_iter()
                .take(DIRECTORY_PREVIEW_ENTRY_LIMIT)
                .collect::<Vec<_>>()
                .join("\n")
        };
        return Ok(Some((preview, false)));
    }
    match scope {
        FilePreviewScope::Full => {
            let content = std::fs::read_to_string(path).context("read file preview")?;
            Ok(Some((content, false)))
        }
        FilePreviewScope::Head => {
            let file = File::open(path).context("open file preview")?;
            let mut reader = BufReader::new(file);
            let mut lines = Vec::new();
            let mut buffer = String::new();
            let mut truncated = false;

            while lines.len() < INITIAL_FILE_PREVIEW_LINE_LIMIT + 1 {
                buffer.clear();
                let bytes = reader
                    .read_line(&mut buffer)
                    .context("read file preview line")?;
                if bytes == 0 {
                    break;
                }
                if buffer.ends_with('\n') {
                    buffer.pop();
                    if buffer.ends_with('\r') {
                        buffer.pop();
                    }
                }
                lines.push(buffer.clone());
            }

            if lines.len() > INITIAL_FILE_PREVIEW_LINE_LIMIT {
                lines.truncate(INITIAL_FILE_PREVIEW_LINE_LIMIT);
                truncated = true;
            }

            Ok(Some((lines.join("\n"), truncated)))
        }
    }
}
