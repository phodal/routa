use super::analysis::analyze_test_radius;
use super::model::{
    GraphContext, GraphEdge, ReviewBuildInfo, ReviewBuildMode, ReviewContextOptions,
    ReviewContextPayload, ReviewContextReport, ReviewTests, SourceSnippet, TestRadiusOptions,
    UntestedTarget,
};
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

pub fn build_review_context(
    repo_root: &Path,
    changed_files: &[String],
    options: ReviewContextOptions<'_>,
) -> ReviewContextReport {
    if options.build_mode == ReviewBuildMode::Skip {
        return build_skip_review_context(repo_root, changed_files, options);
    }

    let radius = analyze_test_radius(
        repo_root,
        changed_files,
        TestRadiusOptions {
            base: options.base,
            build_mode: options.build_mode,
            max_depth: options.max_depth,
            max_targets: options.max_targets,
            max_impacted_files: 200,
        },
    );
    let review_guidance = generate_review_guidance(
        &radius.untested_targets,
        radius.wide_blast_radius,
        radius.impacted_test_files.len(),
        radius.impacted_files.len(),
        radius.query_failures.len(),
        !radius.target_nodes.is_empty(),
    );
    let source_snippets = options.include_source.then(|| {
        collect_source_snippets(
            repo_root,
            &radius.changed_files,
            &radius.test_files,
            &radius.impacted_files,
            options.max_files,
            options.max_lines_per_file,
        )
    });

    ReviewContextReport {
        status: "ok".to_string(),
        analysis_mode: "current_graph".to_string(),
        summary: format!(
            "Review context for {} changed file(s):\n  - {} directly changed nodes\n  - {} impacted nodes in {} files\n\nReview guidance:\n{}",
            radius.changed_files.len(),
            radius.changed_nodes.len(),
            radius.impacted_nodes.len(),
            radius.impacted_files.len(),
            review_guidance
        ),
        base: options.base.to_string(),
        context: ReviewContextPayload {
            changed_files: radius.changed_files.clone(),
            impacted_files: radius.impacted_files.clone(),
            graph: GraphContext {
                changed_nodes: radius.changed_nodes.clone(),
                impacted_nodes: radius.impacted_nodes.clone(),
                edges: radius.edges.iter().map(edge_to_payload).collect(),
            },
            targets: radius.target_nodes.clone(),
            tests: ReviewTests {
                test_files: radius.test_files.clone(),
                untested_targets: radius.untested_targets.clone(),
                query_failures: radius
                    .query_failures
                    .iter()
                    .map(|failure| {
                        serde_json::json!({
                            "qualified_name": failure.qualified_name,
                            "status": failure.status,
                            "summary": failure.summary,
                        })
                    })
                    .collect(),
            },
            review_guidance,
            source_snippets,
        },
        build: radius.build,
    }
}

fn build_skip_review_context(
    repo_root: &Path,
    changed_files: &[String],
    options: ReviewContextOptions<'_>,
) -> ReviewContextReport {
    let review_guidance = "- No graph-derived review guidance available.".to_string();
    let source_snippets = options.include_source.then(|| {
        collect_source_snippets(
            repo_root,
            changed_files,
            &[],
            &[],
            options.max_files,
            options.max_lines_per_file,
        )
    });

    ReviewContextReport {
        status: "ok".to_string(),
        analysis_mode: "current_graph".to_string(),
        summary: format!(
            "Review context for {} changed file(s):\n  - 0 directly changed nodes\n  - 0 impacted nodes in 0 files\n\nReview guidance:\n{}",
            changed_files.len(),
            review_guidance
        ),
        base: options.base.to_string(),
        context: ReviewContextPayload {
            changed_files: changed_files.to_vec(),
            impacted_files: Vec::new(),
            graph: GraphContext {
                changed_nodes: Vec::new(),
                impacted_nodes: Vec::new(),
                edges: Vec::new(),
            },
            targets: Vec::new(),
            tests: ReviewTests {
                test_files: Vec::new(),
                untested_targets: Vec::new(),
                query_failures: Vec::new(),
            },
            review_guidance,
            source_snippets,
        },
        build: ReviewBuildInfo {
            status: "skipped".to_string(),
            backend: None,
            build_type: None,
            summary: "Graph build skipped.".to_string(),
            files_updated: None,
            changed_files: None,
            stale_files: None,
            total_nodes: None,
            total_edges: None,
            languages: None,
        },
    }
}

fn generate_review_guidance(
    untested_targets: &[UntestedTarget],
    wide_blast_radius: bool,
    impacted_test_files: usize,
    impacted_files: usize,
    query_failures: usize,
    changed_targets_present: bool,
) -> String {
    let mut guidance_parts = Vec::new();

    if !untested_targets.is_empty() {
        let names = untested_targets
            .iter()
            .take(5)
            .map(|target| target.qualified_name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        guidance_parts.push(format!(
            "- {} changed target(s) lack direct or inherited tests: {}",
            untested_targets.len(),
            names
        ));
    }

    if wide_blast_radius {
        guidance_parts.push(format!(
            "- Wide blast radius: {impacted_files} impacted files. Review callers, API routes, and downstream workflows carefully."
        ));
    }

    if impacted_test_files > 0 {
        guidance_parts.push(format!(
            "- {impacted_test_files} impacted test file(s) were identified. Prioritize those before broader regression sweeps."
        ));
    }

    if query_failures > 0 {
        guidance_parts.push(format!(
            "- {query_failures} graph query failure(s) occurred. Treat the result as partial and verify critical paths manually."
        ));
    }

    if changed_targets_present && !wide_blast_radius && untested_targets.is_empty() {
        guidance_parts
            .push("- Changes appear locally test-covered and reasonably contained.".to_string());
    }

    if guidance_parts.is_empty() {
        guidance_parts.push("- No graph-derived review guidance available.".to_string());
    }

    guidance_parts.join("\n")
}

fn collect_source_snippets(
    repo_root: &Path,
    changed_files: &[String],
    test_files: &[String],
    impacted_files: &[String],
    max_files: usize,
    max_lines_per_file: usize,
) -> Vec<SourceSnippet> {
    let mut ranked_paths = Vec::new();
    let mut seen = BTreeSet::new();
    for path in changed_files
        .iter()
        .chain(test_files.iter())
        .chain(impacted_files.iter())
    {
        if seen.insert(path.clone()) {
            ranked_paths.push(path.clone());
        }
    }

    ranked_paths
        .into_iter()
        .take(max_files)
        .filter_map(|relative_path| {
            read_source_snippet(repo_root, &relative_path, max_lines_per_file)
        })
        .collect()
}

fn read_source_snippet(
    repo_root: &Path,
    relative_path: &str,
    max_lines: usize,
) -> Option<SourceSnippet> {
    let path = repo_root.join(relative_path);
    if !path.is_file() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    let lines: Vec<&str> = content.lines().collect();

    Some(SourceSnippet {
        file_path: relative_path.to_string(),
        line_count: lines.len(),
        truncated: lines.len() > max_lines,
        content: lines
            .into_iter()
            .take(max_lines)
            .collect::<Vec<_>>()
            .join("\n"),
    })
}

fn edge_to_payload(edge: &GraphEdge) -> serde_json::Value {
    serde_json::json!({
        "kind": edge.kind,
        "source_qualified": edge.source_qualified,
        "target_qualified": edge.target_qualified,
        "file_path": edge.file_path,
        "source_file": edge.source_file,
        "target_file": edge.target_file,
    })
}
