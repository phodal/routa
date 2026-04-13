use super::{build_review_context, ReviewBuildMode, ReviewContextOptions};
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
        edge["relation"] == "TESTED_BY"
            && edge["source"] == "src/lib.rs:run"
            && edge["target"] == "src/lib.rs:test_run"
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
        edge["relation"] == "TESTED_BY"
            && edge["target"]
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
        "src/service.test.ts:run"
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
            max_targets: 25,
        },
    );

    assert_eq!(
        result.context.impacted_files,
        vec!["src/service.test.ts".to_string()]
    );
    assert!(result.summary.contains("1 impacted nodes in 1 files"));
    assert!(result.context.graph.edges.iter().any(|edge| {
        edge["source"] == "src/service.ts:run"
            && edge["target"] == "src/service.test.ts:run"
            && edge["relation"] == "TESTED_BY"
    }));
}
