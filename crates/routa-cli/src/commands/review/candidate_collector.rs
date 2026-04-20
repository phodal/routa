use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

use super::aggregator::{build_pre_merged_findings_from_evidence, build_security_evidence_pack};
use super::output::truncate;
use super::shared::{
    build_review_input_payload, find_command_in_path, SecurityCandidate, SecurityReviewPayload,
    ToolTrace, SECURITY_REVIEW_HOME_DIR, SECURITY_REVIEW_VENV_DIR, SECURITY_SEMGREP_RULES_PATH,
};

pub(crate) fn build_security_review_payload(
    repo_root: &Path,
    base: &str,
    head: &str,
    rules_file: Option<&str>,
) -> Result<SecurityReviewPayload, String> {
    let review_payload = build_review_input_payload(repo_root, base, head, rules_file)?;
    let security_guidance = load_security_guidance(repo_root);

    let mut tool_trace = Vec::new();
    note_ast_grep_availability(&mut tool_trace);
    let heuristic_candidates =
        collect_security_candidates(repo_root, &review_payload.changed_files, &mut tool_trace);
    let semgrep_candidates =
        collect_semgrep_candidates(repo_root, &review_payload.changed_files, &mut tool_trace);
    let evidence_pack = build_security_evidence_pack(&heuristic_candidates, &semgrep_candidates);
    let pre_merged_findings =
        build_pre_merged_findings_from_evidence(&security_guidance, &evidence_pack);
    let fitness_review_context = collect_fitness_review_context(
        repo_root,
        &review_payload.changed_files,
        base,
        &mut tool_trace,
    );

    Ok(SecurityReviewPayload {
        repo_path: review_payload.repo_path.clone(),
        repo_root: review_payload.repo_root.clone(),
        base: review_payload.base,
        head: review_payload.head,
        changed_files: review_payload.changed_files,
        diff_stat: review_payload.diff_stat,
        diff: review_payload.diff,
        config_snippets: review_payload.config_snippets,
        review_rules: review_payload.review_rules,
        security_guidance,
        evidence_pack,
        specialist_dispatch_plan: Vec::new(),
        specialist_reports: Vec::new(),
        pre_merged_findings,
        tool_trace,
        heuristic_candidates,
        semgrep_candidates,
        fitness_review_context,
    })
}

pub(crate) fn note_ast_grep_availability(tool_trace: &mut Vec<ToolTrace>) {
    let ast_grep = find_command_in_path("ast-grep").or_else(|| find_command_in_path("sg"));
    match ast_grep {
        Some(path) => tool_trace.push(ToolTrace {
            tool: "ast-grep".to_string(),
            status: "available".to_string(),
            details: format!("available at {}", path.display()),
        }),
        None => tool_trace.push(ToolTrace {
            tool: "ast-grep".to_string(),
            status: "unavailable".to_string(),
            details: "ast-grep/sg not installed".to_string(),
        }),
    }
}

fn load_security_guidance(repo_root: &Path) -> Option<String> {
    let path = repo_root.join("docs").join("fitness").join("security.md");
    if !path.exists() {
        return None;
    }
    std::fs::read_to_string(path)
        .ok()
        .map(|content| truncate(&content, 8_000))
}

fn collect_security_candidates(
    repo_root: &Path,
    changed_files: &[String],
    tool_trace: &mut Vec<ToolTrace>,
) -> Vec<SecurityCandidate> {
    let scoped_files: Vec<String> = changed_files
        .iter()
        .filter(|path| !is_security_review_tooling_file(path))
        .cloned()
        .collect();

    if scoped_files.is_empty() {
        tool_trace.push(ToolTrace {
            tool: "heuristic-scanner".to_string(),
            status: "skipped".to_string(),
            details: "Changed files only touch security review tooling".to_string(),
        });
        return Vec::new();
    }

    let mut candidates = Vec::new();

    maybe_push_candidate(
        repo_root,
        &scoped_files,
        "exec\\s*\\(|child_process\\.exec|execSync\\s*\\(",
        SecurityCandidate {
            rule_id: "command-execution".to_string(),
            category: "command-injection".to_string(),
            severity: "HIGH".to_string(),
            summary: "Changed code touches shell execution or command-launch paths.".to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        tool_trace,
        &mut candidates,
    );

    maybe_push_candidate(
        repo_root,
        &scoped_files,
        "dangerouslySetInnerHTML|marked\\.parse\\(",
        SecurityCandidate {
            rule_id: "html-rendering".to_string(),
            category: "xss".to_string(),
            severity: "HIGH".to_string(),
            summary: "Changed code touches HTML rendering from potentially untrusted content."
                .to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        tool_trace,
        &mut candidates,
    );

    maybe_push_candidate(
        repo_root,
        &scoped_files,
        "\\bfetch\\s*\\(",
        SecurityCandidate {
            rule_id: "outbound-fetch".to_string(),
            category: "ssrf".to_string(),
            severity: "HIGH".to_string(),
            summary: "Changed code touches outbound request paths.".to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        tool_trace,
        &mut candidates,
    );

    maybe_push_candidate_filtered(
        repo_root,
        &scoped_files,
        "baseUrl|ANTHROPIC_BASE_URL",
        SecurityCandidate {
            rule_id: "base-url-override".to_string(),
            category: "ssrf".to_string(),
            severity: "HIGH".to_string(),
            summary: "Changed backend or provider code touches base URL override paths."
                .to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        |entry| {
            let path = entry.split(':').next().unwrap_or_default();
            path.contains("/api/")
                || path.contains("/core/")
                || path.starts_with("crates/")
                || path.starts_with("docker/")
        },
        tool_trace,
        &mut candidates,
    );

    maybe_push_candidate(
        repo_root,
        &scoped_files,
        "bypassPermissions|dangerously-skip-permissions|allow-all-tools|no-ask-user",
        SecurityCandidate {
            rule_id: "permission-bypass".to_string(),
            category: "authorization".to_string(),
            severity: "CRITICAL".to_string(),
            summary: "Changed code touches tool permission bypass or auto-approval flags."
                .to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        tool_trace,
        &mut candidates,
    );

    maybe_push_candidate(
        repo_root,
        &scoped_files,
        "tools.call|tools/call|run shell|bash -lc|spawn\\(",
        SecurityCandidate {
            rule_id: "tool-execution".to_string(),
            category: "agent-tooling".to_string(),
            severity: "HIGH".to_string(),
            summary: "Changed code touches dynamic tool execution paths.".to_string(),
            locations: Vec::new(),
            evidence: Vec::new(),
        },
        tool_trace,
        &mut candidates,
    );

    let auth_candidates = heuristic_auth_candidates(repo_root, &scoped_files);
    for candidate in auth_candidates {
        candidates.push(candidate);
    }

    if candidates.is_empty() {
        tool_trace.push(ToolTrace {
            tool: "heuristic-scanner".to_string(),
            status: "ok".to_string(),
            details: "No heuristic security candidates found".to_string(),
        });
    } else {
        tool_trace.push(ToolTrace {
            tool: "heuristic-scanner".to_string(),
            status: "ok".to_string(),
            details: format!("Collected {} heuristic candidate(s)", candidates.len()),
        });
    }

    candidates
}

fn collect_semgrep_candidates(
    repo_root: &Path,
    changed_files: &[String],
    tool_trace: &mut Vec<ToolTrace>,
) -> Vec<SecurityCandidate> {
    if changed_files.is_empty() {
        tool_trace.push(ToolTrace {
            tool: "semgrep".to_string(),
            status: "skipped".to_string(),
            details: "No changed files; semgrep skipped".to_string(),
        });
        return Vec::new();
    }

    let semgrep_command = match preferred_semgrep_command(repo_root) {
        Some(path) => path,
        None => {
            tool_trace.push(ToolTrace {
                tool: "semgrep".to_string(),
                status: "unavailable".to_string(),
                details: "semgrep/pysemgrep command not found".to_string(),
            });
            return Vec::new();
        }
    };

    let rules_path = repo_root.join(SECURITY_SEMGREP_RULES_PATH);
    if !rules_path.exists() {
        tool_trace.push(ToolTrace {
            tool: "semgrep".to_string(),
            status: "missing-rules".to_string(),
            details: format!("Missing semgrep rules: {}", rules_path.display()),
        });
        return Vec::new();
    }

    let mut command = Command::new(&semgrep_command);
    command
        .arg("--config")
        .arg(&rules_path)
        .arg("--json")
        .arg("--timeout")
        .arg("20")
        .arg("--quiet")
        .arg("--error")
        .arg("--disable-version-check")
        .arg("--metrics")
        .arg("off");

    for path in changed_files {
        if is_security_review_tooling_file(path) {
            continue;
        }
        command.arg(path);
    }

    command.current_dir(repo_root);
    command.env("SEMGREP_SEND_METRICS", "off");
    command.env("SEMGREP_DISABLE_VERSION_CHECK", "1");
    command.env("SEMGREP_TIMEOUT", "20");
    command.env("SEMGREP_SUPPRESS_ERRORS", "1");
    command.env("SEMGREP_FORCE_COLOR", "0");
    command.env("SEMGREP_VERBOSE", "0");
    command.env("SEMGREP_LOG_LEVEL", "ERROR");

    let tool_home = security_review_tool_home(repo_root);
    let semgrep_cache = tool_home.join("semgrep");
    let _ = std::fs::create_dir_all(&semgrep_cache);
    command.env("SEMGREP_USER_DATA_FOLDER", &semgrep_cache);
    command.env("XDG_CACHE_HOME", tool_home.join(".cache"));
    command.env("XDG_CONFIG_HOME", tool_home.join(".config"));
    command.env("XDG_DATA_HOME", tool_home.join(".local").join("share"));

    if let Some(cert_file) = preferred_ssl_cert_file() {
        command.env("SSL_CERT_FILE", &cert_file);
        command.env("REQUESTS_CA_BUNDLE", &cert_file);
    }

    let output = match command.output() {
        Ok(output) => output,
        Err(err) => {
            tool_trace.push(ToolTrace {
                tool: "semgrep".to_string(),
                status: "failed".to_string(),
                details: format!("Failed to execute semgrep: {err}"),
            });
            return Vec::new();
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let exit_code = output
            .status
            .code()
            .map_or_else(|| "unknown".to_string(), |code| code.to_string());
        let details = match (stderr.is_empty(), stdout.is_empty()) {
            (false, false) => truncate(
                &format!("exit_code={exit_code} stderr:\n{stderr}\n\nstdout:\n{stdout}"),
                2_000,
            ),
            (false, true) => truncate(&format!("exit_code={exit_code} stderr: {stderr}"), 1_500),
            (true, false) => truncate(&format!("exit_code={exit_code} stdout: {stdout}"), 1_500),
            (true, true) => "semgrep failed without stderr/stdout output".to_string(),
        };
        tool_trace.push(ToolTrace {
            tool: "semgrep".to_string(),
            status: "error".to_string(),
            details,
        });
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let Ok(value) = serde_json::from_str::<Value>(&stdout) else {
        tool_trace.push(ToolTrace {
            tool: "semgrep".to_string(),
            status: "error".to_string(),
            details: "failed to parse semgrep JSON output".to_string(),
        });
        return Vec::new();
    };

    let Some(results) = value.get("results").and_then(|v| v.as_array()) else {
        tool_trace.push(ToolTrace {
            tool: "semgrep".to_string(),
            status: "ok".to_string(),
            details: "semgrep returned no results".to_string(),
        });
        return Vec::new();
    };

    let mut candidates = Vec::new();
    for result in results {
        let path = result
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let line = result
            .get("start")
            .and_then(|v| v.get("line"))
            .and_then(|v| v.as_i64())
            .unwrap_or_default();
        let check_id = result
            .get("check_id")
            .and_then(|v| v.as_str())
            .unwrap_or("semgrep.unknown")
            .to_string();
        let severity = result
            .get("extra")
            .and_then(|v| v.get("severity"))
            .and_then(|v| v.as_str())
            .unwrap_or("WARNING")
            .to_string();
        let message = result
            .get("extra")
            .and_then(|v| v.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("Semgrep finding")
            .to_string();
        let lines = result
            .get("extra")
            .and_then(|v| v.get("lines"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let category = infer_semgrep_category(&check_id, &message);

        candidates.push(SecurityCandidate {
            rule_id: check_id,
            category,
            severity,
            summary: message,
            locations: vec![if line > 0 {
                format!("{path}:{line}")
            } else {
                path
            }],
            evidence: if lines.is_empty() {
                Vec::new()
            } else {
                vec![truncate(&lines, 500)]
            },
        });
    }

    tool_trace.push(ToolTrace {
        tool: "semgrep".to_string(),
        status: "ok".to_string(),
        details: format!(
            "Collected {} semgrep candidate(s) via {}",
            candidates.len(),
            semgrep_command.display()
        ),
    });

    candidates
}

fn preferred_semgrep_command(repo_root: &Path) -> Option<PathBuf> {
    preferred_tool_command(repo_root, &["pysemgrep", "semgrep"])
}

fn preferred_ssl_cert_file() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("SSL_CERT_FILE") {
        return Some(PathBuf::from(path));
    }

    let fallback_paths = [
        "/etc/ssl/cert.pem",
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/pki/tls/certs/ca-bundle.crt",
    ];

    fallback_paths
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

fn preferred_entrix_command(repo_root: &Path) -> Option<PathBuf> {
    preferred_tool_command(repo_root, &["entrix"])
}

pub(crate) fn preferred_tool_command(repo_root: &Path, commands: &[&str]) -> Option<PathBuf> {
    for command in commands {
        let local_candidate = repo_root
            .join(SECURITY_REVIEW_VENV_DIR)
            .join("bin")
            .join(command);
        if local_candidate.is_file() {
            return Some(local_candidate);
        }
    }

    commands
        .iter()
        .find_map(|command| find_command_in_path(command))
}

fn security_review_tool_home(repo_root: &Path) -> PathBuf {
    repo_root.join(SECURITY_REVIEW_HOME_DIR)
}

fn infer_semgrep_category(check_id: &str, message: &str) -> String {
    let lowered = format!("{} {}", check_id.to_lowercase(), message.to_lowercase());
    if lowered.contains("command")
        || lowered.contains("exec")
        || lowered.contains("shell")
        || lowered.contains("injection")
    {
        return "command-injection".to_string();
    }
    if lowered.contains("auth") || lowered.contains("permission") || lowered.contains("token") {
        return "authorization".to_string();
    }
    if lowered.contains("xss") || lowered.contains("html") {
        return "xss".to_string();
    }
    if lowered.contains("url")
        || lowered.contains("fetch")
        || lowered.contains("http")
        || lowered.contains("request")
    {
        return "ssrf".to_string();
    }
    "security".to_string()
}

fn maybe_push_candidate(
    repo_root: &Path,
    changed_files: &[String],
    pattern: &str,
    mut template: SecurityCandidate,
    tool_trace: &mut Vec<ToolTrace>,
    candidates: &mut Vec<SecurityCandidate>,
) {
    maybe_push_candidate_filtered(
        repo_root,
        changed_files,
        pattern,
        template.clone(),
        |_| true,
        tool_trace,
        candidates,
    );
    if template.evidence.is_empty() {
        template.evidence = vec![];
    }
}

fn maybe_push_candidate_filtered<F>(
    repo_root: &Path,
    changed_files: &[String],
    pattern: &str,
    mut template: SecurityCandidate,
    filter: F,
    tool_trace: &mut Vec<ToolTrace>,
    candidates: &mut Vec<SecurityCandidate>,
) where
    F: Fn(&str) -> bool,
{
    let matches = rg_search(repo_root, changed_files, pattern);
    if matches.is_empty() {
        return;
    }

    let filtered = matches
        .into_iter()
        .filter(|entry| filter(entry))
        .collect::<Vec<_>>();

    if filtered.is_empty() {
        return;
    }

    tool_trace.push(ToolTrace {
        tool: "rg".to_string(),
        status: "match".to_string(),
        details: format!("pattern={} matched {} locations", pattern, filtered.len()),
    });

    template.locations = filtered
        .iter()
        .map(|entry| compact_location(entry))
        .collect();
    template.evidence = filtered
        .iter()
        .take(5)
        .map(|entry| truncate(entry, 500))
        .collect();
    candidates.push(template);
}

fn rg_search(repo_root: &Path, changed_files: &[String], pattern: &str) -> Vec<String> {
    let mut command = Command::new("rg");
    command
        .arg("--line-number")
        .arg("--no-heading")
        .arg("--color")
        .arg("never")
        .arg(pattern)
        .current_dir(repo_root);

    for file in changed_files {
        if is_security_review_tooling_file(file) {
            continue;
        }
        command.arg(file);
    }

    match command.output() {
        Ok(output) if output.status.success() || !output.stdout.is_empty() => {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::to_string)
                .collect()
        }
        _ => Vec::new(),
    }
}

pub(crate) fn heuristic_auth_candidates(
    repo_root: &Path,
    changed_files: &[String],
) -> Vec<SecurityCandidate> {
    let mut candidates = Vec::new();
    for file in changed_files {
        if !file.ends_with("route.ts") && !file.ends_with("route.rs") {
            continue;
        }
        let full_path = repo_root.join(file);
        let Ok(content) = std::fs::read_to_string(&full_path) else {
            continue;
        };
        let lowered = content.to_lowercase();
        let has_session = lowered.contains("verify_auth")
            || lowered.contains("auth(")
            || lowered.contains("session")
            || lowered.contains("permission");
        if has_session {
            continue;
        }

        candidates.push(SecurityCandidate {
            rule_id: "route-without-auth-signal".to_string(),
            category: "authorization".to_string(),
            severity: "HIGH".to_string(),
            summary: "Route handler changed without obvious auth/session guard.".to_string(),
            locations: vec![file.clone()],
            evidence: vec![truncate(&content, 240)],
        });
    }
    candidates
}

fn compact_location(entry: &str) -> String {
    entry.split(':').take(2).collect::<Vec<_>>().join(":")
}

fn collect_fitness_review_context(
    repo_root: &Path,
    changed_files: &[String],
    base: &str,
    tool_trace: &mut Vec<ToolTrace>,
) -> Option<Value> {
    let mut filtered_files: Vec<String> = changed_files
        .iter()
        .filter(|path| !is_security_review_tooling_file(path))
        .cloned()
        .collect();
    if filtered_files.is_empty() {
        return None;
    }
    filtered_files.sort();
    filtered_files.dedup();

    let fitness_command = match preferred_entrix_command(repo_root) {
        Some(path) => path,
        None => {
            tool_trace.push(ToolTrace {
                tool: "entrix".to_string(),
                status: "unavailable".to_string(),
                details: "entrix command not found".to_string(),
            });
            return None;
        }
    };

    let mut command = Command::new(&fitness_command);
    command
        .arg("graph")
        .arg("review-context")
        .arg("--base")
        .arg(base)
        .arg("--head")
        .arg("HEAD")
        .arg("--json")
        .arg("--output")
        .arg("-");
    for path in &filtered_files {
        command.arg("--files").arg(path);
    }
    command.current_dir(repo_root);

    let output = match command.output() {
        Ok(output) => output,
        Err(err) => {
            tool_trace.push(ToolTrace {
                tool: "entrix".to_string(),
                status: "failed".to_string(),
                details: format!("Failed to execute entrix: {err}"),
            });
            return None;
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        tool_trace.push(ToolTrace {
            tool: "entrix".to_string(),
            status: "error".to_string(),
            details: if stderr.is_empty() {
                "entrix returned non-zero status".to_string()
            } else {
                truncate(&stderr, 1_500)
            },
        });
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    match serde_json::from_str::<Value>(&stdout) {
        Ok(value) => {
            tool_trace.push(ToolTrace {
                tool: "entrix".to_string(),
                status: "ok".to_string(),
                details: format!("Loaded review context via {}", fitness_command.display()),
            });
            Some(value)
        }
        Err(err) => {
            tool_trace.push(ToolTrace {
                tool: "entrix".to_string(),
                status: "error".to_string(),
                details: format!("Failed to parse entrix output: {err}"),
            });
            None
        }
    }
}

fn is_security_review_tooling_file(path: &str) -> bool {
    matches!(
        path,
        "crates/routa-cli/src/commands/review.rs"
            | "crates/routa-cli/src/main.rs"
            | "resources/specialists/review/security-reviewer.yaml"
    ) || path.starts_with("resources/specialists/review/")
}
