use glob::Pattern;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseArtifact {
    pub kind: String,
    pub path: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub arch: Option<String>,
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub size_bytes: i64,
    #[serde(default)]
    pub unpacked_size_bytes: Option<i64>,
    #[serde(default)]
    pub file_count: i64,
    #[serde(default)]
    pub sourcemap_count: i64,
    #[serde(default)]
    pub sourcemap_bytes: i64,
    #[serde(default)]
    pub entries: Vec<serde_json::Value>,
    #[serde(default)]
    pub largest_entries: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReleaseTriggerRule {
    pub name: String,
    #[serde(rename = "type")]
    pub rule_type: String,
    #[serde(default = "default_severity")]
    pub severity: String,
    #[serde(default = "default_action")]
    pub action: String,
    #[serde(default)]
    pub patterns: Vec<String>,
    #[serde(default)]
    pub apply_to: Vec<String>,
    #[serde(default)]
    pub group_by: Vec<String>,
    #[serde(default)]
    pub baseline: Option<String>,
    #[serde(default)]
    pub max_growth_percent: Option<f64>,
    #[serde(default)]
    pub min_growth_bytes: Option<i64>,
    #[serde(default)]
    pub max_size_bytes: Option<i64>,
    #[serde(default)]
    pub max_file_count: Option<i64>,
    #[serde(default)]
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TriggerMatch {
    pub name: String,
    pub severity: String,
    pub action: String,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseTriggerReport {
    pub blocked: bool,
    pub human_review_required: bool,
    pub baseline_present: bool,
    pub manifest_path: String,
    #[serde(default)]
    pub baseline_manifest_path: Option<String>,
    #[serde(default)]
    pub changed_files: Vec<String>,
    #[serde(default)]
    pub artifacts: Vec<ReleaseArtifact>,
    #[serde(default)]
    pub triggers: Vec<TriggerMatch>,
}

#[derive(Debug, Deserialize)]
struct ReleaseTriggerConfig {
    #[serde(default)]
    release_triggers: Vec<ReleaseTriggerRule>,
}

#[derive(Debug, Deserialize)]
struct ReleaseManifest {
    #[serde(default)]
    manifest_path: Option<String>,
    #[serde(default)]
    artifacts: Vec<ReleaseArtifact>,
}

fn default_severity() -> String {
    "medium".to_string()
}

fn default_action() -> String {
    "require_human_review".to_string()
}

pub fn load_release_triggers(config_path: &Path) -> Result<Vec<ReleaseTriggerRule>, String> {
    let raw = std::fs::read_to_string(config_path)
        .map_err(|error| format!("failed to read {}: {error}", config_path.display()))?;
    let config: ReleaseTriggerConfig = serde_yaml::from_str(&raw)
        .map_err(|error| format!("invalid release-trigger config: {error}"))?;
    Ok(config.release_triggers)
}

pub fn load_release_manifest(
    manifest_path: &Path,
) -> Result<(String, Vec<ReleaseArtifact>), String> {
    let raw = std::fs::read_to_string(manifest_path)
        .map_err(|error| format!("failed to read {}: {error}", manifest_path.display()))?;
    let manifest: ReleaseManifest =
        serde_json::from_str(&raw).map_err(|error| format!("invalid release manifest: {error}"))?;
    Ok((
        manifest
            .manifest_path
            .unwrap_or_else(|| manifest_path.to_string_lossy().to_string()),
        manifest.artifacts,
    ))
}

pub fn evaluate_release_triggers(
    rules: &[ReleaseTriggerRule],
    artifacts: &[ReleaseArtifact],
    manifest_path: &str,
    changed_files: &[String],
    baseline_artifacts: &[ReleaseArtifact],
    baseline_manifest_path: Option<&str>,
) -> ReleaseTriggerReport {
    let mut triggers = Vec::new();

    for rule in rules {
        match rule.rule_type.as_str() {
            "manifest_missing" => {
                if artifacts.is_empty() {
                    triggers.push(TriggerMatch {
                        name: rule.name.clone(),
                        severity: rule.severity.clone(),
                        action: rule.action.clone(),
                        reasons: vec!["release manifest contained no artifacts".to_string()],
                    });
                }
            }
            "unexpected_file" => {
                let mut reasons = Vec::new();
                for artifact in artifacts {
                    if !artifact_matches_rule(artifact, rule) {
                        continue;
                    }
                    for entry in &artifact.entries {
                        let Some(entry_path) =
                            entry.get("path").and_then(serde_json::Value::as_str)
                        else {
                            continue;
                        };
                        if rule
                            .patterns
                            .iter()
                            .any(|pattern| glob_match(pattern, entry_path))
                        {
                            reasons.push(format!(
                                "artifact {} ({}) contains unexpected entry: {}",
                                artifact.kind, artifact.path, entry_path
                            ));
                        }
                    }
                }
                if !reasons.is_empty() {
                    triggers.push(TriggerMatch {
                        name: rule.name.clone(),
                        severity: rule.severity.clone(),
                        action: rule.action.clone(),
                        reasons,
                    });
                }
            }
            "artifact_size_delta" => {
                let mut reasons = Vec::new();
                for artifact in artifacts {
                    if !artifact_matches_rule(artifact, rule) {
                        continue;
                    }
                    if let Some(max_size_bytes) = rule.max_size_bytes {
                        if artifact.size_bytes > max_size_bytes {
                            reasons.push(format!(
                                "artifact {} ({}) size {} exceeds limit {}",
                                artifact.kind, artifact.path, artifact.size_bytes, max_size_bytes
                            ));
                        }
                    }
                    if let Some(max_file_count) = rule.max_file_count {
                        if artifact.file_count > max_file_count {
                            reasons.push(format!(
                                "artifact {} ({}) file count {} exceeds limit {}",
                                artifact.kind, artifact.path, artifact.file_count, max_file_count
                            ));
                        }
                    }

                    let Some(baseline_artifact) =
                        find_baseline_artifact(artifact, baseline_artifacts, rule)
                    else {
                        continue;
                    };
                    if baseline_artifact.size_bytes <= 0 {
                        continue;
                    }

                    let growth_bytes = artifact.size_bytes - baseline_artifact.size_bytes;
                    if growth_bytes <= 0 {
                        continue;
                    }
                    let growth_percent =
                        (growth_bytes as f64 / baseline_artifact.size_bytes as f64) * 100.0;
                    let percent_exceeded = rule
                        .max_growth_percent
                        .is_some_and(|limit| growth_percent > limit);
                    let bytes_exceeded = rule
                        .min_growth_bytes
                        .is_none_or(|limit| growth_bytes >= limit);
                    if percent_exceeded && bytes_exceeded {
                        reasons.push(format!(
                            "artifact {} ({}) grew by {} bytes ({:.1}%) versus baseline {}",
                            artifact.kind,
                            artifact.path,
                            growth_bytes,
                            growth_percent,
                            baseline_artifact.path
                        ));
                    }
                }
                if !reasons.is_empty() {
                    triggers.push(TriggerMatch {
                        name: rule.name.clone(),
                        severity: rule.severity.clone(),
                        action: rule.action.clone(),
                        reasons,
                    });
                }
            }
            "release_boundary_change" | "capability_change" => {
                let reasons = changed_files
                    .iter()
                    .filter(|file_path| {
                        rule.paths
                            .iter()
                            .any(|pattern| glob_match(pattern, file_path))
                    })
                    .map(|file_path| format!("changed release-sensitive path: {file_path}"))
                    .collect::<Vec<_>>();
                if !reasons.is_empty() {
                    triggers.push(TriggerMatch {
                        name: rule.name.clone(),
                        severity: rule.severity.clone(),
                        action: rule.action.clone(),
                        reasons,
                    });
                }
            }
            _ => {}
        }
    }

    let blocked = triggers
        .iter()
        .any(|trigger| trigger.action == "block_release");
    let human_review_required = blocked
        || triggers
            .iter()
            .any(|trigger| trigger.action == "require_human_review");

    ReleaseTriggerReport {
        blocked,
        human_review_required,
        baseline_present: !baseline_artifacts.is_empty(),
        manifest_path: manifest_path.to_string(),
        baseline_manifest_path: baseline_manifest_path.map(ToString::to_string),
        changed_files: changed_files.to_vec(),
        artifacts: artifacts.to_vec(),
        triggers,
    }
}

fn artifact_matches_rule(artifact: &ReleaseArtifact, rule: &ReleaseTriggerRule) -> bool {
    rule.apply_to.is_empty() || rule.apply_to.iter().any(|kind| kind == &artifact.kind)
}

fn artifact_group_key(artifact: &ReleaseArtifact, group_by: &[String]) -> Vec<String> {
    if group_by.is_empty() {
        return vec![
            artifact.kind.clone(),
            artifact.target.clone().unwrap_or_default(),
            artifact.arch.clone().unwrap_or_default(),
            artifact.channel.clone().unwrap_or_default(),
        ];
    }

    group_by
        .iter()
        .map(|field_name| match field_name.as_str() {
            "kind" => artifact.kind.clone(),
            "path" => artifact.path.clone(),
            "target" => artifact.target.clone().unwrap_or_default(),
            "arch" => artifact.arch.clone().unwrap_or_default(),
            "channel" => artifact.channel.clone().unwrap_or_default(),
            _ => String::new(),
        })
        .collect()
}

fn find_baseline_artifact<'a>(
    artifact: &ReleaseArtifact,
    baseline_artifacts: &'a [ReleaseArtifact],
    rule: &ReleaseTriggerRule,
) -> Option<&'a ReleaseArtifact> {
    let current_key = artifact_group_key(artifact, &rule.group_by);
    baseline_artifacts.iter().find(|candidate| {
        candidate.kind == artifact.kind
            && artifact_group_key(candidate, &rule.group_by) == current_key
    })
}

fn glob_match(pattern: &str, path: &str) -> bool {
    Pattern::new(pattern)
        .map(|compiled| compiled.matches(path))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(path: &Path, content: &str) {
        fs::write(path, content).unwrap();
    }

    #[test]
    fn release_trigger_blocks_unexpected_sourcemap_and_manifest_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("release-triggers.yaml");
        write(
            &config_path,
            r#"
release_triggers:
  - name: unexpected_sourcemap_in_release
    type: unexpected_file
    patterns:
      - "**/*.map"
    apply_to:
      - npm_tarball
    severity: critical
    action: block_release
  - name: release_manifest_missing
    type: manifest_missing
    severity: critical
    action: block_release
"#,
        );
        let manifest_path = tmp.path().join("manifest.json");
        write(
            &manifest_path,
            r#"{
  "artifacts": [
    {
      "kind": "npm_tarball",
      "path": "dist/npm/routa-cli-0.1.0.tgz",
      "entries": [
        {"path": "package/dist/index.js.map"}
      ]
    }
  ]
}"#,
        );

        let rules = load_release_triggers(&config_path).unwrap();
        let (manifest_label, artifacts) = load_release_manifest(&manifest_path).unwrap();
        let report = evaluate_release_triggers(&rules, &artifacts, &manifest_label, &[], &[], None);
        assert!(report.blocked);
        assert!(report.human_review_required);
        assert!(report
            .triggers
            .iter()
            .any(|trigger| trigger.name == "unexpected_sourcemap_in_release"));

        let empty_report = evaluate_release_triggers(&rules, &[], "empty.json", &[], &[], None);
        assert!(empty_report.blocked);
        assert!(empty_report
            .triggers
            .iter()
            .any(|trigger| trigger.name == "release_manifest_missing"));
    }

    #[test]
    fn release_trigger_detects_growth_and_sensitive_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("release-triggers.yaml");
        write(
            &config_path,
            r#"
release_triggers:
  - name: npm_tarball_growth_guard
    type: artifact_size_delta
    apply_to:
      - npm_tarball
    group_by:
      - target
      - channel
    max_growth_percent: 20
    min_growth_bytes: 100
    severity: high
    action: require_human_review
  - name: cli_binary_size_limit
    type: artifact_size_delta
    apply_to:
      - cli_binary
    max_size_bytes: 1000
    severity: high
    action: require_human_review
  - name: packaging_boundary_changed
    type: release_boundary_change
    paths:
      - scripts/release/**
  - name: capability_or_supply_chain_drift
    type: capability_change
    paths:
      - apps/desktop/src-tauri/capabilities/**
"#,
        );
        let rules = load_release_triggers(&config_path).unwrap();
        let artifacts = vec![
            ReleaseArtifact {
                kind: "npm_tarball".to_string(),
                path: "dist/npm/routa-cli-0.2.0.tgz".to_string(),
                target: Some("linux-x64".to_string()),
                channel: Some("latest".to_string()),
                size_bytes: 1600,
                file_count: 10,
                arch: None,
                unpacked_size_bytes: None,
                sourcemap_count: 0,
                sourcemap_bytes: 0,
                entries: Vec::new(),
                largest_entries: Vec::new(),
            },
            ReleaseArtifact {
                kind: "cli_binary".to_string(),
                path: "dist/cli-artifacts/linux-x64/routa".to_string(),
                target: Some("linux-x64".to_string()),
                channel: Some("latest".to_string()),
                size_bytes: 1400,
                file_count: 1,
                arch: None,
                unpacked_size_bytes: None,
                sourcemap_count: 0,
                sourcemap_bytes: 0,
                entries: Vec::new(),
                largest_entries: Vec::new(),
            },
        ];
        let baseline_artifacts = vec![ReleaseArtifact {
            kind: "npm_tarball".to_string(),
            path: "dist/npm/routa-cli-0.1.9.tgz".to_string(),
            target: Some("linux-x64".to_string()),
            channel: Some("latest".to_string()),
            size_bytes: 1000,
            file_count: 8,
            arch: None,
            unpacked_size_bytes: None,
            sourcemap_count: 0,
            sourcemap_bytes: 0,
            entries: Vec::new(),
            largest_entries: Vec::new(),
        }];

        let report = evaluate_release_triggers(
            &rules,
            &artifacts,
            "current-manifest.json",
            &[
                "scripts/release/stage-routa-cli-npm.mjs".to_string(),
                "apps/desktop/src-tauri/capabilities/default.json".to_string(),
            ],
            &baseline_artifacts,
            Some("baseline-manifest.json"),
        );

        assert!(!report.blocked);
        assert!(report.human_review_required);
        let names = report
            .triggers
            .iter()
            .map(|trigger| trigger.name.as_str())
            .collect::<Vec<_>>();
        assert!(names.contains(&"npm_tarball_growth_guard"));
        assert!(names.contains(&"cli_binary_size_limit"));
        assert!(names.contains(&"packaging_boundary_changed"));
        assert!(names.contains(&"capability_or_supply_chain_drift"));
    }
}
