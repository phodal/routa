use crate::model::{EvidenceType, Metric, MetricResult, ResultState};
use crate::review_context::{
    analyze_impact, analyze_test_radius, ImpactOptions, ReviewBuildMode, TestRadiusOptions,
};
use crate::runner::{ProgressCallback, ShellRunner};
use crate::sarif::SarifRunner;
use crate::test_mapping;
use std::collections::BTreeMap;
use std::path::Path;

const CODE_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "kt", "swift", "php", "c", "cpp",
];

pub struct RunMetricBatchOptions<'a> {
    pub dry_run: bool,
    pub parallel: bool,
    pub changed_files: &'a [String],
    pub base: &'a str,
    pub progress_callback: Option<&'a ProgressCallback>,
}

pub fn run_metric_batch(
    repo_root: &Path,
    metrics: &[Metric],
    shell_runner: &ShellRunner,
    sarif_runner: &SarifRunner,
    options: RunMetricBatchOptions<'_>,
) -> Vec<MetricResult> {
    let mut results = metrics
        .iter()
        .map(|metric| {
            MetricResult::new(metric.name.clone(), false, "", metric.tier)
                .with_hard_gate(metric.hard_gate)
                .with_state(ResultState::Unknown)
        })
        .collect::<Vec<_>>();
    let mut shell_batch = Vec::new();
    let mut shell_indexes = Vec::new();
    let mut sarif_batch = Vec::new();
    let mut sarif_indexes = Vec::new();

    for (index, metric) in metrics.iter().enumerate() {
        match metric.evidence_type {
            EvidenceType::Probe => {
                if let Some(callback) = options.progress_callback {
                    callback("start", metric, None);
                }
                results[index] = run_probe_metric(
                    repo_root,
                    metric,
                    options.dry_run,
                    options.changed_files,
                    options.base,
                );
                if let Some(callback) = options.progress_callback {
                    callback("end", metric, Some(&results[index]));
                }
            }
            EvidenceType::Sarif => {
                sarif_batch.push(metric.clone());
                sarif_indexes.push(index);
            }
            _ => {
                shell_batch.push(metric.clone());
                shell_indexes.push(index);
            }
        }
    }

    if !shell_batch.is_empty() {
        let shell_results = shell_runner.run_batch(
            &shell_batch,
            options.parallel,
            options.dry_run,
            options.progress_callback,
        );
        for (index, result) in shell_indexes.into_iter().zip(shell_results) {
            results[index] = result;
        }
    }

    if !sarif_batch.is_empty() {
        for metric in &sarif_batch {
            if let Some(callback) = options.progress_callback {
                callback("start", metric, None);
            }
        }
        let sarif_results = sarif_runner.run_batch(&sarif_batch, options.dry_run);
        for ((index, metric), result) in sarif_indexes
            .into_iter()
            .zip(sarif_batch.iter())
            .zip(sarif_results)
        {
            results[index] = result;
            if let Some(callback) = options.progress_callback {
                callback("end", metric, Some(&results[index]));
            }
        }
    }

    results
}

fn run_probe_metric(
    repo_root: &Path,
    metric: &Metric,
    dry_run: bool,
    changed_files: &[String],
    base: &str,
) -> MetricResult {
    if let Some(ref waiver) = metric.waiver {
        if waiver.is_active(None) {
            return MetricResult::new(
                metric.name.clone(),
                true,
                format!("[WAIVED] {}", waiver.reason),
                metric.tier,
            )
            .with_hard_gate(metric.hard_gate)
            .with_state(ResultState::Waived);
        }
    }

    if dry_run {
        return MetricResult::new(
            metric.name.clone(),
            true,
            format!("[DRY-RUN] Would run probe: {}", metric.command),
            metric.tier,
        )
        .with_hard_gate(metric.hard_gate);
    }

    let mut result = match metric.command.as_str() {
        "graph:impact" => probe_impact(repo_root, changed_files, base),
        "graph:test-radius" | "graph:test-coverage" => {
            probe_test_coverage(repo_root, changed_files, base)
        }
        command
            if command == "graph:test-mapping"
                || command.contains("test-mapping-smart.ts")
                || metric.name.contains("test_mapping") =>
        {
            probe_test_mapping(repo_root, changed_files, base)
        }
        _ => MetricResult::new(
            metric.name.clone(),
            false,
            format!("Unsupported probe command: {}", metric.command),
            metric.tier,
        )
        .with_hard_gate(metric.hard_gate)
        .with_state(ResultState::Unknown),
    };

    result.metric_name = metric.name.clone();
    result.tier = metric.tier;
    result.hard_gate = metric.hard_gate;
    result
}

fn probe_impact(repo_root: &Path, changed_files: &[String], base: &str) -> MetricResult {
    let impact = analyze_impact(
        repo_root,
        changed_files,
        ImpactOptions {
            base,
            build_mode: ReviewBuildMode::Auto,
            max_depth: 2,
            max_impacted_files: 200,
        },
    );

    let lines = [
        format!("graph_probe_status: {}", impact.status),
        format!("graph_changed_files: {}", impact.changed_files.len()),
        format!("graph_impacted_files: {}", impact.impacted_files.len()),
        format!(
            "graph_impacted_test_files: {}",
            impact.impacted_test_files.len()
        ),
        format!(
            "graph_wide_blast_radius: {}",
            if impact.wide_blast_radius {
                "yes"
            } else {
                "no"
            }
        ),
        format!("graph_summary: {}", impact.summary),
    ];

    MetricResult::new(
        "graph_probe",
        !impact.wide_blast_radius,
        lines.join("\n"),
        crate::model::Tier::Normal,
    )
}

fn probe_test_coverage(repo_root: &Path, changed_files: &[String], base: &str) -> MetricResult {
    let radius = analyze_test_radius(
        repo_root,
        changed_files,
        TestRadiusOptions {
            base,
            build_mode: ReviewBuildMode::Auto,
            max_depth: 1,
            max_targets: 25,
            max_impacted_files: 200,
        },
    );

    if radius.changed_files.is_empty() {
        return MetricResult::new(
            "graph_test_coverage",
            false,
            "graph_test_coverage: skipped (no changed files)\nchanged_files: 0\ntest_files_in_radius: 0",
            crate::model::Tier::Normal,
        )
        .with_state(ResultState::Skipped);
    }

    MetricResult::new(
        "graph_test_coverage",
        !radius.test_files.is_empty(),
        format!(
            "graph_test_coverage: {}\nchanged_files: {}\ntest_files_in_radius: {}",
            if radius.test_files.is_empty() {
                "warn"
            } else {
                "ok"
            },
            radius.changed_files.len(),
            radius.test_files.len()
        ),
        crate::model::Tier::Normal,
    )
}

fn probe_test_mapping(repo_root: &Path, changed_files: &[String], _base: &str) -> MetricResult {
    let code_files = changed_files
        .iter()
        .filter(|file| is_code_file(repo_root, file))
        .cloned()
        .collect::<Vec<_>>();
    let report = test_mapping::analyze_test_mappings(
        repo_root,
        &code_files,
        test_mapping::TestMappingAnalysisOptions {
            base: _base,
            build_mode: ReviewBuildMode::Auto,
            use_graph: true,
        },
    );
    let source_file_count = report.mappings.len();
    if source_file_count == 0 {
        return MetricResult::new(
            "graph_test_mapping",
            false,
            "graph_test_mapping: skipped (no changed source files)\nchanged_source_files: 0\nmissing_mappings: 0\nunknown_mappings: 0",
            crate::model::Tier::Normal,
        )
        .with_state(ResultState::Skipped);
    }

    let missing = report
        .status_counts
        .get("missing")
        .copied()
        .unwrap_or_default();
    let unknown = report
        .status_counts
        .get("unknown")
        .copied()
        .unwrap_or_default();
    let changed = report
        .status_counts
        .get("changed")
        .copied()
        .unwrap_or_default();
    let exists = report
        .status_counts
        .get("exists")
        .copied()
        .unwrap_or_default();
    let inline = report
        .status_counts
        .get("inline")
        .copied()
        .unwrap_or_default();

    MetricResult::new(
        "graph_test_mapping",
        missing == 0,
        format!(
            "graph_test_mapping: {}\nchanged_source_files: {}\nchanged_test_mappings: {}\nexisting_test_mappings: {}\ninline_test_mappings: {}\nmissing_mappings: {}\nunknown_mappings: {}\nmissing_files: {}\nunknown_files: {}\nresolver_breakdown: {}",
            if missing == 0 { "ok" } else { "warn" },
            source_file_count,
            changed,
            exists,
            inline,
            missing,
            unknown,
            mapping_source_preview(&report.mappings, "missing"),
            mapping_source_preview(&report.mappings, "unknown"),
            resolver_breakdown(&report.resolver_counts),
        ),
        crate::model::Tier::Normal,
    )
}

fn is_code_file(repo_root: &Path, rel_path: &str) -> bool {
    let extension = Path::new(rel_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    CODE_EXTENSIONS.contains(&extension.as_str()) && repo_root.join(rel_path).exists()
}

fn mapping_source_preview(mappings: &[test_mapping::TestMappingRecord], status: &str) -> String {
    let preview = mappings
        .iter()
        .filter(|mapping| mapping.status.as_str() == status)
        .map(|mapping| mapping.source_file.clone())
        .take(5)
        .collect::<Vec<_>>();
    if preview.is_empty() {
        "-".to_string()
    } else {
        preview.join(",")
    }
}

fn resolver_breakdown(counts: &BTreeMap<String, usize>) -> String {
    if counts.is_empty() {
        return "-".to_string();
    }
    counts
        .iter()
        .map(|(name, count)| format!("{name}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn probe_test_mapping_skips_when_no_changed_source_files() {
        let temp = tempdir().expect("tempdir");
        let result = probe_test_mapping(temp.path(), &[], "HEAD");
        assert_eq!(result.state, ResultState::Skipped);
        assert!(result.output.contains("changed_source_files: 0"));
    }

    #[test]
    fn probe_test_mapping_passes_on_unknown_without_missing() {
        let temp = tempdir().expect("tempdir");
        let repo_root = temp.path();
        std::fs::create_dir_all(repo_root.join("src")).expect("create src");
        std::fs::write(repo_root.join("src/service.rs"), "pub fn run() {}\n")
            .expect("write source");

        let result = probe_test_mapping(repo_root, &["src/service.rs".to_string()], "HEAD");
        assert!(result.passed);
        assert_eq!(result.state, ResultState::Pass);
        assert!(result.output.contains("unknown_mappings: 1"));
        assert!(result.output.contains("missing_mappings: 0"));
    }

    #[test]
    fn probe_test_mapping_warns_on_missing() {
        let temp = tempdir().expect("tempdir");
        let repo_root = temp.path();
        std::fs::create_dir_all(repo_root.join("src/main/java/com/example"))
            .expect("create java dir");
        std::fs::write(
            repo_root.join("src/main/java/com/example/OrderService.java"),
            "class OrderService {}\n",
        )
        .expect("write java source");

        let result = probe_test_mapping(
            repo_root,
            &["src/main/java/com/example/OrderService.java".to_string()],
            "HEAD",
        );
        assert!(!result.passed);
        assert_eq!(result.state, ResultState::Fail);
        assert!(result.output.contains("graph_test_mapping: warn"));
        assert!(result.output.contains("missing_mappings: 1"));
    }
}
