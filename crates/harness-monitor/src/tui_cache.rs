use super::fitness;
use super::review::{RepoReviewHint, ReviewHint, ReviewTriggerCache};
use super::*;
use crate::state::FitnessViewMode;
use ratatui::text::Text;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Command;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

const FITNESS_HISTORY_SCHEMA_VERSION: u32 = 1;
const FITNESS_HISTORY_FILE: &str = "fitness-history.json";
const FITNESS_TREND_CAPACITY: usize = 12;

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
pub(super) struct DiffStatSummary {
    pub(super) status: String,
    pub(super) additions: Option<usize>,
    pub(super) deletions: Option<usize>,
}

#[derive(Clone, Debug)]
pub(super) struct DetailCacheEntry {
    pub(super) key: String,
    pub(super) text: String,
}

#[derive(Clone, Debug)]
pub(super) struct FileFactsEntry {
    pub(super) key: String,
    pub(super) entry_kind: crate::models::EntryKind,
    pub(super) line_count: usize,
    pub(super) byte_size: u64,
    pub(super) child_count: Option<usize>,
    pub(super) git_change_count: usize,
}

#[derive(Debug)]
enum BackgroundCommand {
    RefreshStats {
        repo_root: String,
        files: Vec<(String, String, i64, crate::models::EntryKind)>,
    },
    LoadDetail {
        repo_root: String,
        rel_path: String,
        state_code: String,
        version: i64,
        mode: DetailMode,
    },
    LoadFacts {
        repo_root: String,
        rel_path: String,
        version: i64,
        entry_kind: crate::models::EntryKind,
    },
    RefreshFitness {
        repo_root: String,
        cache_key: String,
        mode: fitness::FitnessRunMode,
    },
    RefreshScc {
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
    Fitness {
        result: Box<Result<fitness::FitnessSnapshot, String>>,
    },
    Scc {
        result: Result<SccSummary, String>,
    },
}

#[derive(Debug, Default)]
struct PendingCommands {
    stats: Option<PendingStats>,
    detail: Option<PendingDetail>,
    facts: Option<PendingFacts>,
    fitness: Option<(String, String, fitness::FitnessRunMode)>,
    scc: Option<String>,
}

type PendingStats = (String, Vec<(String, String, i64, crate::models::EntryKind)>);
type PendingDetail = (String, String, String, i64, DetailMode);
type PendingFacts = (String, String, i64, crate::models::EntryKind);

pub(super) struct AppCache {
    pub(super) diff_stats: BTreeMap<String, DiffStatSummary>,
    pub(super) preview_cache: BTreeMap<String, DetailCacheEntry>,
    pub(super) diff_cache: BTreeMap<String, DetailCacheEntry>,
    pub(super) facts_cache: BTreeMap<String, FileFactsEntry>,
    highlighted_detail_cache: BTreeMap<String, Text<'static>>,
    pending_stats_signature: Option<String>,
    pending_preview_key: Option<String>,
    pending_diff_key: Option<String>,
    pending_facts_key: Option<String>,
    pending_fitness: bool,
    pending_scc: bool,
    queued_fitness_refresh: Option<(String, String, bool, fitness::FitnessRunMode)>,
    fitness_mode: fitness::FitnessRunMode,
    fitness_history_by_mode: BTreeMap<String, FitnessHistoryEntry>,
    fitness_is_running: bool,
    fitness_cache_key: Option<String>,
    fitness_repo_root: String,
    scc_summary: Option<SccSummary>,
    review_triggers: ReviewTriggerCache,
    worker_tx: Sender<BackgroundCommand>,
    worker_rx: Receiver<BackgroundResult>,
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

impl AppCache {
    pub(super) fn new(repo_root: &str) -> Self {
        let (worker_tx, worker_rx_cmd) = mpsc::channel();
        let (result_tx, worker_rx) = mpsc::channel();
        thread::spawn(move || background_worker(worker_rx_cmd, result_tx));
        let mut cache = Self {
            diff_stats: BTreeMap::new(),
            preview_cache: BTreeMap::new(),
            diff_cache: BTreeMap::new(),
            facts_cache: BTreeMap::new(),
            highlighted_detail_cache: BTreeMap::new(),
            pending_stats_signature: None,
            pending_preview_key: None,
            pending_diff_key: None,
            pending_facts_key: None,
            pending_fitness: false,
            pending_scc: false,
            queued_fitness_refresh: None,
            fitness_mode: fitness::FitnessRunMode::Fast,
            fitness_history_by_mode: BTreeMap::new(),
            fitness_is_running: false,
            fitness_cache_key: None,
            fitness_repo_root: repo_root.to_string(),
            scc_summary: None,
            review_triggers: ReviewTriggerCache::load(repo_root),
            worker_tx,
            worker_rx,
        };
        cache.load_fitness_history();
        cache
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

    pub(super) fn sync_results(&mut self) {
        while let Ok(result) = self.worker_rx.try_recv() {
            match result {
                BackgroundResult::Stats { entries } => {
                    self.diff_stats.extend(entries);
                    self.pending_stats_signature = None;
                }
                BackgroundResult::Detail { entry, mode } => match mode {
                    DetailMode::File => {
                        self.highlighted_detail_cache
                            .retain(|key, _| !key.starts_with(&entry.key));
                        self.preview_cache.insert(entry.key.clone(), entry);
                        self.pending_preview_key = None;
                    }
                    DetailMode::Diff => {
                        self.highlighted_detail_cache
                            .retain(|key, _| !key.starts_with(&entry.key));
                        self.diff_cache.insert(entry.key.clone(), entry);
                        self.pending_diff_key = None;
                    }
                },
                BackgroundResult::Facts { entry } => {
                    self.facts_cache.insert(entry.key.clone(), entry);
                    self.pending_facts_key = None;
                }
                BackgroundResult::Fitness { result } => {
                    let result = *result;
                    self.fitness_is_running = false;
                    let entry = self.active_fitness_history_mut();
                    entry.last_run_ms = Some(chrono::Utc::now().timestamp_millis());
                    match result {
                        Ok(snapshot) => {
                            entry.last_error = None;
                            entry.snapshot = Some(snapshot);
                            if let Some(snapshot) = entry.snapshot.as_ref() {
                                entry.trend.push(snapshot.final_score);
                            }
                            if entry.trend.len() > FITNESS_TREND_CAPACITY {
                                let overflow = entry.trend.len() - FITNESS_TREND_CAPACITY;
                                entry.trend.drain(0..overflow);
                            }
                        }
                        Err(message) => {
                            entry.last_error = Some(message);
                        }
                    }
                    self.persist_fitness_history();
                    self.pending_fitness = false;
                    if let Some((repo_root, cache_key, force, mode)) =
                        self.queued_fitness_refresh.take()
                    {
                        self.request_fitness_refresh(repo_root, cache_key, force, mode);
                    }
                }
                BackgroundResult::Scc { result } => {
                    self.pending_scc = false;
                    if let Ok(summary) = result {
                        self.scc_summary = Some(summary);
                    }
                }
            }
        }
    }

    pub(super) fn warm_visible_files(&mut self, state: &RuntimeState) {
        let files: Vec<(String, String, i64, crate::models::EntryKind)> = state
            .file_items()
            .iter()
            .take(24)
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
        let _ = self.worker_tx.send(BackgroundCommand::RefreshStats {
            repo_root: state.repo_root.clone(),
            files,
        });
        self.pending_stats_signature = Some(signature);
    }

    pub(super) fn warm_selected_detail(&mut self, state: &RuntimeState) {
        let Some(file) = state.selected_file() else {
            self.pending_preview_key = None;
            self.pending_diff_key = None;
            self.pending_facts_key = None;
            return;
        };
        let active_key = detail_cache_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
            state.detail_mode,
        );
        let active_loaded = match state.detail_mode {
            DetailMode::File => self.preview_cache.contains_key(&active_key),
            DetailMode::Diff => self.diff_cache.contains_key(&active_key),
        };
        let active_pending = match state.detail_mode {
            DetailMode::File => self.pending_preview_key.as_deref() == Some(active_key.as_str()),
            DetailMode::Diff => self.pending_diff_key.as_deref() == Some(active_key.as_str()),
        };
        if !active_loaded && !active_pending {
            let _ = self.worker_tx.send(BackgroundCommand::LoadDetail {
                repo_root: state.repo_root.clone(),
                rel_path: file.rel_path.clone(),
                state_code: file.state_code.clone(),
                version: file.last_modified_at_ms,
                mode: state.detail_mode,
            });
            match state.detail_mode {
                DetailMode::File => self.pending_preview_key = Some(active_key),
                DetailMode::Diff => self.pending_diff_key = Some(active_key),
            }
        }

        let facts_key = facts_cache_key(&file.rel_path, file.last_modified_at_ms, file.entry_kind);
        if !self.facts_cache.contains_key(&facts_key)
            && self.pending_facts_key.as_deref() != Some(facts_key.as_str())
        {
            let _ = self.worker_tx.send(BackgroundCommand::LoadFacts {
                repo_root: state.repo_root.clone(),
                rel_path: file.rel_path.clone(),
                version: file.last_modified_at_ms,
                entry_kind: file.entry_kind,
            });
            self.pending_facts_key = Some(facts_key);
        }
    }

    pub(super) fn diff_stat<'a>(
        &'a self,
        file: &crate::models::FileView,
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
        file: &crate::models::FileView,
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

    pub(super) fn file_facts(&self, file: &crate::models::FileView) -> Option<&FileFactsEntry> {
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
        if !force
            && !self.fitness_is_running
            && self.fitness_snapshot().is_some()
            && self.fitness_cache_key.as_deref() == Some(cache_key.as_str())
        {
            return;
        }
        if self.fitness_is_running || self.pending_fitness {
            self.queued_fitness_refresh = Some((repo_root, cache_key, force, mode));
            return;
        }
        self.fitness_cache_key = Some(cache_key.clone());
        self.active_fitness_history_mut().cache_key = Some(cache_key.clone());
        let _ = self.worker_tx.send(BackgroundCommand::RefreshFitness {
            repo_root,
            cache_key,
            mode,
        });
        self.fitness_is_running = true;
        self.active_fitness_history_mut().last_error = None;
        self.pending_fitness = true;
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
            let _ = self
                .worker_tx
                .send(BackgroundCommand::RefreshScc { repo_root });
            self.pending_scc = true;
            return;
        }
        let _ = self
            .worker_tx
            .send(BackgroundCommand::RefreshScc { repo_root });
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

    fn active_fitness_history(&self) -> Option<&FitnessHistoryEntry> {
        self.fitness_history_by_mode.get(self.fitness_mode.as_str())
    }

    fn active_fitness_history_mut(&mut self) -> &mut FitnessHistoryEntry {
        self.fitness_history_by_mode
            .entry(self.fitness_mode.as_str().to_string())
            .or_default()
    }

    fn sync_cache_key_from_active_mode(&mut self) {
        self.fitness_cache_key = self
            .active_fitness_history()
            .and_then(|entry| entry.cache_key.clone());
    }

    pub(super) fn highlighted_detail_text(
        &mut self,
        file: &crate::models::FileView,
        mode: DetailMode,
        theme_mode: ThemeMode,
    ) -> Option<&Text<'static>> {
        let render_key = format!(
            "{}:{}:{:?}:{:?}",
            file.rel_path, file.last_modified_at_ms, mode, theme_mode
        );
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

    pub(super) fn review_hint(&self, file: &crate::models::FileView) -> Option<ReviewHint> {
        self.review_triggers.review_hint(file)
    }

    pub(super) fn repo_review_hints(&self, files: &[&crate::models::FileView]) -> Vec<RepoReviewHint> {
        self.review_triggers
            .repo_review_hints(files, |file| self.diff_stat(file))
    }

    pub(super) fn repo_review_context_for_file(
        &self,
        file: &crate::models::FileView,
        files: &[&crate::models::FileView],
    ) -> Vec<RepoReviewHint> {
        self.review_triggers
            .repo_review_context_for_file(file, files, |entry| self.diff_stat(entry))
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
    entry_kind: crate::models::EntryKind,
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

pub(super) fn facts_cache_key(
    rel_path: &str,
    version: i64,
    entry_kind: crate::models::EntryKind,
) -> String {
    format!(
        "{rel_path}:{version}:{}:facts",
        entry_kind_cache_token(entry_kind)
    )
}

fn entry_kind_cache_token(entry_kind: crate::models::EntryKind) -> &'static str {
    match entry_kind {
        crate::models::EntryKind::File => "file",
        crate::models::EntryKind::Directory => "dir",
        crate::models::EntryKind::Submodule => "sub",
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

pub(super) fn display_status_code(file: &crate::models::FileView) -> String {
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
    files: &[(String, String, i64, crate::models::EntryKind)],
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

fn background_worker(rx: Receiver<BackgroundCommand>, tx: Sender<BackgroundResult>) {
    while let Ok(command) = rx.recv() {
        let mut pending = PendingCommands::default();
        queue_command(&mut pending, command);
        while let Ok(next) = rx.try_recv() {
            queue_command(&mut pending, next);
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
            let _ = tx.send(BackgroundResult::Stats { entries });
        }
        if let Some((repo_root, rel_path, state_code, version, mode)) = pending.detail.take() {
            let text = match mode {
                DetailMode::File => load_file_preview(&repo_root, rel_path.as_str())
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "<no file content available>".to_string()),
                DetailMode::Diff => {
                    load_diff_text(&repo_root, rel_path.as_str(), state_code.as_str())
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| "<no diff available>".to_string())
                }
            };
            let _ = tx.send(BackgroundResult::Detail {
                entry: DetailCacheEntry {
                    key: detail_cache_key(&rel_path, &state_code, version, mode),
                    text,
                },
                mode,
            });
        }
        if let Some((repo_root, rel_path, version, entry_kind)) = pending.facts.take() {
            let _ = tx.send(BackgroundResult::Facts {
                entry: load_file_facts(&repo_root, &rel_path, version, entry_kind),
            });
        }
        if let Some((repo_root, cache_key, mode)) = pending.fitness.take() {
            let result = fitness::run_fitness(&repo_root, mode).map_err(|error| error.to_string());
            let _ = cache_key;
            let _ = tx.send(BackgroundResult::Fitness {
                result: Box::new(result),
            });
        }
        if let Some(repo_root) = pending.scc.take() {
            let _ = tx.send(BackgroundResult::Scc {
                result: run_scc_summary(&repo_root),
            });
        }
    }
}

fn queue_command(pending: &mut PendingCommands, command: BackgroundCommand) {
    match command {
        BackgroundCommand::RefreshStats { repo_root, files } => {
            pending.stats = Some((repo_root, files));
        }
        BackgroundCommand::LoadDetail {
            repo_root,
            rel_path,
            state_code,
            version,
            mode,
        } => {
            pending.detail = Some((repo_root, rel_path, state_code, version, mode));
        }
        BackgroundCommand::LoadFacts {
            repo_root,
            rel_path,
            version,
            entry_kind,
        } => {
            pending.facts = Some((repo_root, rel_path, version, entry_kind));
        }
        BackgroundCommand::RefreshFitness {
            repo_root,
            cache_key,
            mode,
        } => {
            pending.fitness = Some((repo_root, cache_key, mode));
        }
        BackgroundCommand::RefreshScc { repo_root } => {
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
    entry_kind: crate::models::EntryKind,
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
        git_change_count: git_file_change_count(repo_root, rel_path).unwrap_or(0),
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
            .arg("init")
            .arg(dir.path())
            .output()
            .expect("init repo");
        assert!(init.status.success(), "git init failed: {:?}", init);

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
            "git update-index failed: {:?}",
            update_index
        );

        assert_eq!(
            git_submodule_paths(&dir.path().to_string_lossy()),
            vec!["tools/entrix"]
        );
    }
}

#[cfg(test)]
#[path = "tui_cache_tests.rs"]
mod tests;

#[path = "tui_cache_history.rs"]
mod history;
use history::{fitness_history_path, read_fitness_history_record};

pub(super) fn load_diff_text(
    repo_root: &str,
    rel_path: &str,
    state_code: &str,
) -> Result<Option<String>> {
    if let Some((submodule_path, nested_rel_path)) = submodule_context(repo_root, rel_path) {
        if nested_rel_path.is_empty() {
            return load_submodule_diff_text(repo_root, &submodule_path);
        }
        return load_submodule_nested_diff_text(repo_root, &submodule_path, &nested_rel_path, state_code);
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
            "<directory: {} entries>\n{}",
            child_count, rel_path
        )));
    }
    if state_code == "untracked" {
        if !path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(&path).context("read untracked file")?;
        let mut out = Vec::new();
        out.push(format!("+++ {}", rel_path));
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
        let content = std::fs::read_to_string(&nested_path).context("read untracked submodule file")?;
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

fn load_file_preview(repo_root: &str, rel_path: &str) -> Result<Option<String>> {
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
            entries.into_iter().take(200).collect::<Vec<_>>().join("\n")
        };
        return Ok(Some(preview));
    }
    let content = std::fs::read_to_string(path).context("read file preview")?;
    let truncated = content.lines().take(400).collect::<Vec<_>>().join("\n");
    Ok(Some(truncated))
}
