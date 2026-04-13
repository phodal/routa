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
    assert!(result
        .context
        .review_guidance
        .contains("Changes appear locally test-covered"));
}
