//! Cross-language test mapping primitives.
//!
//! This module provides a reusable, extensible resolver model that can answer:
//! when a source file changes, does the repository have a related test file,
//! was that test also changed, or is the result unknown?

use crate::model::Confidence;
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
            mappings.push(self.analyze_file_with_graph(
                repo_root,
                rel_path,
                &normalized_changed,
                graph_test_files_by_source
                    .get(rel_path)
                    .map(Vec::as_slice)
                    .unwrap_or(&[]),
            ));
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
        let has_inline_tests =
            outcome.has_inline_tests || merged_graph_test_files.iter().any(|path| path == &normalized);
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
        } else if related_test_files.iter().any(|path| changed_files.contains(path))
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn typescript_resolver_marks_changed_when_matching_test_is_also_dirty() {
        let temp = tempdir().expect("tempdir");
        let repo_root = temp.path();
        fs::create_dir_all(repo_root.join("src/core/skills/__tests__")).expect("create test dir");
        fs::write(
            repo_root.join("src/core/skills/skill-loader.ts"),
            "export function load() {}\n",
        )
        .expect("write source");
        fs::write(
            repo_root.join("src/core/skills/__tests__/skill-loader.test.ts"),
            "test('load', () => {})\n",
        )
        .expect("write test");

        let report = analyze_changed_files(
            repo_root,
            &[
                "src/core/skills/skill-loader.ts".to_string(),
                "src/core/skills/__tests__/skill-loader.test.ts".to_string(),
            ],
        );

        assert_eq!(
            report.skipped_test_files,
            vec!["src/core/skills/__tests__/skill-loader.test.ts"]
        );
        assert_eq!(report.mappings.len(), 1);
        let mapping = &report.mappings[0];
        assert_eq!(mapping.language, "typescript");
        assert_eq!(mapping.status, TestMappingStatus::Changed);
        assert_eq!(
            mapping.related_test_files,
            vec!["src/core/skills/__tests__/skill-loader.test.ts"]
        );
        assert_eq!(report.status_counts.get("changed"), Some(&1));
        assert_eq!(report.resolver_counts.get("path_heuristic"), Some(&1));
    }

    #[test]
    fn rust_resolver_marks_inline_tests() {
        let temp = tempdir().expect("tempdir");
        let repo_root = temp.path();
        fs::create_dir_all(repo_root.join("crates/demo/src")).expect("create src dir");
        fs::write(
            repo_root.join("crates/demo/Cargo.toml"),
            "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n",
        )
        .expect("write cargo");
        fs::write(
            repo_root.join("crates/demo/src/pty.rs"),
            "pub fn run() {}\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn works() {}\n}\n",
        )
        .expect("write source");

        let report = analyze_changed_files(repo_root, &["crates/demo/src/pty.rs".to_string()]);

        let mapping = &report.mappings[0];
        assert_eq!(mapping.language, "rust");
        assert_eq!(mapping.status, TestMappingStatus::Inline);
        assert!(mapping.has_inline_tests);
        assert_eq!(report.status_counts.get("inline"), Some(&1));
        assert_eq!(report.resolver_counts.get("inline_test"), Some(&1));
    }

    #[test]
    fn rust_resolver_finds_sibling_tests_for_mod_rs() {
        let temp = tempdir().expect("tempdir");
        let repo_root = temp.path();
        fs::create_dir_all(repo_root.join("crates/demo/src/commands/fitness/fluency"))
            .expect("create src dir");
        fs::write(
            repo_root.join("crates/demo/Cargo.toml"),
            "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n",
        )
        .expect("write cargo");
        fs::write(
            repo_root.join("crates/demo/src/commands/fitness/fluency/mod.rs"),
            "pub fn report() {}\n",
        )
        .expect("write mod");
        fs::write(
            repo_root.join("crates/demo/src/commands/fitness/fluency/tests_projection.rs"),
            "#[test]\nfn projection() {}\n",
        )
        .expect("write sibling tests");

        let report = analyze_changed_files(
            repo_root,
            &["crates/demo/src/commands/fitness/fluency/mod.rs".to_string()],
        );

        let mapping = &report.mappings[0];
        assert_eq!(mapping.status, TestMappingStatus::Exists);
        assert_eq!(
            mapping.related_test_files,
            vec!["crates/demo/src/commands/fitness/fluency/tests_projection.rs"]
        );
    }

    #[test]
    fn java_resolver_marks_missing_for_standard_src_main_layout_without_tests() {
        let temp = tempdir().expect("tempdir");
        let repo_root = temp.path();
        fs::create_dir_all(repo_root.join("src/main/java/com/example")).expect("create java dir");
        fs::write(
            repo_root.join("src/main/java/com/example/OrderService.java"),
            "class OrderService {}\n",
        )
        .expect("write java source");

        let report = analyze_changed_files(
            repo_root,
            &["src/main/java/com/example/OrderService.java".to_string()],
        );

        let mapping = &report.mappings[0];
        assert_eq!(mapping.language, "java");
        assert_eq!(mapping.status, TestMappingStatus::Missing);
        assert!(mapping.related_test_files.is_empty());
        assert_eq!(report.status_counts.get("missing"), Some(&1));
        assert_eq!(report.resolver_counts.get("path_heuristic"), Some(&1));
    }

    #[test]
    fn graph_enrichment_upgrades_mapping_and_merges_related_tests() {
        let temp = tempdir().expect("tempdir");
        let repo_root = temp.path();
        let source_dir = repo_root.join("src");
        let tests_dir = source_dir.join("__tests__");
        fs::create_dir_all(&tests_dir).expect("create test dir");
        fs::write(source_dir.join("service.ts"), "export function run() {}\n").expect("write source");
        fs::write(tests_dir.join("service.extra.test.ts"), "it('works', () => {})\n")
            .expect("write graph test");

        let registry = ResolverRegistry::default();
        let report = registry.analyze_changed_files_with_graph(
            repo_root,
            &["src/service.ts".to_string()],
            &BTreeMap::from([(
                "src/service.ts".to_string(),
                vec!["src/__tests__/service.extra.test.ts".to_string()],
            )]),
        );

        assert_eq!(report.mappings.len(), 1);
        let mapping = &report.mappings[0];
        assert_eq!(mapping.status, TestMappingStatus::Exists);
        assert_eq!(mapping.resolver_kind, ResolverKind::SemanticGraph);
        assert_eq!(mapping.confidence, Confidence::High);
        assert_eq!(
            mapping.graph_test_files,
            vec!["src/__tests__/service.extra.test.ts".to_string()]
        );
        assert_eq!(
            mapping.related_test_files,
            vec!["src/__tests__/service.extra.test.ts".to_string()]
        );
        assert_eq!(report.status_counts.get("exists"), Some(&1));
        assert_eq!(report.resolver_counts.get("semantic_graph"), Some(&1));
    }
}
