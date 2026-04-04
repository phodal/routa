//! Architecture Rule DSL parser, validator, and execution-plan emitter.
//!
//! Reads `*.archdsl.yaml` files and produces a structured report usable by
//! the `fitness arch-dsl-poc` subcommand.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

// ──────────────────────────── DSL types ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderRef {
    pub folder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RuleConstraint {
    MustNotDependOn { target: FolderRef },
    NoCycles,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchDslRule {
    pub id: String,
    pub title: String,
    pub suite: String,
    pub source: FolderRef,
    pub constraint: RuleConstraint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchDslFile {
    pub version: String,
    pub name: String,
    pub description: String,
    pub rules: Vec<ArchDslRule>,
}

// ──────────────────────────── Validation ─────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationError {
    pub field: String,
    pub message: String,
}

fn validate_dsl(dsl: &ArchDslFile) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    if dsl.version != "1" {
        errors.push(ValidationError {
            field: "version".to_string(),
            message: format!("version must be \"1\", got \"{}\"", dsl.version),
        });
    }

    if dsl.name.is_empty() {
        errors.push(ValidationError {
            field: "name".to_string(),
            message: "name must be a non-empty string".to_string(),
        });
    }

    let mut seen_ids: HashSet<&str> = HashSet::new();

    for (i, rule) in dsl.rules.iter().enumerate() {
        let prefix = format!("rules[{i}]");

        if rule.id.is_empty() {
            errors.push(ValidationError {
                field: format!("{prefix}.id"),
                message: "id must be a non-empty string".to_string(),
            });
        } else if !seen_ids.insert(rule.id.as_str()) {
            errors.push(ValidationError {
                field: format!("{prefix}.id"),
                message: format!("duplicate id: {}", rule.id),
            });
        }

        if rule.title.is_empty() {
            errors.push(ValidationError {
                field: format!("{prefix}.title"),
                message: "title must be a non-empty string".to_string(),
            });
        }

        if rule.suite != "boundaries" && rule.suite != "cycles" {
            errors.push(ValidationError {
                field: format!("{prefix}.suite"),
                message: format!(
                    "suite must be \"boundaries\" or \"cycles\", got \"{}\"",
                    rule.suite
                ),
            });
        }

        if rule.source.folder.is_empty() {
            errors.push(ValidationError {
                field: format!("{prefix}.source.folder"),
                message: "source.folder must be a non-empty string".to_string(),
            });
        }
    }

    errors
}

// ──────────────────────────── Execution plan ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionStep {
    pub rule_id: String,
    pub suite: String,
    pub description: String,
    /// Whether the source folder exists on disk.
    pub source_exists: bool,
    /// Whether the target folder exists (only for boundary rules).
    pub target_exists: Option<bool>,
}

fn build_execution_plan(dsl: &ArchDslFile, repo_root: &Path) -> Vec<ExecutionStep> {
    dsl.rules
        .iter()
        .map(|rule| {
            let source_exists = repo_root.join(&rule.source.folder).exists();

            let (description, target_exists) = match &rule.constraint {
                RuleConstraint::MustNotDependOn { target } => {
                    let exists = repo_root.join(&target.folder).exists();
                    let desc = format!(
                        "\"{}\" must not depend on \"{}\"",
                        rule.source.folder, target.folder
                    );
                    (desc, Some(exists))
                }
                RuleConstraint::NoCycles => {
                    let desc = format!(
                        "\"{}\" must have no circular dependencies",
                        rule.source.folder
                    );
                    (desc, None)
                }
            };

            ExecutionStep {
                rule_id: rule.id.clone(),
                suite: rule.suite.clone(),
                description,
                source_exists,
                target_exists,
            }
        })
        .collect()
}

// ──────────────────────────── Report ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchDslReport {
    pub generated_at: String,
    pub dsl_file: String,
    pub name: String,
    pub description: String,
    pub valid: bool,
    pub rule_count: usize,
    pub execution_plan: Vec<ExecutionStep>,
    pub errors: Vec<ValidationError>,
}

pub fn run(dsl_path: &Path, repo_root: &Path) -> ArchDslReport {
    let generated_at = chrono::Utc::now().to_rfc3339();
    let dsl_file = dsl_path.to_string_lossy().to_string();

    let content = match fs::read_to_string(dsl_path) {
        Ok(c) => c,
        Err(err) => {
            return ArchDslReport {
                generated_at,
                dsl_file,
                name: String::new(),
                description: String::new(),
                valid: false,
                rule_count: 0,
                execution_plan: vec![],
                errors: vec![ValidationError {
                    field: "file".to_string(),
                    message: format!("cannot read DSL file: {err}"),
                }],
            };
        }
    };

    let dsl: ArchDslFile = match serde_yaml::from_str(&content) {
        Ok(d) => d,
        Err(err) => {
            return ArchDslReport {
                generated_at,
                dsl_file,
                name: String::new(),
                description: String::new(),
                valid: false,
                rule_count: 0,
                execution_plan: vec![],
                errors: vec![ValidationError {
                    field: "file".to_string(),
                    message: format!("YAML parse error: {err}"),
                }],
            };
        }
    };

    let errors = validate_dsl(&dsl);

    if !errors.is_empty() {
        return ArchDslReport {
            generated_at,
            dsl_file,
            name: dsl.name,
            description: dsl.description,
            valid: false,
            rule_count: 0,
            execution_plan: vec![],
            errors,
        };
    }

    let execution_plan = build_execution_plan(&dsl, repo_root);
    let rule_count = dsl.rules.len();

    ArchDslReport {
        generated_at,
        dsl_file,
        name: dsl.name,
        description: dsl.description,
        valid: true,
        rule_count,
        execution_plan,
        errors: vec![],
    }
}

// ──────────────────────────── Tests ──────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn make_boundary_rule() -> ArchDslRule {
        ArchDslRule {
            id: "core-no-server".to_string(),
            title: "Core no server".to_string(),
            suite: "boundaries".to_string(),
            source: FolderRef {
                folder: "crates/routa-core/src".to_string(),
            },
            constraint: RuleConstraint::MustNotDependOn {
                target: FolderRef {
                    folder: "crates/routa-server/src".to_string(),
                },
            },
        }
    }

    fn make_cycle_rule() -> ArchDslRule {
        ArchDslRule {
            id: "no-cycles-core".to_string(),
            title: "No cycles in core".to_string(),
            suite: "cycles".to_string(),
            source: FolderRef {
                folder: "src/core".to_string(),
            },
            constraint: RuleConstraint::NoCycles,
        }
    }

    fn valid_dsl() -> ArchDslFile {
        ArchDslFile {
            version: "1".to_string(),
            name: "test".to_string(),
            description: "test".to_string(),
            rules: vec![make_boundary_rule(), make_cycle_rule()],
        }
    }

    #[test]
    fn arch_dsl_poc_valid_dsl_has_no_errors() {
        let dsl = valid_dsl();
        let errors = validate_dsl(&dsl);
        assert!(errors.is_empty(), "unexpected errors: {errors:?}");
    }

    #[test]
    fn arch_dsl_poc_wrong_version_is_rejected() {
        let mut dsl = valid_dsl();
        dsl.version = "2".to_string();
        let errors = validate_dsl(&dsl);
        assert!(
            errors.iter().any(|e| e.field == "version"),
            "expected version error, got: {errors:?}"
        );
    }

    #[test]
    fn arch_dsl_poc_duplicate_ids_are_rejected() {
        let mut dsl = valid_dsl();
        let dup = make_boundary_rule();
        dsl.rules.push(dup); // id "core-no-server" already present
        let errors = validate_dsl(&dsl);
        assert!(
            errors.iter().any(|e| e.message.contains("duplicate")),
            "expected duplicate id error, got: {errors:?}"
        );
    }

    #[test]
    fn arch_dsl_poc_invalid_suite_is_rejected() {
        let mut dsl = valid_dsl();
        dsl.rules[0].suite = "unknown".to_string();
        let errors = validate_dsl(&dsl);
        assert!(
            errors.iter().any(|e| e.field.contains("suite")),
            "expected suite error, got: {errors:?}"
        );
    }

    #[test]
    fn arch_dsl_poc_runs_from_canonical_yaml() {
        // Locate the canonical DSL relative to the workspace root.
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace_root = manifest
            .parent()
            .and_then(std::path::Path::parent)
            .expect("workspace root");
        let dsl_path = workspace_root.join("architecture/rules/backend-core.archdsl.yaml");
        let report = run(&dsl_path, workspace_root);
        assert!(report.valid, "expected valid report, errors: {:?}", report.errors);
        assert!(report.rule_count > 0, "expected at least one rule");
    }

    #[test]
    fn arch_dsl_poc_missing_file_returns_invalid() {
        let report = run(
            std::path::Path::new("/nonexistent/rules.archdsl.yaml"),
            std::path::Path::new("/tmp"),
        );
        assert!(!report.valid);
        assert!(!report.errors.is_empty());
    }

    #[test]
    fn arch_dsl_poc_execution_plan_includes_source_exists() {
        let mut tmp = NamedTempFile::new().expect("tempfile");
        let yaml = r#"
version: "1"
name: test
description: test
rules:
  - id: boundary-rule
    title: Test boundary
    suite: boundaries
    source:
      folder: "crates/routa-core/src"
    constraint:
      type: must_not_depend_on
      target:
        folder: "crates/routa-server/src"
"#;
        tmp.write_all(yaml.as_bytes()).unwrap();
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace_root = manifest.parent().and_then(std::path::Path::parent).unwrap();
        let report = run(tmp.path(), workspace_root);
        assert!(report.valid, "errors: {:?}", report.errors);
        assert_eq!(report.execution_plan.len(), 1);
        // The crates/routa-core/src folder should exist in the real workspace.
        assert!(report.execution_plan[0].source_exists);
    }
}
