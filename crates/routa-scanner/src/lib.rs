use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReport {
    pub generated_at: DateTime<Utc>,
    pub project_dir: String,
    pub strict: bool,
    pub scans: Vec<ScanResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub id: String,
    pub category: ScanCategory,
    pub status: ScanStatus,
    pub command: String,
    pub duration_ms: u128,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanCategory {
    Typescript,
    Rust,
    Docker,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScanStatus {
    Passed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone)]
pub struct ScanConfig {
    pub project_dir: PathBuf,
    pub strict: bool,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            project_dir: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            strict: false,
        }
    }
}

#[derive(Debug, Clone)]
struct ToolSpec {
    id: &'static str,
    category: ScanCategory,
    program: &'static str,
    args: &'static [&'static str],
}

pub fn run_scans(config: &ScanConfig) -> ScanReport {
    let specs = vec![
        ToolSpec {
            id: "typescript-eslint",
            category: ScanCategory::Typescript,
            program: "npm",
            args: &["run", "lint"],
        },
        ToolSpec {
            id: "typescript-typecheck",
            category: ScanCategory::Typescript,
            program: "npm",
            args: &["run", "typecheck"],
        },
        ToolSpec {
            id: "rust-clippy",
            category: ScanCategory::Rust,
            program: "cargo",
            args: &[
                "clippy",
                "--workspace",
                "--all-targets",
                "--",
                "-D",
                "warnings",
            ],
        },
        ToolSpec {
            id: "rust-audit",
            category: ScanCategory::Rust,
            program: "cargo",
            args: &["audit"],
        },
        ToolSpec {
            id: "docker-trivy-config",
            category: ScanCategory::Docker,
            program: "trivy",
            args: &["config", ".", "--severity", "HIGH,CRITICAL"],
        },
    ];

    let scans = specs
        .iter()
        .map(|spec| run_tool(spec, config.project_dir.as_path()))
        .collect();

    ScanReport {
        generated_at: Utc::now(),
        project_dir: config.project_dir.to_string_lossy().to_string(),
        strict: config.strict,
        scans,
    }
}

fn run_tool(spec: &ToolSpec, project_dir: &Path) -> ScanResult {
    if which::which(spec.program).is_err() {
        return ScanResult {
            id: spec.id.to_string(),
            category: spec.category,
            status: ScanStatus::Skipped,
            command: format!("{} {}", spec.program, spec.args.join(" ")),
            duration_ms: 0,
            stdout: String::new(),
            stderr: format!("Command not found: {}", spec.program),
            exit_code: None,
        };
    }

    let start = std::time::Instant::now();
    let output = Command::new(spec.program)
        .args(spec.args)
        .current_dir(project_dir)
        .output();

    match output {
        Ok(output) => {
            let status = if output.status.success() {
                ScanStatus::Passed
            } else {
                ScanStatus::Failed
            };

            ScanResult {
                id: spec.id.to_string(),
                category: spec.category,
                status,
                command: format!("{} {}", spec.program, spec.args.join(" ")),
                duration_ms: start.elapsed().as_millis(),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                exit_code: output.status.code(),
            }
        }
        Err(err) => ScanResult {
            id: spec.id.to_string(),
            category: spec.category,
            status: ScanStatus::Skipped,
            command: format!("{} {}", spec.program, spec.args.join(" ")),
            duration_ms: start.elapsed().as_millis(),
            stdout: String::new(),
            stderr: err.to_string(),
            exit_code: None,
        },
    }
}

pub fn write_report(report: &ScanReport, output_dir: &Path) -> std::io::Result<(PathBuf, PathBuf)> {
    fs::create_dir_all(output_dir)?;

    let json_path = output_dir.join("scan-report.json");
    fs::write(&json_path, serde_json::to_vec_pretty(report)?)?;

    let md_path = output_dir.join("scan-report.md");
    fs::write(&md_path, render_markdown(report))?;

    Ok((json_path, md_path))
}

pub fn has_failures(report: &ScanReport) -> bool {
    report
        .scans
        .iter()
        .any(|result| result.status == ScanStatus::Failed)
}

fn render_markdown(report: &ScanReport) -> String {
    let mut out = String::new();
    out.push_str("# Routa Scan Report\n\n");
    out.push_str(&format!(
        "- Generated at: {}\n",
        report.generated_at.to_rfc3339()
    ));
    out.push_str(&format!("- Project dir: `{}`\n\n", report.project_dir));
    out.push_str("| Tool | Category | Status | Duration (ms) | Exit Code |\n");
    out.push_str("| --- | --- | --- | ---: | ---: |\n");

    for scan in &report.scans {
        let exit = scan
            .exit_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "-".to_string());

        out.push_str(&format!(
            "| `{}` | `{:?}` | `{:?}` | {} | {} |\n",
            scan.id, scan.category, scan.status, scan.duration_ms, exit
        ));
    }

    out.push_str("\n## Details\n\n");
    for scan in &report.scans {
        out.push_str(&format!("### {}\n\n", scan.id));
        out.push_str(&format!("- Command: `{}`\n", scan.command));
        out.push_str(&format!("- Status: `{:?}`\n\n", scan.status));

        if !scan.stdout.trim().is_empty() {
            out.push_str("<details><summary>stdout</summary>\n\n```text\n");
            out.push_str(&scan.stdout);
            out.push_str("\n```\n\n</details>\n\n");
        }

        if !scan.stderr.trim().is_empty() {
            out.push_str("<details><summary>stderr</summary>\n\n```text\n");
            out.push_str(&scan.stderr);
            out.push_str("\n```\n\n</details>\n\n");
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_failed_status() {
        let report = ScanReport {
            generated_at: Utc::now(),
            project_dir: ".".to_string(),
            strict: false,
            scans: vec![ScanResult {
                id: "test".to_string(),
                category: ScanCategory::Rust,
                status: ScanStatus::Failed,
                command: "cargo clippy".to_string(),
                duration_ms: 1,
                stdout: String::new(),
                stderr: String::new(),
                exit_code: Some(1),
            }],
        };

        assert!(has_failures(&report));
    }
}
