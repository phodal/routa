//! Evidence loader — parse YAML frontmatter into Dimension objects.

use std::path::Path;

use crate::model::{
    AnalysisMode, Confidence, Dimension, EvidenceType, ExecutionScope, FitnessKind, Gate, Metric,
    Stability, Tier, Waiver,
};

/// Files to skip when scanning the fitness directory.
const SKIP_FILES: &[&str] = &["README.md", "REVIEW.md"];
const MANIFEST_FILE: &str = "manifest.yaml";

/// Extract YAML frontmatter from markdown content.
pub fn parse_frontmatter(content: &str) -> Option<serde_yaml::Value> {
    let mut lines = content.lines();
    let first_line = lines.next()?.trim_end_matches('\r');
    if first_line != "---" {
        return None;
    }

    let mut yaml_lines = Vec::new();
    let mut found_closing_delimiter = false;
    for line in lines {
        let normalized = line.trim_end_matches('\r');
        if normalized == "---" {
            found_closing_delimiter = true;
            break;
        }
        yaml_lines.push(normalized);
    }

    if !found_closing_delimiter {
        return None;
    }

    let yaml_str = yaml_lines.join("\n");
    let value: serde_yaml::Value = serde_yaml::from_str(&yaml_str).ok()?;
    if value.is_null() {
        return None;
    }
    Some(value)
}

fn parse_enum_str<'a>(raw: &'a serde_yaml::Value, key: &str) -> Option<&'a str> {
    raw.get(key)?.as_str()
}

fn parse_tier(raw: &serde_yaml::Value, key: &str) -> Tier {
    parse_enum_str(raw, key)
        .and_then(Tier::from_str_opt)
        .unwrap_or(Tier::Normal)
}

fn parse_fitness_kind(s: &str) -> Option<FitnessKind> {
    match s {
        "atomic" => Some(FitnessKind::Atomic),
        "holistic" => Some(FitnessKind::Holistic),
        _ => None,
    }
}

fn parse_analysis_mode(s: &str) -> Option<AnalysisMode> {
    match s {
        "static" => Some(AnalysisMode::Static),
        "dynamic" => Some(AnalysisMode::Dynamic),
        _ => None,
    }
}

fn parse_execution_scope(s: &str) -> Option<ExecutionScope> {
    match s {
        "local" => Some(ExecutionScope::Local),
        "ci" => Some(ExecutionScope::Ci),
        "staging" => Some(ExecutionScope::Staging),
        "prod_observation" => Some(ExecutionScope::ProdObservation),
        _ => None,
    }
}

fn parse_gate_enum(s: &str) -> Option<Gate> {
    match s {
        "hard" => Some(Gate::Hard),
        "soft" => Some(Gate::Soft),
        "advisory" => Some(Gate::Advisory),
        _ => None,
    }
}

fn parse_stability(s: &str) -> Option<Stability> {
    match s {
        "deterministic" => Some(Stability::Deterministic),
        "noisy" => Some(Stability::Noisy),
        _ => None,
    }
}

fn parse_evidence_type(s: &str) -> Option<EvidenceType> {
    match s {
        "command" => Some(EvidenceType::Command),
        "test" => Some(EvidenceType::Test),
        "probe" => Some(EvidenceType::Probe),
        "sarif" => Some(EvidenceType::Sarif),
        "manual_attestation" => Some(EvidenceType::ManualAttestation),
        _ => None,
    }
}

fn parse_confidence(s: &str) -> Option<Confidence> {
    match s {
        "high" => Some(Confidence::High),
        "medium" => Some(Confidence::Medium),
        "low" => Some(Confidence::Low),
        "unknown" => Some(Confidence::Unknown),
        _ => None,
    }
}

fn parse_string_list(raw: &serde_yaml::Value, key: &str) -> Vec<String> {
    match raw.get(key) {
        Some(serde_yaml::Value::Sequence(seq)) => seq
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        _ => Vec::new(),
    }
}

fn parse_waiver(raw: &serde_yaml::Value) -> Option<Waiver> {
    let waiver = raw.get("waiver")?;
    if !waiver.is_mapping() {
        return None;
    }

    let reason = waiver
        .get("reason")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let owner = waiver
        .get("owner")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let tracking_issue = waiver.get("tracking_issue").and_then(|v| v.as_i64());

    let expires_at = waiver.get("expires_at").and_then(|v| {
        if let Some(s) = v.as_str() {
            chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
        } else {
            None
        }
    });

    Some(Waiver {
        reason,
        owner,
        tracking_issue,
        expires_at,
    })
}

fn build_metric(raw: &serde_yaml::Value) -> Metric {
    let name = raw
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let command = raw
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let pattern = raw
        .get("pattern")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let hard_gate = raw
        .get("hard_gate")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let tier = parse_tier(raw, "tier");

    let description = raw
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let kind = parse_enum_str(raw, "kind")
        .and_then(parse_fitness_kind)
        .unwrap_or(FitnessKind::Atomic);

    let analysis = parse_enum_str(raw, "analysis")
        .and_then(parse_analysis_mode)
        .unwrap_or(AnalysisMode::Static);

    let execution_scope = parse_enum_str(raw, "execution_scope")
        .and_then(parse_execution_scope)
        .unwrap_or(ExecutionScope::Local);

    let gate = parse_enum_str(raw, "gate")
        .and_then(parse_gate_enum)
        .unwrap_or(if hard_gate { Gate::Hard } else { Gate::Soft });

    let stability = parse_enum_str(raw, "stability")
        .and_then(parse_stability)
        .unwrap_or(Stability::Deterministic);

    let evidence_type = parse_enum_str(raw, "evidence_type")
        .and_then(parse_evidence_type)
        .unwrap_or(EvidenceType::Command);

    let scope = parse_string_list(raw, "scope");
    let run_when_changed = parse_string_list(raw, "run_when_changed");

    let timeout_seconds = raw.get("timeout_seconds").and_then(|v| v.as_u64());

    let owner = raw
        .get("owner")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let confidence = parse_enum_str(raw, "confidence")
        .and_then(parse_confidence)
        .unwrap_or(Confidence::Unknown);

    let waiver = parse_waiver(raw);

    Metric {
        name,
        command,
        pattern,
        hard_gate,
        tier,
        description,
        kind,
        analysis,
        execution_scope,
        gate,
        stability,
        evidence_type,
        scope,
        run_when_changed,
        timeout_seconds,
        owner,
        confidence,
        waiver,
    }
}

/// Load manifest-listed evidence files when a manifest exists.
fn load_manifest_paths(fitness_dir: &Path) -> Option<Vec<std::path::PathBuf>> {
    let manifest_path = fitness_dir.join(MANIFEST_FILE);
    if !manifest_path.is_file() {
        return None;
    }

    let content = std::fs::read_to_string(&manifest_path).ok()?;
    let manifest: serde_yaml::Value = serde_yaml::from_str(&content).ok()?;

    let evidence_files = manifest.get("evidence_files")?;
    let seq = evidence_files.as_sequence()?;

    let mut paths = Vec::new();
    for entry in seq {
        if let Some(s) = entry.as_str() {
            let candidate = std::path::Path::new(s);
            let resolved = if candidate.is_absolute() {
                candidate.to_path_buf()
            } else {
                // Resolve relative to repo root (fitness_dir's grandparent)
                fitness_dir
                    .parent()
                    .and_then(|p| p.parent())
                    .map(|root| root.join(candidate))
                    .unwrap_or_else(|| fitness_dir.join(candidate))
            };
            paths.push(resolved);
        }
    }

    Some(paths)
}

/// Find evidence files from manifest or the legacy top-level glob.
fn discover_evidence_files(fitness_dir: &Path) -> Vec<std::path::PathBuf> {
    if let Some(mut paths) = load_manifest_paths(fitness_dir) {
        paths.sort();
        return paths;
    }

    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(fitness_dir)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().map(|ext| ext == "md").unwrap_or(false))
        .collect();
    files.sort();
    files
}

/// Scan evidence files in fitness_dir for YAML frontmatter, return Dimension objects.
pub fn load_dimensions(fitness_dir: &Path) -> Vec<Dimension> {
    let mut dimensions = Vec::new();

    for md_file in discover_evidence_files(fitness_dir) {
        if !md_file.is_file() {
            continue;
        }
        if let Some(name) = md_file.file_name().and_then(|n| n.to_str()) {
            if SKIP_FILES.contains(&name) {
                continue;
            }
        }

        let content = match std::fs::read_to_string(&md_file) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let fm = match parse_frontmatter(&content) {
            Some(fm) => fm,
            None => continue,
        };

        if fm.get("metrics").is_none() {
            continue;
        }

        let threshold = fm
            .get("threshold")
            .cloned()
            .unwrap_or(serde_yaml::Value::Null);

        let metrics: Vec<Metric> = fm
            .get("metrics")
            .and_then(|v| v.as_sequence())
            .map(|seq| seq.iter().map(build_metric).collect())
            .unwrap_or_default();

        let source_file = if md_file.starts_with(fitness_dir) {
            md_file
                .strip_prefix(fitness_dir)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| {
                    md_file
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default()
                })
        } else {
            md_file
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default()
        };

        let dim = Dimension {
            name: fm
                .get("dimension")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            weight: fm.get("weight").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            threshold_pass: threshold.get("pass").and_then(|v| v.as_i64()).unwrap_or(90) as i32,
            threshold_warn: threshold.get("warn").and_then(|v| v.as_i64()).unwrap_or(80) as i32,
            metrics,
            source_file,
        };

        dimensions.push(dim);
    }

    dimensions
}

/// Check that dimension weights sum to 100%.
pub fn validate_weights(dimensions: &[Dimension]) -> (bool, i32) {
    let total: i32 = dimensions.iter().map(|d| d.weight).sum();
    (total == 100, total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_parse_frontmatter_valid() {
        let content = "---\ndimension: testability\nweight: 20\nmetrics:\n  - name: ts_test\n    command: npm run test\n---\n# Body\n";
        let fm = parse_frontmatter(content);
        assert!(fm.is_some());
        let fm = fm.unwrap();
        assert_eq!(
            fm.get("dimension").unwrap().as_str().unwrap(),
            "testability"
        );
        assert_eq!(fm.get("weight").unwrap().as_i64().unwrap(), 20);
        assert_eq!(fm.get("metrics").unwrap().as_sequence().unwrap().len(), 1);
    }

    #[test]
    fn test_parse_frontmatter_missing() {
        assert!(parse_frontmatter("# No frontmatter here").is_none());
    }

    #[test]
    fn test_parse_frontmatter_empty_yaml() {
        let content = "---\n---\n# Empty";
        let fm = parse_frontmatter(content);
        assert!(fm.is_none()); // yaml returns None for empty
    }

    #[test]
    fn test_parse_frontmatter_supports_crlf() {
        let content =
            "---\r\ndimension: testability\r\nweight: 20\r\nmetrics: []\r\n---\r\n# Body\r\n";
        let fm = parse_frontmatter(content).unwrap();
        assert_eq!(
            fm.get("dimension").unwrap().as_str().unwrap(),
            "testability"
        );
    }

    #[test]
    fn test_parse_frontmatter_requires_delimiter_on_its_own_line() {
        let content = "---\nmessage: |\n  keep this line\n  --- still yaml content\nmetrics: []\n---\n# Body\n";
        let fm = parse_frontmatter(content).unwrap();
        assert_eq!(
            fm.get("message").unwrap().as_str().unwrap(),
            "keep this line\n--- still yaml content\n"
        );
    }

    #[test]
    fn test_load_dimensions() {
        let tmp = tempdir().unwrap();
        let md = tmp.path().join("security.md");
        fs::write(
            &md,
            "---\ndimension: security\nweight: 20\nthreshold:\n  pass: 90\n  warn: 75\nmetrics:\n  - name: npm_audit\n    command: npm audit\n    hard_gate: true\n    tier: fast\n  - name: cargo_audit\n    command: cargo audit\n---\n# Security evidence\n",
        ).unwrap();

        let dims = load_dimensions(tmp.path());
        assert_eq!(dims.len(), 1);
        let dim = &dims[0];
        assert_eq!(dim.name, "security");
        assert_eq!(dim.weight, 20);
        assert_eq!(dim.threshold_pass, 90);
        assert_eq!(dim.threshold_warn, 75);
        assert_eq!(dim.metrics.len(), 2);
        assert!(dim.metrics[0].hard_gate);
        assert_eq!(dim.metrics[0].tier, Tier::Fast);
        assert_eq!(dim.metrics[1].tier, Tier::Normal);
        assert_eq!(dim.source_file, "security.md");
    }

    #[test]
    fn test_load_dimensions_parses_v2_fields_and_preserves_v1_compat() {
        let tmp = tempdir().unwrap();
        let md = tmp.path().join("runtime.md");
        fs::write(
            &md,
            r#"---
dimension: observability
weight: 0
metrics:
  - name: tracing_signal_available
    command: ./scripts/check.sh 2>&1
    pattern: "signal_ok"
    hard_gate: false
    tier: deep
    description: verify tracing signal
    execution_scope: staging
    gate: advisory
    kind: holistic
    analysis: dynamic
    stability: noisy
    evidence_type: probe
    scope: [web, rust]
    run_when_changed:
      - src/instrumentation.ts
      - crates/routa-server/src/telemetry/**
    timeout_seconds: 120
    owner: platform
    confidence: high
    waiver:
      reason: legacy hotspot pending refactor
      owner: phodal
      tracking_issue: 217
      expires_at: "2026-04-30"
  - name: legacy_metric
    command: echo legacy
    hard_gate: true
---
# Runtime evidence
"#,
        )
        .unwrap();

        let dims = load_dimensions(tmp.path());
        assert_eq!(dims.len(), 1);
        let metrics = &dims[0].metrics;
        assert_eq!(metrics.len(), 2);

        let runtime_metric = &metrics[0];
        assert_eq!(runtime_metric.execution_scope, ExecutionScope::Staging);
        assert_eq!(runtime_metric.gate, Gate::Advisory);
        assert_eq!(runtime_metric.kind, FitnessKind::Holistic);
        assert_eq!(runtime_metric.analysis, AnalysisMode::Dynamic);
        assert_eq!(runtime_metric.stability, Stability::Noisy);
        assert_eq!(runtime_metric.evidence_type, EvidenceType::Probe);
        assert_eq!(runtime_metric.scope, vec!["web", "rust"]);
        assert_eq!(
            runtime_metric.run_when_changed,
            vec![
                "src/instrumentation.ts",
                "crates/routa-server/src/telemetry/**"
            ]
        );
        assert_eq!(runtime_metric.timeout_seconds, Some(120));
        assert_eq!(runtime_metric.owner, "platform");
        assert_eq!(runtime_metric.confidence, Confidence::High);
        assert!(runtime_metric.waiver.is_some());
        let waiver = runtime_metric.waiver.as_ref().unwrap();
        assert_eq!(waiver.reason, "legacy hotspot pending refactor");
        assert_eq!(waiver.owner, "phodal");
        assert_eq!(waiver.tracking_issue, Some(217));
        assert_eq!(waiver.expires_at.unwrap().to_string(), "2026-04-30");

        let legacy_metric = &metrics[1];
        assert_eq!(legacy_metric.gate, Gate::Hard);
        assert_eq!(legacy_metric.execution_scope, ExecutionScope::Local);
        assert_eq!(legacy_metric.kind, FitnessKind::Atomic);
        assert_eq!(legacy_metric.analysis, AnalysisMode::Static);
    }

    #[test]
    fn test_load_dimensions_invalid_v2_values_fall_back_to_defaults() {
        let tmp = tempdir().unwrap();
        let md = tmp.path().join("bad-values.md");
        fs::write(
            &md,
            "---\ndimension: testability\nweight: 10\nmetrics:\n  - name: weird_metric\n    command: echo ok\n    tier: ultra\n    execution_scope: moon\n    gate: severe\n    kind: hybrid\n    analysis: magical\n    stability: flaky\n    evidence_type: unsupported\n    confidence: maybe\n    scope: not-a-list\n    run_when_changed: not-a-list\n---\n# Bad values\n",
        ).unwrap();

        let dims = load_dimensions(tmp.path());
        let metric = &dims[0].metrics[0];
        assert_eq!(metric.tier, Tier::Normal);
        assert_eq!(metric.execution_scope, ExecutionScope::Local);
        assert_eq!(metric.gate, Gate::Soft);
        assert_eq!(metric.kind, FitnessKind::Atomic);
        assert_eq!(metric.analysis, AnalysisMode::Static);
        assert_eq!(metric.stability, Stability::Deterministic);
        assert_eq!(metric.evidence_type, EvidenceType::Command);
        assert_eq!(metric.confidence, Confidence::Unknown);
        assert!(metric.scope.is_empty());
        assert!(metric.run_when_changed.is_empty());
    }

    #[test]
    fn test_load_dimensions_skips_readme() {
        let tmp = tempdir().unwrap();
        fs::write(
            tmp.path().join("README.md"),
            "---\ndimension: x\nweight: 10\nmetrics:\n  - name: y\n    command: z\n---\n",
        )
        .unwrap();
        let dims = load_dimensions(tmp.path());
        assert_eq!(dims.len(), 0);
    }

    #[test]
    fn test_load_dimensions_skips_no_frontmatter() {
        let tmp = tempdir().unwrap();
        fs::write(
            tmp.path().join("notes.md"),
            "# Just notes\nNo frontmatter here.",
        )
        .unwrap();
        let dims = load_dimensions(tmp.path());
        assert_eq!(dims.len(), 0);
    }

    #[test]
    fn test_load_dimensions_uses_manifest_when_present() {
        let tmp = tempdir().unwrap();
        let fitness_dir = tmp.path().join("docs").join("fitness");
        let runtime_dir = fitness_dir.join("runtime");
        fs::create_dir_all(&runtime_dir).unwrap();

        fs::write(
            fitness_dir.join("manifest.yaml"),
            "schema: fitness-manifest-v1\nevidence_files:\n  - docs/fitness/runtime/observability.md\n",
        ).unwrap();

        fs::write(
            fitness_dir.join("ignored.md"),
            "---\ndimension: ignored\nweight: 100\nmetrics:\n  - name: ignored\n    command: echo ignored\n---\n",
        ).unwrap();

        fs::write(
            runtime_dir.join("observability.md"),
            "---\ndimension: observability\nweight: 0\nmetrics:\n  - name: tracing_signal_available\n    command: echo signal_ok\n---\n",
        ).unwrap();

        let dims = load_dimensions(&fitness_dir);
        assert_eq!(dims.len(), 1);
        assert_eq!(dims[0].name, "observability");
        assert_eq!(dims[0].source_file, "runtime/observability.md");
    }

    #[test]
    fn test_validate_weights() {
        let dims = vec![Dimension::new("a", 60), Dimension::new("b", 40)];
        let (valid, total) = validate_weights(&dims);
        assert!(valid);
        assert_eq!(total, 100);
    }

    #[test]
    fn test_validate_weights_fail() {
        let dims = vec![Dimension::new("a", 50)];
        let (valid, total) = validate_weights(&dims);
        assert!(!valid);
        assert_eq!(total, 50);
    }
}
