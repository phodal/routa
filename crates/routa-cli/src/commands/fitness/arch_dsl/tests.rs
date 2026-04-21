use super::*;
use std::fs::write;
use tempfile::tempdir;

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

#[test]
fn loads_backend_core_sample_and_executes_all_backend_core_rules() {
    let repo_root = workspace_root();
    let dsl_path = repo_root.join("architecture/rules/backend-core.archdsl.yaml");

    let report = evaluate_architecture_dsl(&repo_root, &dsl_path).expect("report");

    assert_eq!(report.report_type, "architecture_dsl");
    assert_eq!(report.summary.validation_status, ValidationStatus::Pass);
    assert_eq!(report.summary.plan_status, PlanStatus::Ready);
    assert_eq!(report.summary.selector_count, 4);
    assert_eq!(report.summary.rule_count, 4);
    assert_eq!(report.summary.executable_rule_count, 4);
    assert_eq!(report.summary.unsupported_rule_count, 0);
    assert_eq!(report.summary.invalid_rule_count, 0);
    assert_eq!(report.summary.executed_rule_count, 4);
    assert_eq!(report.summary.skipped_rule_count, 0);
    assert!(report.issues.is_empty());
    assert_eq!(
        report.summary.passed_rule_count + report.summary.failed_rule_count,
        report.summary.executed_rule_count
    );
    assert_eq!(
        report.summary.execution_status,
        if report.summary.failed_rule_count > 0 {
            ExecutionStatus::Fail
        } else {
            ExecutionStatus::Pass
        }
    );
    assert!(report
        .rules
        .iter()
        .any(|rule| rule.id == "ts_backend_core_no_core_to_app" && rule.execution.is_some()));
    assert!(report
        .rules
        .iter()
        .any(|rule| rule.id == "ts_backend_core_no_cycles" && rule.execution.is_some()));

    let text = format_text_report(&report);
    assert!(text.contains("architecture dsl"));
    assert!(text.contains("ts_backend_core_no_core_to_app"));
}

#[test]
fn builds_legacy_backend_core_suite_reports() {
    let repo_root = workspace_root();
    let dsl_path = repo_root.join("architecture/rules/backend-core.archdsl.yaml");
    let report = evaluate_architecture_dsl(&repo_root, &dsl_path).expect("report");

    let boundaries = build_backend_core_suite_report(&report, &repo_root, SuiteName::Boundaries);
    assert_eq!(boundaries.rule_count, 3);
    assert_eq!(boundaries.results.len(), 3);
    assert_eq!(
        boundaries.failed_rule_count,
        boundaries
            .results
            .iter()
            .filter(|result| result.status == BackendCoreRuleStatus::Fail)
            .count()
    );
    assert_eq!(
        boundaries.summary_status,
        if boundaries.failed_rule_count > 0 {
            BackendCoreSummaryStatus::Fail
        } else {
            BackendCoreSummaryStatus::Pass
        }
    );
    assert!(!should_fail_backend_core_suite_command(&boundaries)
        || boundaries.summary_status == BackendCoreSummaryStatus::Fail);
    assert_eq!(
        boundaries.arch_unit_source.as_deref(),
        Some("routa-cli fitness arch-dsl")
    );
    assert_eq!(
        boundaries
            .results
            .iter()
            .map(|result| result.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "ts_backend_core_no_core_to_app",
            "ts_backend_core_no_core_to_client",
            "ts_backend_core_no_api_to_client",
        ]
    );

    let cycles = build_backend_core_suite_report(&report, &repo_root, SuiteName::Cycles);
    assert_eq!(cycles.rule_count, 1);
    assert_eq!(cycles.results.len(), 1);
    assert_eq!(cycles.results[0].id, "ts_backend_core_no_cycles");
    assert_eq!(
        cycles.failed_rule_count,
        cycles
            .results
            .iter()
            .filter(|result| result.status == BackendCoreRuleStatus::Fail)
            .count()
    );
    assert_eq!(
        cycles.summary_status,
        if cycles.failed_rule_count > 0 {
            BackendCoreSummaryStatus::Fail
        } else {
            BackendCoreSummaryStatus::Pass
        }
    );
    assert_eq!(
        should_fail_backend_core_suite_command(&cycles),
        cycles.summary_status == BackendCoreSummaryStatus::Fail
    );
}

#[test]
fn fails_backend_core_suite_reports_when_dsl_validation_blocks_execution() {
    let repo = tempdir().expect("temp dir");
    let dsl_path = repo.path().join("invalid.archdsl.yaml");
    write(
        &dsl_path,
        r#"schema: routa.archdsl/v2
model:
  id: invalid
  title: Invalid
selectors: {}
rules: []
"#,
    )
    .expect("write dsl");

    let report = evaluate_architecture_dsl(repo.path(), &dsl_path).expect("report");
    assert_eq!(report.summary.validation_status, ValidationStatus::Fail);

    let suite_report = build_backend_core_suite_report(&report, repo.path(), SuiteName::Boundaries);
    assert_eq!(suite_report.summary_status, BackendCoreSummaryStatus::Fail);
    assert_eq!(suite_report.rule_count, 0);
    assert!(should_fail_backend_core_suite_command(&suite_report));
    assert!(suite_report
        .notes
        .iter()
        .any(|note| note.contains("schema") || note.contains("selector") || note.contains("rule")));
}

#[test]
fn rejects_missing_selector_references() {
    let repo = tempdir().expect("temp dir");
    let dsl_path = repo.path().join("broken.archdsl.yaml");
    write(
        &dsl_path,
        r#"schema: routa.archdsl/v1
model:
  id: broken
  title: Broken
selectors:
  core_ts:
    kind: files
    language: typescript
    include: [src/core/**]
rules:
  - id: broken_rule
    title: Broken rule
    kind: dependency
    suite: boundaries
    severity: advisory
    from: core_ts
    relation: must_not_depend_on
    to: missing_selector
"#,
    )
    .expect("write dsl");

    let report = evaluate_architecture_dsl(repo.path(), &dsl_path).expect("report");
    assert_eq!(report.summary.validation_status, ValidationStatus::Fail);
    assert_eq!(report.summary.plan_status, PlanStatus::Blocked);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "rule.selector.missing"));
    assert!(report
        .rules
        .iter()
        .any(|rule| rule.id == "broken_rule" && rule.status == RulePlanStatus::Invalid));
}

#[test]
fn executes_graph_backed_rust_boundary_rules() {
    let repo = tempdir().expect("temp dir");
    write(
        repo.path().join("Cargo.toml"),
        r#"[workspace]
members = ["crates/*"]
"#,
    )
    .expect("workspace");
    fs::create_dir_all(repo.path().join("crates/alpha/src")).expect("alpha src");
    fs::create_dir_all(repo.path().join("crates/beta/src")).expect("beta src");
    write(
        repo.path().join("crates/alpha/Cargo.toml"),
        r#"[package]
name = "alpha"
version = "0.1.0"
edition = "2021"
"#,
    )
    .expect("alpha manifest");
    write(
        repo.path().join("crates/alpha/src/lib.rs"),
        "use beta::service::run;\npub fn call() { run(); }\n",
    )
    .expect("alpha lib");
    write(
        repo.path().join("crates/beta/Cargo.toml"),
        r#"[package]
name = "beta"
version = "0.1.0"
edition = "2021"
"#,
    )
    .expect("beta manifest");
    write(
        repo.path().join("crates/beta/src/lib.rs"),
        "pub mod service;\n",
    )
    .expect("beta lib");
    write(
        repo.path().join("crates/beta/src/service.rs"),
        "pub fn run() {}\n",
    )
    .expect("beta service");

    let dsl_path = repo.path().join("rust.archdsl.yaml");
    write(
        &dsl_path,
        r#"schema: routa.archdsl/v1
model:
  id: rust_graph
  title: Rust Graph
selectors:
  alpha:
    kind: files
    language: rust
    include: [crates/alpha/**]
  beta:
    kind: files
    language: rust
    include: [crates/beta/**]
rules:
  - id: alpha_no_beta
    title: alpha must not depend on beta
    kind: dependency
    suite: boundaries
    severity: advisory
    from: alpha
    relation: must_not_depend_on
    to: beta
    engine_hints:
      - graph
"#,
    )
    .expect("dsl");

    let report = evaluate_architecture_dsl(repo.path(), &dsl_path).expect("report");
    assert_eq!(report.summary.validation_status, ValidationStatus::Pass);
    assert_eq!(report.summary.execution_status, ExecutionStatus::Fail);
    assert_eq!(report.summary.executed_rule_count, 1);
    assert_eq!(report.summary.failed_rule_count, 1);
    let execution = report.rules[0].execution.as_ref().expect("execution");
    assert_eq!(execution.status, RuleExecutionStatus::Fail);
    assert_eq!(execution.violation_count, 1);
    match &execution.violations[0] {
        ArchitectureDslViolation::Dependency { source, target, .. } => {
            assert_eq!(source, "crates/alpha/src/lib.rs");
            assert_eq!(target, "crates/beta/src/lib.rs");
        }
        violation => panic!("unexpected violation: {violation:?}"),
    }
}

#[test]
fn executes_graph_backed_rust_rules_from_defaults_root() {
    let repo = tempdir().expect("temp dir");
    write(
        repo.path().join("Cargo.toml"),
        r#"[workspace]
members = ["crates/*"]
"#,
    )
    .expect("workspace");
    fs::create_dir_all(repo.path().join("crates/alpha/src")).expect("alpha src");
    fs::create_dir_all(repo.path().join("crates/beta/src")).expect("beta src");
    write(
        repo.path().join("crates/alpha/Cargo.toml"),
        r#"[package]
name = "alpha"
version = "0.1.0"
edition = "2021"
"#,
    )
    .expect("alpha manifest");
    write(
        repo.path().join("crates/alpha/src/lib.rs"),
        "use beta::service::run;\npub fn call() { run(); }\n",
    )
    .expect("alpha lib");
    write(
        repo.path().join("crates/beta/Cargo.toml"),
        r#"[package]
name = "beta"
version = "0.1.0"
edition = "2021"
"#,
    )
    .expect("beta manifest");
    write(
        repo.path().join("crates/beta/src/lib.rs"),
        "pub mod service;\n",
    )
    .expect("beta lib");
    write(
        repo.path().join("crates/beta/src/service.rs"),
        "pub fn run() {}\n",
    )
    .expect("beta service");

    let dsl_path = repo.path().join("alpha-core.archdsl.yaml");
    write(
        &dsl_path,
        r#"schema: routa.archdsl/v1
model:
  id: alpha_graph
  title: Alpha Graph
defaults:
  root: crates/alpha
selectors:
  alpha:
    kind: files
    language: rust
    include: [crates/alpha/src/**]
  beta:
    kind: files
    language: rust
    include: [crates/beta/src/**]
rules:
  - id: alpha_no_beta
    title: alpha must not depend on beta
    kind: dependency
    suite: boundaries
    severity: advisory
    from: alpha
    relation: must_not_depend_on
    to: beta
    engine_hints:
      - graph
"#,
    )
    .expect("dsl");

    let report = evaluate_architecture_dsl(repo.path(), &dsl_path).expect("report");
    assert_eq!(report.summary.validation_status, ValidationStatus::Pass);
    assert_eq!(report.summary.execution_status, ExecutionStatus::Pass);
    assert_eq!(report.summary.executed_rule_count, 1);
    assert_eq!(report.summary.failed_rule_count, 0);
    let execution = report.rules[0].execution.as_ref().expect("execution");
    assert_eq!(execution.status, RuleExecutionStatus::Pass);
    assert_eq!(execution.violation_count, 0);
}

#[test]
fn executes_graph_backed_rust_cycle_rules() {
    let repo = tempdir().expect("temp dir");
    write(
        repo.path().join("Cargo.toml"),
        r#"[workspace]
members = ["crates/*"]
"#,
    )
    .expect("workspace");
    fs::create_dir_all(repo.path().join("crates/alpha/src")).expect("alpha src");
    write(
        repo.path().join("crates/alpha/Cargo.toml"),
        r#"[package]
name = "alpha"
version = "0.1.0"
edition = "2021"
"#,
    )
    .expect("alpha manifest");
    write(
        repo.path().join("crates/alpha/src/lib.rs"),
        "mod a;\nmod b;\npub use a::A;\npub use b::B;\n",
    )
    .expect("lib");
    write(
        repo.path().join("crates/alpha/src/a.rs"),
        "use crate::b::B;\npub struct A(pub B);\n",
    )
    .expect("a");
    write(
        repo.path().join("crates/alpha/src/b.rs"),
        "use crate::a::A;\npub struct B(pub Box<A>);\n",
    )
    .expect("b");

    let dsl_path = repo.path().join("cycle.archdsl.yaml");
    write(
        &dsl_path,
        r#"schema: routa.archdsl/v1
model:
  id: rust_cycle
  title: Rust Cycle
selectors:
  alpha:
    kind: files
    language: rust
    include: [crates/alpha/**]
rules:
  - id: alpha_acyclic
    title: alpha must be acyclic
    kind: cycle
    suite: cycles
    severity: advisory
    scope: alpha
    relation: must_be_acyclic
    engine_hints:
      - graph
"#,
    )
    .expect("dsl");

    let report = evaluate_architecture_dsl(repo.path(), &dsl_path).expect("report");
    assert_eq!(report.summary.validation_status, ValidationStatus::Pass);
    assert_eq!(report.summary.execution_status, ExecutionStatus::Fail);
    let execution = report.rules[0].execution.as_ref().expect("execution");
    assert_eq!(execution.status, RuleExecutionStatus::Fail);
    assert_eq!(execution.violation_count, 1);
    match &execution.violations[0] {
        ArchitectureDslViolation::Cycle { path } => {
            assert!(path.contains(&"crates/alpha/src/a.rs".to_string()));
            assert!(path.contains(&"crates/alpha/src/b.rs".to_string()));
        }
        violation => panic!("unexpected violation: {violation:?}"),
    }
}

#[test]
fn rejects_graph_rules_that_mix_languages() {
    let repo = tempdir().expect("temp dir");
    let dsl_path = repo.path().join("mixed.archdsl.yaml");
    write(
        &dsl_path,
        r#"schema: routa.archdsl/v1
model:
  id: mixed
  title: Mixed
selectors:
  rust_core:
    kind: files
    language: rust
    include: [crates/routa-core/**]
  ts_app:
    kind: files
    language: typescript
    include: [src/app/**]
rules:
  - id: mixed_graph_rule
    title: mixed graph rule
    kind: dependency
    suite: boundaries
    severity: advisory
    from: rust_core
    relation: must_not_depend_on
    to: ts_app
    engine_hints:
      - graph
"#,
    )
    .expect("dsl");

    let report = evaluate_architecture_dsl(repo.path(), &dsl_path).expect("report");
    assert_eq!(report.summary.validation_status, ValidationStatus::Fail);
    assert!(report.issues.iter().any(|issue| {
        issue.code == "rule.engine.graph.language_mismatch"
            && issue.message.contains("mixed_graph_rule")
    }));
}
