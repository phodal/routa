use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::process::Command;
use tokio::time::timeout;

const AUDIT_SPECIALIST_ID: &str = "agents-md-auditor";
const AUDIT_COMMAND_TIMEOUT_MS: u64 = 120_000;

fn value_to_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|raw| i64::try_from(raw).ok()))
        .or_else(|| value.as_f64().map(|raw| raw.round() as i64))
}

fn to_score(value: Option<&Value>) -> Option<i64> {
    let score = value.and_then(value_to_i64)?;
    if (0..=5).contains(&score) {
        Some(score)
    } else {
        None
    }
}

fn infer_overall(
    routing: i64,
    protection: i64,
    reflection: i64,
    verification: i64,
    has_agent_side_effects: bool,
) -> &'static str {
    let scores = [routing, protection, reflection, verification];

    if scores.iter().any(|score| *score <= 2) {
        return "不通过";
    }

    if has_agent_side_effects && (protection < 4 || verification < 4) {
        return "有条件通过";
    }

    if scores.iter().all(|score| *score >= 4) {
        return "通过";
    }

    if scores.iter().all(|score| *score > 1)
        && scores.iter().filter(|score| **score >= 3).count() >= 3
    {
        return "有条件通过";
    }

    "不通过"
}

fn build_heuristic_audit(
    source: &str,
    duration_ms: u64,
    provider: &str,
    error: Option<&str>,
) -> Value {
    let normalized = source.to_lowercase();
    let has_agent_side_effects = [
        "tool",
        "tools",
        "execute",
        "command",
        "write file",
        "修改",
        "执行命令",
        "调用工具",
        "发消息",
        "external system",
        "外部系统",
    ]
    .iter()
    .any(|signal| normalized.contains(signal));

    let routing = [
        normalized.contains("repository map")
            || normalized.contains("feature tree")
            || source.contains("目录"),
        normalized.contains("start here")
            || normalized.contains("entry point")
            || normalized.contains("follow this sequence")
            || source.contains("先定位")
            || source.contains("按需"),
        normalized.contains("docs/")
            || normalized.contains("path")
            || normalized.contains("module")
            || normalized.contains("workspace")
            || source.contains("文件路径"),
        normalized.contains("do not")
            && (normalized.contains("knowledge dump")
                || source.contains("最小上下文")
                || source.contains("最小化")),
        normalized.contains("phase")
            || normalized.contains(" when ")
            || normalized.starts_with("when ")
            || source.contains("阶段"),
    ]
    .iter()
    .filter(|signal| **signal)
    .count()
    .min(5) as i64;

    let protection = [
        normalized.contains("do not")
            || normalized.contains("don't")
            || normalized.contains("never")
            || normalized.contains("must not")
            || source.contains("不得")
            || source.contains("禁止"),
        normalized.contains("allowlist")
            || normalized.contains("denylist")
            || normalized.contains("scope")
            || normalized.contains("boundary")
            || source.contains("权限边界")
            || source.contains("范围限制"),
        normalized.contains("confirm")
            || normalized.contains("approval")
            || normalized.contains("escalat")
            || source.contains("升级"),
        normalized.contains("injection")
            || normalized.contains("prompt injection")
            || source.contains("注入"),
        normalized.contains("drift")
            || source.contains("越权")
            || source.contains("误操作")
            || source.contains("风险"),
    ]
    .iter()
    .filter(|signal| **signal)
    .count()
    .min(5) as i64;

    let reflection = [
        normalized.contains("fail") || source.contains("失败") || source.contains("错误"),
        normalized.contains("retry") || source.contains("重试") || source.contains("最多"),
        normalized.contains("analyze")
            || normalized.contains("analyse")
            || normalized.contains("reason")
            || source.contains("原因")
            || source.contains("根因")
            || source.contains("第一性原理"),
        normalized.contains("switch strategy")
            || source.contains("换策略")
            || source.contains("分解任务")
            || source.contains("缩小问题"),
        normalized.contains("stop") || source.contains("卡住") || source.contains("升级处理"),
    ]
    .iter()
    .filter(|signal| **signal)
    .count()
    .min(5) as i64;

    let verification = [
        normalized.contains("definition of done")
            || source.contains("完成标准")
            || source.contains("验收条件"),
        normalized.contains("lint")
            || normalized.contains("test")
            || normalized.contains("typecheck")
            || normalized.contains("build")
            || normalized.contains("dry-run")
            || normalized.contains("checklist")
            || normalized.contains("schema check"),
        normalized.contains("if any step fails")
            || normalized.contains("fix and re-validate")
            || source.contains("未通过验证")
            || source.contains("不得宣称完成"),
        normalized.contains("evidence")
            || normalized.contains("report")
            || source.contains("输出验证结果")
            || source.contains("失败原因"),
        normalized.contains("before any pr")
            || normalized.contains("must run")
            || source.contains("完成前"),
    ]
    .iter()
    .filter(|signal| **signal)
    .count()
    .min(5) as i64;

    let total_score = routing + protection + reflection + verification;
    let overall = infer_overall(
        routing,
        protection,
        reflection,
        verification,
        has_agent_side_effects,
    );
    let mut audit = json!({
        "status": "heuristic",
        "provider": provider,
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "durationMs": duration_ms,
        "totalScore": total_score,
        "overall": overall,
        "oneSentence": "specialist 调用失败，当前展示为本地启发式评分（用于 UI 可用性，不作为最终审计结论）。",
        "principles": {
            "routing": routing,
            "protection": protection,
            "reflection": reflection,
            "verification": verification,
        }
    });
    if let Some(error) = error {
        audit["error"] = Value::String(error.to_string());
    }
    audit
}

fn parse_audit_payload(payload: &Value, duration_ms: u64, provider: &str) -> Value {
    let routing = to_score(payload.pointer("/principles/routing/score"));
    let protection = to_score(payload.pointer("/principles/protection/score"));
    let reflection = to_score(payload.pointer("/principles/reflection/score"));
    let verification = to_score(payload.pointer("/principles/verification/score"));

    let total_score = payload
        .pointer("/audit_conclusion/total_score")
        .and_then(value_to_i64)
        .map(|score| score.clamp(0, 20));
    let overall = payload
        .pointer("/audit_conclusion/overall")
        .and_then(Value::as_str)
        .and_then(|overall| match overall {
            "通过" | "有条件通过" | "不通过" => Some(overall),
            _ => None,
        });
    let one_sentence = payload
        .pointer("/audit_conclusion/one_sentence")
        .and_then(Value::as_str);

    json!({
        "status": "ok",
        "provider": provider,
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "durationMs": duration_ms,
        "totalScore": total_score,
        "overall": overall,
        "oneSentence": one_sentence,
        "principles": {
            "routing": routing,
            "protection": protection,
            "reflection": reflection,
            "verification": verification,
        }
    })
}

fn extract_json_output(raw: &str) -> Result<String, String> {
    let candidate = raw.trim();
    if candidate.is_empty() {
        return Err("Command produced no output".to_string());
    }

    if serde_json::from_str::<Value>(candidate).is_ok() {
        return Ok(candidate.to_string());
    }

    let opens = candidate
        .match_indices('{')
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    for index in opens.into_iter().rev() {
        let snippet = candidate[index..].trim();
        if !snippet.ends_with('}') {
            continue;
        }
        if serde_json::from_str::<Value>(snippet).is_ok() {
            return Ok(snippet.to_string());
        }
    }

    Err("Unable to parse command JSON output".to_string())
}

async fn execute_auditor_command(
    repo_root: &Path,
    workspace_id: &str,
    source: &str,
    provider: &str,
) -> Result<String, String> {
    // Quick pre-check: verify specialist binary exists before attempting execution
    let local_binary_path = repo_root.join("target/debug/routa");

    // If we're using local binary, check if it exists
    if local_binary_path.is_file() {
        // Quick check if specialist exists by running --help
        let check = Command::new(&local_binary_path)
            .args(["specialist", "run", "--help"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;

        // If basic help command fails, bail early
        if check.is_err() {
            return Err("Local routa binary is not functional".to_string());
        }
    }

    let specialist_args = vec![
        "specialist".to_string(),
        "run".to_string(),
        "--json".to_string(),
        "--workspace-id".to_string(),
        workspace_id.to_string(),
        "--provider".to_string(),
        provider.to_string(),
        "--provider-timeout-ms".to_string(),
        "30000".to_string(),
        "--provider-retries".to_string(),
        "0".to_string(),
        "-p".to_string(),
        source.to_string(),
        AUDIT_SPECIALIST_ID.to_string(),
    ];

    let mut command = if local_binary_path.is_file() {
        let mut command = Command::new(local_binary_path);
        command.args(&specialist_args);
        command
    } else {
        let mut cargo_args = vec![
            "run".to_string(),
            "-p".to_string(),
            "routa-cli".to_string(),
            "--".to_string(),
        ];
        cargo_args.extend(specialist_args);
        let mut command = Command::new("cargo");
        command.args(cargo_args);
        command
    };

    command
        .current_dir(repo_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = timeout(
        Duration::from_millis(AUDIT_COMMAND_TIMEOUT_MS),
        command.output(),
    )
    .await
    .map_err(|_| {
        format!(
            "Instruction audit command timed out after {}ms",
            AUDIT_COMMAND_TIMEOUT_MS
        )
    })?
    .map_err(|error| format!("Instruction audit command failed to execute: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let error_output = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(format!(
            "Instruction audit command failed (exit {}): {}",
            output.status.code().unwrap_or(1),
            error_output
        ));
    }

    Ok(stdout)
}

pub(crate) async fn run_instruction_audit(
    repo_root: &Path,
    workspace_id: &str,
    source: &str,
    provider: &str,
) -> Value {
    let started = std::time::Instant::now();
    let to_duration_ms = || u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);

    // Fast-fail: If provider requires an API key and it's not configured, skip execution
    let requires_api_key = matches!(provider, "codex" | "claude" | "openai" | "anthropic");
    if requires_api_key {
        let api_key_configured = match provider {
            "codex" => std::env::var("CODEX_API_KEY").is_ok(),
            "claude" | "anthropic" => std::env::var("ANTHROPIC_API_KEY").is_ok(),
            "openai" => std::env::var("OPENAI_API_KEY").is_ok(),
            _ => false,
        };

        if !api_key_configured {
            return build_heuristic_audit(
                source,
                to_duration_ms(),
                provider,
                Some(&format!("Provider '{}' API key not configured, using heuristic fallback", provider)),
            );
        }
    }

    match execute_auditor_command(repo_root, workspace_id, source, provider).await {
        Ok(stdout) => match extract_json_output(&stdout) {
            Ok(extracted) => match serde_json::from_str::<Value>(&extracted) {
                Ok(payload) => parse_audit_payload(&payload, to_duration_ms(), provider),
                Err(error) => build_heuristic_audit(
                    source,
                    to_duration_ms(),
                    provider,
                    Some(&error.to_string()),
                ),
            },
            Err(error) => build_heuristic_audit(source, to_duration_ms(), provider, Some(&error)),
        },
        Err(error) => build_heuristic_audit(source, to_duration_ms(), provider, Some(&error)),
    }
}
