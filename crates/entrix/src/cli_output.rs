use entrix::long_file::LongFileAnalysisReport;
use entrix::model::FitnessReport;
use entrix::release_trigger::ReleaseTriggerReport;
use entrix::review_context::{
    GraphHistoryReport, GraphNodePayload, GraphQueryReport, ImpactAnalysisReport,
    ReviewContextReport, TestRadiusReport,
};
use entrix::review_trigger::ReviewTriggerReport;

pub(crate) fn print_json<T: serde::Serialize>(value: &T) {
    match serde_json::to_string_pretty(value) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("failed to serialize json output: {error}");
        }
    }
}

pub(crate) fn print_report_text(report: &FitnessReport, verbose: bool) {
    let status = if report.runtime_timed_out || report.hard_gate_blocked || report.score_blocked {
        "FAIL"
    } else {
        "PASS"
    };

    println!("Entrix fitness: {status}");
    println!("Final score: {:.1}%", report.final_score);
    println!("Hard gate blocked: {}", report.hard_gate_blocked);
    println!("Score blocked: {}", report.score_blocked);
    println!("Runtime timed out: {}", report.runtime_timed_out);

    for dimension in &report.dimensions {
        println!(
            "- {}: {:.1}% ({}/{})",
            dimension.dimension, dimension.score, dimension.passed, dimension.total
        );

        if verbose {
            for result in &dimension.results {
                println!(
                    "  {} [{}] {} ({:.0}ms)",
                    if result.passed { "PASS" } else { "FAIL" },
                    result.tier.as_str(),
                    result.metric_name,
                    result.duration_ms
                );
            }
        }
    }
}

fn format_line_span(start: usize, end: usize) -> String {
    if start == end {
        format!("L{start}")
    } else {
        format!("L{start}-L{end}")
    }
}

pub(crate) fn print_hook_long_file_summary(report: &LongFileAnalysisReport) {
    for line in hook_long_file_summary_lines(report) {
        println!("{line}");
    }
}

pub(crate) fn hook_long_file_summary_lines(report: &LongFileAnalysisReport) -> Vec<String> {
    const MAX_CLASSES: usize = 3;
    const MAX_METHODS_PER_CLASS: usize = 4;
    const MAX_FUNCTIONS: usize = 5;

    if report.files.is_empty() {
        return vec![
            "Structure summary unavailable: no supported files for structural analysis."
                .to_string(),
        ];
    }

    let mut lines = vec!["Structure summary (tree-sitter symbols):".to_string()];
    for item in &report.files {
        lines.push(format!("- {}", item.file_path));

        if item.classes.is_empty() && item.functions.is_empty() {
            lines.push("  no class/function symbols found".to_string());
            continue;
        }

        for cls in item.classes.iter().take(MAX_CLASSES) {
            lines.push(format!(
                "  class {} ({}, methods={})",
                cls.name,
                format_line_span(cls.start_line, cls.end_line),
                cls.method_count,
            ));
            for method in cls.methods.iter().take(MAX_METHODS_PER_CLASS) {
                lines.push(format!(
                    "    method {} ({})",
                    method.name,
                    format_line_span(method.start_line, method.end_line),
                ));
            }
            let remaining_methods = cls.methods.len().saturating_sub(MAX_METHODS_PER_CLASS);
            if remaining_methods > 0 {
                lines.push(format!("    ... {remaining_methods} more method(s)"));
            }
        }

        let remaining_classes = item.classes.len().saturating_sub(MAX_CLASSES);
        if remaining_classes > 0 {
            lines.push(format!("  ... {remaining_classes} more class(es)"));
        }

        if !item.functions.is_empty() {
            let compact: Vec<String> = item
                .functions
                .iter()
                .take(MAX_FUNCTIONS)
                .map(|f| {
                    format!(
                        "{} ({})",
                        f.name,
                        format_line_span(f.start_line, f.end_line),
                    )
                })
                .collect();
            lines.push(format!("  functions: {}", compact.join(", ")));
            let remaining_functions = item.functions.len().saturating_sub(MAX_FUNCTIONS);
            if remaining_functions > 0 {
                lines.push(format!("  ... {remaining_functions} more function(s)"));
            }
        }

        if !item.warnings.is_empty() {
            lines.push(format!("  review-warnings: {}", item.warnings.len()));
        }
    }

    lines
}

pub(crate) fn print_long_file_report(report: &LongFileAnalysisReport, min_lines: usize) {
    if report.files.is_empty() {
        println!("No oversized or explicit files matched for long-file analysis.");
        return;
    }

    for file in &report.files {
        if file.line_count < min_lines {
            continue;
        }
        println!(
            "{} [{}] {} lines (budget {}, commits {})",
            file.file_path, file.language, file.line_count, file.budget_limit, file.commit_count
        );
        if !file.budget_reason.is_empty() {
            println!("  budget reason: {}", file.budget_reason);
        }
        for class in &file.classes {
            println!(
                "  class {} [{}-{}] methods={}",
                class.qualified_name, class.start_line, class.end_line, class.method_count
            );
        }
        for function in &file.functions {
            println!(
                "  {} {} [{}-{}] comments={} commits={}",
                function.kind,
                function.qualified_name,
                function.start_line,
                function.end_line,
                function.comment_count,
                function.commit_count
            );
        }
        for warning in &file.warnings {
            println!("  warning {}: {}", warning.code, warning.summary);
        }
    }
}

fn graph_node_label(node: &GraphNodePayload) -> String {
    match node {
        GraphNodePayload::File(node) => node.qualified_name.clone(),
        GraphNodePayload::Symbol(node) => node.qualified_name.clone(),
    }
}

pub(crate) fn graph_impact_lines(result: &ImpactAnalysisReport) -> Vec<String> {
    let mut lines = vec![result.summary.clone()];
    lines.push(format!("Changed files: {}", result.changed_files.len()));
    lines.push(format!("Impacted files: {}", result.impacted_files.len()));
    lines.push(format!(
        "Impacted test files: {}",
        result.impacted_test_files.len()
    ));
    lines.push(format!(
        "Wide blast radius: {}",
        if result.wide_blast_radius {
            "yes"
        } else {
            "no"
        }
    ));
    if !result.skipped_files.is_empty() {
        lines.push(format!(
            "Skipped files: {}",
            result
                .skipped_files
                .iter()
                .take(10)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    lines
}

pub(crate) fn print_graph_impact(result: &ImpactAnalysisReport) {
    for line in graph_impact_lines(result) {
        println!("{line}");
    }
}

pub(crate) fn graph_test_radius_lines(result: &TestRadiusReport) -> Vec<String> {
    let mut lines = vec![result.summary.clone()];
    lines.push(format!("Changed files: {}", result.changed_files.len()));
    lines.push(format!("Queryable targets: {}", result.target_nodes.len()));
    lines.push(format!("Unique test files: {}", result.test_files.len()));
    lines.push(format!(
        "Untested targets: {}",
        result.untested_targets.len()
    ));
    if !result.test_files.is_empty() {
        lines.push("Test files:".to_string());
        for file_path in result.test_files.iter().take(20) {
            lines.push(format!("  - {file_path}"));
        }
    }
    if !result.untested_targets.is_empty() {
        lines.push("Untested targets:".to_string());
        for target in result.untested_targets.iter().take(20) {
            lines.push(format!("  - {}", target.qualified_name));
        }
    }
    lines
}

pub(crate) fn print_graph_test_radius(result: &TestRadiusReport) {
    for line in graph_test_radius_lines(result) {
        println!("{line}");
    }
}

pub(crate) fn graph_query_lines(result: &GraphQueryReport) -> Vec<String> {
    let mut lines = vec![result.summary.clone()];
    for item in result.results.iter().take(20) {
        lines.push(format!("  - {}", graph_node_label(item)));
    }
    lines
}

pub(crate) fn print_graph_query(result: &GraphQueryReport) {
    for line in graph_query_lines(result) {
        println!("{line}");
    }
}

pub(crate) fn graph_history_lines(result: &GraphHistoryReport) -> Vec<String> {
    let mut lines = vec![result.summary.clone()];
    for commit in &result.commits {
        lines.push(format!(
            "{} {} | files={} targets={} tests={} untested={}",
            commit.short_commit,
            commit.subject,
            commit.changed_file_count,
            commit.target_count,
            commit.test_file_count,
            commit.untested_target_count
        ));
    }
    lines
}

pub(crate) fn print_graph_history(result: &GraphHistoryReport) {
    for line in graph_history_lines(result) {
        println!("{line}");
    }
}

pub(crate) fn graph_review_context_lines(result: &ReviewContextReport) -> Vec<String> {
    let mut lines = vec![result.summary.clone()];
    lines.push(format!(
        "Changed files: {}",
        result.context.changed_files.len()
    ));
    lines.push(format!(
        "Impacted files: {}",
        result.context.impacted_files.len()
    ));
    lines.push(format!(
        "Queryable targets: {}",
        result.context.targets.len()
    ));
    lines.push(format!(
        "Test files: {}",
        result.context.tests.test_files.len()
    ));
    lines.push("Review guidance:".to_string());
    for line in result.context.review_guidance.lines() {
        lines.push(format!("  {line}"));
    }
    if let Some(snippets) = &result.context.source_snippets {
        if !snippets.is_empty() {
            lines.push("Source snippets:".to_string());
            for snippet in snippets.iter().take(10) {
                let suffix = if snippet.truncated {
                    " (truncated)"
                } else {
                    ""
                };
                lines.push(format!("  - {}{}", snippet.file_path, suffix));
            }
        }
    }
    lines
}

pub(crate) fn print_graph_review_context(result: &ReviewContextReport) {
    for line in graph_review_context_lines(result) {
        println!("{line}");
    }
}

pub(crate) fn print_release_trigger_report(report: &ReleaseTriggerReport) {
    println!("Release trigger report");
    println!("- blocked: {}", if report.blocked { "yes" } else { "no" });
    println!(
        "- human review required: {}",
        if report.human_review_required {
            "yes"
        } else {
            "no"
        }
    );
    println!("- manifest: {}", report.manifest_path);
    if let Some(path) = &report.baseline_manifest_path {
        println!("- baseline manifest: {path}");
    }
    println!("- artifacts: {}", report.artifacts.len());
    println!("- changed files: {}", report.changed_files.len());
    if report.triggers.is_empty() {
        println!("- triggers: none");
        return;
    }
    println!("- triggers:");
    for trigger in &report.triggers {
        println!(
            "  - {} [{}] -> {}",
            trigger.name, trigger.severity, trigger.action
        );
        for reason in &trigger.reasons {
            println!("    - {reason}");
        }
    }
}

pub(crate) fn print_review_trigger_report(report: &ReviewTriggerReport) {
    println!("blocked: {}", if report.blocked { "yes" } else { "no" });
    println!(
        "human review required: {}",
        if report.human_review_required {
            "yes"
        } else {
            "no"
        }
    );
    println!(
        "staged review required: {}",
        if report.staged_review_required {
            "yes"
        } else {
            "no"
        }
    );
    println!(
        "advisory only: {}",
        if report.advisory_only { "yes" } else { "no" }
    );
    println!("base: {}", report.base);
    println!("changed files: {}", report.changed_files.len());
    println!("triggers: {}", report.triggers.len());
    for trigger in &report.triggers {
        println!(
            "- {} [{}] -> {}",
            trigger.name, trigger.severity, trigger.action
        );
        for reason in &trigger.reasons {
            println!("  - {reason}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        graph_history_lines, graph_impact_lines, graph_query_lines, graph_review_context_lines,
        graph_test_radius_lines, hook_long_file_summary_lines,
    };
    use entrix::long_file::{
        LongFileAnalysisReport, LongFileClassReport, LongFileCommentSpan, LongFileFileReport,
        LongFileFunctionReport, LongFileWarning,
    };
    use entrix::review_context::{
        FileGraphNode, GraphBuildReport, GraphContext, GraphHistoryReport, GraphQueryReport,
        ImpactAnalysisReport, QueryFailure, ReviewBuildInfo, ReviewContextPayload,
        ReviewContextReport, ReviewTarget, ReviewTests, SourceSnippet, SymbolGraphNode,
        TestRadiusReport, UntestedTarget,
    };

    fn sample_function(name: &str, start_line: usize, end_line: usize) -> LongFileFunctionReport {
        LongFileFunctionReport {
            name: name.to_string(),
            qualified_name: name.to_string(),
            file_path: "src/app.ts".to_string(),
            start_line,
            end_line,
            line_count: end_line - start_line + 1,
            commit_count: 0,
            comment_count: 0,
            comments: Vec::new(),
            kind: "function".to_string(),
            parent_class_name: None,
            warnings: Vec::new(),
        }
    }

    #[test]
    fn hook_long_file_summary_formats_symbols() {
        let report = LongFileAnalysisReport {
            status: "ok".to_string(),
            base: "HEAD".to_string(),
            summary: None,
            files: vec![LongFileFileReport {
                file_path: "src/app.ts".to_string(),
                language: "typescript".to_string(),
                line_count: 1201,
                budget_limit: 1000,
                budget_reason: "legacy hotspot".to_string(),
                over_budget: true,
                commit_count: 0,
                classes: vec![LongFileClassReport {
                    name: "AppController".to_string(),
                    qualified_name: "AppController".to_string(),
                    file_path: "src/app.ts".to_string(),
                    start_line: 10,
                    end_line: 120,
                    line_count: 111,
                    commit_count: 0,
                    comment_count: 0,
                    comments: Vec::new(),
                    method_count: 2,
                    methods: vec![
                        sample_function("handleRequest", 20, 80),
                        sample_function("renderView", 82, 110),
                    ],
                    warnings: vec![LongFileWarning {
                        code: "comment_review".to_string(),
                        summary: "review hotspot".to_string(),
                        file_path: "src/app.ts".to_string(),
                        qualified_name: "AppController".to_string(),
                        name: "AppController".to_string(),
                        symbol_kind: "Class".to_string(),
                        start_line: 10,
                        end_line: 120,
                        line_count: 111,
                        commit_count: 0,
                        comment_count: 1,
                        comment_spans: vec![LongFileCommentSpan {
                            start_line: 12,
                            end_line: 15,
                            placement: "leading".to_string(),
                        }],
                    }],
                }],
                functions: vec![sample_function("bootstrap", 130, 170)],
                warnings: Vec::new(),
            }],
        };

        let lines = hook_long_file_summary_lines(&report);
        let output = lines.join("\n");

        assert!(output.contains("Structure summary (tree-sitter symbols):"));
        assert!(output.contains("- src/app.ts"));
        assert!(output.contains("class AppController (L10-L120, methods=2)"));
        assert!(output.contains("method handleRequest (L20-L80)"));
        assert!(output.contains("functions: bootstrap (L130-L170)"));
    }

    #[test]
    fn hook_long_file_summary_reports_empty_analysis() {
        let report = LongFileAnalysisReport {
            status: "ok".to_string(),
            base: "HEAD".to_string(),
            files: Vec::new(),
            summary: None,
        };

        assert_eq!(
            hook_long_file_summary_lines(&report),
            vec![
                "Structure summary unavailable: no supported files for structural analysis."
                    .to_string()
            ]
        );
    }

    #[test]
    fn graph_text_helpers_match_python_style_summaries() {
        let impact = ImpactAnalysisReport {
            status: "ok".to_string(),
            summary: "impact summary".to_string(),
            base: "HEAD".to_string(),
            changed_files: vec!["src/a.ts".to_string()],
            skipped_files: vec!["docs/readme.md".to_string()],
            changed_nodes: Vec::new(),
            impacted_nodes: Vec::new(),
            impacted_files: vec!["src/b.ts".to_string()],
            impacted_test_files: vec!["src/b.test.ts".to_string()],
            edges: Vec::new(),
            wide_blast_radius: true,
            build: ReviewBuildInfo {
                status: "ok".to_string(),
                backend: None,
                build_type: None,
                summary: "build".to_string(),
                files_updated: None,
                changed_files: None,
                stale_files: None,
                total_nodes: None,
                total_edges: None,
                languages: None,
            },
        };
        let impact_lines = graph_impact_lines(&impact).join("\n");
        assert!(impact_lines.contains("Changed files: 1"));
        assert!(impact_lines.contains("Impacted files: 1"));
        assert!(impact_lines.contains("Wide blast radius: yes"));
        assert!(impact_lines.contains("Skipped files: docs/readme.md"));

        let test_radius = TestRadiusReport {
            status: "ok".to_string(),
            analysis_mode: "tree_sitter".to_string(),
            summary: "radius summary".to_string(),
            base: "HEAD".to_string(),
            changed_files: vec!["src/a.ts".to_string()],
            skipped_files: Vec::new(),
            changed_nodes: Vec::new(),
            impacted_nodes: Vec::new(),
            impacted_files: vec!["src/b.ts".to_string()],
            impacted_test_files: vec!["src/b.test.ts".to_string()],
            target_nodes: vec![ReviewTarget {
                qualified_name: "Service.run".to_string(),
                name: "run".to_string(),
                kind: "Function".to_string(),
                file_path: "src/a.ts".to_string(),
                tests: Vec::new(),
                tests_count: 0,
                inherited_tests: Vec::new(),
                inherited_tests_count: 0,
            }],
            query_failures: vec![QueryFailure {
                qualified_name: "Bad.target".to_string(),
                status: "error".to_string(),
                summary: "failed".to_string(),
            }],
            tests: Vec::new(),
            test_files: vec!["src/a.test.ts".to_string()],
            untested_targets: vec![UntestedTarget {
                qualified_name: "Service.run".to_string(),
                kind: "Function".to_string(),
                file_path: "src/a.ts".to_string(),
            }],
            wide_blast_radius: false,
            build: ReviewBuildInfo {
                status: "ok".to_string(),
                backend: None,
                build_type: None,
                summary: "build".to_string(),
                files_updated: None,
                changed_files: None,
                stale_files: None,
                total_nodes: None,
                total_edges: None,
                languages: None,
            },
            edges: Vec::new(),
        };
        let radius_lines = graph_test_radius_lines(&test_radius).join("\n");
        assert!(radius_lines.contains("Queryable targets: 1"));
        assert!(radius_lines.contains("Unique test files: 1"));
        assert!(radius_lines.contains("Untested targets:\n  - Service.run"));

        let query = GraphQueryReport {
            status: "ok".to_string(),
            pattern: "tests_for".to_string(),
            target: "src/a.ts".to_string(),
            summary: "query summary".to_string(),
            results: vec![entrix::review_context::GraphNodePayload::File(
                FileGraphNode {
                    qualified_name: "src/a.test.ts".to_string(),
                    name: "a.test.ts".to_string(),
                    kind: "File".to_string(),
                    file_path: "src/a.test.ts".to_string(),
                    language: "typescript".to_string(),
                    is_test: true,
                },
            )],
            edges: Vec::new(),
        };
        let query_lines = graph_query_lines(&query).join("\n");
        assert!(query_lines.contains("query summary"));
        assert!(query_lines.contains("  - src/a.test.ts"));

        let history = GraphHistoryReport {
            status: "ok".to_string(),
            analysis_mode: "tree_sitter".to_string(),
            summary: "history summary".to_string(),
            r#ref: "HEAD".to_string(),
            build: GraphBuildReport {
                status: "ok".to_string(),
                backend: None,
                build_type: None,
                summary: "build".to_string(),
                files_updated: None,
                changed_files: None,
                stale_files: None,
                total_nodes: None,
                total_edges: None,
                languages: None,
            },
            commits: vec![entrix::review_context::CommitHistoryEntry {
                commit: "abcdef123456".to_string(),
                short_commit: "abcdef1".to_string(),
                subject: "update".to_string(),
                raw_changed_files: vec!["src/a.ts".to_string()],
                changed_files: vec!["src/a.ts".to_string()],
                changed_file_count: 1,
                target_count: 2,
                test_file_count: 1,
                untested_target_count: 0,
                wide_blast_radius: false,
                summary: "commit summary".to_string(),
                test_files: vec!["src/a.test.ts".to_string()],
                untested_targets: Vec::new(),
            }],
        };
        let history_lines = graph_history_lines(&history).join("\n");
        assert!(history_lines.contains("abcdef1 update | files=1 targets=2 tests=1 untested=0"));

        let review_context = ReviewContextReport {
            status: "ok".to_string(),
            analysis_mode: "tree_sitter".to_string(),
            summary: "context summary".to_string(),
            base: "HEAD".to_string(),
            context: ReviewContextPayload {
                changed_files: vec!["src/a.ts".to_string()],
                impacted_files: vec!["src/b.ts".to_string()],
                graph: GraphContext {
                    changed_nodes: Vec::new(),
                    impacted_nodes: Vec::new(),
                    edges: Vec::new(),
                },
                targets: vec![ReviewTarget {
                    qualified_name: "Service.run".to_string(),
                    name: "run".to_string(),
                    kind: "Function".to_string(),
                    file_path: "src/a.ts".to_string(),
                    tests: vec![SymbolGraphNode {
                        qualified_name: "ServiceTest.run".to_string(),
                        name: "run".to_string(),
                        kind: "Function".to_string(),
                        file_path: "src/a.test.ts".to_string(),
                        line_start: 1,
                        line_end: 2,
                        language: "typescript".to_string(),
                        parent_name: None,
                        is_test: true,
                        references: Vec::new(),
                        extends: String::new(),
                    }],
                    tests_count: 1,
                    inherited_tests: Vec::new(),
                    inherited_tests_count: 0,
                }],
                tests: ReviewTests {
                    test_files: vec!["src/a.test.ts".to_string()],
                    untested_targets: Vec::new(),
                    query_failures: Vec::new(),
                },
                review_guidance: "Review callers\nCheck tests".to_string(),
                source_snippets: Some(vec![SourceSnippet {
                    file_path: "src/a.ts".to_string(),
                    line_count: 200,
                    truncated: true,
                    content: "content".to_string(),
                }]),
            },
            build: ReviewBuildInfo {
                status: "ok".to_string(),
                backend: None,
                build_type: None,
                summary: "build".to_string(),
                files_updated: None,
                changed_files: None,
                stale_files: None,
                total_nodes: None,
                total_edges: None,
                languages: None,
            },
        };
        let context_lines = graph_review_context_lines(&review_context).join("\n");
        assert!(context_lines.contains("Changed files: 1"));
        assert!(context_lines.contains("Review guidance:\n  Review callers\n  Check tests"));
        assert!(context_lines.contains("Source snippets:\n  - src/a.ts (truncated)"));
    }
}
