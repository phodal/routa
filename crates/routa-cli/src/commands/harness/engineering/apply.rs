use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::process::Command;

use chrono::Utc;
use serde::Serialize;

use super::{
    format_script_invocation, record_evolution_outcome, run_ratchet_loop, ApplyOutcome,
    EvolutionContext, HarnessEngineeringOptions, HarnessEngineeringPatchCandidate,
    HarnessEngineeringRatchetResult, HarnessEngineeringVerificationResult,
    HarnessEngineeringVerificationStep,
};

#[derive(Debug, Serialize)]
pub(super) struct Snapshot {
    timestamp: String,
    files: BTreeMap<String, SnapshotFileState>,
}

#[derive(Debug, Serialize)]
struct SnapshotFileState {
    existed: bool,
    content: Option<String>,
}

pub(super) fn create_snapshot(
    repo_root: &Path,
    patches: &[HarnessEngineeringPatchCandidate],
) -> Result<Snapshot, String> {
    let mut files = BTreeMap::new();

    for patch in patches {
        for target in &patch.targets {
            let path = repo_root.join(target);
            let existed = path.exists();
            let content = if existed {
                Some(
                    fs::read_to_string(&path)
                        .map_err(|e| format!("Failed to read {target}: {e}"))?,
                )
            } else {
                None
            };
            files.insert(target.clone(), SnapshotFileState { existed, content });
        }
    }

    Ok(Snapshot {
        timestamp: Utc::now().to_rfc3339(),
        files,
    })
}

pub(super) fn rollback_snapshot(repo_root: &Path, snapshot: &Snapshot) -> Result<(), String> {
    for (path_str, state) in &snapshot.files {
        let path = repo_root.join(path_str);
        if state.existed {
            let content = state.content.as_deref().ok_or_else(|| {
                format!("Snapshot missing original contents for {}", path.display())
            })?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!("Failed to create directory {}: {}", parent.display(), e)
                })?;
            }
            fs::write(&path, content).map_err(|e| format!("Failed to rollback {path_str}: {e}"))?;
        } else if path.exists() {
            if path.is_dir() {
                fs::remove_dir_all(&path)
                    .map_err(|e| format!("Failed to remove {path_str} during rollback: {e}"))?;
            } else {
                fs::remove_file(&path)
                    .map_err(|e| format!("Failed to remove {path_str} during rollback: {e}"))?;
            }
            remove_empty_parent_dirs(repo_root, path.parent())?;
        }
    }
    Ok(())
}

fn remove_empty_parent_dirs(repo_root: &Path, mut current: Option<&Path>) -> Result<(), String> {
    while let Some(path) = current {
        if path == repo_root {
            break;
        }

        match fs::remove_dir(path) {
            Ok(()) => current = path.parent(),
            Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => break,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                current = path.parent();
            }
            Err(error) => {
                return Err(format!(
                    "Failed to clean up rollback directory {}: {}",
                    path.display(),
                    error
                ));
            }
        }
    }

    Ok(())
}

pub(super) fn emit_apply_progress(options: &HarnessEngineeringOptions, message: impl AsRef<str>) {
    if options.json_output {
        eprintln!("{}", message.as_ref());
    } else {
        println!("{}", message.as_ref());
    }
}

fn build_verification_output_excerpt(stdout: &str, stderr: &str) -> Option<String> {
    let stdout = stdout.trim();
    let stderr = stderr.trim();
    if stdout.is_empty() && stderr.is_empty() {
        return None;
    }

    let mut combined = String::new();
    if !stdout.is_empty() {
        combined.push_str(stdout);
    }
    if !stderr.is_empty() {
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(stderr);
    }

    let excerpt = combined
        .lines()
        .take(8)
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(600)
        .collect::<String>();
    Some(excerpt)
}

pub(super) fn run_verification_plan(
    repo_root: &Path,
    steps: &[HarnessEngineeringVerificationStep],
    options: &HarnessEngineeringOptions,
) -> Result<Vec<HarnessEngineeringVerificationResult>, String> {
    if steps.is_empty() {
        return Ok(Vec::new());
    }

    emit_apply_progress(
        options,
        format!("🧪 Running {} verification steps...", steps.len()),
    );

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut results = Vec::with_capacity(steps.len());

    for step in steps {
        emit_apply_progress(options, format!("  → {}", step.label));
        let output = Command::new(&shell)
            .arg("-lc")
            .arg(&step.command)
            .current_dir(repo_root)
            .env("PATH", routa_core::shell_env::full_path())
            .output()
            .map_err(|error| {
                format!(
                    "Failed to execute verification step '{}' with shell {}: {}",
                    step.label, shell, error
                )
            })?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let success = output.status.success();
        let result = HarnessEngineeringVerificationResult {
            label: step.label.clone(),
            command: step.command.clone(),
            proves: step.proves.clone(),
            success,
            exit_code: output.status.code(),
            output_excerpt: build_verification_output_excerpt(&stdout, &stderr),
        };

        if success {
            emit_apply_progress(options, format!("    ✓ {}", step.proves));
            results.push(result);
            continue;
        }

        let failure_detail = result
            .output_excerpt
            .clone()
            .unwrap_or_else(|| "no output captured".to_string());
        results.push(result);
        return Err(format!(
            "Verification failed at '{}': {}",
            step.label, failure_detail
        ));
    }

    Ok(results)
}

pub(super) fn apply_patches(
    repo_root: &Path,
    patches: &[HarnessEngineeringPatchCandidate],
    verification_plan: &[HarnessEngineeringVerificationStep],
    options: &HarnessEngineeringOptions,
    evolution_context: Option<&EvolutionContext>,
) -> Result<ApplyOutcome, String> {
    let low_risk: Vec<_> = patches.iter().filter(|p| p.risk == "low").collect();
    let medium_risk: Vec<_> = patches.iter().filter(|p| p.risk == "medium").collect();
    let high_risk: Vec<_> = patches.iter().filter(|p| p.risk == "high").collect();

    emit_apply_progress(options, "\n🔧 Harness Evolution - Apply Mode");
    emit_apply_progress(options, "─────────────────────────────────");
    emit_apply_progress(
        options,
        format!("  Low risk patches:    {}", low_risk.len()),
    );
    emit_apply_progress(
        options,
        format!("  Medium risk patches: {}", medium_risk.len()),
    );
    emit_apply_progress(
        options,
        format!("  High risk patches:   {}", high_risk.len()),
    );
    emit_apply_progress(options, "");

    let mut selected_for_apply: Vec<&HarnessEngineeringPatchCandidate> = low_risk.clone();
    let risky_patches_refs: Vec<&HarnessEngineeringPatchCandidate> = medium_risk
        .iter()
        .chain(high_risk.iter())
        .copied()
        .collect();

    if !risky_patches_refs.is_empty() {
        if options.force {
            emit_apply_progress(
                options,
                format!(
                    "⚠️  Applying {} medium/high-risk patches with --force...",
                    risky_patches_refs.len()
                ),
            );
            selected_for_apply.extend(risky_patches_refs.iter().copied());
        } else {
            emit_apply_progress(
                options,
                format!(
                    "⏸  {} medium/high-risk patches require review",
                    risky_patches_refs.len()
                ),
            );
            emit_apply_progress(
                options,
                "   Run with --force to apply them (use with caution)",
            );
            for patch in &risky_patches_refs {
                emit_apply_progress(options, format!("   - [{}] {}", patch.risk, patch.title));
            }
        }
    }

    if selected_for_apply.is_empty() {
        return Ok(ApplyOutcome {
            verification_results: Vec::new(),
            ratchet: HarnessEngineeringRatchetResult {
                enforced: false,
                regressed: false,
                profiles: Vec::new(),
            },
        });
    }

    let selected_owned = selected_for_apply
        .iter()
        .map(|patch| (*patch).clone())
        .collect::<Vec<_>>();
    let snapshot = create_snapshot(repo_root, &selected_owned)?;

    if !low_risk.is_empty() {
        emit_apply_progress(
            options,
            format!(
                "✓ Applying {} low-risk patches automatically...",
                low_risk.len()
            ),
        );
        if let Err(error) = apply_patch_batch(repo_root, &low_risk, options) {
            eprintln!("  ✗ Failed to apply low-risk patches: {error}");
            eprintln!("  ↻ Rolling back changes...");
            rollback_snapshot(repo_root, &snapshot)?;
            if let Err(history_error) =
                record_evolution_outcome(repo_root, &[], &selected_for_apply, evolution_context)
            {
                eprintln!("  ⚠️  Warning: Failed to record evolution history: {history_error}");
            }
            return Err(format!("Low-risk patch application failed: {error}"));
        }
        emit_apply_progress(options, "  ✓ Low-risk patches applied successfully");
    }

    if options.force && !risky_patches_refs.is_empty() {
        if let Err(error) = apply_patch_batch(repo_root, &risky_patches_refs, options) {
            eprintln!("  ✗ Failed: {error}");
            eprintln!("  ↻ Rolling back...");
            rollback_snapshot(repo_root, &snapshot)?;
            if let Err(history_error) =
                record_evolution_outcome(repo_root, &[], &selected_for_apply, evolution_context)
            {
                eprintln!("  ⚠️  Warning: Failed to record evolution history: {history_error}");
            }
            return Err(error);
        }
        emit_apply_progress(options, "  ✓ Medium/high-risk patches applied");
    }

    let verification_results = match run_verification_plan(repo_root, verification_plan, options) {
        Ok(results) => results,
        Err(error) => {
            eprintln!("  ✗ Verification failed: {error}");
            eprintln!("  ↻ Rolling back verified changes...");
            rollback_snapshot(repo_root, &snapshot)?;
            if let Err(history_error) =
                record_evolution_outcome(repo_root, &[], &selected_for_apply, evolution_context)
            {
                eprintln!("  ⚠️  Warning: Failed to record evolution history: {history_error}");
            }
            return Err(error);
        }
    };

    let ratchet = match run_ratchet_loop(repo_root, options) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("  ✗ Ratchet failed: {error}");
            eprintln!("  ↻ Rolling back verified changes...");
            rollback_snapshot(repo_root, &snapshot)?;
            if let Err(history_error) =
                record_evolution_outcome(repo_root, &[], &selected_for_apply, evolution_context)
            {
                eprintln!("  ⚠️  Warning: Failed to record evolution history: {history_error}");
            }
            return Err(error);
        }
    };

    if let Err(error) =
        record_evolution_outcome(repo_root, &selected_for_apply, &[], evolution_context)
    {
        eprintln!("  ⚠️  Warning: Failed to record evolution history: {error}");
    }

    Ok(ApplyOutcome {
        verification_results,
        ratchet,
    })
}

fn apply_patch_batch(
    repo_root: &Path,
    patches: &[&HarnessEngineeringPatchCandidate],
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    for patch in patches {
        apply_single_patch(repo_root, patch, options)?;
    }
    Ok(())
}

fn apply_single_patch(
    repo_root: &Path,
    patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    match patch.id.as_str() {
        "bootstrap.synthesize_build_yml" => synthesize_build_yml(repo_root, patch, options)?,
        "bootstrap.synthesize_test_yml" => synthesize_test_yml(repo_root, patch, options)?,
        "patch.normalize_automation_target" => {
            normalize_automation_target(repo_root, patch, options)?
        }
        "patch.create_codeowners" => create_codeowners(repo_root, patch, options)?,
        "patch.create_dependabot" => create_dependabot(repo_root, patch, options)?,
        "patch.update_coverage_threshold" => update_coverage_threshold(repo_root, patch, options)?,
        "patch.create_operational_docs" => create_operational_docs(repo_root, patch, options)?,
        _ => return Err(format!("Patch {} is not implemented", patch.id)),
    }
    Ok(())
}

fn synthesize_build_yml(
    repo_root: &Path,
    patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let harness_dir = repo_root.join("docs/harness");
    fs::create_dir_all(&harness_dir).map_err(|e| format!("Failed to create docs/harness: {e}"))?;

    let build_yml = harness_dir.join("build.yml");
    let build_script_name = patch.script_name.as_deref().unwrap_or("build");
    let build_command = format_script_invocation(
        repo_root,
        build_script_name,
        patch.script_command.as_deref(),
    );
    let build_pattern = regex::escape(build_script_name);

    let content = format!(
        r#"schema: harness-surface-v1
surface: build
title: Build feedback
summary: Auto-generated bootstrap surface anchored to the detected `{build_script_name}` script.
overview:
  - id: repository-shape
    label: Repository shape
    source: files
    paths:
      - package.json
      - pnpm-lock.yaml
      - package-lock.json
      - yarn.lock
      - Cargo.toml
    limit: 5
  - id: outputs
    label: Outputs
    source: files
    paths:
      - dist
      - build
      - out
      - target
    limit: 4
entrypointGroups:
  - id: bootstrap-build
    label: Build flow
    category: build
    scriptNamePatterns:
      - "^{build_pattern}$"
# detectedCommand: {build_command}
"#
    );

    fs::write(&build_yml, content).map_err(|e| format!("Failed to write build.yml: {e}"))?;
    emit_apply_progress(options, "  ✓ Created docs/harness/build.yml");
    Ok(())
}

fn synthesize_test_yml(
    repo_root: &Path,
    patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let harness_dir = repo_root.join("docs/harness");
    fs::create_dir_all(&harness_dir).map_err(|e| format!("Failed to create docs/harness: {e}"))?;

    let test_yml = harness_dir.join("test.yml");
    let test_script_name = patch.script_name.as_deref().unwrap_or("test");
    let test_command =
        format_script_invocation(repo_root, test_script_name, patch.script_command.as_deref());
    let test_pattern = regex::escape(test_script_name);

    let content = format!(
        r#"schema: harness-surface-v1
surface: test
title: Test feedback
summary: Auto-generated bootstrap surface anchored to the detected `{test_script_name}` script.
overview:
  - id: repository-shape
    label: Repository shape
    source: files
    paths:
      - package.json
      - pnpm-lock.yaml
      - package-lock.json
      - yarn.lock
      - Cargo.toml
    limit: 5
  - id: artifacts
    label: Artifacts
    source: files
    paths:
      - coverage
      - test-results
      - docs/fitness/reports
    limit: 4
entrypointGroups:
  - id: bootstrap-test
    label: Test flow
    category: unit
    scriptNamePatterns:
      - "^{test_pattern}$"
# detectedCommand: {test_command}
"#
    );

    fs::write(&test_yml, content).map_err(|e| format!("Failed to write test.yml: {e}"))?;
    emit_apply_progress(options, "  ✓ Created docs/harness/test.yml");
    Ok(())
}

fn normalize_automation_target(
    repo_root: &Path,
    _patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let automations_path = repo_root.join("docs/harness/automations.yml");

    if !automations_path.exists() {
        return Err("docs/harness/automations.yml not found".to_string());
    }

    let content = fs::read_to_string(&automations_path)
        .map_err(|e| format!("Failed to read automations.yml: {e}"))?;

    let fixed_content = content.replace(
        "    target:\n      type: specialist\n      ref: harness-test",
        "    target:\n      type: specialist\n      ref: harness-fluency",
    );

    if fixed_content == content {
        emit_apply_progress(options, "  ℹ️  No changes needed in automations.yml");
        return Ok(());
    }

    fs::write(&automations_path, fixed_content)
        .map_err(|e| format!("Failed to write automations.yml: {e}"))?;

    emit_apply_progress(
        options,
        "  ✓ Normalized automation target: weekly-harness-fluency now points to harness-fluency",
    );

    Ok(())
}

fn create_codeowners(
    repo_root: &Path,
    _patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let github_dir = repo_root.join(".github");
    fs::create_dir_all(&github_dir)
        .map_err(|e| format!("Failed to create .github directory: {e}"))?;

    let codeowners_path = github_dir.join("CODEOWNERS");

    if codeowners_path.exists() {
        emit_apply_progress(options, "  ℹ️  CODEOWNERS already exists");
        return Ok(());
    }

    let content = generate_codeowners_content(repo_root)?;
    fs::write(&codeowners_path, content).map_err(|e| format!("Failed to write CODEOWNERS: {e}"))?;

    emit_apply_progress(
        options,
        "  ✓ Created .github/CODEOWNERS with automatic reviewer assignments",
    );

    Ok(())
}

fn generate_codeowners_content(repo_root: &Path) -> Result<String, String> {
    let output = Command::new("git")
        .args(["log", "--format=%ae", "--all"])
        .current_dir(repo_root)
        .output();

    let primary_owner = if let Ok(output) = output {
        let emails = String::from_utf8_lossy(&output.stdout);
        let mut email_counts: BTreeMap<String, usize> = BTreeMap::new();
        for email in emails.lines() {
            *email_counts.entry(email.to_string()).or_insert(0) += 1;
        }
        email_counts
            .into_iter()
            .max_by_key(|(_, count)| *count)
            .map(|(email, _)| email)
            .unwrap_or_else(|| "@phodal".to_string())
    } else {
        "@phodal".to_string()
    };

    Ok(format!(
        r#"# CODEOWNERS - Automatic reviewer assignment
# Auto-generated by routa harness evolve --apply

# Global owner
* {primary_owner}

# Critical paths require review
/docs/fitness/ {primary_owner}
/docs/harness/ {primary_owner}
/resources/specialists/ {primary_owner}

# Infrastructure
/.github/ {primary_owner}
/crates/routa-core/ {primary_owner}
"#
    ))
}

fn create_dependabot(
    repo_root: &Path,
    _patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let github_dir = repo_root.join(".github");
    fs::create_dir_all(&github_dir)
        .map_err(|e| format!("Failed to create .github directory: {e}"))?;

    let dependabot_path = github_dir.join("dependabot.yml");

    if dependabot_path.exists() {
        emit_apply_progress(options, "  ℹ️  dependabot.yml already exists");
        return Ok(());
    }

    let has_cargo = repo_root.join("Cargo.toml").exists();
    let has_npm = repo_root.join("package.json").exists();
    let has_github_actions = repo_root.join(".github/workflows").exists();

    let mut ecosystems = Vec::new();

    if has_cargo {
        ecosystems.push(
            r#"  - package-ecosystem: "cargo"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10"#,
        );
    }

    if has_npm {
        ecosystems.push(
            r#"  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10"#,
        );
    }

    if has_github_actions {
        ecosystems.push(
            r#"  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly""#,
        );
    }

    let content = format!(
        r#"# Dependabot configuration - Automatic dependency updates
# Auto-generated by routa harness evolve --apply

version: 2
updates:
{}
"#,
        ecosystems.join("\n")
    );

    fs::write(&dependabot_path, content)
        .map_err(|e| format!("Failed to write dependabot.yml: {e}"))?;

    let message = format!(
        "  ✓ Created .github/dependabot.yml with {} ecosystem(s)",
        ecosystems.len()
    );
    emit_apply_progress(options, &message);

    Ok(())
}

fn update_coverage_threshold(
    repo_root: &Path,
    _patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let test_yml_path = repo_root.join("docs/harness/test.yml");

    if !test_yml_path.exists() {
        return Err("docs/harness/test.yml not found".to_string());
    }

    let content =
        fs::read_to_string(&test_yml_path).map_err(|e| format!("Failed to read test.yml: {e}"))?;

    if content.contains("coverage:") {
        emit_apply_progress(options, "  ℹ️  Coverage tracking already configured");
        return Ok(());
    }

    let coverage_section = r#"
# Coverage tracking - automatically added by harness evolution
coverage:
  enabled: true
  threshold:
    lines: 0      # Will ratchet up as coverage improves
    branches: 0
    functions: 0
    statements: 0
  report_dir: coverage
"#;

    let updated_content = format!("{}{}", content.trim_end(), coverage_section);

    fs::write(&test_yml_path, updated_content)
        .map_err(|e| format!("Failed to write test.yml: {e}"))?;

    emit_apply_progress(
        options,
        "  ✓ Added coverage tracking to docs/harness/test.yml (threshold: 0%, ready for ratcheting)",
    );

    Ok(())
}

fn create_operational_docs(
    repo_root: &Path,
    _patch: &HarnessEngineeringPatchCandidate,
    options: &HarnessEngineeringOptions,
) -> Result<(), String> {
    let operational_dir = repo_root.join("docs/operational");

    if !operational_dir.exists() {
        fs::create_dir_all(&operational_dir)
            .map_err(|e| format!("Failed to create operational dir: {e}"))?;

        let placeholder_content = r#"# Operational History

This directory tracks operational decisions, incidents, and runbooks.

## Purpose

- **Decisions**: Key operational choices and their rationale
- **Incidents**: Post-mortems and learnings
- **Runbooks**: Standard operating procedures
- **Changes**: Deployment and configuration history

## Structure

```
operational/
├── decisions/        # ADR-style operational decisions
├── incidents/        # Incident reports and post-mortems
├── runbooks/         # Step-by-step procedures
└── changes/          # Deployment and config change log
```

## Getting Started

Add operational documentation as the system evolves. Start with:

1. Create `decisions/001-initial-setup.md` for first major operational choice
2. Add runbooks for common tasks (deployment, rollback, troubleshooting)
3. Document incidents to prevent recurrence

---

*Auto-generated by routa harness evolve --apply*
"#;

        fs::write(operational_dir.join("README.md"), placeholder_content)
            .map_err(|e| format!("Failed to write operational README: {e}"))?;

        for subdir in &["decisions", "incidents", "runbooks", "changes"] {
            let dir = operational_dir.join(subdir);
            fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {subdir}: {e}"))?;
            fs::write(
                dir.join(".gitkeep"),
                "# Placeholder for operational documentation\n",
            )
            .map_err(|e| format!("Failed to write .gitkeep: {e}"))?;
        }

        emit_apply_progress(
            options,
            "  ✓ Created docs/operational with placeholder structure",
        );
    } else {
        emit_apply_progress(
            options,
            "  ℹ️  Operational documentation directory already exists",
        );
    }

    Ok(())
}
