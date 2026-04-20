//! Cross-language test mapping primitives.
//!
//! This module provides a reusable, extensible resolver model that can answer:
//! when a source file changes, does the repository have a related test file,
//! was that test also changed, or is the result unknown?

use crate::model::Confidence;
use crate::review_context::{
    build_graph, query_current_graph, GraphBuildReport, GraphNodePayload, ReviewBuildMode,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceLanguage {
    Java,
    JavaScript,
    Jsx,
    Rust,
    TypeScript,
    Tsx,
    Unknown,
}

impl SourceLanguage {
    pub fn from_path(rel_path: &str) -> Self {
        match Path::new(rel_path)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "java" => Self::Java,
            "js" => Self::JavaScript,
            "jsx" => Self::Jsx,
            "rs" => Self::Rust,
            "ts" => Self::TypeScript,
            "tsx" => Self::Tsx,
            _ => Self::Unknown,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Java => "java",
            Self::JavaScript => "javascript",
            Self::Jsx => "jsx",
            Self::Rust => "rust",
            Self::TypeScript => "typescript",
            Self::Tsx => "tsx",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolverKind {
    PathHeuristic,
    InlineTest,
    HybridHeuristic,
    SemanticGraph,
    Unsupported,
}

impl ResolverKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PathHeuristic => "path_heuristic",
            Self::InlineTest => "inline_test",
            Self::HybridHeuristic => "hybrid_heuristic",
            Self::SemanticGraph => "semantic_graph",
            Self::Unsupported => "unsupported",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TestMappingStatus {
    Changed,
    Exists,
    Inline,
    Missing,
    Unknown,
}

impl TestMappingStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Changed => "changed",
            Self::Exists => "exists",
            Self::Inline => "inline",
            Self::Missing => "missing",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TestMappingRecord {
    pub source_file: String,
    pub language: String,
    pub status: TestMappingStatus,
    pub related_test_files: Vec<String>,
    pub graph_test_files: Vec<String>,
    pub resolver_kind: ResolverKind,
    pub confidence: Confidence,
    pub has_inline_tests: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TestMappingReport {
    pub changed_files: Vec<String>,
    pub skipped_test_files: Vec<String>,
    pub mappings: Vec<TestMappingRecord>,
    pub status_counts: BTreeMap<String, usize>,
    pub resolver_counts: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestMappingAnalysisOptions<'a> {
    pub base: &'a str,
    pub build_mode: ReviewBuildMode,
    pub use_graph: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestMappingGraphReport {
    pub available: bool,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build: Option<GraphBuildReport>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestMappingAnalysisReport {
    pub status: String,
    pub summary: String,
    pub base: String,
    pub changed_files: Vec<String>,
    pub skipped_test_files: Vec<String>,
    pub mappings: Vec<TestMappingRecord>,
    pub status_counts: BTreeMap<String, usize>,
    pub resolver_counts: BTreeMap<String, usize>,
    pub graph: TestMappingGraphReport,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolverOutcome {
    pub related_test_files: Vec<String>,
    pub has_inline_tests: bool,
    pub can_assert_missing: bool,
    pub resolver_kind: ResolverKind,
    pub confidence: Confidence,
}

impl Default for ResolverOutcome {
    fn default() -> Self {
        Self {
            related_test_files: Vec::new(),
            has_inline_tests: false,
            can_assert_missing: false,
            resolver_kind: ResolverKind::Unsupported,
            confidence: Confidence::Unknown,
        }
    }
}

pub trait AutoTestResolver {
    fn supports(&self, language: SourceLanguage) -> bool;
    fn is_test_file(&self, rel_path: &str) -> bool;
    fn resolve(
        &self,
        repo_root: &Path,
        rel_path: &str,
        language: SourceLanguage,
    ) -> ResolverOutcome;
}

pub struct ResolverRegistry {
    resolvers: Vec<Box<dyn AutoTestResolver>>,
}

impl Default for ResolverRegistry {
    fn default() -> Self {
        Self {
            resolvers: vec![
                Box::new(TypeScriptResolver),
                Box::new(RustResolver),
                Box::new(JavaResolver),
            ],
        }
    }
}

impl ResolverRegistry {
    pub fn analyze_changed_files(
        &self,
        repo_root: &Path,
        changed_files: &[String],
    ) -> TestMappingReport {
        self.analyze_changed_files_with_graph(repo_root, changed_files, &BTreeMap::new())
    }

    pub fn analyze_changed_files_with_graph(
        &self,
        repo_root: &Path,
        changed_files: &[String],
        graph_test_files_by_source: &BTreeMap<String, Vec<String>>,
    ) -> TestMappingReport {
        let mut normalized_changed = BTreeSet::new();
        for file in changed_files {
            let normalized = normalize_rel_path(file);
            if !normalized.is_empty() {
                normalized_changed.insert(normalized);
            }
        }
        let changed: Vec<String> = normalized_changed.iter().cloned().collect();

        let mut skipped_test_files = Vec::new();
        let mut mappings = Vec::new();
        for rel_path in &changed {
            if self.is_test_file(rel_path) {
                skipped_test_files.push(rel_path.clone());
                continue;
            }
            mappings.push(
                self.analyze_file_with_graph(
                    repo_root,
                    rel_path,
                    &normalized_changed,
                    graph_test_files_by_source
                        .get(rel_path)
                        .map(Vec::as_slice)
                        .unwrap_or(&[]),
                ),
            );
        }

        let mut status_counts = BTreeMap::new();
        let mut resolver_counts = BTreeMap::new();
        for mapping in &mappings {
            *status_counts
                .entry(mapping.status.as_str().to_string())
                .or_insert(0) += 1;
            *resolver_counts
                .entry(mapping.resolver_kind.as_str().to_string())
                .or_insert(0) += 1;
        }

        TestMappingReport {
            changed_files: changed,
            skipped_test_files,
            mappings,
            status_counts,
            resolver_counts,
        }
    }

    pub fn analyze_file(
        &self,
        repo_root: &Path,
        rel_path: &str,
        changed_files: &BTreeSet<String>,
    ) -> TestMappingRecord {
        self.analyze_file_with_graph(repo_root, rel_path, changed_files, &[])
    }

    pub fn analyze_file_with_graph(
        &self,
        repo_root: &Path,
        rel_path: &str,
        changed_files: &BTreeSet<String>,
        graph_test_files: &[String],
    ) -> TestMappingRecord {
        let normalized = normalize_rel_path(rel_path);
        let language = SourceLanguage::from_path(&normalized);
        let outcome = self
            .resolvers
            .iter()
            .find(|resolver| resolver.supports(language))
            .map(|resolver| resolver.resolve(repo_root, &normalized, language))
            .unwrap_or_default();
        let mut merged_graph_test_files = graph_test_files
            .iter()
            .map(|path| normalize_rel_path(path))
            .filter(|path| !path.is_empty())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let mut related = outcome
            .related_test_files
            .iter()
            .map(|path| normalize_rel_path(path))
            .collect::<BTreeSet<_>>();
        related.extend(merged_graph_test_files.iter().cloned());
        let related_test_files = related.into_iter().collect::<Vec<_>>();
        let has_inline_tests = outcome.has_inline_tests
            || merged_graph_test_files
                .iter()
                .any(|path| path == &normalized);
        let resolver_kind = if merged_graph_test_files.is_empty() {
            outcome.resolver_kind
        } else {
            ResolverKind::SemanticGraph
        };
        let confidence = if merged_graph_test_files.is_empty() {
            outcome.confidence
        } else {
            Confidence::High
        };

        let status = if has_inline_tests {
            TestMappingStatus::Inline
        } else if related_test_files
            .iter()
            .any(|path| changed_files.contains(path))
        {
            TestMappingStatus::Changed
        } else if !related_test_files.is_empty() {
            TestMappingStatus::Exists
        } else if outcome.can_assert_missing {
            TestMappingStatus::Missing
        } else {
            TestMappingStatus::Unknown
        };

        TestMappingRecord {
            source_file: normalized,
            language: language.as_str().to_string(),
            status,
            related_test_files,
            graph_test_files: std::mem::take(&mut merged_graph_test_files),
            resolver_kind,
            confidence,
            has_inline_tests,
        }
    }

    pub fn is_test_file(&self, rel_path: &str) -> bool {
        let normalized = normalize_rel_path(rel_path);
        let language = SourceLanguage::from_path(&normalized);
        self.resolvers
            .iter()
            .filter(|resolver| resolver.supports(language))
            .any(|resolver| resolver.is_test_file(&normalized))
            || generic_test_file(&normalized)
    }
}

pub fn analyze_changed_files(repo_root: &Path, changed_files: &[String]) -> TestMappingReport {
    ResolverRegistry::default().analyze_changed_files(repo_root, changed_files)
}

pub fn analyze_test_mappings(
    repo_root: &Path,
    changed_files: &[String],
    options: TestMappingAnalysisOptions<'_>,
) -> TestMappingAnalysisReport {
    let registry = ResolverRegistry::default();
    let graph = if options.use_graph {
        let build = build_graph(repo_root, options.build_mode);
        if build.status == "unavailable" {
            TestMappingGraphReport {
                available: false,
                status: "unavailable".to_string(),
                reason: Some("graph backend unavailable".to_string()),
                build: None,
            }
        } else {
            TestMappingGraphReport {
                available: true,
                status: build.status.clone(),
                reason: None,
                build: Some(build),
            }
        }
    } else {
        TestMappingGraphReport {
            available: false,
            status: "disabled".to_string(),
            reason: Some("graph disabled".to_string()),
            build: None,
        }
    };

    let graph_test_files_by_source =
        graph_test_files_by_source(repo_root, changed_files, &registry, &graph);
    let report = registry.analyze_changed_files_with_graph(
        repo_root,
        changed_files,
        &graph_test_files_by_source,
    );

    TestMappingAnalysisReport {
        status: "ok".to_string(),
        summary: format!(
            "Analyzed test mappings for {} changed source file(s); skipped {} changed test file(s).",
            report.mappings.len(),
            report.skipped_test_files.len()
        ),
        base: options.base.to_string(),
        changed_files: report.changed_files,
        skipped_test_files: report.skipped_test_files,
        mappings: report.mappings,
        status_counts: report.status_counts,
        resolver_counts: report.resolver_counts,
        graph,
    }
}

struct TypeScriptResolver;

impl AutoTestResolver for TypeScriptResolver {
    fn supports(&self, language: SourceLanguage) -> bool {
        matches!(
            language,
            SourceLanguage::TypeScript
                | SourceLanguage::Tsx
                | SourceLanguage::JavaScript
                | SourceLanguage::Jsx
        )
    }

    fn is_test_file(&self, rel_path: &str) -> bool {
        generic_test_file(rel_path)
    }

    fn resolve(
        &self,
        repo_root: &Path,
        rel_path: &str,
        language: SourceLanguage,
    ) -> ResolverOutcome {
        let path = Path::new(rel_path);
        let parent = path.parent().unwrap_or_else(|| Path::new(""));
        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default();
        let ext_family: &[&str] = match language {
            SourceLanguage::TypeScript | SourceLanguage::Tsx => &["ts", "tsx"],
            SourceLanguage::JavaScript | SourceLanguage::Jsx => &["js", "jsx"],
            _ => &["ts", "tsx", "js", "jsx"],
        };

        let mut candidates = BTreeSet::new();
        for ext in ext_family {
            candidates.insert(parent.join(format!("{stem}.test.{ext}")));
            candidates.insert(parent.join(format!("{stem}.spec.{ext}")));
            candidates.insert(parent.join("__tests__").join(format!("{stem}.test.{ext}")));
            candidates.insert(parent.join("__tests__").join(format!("{stem}.spec.{ext}")));
            candidates.insert(parent.join("tests").join(format!("{stem}.test.{ext}")));
            candidates.insert(parent.join("tests").join(format!("{stem}.spec.{ext}")));
        }

        ResolverOutcome {
            related_test_files: existing_paths(repo_root, candidates),
            has_inline_tests: false,
            can_assert_missing: true,
            resolver_kind: ResolverKind::PathHeuristic,
            confidence: Confidence::High,
        }
    }
}

struct JavaResolver;

impl AutoTestResolver for JavaResolver {
    fn supports(&self, language: SourceLanguage) -> bool {
        language == SourceLanguage::Java
    }

    fn is_test_file(&self, rel_path: &str) -> bool {
        let lowered = rel_path.to_ascii_lowercase();
        lowered.contains("/src/test/java/")
            || lowered.ends_with("test.java")
            || lowered.ends_with("tests.java")
            || lowered.ends_with("it.java")
    }

    fn resolve(
        &self,
        repo_root: &Path,
        rel_path: &str,
        _language: SourceLanguage,
    ) -> ResolverOutcome {
        let normalized = normalize_rel_path(rel_path);
        let mut candidates = BTreeSet::new();
        let mut can_assert_missing = false;
        if let Some(test_path) = normalized.strip_prefix("src/main/java/") {
            can_assert_missing = true;
            let test_base = Path::new("src/test/java").join(test_path);
            let parent = test_base
                .parent()
                .unwrap_or_else(|| Path::new("src/test/java"));
            let stem = test_base
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or_default();
            candidates.insert(parent.join(format!("{stem}Test.java")));
            candidates.insert(parent.join(format!("{stem}Tests.java")));
            candidates.insert(parent.join(format!("{stem}IT.java")));
        }

        ResolverOutcome {
            related_test_files: existing_paths(repo_root, candidates),
            has_inline_tests: false,
            can_assert_missing,
            resolver_kind: ResolverKind::PathHeuristic,
            confidence: if can_assert_missing {
                Confidence::High
            } else {
                Confidence::Low
            },
        }
    }
}

struct RustResolver;

impl AutoTestResolver for RustResolver {
    fn supports(&self, language: SourceLanguage) -> bool {
        language == SourceLanguage::Rust
    }

    fn is_test_file(&self, rel_path: &str) -> bool {
        let lowered = rel_path.to_ascii_lowercase();
        generic_test_file(rel_path)
            || lowered.ends_with("_test.rs")
            || lowered.ends_with(".test.rs")
            || lowered.ends_with("/tests.rs")
            || lowered.contains("/tests/")
            || Path::new(rel_path)
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("tests_") && name.ends_with(".rs"))
    }

    fn resolve(
        &self,
        repo_root: &Path,
        rel_path: &str,
        _language: SourceLanguage,
    ) -> ResolverOutcome {
        let path = repo_root.join(rel_path);
        let has_inline_tests = file_contains_any(&path, &["#[cfg(test)]", "#[test]"]);
        let mut candidates = BTreeSet::new();

        let normalized = normalize_rel_path(rel_path);
        let rel = Path::new(&normalized);
        let parent = rel.parent().unwrap_or_else(|| Path::new(""));
        let stem = rel
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default();
        if stem == "mod" {
            if let Ok(entries) = fs::read_dir(repo_root.join(parent)) {
                for entry in entries.flatten() {
                    let child = entry.path();
                    if !child.is_file() {
                        continue;
                    }
                    let Some(name) = child.file_name().and_then(|name| name.to_str()) else {
                        continue;
                    };
                    if name == "tests.rs" || (name.starts_with("tests_") && name.ends_with(".rs")) {
                        if let Some(rel_child) = to_repo_relative(repo_root, &child) {
                            candidates.insert(PathBuf::from(rel_child));
                        }
                    }
                }
            }
        } else {
            candidates.insert(parent.join(format!("{stem}_test.rs")));
            candidates.insert(parent.join(format!("{stem}_tests.rs")));
            candidates.insert(parent.join(format!("{stem}.test.rs")));
        }

        if let Some(crate_root) = find_crate_root(&path, repo_root) {
            let tests_dir = crate_root.join("tests");
            let source_tokens = normalized_tokens(stem);
            if !source_tokens.is_empty() && tests_dir.is_dir() {
                for test_file in walk_rs_files(&tests_dir) {
                    let Some(file_name) = test_file.file_name().and_then(|name| name.to_str())
                    else {
                        continue;
                    };
                    let test_tokens = normalized_tokens(
                        Path::new(file_name)
                            .file_stem()
                            .and_then(|stem| stem.to_str())
                            .unwrap_or_default(),
                    );
                    if test_tokens.is_empty() || source_tokens.is_disjoint(&test_tokens) {
                        continue;
                    }
                    if let Some(rel_child) = to_repo_relative(repo_root, &test_file) {
                        candidates.insert(PathBuf::from(rel_child));
                    }
                }
            }
        }

        let related_test_files = existing_paths(repo_root, candidates);
        ResolverOutcome {
            has_inline_tests,
            can_assert_missing: false,
            resolver_kind: if has_inline_tests {
                ResolverKind::InlineTest
            } else {
                ResolverKind::HybridHeuristic
            },
            confidence: if has_inline_tests {
                Confidence::High
            } else if related_test_files.is_empty() {
                Confidence::Low
            } else {
                Confidence::Medium
            },
            related_test_files,
        }
    }
}

fn normalize_rel_path(path: &str) -> String {
    path.trim().trim_matches('"').replace('\\', "/")
}

fn generic_test_file(rel_path: &str) -> bool {
    let lowered = rel_path.to_ascii_lowercase();
    lowered.contains("/tests/")
        || lowered.contains("/__tests__/")
        || lowered.contains("/e2e/")
        || lowered.contains(".test.")
        || lowered.contains(".spec.")
}

fn existing_paths(repo_root: &Path, candidates: BTreeSet<PathBuf>) -> Vec<String> {
    candidates
        .into_iter()
        .filter_map(|candidate| {
            let normalized = candidate.to_string_lossy().replace('\\', "/");
            repo_root.join(&normalized).exists().then_some(normalized)
        })
        .collect()
}

fn file_contains_any(path: &Path, needles: &[&str]) -> bool {
    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };
    needles.iter().any(|needle| content.contains(needle))
}

fn find_crate_root(path: &Path, repo_root: &Path) -> Option<PathBuf> {
    let mut current = path.parent();
    while let Some(dir) = current {
        if dir.join("Cargo.toml").exists() {
            return Some(dir.to_path_buf());
        }
        if dir == repo_root {
            break;
        }
        current = dir.parent();
    }
    None
}

fn walk_rs_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(walk_rs_files(&path));
            } else if path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("rs"))
            {
                files.push(path);
            }
        }
    }
    files
}

fn to_repo_relative(repo_root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(repo_root)
        .ok()
        .map(|value| value.to_string_lossy().replace('\\', "/"))
}

fn normalized_tokens(value: &str) -> BTreeSet<String> {
    value
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter_map(|token| {
            let lowered = token.to_ascii_lowercase();
            if lowered.is_empty()
                || matches!(
                    lowered.as_str(),
                    "test" | "tests" | "spec" | "specs" | "it" | "mod" | "main" | "lib"
                )
            {
                None
            } else {
                Some(lowered)
            }
        })
        .collect()
}

fn graph_test_files_by_source(
    repo_root: &Path,
    changed_files: &[String],
    registry: &ResolverRegistry,
    graph: &TestMappingGraphReport,
) -> BTreeMap<String, Vec<String>> {
    if !graph.available {
        return BTreeMap::new();
    }

    let mut by_source = BTreeMap::new();
    for source_file in changed_files
        .iter()
        .filter(|path| !registry.is_test_file(path))
    {
        let query = query_current_graph(repo_root, source_file, "tests_for", ReviewBuildMode::Skip);
        if query.status != "ok" {
            continue;
        }
        let graph_files = query
            .results
            .iter()
            .map(|node| match node {
                GraphNodePayload::File(node) => node.file_path.clone(),
                GraphNodePayload::Symbol(node) => node.file_path.clone(),
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        if !graph_files.is_empty() {
            by_source.insert(source_file.clone(), graph_files);
        }
    }
    by_source
}

#[cfg(test)]
mod tests;
