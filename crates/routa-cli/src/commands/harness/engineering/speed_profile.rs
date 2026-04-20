use std::path::Path;
use std::process::Command;
use std::time::Instant;

use serde_json::Value;

use super::{
    AutomationSummary, FitnessSummary, HarnessEngineeringInputs, HarnessEngineeringOptions,
    HarnessEngineeringReport, HarnessEngineeringSummary, HarnessEngineeringVerificationStep,
    SpecSummary, TemplateSummary, FITNESS_MANIFEST_RELATIVE_PATH,
};

#[derive(Debug, Clone)]
struct SpeedProfileExecution {
    command: String,
    args: Vec<String>,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
struct SpeedProfileMetrics {
    lines: Vec<String>,
    hard_gate_blocked: bool,
}

pub(super) fn run_speed_profile_experiment(
    repo_root: &Path,
    options: &HarnessEngineeringOptions,
) -> Result<HarnessEngineeringReport, String> {
    run_speed_profile_experiment_with_runner(repo_root, options, run_speed_profile_command)
}

fn run_speed_profile_experiment_with_runner<F>(
    repo_root: &Path,
    options: &HarnessEngineeringOptions,
    runner: F,
) -> Result<HarnessEngineeringReport, String>
where
    F: FnOnce(&Path) -> Result<SpeedProfileExecution, String>,
{
    let mut warnings = Vec::new();
    let mut speed_metrics = Vec::new();

    match runner(repo_root) {
        Ok(execution) => {
            warnings.push(format!(
                "speed-profile command: {} {}",
                execution.command,
                execution.args.join(" ")
            ));

            let parsed_report = extract_json_output(&execution.stdout)
                .ok()
                .and_then(|payload| serde_json::from_str::<Value>(&payload).ok());
            let metrics = build_speed_profile_metrics(
                execution.duration_ms,
                execution.exit_code,
                parsed_report.as_ref(),
            );
            speed_metrics = metrics.lines;

            if execution.exit_code.unwrap_or_default() != 0 && !execution.stderr.trim().is_empty() {
                warnings.push(format!(
                    "speed-profile experiment exited with status {}; stderr: {}",
                    execution.exit_code.unwrap_or_default(),
                    execution
                        .stderr
                        .trim()
                        .chars()
                        .take(200)
                        .collect::<String>()
                ));
            }

            if parsed_report.is_none() {
                let summary = execution
                    .stdout
                    .trim()
                    .chars()
                    .take(200)
                    .collect::<String>();
                warnings.push(if summary.is_empty() {
                    "speed-profile experiment did not emit parsable entrix JSON output".to_string()
                } else {
                    format!(
                        "speed-profile experiment did not emit parsable entrix JSON output: {summary}"
                    )
                });
            }
        }
        Err(error) => {
            warnings.push(format!(
                "speed-profile experiment failed to launch: {error}"
            ));
        }
    }

    let metrics_summary = if speed_metrics.is_empty() {
        "No METRIC output captured.".to_string()
    } else {
        speed_metrics.join(", ")
    };
    warnings.push(format!("speed-profile metrics: {metrics_summary}"));

    Ok(HarnessEngineeringReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        mode: "speed-profile-dry-run".to_string(),
        report_path: options.output_path.display().to_string(),
        summary: HarnessEngineeringSummary {
            total_gaps: 0,
            blocking_gaps: 0,
            harness_mutation_candidates: 0,
            non_harness_gaps: 0,
            low_risk_patch_candidates: 0,
        },
        inputs: HarnessEngineeringInputs {
            repo_signals: None,
            templates: TemplateSummary {
                templates_checked: 0,
                drift_error_count: 0,
                drift_warning_count: 0,
                missing_sensor_files: 0,
                missing_automation_refs: 0,
                warnings: 0,
            },
            automations: AutomationSummary {
                definition_count: 0,
                pending_signal_count: 0,
                recent_run_count: 0,
                definition_only_count: 0,
                warnings: 0,
            },
            specs: SpecSummary {
                source_count: 0,
                feature_count: 0,
                systems: Vec::new(),
                warnings: 0,
            },
            fitness: FitnessSummary {
                manifest_present: repo_root.join(FITNESS_MANIFEST_RELATIVE_PATH).exists(),
                fluency_snapshots_loaded: 0,
                blocking_criteria_count: 0,
                critical_blocking_criteria_count: 0,
            },
        },
        gaps: Vec::new(),
        recommended_actions: Vec::new(),
        patch_candidates: Vec::new(),
        verification_plan: vec![HarnessEngineeringVerificationStep {
            label: "Fitness dry-run check".to_string(),
            command: format!("cd {} && entrix run --dry-run", repo_root.display()),
            proves: "Fitness rulebook remains intact after native speed-profile experiment."
                .to_string(),
        }],
        verification_results: Vec::new(),
        ratchet: None,
        ai_assessment: None,
        warnings,
    })
}

fn run_speed_profile_command(repo_root: &Path) -> Result<SpeedProfileExecution, String> {
    let mut command = entrix_command(repo_root);
    let args = vec![
        "run".to_string(),
        "--tier".to_string(),
        "fast".to_string(),
        "--scope".to_string(),
        "local".to_string(),
        "--json".to_string(),
    ];
    command.args(&args).current_dir(repo_root);
    let command_label = command.get_program().to_string_lossy().to_string();
    let start = Instant::now();
    let output = command.output().map_err(|error| error.to_string())?;

    Ok(SpeedProfileExecution {
        command: command_label,
        args,
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

fn entrix_command(repo_root: &Path) -> Command {
    let debug_binary = repo_root
        .join("target")
        .join("debug")
        .join(if cfg!(windows) {
            "entrix.exe"
        } else {
            "entrix"
        });
    if debug_binary.exists() {
        Command::new(debug_binary)
    } else {
        let mut command = Command::new("cargo");
        command.args(["run", "-q", "-p", "entrix", "--"]);
        command
    }
}

fn extract_json_output(raw: &str) -> Result<String, String> {
    let candidate = raw.trim();
    if candidate.is_empty() {
        return Err("Entrix command produced no JSON output".to_string());
    }

    if serde_json::from_str::<Value>(candidate).is_ok() {
        return Ok(candidate.to_string());
    }

    let mut object_starts = candidate
        .char_indices()
        .filter_map(|(index, ch)| (ch == '{').then_some(index))
        .collect::<Vec<_>>();
    object_starts.reverse();

    for index in object_starts {
        let snippet = candidate[index..].trim();
        if serde_json::from_str::<Value>(snippet).is_ok() {
            return Ok(snippet.to_string());
        }
    }

    Err("Unable to parse Entrix JSON output".to_string())
}

fn build_speed_profile_metrics(
    duration_ms: u64,
    exit_code: Option<i32>,
    report: Option<&Value>,
) -> SpeedProfileMetrics {
    let Some(report) = report else {
        let mut lines = vec![
            format!("METRIC fitness_ms={duration_ms}"),
            "METRIC checks_count=0".to_string(),
            "METRIC failed_checks=0".to_string(),
            "METRIC top_slowest_ms=0".to_string(),
            "METRIC pass_rate=0.0".to_string(),
            "METRIC hard_gate_hits=0".to_string(),
            "METRIC final_score=0".to_string(),
        ];
        if exit_code.unwrap_or_default() != 0 {
            lines.push("checks_failed=1".to_string());
        }
        return SpeedProfileMetrics {
            lines,
            hard_gate_blocked: false,
        };
    };

    let metrics = report
        .get("dimensions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|dimension| dimension.get("metrics"))
        .filter_map(Value::as_array)
        .flat_map(|metrics| metrics.iter())
        .collect::<Vec<_>>();

    let checks_count = metrics.len();
    let failed_checks = metrics
        .iter()
        .filter(|metric| {
            let state = metric
                .get("state")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let passed = metric
                .get("passed")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            state != "waived" && !passed
        })
        .count();
    let top_slowest_ms = metrics
        .iter()
        .filter_map(|metric| metric.get("duration_ms"))
        .filter_map(value_to_u64)
        .max()
        .unwrap_or(0);
    let pass_rate = if checks_count > 0 {
        (((checks_count - failed_checks) as f64 / checks_count as f64) * 10_000.0).round()
            / 10_000.0
    } else {
        1.0
    };
    let hard_gate_blocked = report
        .get("hard_gate_blocked")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let final_score = report
        .get("final_score")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);

    let mut lines = vec![
        format!("METRIC fitness_ms={duration_ms}"),
        format!("METRIC checks_count={checks_count}"),
        format!("METRIC failed_checks={failed_checks}"),
        format!("METRIC top_slowest_ms={top_slowest_ms}"),
        format!("METRIC pass_rate={pass_rate}"),
        format!("METRIC hard_gate_hits={}", usize::from(hard_gate_blocked)),
        format!("METRIC final_score={final_score}"),
    ];
    if exit_code.unwrap_or_default() != 0 || hard_gate_blocked {
        lines.push("checks_failed=1".to_string());
    }

    SpeedProfileMetrics {
        lines,
        hard_gate_blocked,
    }
}

fn value_to_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| {
            value
                .as_i64()
                .and_then(|value| (value >= 0).then_some(value as u64))
        })
        .or_else(|| {
            value
                .as_f64()
                .filter(|value| value.is_finite() && *value >= 0.0)
                .map(|value| value.round() as u64)
        })
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tempfile::tempdir;

    use super::*;

    fn test_options(root: &Path) -> HarnessEngineeringOptions {
        HarnessEngineeringOptions {
            output_path: root.join("docs/fitness/reports/harness-engineering-latest.json"),
            dry_run: true,
            bootstrap: false,
            apply: false,
            force: false,
            json_output: false,
            use_ai_specialist: false,
            ai_workspace_id: "default".to_string(),
            ai_provider: None,
            ai_provider_timeout_ms: None,
            ai_provider_retries: 0,
            learn: false,
            speed_profile: true,
        }
    }

    #[test]
    fn extracts_trailing_json_object_from_noisy_output() {
        let raw = "progress line\n{\"final_score\":95,\"dimensions\":[]}\n";
        let extracted = extract_json_output(raw).expect("json should be extracted");
        assert_eq!(extracted, "{\"final_score\":95,\"dimensions\":[]}");
    }

    #[test]
    fn builds_metrics_with_checks_failed_for_hard_gate_block() {
        let report = json!({
            "final_score": 82.5,
            "hard_gate_blocked": true,
            "dimensions": [
                {
                    "metrics": [
                        {
                            "passed": true,
                            "state": "pass",
                            "duration_ms": 100.0
                        },
                        {
                            "passed": false,
                            "state": "fail",
                            "duration_ms": 2400.0
                        }
                    ]
                }
            ]
        });

        let metrics = build_speed_profile_metrics(3210, Some(1), Some(&report));

        assert_eq!(
            metrics.lines,
            vec![
                "METRIC fitness_ms=3210".to_string(),
                "METRIC checks_count=2".to_string(),
                "METRIC failed_checks=1".to_string(),
                "METRIC top_slowest_ms=2400".to_string(),
                "METRIC pass_rate=0.5".to_string(),
                "METRIC hard_gate_hits=1".to_string(),
                "METRIC final_score=82.5".to_string(),
                "checks_failed=1".to_string(),
            ]
        );
    }

    #[test]
    fn speed_profile_report_embeds_native_metric_summary() {
        let temp = tempdir().expect("tempdir");
        let report = run_speed_profile_experiment_with_runner(
            temp.path(),
            &test_options(temp.path()),
            |_| {
                Ok(SpeedProfileExecution {
                    command: "entrix".to_string(),
                    args: vec![
                        "run".to_string(),
                        "--tier".to_string(),
                        "fast".to_string(),
                        "--scope".to_string(),
                        "local".to_string(),
                        "--json".to_string(),
                    ],
                    stdout: json!({
                        "final_score": 91.2,
                        "hard_gate_blocked": false,
                        "dimensions": [
                            {
                                "metrics": [
                                    {
                                        "passed": true,
                                        "state": "pass",
                                        "duration_ms": 1500.0
                                    }
                                ]
                            }
                        ]
                    })
                    .to_string(),
                    stderr: String::new(),
                    exit_code: Some(0),
                    duration_ms: 2000,
                })
            },
        )
        .expect("report");

        assert_eq!(report.mode, "speed-profile-dry-run");
        assert!(report.warnings.iter().any(|warning| {
            warning.contains("speed-profile command: entrix run --tier fast --scope local --json")
        }));
        assert!(report
            .warnings
            .iter()
            .any(|warning| { warning.contains("speed-profile metrics: METRIC fitness_ms=2000") }));
    }
}
