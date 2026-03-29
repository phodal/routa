//! Dashboard generation — build a fitness dashboard from evidence and report data.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::model::{Dimension, FitnessReport};

/// A snapshot of dimension state for the dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardDimension {
    pub name: String,
    pub weight: i32,
    pub threshold_pass: i32,
    pub threshold_warn: i32,
    pub current_score: f64,
    pub passed: usize,
    pub total: usize,
    pub status: DimensionStatus,
    pub hard_gate_failures: Vec<String>,
    pub source_file: String,
}

/// Pass / warn / fail status derived from thresholds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DimensionStatus {
    Pass,
    Warn,
    Fail,
}

impl DimensionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pass => "pass",
            Self::Warn => "warn",
            Self::Fail => "fail",
        }
    }
}

/// A hard-gate entry for the release gate panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardGateEntry {
    pub metric_name: String,
    pub dimension: String,
    pub passed: bool,
    pub output: String,
}

/// Comparison delta between two dashboard snapshots.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardComparison {
    pub previous_generated_at: String,
    pub previous_final_score: f64,
    pub score_delta: f64,
    pub dimension_changes: Vec<DimensionChange>,
}

/// Change record for a single dimension between two snapshots.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionChange {
    pub dimension: String,
    pub previous_score: f64,
    pub current_score: f64,
    pub delta: f64,
    pub direction: ChangeDirection,
}

/// Direction of a change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeDirection {
    Up,
    Down,
    Same,
}

/// The full fitness dashboard payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FitnessDashboard {
    pub generated_at: String,
    pub repo_root: String,
    pub final_score: f64,
    pub hard_gate_blocked: bool,
    pub score_blocked: bool,
    pub dimensions: Vec<DashboardDimension>,
    pub hard_gates: Vec<HardGateEntry>,
    pub comparison: Option<DashboardComparison>,
}

/// Build a dashboard from dimension definitions and a fitness report.
pub fn build_dashboard(
    dimension_defs: &[Dimension],
    report: &FitnessReport,
    repo_root: &str,
) -> FitnessDashboard {
    let generated_at = chrono::Utc::now().to_rfc3339();

    let def_map: std::collections::HashMap<&str, &Dimension> = dimension_defs
        .iter()
        .map(|d| (d.name.as_str(), d))
        .collect();

    let mut dimensions = Vec::new();
    let mut hard_gates = Vec::new();

    for ds in &report.dimensions {
        let def = def_map.get(ds.dimension.as_str());
        let threshold_pass = def.map_or(90, |d| d.threshold_pass);
        let threshold_warn = def.map_or(80, |d| d.threshold_warn);
        let source_file = def.map_or_else(String::new, |d| d.source_file.clone());

        let status = if ds.score >= threshold_pass as f64 {
            DimensionStatus::Pass
        } else if ds.score >= threshold_warn as f64 {
            DimensionStatus::Warn
        } else {
            DimensionStatus::Fail
        };

        dimensions.push(DashboardDimension {
            name: ds.dimension.clone(),
            weight: ds.weight,
            threshold_pass,
            threshold_warn,
            current_score: ds.score,
            passed: ds.passed,
            total: ds.total,
            status,
            hard_gate_failures: ds.hard_gate_failures.clone(),
            source_file,
        });

        for result in &ds.results {
            if result.hard_gate {
                hard_gates.push(HardGateEntry {
                    metric_name: result.metric_name.clone(),
                    dimension: ds.dimension.clone(),
                    passed: result.passed,
                    output: result.output.clone(),
                });
            }
        }
    }

    FitnessDashboard {
        generated_at,
        repo_root: repo_root.to_string(),
        final_score: report.final_score,
        hard_gate_blocked: report.hard_gate_blocked,
        score_blocked: report.score_blocked,
        dimensions,
        hard_gates,
        comparison: None,
    }
}

/// Compare two dashboard snapshots and produce a comparison record.
pub fn compare_dashboards(
    current: &FitnessDashboard,
    previous: &FitnessDashboard,
) -> DashboardComparison {
    let score_delta = current.final_score - previous.final_score;

    let prev_dim_map: std::collections::HashMap<&str, &DashboardDimension> = previous
        .dimensions
        .iter()
        .map(|d| (d.name.as_str(), d))
        .collect();

    let dimension_changes: Vec<DimensionChange> = current
        .dimensions
        .iter()
        .map(|d| {
            let prev = prev_dim_map.get(d.name.as_str());
            let previous_score = prev.map_or(0.0, |p| p.current_score);
            let delta = d.current_score - previous_score;
            let direction = if delta > 0.001 {
                ChangeDirection::Up
            } else if delta < -0.001 {
                ChangeDirection::Down
            } else {
                ChangeDirection::Same
            };
            DimensionChange {
                dimension: d.name.clone(),
                previous_score,
                current_score: d.current_score,
                delta,
                direction,
            }
        })
        .collect();

    DashboardComparison {
        previous_generated_at: previous.generated_at.clone(),
        previous_final_score: previous.final_score,
        score_delta,
        dimension_changes,
    }
}

/// Render the dashboard as a JSON Value.
pub fn dashboard_to_json(dashboard: &FitnessDashboard) -> Value {
    serde_json::to_value(dashboard).unwrap_or(json!({}))
}

/// Render the dashboard as a self-contained HTML page.
pub fn dashboard_to_html(dashboard: &FitnessDashboard) -> String {
    let json_data =
        serde_json::to_string(dashboard).unwrap_or_else(|_| "{}".to_string());

    let dimension_rows: Vec<String> = dashboard
        .dimensions
        .iter()
        .map(|d| {
            let status_class = match d.status {
                DimensionStatus::Pass => "status-pass",
                DimensionStatus::Warn => "status-warn",
                DimensionStatus::Fail => "status-fail",
            };
            let bar_width = d.current_score.min(100.0).max(0.0);
            let hard_gate_badge = if !d.hard_gate_failures.is_empty() {
                format!(
                    r#"<span class="badge badge-fail">{} hard-gate failure(s)</span>"#,
                    d.hard_gate_failures.len()
                )
            } else {
                String::new()
            };
            format!(
                r#"<tr>
  <td class="dim-name">{name}</td>
  <td class="dim-weight">{weight}%</td>
  <td class="dim-score"><div class="bar-bg"><div class="bar {status_class}" style="width:{bar_width}%"></div></div><span>{score:.1}%</span></td>
  <td class="dim-target">{pass} / {warn}</td>
  <td class="dim-status"><span class="badge {status_class}">{status}</span>{hard_gate}</td>
  <td class="dim-evidence"><a href="{source}">{source}</a></td>
</tr>"#,
                name = html_escape(&d.name),
                weight = d.weight,
                bar_width = bar_width,
                score = d.current_score,
                pass = d.threshold_pass,
                warn = d.threshold_warn,
                status = d.status.as_str(),
                status_class = status_class,
                hard_gate = hard_gate_badge,
                source = html_escape(&d.source_file),
            )
        })
        .collect();

    let hard_gate_rows: Vec<String> = dashboard
        .hard_gates
        .iter()
        .map(|g| {
            let icon = if g.passed { "✅" } else { "❌" };
            format!(
                r#"<tr><td>{icon}</td><td>{name}</td><td>{dim}</td><td class="gate-output">{output}</td></tr>"#,
                icon = icon,
                name = html_escape(&g.metric_name),
                dim = html_escape(&g.dimension),
                output = html_escape(&truncate_output(&g.output, 120)),
            )
        })
        .collect();

    let comparison_section = if let Some(comp) = &dashboard.comparison {
        let arrow = if comp.score_delta > 0.001 {
            "▲"
        } else if comp.score_delta < -0.001 {
            "▼"
        } else {
            "—"
        };
        let delta_class = if comp.score_delta > 0.001 {
            "delta-up"
        } else if comp.score_delta < -0.001 {
            "delta-down"
        } else {
            "delta-same"
        };

        let change_rows: Vec<String> = comp
            .dimension_changes
            .iter()
            .map(|c| {
                let dir = match c.direction {
                    ChangeDirection::Up => "▲",
                    ChangeDirection::Down => "▼",
                    ChangeDirection::Same => "—",
                };
                format!(
                    "<tr><td>{}</td><td>{:.1}%</td><td>{:.1}%</td><td class=\"{}\">{} {:.1}</td></tr>",
                    html_escape(&c.dimension),
                    c.previous_score,
                    c.current_score,
                    match c.direction {
                        ChangeDirection::Up => "delta-up",
                        ChangeDirection::Down => "delta-down",
                        ChangeDirection::Same => "delta-same",
                    },
                    dir,
                    c.delta,
                )
            })
            .collect();

        format!(
            r#"<section class="panel">
  <h2>Trend: Comparison with previous run</h2>
  <p class="comparison-summary">Previous: <strong>{prev_score:.1}%</strong> → Current: <strong>{cur_score:.1}%</strong> <span class="{delta_class}">{arrow} {delta:+.1}%</span></p>
  <p class="comparison-date">Previous snapshot: {prev_date}</p>
  <table class="comparison-table">
    <thead><tr><th>Dimension</th><th>Previous</th><th>Current</th><th>Delta</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</section>"#,
            prev_score = comp.previous_final_score,
            cur_score = dashboard.final_score,
            delta_class = delta_class,
            arrow = arrow,
            delta = comp.score_delta,
            prev_date = html_escape(&comp.previous_generated_at),
            rows = change_rows.join("\n"),
        )
    } else {
        r#"<section class="panel"><h2>Trend</h2><p class="no-data">No previous snapshot for comparison.</p></section>"#.to_string()
    };

    let overall_class = if dashboard.hard_gate_blocked {
        "overall-blocked"
    } else if dashboard.score_blocked {
        "overall-warn"
    } else {
        "overall-pass"
    };

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Routa Fitness Dashboard</title>
<style>
:root {{
  --pass: #22c55e; --warn: #f59e0b; --fail: #ef4444;
  --bg: #0f172a; --bg2: #1e293b; --fg: #f1f5f9; --fg2: #94a3b8; --border: #334155;
  font-family: system-ui, -apple-system, sans-serif;
}}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ background: var(--bg); color: var(--fg); padding: 24px; max-width: 1200px; margin: auto; }}
h1 {{ font-size: 1.5rem; margin-bottom: 4px; }}
h2 {{ font-size: 1.1rem; margin-bottom: 12px; color: var(--fg2); }}
.header {{ display: flex; align-items: center; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }}
.overall {{ font-size: 2.5rem; font-weight: 700; }}
.overall-pass {{ color: var(--pass); }}
.overall-warn {{ color: var(--warn); }}
.overall-blocked {{ color: var(--fail); }}
.meta {{ font-size: 0.75rem; color: var(--fg2); }}
.panel {{ background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 20px; }}
table {{ width: 100%; border-collapse: collapse; font-size: 0.82rem; }}
th, td {{ text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }}
th {{ font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg2); }}
.bar-bg {{ background: var(--border); border-radius: 4px; height: 8px; width: 100px; display: inline-block; vertical-align: middle; margin-right: 8px; }}
.bar {{ height: 8px; border-radius: 4px; }}
.status-pass {{ background: var(--pass); }}
.status-warn {{ background: var(--warn); }}
.status-fail {{ background: var(--fail); }}
.badge {{ display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }}
.badge.status-pass {{ background: rgba(34,197,94,0.15); color: var(--pass); }}
.badge.status-warn {{ background: rgba(245,158,11,0.15); color: var(--warn); }}
.badge.status-fail {{ background: rgba(239,68,68,0.15); color: var(--fail); }}
.badge.badge-fail {{ background: rgba(239,68,68,0.15); color: var(--fail); margin-left: 6px; }}
a {{ color: #60a5fa; text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
.gate-output {{ font-family: monospace; font-size: 0.75rem; color: var(--fg2); max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
.delta-up {{ color: var(--pass); }}
.delta-down {{ color: var(--fail); }}
.delta-same {{ color: var(--fg2); }}
.comparison-summary {{ font-size: 1rem; margin-bottom: 8px; }}
.comparison-date {{ font-size: 0.75rem; color: var(--fg2); margin-bottom: 12px; }}
.no-data {{ font-size: 0.82rem; color: var(--fg2); }}
.blocked-banner {{ background: rgba(239,68,68,0.12); border: 1px solid var(--fail); border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; color: var(--fail); font-weight: 600; }}
.dim-name {{ font-weight: 600; }}
footer {{ margin-top: 32px; font-size: 0.7rem; color: var(--fg2); text-align: center; }}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>Routa Fitness Dashboard</h1>
    <div class="meta">Generated: {generated_at} · Repo: {repo_root}</div>
  </div>
  <div class="overall {overall_class}">{final_score:.1}%</div>
</div>

{blocked_banner}

<section class="panel">
  <h2>Dimension Overview</h2>
  <table>
    <thead><tr><th>Dimension</th><th>Weight</th><th>Score</th><th>Target (pass/warn)</th><th>Status</th><th>Evidence</th></tr></thead>
    <tbody>{dimension_rows}</tbody>
  </table>
</section>

{comparison_section}

<section class="panel">
  <h2>Release Gate Panel</h2>
  {gate_content}
</section>

<footer>Routa Fitness Dashboard v1 · <a href="https://github.com/phodal/routa">github.com/phodal/routa</a></footer>

<script type="application/json" id="dashboard-data">{json_data}</script>
</body>
</html>"#,
        generated_at = html_escape(&dashboard.generated_at),
        repo_root = html_escape(&dashboard.repo_root),
        overall_class = overall_class,
        final_score = dashboard.final_score,
        blocked_banner = if dashboard.hard_gate_blocked {
            r#"<div class="blocked-banner">⛔ Hard-gate blocked — one or more hard gates have failed. Release is blocked.</div>"#
        } else if dashboard.score_blocked {
            r#"<div class="blocked-banner">⚠️ Score blocked — final score is below the minimum threshold.</div>"#
        } else {
            ""
        },
        dimension_rows = dimension_rows.join("\n"),
        comparison_section = comparison_section,
        gate_content = if hard_gate_rows.is_empty() {
            r#"<p class="no-data">No hard-gate metrics defined.</p>"#.to_string()
        } else {
            format!(
                r#"<table><thead><tr><th></th><th>Metric</th><th>Dimension</th><th>Output</th></tr></thead><tbody>{}</tbody></table>"#,
                hard_gate_rows.join("\n")
            )
        },
        json_data = json_data,
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn truncate_output(s: &str, max_len: usize) -> String {
    let trimmed = s.trim();
    if trimmed.len() <= max_len {
        trimmed.to_string()
    } else {
        format!("{}…", &trimmed[..max_len])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DimensionScore, FitnessReport, MetricResult, Tier};

    fn sample_dimension_defs() -> Vec<Dimension> {
        vec![
            Dimension {
                name: "code_quality".to_string(),
                weight: 24,
                threshold_pass: 90,
                threshold_warn: 80,
                metrics: Vec::new(),
                source_file: "code-quality.md".to_string(),
            },
            Dimension {
                name: "testability".to_string(),
                weight: 20,
                threshold_pass: 90,
                threshold_warn: 80,
                metrics: Vec::new(),
                source_file: "unit-test.md".to_string(),
            },
            Dimension {
                name: "security".to_string(),
                weight: 20,
                threshold_pass: 90,
                threshold_warn: 80,
                metrics: Vec::new(),
                source_file: "security.md".to_string(),
            },
        ]
    }

    fn sample_report() -> FitnessReport {
        let ds_quality = DimensionScore {
            dimension: "code_quality".to_string(),
            weight: 24,
            passed: 3,
            total: 3,
            score: 100.0,
            hard_gate_failures: Vec::new(),
            results: vec![
                MetricResult::new("lint", true, "ok", Tier::Fast),
                MetricResult::new("no_cycles", true, "ok", Tier::Fast),
                MetricResult::new("file_budget", true, "ok", Tier::Fast),
            ],
        };
        let ds_test = DimensionScore {
            dimension: "testability".to_string(),
            weight: 20,
            passed: 1,
            total: 2,
            score: 50.0,
            hard_gate_failures: vec!["ts_test_pass".to_string()],
            results: vec![
                MetricResult::new("coverage", true, "82%", Tier::Normal),
                MetricResult::new("ts_test_pass", false, "3 failed", Tier::Fast)
                    .with_hard_gate(true),
            ],
        };
        let ds_security = DimensionScore {
            dimension: "security".to_string(),
            weight: 20,
            passed: 2,
            total: 2,
            score: 100.0,
            hard_gate_failures: Vec::new(),
            results: vec![
                MetricResult::new("snyk", true, "0 critical", Tier::Deep),
                MetricResult::new("audit", true, "ok", Tier::Normal),
            ],
        };

        FitnessReport {
            dimensions: vec![ds_quality, ds_test, ds_security],
            final_score: 82.5,
            hard_gate_blocked: true,
            score_blocked: false,
        }
    }

    #[test]
    fn test_build_dashboard_dimensions() {
        let defs = sample_dimension_defs();
        let report = sample_report();
        let dashboard = build_dashboard(&defs, &report, "/repo");

        assert_eq!(dashboard.dimensions.len(), 3);
        assert_eq!(dashboard.dimensions[0].name, "code_quality");
        assert_eq!(dashboard.dimensions[0].status, DimensionStatus::Pass);
        assert_eq!(dashboard.dimensions[1].name, "testability");
        assert_eq!(dashboard.dimensions[1].status, DimensionStatus::Fail);
        assert_eq!(dashboard.dimensions[2].name, "security");
        assert_eq!(dashboard.dimensions[2].status, DimensionStatus::Pass);
    }

    #[test]
    fn test_build_dashboard_hard_gates() {
        let defs = sample_dimension_defs();
        let report = sample_report();
        let dashboard = build_dashboard(&defs, &report, "/repo");

        assert_eq!(dashboard.hard_gates.len(), 1);
        assert_eq!(dashboard.hard_gates[0].metric_name, "ts_test_pass");
        assert!(!dashboard.hard_gates[0].passed);
    }

    #[test]
    fn test_build_dashboard_scores() {
        let defs = sample_dimension_defs();
        let report = sample_report();
        let dashboard = build_dashboard(&defs, &report, "/repo");

        assert_eq!(dashboard.final_score, 82.5);
        assert!(dashboard.hard_gate_blocked);
        assert!(!dashboard.score_blocked);
    }

    #[test]
    fn test_compare_dashboards() {
        let defs = sample_dimension_defs();
        let report = sample_report();
        let current = build_dashboard(&defs, &report, "/repo");

        let mut previous = current.clone();
        previous.generated_at = "2026-01-01T00:00:00Z".to_string();
        previous.final_score = 70.0;
        previous.dimensions[0].current_score = 80.0;
        previous.dimensions[1].current_score = 40.0;

        let comparison = compare_dashboards(&current, &previous);

        assert_eq!(comparison.previous_final_score, 70.0);
        assert!((comparison.score_delta - 12.5).abs() < 0.01);
        assert_eq!(comparison.dimension_changes.len(), 3);
        assert_eq!(comparison.dimension_changes[0].direction, ChangeDirection::Up);
        assert_eq!(comparison.dimension_changes[1].direction, ChangeDirection::Up);
    }

    #[test]
    fn test_dashboard_to_json() {
        let defs = sample_dimension_defs();
        let report = sample_report();
        let dashboard = build_dashboard(&defs, &report, "/repo");
        let json = dashboard_to_json(&dashboard);

        assert_eq!(json["finalScore"], 82.5);
        assert_eq!(json["hardGateBlocked"], true);
        assert!(json["dimensions"].as_array().unwrap().len() == 3);
    }

    #[test]
    fn test_dashboard_to_html_contains_key_sections() {
        let defs = sample_dimension_defs();
        let report = sample_report();
        let dashboard = build_dashboard(&defs, &report, "/repo");
        let html = dashboard_to_html(&dashboard);

        assert!(html.contains("Routa Fitness Dashboard"));
        assert!(html.contains("Dimension Overview"));
        assert!(html.contains("Release Gate Panel"));
        assert!(html.contains("code_quality"));
        assert!(html.contains("ts_test_pass"));
        assert!(html.contains("Hard-gate blocked"));
    }

    #[test]
    fn test_dashboard_to_html_with_comparison() {
        let defs = sample_dimension_defs();
        let report = sample_report();
        let mut dashboard = build_dashboard(&defs, &report, "/repo");

        let mut previous = dashboard.clone();
        previous.generated_at = "2026-01-01T00:00:00Z".to_string();
        previous.final_score = 70.0;

        dashboard.comparison = Some(compare_dashboards(&dashboard, &previous));
        let html = dashboard_to_html(&dashboard);

        assert!(html.contains("Comparison with previous run"));
        assert!(html.contains("70.0%"));
    }

    #[test]
    fn test_html_escape() {
        assert_eq!(html_escape("<script>"), "&lt;script&gt;");
        assert_eq!(html_escape("a & b"), "a &amp; b");
    }

    #[test]
    fn test_truncate_output() {
        assert_eq!(truncate_output("short", 10), "short");
        assert_eq!(truncate_output("a very long string here", 10), "a very lon…");
    }

    #[test]
    fn test_dimension_status_thresholds() {
        let defs = vec![Dimension {
            name: "test".to_string(),
            weight: 10,
            threshold_pass: 90,
            threshold_warn: 80,
            metrics: Vec::new(),
            source_file: "test.md".to_string(),
        }];

        // Score exactly at pass threshold
        let report_pass = FitnessReport {
            dimensions: vec![DimensionScore::new("test", 10, 9, 10, 90.0)],
            final_score: 90.0,
            hard_gate_blocked: false,
            score_blocked: false,
        };
        let dash = build_dashboard(&defs, &report_pass, "/repo");
        assert_eq!(dash.dimensions[0].status, DimensionStatus::Pass);

        // Score between warn and pass
        let report_warn = FitnessReport {
            dimensions: vec![DimensionScore::new("test", 10, 8, 10, 85.0)],
            final_score: 85.0,
            hard_gate_blocked: false,
            score_blocked: false,
        };
        let dash = build_dashboard(&defs, &report_warn, "/repo");
        assert_eq!(dash.dimensions[0].status, DimensionStatus::Warn);

        // Score below warn threshold
        let report_fail = FitnessReport {
            dimensions: vec![DimensionScore::new("test", 10, 5, 10, 50.0)],
            final_score: 50.0,
            hard_gate_blocked: false,
            score_blocked: false,
        };
        let dash = build_dashboard(&defs, &report_fail, "/repo");
        assert_eq!(dash.dimensions[0].status, DimensionStatus::Fail);
    }
}
