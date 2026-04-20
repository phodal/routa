//! `routa review security` command orchestration.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use routa_core::state::AppState;

use super::acp_runner::{call_security_specialist_via_acp, resolve_security_provider};
use super::aggregator::merge_specialist_findings;
use super::candidate_collector::build_security_review_payload;
use super::dispatch::dispatch_security_specialists;
use super::output::{print_pretty_json, print_review_result};
use super::shared::{
    load_dotenv, load_specialist_by_id, resolve_repo_root, ReviewAnalyzeOptions,
    SecurityReviewPayload, SECURITY_REVIEW_HOME_DIR,
};

pub async fn security(state: &AppState, options: ReviewAnalyzeOptions<'_>) -> Result<(), String> {
    let full_path = routa_core::shell_env::full_path();
    std::env::set_var("PATH", full_path);

    load_dotenv();

    let repo_root = resolve_repo_root(options.repo_path)?;
    let payload =
        build_security_review_payload(&repo_root, options.base, options.head, options.rules_file)?;

    if options.payload_only {
        print_pretty_json(&payload, "security review payload")?;
        return Ok(());
    }

    let _acp_runtime_env = SecurityAcpRuntimeEnv::install(&repo_root)?;
    let specialist = load_specialist_by_id("security-reviewer", options.specialist_dir)?;

    let (dispatch_plan, specialist_reports) =
        dispatch_security_specialists(state, options.specialist_dir, &payload, options.verbose)
            .await?;
    let pre_merged_findings =
        merge_specialist_findings(&payload.pre_merged_findings, &specialist_reports);

    let mut final_payload = payload;
    final_payload.specialist_dispatch_plan = dispatch_plan;
    final_payload.specialist_reports = specialist_reports;
    final_payload.pre_merged_findings = pre_merged_findings;

    let prompt = build_security_specialist_prompt(&final_payload)?;
    let provider = resolve_security_provider(&specialist);

    if options.verbose {
        println!(
            "── Security Review Specialist: {} (provider: {}) ──",
            specialist.id, provider
        );
    }

    let final_output = call_security_specialist_via_acp(
        state,
        &specialist,
        &prompt,
        options.verbose,
        &provider,
        &final_payload.repo_root,
    )
    .await?
    .trim()
    .to_string();
    if final_output.is_empty() {
        return Err("Security review completed without producing an output.".to_string());
    }

    print_review_result(
        "Security Review Result",
        &final_output,
        options.as_json,
        "security review output",
    )?;

    Ok(())
}

struct SecurityAcpRuntimeEnv {
    home: Option<OsString>,
    xdg_config_home: Option<OsString>,
    xdg_data_home: Option<OsString>,
    xdg_cache_home: Option<OsString>,
    enabled: bool,
}

impl SecurityAcpRuntimeEnv {
    fn install(repo_root: &Path) -> Result<Self, String> {
        let acp_home = repo_root.join(SECURITY_REVIEW_HOME_DIR).join("acp");
        let previous_home = std::env::var_os("HOME");
        let previous_xdg_config_home = std::env::var_os("XDG_CONFIG_HOME");
        let previous_xdg_data_home = std::env::var_os("XDG_DATA_HOME");
        let previous_xdg_cache_home = std::env::var_os("XDG_CACHE_HOME");

        if !needs_isolated_acp_runtime() {
            return Ok(Self {
                home: None,
                xdg_config_home: None,
                xdg_data_home: None,
                xdg_cache_home: None,
                enabled: false,
            });
        }

        let acp_runtime_env = prepare_isolated_acp_runtime(&acp_home, previous_home.as_deref())?;

        std::env::set_var("HOME", &acp_runtime_env.home_dir);
        std::env::set_var("XDG_CONFIG_HOME", &acp_runtime_env.xdg_config_home);
        std::env::set_var("XDG_DATA_HOME", &acp_runtime_env.xdg_data_home);
        std::env::set_var("XDG_CACHE_HOME", &acp_runtime_env.xdg_cache_home);

        Ok(Self {
            home: previous_home,
            xdg_config_home: previous_xdg_config_home,
            xdg_data_home: previous_xdg_data_home,
            xdg_cache_home: previous_xdg_cache_home,
            enabled: true,
        })
    }
}

impl Drop for SecurityAcpRuntimeEnv {
    fn drop(&mut self) {
        if !self.enabled {
            return;
        }

        if let Some(home) = &self.home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }

        if let Some(xdg_config_home) = &self.xdg_config_home {
            std::env::set_var("XDG_CONFIG_HOME", xdg_config_home);
        } else {
            std::env::remove_var("XDG_CONFIG_HOME");
        }

        if let Some(xdg_data_home) = &self.xdg_data_home {
            std::env::set_var("XDG_DATA_HOME", xdg_data_home);
        } else {
            std::env::remove_var("XDG_DATA_HOME");
        }

        if let Some(xdg_cache_home) = &self.xdg_cache_home {
            std::env::set_var("XDG_CACHE_HOME", xdg_cache_home);
        } else {
            std::env::remove_var("XDG_CACHE_HOME");
        }
    }
}

#[derive(Debug)]
struct IsolatedAcpRuntimeHome {
    home_dir: PathBuf,
    xdg_config_home: PathBuf,
    xdg_data_home: PathBuf,
    xdg_cache_home: PathBuf,
}

fn needs_isolated_acp_runtime() -> bool {
    let base_home = match std::env::var_os("HOME") {
        Some(home) => PathBuf::from(home),
        None => dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
    };
    !is_writable_with_probe(&base_home.join(".config"))
        || !is_writable_with_probe(&base_home.join(".local").join("share"))
        || !is_writable_with_probe(&base_home.join(".cache"))
}

fn prepare_isolated_acp_runtime(
    acp_home: &Path,
    fallback_home: Option<&std::ffi::OsStr>,
) -> Result<IsolatedAcpRuntimeHome, String> {
    let xdg_config_home = acp_home.join(".config");
    let xdg_data_home = acp_home.join(".local").join("share");
    let xdg_cache_home = acp_home.join(".cache");

    for dir in [&xdg_config_home, &xdg_data_home, &xdg_cache_home] {
        fs::create_dir_all(dir).map_err(|err| {
            format!(
                "Failed to prepare isolated ACP runtime dir {}: {}",
                dir.display(),
                err
            )
        })?;
    }

    if let Some(raw_home) = fallback_home {
        let home_dir = Path::new(raw_home);
        let source_entries = [
            home_dir.join(".config").join("opencode"),
            home_dir.join(".local").join("share").join("opencode"),
            home_dir.join(".cache").join("opencode"),
        ];
        for source in source_entries {
            if !source.exists() {
                continue;
            }
            let rel = source
                .strip_prefix(home_dir)
                .map_err(|err| format!("Failed to normalize ACP source path: {err}"))?;
            let destination = acp_home.join(rel);
            if source.is_dir() {
                copy_dir_recursive(&source, &destination)?;
            } else {
                copy_file_with_parent(&source, &destination)?;
            }
        }
    }

    Ok(IsolatedAcpRuntimeHome {
        home_dir: acp_home.to_path_buf(),
        xdg_config_home,
        xdg_data_home,
        xdg_cache_home,
    })
}

fn is_writable_with_probe(path: &Path) -> bool {
    if let Err(err) = fs::create_dir_all(path) {
        eprintln!("Failed to create probe path {}: {}", path.display(), err);
        return false;
    }

    let probe = path.join(".routa-write-probe");
    match fs::write(&probe, b"ok") {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn copy_file_with_parent(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Failed to create destination parent {}: {}",
                parent.display(),
                err
            )
        })?;
    }

    fs::copy(src, dst).map_err(|err| {
        format!(
            "Failed to copy file from {} to {}: {}",
            src.display(),
            dst.display(),
            err
        )
    })?;
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|err| {
        format!(
            "Failed to create destination dir {}: {}",
            dst.display(),
            err
        )
    })?;

    for entry in src
        .read_dir()
        .map_err(|err| format!("Failed to read source dir {}: {}", src.display(), err))?
    {
        let entry = entry
            .map_err(|err| format!("Failed to read source entry in {}: {}", src.display(), err))?;
        let source_path = entry.path();
        let destination_path = dst.join(entry.file_name());

        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else if source_path.is_file() {
            copy_file_with_parent(&source_path, &destination_path)?;
        }
    }
    Ok(())
}

fn build_security_specialist_prompt(payload: &SecurityReviewPayload) -> Result<String, String> {
    let payload_json = serde_json::to_string_pretty(payload)
        .map_err(|err| format!("Failed to serialize security review payload: {err}"))?;

    Ok([
        "You are running a tool-driven security review.",
        "You are the final aggregation specialist.",
        "Treat this payload as the primary evidence source.",
        "Do not rediscover the whole repository from scratch.",
        "Use the trace, candidate evidence pack, dynamic specialist outputs, and pre-merged findings when available.",
        "Validate all findings by source-to-sink reasoning and merge by root cause.",
        "Return the output exactly in the structure required by your specialist instructions.",
        "If dynamic specialist output is empty or unavailable, still produce a conservative output from evidence.",
        "## Security Review Payload",
        &payload_json,
    ]
    .join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::review::aggregator::build_pre_merged_findings_from_evidence;
    use crate::commands::review::candidate_collector::{
        heuristic_auth_candidates, preferred_tool_command,
    };
    use crate::commands::review::dispatch::{
        load_security_candidates_for_dispatch, select_security_specialist_workloads,
    };
    use crate::commands::review::shared::{
        load_config_snippets, SecurityCandidate, SecurityCandidateBucket, SecurityEvidencePack,
        SecurityRootFinding, SecuritySpecialistReport, SECURITY_REVIEW_VENV_DIR,
    };

    #[test]
    fn load_config_snippets_ignores_missing_files() {
        let temp_dir =
            std::env::temp_dir().join(format!("routa-review-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("temp dir should be created");
        std::fs::write(temp_dir.join("AGENTS.md"), "test").expect("fixture should be written");

        let snippets = load_config_snippets(&temp_dir);
        assert_eq!(snippets.len(), 1);
        assert_eq!(snippets[0].path, "AGENTS.md");

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn heuristic_auth_candidates_flags_route_without_auth() {
        let temp_dir =
            std::env::temp_dir().join(format!("routa-review-auth-{}", uuid::Uuid::new_v4()));
        let api_dir = temp_dir.join("src/app/api/demo");
        std::fs::create_dir_all(&api_dir).expect("api dir should be created");
        std::fs::write(
            api_dir.join("route.ts"),
            "export async function POST(req: Request) { return Response.json({ ok: true }); }",
        )
        .expect("fixture should be written");

        let candidates =
            heuristic_auth_candidates(&temp_dir, &[String::from("src/app/api/demo/route.ts")]);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].rule_id, "route-without-auth-signal");

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn heuristic_auth_candidates_ignores_route_with_auth_signal() {
        let temp_dir =
            std::env::temp_dir().join(format!("routa-review-auth-ok-{}", uuid::Uuid::new_v4()));
        let api_dir = temp_dir.join("src/app/api/demo");
        std::fs::create_dir_all(&api_dir).expect("api dir should be created");
        std::fs::write(
            api_dir.join("route.ts"),
            "export async function POST(req: Request) { if (!verifyAuth(req)) return new Response('Unauthorized', { status: 401 }); return Response.json({ ok: true }); }",
        )
        .expect("fixture should be written");

        let candidates =
            heuristic_auth_candidates(&temp_dir, &[String::from("src/app/api/demo/route.ts")]);
        assert!(candidates.is_empty());

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn preferred_tool_command_uses_local_security_review_venv_first() {
        let temp_dir =
            std::env::temp_dir().join(format!("routa-review-tool-{}", uuid::Uuid::new_v4()));
        let bin_dir = temp_dir.join(SECURITY_REVIEW_VENV_DIR).join("bin");
        std::fs::create_dir_all(&bin_dir).expect("bin dir should be created");
        let expected = bin_dir.join("pysemgrep");
        std::fs::write(&expected, "#!/bin/sh\n").expect("fixture should be written");

        let actual = preferred_tool_command(&temp_dir, &["pysemgrep", "semgrep"])
            .expect("local tool should be discovered");
        assert_eq!(actual, expected);

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn load_security_specialists_supports_capability_filtering() {
        let mut specialist_dir = Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf();
        while !specialist_dir.join("resources").is_dir() {
            assert!(specialist_dir.pop(), "workspace root should exist");
        }
        let specialist_dir = specialist_dir.join("resources/specialists");
        let specialists = load_security_candidates_for_dispatch(Some(
            specialist_dir
                .to_str()
                .expect("specialist dir path should be valid utf8"),
        ))
        .expect("load specialists");
        let mut has_auth = false;
        let mut has_command = false;
        for specialist in specialists {
            if specialist.id == "security-authentication-reviewer" {
                has_auth = true;
                let categories = specialist
                    .capabilities
                    .as_ref()
                    .expect("authentication specialist should declare capabilities")
                    .categories
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                assert!(categories.contains(&"authentication"));
            }
            if specialist.id == "security-command-injection-reviewer" {
                has_command = true;
                let categories = specialist
                    .capabilities
                    .as_ref()
                    .expect("command specialist should declare capabilities")
                    .categories
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>();
                assert!(categories.contains(&"command-injection"));
            }
        }
        assert!(has_auth);
        assert!(has_command);
    }

    #[test]
    fn select_security_specialist_workloads_matches_categories() {
        let payload = SecurityReviewPayload {
            repo_path: "/tmp".to_string(),
            repo_root: "/tmp".to_string(),
            base: "HEAD~1".to_string(),
            head: "HEAD".to_string(),
            changed_files: vec!["src/app/api/demo/route.ts".to_string()],
            diff_stat: String::new(),
            diff: String::new(),
            config_snippets: Vec::new(),
            review_rules: None,
            security_guidance: None,
            evidence_pack: SecurityEvidencePack {
                total_candidates: 2,
                buckets: vec![],
            },
            specialist_dispatch_plan: Vec::new(),
            specialist_reports: Vec::new(),
            pre_merged_findings: Vec::new(),
            tool_trace: Vec::new(),
            heuristic_candidates: vec![
                SecurityCandidate {
                    rule_id: "auth".to_string(),
                    category: "authentication".to_string(),
                    severity: "HIGH".to_string(),
                    summary: "auth".to_string(),
                    locations: vec!["route.ts:1".to_string()],
                    evidence: Vec::new(),
                },
                SecurityCandidate {
                    rule_id: "exec".to_string(),
                    category: "command-injection".to_string(),
                    severity: "HIGH".to_string(),
                    summary: "cmd".to_string(),
                    locations: vec!["route.ts:2".to_string()],
                    evidence: Vec::new(),
                },
                SecurityCandidate {
                    rule_id: "ignore".to_string(),
                    category: "other".to_string(),
                    severity: "LOW".to_string(),
                    summary: "noop".to_string(),
                    locations: vec!["route.ts:3".to_string()],
                    evidence: Vec::new(),
                },
            ],
            semgrep_candidates: vec![],
            fitness_review_context: None,
        };

        let mut specialist_dir = Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf();
        while !specialist_dir.join("resources").is_dir() {
            assert!(specialist_dir.pop(), "workspace root should exist");
        }
        let specialist_dir = specialist_dir.join("resources/specialists");
        let workloads = select_security_specialist_workloads(
            Some(
                specialist_dir
                    .to_str()
                    .expect("specialist dir path should be valid utf8"),
            ),
            &payload,
            false,
        )
        .expect("load workloads");

        assert!(!workloads.is_empty());
        assert_eq!(workloads.len(), 2);

        let mut assigned = workloads
            .iter()
            .map(|workload| workload.specialist_id.as_str())
            .collect::<Vec<_>>();
        assigned.sort();
        assert!(assigned.contains(&"security-authentication-reviewer"));
        assert!(assigned.contains(&"security-command-injection-reviewer"));
    }

    #[test]
    fn build_pre_merged_findings_from_evidence_adds_hints() {
        let pack = SecurityEvidencePack {
            total_candidates: 1,
            buckets: vec![SecurityCandidateBucket {
                category: "command-injection".to_string(),
                candidate_count: 1,
                candidates: vec![SecurityCandidate {
                    rule_id: "command-execution".to_string(),
                    category: "command-injection".to_string(),
                    severity: "HIGH".to_string(),
                    summary: "exec path".to_string(),
                    locations: vec!["src/app.rs:10".to_string()],
                    evidence: vec!["exec('id')".to_string()],
                }],
            }],
        };

        let findings = build_pre_merged_findings_from_evidence(&Some("policy".to_string()), &pack);

        assert!(!findings.is_empty());
        let base_finding = findings
            .iter()
            .find(|finding| finding.title == "command-injection: command-execution")
            .expect("command injection hint should be present");
        assert_eq!(base_finding.affected_locations, vec!["src/app.rs:10"]);
        assert_eq!(findings.len(), 2);
    }

    #[test]
    fn merge_specialist_findings_prefers_stronger_signals() {
        let pre_merged = vec![SecurityRootFinding {
            title: "Base finding".to_string(),
            severity: "MEDIUM".to_string(),
            root_cause: "privileged command path".to_string(),
            affected_locations: vec!["src/app.rs:1".to_string()],
            attack_path: "path-a".to_string(),
            why_it_matters: "impact".to_string(),
            guardrails_present: vec!["check".to_string()],
            recommended_fix: "baseline".to_string(),
            related_variants: vec!["a".to_string()],
            confidence: Some("LOW".to_string()),
        }];

        let reports = vec![SecuritySpecialistReport {
            specialist_id: "security-command-injection-reviewer".to_string(),
            status: "ok".to_string(),
            categories: vec!["command-injection".to_string()],
            findings: vec![SecurityRootFinding {
                title: "Specialist finding".to_string(),
                severity: "CRITICAL".to_string(),
                root_cause: "privileged command path".to_string(),
                affected_locations: vec!["src/app.rs:2".to_string()],
                attack_path: "path-a + tainted input".to_string(),
                why_it_matters: "critical".to_string(),
                guardrails_present: vec!["no guard".to_string()],
                recommended_fix: "sanitize input".to_string(),
                related_variants: vec!["variant-1".to_string()],
                confidence: Some("HIGH".to_string()),
            }],
            trace: vec!["ok".to_string()],
            parse_error: None,
            output_preview: String::new(),
        }];

        let merged = merge_specialist_findings(&pre_merged, &reports);
        assert_eq!(merged.len(), 1);
        let final_finding = &merged[0];
        assert_eq!(final_finding.severity, "CRITICAL");
        assert_eq!(final_finding.confidence, Some("HIGH".to_string()));
        assert!(final_finding
            .affected_locations
            .contains(&"src/app.rs:1".to_string()));
        assert!(final_finding
            .affected_locations
            .contains(&"src/app.rs:2".to_string()));
        assert!(final_finding
            .related_variants
            .contains(&"variant-1".to_string()));
    }
}
