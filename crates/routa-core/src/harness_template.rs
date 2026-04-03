use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const TEMPLATES_DIR: &str = "docs/harness/templates";

// ---------------------------------------------------------------------------
// YAML config types (deserialized from harness-template-v1)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct BoundaryConfig {
    path: String,
    role: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct TopologyConfig {
    app_type: String,
    #[serde(default)]
    runtimes: Vec<String>,
    #[serde(default)]
    protocols: Vec<String>,
    #[serde(default)]
    boundaries: Vec<BoundaryConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct GuideEntryConfig {
    path: String,
    #[serde(default)]
    purpose: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct GuidesConfig {
    #[serde(default)]
    required: Vec<GuideEntryConfig>,
    #[serde(default)]
    recommended: Vec<GuideEntryConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct GateConfig {
    id: String,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    dimension: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct HardGatesConfig {
    #[serde(default)]
    fast: Vec<GateConfig>,
    #[serde(default)]
    normal: Vec<GateConfig>,
    #[serde(default)]
    full: Vec<GateConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct SensorsConfig {
    #[serde(default)]
    fitness_manifest: Option<String>,
    #[serde(default)]
    review_triggers: Option<String>,
    #[serde(default)]
    release_triggers: Option<String>,
    #[serde(default)]
    surfaces: Vec<String>,
    #[serde(default)]
    hard_gates: Option<HardGatesConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct SpecialistBindingConfig {
    id: String,
    #[serde(default)]
    role: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct AutomationsRefConfig {
    #[serde(default, rename = "ref")]
    reference: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct LifecycleTierConfig {
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    column_gate: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct DriftConfig {
    #[serde(default)]
    strategy: Option<String>,
    #[serde(default)]
    notify_on: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct HarnessTemplateConfig {
    schema: String,
    #[serde(default)]
    version: Option<String>,
    id: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    topology: TopologyConfig,
    #[serde(default)]
    guides: Option<GuidesConfig>,
    #[serde(default)]
    sensors: Option<SensorsConfig>,
    #[serde(default)]
    specialists: Vec<SpecialistBindingConfig>,
    #[serde(default)]
    automations: Option<AutomationsRefConfig>,
    #[serde(default)]
    lifecycle_tiers: Option<HashMap<String, LifecycleTierConfig>>,
    #[serde(default)]
    drift: Option<DriftConfig>,
}

// ---------------------------------------------------------------------------
// Public output types (serialized to JSON for CLI / API)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessTemplateSummary {
    pub id: String,
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub app_type: String,
    pub runtimes: Vec<String>,
    pub config_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideStatus {
    pub path: String,
    pub purpose: Option<String>,
    pub required: bool,
    pub present: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryStatus {
    pub path: String,
    pub role: String,
    pub present: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SensorFileStatus {
    pub path: String,
    pub role: String,
    pub present: bool,
    pub checksum: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRefStatus {
    pub path: String,
    pub present: bool,
    pub checksum: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GateStatus {
    pub id: String,
    pub tier: String,
    pub command: Option<String>,
    pub dimension: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialistBinding {
    pub id: String,
    pub role: Option<String>,
    pub yaml_exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleTier {
    pub tier: String,
    pub description: Option<String>,
    pub column_gate: Option<String>,
    pub gate_count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DriftLevel {
    Healthy,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftFinding {
    pub kind: String,
    pub path: String,
    pub message: String,
    pub level: DriftLevel,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftPolicy {
    pub strategy: Option<String>,
    pub notify_on: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateValidationReport {
    pub generated_at: String,
    pub template_id: String,
    pub template_name: String,
    pub template_version: Option<String>,
    pub config_path: String,
    pub app_type: String,
    pub runtimes: Vec<String>,
    pub protocols: Vec<String>,
    pub guides: Vec<GuideStatus>,
    pub boundaries: Vec<BoundaryStatus>,
    pub sensor_files: Vec<SensorFileStatus>,
    pub automation_ref: Option<AutomationRefStatus>,
    pub gates: Vec<GateStatus>,
    pub specialists: Vec<SpecialistBinding>,
    pub lifecycle_tiers: Vec<LifecycleTier>,
    pub drift_policy: Option<DriftPolicy>,
    pub drift_findings: Vec<DriftFinding>,
    pub overall_drift: DriftLevel,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateListReport {
    pub generated_at: String,
    pub repo_root: String,
    pub templates: Vec<HarnessTemplateSummary>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub generated_at: String,
    pub repo_root: String,
    pub template_reports: Vec<TemplateValidationReport>,
    pub warnings: Vec<String>,
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

pub fn list_templates(repo_root: &Path) -> Result<TemplateListReport, String> {
    let mut warnings = Vec::new();
    let templates_dir = repo_root.join(TEMPLATES_DIR);

    let templates = if templates_dir.is_dir() {
        load_template_summaries(&templates_dir, &mut warnings)
    } else {
        warnings.push(format!("Templates directory not found: {TEMPLATES_DIR}"));
        Vec::new()
    };

    Ok(TemplateListReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        templates,
        warnings,
    })
}

pub fn validate_template(
    repo_root: &Path,
    template_id: &str,
) -> Result<TemplateValidationReport, String> {
    let templates_dir = repo_root.join(TEMPLATES_DIR);
    let (config, config_path) = find_and_load_template(&templates_dir, template_id)?;
    build_validation_report(repo_root, &config, &config_path)
}

pub fn doctor(repo_root: &Path) -> Result<DoctorReport, String> {
    let mut warnings = Vec::new();
    let templates_dir = repo_root.join(TEMPLATES_DIR);

    if !templates_dir.is_dir() {
        return Ok(DoctorReport {
            generated_at: chrono::Utc::now().to_rfc3339(),
            repo_root: repo_root.display().to_string(),
            template_reports: Vec::new(),
            warnings: vec![format!("Templates directory not found: {TEMPLATES_DIR}")],
        });
    }

    let configs = load_all_template_configs(&templates_dir, &mut warnings);
    let mut reports = Vec::new();

    for (config, rel_path) in &configs {
        match build_validation_report(repo_root, config, rel_path) {
            Ok(report) => reports.push(report),
            Err(err) => warnings.push(format!("Failed to validate {}: {err}", config.id)),
        }
    }

    Ok(DoctorReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        template_reports: reports,
        warnings,
    })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn load_template_summaries(
    templates_dir: &Path,
    warnings: &mut Vec<String>,
) -> Vec<HarnessTemplateSummary> {
    load_all_template_configs(templates_dir, warnings)
        .into_iter()
        .map(|(config, rel_path)| HarnessTemplateSummary {
            id: config.id,
            name: config.name,
            version: config.version,
            description: config.description,
            app_type: config.topology.app_type,
            runtimes: config.topology.runtimes,
            config_path: rel_path,
        })
        .collect()
}

fn load_all_template_configs(
    templates_dir: &Path,
    warnings: &mut Vec<String>,
) -> Vec<(HarnessTemplateConfig, String)> {
    let entries = match fs::read_dir(templates_dir) {
        Ok(entries) => entries,
        Err(err) => {
            warnings.push(format!("Cannot read templates directory: {err}"));
            return Vec::new();
        }
    };

    let mut configs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "yaml" && ext != "yml" {
            continue;
        }
        match load_template_config(&path) {
            Ok(config) => {
                let rel = format!("{TEMPLATES_DIR}/{}", entry.file_name().to_string_lossy());
                configs.push((config, rel));
            }
            Err(err) => warnings.push(format!(
                "Failed to parse {}: {err}",
                entry.file_name().to_string_lossy()
            )),
        }
    }
    configs.sort_by(|a, b| a.0.id.cmp(&b.0.id));
    configs
}

fn load_template_config(path: &Path) -> Result<HarnessTemplateConfig, String> {
    let raw =
        fs::read_to_string(path).map_err(|err| format!("cannot read {}: {err}", path.display()))?;
    let config: HarnessTemplateConfig = serde_yaml::from_str(&raw)
        .map_err(|err| format!("invalid YAML in {}: {err}", path.display()))?;
    if config.schema != "harness-template-v1" {
        return Err(format!(
            "unexpected schema '{}' in {}; expected 'harness-template-v1'",
            config.schema,
            path.display()
        ));
    }
    Ok(config)
}

fn find_and_load_template(
    templates_dir: &Path,
    template_id: &str,
) -> Result<(HarnessTemplateConfig, String), String> {
    if !templates_dir.is_dir() {
        return Err(format!("Templates directory not found: {TEMPLATES_DIR}"));
    }
    for entry in fs::read_dir(templates_dir)
        .map_err(|err| format!("cannot read templates directory: {err}"))?
        .flatten()
    {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "yaml" && ext != "yml" {
            continue;
        }
        if let Ok(config) = load_template_config(&path) {
            if config.id == template_id {
                let rel = format!("{TEMPLATES_DIR}/{}", entry.file_name().to_string_lossy());
                return Ok((config, rel));
            }
        }
    }
    Err(format!(
        "template '{template_id}' not found in {TEMPLATES_DIR}"
    ))
}

fn build_validation_report(
    repo_root: &Path,
    config: &HarnessTemplateConfig,
    config_path: &str,
) -> Result<TemplateValidationReport, String> {
    let warnings = Vec::new();
    let mut drift_findings = Vec::new();

    let guides = check_guides(repo_root, config, &mut drift_findings);
    let boundaries = collect_boundaries(repo_root, config);
    let sensor_files = check_sensor_files(repo_root, config, &mut drift_findings);
    let automation_ref = collect_automation_ref(repo_root, config);
    let gates = collect_gates(config);
    let specialists = check_specialists(repo_root, config);
    let lifecycle_tiers = collect_lifecycle_tiers(config, &gates);
    let drift_policy = collect_drift_policy(config);

    let overall_drift = if drift_findings.iter().any(|f| f.level == DriftLevel::Error) {
        DriftLevel::Error
    } else if drift_findings
        .iter()
        .any(|f| f.level == DriftLevel::Warning)
    {
        DriftLevel::Warning
    } else {
        DriftLevel::Healthy
    };

    Ok(TemplateValidationReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        template_id: config.id.clone(),
        template_name: config.name.clone(),
        template_version: config.version.clone(),
        config_path: config_path.to_string(),
        app_type: config.topology.app_type.clone(),
        runtimes: config.topology.runtimes.clone(),
        protocols: config.topology.protocols.clone(),
        guides,
        boundaries,
        sensor_files,
        automation_ref,
        gates,
        specialists,
        lifecycle_tiers,
        drift_policy,
        drift_findings,
        overall_drift,
        warnings,
    })
}

fn check_guides(
    repo_root: &Path,
    config: &HarnessTemplateConfig,
    drift_findings: &mut Vec<DriftFinding>,
) -> Vec<GuideStatus> {
    let mut results = Vec::new();
    let guides = match &config.guides {
        Some(g) => g,
        None => return results,
    };

    for guide in &guides.required {
        let present = path_exists(repo_root, &guide.path);
        if !present {
            drift_findings.push(DriftFinding {
                kind: "guide_missing".to_string(),
                path: guide.path.clone(),
                message: format!("Required guide missing: {}", guide.path),
                level: DriftLevel::Error,
            });
        }
        results.push(GuideStatus {
            path: guide.path.clone(),
            purpose: guide.purpose.clone(),
            required: true,
            present,
        });
    }

    for guide in &guides.recommended {
        let present = path_exists(repo_root, &guide.path);
        if !present {
            drift_findings.push(DriftFinding {
                kind: "guide_missing".to_string(),
                path: guide.path.clone(),
                message: format!("Recommended guide missing: {}", guide.path),
                level: DriftLevel::Warning,
            });
        }
        results.push(GuideStatus {
            path: guide.path.clone(),
            purpose: guide.purpose.clone(),
            required: false,
            present,
        });
    }

    results
}

fn collect_boundaries(repo_root: &Path, config: &HarnessTemplateConfig) -> Vec<BoundaryStatus> {
    config
        .topology
        .boundaries
        .iter()
        .map(|boundary| BoundaryStatus {
            path: boundary.path.clone(),
            role: boundary.role.clone(),
            present: path_exists(repo_root, &boundary.path),
        })
        .collect()
}

fn check_sensor_files(
    repo_root: &Path,
    config: &HarnessTemplateConfig,
    drift_findings: &mut Vec<DriftFinding>,
) -> Vec<SensorFileStatus> {
    let mut results = Vec::new();
    let sensors = match &config.sensors {
        Some(s) => s,
        None => return results,
    };

    let sensor_paths: Vec<(&str, &str)> = [
        (sensors.fitness_manifest.as_deref(), "fitness_manifest"),
        (sensors.review_triggers.as_deref(), "review_triggers"),
        (sensors.release_triggers.as_deref(), "release_triggers"),
    ]
    .into_iter()
    .filter_map(|(opt, role)| opt.map(|p| (p, role)))
    .collect();

    for (rel_path, role) in &sensor_paths {
        let abs = repo_root.join(rel_path);
        let present = abs.exists();
        let checksum = if present {
            file_sha256(&abs).ok()
        } else {
            None
        };
        if !present {
            drift_findings.push(DriftFinding {
                kind: "sensor_file_missing".to_string(),
                path: rel_path.to_string(),
                message: format!("Sensor file missing: {rel_path}"),
                level: DriftLevel::Error,
            });
        }
        results.push(SensorFileStatus {
            path: rel_path.to_string(),
            role: role.to_string(),
            present,
            checksum,
        });
    }

    for surface_path in &sensors.surfaces {
        let abs = repo_root.join(surface_path);
        let present = abs.exists();
        let checksum = if present {
            file_sha256(&abs).ok()
        } else {
            None
        };
        if !present {
            drift_findings.push(DriftFinding {
                kind: "sensor_file_missing".to_string(),
                path: surface_path.clone(),
                message: format!("Surface definition missing: {surface_path}"),
                level: DriftLevel::Error,
            });
        }
        results.push(SensorFileStatus {
            path: surface_path.clone(),
            role: "surface".to_string(),
            present,
            checksum,
        });
    }

    results
}

fn collect_automation_ref(
    repo_root: &Path,
    config: &HarnessTemplateConfig,
) -> Option<AutomationRefStatus> {
    let rel_path = config.automations.as_ref()?.reference.as_ref()?;
    let abs = repo_root.join(rel_path);
    let present = abs.exists();
    let checksum = if present {
        file_sha256(&abs).ok()
    } else {
        None
    };

    Some(AutomationRefStatus {
        path: rel_path.clone(),
        present,
        checksum,
    })
}

fn collect_gates(config: &HarnessTemplateConfig) -> Vec<GateStatus> {
    let mut gates = Vec::new();
    let hard_gates = match config.sensors.as_ref().and_then(|s| s.hard_gates.as_ref()) {
        Some(hg) => hg,
        None => return gates,
    };

    for gate in &hard_gates.fast {
        gates.push(GateStatus {
            id: gate.id.clone(),
            tier: "fast".to_string(),
            command: gate.command.clone(),
            dimension: gate.dimension.clone(),
        });
    }
    for gate in &hard_gates.normal {
        gates.push(GateStatus {
            id: gate.id.clone(),
            tier: "normal".to_string(),
            command: gate.command.clone(),
            dimension: gate.dimension.clone(),
        });
    }
    for gate in &hard_gates.full {
        gates.push(GateStatus {
            id: gate.id.clone(),
            tier: "full".to_string(),
            command: gate.command.clone(),
            dimension: gate.dimension.clone(),
        });
    }

    gates
}

fn check_specialists(repo_root: &Path, config: &HarnessTemplateConfig) -> Vec<SpecialistBinding> {
    config
        .specialists
        .iter()
        .map(|spec| {
            let yaml_path = repo_root
                .join("resources/specialists/tools")
                .join(format!("{}.yaml", spec.id));
            let harness_yaml_path = repo_root
                .join("resources/specialists/harness")
                .join(format!("{}.yaml", spec.id));
            let yaml_exists = yaml_path.exists() || harness_yaml_path.exists();
            SpecialistBinding {
                id: spec.id.clone(),
                role: spec.role.clone(),
                yaml_exists,
            }
        })
        .collect()
}

fn collect_drift_policy(config: &HarnessTemplateConfig) -> Option<DriftPolicy> {
    config.drift.as_ref().map(|drift| DriftPolicy {
        strategy: drift.strategy.clone(),
        notify_on: drift.notify_on.clone(),
    })
}

fn collect_lifecycle_tiers(
    config: &HarnessTemplateConfig,
    gates: &[GateStatus],
) -> Vec<LifecycleTier> {
    let tiers = match &config.lifecycle_tiers {
        Some(tiers) => tiers,
        None => return Vec::new(),
    };

    let mut result: Vec<LifecycleTier> = tiers
        .iter()
        .map(|(tier_name, tier_config)| {
            let gate_count = gates.iter().filter(|g| g.tier == *tier_name).count();
            LifecycleTier {
                tier: tier_name.clone(),
                description: tier_config.description.clone(),
                column_gate: tier_config.column_gate.clone(),
                gate_count,
            }
        })
        .collect();
    result.sort_by(|a, b| tier_order(&a.tier).cmp(&tier_order(&b.tier)));
    result
}

fn tier_order(tier: &str) -> u8 {
    match tier {
        "fast" => 0,
        "normal" => 1,
        "full" => 2,
        _ => 3,
    }
}

fn path_exists(repo_root: &Path, rel_path: &str) -> bool {
    repo_root.join(rel_path).exists()
}

fn file_sha256(path: &PathBuf) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let hash = Sha256::digest(&bytes);
    Ok(format!("{:x}", hash))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_minimal_template(dir: &Path) -> PathBuf {
        let templates_dir = dir.join(TEMPLATES_DIR);
        fs::create_dir_all(&templates_dir).unwrap();
        let template_path = templates_dir.join("test-template.yaml");
        fs::write(
            &template_path,
            r#"
schema: harness-template-v1
version: "0.1.0"
id: test-web
name: Test Web Template
topology:
  app_type: web
  runtimes:
    - nextjs
  boundaries:
    - path: src/app
      role: presentation
guides:
  required:
    - path: AGENTS.md
      purpose: Contract
sensors:
  fitness_manifest: docs/fitness/manifest.yaml
  surfaces:
    - docs/harness/build.yml
automations:
  ref: docs/harness/automations.yml
specialists:
  - id: harness-build
    role: Build validation
lifecycle_tiers:
  fast:
    description: Quick checks
    column_gate: coding
drift:
  strategy: checksum-on-evidence-files
  notify_on:
    - guide_missing
"#,
        )
        .unwrap();
        template_path
    }

    #[test]
    fn test_list_templates() {
        let tmp = TempDir::new().unwrap();
        setup_minimal_template(tmp.path());

        let report = list_templates(tmp.path()).unwrap();
        assert_eq!(report.templates.len(), 1);
        assert_eq!(report.templates[0].id, "test-web");
        assert_eq!(report.templates[0].app_type, "web");
    }

    #[test]
    fn test_list_templates_empty() {
        let tmp = TempDir::new().unwrap();
        let report = list_templates(tmp.path()).unwrap();
        assert!(report.templates.is_empty());
        assert!(!report.warnings.is_empty());
    }

    #[test]
    fn test_validate_template_missing_guides() {
        let tmp = TempDir::new().unwrap();
        setup_minimal_template(tmp.path());

        let report = validate_template(tmp.path(), "test-web").unwrap();
        assert_eq!(report.template_id, "test-web");
        assert_eq!(report.overall_drift, DriftLevel::Error);

        let missing_guides: Vec<_> = report
            .drift_findings
            .iter()
            .filter(|f| f.kind == "guide_missing")
            .collect();
        assert!(!missing_guides.is_empty());
    }

    #[test]
    fn test_validate_template_all_present() {
        let tmp = TempDir::new().unwrap();
        setup_minimal_template(tmp.path());

        fs::write(tmp.path().join("AGENTS.md"), "# Agents").unwrap();
        fs::create_dir_all(tmp.path().join("src/app")).unwrap();
        fs::create_dir_all(tmp.path().join("docs/fitness")).unwrap();
        fs::write(
            tmp.path().join("docs/fitness/manifest.yaml"),
            "schema: fitness-manifest-v1",
        )
        .unwrap();
        fs::create_dir_all(tmp.path().join("docs/harness")).unwrap();
        fs::write(
            tmp.path().join("docs/harness/build.yml"),
            "schema: harness-surface-v1",
        )
        .unwrap();
        fs::write(
            tmp.path().join("docs/harness/automations.yml"),
            "schema: harness-automation-v1",
        )
        .unwrap();

        let report = validate_template(tmp.path(), "test-web").unwrap();
        assert_eq!(report.overall_drift, DriftLevel::Healthy);
        assert!(report.drift_findings.is_empty());
        assert_eq!(report.boundaries.len(), 1);
        assert!(report.boundaries[0].present);
        assert_eq!(
            report
                .automation_ref
                .as_ref()
                .expect("automation ref should exist")
                .path,
            "docs/harness/automations.yml"
        );
        assert_eq!(
            report
                .drift_policy
                .as_ref()
                .expect("drift policy should exist")
                .strategy
                .as_deref(),
            Some("checksum-on-evidence-files")
        );
    }

    #[test]
    fn test_validate_template_not_found() {
        let tmp = TempDir::new().unwrap();
        setup_minimal_template(tmp.path());

        let result = validate_template(tmp.path(), "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_doctor_runs_all_templates() {
        let tmp = TempDir::new().unwrap();
        setup_minimal_template(tmp.path());

        let report = doctor(tmp.path()).unwrap();
        assert_eq!(report.template_reports.len(), 1);
        assert_eq!(report.template_reports[0].template_id, "test-web");
    }
}
