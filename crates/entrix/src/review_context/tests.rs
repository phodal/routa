use super::{
    analyze_file, analyze_impact, analyze_test_radius, build_graph, build_review_context,
    graph_stats, query_current_graph, GraphNodePayload, ImpactOptions, ReviewBuildMode,
    ReviewContextOptions, TestRadiusOptions,
};
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::process::Command;
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
            max_depth: 2,
            max_targets: 25,
        },
    );

    assert_eq!(result.status, "ok");
    assert_eq!(result.analysis_mode, "current_graph");
    assert_eq!(
        result.context.changed_files,
        vec!["src/service.ts".to_string()]
    );
    assert!(result.context.impacted_files.is_empty());
    assert!(result.context.graph.changed_nodes.is_empty());
    assert!(result.context.graph.impacted_nodes.is_empty());
    assert!(result.context.graph.edges.is_empty());
    assert_eq!(
        result.context.review_guidance,
        "- No graph-derived review guidance available."
    );
    let snippets = result.context.source_snippets.as_ref().unwrap();
    assert_eq!(snippets[0].file_path, "src/service.ts");
    assert_eq!(snippets[0].line_count, 3);
    assert_eq!(result.build.status, "skipped");
    assert_eq!(result.build.summary, "Graph build skipped.");
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
            max_depth: 2,
            max_targets: 25,
        },
    );

    assert_eq!(result.status, "ok");
    assert_eq!(
        result.context.changed_files,
        vec!["src/service.ts".to_string()]
    );
    assert!(result.context.impacted_files.is_empty());
    assert_eq!(result.context.graph.changed_nodes.len(), 2);
    assert!(result.context.graph.impacted_nodes.is_empty());
    assert_eq!(result.context.targets.len(), 1);
    assert_eq!(
        result.context.targets[0].qualified_name,
        "src/service.ts:run"
    );
    assert_eq!(result.context.targets[0].tests_count, 0);
    assert_eq!(
        result.context.review_guidance,
        "- 1 changed target(s) lack direct or inherited tests: src/service.ts:run"
    );
    assert_eq!(result.build.status, "ok");
    assert_eq!(result.build.backend.as_deref(), Some("builtin-tree-sitter"));
    assert_eq!(result.build.total_nodes, Some(2));
    assert_eq!(result.build.languages, Some(vec!["typescript".to_string()]));
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
            max_depth: 2,
            max_targets: 25,
        },
    );

    assert_eq!(result.status, "ok");
    assert_eq!(result.context.changed_files, vec!["src/lib.rs".to_string()]);
    assert!(result.context.impacted_files.is_empty());
    assert_eq!(result.context.graph.changed_nodes.len(), 3);
    assert!(result.context.graph.impacted_nodes.is_empty());
    assert_eq!(
        result.context.tests.test_files,
        vec!["src/lib.rs".to_string()]
    );
    assert!(result.context.tests.untested_targets.is_empty());
    assert_eq!(
        result.context.review_guidance,
        "- Changes appear locally test-covered and reasonably contained."
    );
    assert!(result.context.graph.edges.iter().any(|edge| {
        edge["kind"] == "TESTED_BY"
            && edge["source_qualified"] == "src/lib.rs:test_run"
            && edge["target_qualified"] == "src/lib.rs:run"
    }));
    assert_eq!(result.build.backend.as_deref(), Some("builtin-tree-sitter"));
    assert_eq!(result.build.total_nodes, Some(3));
    assert_eq!(result.build.languages, Some(vec!["rust".to_string()]));
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
            max_depth: 2,
            max_targets: 25,
        },
    );

    assert!(result.context.source_snippets.is_none());
}

#[test]
fn review_context_links_java_companion_test_file() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src/main/java/com/example")).unwrap();
    fs::create_dir_all(root.join("src/test/java/com/example")).unwrap();
    fs::write(
        root.join("src/main/java/com/example/Service.java"),
        "package com.example;\nclass Service {\n  String run() { return \"ok\"; }\n}\n",
    )
    .unwrap();
    fs::write(
        root.join("src/test/java/com/example/ServiceTest.java"),
        "package com.example;\nclass ServiceTest {\n  @Test\n  void testRun() { new Service().run(); }\n}\n",
    )
    .unwrap();

    let result = build_review_context(
        root,
        &["src/main/java/com/example/Service.java".to_string()],
        ReviewContextOptions {
            base: "HEAD",
            include_source: true,
            max_files: 12,
            max_lines_per_file: 120,
            build_mode: ReviewBuildMode::Auto,
            max_depth: 2,
            max_targets: 25,
        },
    );

    assert_eq!(result.context.targets.len(), 2);
    let run_target = result
        .context
        .targets
        .iter()
        .find(|target| target.qualified_name.ends_with(".Service.run"))
        .unwrap();
    assert_eq!(run_target.tests_count, 1);
    assert_eq!(
        run_target.tests[0].qualified_name,
        "src/test/java/com/example/ServiceTest.java:com.example.ServiceTest.testRun"
    );
    assert_eq!(
        result.context.tests.test_files,
        vec!["src/test/java/com/example/ServiceTest.java".to_string()]
    );
    assert_eq!(
        result.context.impacted_files,
        vec!["src/test/java/com/example/ServiceTest.java".to_string()]
    );
    assert!(!result.context.graph.impacted_nodes.is_empty());
    assert!(result.context.graph.edges.iter().any(|edge| {
        edge["kind"] == "TESTED_BY"
            && edge["source_qualified"]
                == "src/test/java/com/example/ServiceTest.java:com.example.ServiceTest.testRun"
    }));
    assert!(result
        .context
        .review_guidance
        .contains("Changes appear locally test-covered"));
}

#[test]
fn review_context_links_go_companion_test_file() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("pkg/demo")).unwrap();
    fs::write(
        root.join("pkg/demo/service.go"),
        "package demo\n\ntype Service struct{}\n\nfunc (s *Service) Run() int { return 1 }\n",
    )
    .unwrap();
    fs::write(
        root.join("pkg/demo/service_test.go"),
        "package demo\n\nfunc TestRun(t *testing.T) {\n  var service Service\n  t.Run(\"run method\", func(t *testing.T) {\n    _ = service.Run()\n  })\n}\n",
    )
    .unwrap();

    let result = build_review_context(
        root,
        &["pkg/demo/service.go".to_string()],
        ReviewContextOptions {
            base: "HEAD",
            include_source: true,
            max_files: 12,
            max_lines_per_file: 120,
            build_mode: ReviewBuildMode::Auto,
            max_depth: 2,
            max_targets: 25,
        },
    );

    let run_target = result
        .context
        .targets
        .iter()
        .find(|target| target.qualified_name == "pkg/demo/service.go:Service.Run")
        .unwrap();
    assert_eq!(run_target.tests_count, 2);
    let test_ids = run_target
        .tests
        .iter()
        .map(|test| test.qualified_name.as_str())
        .collect::<Vec<_>>();
    assert!(test_ids.contains(&"pkg/demo/service_test.go:TestRun"));
    assert!(test_ids.contains(&"pkg/demo/service_test.go:subtest_run_method"));
    assert_eq!(
        result.context.tests.test_files,
        vec!["pkg/demo/service_test.go".to_string()]
    );
    assert_eq!(
        result.context.impacted_files,
        vec!["pkg/demo/service_test.go".to_string()]
    );
    assert!(!result.context.graph.impacted_nodes.is_empty());
    assert!(result
        .context
        .review_guidance
        .contains("Changes appear locally test-covered"));
}

#[test]
fn review_context_links_typescript_companion_spec_file() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.ts"),
        "export function run() {\n  return 1;\n}\n",
    )
    .unwrap();
    fs::write(
        root.join("src/service.test.ts"),
        "import { run } from './service';\n\ntest('run', () => {\n  expect(run()).toBe(1);\n});\n",
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
            max_depth: 2,
            max_targets: 25,
        },
    );

    let run_target = result
        .context
        .targets
        .iter()
        .find(|target| target.qualified_name == "src/service.ts:run")
        .unwrap();
    assert_eq!(run_target.tests_count, 1);
    assert_eq!(
        run_target.tests[0].qualified_name,
        "src/service.test.ts:test:3"
    );
    assert_eq!(
        result.context.tests.test_files,
        vec!["src/service.test.ts".to_string()]
    );
    assert_eq!(
        result.context.impacted_files,
        vec!["src/service.test.ts".to_string()]
    );
    assert!(!result.context.graph.impacted_nodes.is_empty());
    assert!(result
        .context
        .review_guidance
        .contains("Changes appear locally test-covered"));
}

#[test]
fn review_context_emits_impacted_graph_edges_for_companion_tests() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.ts"),
        "export function run() {\n  return 1;\n}\n",
    )
    .unwrap();
    fs::write(
        root.join("src/service.test.ts"),
        "import { run } from './service';\n\ntest('run', () => {\n  expect(run()).toBe(1);\n});\n",
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
            max_depth: 2,
            max_targets: 25,
        },
    );

    assert_eq!(
        result.context.impacted_files,
        vec!["src/service.test.ts".to_string()]
    );
    assert!(result.summary.contains("2 impacted nodes in 1 files"));
    assert!(result.context.graph.edges.iter().any(|edge| {
        edge["source_qualified"] == "src/service.test.ts:test:3"
            && edge["target_qualified"] == "src/service.ts:run"
            && edge["kind"] == "TESTED_BY"
    }));
}

#[test]
fn analyze_impact_reports_impacted_test_files() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.ts"),
        "export function run() {\n  return 1;\n}\n",
    )
    .unwrap();
    fs::write(
        root.join("src/service.test.ts"),
        "import { run } from './service';\n\ntest('run', () => {\n  expect(run()).toBe(1);\n});\n",
    )
    .unwrap();

    let result = analyze_impact(
        root,
        &["src/service.ts".to_string()],
        ImpactOptions {
            base: "HEAD",
            build_mode: ReviewBuildMode::Auto,
            max_depth: 2,
            max_impacted_files: 200,
        },
    );

    assert_eq!(result.status, "ok");
    assert_eq!(result.changed_files, vec!["src/service.ts".to_string()]);
    assert_eq!(
        result.impacted_files,
        vec!["src/service.test.ts".to_string()]
    );
    assert_eq!(
        result.impacted_test_files,
        vec!["src/service.test.ts".to_string()]
    );
    assert!(!result.edges.is_empty());
}

#[test]
fn analyze_test_radius_queries_targets_and_collects_tests() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.ts"),
        "export function run() { return helper(); }\nfunction helper() { return 1; }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/service.test.ts"),
        "import { run } from './service';\n\ntest('run', () => {\n  expect(run()).toBe(1);\n});\n",
    )
    .unwrap();

    let result = analyze_test_radius(
        root,
        &["src/service.ts".to_string()],
        TestRadiusOptions {
            base: "HEAD",
            build_mode: ReviewBuildMode::Auto,
            max_depth: 2,
            max_targets: 25,
            max_impacted_files: 200,
        },
    );

    assert_eq!(result.status, "ok");
    assert_eq!(result.target_nodes.len(), 2);
    let run_target = result
        .target_nodes
        .iter()
        .find(|target| target.qualified_name == "src/service.ts:run")
        .unwrap();
    assert_eq!(run_target.tests_count, 1);
    let helper_target = result
        .target_nodes
        .iter()
        .find(|target| target.qualified_name == "src/service.ts:helper")
        .unwrap();
    assert_eq!(helper_target.tests_count, 0);
    assert_eq!(helper_target.inherited_tests_count, 1);
    assert_eq!(result.test_files, vec!["src/service.test.ts".to_string()]);
    assert!(result
        .edges
        .iter()
        .any(|edge| edge.kind == "CALLS" && edge.source_qualified == "src/service.ts:run"));
}

#[test]
fn query_current_graph_returns_tests_for_target() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.ts"),
        "export function run() {\n  return 1;\n}\n",
    )
    .unwrap();
    fs::write(
        root.join("src/service.test.ts"),
        "import { run } from './service';\n\ntest('run', () => {\n  expect(run()).toBe(1);\n});\n",
    )
    .unwrap();

    let result = query_current_graph(
        root,
        "src/service.ts:run",
        "tests_for",
        ReviewBuildMode::Auto,
    );

    assert_eq!(result.status, "ok");
    assert_eq!(result.results.len(), 1);
    assert!(matches!(
        &result.results[0],
        GraphNodePayload::Symbol(node) if node.qualified_name == "src/service.test.ts:test:3"
    ));
    assert_eq!(result.edges.len(), 1);
    assert_eq!(result.edges[0].kind, "TESTED_BY");
}

#[test]
fn query_current_graph_returns_children_for_file() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.ts"),
        "export class Service {}\nexport function run() { return 1; }\n",
    )
    .unwrap();

    let result = query_current_graph(root, "src/service.ts", "children_of", ReviewBuildMode::Auto);

    assert_eq!(result.status, "ok");
    assert_eq!(result.results.len(), 2);
    assert!(result.edges.iter().all(|edge| edge.kind == "CONTAINS"));
}

#[test]
fn query_current_graph_returns_inheritors_for_class() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.ts"),
        "class BaseService {}\nclass ChildService extends BaseService {}\n",
    )
    .unwrap();

    let result = query_current_graph(
        root,
        "src/service.ts:BaseService",
        "inheritors_of",
        ReviewBuildMode::Auto,
    );

    assert_eq!(result.status, "ok");
    assert_eq!(result.results.len(), 1);
    assert!(matches!(
        &result.results[0],
        GraphNodePayload::Symbol(node) if node.qualified_name == "src/service.ts:ChildService"
    ));
    assert_eq!(result.edges[0].kind, "INHERITS");
}

#[test]
fn query_current_graph_returns_imports_for_file() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.ts"), "export const value = 1;\n").unwrap();
    fs::write(
        root.join("src/service.ts"),
        "import { value } from './lib';\nexport function run() { return value; }\n",
    )
    .unwrap();

    let result = query_current_graph(root, "src/service.ts", "imports_of", ReviewBuildMode::Auto);

    assert_eq!(result.status, "ok");
    assert_eq!(result.results.len(), 1);
    assert!(matches!(
        &result.results[0],
        GraphNodePayload::File(node) if node.qualified_name == "src/lib.ts"
    ));
    assert_eq!(result.edges.len(), 1);
    assert_eq!(result.edges[0].kind, "IMPORTS_FROM");
    assert_eq!(result.edges[0].source_qualified, "src/service.ts");
    assert_eq!(result.edges[0].target_qualified, "src/lib.ts");
}

#[test]
fn query_current_graph_returns_imports_for_unique_symbol_target() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.ts"), "export const value = 1;\n").unwrap();
    fs::write(
        root.join("src/service.ts"),
        "import { value } from './lib';\nexport function run() { return value; }\n",
    )
    .unwrap();

    let result = query_current_graph(root, "run", "imports_of", ReviewBuildMode::Auto);

    assert_eq!(result.status, "ok");
    assert_eq!(result.results.len(), 1);
    assert!(matches!(
        &result.results[0],
        GraphNodePayload::File(file) if file.qualified_name == "src/lib.ts"
    ));
}

#[test]
fn query_current_graph_returns_imports_for_qualified_symbol_target() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.ts"), "export const value = 1;\n").unwrap();
    fs::write(
        root.join("src/service.ts"),
        "import { value } from './lib';\nexport function run() { return value; }\n",
    )
    .unwrap();

    let result = query_current_graph(
        root,
        "src/service.ts:run",
        "imports_of",
        ReviewBuildMode::Auto,
    );

    assert_eq!(result.status, "ok");
    assert_eq!(result.results.len(), 1);
    assert!(matches!(
        &result.results[0],
        GraphNodePayload::File(file) if file.qualified_name == "src/lib.ts"
    ));
}

#[test]
fn query_current_graph_rejects_ambiguous_symbol_target_for_imports() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.ts"), "export const value = 1;\n").unwrap();
    fs::write(
        root.join("src/service_a.ts"),
        "import { value } from './lib';\nexport function run() { return value; }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/service_b.ts"),
        "import { value } from './lib';\nexport function run() { return value; }\n",
    )
    .unwrap();

    let result = query_current_graph(root, "run", "imports_of", ReviewBuildMode::Auto);

    assert_eq!(result.status, "not_found");
}

#[test]
fn query_current_graph_returns_importers_for_file() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.ts"), "export const value = 1;\n").unwrap();
    fs::write(
        root.join("src/service.ts"),
        "import { value } from './lib';\nexport function run() { return value; }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/feature.ts"),
        "import { value } from './lib';\nexport const feature = value + 1;\n",
    )
    .unwrap();

    let result = query_current_graph(root, "src/lib.ts", "importers_of", ReviewBuildMode::Auto);

    assert_eq!(result.status, "ok");
    assert_eq!(result.results.len(), 2);
    assert!(result.results.iter().any(
        |node| matches!(node, GraphNodePayload::File(file) if file.qualified_name == "src/service.ts")
    ));
    assert!(result.results.iter().any(
        |node| matches!(node, GraphNodePayload::File(file) if file.qualified_name == "src/feature.ts")
    ));
    assert_eq!(result.edges.len(), 2);
    assert!(result
        .edges
        .iter()
        .all(|edge| edge.kind == "IMPORTS_FROM" && edge.target_qualified == "src/lib.ts"));
}

#[test]
fn query_current_graph_returns_go_imports_for_file() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("pkg/demo/util")).unwrap();
    fs::write(
        root.join("pkg/demo/util/util.go"),
        "package util\n\nfunc Version() int { return 1 }\n",
    )
    .unwrap();
    fs::write(
        root.join("pkg/demo/service.go"),
        "package demo\n\nimport \"./util\"\n\nfunc Run() int { return util.Version() }\n",
    )
    .unwrap();

    let result = query_current_graph(
        root,
        "pkg/demo/service.go",
        "imports_of",
        ReviewBuildMode::Auto,
    );

    assert_eq!(result.status, "ok");
    assert_eq!(result.results.len(), 1);
    assert!(matches!(
        &result.results[0],
        GraphNodePayload::File(file) if file.qualified_name == "pkg/demo/util/util.go"
    ));
    assert_eq!(result.edges[0].kind, "IMPORTS_FROM");
    assert_eq!(result.edges[0].source_qualified, "pkg/demo/service.go");
    assert_eq!(result.edges[0].target_qualified, "pkg/demo/util/util.go");
}

#[test]
fn query_current_graph_returns_java_imports_for_file() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src/main/java/com/example/util")).unwrap();
    fs::write(
        root.join("src/main/java/com/example/util/Helper.java"),
        "package com.example.util;\n\npublic class Helper { public static String name() { return \"ok\"; } }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/main/java/com/example/Service.java"),
        "package com.example;\n\nimport com.example.util.Helper;\n\npublic class Service {\n  public String run() { return Helper.name(); }\n}\n",
    )
    .unwrap();

    let result = query_current_graph(
        root,
        "src/main/java/com/example/Service.java",
        "imports_of",
        ReviewBuildMode::Auto,
    );

    assert_eq!(result.status, "ok");
    assert_eq!(result.results.len(), 1);
    assert!(matches!(
        &result.results[0],
        GraphNodePayload::File(file) if file.qualified_name == "src/main/java/com/example/util/Helper.java"
    ));
    assert_eq!(result.edges[0].kind, "IMPORTS_FROM");
    assert_eq!(
        result.edges[0].source_qualified,
        "src/main/java/com/example/Service.java"
    );
    assert_eq!(
        result.edges[0].target_qualified,
        "src/main/java/com/example/util/Helper.java"
    );
}

#[test]
fn query_current_graph_resolves_unique_symbol_name() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.ts"),
        "class BaseService {}\nclass ChildService extends BaseService {}\n",
    )
    .unwrap();

    let result = query_current_graph(root, "BaseService", "inheritors_of", ReviewBuildMode::Auto);

    assert_eq!(result.status, "ok");
    assert_eq!(result.results.len(), 1);
    assert!(matches!(
        &result.results[0],
        GraphNodePayload::Symbol(node) if node.qualified_name == "src/service.ts:ChildService"
    ));
}

#[test]
fn query_current_graph_file_summary_includes_file_node() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.ts"),
        "export class Service {}\nexport function run() { return 1; }\n",
    )
    .unwrap();

    let result = query_current_graph(
        root,
        "src/service.ts",
        "file_summary",
        ReviewBuildMode::Auto,
    );

    assert_eq!(result.status, "ok");
    assert_eq!(result.results.len(), 3);
    assert!(matches!(
        &result.results[0],
        GraphNodePayload::File(node) if node.qualified_name == "src/service.ts"
    ));
    assert!(result.edges.is_empty());
}

#[test]
fn analyze_file_reports_symbols_imports_and_basename() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.ts"), "export const value = 1;\n").unwrap();
    fs::write(
        root.join("src/service.test.ts"),
        "import { value } from './lib';\nexport function run() { return value; }\n",
    )
    .unwrap();

    let result = analyze_file(root, "src/service.test.ts");

    assert_eq!(result.status, "ok");
    assert_eq!(result.file_path.as_deref(), Some("src/service.test.ts"));
    assert_eq!(result.language.as_deref(), Some("typescript"));
    assert_eq!(result.is_test_file, Some(true));
    assert_eq!(
        result.imports.unwrap_or_default(),
        vec!["src/lib.ts".to_string()]
    );
    assert_eq!(result.source_basename.as_deref(), Some("service"));
    let symbols = result.symbols.as_ref().unwrap();
    assert!(symbols
        .iter()
        .any(|symbol| symbol.qualified_name == "src/service.test.ts:run"));
}

#[test]
fn parity_with_python_entrix_for_analyze_file() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.ts"), "export const value = 1;\n").unwrap();
    fs::write(
        root.join("src/service.test.ts"),
        "import { value } from './lib';\nexport function run() { return value; }\n",
    )
    .unwrap();

    let Some(python) = python_entrix_adapter_json(root, "analyze_file", &["src/service.test.ts"])
    else {
        return;
    };
    let rust = serde_json::to_value(analyze_file(root, "src/service.test.ts")).unwrap();

    assert_eq!(rust["status"], python["status"]);
    assert_eq!(rust["file_path"], python["file_path"]);
    assert_eq!(rust["language"], python["language"]);
    assert_eq!(rust["is_test_file"], python["is_test_file"]);
    assert_eq!(rust["imports"], python["imports"]);
    assert_eq!(rust["source_basename"], python["source_basename"]);
    assert_eq!(
        qualified_names(rust["symbols"].as_array().map_or(&[], |v| v)),
        qualified_names(python["symbols"].as_array().map_or(&[], |v| v))
    );
}

#[test]
fn parity_with_python_entrix_for_query_shapes() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.ts"),
        "export function run() { return helper(); }\nfunction helper() { return 1; }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/service.test.ts"),
        "import { run } from './service';\n\ntest('run works', () => { expect(run()).toBe(1); });\n",
    )
    .unwrap();

    let Some(python_tests) =
        python_entrix_adapter_json(root, "query", &["tests_for", "src/service.ts:run"])
    else {
        return;
    };
    let rust_tests = serde_json::to_value(query_current_graph(
        root,
        "src/service.ts:run",
        "tests_for",
        ReviewBuildMode::Auto,
    ))
    .unwrap();
    assert_eq!(rust_tests["status"], python_tests["status"]);
    assert_eq!(
        qualified_names(rust_tests["results"].as_array().map_or(&[], |v| v)),
        qualified_names(python_tests["results"].as_array().map_or(&[], |v| v))
    );
    assert_eq!(
        edge_keys(rust_tests["edges"].as_array().map_or(&[], |v| v)),
        edge_keys(python_tests["edges"].as_array().map_or(&[], |v| v))
    );

    let Some(python_summary) =
        python_entrix_adapter_json(root, "query", &["file_summary", "src/service.ts"])
    else {
        return;
    };
    let rust_summary = serde_json::to_value(query_current_graph(
        root,
        "src/service.ts",
        "file_summary",
        ReviewBuildMode::Auto,
    ))
    .unwrap();
    assert_eq!(rust_summary["status"], python_summary["status"]);
    assert_eq!(
        qualified_names(rust_summary["results"].as_array().map_or(&[], |v| v)),
        qualified_names(python_summary["results"].as_array().map_or(&[], |v| v))
    );
}

#[test]
fn parity_with_python_entrix_for_review_context_core_fields() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.ts"),
        "export function run() { return helper(); }\nfunction helper() { return 1; }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/service.test.ts"),
        "import { run } from './service';\n\ntest('run', () => { expect(run()).toBe(1); });\n",
    )
    .unwrap();

    let Some(python) = python_entrix_runner_json(root, "review_context", &["src/service.ts"])
    else {
        return;
    };
    let rust = serde_json::to_value(build_review_context(
        root,
        &["src/service.ts".to_string()],
        ReviewContextOptions {
            base: "HEAD",
            include_source: false,
            max_files: 12,
            max_lines_per_file: 120,
            build_mode: ReviewBuildMode::Auto,
            max_depth: 2,
            max_targets: 25,
        },
    ))
    .unwrap();

    assert_eq!(rust["status"], python["status"]);
    assert_eq!(rust["analysis_mode"], python["analysis_mode"]);
    assert_eq!(
        rust["context"]["changed_files"],
        python["context"]["changed_files"]
    );
    assert_eq!(
        rust["context"]["impacted_files"],
        python["context"]["impacted_files"]
    );
    assert_eq!(
        qualified_names(rust["context"]["targets"].as_array().map_or(&[], |v| v)),
        qualified_names(python["context"]["targets"].as_array().map_or(&[], |v| v))
    );
    assert_eq!(
        rust["context"]["tests"]["test_files"],
        python["context"]["tests"]["test_files"]
    );
    assert_eq!(
        rust["context"]["tests"]["untested_targets"],
        python["context"]["tests"]["untested_targets"]
    );
}

#[test]
fn parity_with_python_entrix_for_test_radius_core_fields() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.ts"),
        "export function run() { return helper(); }\nfunction helper() { return 1; }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/service.test.ts"),
        "import { run } from './service';\n\ntest('run', () => { expect(run()).toBe(1); });\n",
    )
    .unwrap();

    let Some(python) = python_entrix_runner_json(root, "test_radius", &["src/service.ts"]) else {
        return;
    };
    let rust = serde_json::to_value(analyze_test_radius(
        root,
        &["src/service.ts".to_string()],
        TestRadiusOptions {
            base: "HEAD",
            build_mode: ReviewBuildMode::Auto,
            max_depth: 2,
            max_targets: 25,
            max_impacted_files: 200,
        },
    ))
    .unwrap();

    assert_eq!(rust["status"], python["status"]);
    assert_eq!(rust["analysis_mode"], python["analysis_mode"]);
    assert_eq!(rust["changed_files"], python["changed_files"]);
    assert_eq!(rust["impacted_files"], python["impacted_files"]);
    assert_eq!(rust["test_files"], python["test_files"]);
    assert_eq!(rust["untested_targets"], python["untested_targets"]);
    assert_eq!(
        qualified_names(rust["target_nodes"].as_array().map_or(&[], |v| v)),
        qualified_names(python["target_nodes"].as_array().map_or(&[], |v| v))
    );
}

#[test]
fn parity_with_python_entrix_for_analyze_impact_core_fields() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.ts"),
        "export function run() { return helper(); }\nfunction helper() { return 1; }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/service.test.ts"),
        "import { run } from './service';\n\ntest('run', () => { expect(run()).toBe(1); });\n",
    )
    .unwrap();

    let Some(python) = python_entrix_runner_json(root, "analyze_impact", &["src/service.ts"])
    else {
        return;
    };
    let rust = serde_json::to_value(analyze_impact(
        root,
        &["src/service.ts".to_string()],
        ImpactOptions {
            base: "HEAD",
            build_mode: ReviewBuildMode::Auto,
            max_depth: 2,
            max_impacted_files: 200,
        },
    ))
    .unwrap();

    assert_eq!(rust["status"], python["status"]);
    assert_eq!(rust["base"], python["base"]);
    assert_eq!(
        sorted_strings(rust["changed_files"].as_array().map_or(&[], |v| v)),
        sorted_strings(python["changed_files"].as_array().map_or(&[], |v| v))
    );
    assert_eq!(
        sorted_strings(rust["skipped_files"].as_array().map_or(&[], |v| v)),
        sorted_strings(python["skipped_files"].as_array().map_or(&[], |v| v))
    );
    assert_eq!(
        qualified_names(rust["changed_nodes"].as_array().map_or(&[], |v| v)),
        qualified_names(python["changed_nodes"].as_array().map_or(&[], |v| v))
    );
    assert_eq!(
        qualified_names(rust["impacted_nodes"].as_array().map_or(&[], |v| v)),
        qualified_names(python["impacted_nodes"].as_array().map_or(&[], |v| v))
    );
    assert_eq!(
        sorted_strings(rust["impacted_files"].as_array().map_or(&[], |v| v)),
        sorted_strings(python["impacted_files"].as_array().map_or(&[], |v| v))
    );
    assert_eq!(
        sorted_strings(rust["impacted_test_files"].as_array().map_or(&[], |v| v)),
        sorted_strings(python["impacted_test_files"].as_array().map_or(&[], |v| v))
    );
    assert_eq!(rust["wide_blast_radius"], python["wide_blast_radius"]);
    assert_eq!(rust["build"]["status"], python["build"]["status"],);
    assert_eq!(rust["build"]["backend"], python["build"]["backend"],);
    assert_eq!(rust["build"]["build_type"], python["build"]["build_type"],);
}

#[test]
fn parity_with_python_entrix_for_build_graph_core_fields() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/service.ts"), "export function run() {}\n").unwrap();
    fs::write(root.join("README.md"), "note\n").unwrap();

    let Some(python) = python_entrix_runner_json(root, "build_graph", &[]) else {
        return;
    };
    let rust = serde_json::to_value(build_graph(root, ReviewBuildMode::Auto)).unwrap();

    assert_eq!(rust["status"], python["status"]);
    assert_eq!(rust["backend"], python["backend"]);
    assert_eq!(rust["build_type"], python["build_type"]);
    assert_eq!(rust["summary"], python["summary"]);
    assert_eq!(rust["total_nodes"], python["total_nodes"]);
    assert_eq!(rust["total_edges"], python["total_edges"]);
    assert_eq!(
        sorted_strings(rust["languages"].as_array().map_or(&[], |v| v)),
        sorted_strings(python["languages"].as_array().map_or(&[], |v| v))
    );
}

#[test]
fn parity_with_python_entrix_for_graph_stats_core_fields() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/service.ts"), "export function run() {}\n").unwrap();
    fs::write(
        root.join("src/service.test.ts"),
        "export function test_run() {}\n",
    )
    .unwrap();
    fs::write(root.join("README.md"), "note\n").unwrap();

    let _ = python_entrix_runner_json(root, "build_graph", &[]);
    let Some(python) = python_entrix_runner_json(root, "stats", &[]) else {
        return;
    };
    let rust = serde_json::to_value(graph_stats(root)).unwrap();
    assert_eq!(rust["status"], python["status"]);
    assert_eq!(rust["nodes"], python["nodes"]);
    assert_eq!(rust["edges"], python["edges"]);
    assert_eq!(
        sorted_strings(rust["languages"].as_array().map_or(&[], |v| v)),
        sorted_strings(python["languages"].as_array().map_or(&[], |v| v))
    );
    assert_eq!(rust["backend"], python["backend"]);
}

#[test]
fn parity_with_python_entrix_for_python_queries() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.py"),
        "class Service:\n    def run(self):\n        return helper()\n\n\ndef helper():\n    return 1\n",
    )
    .unwrap();
    fs::write(
        root.join("src/test_service.py"),
        "from .service import helper\n\n\ndef test_helper():\n    assert helper() == 1\n",
    )
    .unwrap();

    let Some(python_children) =
        python_entrix_adapter_json(root, "query", &["children_of", "src/service.py"])
    else {
        return;
    };
    let rust_children = serde_json::to_value(query_current_graph(
        root,
        "src/service.py",
        "children_of",
        ReviewBuildMode::Auto,
    ))
    .unwrap();
    assert_eq!(
        qualified_names(rust_children["results"].as_array().map_or(&[], |v| v)),
        qualified_names(python_children["results"].as_array().map_or(&[], |v| v))
    );

    let Some(python_tests) =
        python_entrix_adapter_json(root, "query", &["tests_for", "src/service.py:helper"])
    else {
        return;
    };
    let rust_tests = serde_json::to_value(query_current_graph(
        root,
        "src/service.py:helper",
        "tests_for",
        ReviewBuildMode::Auto,
    ))
    .unwrap();
    assert_eq!(
        qualified_names(rust_tests["results"].as_array().map_or(&[], |v| v)),
        qualified_names(python_tests["results"].as_array().map_or(&[], |v| v))
    );
}

#[test]
fn parity_with_python_entrix_for_import_queries() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.py"), "def helper():\n    return 1\n").unwrap();
    fs::write(
        root.join("src/service.py"),
        "from .lib import helper\n\ndef run():\n    return helper()\n",
    )
    .unwrap();
    fs::write(
        root.join("src/test_service.py"),
        "from .service import run\n\ndef test_run():\n    assert run() == 1\n",
    )
    .unwrap();

    let Some(python_imports_by_target) =
        python_entrix_adapter_json(root, "query", &["imports_of", "run"])
    else {
        return;
    };
    let rust_imports_by_target = serde_json::to_value(query_current_graph(
        root,
        "run",
        "imports_of",
        ReviewBuildMode::Auto,
    ))
    .unwrap();
    assert_eq!(
        qualified_names(
            rust_imports_by_target["results"]
                .as_array()
                .map_or(&[], |v| v),
        ),
        qualified_names(
            python_imports_by_target["results"]
                .as_array()
                .map_or(&[], |v| v),
        )
    );

    let Some(python_imports_qualified) =
        python_entrix_adapter_json(root, "query", &["imports_of", "src/service.py:run"])
    else {
        return;
    };
    let rust_imports_qualified = serde_json::to_value(query_current_graph(
        root,
        "src/service.py:run",
        "imports_of",
        ReviewBuildMode::Auto,
    ))
    .unwrap();
    assert_eq!(
        qualified_names(
            rust_imports_qualified["results"]
                .as_array()
                .map_or(&[], |v| v),
        ),
        qualified_names(
            python_imports_qualified["results"]
                .as_array()
                .map_or(&[], |v| v),
        )
    );
}

#[test]
fn query_current_graph_limits_call_edges_to_imported_symbols() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/dep.ts"),
        "export function run() { return 1; }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/other.ts"),
        "export function run() { return 2; }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/consumer.ts"),
        "import { run } from './dep';\nexport function consume() { return run(); }\n",
    )
    .unwrap();

    let result = query_current_graph(
        root,
        "src/consumer.ts:consume",
        "callees_of",
        ReviewBuildMode::Auto,
    );

    assert_eq!(result.status, "ok");
    assert_eq!(result.results.len(), 1);
    assert!(matches!(
        &result.results[0],
        GraphNodePayload::Symbol(node) if node.qualified_name == "src/dep.ts:run"
    ));
}

#[test]
fn query_current_graph_avoids_ambiguous_global_call_matches() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/first.ts"),
        "export function helper() { return 1; }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/second.ts"),
        "export function helper() { return 2; }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/consumer.ts"),
        "export function consume() { return helper(); }\n",
    )
    .unwrap();

    let result = query_current_graph(
        root,
        "src/consumer.ts:consume",
        "callees_of",
        ReviewBuildMode::Auto,
    );

    assert_eq!(result.status, "ok");
    assert!(result.results.is_empty());
}

#[test]
fn query_current_graph_resolves_multiline_grouped_rust_imports() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("crates/demo/src/commands")).unwrap();
    fs::write(
        root.join("crates/demo/src/lib.rs"),
        "mod commands;\nmod agent;\n",
    )
    .unwrap();
    fs::write(
        root.join("crates/demo/src/commands/mod.rs"),
        "pub fn execution_budget() -> u64 { 240 }\npub fn output_contains_artifact_payload() -> bool { true }\n",
    )
    .unwrap();
    fs::write(
        root.join("crates/demo/src/agent.rs"),
        "use crate::commands::{\n    execution_budget,\n    output_contains_artifact_payload,\n};\n\npub fn run() -> bool {\n    execution_budget() > 0 && output_contains_artifact_payload()\n}\n",
    )
    .unwrap();

    let result = query_current_graph(
        root,
        "crates/demo/src/agent.rs",
        "imports_of",
        ReviewBuildMode::Auto,
    );

    assert_eq!(result.status, "ok");
    assert_eq!(result.results.len(), 1);
    assert!(matches!(
        &result.results[0],
        GraphNodePayload::File(node) if node.qualified_name == "crates/demo/src/commands/mod.rs"
    ));
}

#[test]
fn resolve_rust_import_handles_ci_style_grouped_import_text() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("crates/demo/src/commands")).unwrap();
    fs::write(root.join("crates/demo/src/lib.rs"), "mod commands;\n").unwrap();
    fs::write(
        root.join("crates/demo/src/commands/mod.rs"),
        "pub fn execution_budget() {}\npub fn output_contains_artifact_payload() {}\n",
    )
    .unwrap();

    let resolved = super::tree_sitter::resolve_rust_import(
        root,
        "crates/demo/src/lib.rs",
        "use crate::commands::{\n        execution_budget, output_contains_artifact_payload, parse_prompt,\n        recover_success_artifacts_from_output, validate_prompt, validate_success_artifacts,\n        write_artifact_set, write_baseline_artifacts, UiJourneyAggregateRun, UiJourneyPromptParams,\n        UiJourneyRunContext, UiJourneyRunMetrics, DEFAULT_ARTIFACT_DIR, DEFAULT_BASE_URL,\n        DEFAULT_SCENARIO_ID,\n    };",
    );

    assert_eq!(resolved.as_deref(), Some("crates/demo/src/commands/mod.rs"));
}

#[test]
fn query_current_graph_limits_tests_to_matching_symbols() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/mod.ts"),
        "export function run() { return 1 }\nexport function helper() { return 2 }\n",
    )
    .unwrap();
    fs::write(
        root.join("src/mod.test.ts"),
        "import { run, helper } from './mod'\ntest('run works', () => run())\nvoid helper\n",
    )
    .unwrap();

    let run_tests = query_current_graph(root, "src/mod.ts:run", "tests_for", ReviewBuildMode::Auto);
    let helper_tests = query_current_graph(
        root,
        "src/mod.ts:helper",
        "tests_for",
        ReviewBuildMode::Auto,
    );

    assert_eq!(run_tests.status, "ok");
    assert_eq!(run_tests.results.len(), 1);
    assert!(matches!(
        &run_tests.results[0],
        GraphNodePayload::Symbol(node) if node.qualified_name == "src/mod.test.ts:test:2"
    ));
    assert_eq!(helper_tests.status, "ok");
    assert!(helper_tests.results.is_empty());
}

#[test]
fn query_current_graph_qualifies_python_class_methods() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.py"),
        "class Service:\n    def run(self):\n        return helper()\n\n\ndef helper():\n    return 1\n",
    )
    .unwrap();

    let children =
        query_current_graph(root, "src/service.py", "children_of", ReviewBuildMode::Auto);
    let callees = query_current_graph(
        root,
        "src/service.py:Service.run",
        "callees_of",
        ReviewBuildMode::Auto,
    );

    assert_eq!(children.status, "ok");
    let child_names = qualified_names(
        &serde_json::to_value(&children).unwrap()["results"]
            .as_array()
            .cloned()
            .unwrap_or_default(),
    );
    assert!(child_names.contains(&"src/service.py:Service".to_string()));
    assert!(child_names.contains(&"src/service.py:Service.run".to_string()));
    assert!(child_names.contains(&"src/service.py:helper".to_string()));
    assert_eq!(callees.status, "ok");
    assert_eq!(callees.results.len(), 1);
    assert!(matches!(
        &callees.results[0],
        GraphNodePayload::Symbol(node) if node.qualified_name == "src/service.py:helper"
    ));
}

fn python_entrix_adapter_json(repo_root: &Path, action: &str, args: &[&str]) -> Option<Value> {
    python_entrix_json("adapter", repo_root, action, args)
}

fn python_entrix_runner_json(repo_root: &Path, action: &str, args: &[&str]) -> Option<Value> {
    python_entrix_json("runner", repo_root, action, args)
}

fn python_entrix_json(kind: &str, repo_root: &Path, action: &str, args: &[&str]) -> Option<Value> {
    if !Path::new("/Users/phodal/ai/entrix").exists() {
        return None;
    }

    let script = r#"
import json, sys
from pathlib import Path

sys.path.insert(0, '/Users/phodal/ai/entrix')

try:
    if sys.argv[1] == 'adapter':
        from entrix.structure.builtin import BuiltinGraphAdapter
        repo = Path(sys.argv[2])
        adapter = BuiltinGraphAdapter(repo)
        action = sys.argv[3]
        if action == 'analyze_file':
            payload = adapter.analyze_file(sys.argv[4])
        elif action == 'query':
            adapter.build_or_update(full=True)
            payload = adapter.query(sys.argv[4], sys.argv[5])
        elif action == 'build_graph':
            payload = adapter.build_or_update(full=True)
        else:
            raise SystemExit(2)
    else:
        from entrix.runners.graph import GraphRunner
        repo = Path(sys.argv[2])
        runner = GraphRunner(repo)
        action = sys.argv[3]
        if action == 'review_context':
            payload = runner.review_context([sys.argv[4]], include_source=False, build_mode='auto')
        elif action == 'test_radius':
            payload = runner.analyze_test_radius([sys.argv[4]], build_mode='auto')
        elif action == 'analyze_impact':
            payload = runner.analyze_impact(
                [arg for arg in sys.argv[4:]]
            )
        elif action == 'history':
            payload = runner.analyze_history()
        elif action == 'build_graph':
            payload = runner.build_graph(build_mode='auto')
        elif action == 'stats':
            payload = runner.stats()
        else:
            raise SystemExit(2)
except Exception:
    raise SystemExit(3)

print(json.dumps(payload, ensure_ascii=False))
"#;

    let mut command = Command::new("python3");
    command.arg("-c").arg(script).arg(kind).arg(repo_root);
    command.arg(action);
    for arg in args {
        command.arg(arg);
    }
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

fn qualified_names(items: &[Value]) -> Vec<String> {
    let mut values = items
        .iter()
        .filter_map(|item| item.get("qualified_name").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    values.sort();
    values
}

fn edge_keys(items: &[Value]) -> Vec<(String, String, String)> {
    let mut values = items
        .iter()
        .filter_map(|item| {
            Some((
                item.get("kind")?.as_str()?.to_string(),
                item.get("source_qualified")?.as_str()?.to_string(),
                item.get("target_qualified")?.as_str()?.to_string(),
            ))
        })
        .collect::<Vec<_>>();
    values.sort();
    values
}

fn sorted_strings(items: &[Value]) -> Vec<String> {
    let mut values = items
        .iter()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    values.sort();
    values
}
