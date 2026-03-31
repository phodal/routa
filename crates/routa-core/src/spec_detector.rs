use std::fs;
use std::path::Path;

use serde::Serialize;

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecDetectionReport {
    pub generated_at: String,
    pub repo_root: String,
    pub sources: Vec<SpecSource>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecSource {
    pub kind: String,
    pub system: String,
    pub root_path: String,
    pub confidence: String,
    pub status: String,
    pub evidence: Vec<String>,
    pub children: Vec<SpecArtifact>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub features: Option<Vec<SpecFeature>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecArtifact {
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecFeature {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_kiro: Option<KiroConfig>,
    pub documents: Vec<SpecArtifact>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroConfig {
    pub spec_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_type: Option<String>,
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn dir_exists(p: &Path) -> bool {
    p.is_dir()
}

fn file_exists(p: &Path) -> bool {
    p.is_file()
}

fn list_dirs(parent: &Path) -> Vec<String> {
    fs::read_dir(parent)
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}

fn list_files(parent: &Path) -> Vec<String> {
    fs::read_dir(parent)
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}

fn rel_path(repo_root: &Path, abs_path: &Path) -> String {
    abs_path
        .strip_prefix(repo_root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| abs_path.to_string_lossy().to_string())
}

fn infer_artifact_type(file_name: &str) -> &'static str {
    let lower = file_name.to_lowercase().trim_end_matches(".md").to_string();
    match lower.as_str() {
        "requirements" => "requirements",
        "bugfix" => "bugfix",
        "design" => "design",
        "tasks" => "tasks",
        "proposal" => "proposal",
        "plan" => "plan",
        "spec" => "requirements",
        "data-model" => "data-model",
        "research" => "research",
        "quickstart" => "quickstart",
        "prd" => "prd",
        "architecture" => "architecture",
        "config" => "config",
        "project-context" => "context",
        _ => {
            // Partial match: if the filename contains a known keyword, use that type
            if lower.contains("requirement") {
                "requirements"
            } else if lower.contains("design") {
                "design"
            } else if lower.contains("task") {
                "tasks"
            } else if lower.contains("bugfix") {
                "bugfix"
            } else if lower.contains("proposal") {
                "proposal"
            } else if lower.contains("plan") {
                "plan"
            } else if lower.contains("prd") {
                "prd"
            } else if lower.contains("architecture") {
                "architecture"
            } else if lower.contains("epic") {
                "epic"
            } else if lower.contains("story") {
                "story"
            } else {
                "spec"
            }
        }
    }
}

// ── Detectors ──────────────────────────────────────────────────────────────

fn detect_kiro(repo_root: &Path) -> Vec<SpecSource> {
    let mut sources = Vec::new();
    let kiro_specs_dir = repo_root.join(".kiro").join("specs");
    let kiro_root = repo_root.join(".kiro");

    if dir_exists(&kiro_specs_dir) {
        let feature_dirs = list_dirs(&kiro_specs_dir);
        let mut all_artifacts = Vec::new();
        let mut features = Vec::new();
        let mut evidence = Vec::new();

        for feature in &feature_dirs {
            let feature_dir = kiro_specs_dir.join(feature);
            let files = list_files(&feature_dir);
            let mut documents = Vec::new();

            for file in &files {
                if file.ends_with(".md") {
                    let artifact = SpecArtifact {
                        artifact_type: infer_artifact_type(file).to_string(),
                        path: rel_path(repo_root, &feature_dir.join(file)),
                    };
                    documents.push(artifact.clone());
                    all_artifacts.push(artifact);
                }
            }

            // Parse .config.kiro
            let config_path = feature_dir.join(".config.kiro");
            let config_kiro = if file_exists(&config_path) {
                fs::read_to_string(&config_path)
                    .ok()
                    .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
                    .map(|v| KiroConfig {
                        spec_id: v
                            .get("specId")
                            .and_then(|s| s.as_str())
                            .unwrap_or("")
                            .to_string(),
                        workflow_type: v
                            .get("workflowType")
                            .and_then(|s| s.as_str())
                            .map(|s| s.to_string()),
                        spec_type: v
                            .get("specType")
                            .and_then(|s| s.as_str())
                            .map(|s| s.to_string()),
                    })
            } else {
                None
            };

            if !documents.is_empty() || config_kiro.is_some() {
                features.push(SpecFeature {
                    name: feature.clone(),
                    config_kiro,
                    documents,
                });
            }

            if !files.is_empty() {
                evidence.push(format!(
                    ".kiro/specs/{feature}/ ({} files)",
                    files.len()
                ));
            }
        }

        if !all_artifacts.is_empty() {
            sources.push(SpecSource {
                kind: "native-tool".to_string(),
                system: "kiro".to_string(),
                root_path: rel_path(repo_root, &kiro_specs_dir),
                confidence: "high".to_string(),
                status: "artifacts-present".to_string(),
                evidence,
                children: all_artifacts,
                features: Some(features),
            });
        } else {
            sources.push(SpecSource {
                kind: "native-tool".to_string(),
                system: "kiro".to_string(),
                root_path: rel_path(repo_root, &kiro_specs_dir),
                confidence: "medium".to_string(),
                status: "installed-only".to_string(),
                evidence: vec![
                    ".kiro/specs/ exists but no feature artifacts found".to_string(),
                ],
                children: vec![],
                features: None,
            });
        }
    }

    // Kiro integration dirs
    let integration_dirs = ["prompts", "skills", "steering", "agents"];
    let found: Vec<String> = integration_dirs
        .iter()
        .filter(|d| dir_exists(&kiro_root.join(d)))
        .map(|d| format!(".kiro/{d}/"))
        .collect();

    if !found.is_empty()
        && !sources
            .iter()
            .any(|s| s.system == "kiro" && s.status == "artifacts-present")
        && sources.is_empty()
    {
        sources.push(SpecSource {
            kind: "tool-integration".to_string(),
            system: "kiro".to_string(),
            root_path: rel_path(repo_root, &kiro_root),
            confidence: "low".to_string(),
            status: "installed-only".to_string(),
            evidence: found,
            children: vec![],
            features: None,
        });
    }

    sources
}

fn detect_qoder(repo_root: &Path) -> Vec<SpecSource> {
    let mut sources = Vec::new();
    let qoder_root = repo_root.join(".qoder");

    if !dir_exists(&qoder_root) {
        return sources;
    }

    // Native spec artifacts in .qoder/specs/
    let qoder_specs_dir = qoder_root.join("specs");
    if dir_exists(&qoder_specs_dir) {
        let spec_files: Vec<String> = list_files(&qoder_specs_dir)
            .into_iter()
            .filter(|f| f.ends_with(".md"))
            .collect();

        if !spec_files.is_empty() {
            let artifacts: Vec<SpecArtifact> = spec_files
                .iter()
                .map(|f| SpecArtifact {
                    artifact_type: infer_artifact_type(f).to_string(),
                    path: rel_path(repo_root, &qoder_specs_dir.join(f)),
                })
                .collect();
            let evidence: Vec<String> = spec_files
                .iter()
                .map(|f| format!(".qoder/specs/{f}"))
                .collect();

            sources.push(SpecSource {
                kind: "native-tool".to_string(),
                system: "qoder".to_string(),
                root_path: rel_path(repo_root, &qoder_specs_dir),
                confidence: "high".to_string(),
                status: "artifacts-present".to_string(),
                evidence,
                children: artifacts,
                features: None,
            });
        }
    }

    // Integration dirs
    let integration_dirs = ["commands", "skills", "rules"];
    let found: Vec<String> = integration_dirs
        .iter()
        .filter(|d| dir_exists(&qoder_root.join(d)))
        .map(|d| format!(".qoder/{d}/"))
        .collect();

    if !found.is_empty() {
        sources.push(SpecSource {
            kind: "tool-integration".to_string(),
            system: "qoder".to_string(),
            root_path: rel_path(repo_root, &qoder_root),
            confidence: "low".to_string(),
            status: "installed-only".to_string(),
            evidence: found,
            children: vec![],
            features: None,
        });
    }

    sources
}

fn detect_openspec(repo_root: &Path) -> Vec<SpecSource> {
    let mut sources = Vec::new();
    let openspec_root = repo_root.join("openspec");

    if !dir_exists(&openspec_root) {
        return sources;
    }

    let mut evidence = Vec::new();
    let mut artifacts = Vec::new();

    if file_exists(&openspec_root.join("config.yaml")) {
        evidence.push("openspec/config.yaml".to_string());
        artifacts.push(SpecArtifact {
            artifact_type: "config".to_string(),
            path: "openspec/config.yaml".to_string(),
        });
    }

    let specs_dir = openspec_root.join("specs");
    if dir_exists(&specs_dir) {
        for domain in list_dirs(&specs_dir) {
            let domain_dir = specs_dir.join(&domain);
            for file in list_files(&domain_dir) {
                if file.ends_with(".md") {
                    artifacts.push(SpecArtifact {
                        artifact_type: infer_artifact_type(&file).to_string(),
                        path: rel_path(repo_root, &domain_dir.join(&file)),
                    });
                }
            }
            evidence.push(format!("openspec/specs/{domain}/"));
        }
    }

    let changes_dir = openspec_root.join("changes");
    if dir_exists(&changes_dir) {
        for change in list_dirs(&changes_dir) {
            if change == "archive" {
                evidence.push("openspec/changes/archive/ (archived)".to_string());
                continue;
            }
            let change_dir = changes_dir.join(&change);
            for file in list_files(&change_dir) {
                if file.ends_with(".md") {
                    artifacts.push(SpecArtifact {
                        artifact_type: infer_artifact_type(&file).to_string(),
                        path: rel_path(repo_root, &change_dir.join(&file)),
                    });
                }
            }
            let change_specs = change_dir.join("specs");
            if dir_exists(&change_specs) {
                for domain in list_dirs(&change_specs) {
                    for file in list_files(&change_specs.join(&domain)) {
                        if file.ends_with(".md") {
                            artifacts.push(SpecArtifact {
                                artifact_type: infer_artifact_type(&file).to_string(),
                                path: rel_path(
                                    repo_root,
                                    &change_specs.join(&domain).join(&file),
                                ),
                            });
                        }
                    }
                }
            }
            evidence.push(format!("openspec/changes/{change}/"));
        }
    }

    let has_high = artifacts.iter().any(|a| a.artifact_type != "config");
    let confidence = if has_high { "high" } else { "medium" };
    let status = if has_high {
        "artifacts-present"
    } else {
        "installed-only"
    };

    sources.push(SpecSource {
        kind: "framework".to_string(),
        system: "openspec".to_string(),
        root_path: rel_path(repo_root, &openspec_root),
        confidence: confidence.to_string(),
        status: status.to_string(),
        evidence,
        children: artifacts,
        features: None,
    });

    sources
}

fn detect_spec_kit(repo_root: &Path) -> Vec<SpecSource> {
    let mut sources = Vec::new();
    let specify_root = repo_root.join(".specify");
    let specs_root = repo_root.join("specs");

    let mut has_framework = false;
    let mut evidence = Vec::new();
    let mut artifacts = Vec::new();

    if dir_exists(&specify_root) {
        has_framework = true;
        let constitution = specify_root.join("memory").join("constitution.md");
        if file_exists(&constitution) {
            evidence.push(".specify/memory/constitution.md".to_string());
            artifacts.push(SpecArtifact {
                artifact_type: "context".to_string(),
                path: ".specify/memory/constitution.md".to_string(),
            });
        }
        for dir in &["templates", "presets", "extensions"] {
            if dir_exists(&specify_root.join(dir)) {
                evidence.push(format!(".specify/{dir}/"));
            }
        }

        let specify_specs = specify_root.join("specs");
        if dir_exists(&specify_specs) {
            for feature in list_dirs(&specify_specs) {
                let feature_dir = specify_specs.join(&feature);
                for file in list_files(&feature_dir) {
                    if file.ends_with(".md") {
                        artifacts.push(SpecArtifact {
                            artifact_type: infer_artifact_type(&file).to_string(),
                            path: rel_path(repo_root, &feature_dir.join(&file)),
                        });
                    }
                }
                evidence.push(format!(".specify/specs/{feature}/"));
            }
        }
    }

    if dir_exists(&specs_root) {
        let re = regex::Regex::new(
            r"(?i)^(spec|plan|tasks|data-model|research|quickstart)\.md$",
        )
        .unwrap();
        for feature in list_dirs(&specs_root) {
            let feature_dir = specs_root.join(&feature);
            let files = list_files(&feature_dir);
            let has_spec_kit_files = files.iter().any(|f| re.is_match(f))
                || dir_exists(&feature_dir.join("contracts"));

            if has_spec_kit_files {
                for file in &files {
                    if file.ends_with(".md") {
                        artifacts.push(SpecArtifact {
                            artifact_type: infer_artifact_type(file).to_string(),
                            path: rel_path(repo_root, &feature_dir.join(file)),
                        });
                    }
                }
                evidence.push(format!("specs/{feature}/"));
                has_framework = true;
            }
        }
    }

    if has_framework || !artifacts.is_empty() {
        let has_artifacts = artifacts
            .iter()
            .any(|a| a.artifact_type != "context" && a.artifact_type != "config");
        sources.push(SpecSource {
            kind: "framework".to_string(),
            system: "spec-kit".to_string(),
            root_path: if dir_exists(&specify_root) {
                rel_path(repo_root, &specify_root)
            } else {
                "specs".to_string()
            },
            confidence: if has_artifacts { "high" } else { "medium" }.to_string(),
            status: if has_artifacts {
                "artifacts-present"
            } else {
                "installed-only"
            }
            .to_string(),
            evidence,
            children: artifacts,
            features: None,
        });
    }

    sources
}

fn detect_bmad(repo_root: &Path) -> Vec<SpecSource> {
    let mut sources = Vec::new();
    let bmad_root = repo_root.join("_bmad");
    let bmad_output = repo_root.join("_bmad-output");

    // BMAD v6
    if dir_exists(&bmad_root) || dir_exists(&bmad_output) {
        let mut evidence = Vec::new();
        let mut artifacts = Vec::new();

        if dir_exists(&bmad_root) {
            evidence.push("_bmad/".to_string());
            for dir in &["_config", "core", "bmm"] {
                if dir_exists(&bmad_root.join(dir)) {
                    evidence.push(format!("_bmad/{dir}/"));
                }
            }
        }

        if dir_exists(&bmad_output) {
            evidence.push("_bmad-output/".to_string());
            let planning_dir = bmad_output.join("planning-artifacts");
            if dir_exists(&planning_dir) {
                for file in list_files(&planning_dir) {
                    if file.ends_with(".md") {
                        artifacts.push(SpecArtifact {
                            artifact_type: infer_artifact_type(&file).to_string(),
                            path: rel_path(repo_root, &planning_dir.join(&file)),
                        });
                    }
                }
                let epics_dir = planning_dir.join("epics");
                if dir_exists(&epics_dir) {
                    for file in list_files(&epics_dir) {
                        if file.ends_with(".md") {
                            artifacts.push(SpecArtifact {
                                artifact_type: "epic".to_string(),
                                path: rel_path(repo_root, &epics_dir.join(&file)),
                            });
                        }
                    }
                    evidence.push("_bmad-output/planning-artifacts/epics/".to_string());
                }
            }
            if file_exists(&bmad_output.join("project-context.md")) {
                artifacts.push(SpecArtifact {
                    artifact_type: "context".to_string(),
                    path: "_bmad-output/project-context.md".to_string(),
                });
                evidence.push("_bmad-output/project-context.md".to_string());
            }
            if dir_exists(&bmad_output.join("implementation-artifacts")) {
                evidence.push("_bmad-output/implementation-artifacts/".to_string());
            }
        }

        let has_high = !artifacts.is_empty();
        sources.push(SpecSource {
            kind: "framework".to_string(),
            system: "bmad".to_string(),
            root_path: if dir_exists(&bmad_output) {
                "_bmad-output".to_string()
            } else {
                "_bmad".to_string()
            },
            confidence: if has_high { "high" } else { "medium" }.to_string(),
            status: if has_high {
                "artifacts-present"
            } else {
                "installed-only"
            }
            .to_string(),
            evidence,
            children: artifacts,
            features: None,
        });
    }

    // BMAD legacy/brownfield
    if !dir_exists(&bmad_root) && !dir_exists(&bmad_output) {
        let docs_dir = repo_root.join("docs");
        if dir_exists(&docs_dir) {
            let mut evidence = Vec::new();
            let mut artifacts = Vec::new();

            let legacy_files: [(&str, &str); 4] = [
                ("prd.md", "prd"),
                ("architecture.md", "architecture"),
                ("architcture.md", "architecture"),
                ("brownfield-architecture.md", "architecture"),
            ];
            for file in list_files(&docs_dir) {
                let normalized = file.to_lowercase();
                if let Some((_, artifact_type)) = legacy_files.iter().find(|(name, _)| normalized == *name) {
                    let artifact_type = artifact_type.to_string();
                    artifacts.push(SpecArtifact {
                        artifact_type,
                        path: format!("docs/{file}"),
                    });
                    evidence.push(format!("docs/{file}"));
                }
            }

            for dir_name in &["prd", "PRD"] {
                let prd_dir = docs_dir.join(dir_name);
                if dir_exists(&prd_dir) {
                    for file in list_files(&prd_dir) {
                        if file.ends_with(".md") {
                            artifacts.push(SpecArtifact {
                                artifact_type: "prd".to_string(),
                                path: format!("docs/{dir_name}/{file}"),
                            });
                        }
                    }
                    evidence.push(format!("docs/{dir_name}/"));
                }
            }

            let bmad_tool_dirs = [
                (".claude/skills", "bmad-"),
                (".cursor/skills", "bmad-"),
                (".windsurf/skills", "bmad-"),
            ];

            let mut has_bmad_tool = false;
            for (base, prefix) in &bmad_tool_dirs {
                let dir = repo_root.join(base);
                if dir_exists(&dir) {
                    let entries: Vec<String> = list_dirs(&dir)
                        .into_iter()
                        .filter(|d| d.starts_with(prefix))
                        .collect();
                    if !entries.is_empty() {
                        has_bmad_tool = true;
                        evidence.push(format!("{base}/{}/", entries[0]));
                    }
                }
            }

            if !artifacts.is_empty() {
                sources.push(SpecSource {
                    kind: "framework".to_string(),
                    system: "bmad".to_string(),
                    root_path: "docs".to_string(),
                    confidence: if has_bmad_tool {
                        "medium".to_string()
                    } else {
                        "low".to_string()
                    },
                    status: "legacy".to_string(),
                    evidence,
                    children: artifacts,
                    features: None,
                });
            }
        }
    }

    sources
}

fn detect_tool_integrations(repo_root: &Path, existing: &[SpecSource]) -> Vec<SpecSource> {
    let mut sources = Vec::new();
    let already: std::collections::HashSet<&str> =
        existing.iter().map(|s| s.system.as_str()).collect();

    // OpenSpec integrations
    if !already.contains("openspec") {
        let checks: Vec<(&str, &str)> = vec![
            (".kiro/prompts", "opsx-"),
            (".kiro/skills", "openspec-"),
            (".qoder/commands/opsx", ""),
            (".qoder/skills", "openspec-"),
            (".claude/skills", "openspec-"),
            (".cursor/commands", "openspec-"),
            (".windsurf/workflows", "openspec-"),
        ];

        let mut integrations = Vec::new();
        for (dir, prefix) in &checks {
            let full_dir = repo_root.join(dir);
            if !dir_exists(&full_dir) {
                continue;
            }
            if prefix.is_empty() {
                integrations.push(format!("{dir}/"));
            } else {
                let mut entries = list_dirs(&full_dir);
                entries.extend(list_files(&full_dir));
                let matches: Vec<&String> =
                    entries.iter().filter(|e| e.starts_with(prefix)).collect();
                if !matches.is_empty() {
                    integrations.push(format!("{dir}/{}", matches[0]));
                }
            }
        }

        if !integrations.is_empty() {
            sources.push(SpecSource {
                kind: "tool-integration".to_string(),
                system: "openspec".to_string(),
                root_path: integrations[0].clone(),
                confidence: "low".to_string(),
                status: "installed-only".to_string(),
                evidence: integrations,
                children: vec![],
                features: None,
            });
        }
    }

    // Spec Kit integrations
    if !already.contains("spec-kit") {
        let tool_dirs = [
            ".qoder/commands",
            ".kiro/prompts",
            ".claude/commands",
            ".cursor/commands",
            ".windsurf/workflows",
            ".github/agents",
            ".opencode/command",
            ".trae/rules",
        ];

        let mut integrations = Vec::new();
        let re = regex::Regex::new(r"(?i)speckit|spec.kit|specify").unwrap();

        for dir in &tool_dirs {
            let full_dir = repo_root.join(dir);
            if dir_exists(&full_dir) {
                let mut entries = list_files(&full_dir);
                entries.extend(list_dirs(&full_dir));
                let matches: Vec<&String> = entries.iter().filter(|e| re.is_match(e)).collect();
                if !matches.is_empty() {
                    integrations.push(format!("{dir}/{}", matches[0]));
                }
            }
        }

        if !integrations.is_empty() {
            sources.push(SpecSource {
                kind: "tool-integration".to_string(),
                system: "spec-kit".to_string(),
                root_path: integrations[0].clone(),
                confidence: "low".to_string(),
                status: "installed-only".to_string(),
                evidence: integrations,
                children: vec![],
                features: None,
            });
        }
    }

    sources
}

// ── Public API ─────────────────────────────────────────────────────────────

pub fn detect_spec_sources(repo_root: &Path) -> Result<SpecDetectionReport, String> {
    let mut warnings = Vec::new();
    let mut sources = Vec::new();

    macro_rules! try_detect {
        ($name:expr, $func:expr) => {
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| $func)) {
                Ok(result) => sources.extend(result),
                Err(_) => warnings.push(format!("{} detection failed", $name)),
            }
        };
    }

    try_detect!("Kiro", detect_kiro(repo_root));
    try_detect!("Qoder", detect_qoder(repo_root));
    try_detect!("OpenSpec", detect_openspec(repo_root));
    try_detect!("Spec Kit", detect_spec_kit(repo_root));
    try_detect!("BMAD", detect_bmad(repo_root));

    // Cross-tool integrations
    let tool_sources = detect_tool_integrations(repo_root, &sources);
    sources.extend(tool_sources);

    Ok(SpecDetectionReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        sources,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> TempDir {
        TempDir::new().unwrap()
    }

    fn mkdirp(path: &Path) {
        fs::create_dir_all(path).unwrap();
    }

    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            mkdirp(parent);
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn detects_kiro_native_with_features() {
        let tmp = setup();
        let root = tmp.path();
        write_file(
            &root.join(".kiro/specs/auth/requirements.md"),
            "# Auth requirements",
        );
        write_file(&root.join(".kiro/specs/auth/design.md"), "# Auth design");
        write_file(&root.join(".kiro/specs/auth/tasks.md"), "# Auth tasks");
        write_file(
            &root.join(".kiro/specs/auth/.config.kiro"),
            r#"{"specId":"abc123","workflowType":"design-first","specType":"feature"}"#,
        );

        let report = detect_spec_sources(root).unwrap();
        let kiro = report
            .sources
            .iter()
            .find(|s| s.system == "kiro" && s.kind == "native-tool")
            .unwrap();

        assert_eq!(kiro.confidence, "high");
        assert_eq!(kiro.status, "artifacts-present");
        assert_eq!(kiro.children.len(), 3);

        let features = kiro.features.as_ref().unwrap();
        assert_eq!(features.len(), 1);
        assert_eq!(features[0].name, "auth");
        let config = features[0].config_kiro.as_ref().unwrap();
        assert_eq!(config.spec_id, "abc123");
        assert_eq!(config.workflow_type.as_deref(), Some("design-first"));
        assert_eq!(config.spec_type.as_deref(), Some("feature"));
    }

    #[test]
    fn detects_kiro_installed_only() {
        let tmp = setup();
        let root = tmp.path();
        mkdirp(&root.join(".kiro/specs"));

        let report = detect_spec_sources(root).unwrap();
        let kiro = report.sources.iter().find(|s| s.system == "kiro").unwrap();

        assert_eq!(kiro.kind, "native-tool");
        assert_eq!(kiro.status, "installed-only");
        assert_eq!(kiro.confidence, "medium");
    }

    #[test]
    fn detects_kiro_integration_only() {
        let tmp = setup();
        let root = tmp.path();
        mkdirp(&root.join(".kiro/prompts"));
        mkdirp(&root.join(".kiro/skills"));

        let report = detect_spec_sources(root).unwrap();
        let kiro = report.sources.iter().find(|s| s.system == "kiro").unwrap();

        assert_eq!(kiro.kind, "tool-integration");
        assert_eq!(kiro.status, "installed-only");
        assert_eq!(kiro.confidence, "low");
    }

    #[test]
    fn detects_qoder_native_specs() {
        let tmp = setup();
        let root = tmp.path();
        write_file(
            &root.join(".qoder/specs/my-feature.md"),
            "# My feature spec",
        );
        mkdirp(&root.join(".qoder/commands"));

        let report = detect_spec_sources(root).unwrap();
        let native = report
            .sources
            .iter()
            .find(|s| s.system == "qoder" && s.kind == "native-tool")
            .unwrap();
        assert_eq!(native.confidence, "high");
        assert_eq!(native.status, "artifacts-present");
        assert_eq!(native.children.len(), 1);

        let integration = report
            .sources
            .iter()
            .find(|s| s.system == "qoder" && s.kind == "tool-integration")
            .unwrap();
        assert_eq!(integration.status, "installed-only");
    }

    #[test]
    fn detects_qoder_integration_only() {
        let tmp = setup();
        let root = tmp.path();
        mkdirp(&root.join(".qoder/commands"));
        mkdirp(&root.join(".qoder/skills"));

        let report = detect_spec_sources(root).unwrap();
        let qoder = report
            .sources
            .iter()
            .find(|s| s.system == "qoder")
            .unwrap();
        assert_eq!(qoder.kind, "tool-integration");
        assert_eq!(qoder.status, "installed-only");
    }

    #[test]
    fn detects_openspec_with_artifacts() {
        let tmp = setup();
        let root = tmp.path();
        write_file(&root.join("openspec/config.yaml"), "name: test");
        write_file(&root.join("openspec/specs/auth/spec.md"), "# Auth spec");

        let report = detect_spec_sources(root).unwrap();
        let os = report
            .sources
            .iter()
            .find(|s| s.system == "openspec" && s.kind == "framework")
            .unwrap();
        assert_eq!(os.confidence, "high");
        assert_eq!(os.status, "artifacts-present");
    }

    #[test]
    fn detects_bmad_v6() {
        let tmp = setup();
        let root = tmp.path();
        mkdirp(&root.join("_bmad/_config"));
        write_file(
            &root.join("_bmad-output/planning-artifacts/PRD.md"),
            "# PRD",
        );
        write_file(&root.join("_bmad-output/project-context.md"), "# Context");

        let report = detect_spec_sources(root).unwrap();
        let bmad = report
            .sources
            .iter()
            .find(|s| s.system == "bmad" && s.kind == "framework")
            .unwrap();
        assert_eq!(bmad.confidence, "high");
        assert_eq!(bmad.status, "artifacts-present");
    }

    #[test]
    fn ignores_adr_only_repos_for_bmad_legacy_detection() {
        let tmp = setup();
        let root = tmp.path();
        write_file(&root.join("docs/adr/0001-example.md"), "# ADR");

        let report = detect_spec_sources(root).unwrap();
        assert!(!report.sources.iter().any(|s| s.system == "bmad"));
    }

    #[test]
    fn supports_multiple_sources() {
        let tmp = setup();
        let root = tmp.path();
        write_file(
            &root.join(".kiro/specs/auth/requirements.md"),
            "# Req",
        );
        write_file(&root.join("openspec/specs/domain/spec.md"), "# Spec");
        write_file(&root.join("openspec/config.yaml"), "name: test");
        mkdirp(&root.join(".qoder/commands"));

        let report = detect_spec_sources(root).unwrap();
        assert!(report.sources.iter().any(|s| s.system == "kiro"));
        assert!(report.sources.iter().any(|s| s.system == "openspec"));
        assert!(report.sources.iter().any(|s| s.system == "qoder"));
    }

    #[test]
    fn bare_repo_returns_empty() {
        let tmp = setup();
        let report = detect_spec_sources(tmp.path()).unwrap();
        assert!(report.sources.is_empty());
        assert!(report.warnings.is_empty());
    }
}
