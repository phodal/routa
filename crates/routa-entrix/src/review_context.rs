use crate::review_context_tree_sitter::{
    node_to_payload, parse_changed_files, ParsedReviewGraph, SymbolGraphNode,
};
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct ReviewContextReport {
    pub status: String,
    pub analysis_mode: String,
    pub summary: String,
    pub base: String,
    pub context: ReviewContextPayload,
    pub build: ReviewBuildInfo,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewContextPayload {
    pub changed_files: Vec<String>,
    pub impacted_files: Vec<String>,
    pub graph: GraphContext,
    pub targets: Vec<ReviewTarget>,
    pub tests: ReviewTests,
    pub review_guidance: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_snippets: Option<Vec<SourceSnippet>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphContext {
    pub changed_nodes: Vec<crate::review_context_tree_sitter::GraphNodePayload>,
    pub impacted_nodes: Vec<crate::review_context_tree_sitter::GraphNodePayload>,
    pub edges: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewTarget {
    pub qualified_name: String,
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub tests: Vec<SymbolGraphNode>,
    pub tests_count: usize,
    pub inherited_tests: Vec<SymbolGraphNode>,
    pub inherited_tests_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewTests {
    pub test_files: Vec<String>,
    pub untested_targets: Vec<UntestedTarget>,
    pub query_failures: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UntestedTarget {
    pub qualified_name: String,
    pub kind: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceSnippet {
    pub file_path: String,
    pub line_count: usize,
    pub truncated: bool,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewBuildInfo {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_type: Option<String>,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_updated: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_files: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stale_files: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_nodes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_edges: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub languages: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy)]
pub struct ReviewContextOptions<'a> {
    pub base: &'a str,
    pub include_source: bool,
    pub max_files: usize,
    pub max_lines_per_file: usize,
    pub build_mode: ReviewBuildMode,
    pub max_targets: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewBuildMode {
    Auto,
    Full,
    Skip,
}

pub fn build_review_context(
    repo_root: &Path,
    changed_files: &[String],
    options: ReviewContextOptions<'_>,
) -> ReviewContextReport {
    if options.build_mode == ReviewBuildMode::Skip {
        return build_skip_review_context(repo_root, changed_files, options);
    }

    let graph = parse_changed_files(repo_root, changed_files);
    let changed_nodes = graph
        .changed_nodes
        .iter()
        .map(node_to_payload)
        .collect::<Vec<_>>();
    let targets = build_targets(&graph, options.max_targets);
    let untested_targets = build_untested_targets(&targets);
    let test_files = collect_test_files(&targets);
    let review_guidance =
        generate_review_guidance(&untested_targets, false, 0, 0, !targets.is_empty());
    let source_snippets = options.include_source.then(|| {
        collect_source_snippets(
            repo_root,
            changed_files,
            &test_files,
            &[],
            options.max_files,
            options.max_lines_per_file,
        )
    });

    ReviewContextReport {
        status: "ok".to_string(),
        analysis_mode: "current_graph".to_string(),
        summary: format!(
            "Review context for {} changed file(s):\n  - {} directly changed nodes\n  - 0 impacted nodes in 0 files\n\nReview guidance:\n{}",
            changed_files.len(),
            graph.changed_nodes.len(),
            review_guidance
        ),
        base: options.base.to_string(),
        context: ReviewContextPayload {
            changed_files: changed_files.to_vec(),
            impacted_files: Vec::new(),
            graph: GraphContext {
                changed_nodes,
                impacted_nodes: Vec::new(),
                edges: Vec::new(),
            },
            targets,
            tests: ReviewTests {
                test_files,
                untested_targets,
                query_failures: Vec::new(),
            },
            review_guidance,
            source_snippets,
        },
        build: ReviewBuildInfo {
            status: "ok".to_string(),
            backend: Some("builtin-tree-sitter".to_string()),
            build_type: Some("full".to_string()),
            summary: format!(
                "Full build: parsed {} file(s), {} nodes, {} edges.",
                graph.files_updated,
                graph.changed_nodes.len(),
                graph.total_edges
            ),
            files_updated: Some(graph.files_updated),
            changed_files: Some(changed_files.to_vec()),
            stale_files: Some(Vec::new()),
            total_nodes: Some(graph.changed_nodes.len()),
            total_edges: Some(graph.total_edges),
            languages: Some(graph.languages.clone()),
        },
    }
}

fn build_skip_review_context(
    repo_root: &Path,
    changed_files: &[String],
    options: ReviewContextOptions<'_>,
) -> ReviewContextReport {
    let review_guidance = "- No graph-derived review guidance available.".to_string();
    let source_snippets = options.include_source.then(|| {
        collect_source_snippets(
            repo_root,
            changed_files,
            &[],
            &[],
            options.max_files,
            options.max_lines_per_file,
        )
    });

    ReviewContextReport {
        status: "ok".to_string(),
        analysis_mode: "current_graph".to_string(),
        summary: format!(
            "Review context for {} changed file(s):\n  - 0 directly changed nodes\n  - 0 impacted nodes in 0 files\n\nReview guidance:\n{}",
            changed_files.len(),
            review_guidance
        ),
        base: options.base.to_string(),
        context: ReviewContextPayload {
            changed_files: changed_files.to_vec(),
            impacted_files: Vec::new(),
            graph: GraphContext {
                changed_nodes: Vec::new(),
                impacted_nodes: Vec::new(),
                edges: Vec::new(),
            },
            targets: Vec::new(),
            tests: ReviewTests {
                test_files: Vec::new(),
                untested_targets: Vec::new(),
                query_failures: Vec::new(),
            },
            review_guidance,
            source_snippets,
        },
        build: ReviewBuildInfo {
            status: "skipped".to_string(),
            backend: None,
            build_type: None,
            summary: "Graph build skipped.".to_string(),
            files_updated: None,
            changed_files: None,
            stale_files: None,
            total_nodes: None,
            total_edges: None,
            languages: None,
        },
    }
}

fn build_targets(graph: &ParsedReviewGraph, max_targets: usize) -> Vec<ReviewTarget> {
    let test_nodes = graph
        .changed_nodes
        .iter()
        .filter(|node| node.is_test)
        .map(|node| (node.qualified_name.clone(), node))
        .collect::<std::collections::BTreeMap<_, _>>();

    graph
        .changed_nodes
        .iter()
        .filter(|node| node.kind != "File" && !node.is_test)
        .take(max_targets)
        .map(|node| {
            let mut tests = graph
                .target_tests
                .iter()
                .filter(|(target, _)| target == &node.qualified_name)
                .filter_map(|(_, test)| test_nodes.get(test))
                .map(|test| SymbolGraphNode {
                    qualified_name: test.qualified_name.clone(),
                    name: test.name.clone(),
                    kind: test.kind.clone(),
                    file_path: test.file_path.clone(),
                    line_start: test.line_start.unwrap_or(1),
                    line_end: test.line_end.unwrap_or(1),
                    language: test.language.clone(),
                    parent_name: test.parent_name.clone(),
                    is_test: test.is_test,
                    references: test.references.clone(),
                    extends: test.extends.clone(),
                })
                .collect::<Vec<_>>();
            tests.sort_by(|a, b| a.qualified_name.cmp(&b.qualified_name));
            ReviewTarget {
                qualified_name: node.qualified_name.clone(),
                name: node.name.clone(),
                kind: node.kind.clone(),
                file_path: node.file_path.clone(),
                tests_count: tests.len(),
                tests,
                inherited_tests: Vec::new(),
                inherited_tests_count: 0,
            }
        })
        .collect()
}

fn build_untested_targets(targets: &[ReviewTarget]) -> Vec<UntestedTarget> {
    targets
        .iter()
        .filter(|target| target.tests.is_empty() && target.inherited_tests.is_empty())
        .map(|target| UntestedTarget {
            qualified_name: target.qualified_name.clone(),
            kind: target.kind.clone(),
            file_path: target.file_path.clone(),
        })
        .collect()
}

fn collect_test_files(targets: &[ReviewTarget]) -> Vec<String> {
    let mut test_files = BTreeSet::new();
    for target in targets {
        for test in &target.tests {
            test_files.insert(test.file_path.clone());
        }
    }
    test_files.into_iter().collect()
}

fn generate_review_guidance(
    untested_targets: &[UntestedTarget],
    wide_blast_radius: bool,
    impacted_test_files: usize,
    impacted_files: usize,
    changed_targets_present: bool,
) -> String {
    let mut guidance_parts = Vec::new();

    if !untested_targets.is_empty() {
        let names = untested_targets
            .iter()
            .take(5)
            .map(|target| target.qualified_name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        guidance_parts.push(format!(
            "- {} changed target(s) lack direct or inherited tests: {}",
            untested_targets.len(),
            names
        ));
    }

    if wide_blast_radius {
        guidance_parts.push(format!(
            "- Wide blast radius: {} impacted files. Review callers, API routes, and downstream workflows carefully.",
            impacted_files
        ));
    }

    if impacted_test_files > 0 {
        guidance_parts.push(format!(
            "- {} impacted test file(s) were identified. Prioritize those before broader regression sweeps.",
            impacted_test_files
        ));
    }

    if changed_targets_present && !wide_blast_radius && untested_targets.is_empty() {
        guidance_parts
            .push("- Changes appear locally test-covered and reasonably contained.".to_string());
    }

    if guidance_parts.is_empty() {
        guidance_parts.push("- No graph-derived review guidance available.".to_string());
    }

    guidance_parts.join("\n")
}

fn collect_source_snippets(
    repo_root: &Path,
    changed_files: &[String],
    test_files: &[String],
    impacted_files: &[String],
    max_files: usize,
    max_lines_per_file: usize,
) -> Vec<SourceSnippet> {
    let mut ranked_paths = Vec::new();
    let mut seen = BTreeSet::new();
    for path in changed_files
        .iter()
        .chain(test_files.iter())
        .chain(impacted_files.iter())
    {
        if seen.insert(path.clone()) {
            ranked_paths.push(path.clone());
        }
    }

    ranked_paths
        .into_iter()
        .take(max_files)
        .filter_map(|relative_path| {
            read_source_snippet(repo_root, &relative_path, max_lines_per_file)
        })
        .collect()
}

fn read_source_snippet(
    repo_root: &Path,
    relative_path: &str,
    max_lines: usize,
) -> Option<SourceSnippet> {
    let path = repo_root.join(relative_path);
    if !path.is_file() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    let lines: Vec<&str> = content.lines().collect();

    Some(SourceSnippet {
        file_path: relative_path.to_string(),
        line_count: lines.len(),
        truncated: lines.len() > max_lines,
        content: lines
            .into_iter()
            .take(max_lines)
            .collect::<Vec<_>>()
            .join("\n"),
    })
}

#[cfg(test)]
mod tests {
    use super::{build_review_context, ReviewBuildMode, ReviewContextOptions};
    use serde_json::json;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn review_context_matches_python_skip_typescript_fixture() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("src/service.ts"),
            "export function run() {\n  return 1;\n}\n",
        )
        .unwrap();

        let result = build_review_context(
            root,
            &["src/service.ts".to_string()],
            ReviewContextOptions {
                base: "HEAD",
                include_source: true,
                max_files: 12,
                max_lines_per_file: 120,
                build_mode: ReviewBuildMode::Skip,
                max_targets: 25,
            },
        );

        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            json!({
              "status": "ok",
              "analysis_mode": "current_graph",
              "summary": "Review context for 1 changed file(s):\n  - 0 directly changed nodes\n  - 0 impacted nodes in 0 files\n\nReview guidance:\n- No graph-derived review guidance available.",
              "base": "HEAD",
              "context": {
                "changed_files": ["src/service.ts"],
                "impacted_files": [],
                "graph": {
                  "changed_nodes": [],
                  "impacted_nodes": [],
                  "edges": []
                },
                "targets": [],
                "tests": {
                  "test_files": [],
                  "untested_targets": [],
                  "query_failures": []
                },
                "review_guidance": "- No graph-derived review guidance available.",
                "source_snippets": [{
                  "file_path": "src/service.ts",
                  "line_count": 3,
                  "truncated": false,
                  "content": "export function run() {\n  return 1;\n}"
                }]
              },
              "build": {
                "status": "skipped",
                "summary": "Graph build skipped."
              }
            })
        );
    }

    #[test]
    fn review_context_matches_python_auto_typescript_fixture() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("src/service.ts"),
            "export function run() {\n  return 1;\n}\n",
        )
        .unwrap();

        let result = build_review_context(
            root,
            &["src/service.ts".to_string()],
            ReviewContextOptions {
                base: "HEAD",
                include_source: true,
                max_files: 12,
                max_lines_per_file: 120,
                build_mode: ReviewBuildMode::Auto,
                max_targets: 25,
            },
        );

        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            json!({
              "status": "ok",
              "analysis_mode": "current_graph",
              "summary": "Review context for 1 changed file(s):\n  - 2 directly changed nodes\n  - 0 impacted nodes in 0 files\n\nReview guidance:\n- 1 changed target(s) lack direct or inherited tests: src/service.ts:run",
              "base": "HEAD",
              "context": {
                "changed_files": ["src/service.ts"],
                "impacted_files": [],
                "graph": {
                  "changed_nodes": [
                    {
                      "qualified_name": "src/service.ts",
                      "name": "service.ts",
                      "kind": "File",
                      "file_path": "src/service.ts",
                      "language": "typescript",
                      "is_test": false
                    },
                    {
                      "qualified_name": "src/service.ts:run",
                      "name": "run",
                      "kind": "Function",
                      "file_path": "src/service.ts",
                      "line_start": 1,
                      "line_end": 3,
                      "language": "typescript",
                      "parent_name": null,
                      "is_test": false,
                      "references": [],
                      "extends": ""
                    }
                  ],
                  "impacted_nodes": [],
                  "edges": []
                },
                "targets": [{
                  "qualified_name": "src/service.ts:run",
                  "name": "run",
                  "kind": "Function",
                  "file_path": "src/service.ts",
                  "tests": [],
                  "tests_count": 0,
                  "inherited_tests": [],
                  "inherited_tests_count": 0
                }],
                "tests": {
                  "test_files": [],
                  "untested_targets": [{
                    "qualified_name": "src/service.ts:run",
                    "kind": "Function",
                    "file_path": "src/service.ts"
                  }],
                  "query_failures": []
                },
                "review_guidance": "- 1 changed target(s) lack direct or inherited tests: src/service.ts:run",
                "source_snippets": [{
                  "file_path": "src/service.ts",
                  "line_count": 3,
                  "truncated": false,
                  "content": "export function run() {\n  return 1;\n}"
                }]
              },
              "build": {
                "status": "ok",
                "backend": "builtin-tree-sitter",
                "build_type": "full",
                "summary": "Full build: parsed 1 file(s), 2 nodes, 1 edges.",
                "files_updated": 1,
                "changed_files": ["src/service.ts"],
                "stale_files": [],
                "total_nodes": 2,
                "total_edges": 1,
                "languages": ["typescript"]
              }
            })
        );
    }

    #[test]
    fn review_context_matches_python_auto_rust_inline_test_fixture() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("src/lib.rs"),
            "pub fn run() -> i32 { 1 }\n#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn test_run() { assert_eq!(run(), 1); }\n}\n",
        )
        .unwrap();

        let result = build_review_context(
            root,
            &["src/lib.rs".to_string()],
            ReviewContextOptions {
                base: "HEAD",
                include_source: true,
                max_files: 12,
                max_lines_per_file: 120,
                build_mode: ReviewBuildMode::Auto,
                max_targets: 25,
            },
        );

        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            json!({
              "status": "ok",
              "analysis_mode": "current_graph",
              "summary": "Review context for 1 changed file(s):\n  - 3 directly changed nodes\n  - 0 impacted nodes in 0 files\n\nReview guidance:\n- Changes appear locally test-covered and reasonably contained.",
              "base": "HEAD",
              "context": {
                "changed_files": ["src/lib.rs"],
                "impacted_files": [],
                "graph": {
                  "changed_nodes": [
                    {
                      "qualified_name": "src/lib.rs",
                      "name": "lib.rs",
                      "kind": "File",
                      "file_path": "src/lib.rs",
                      "language": "rust",
                      "is_test": false
                    },
                    {
                      "qualified_name": "src/lib.rs:run",
                      "name": "run",
                      "kind": "Function",
                      "file_path": "src/lib.rs",
                      "line_start": 1,
                      "line_end": 1,
                      "language": "rust",
                      "parent_name": null,
                      "is_test": false,
                      "references": [],
                      "extends": ""
                    },
                    {
                      "qualified_name": "src/lib.rs:test_run",
                      "name": "test_run",
                      "kind": "Test",
                      "file_path": "src/lib.rs",
                      "line_start": 6,
                      "line_end": 6,
                      "language": "rust",
                      "parent_name": null,
                      "is_test": true,
                      "references": ["assert_eq"],
                      "extends": ""
                    }
                  ],
                  "impacted_nodes": [],
                  "edges": []
                },
                "targets": [{
                  "qualified_name": "src/lib.rs:run",
                  "name": "run",
                  "kind": "Function",
                  "file_path": "src/lib.rs",
                  "tests": [{
                    "qualified_name": "src/lib.rs:test_run",
                    "name": "test_run",
                    "kind": "Test",
                    "file_path": "src/lib.rs",
                    "line_start": 6,
                    "line_end": 6,
                    "language": "rust",
                    "parent_name": null,
                    "is_test": true,
                    "references": ["assert_eq"],
                    "extends": ""
                  }],
                  "tests_count": 1,
                  "inherited_tests": [],
                  "inherited_tests_count": 0
                }],
                "tests": {
                  "test_files": ["src/lib.rs"],
                  "untested_targets": [],
                  "query_failures": []
                },
                "review_guidance": "- Changes appear locally test-covered and reasonably contained.",
                "source_snippets": [{
                  "file_path": "src/lib.rs",
                  "line_count": 7,
                  "truncated": false,
                  "content": "pub fn run() -> i32 { 1 }\n#[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn test_run() { assert_eq!(run(), 1); }\n}"
                }]
              },
              "build": {
                "status": "ok",
                "backend": "builtin-tree-sitter",
                "build_type": "full",
                "summary": "Full build: parsed 1 file(s), 3 nodes, 3 edges.",
                "files_updated": 1,
                "changed_files": ["src/lib.rs"],
                "stale_files": [],
                "total_nodes": 3,
                "total_edges": 3,
                "languages": ["rust"]
              }
            })
        );
    }

    #[test]
    fn review_context_respects_no_source() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/service.ts"), "export function run() {}\n").unwrap();

        let result = build_review_context(
            root,
            &["src/service.ts".to_string()],
            ReviewContextOptions {
                base: "HEAD",
                include_source: false,
                max_files: 12,
                max_lines_per_file: 120,
                build_mode: ReviewBuildMode::Skip,
                max_targets: 25,
            },
        );

        assert!(result.context.source_snippets.is_none());
    }
}
