use super::model::{
    AnalyzeFileReport, CommitHistoryEntry, GraphBuildReport, GraphEdge, GraphHistoryReport,
    GraphQueryReport, GraphStatsReport, ImpactAnalysisReport, ImpactOptions, ParsedReviewGraph,
    QueryFailure, ReviewBuildInfo, ReviewBuildMode, ReviewTarget, SymbolGraphNode,
    TestRadiusOptions, TestRadiusReport, UntestedTarget,
};
use super::tree_sitter::{
    analyze_single_file, node_to_payload, parse_changed_files, parse_repo_graph,
    query_file_imports, query_graph, QueryResult,
};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Command;

pub fn analyze_impact(
    repo_root: &Path,
    changed_files: &[String],
    options: ImpactOptions<'_>,
) -> ImpactAnalysisReport {
    if options.build_mode == ReviewBuildMode::Skip {
        return ImpactAnalysisReport {
            status: "ok".to_string(),
            summary: "No changed code files detected.".to_string(),
            base: options.base.to_string(),
            changed_files: changed_files.to_vec(),
            skipped_files: Vec::new(),
            changed_nodes: Vec::new(),
            impacted_nodes: Vec::new(),
            impacted_files: Vec::new(),
            impacted_test_files: Vec::new(),
            edges: Vec::new(),
            wide_blast_radius: false,
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
        };
    }

    let graph = parse_changed_files(repo_root, changed_files);
    build_impact_report(changed_files, options, &graph)
}

pub fn build_graph(repo_root: &Path, build_mode: ReviewBuildMode) -> GraphBuildReport {
    if build_mode == ReviewBuildMode::Skip {
        return GraphBuildReport {
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
        };
    }

    let graph = parse_repo_graph(repo_root);
    let build_type = match build_mode {
        ReviewBuildMode::Full | ReviewBuildMode::Auto => "full",
        _ => "auto",
    };

    GraphBuildReport {
        status: "ok".to_string(),
        backend: Some("builtin-tree-sitter".to_string()),
        build_type: Some(build_type.to_string()),
        summary: format!(
            "Full build: parsed {} file(s), {} nodes, {} edges.",
            graph.files_updated,
            graph.changed_nodes.len() + graph.impacted_nodes.len(),
            graph.total_edges
        ),
        files_updated: Some(graph.files_updated),
        changed_files: None,
        stale_files: Some(Vec::new()),
        total_nodes: Some(graph.changed_nodes.len() + graph.impacted_nodes.len()),
        total_edges: Some(graph.total_edges),
        languages: Some(graph.languages),
    }
}

pub fn graph_stats(repo_root: &Path) -> GraphStatsReport {
    let graph = parse_repo_graph(repo_root);
    let files = graph
        .changed_nodes
        .iter()
        .filter(|node| node.kind == "File")
        .count();
    GraphStatsReport {
        status: "ok".to_string(),
        nodes: graph.changed_nodes.len() + graph.impacted_nodes.len(),
        edges: graph.total_edges,
        files,
        languages: graph.languages,
        backend: "builtin-tree-sitter".to_string(),
    }
}

pub fn analyze_file(repo_root: &Path, target: &str) -> AnalyzeFileReport {
    let Some(result) = analyze_single_file(repo_root, target) else {
        return AnalyzeFileReport {
            status: "not_found".to_string(),
            summary: Some(format!("No file found matching '{target}'.")),
            file_path: None,
            language: None,
            is_test_file: None,
            imports: None,
            comments: None,
            symbols: None,
            source_basename: None,
        };
    };

    AnalyzeFileReport {
        status: "ok".to_string(),
        summary: None,
        file_path: Some(result.file_path),
        language: Some(result.language),
        is_test_file: Some(result.is_test_file),
        imports: Some(result.imports),
        comments: Some(result.comments),
        symbols: Some(result.symbols),
        source_basename: Some(result.source_basename),
    }
}

pub fn analyze_test_radius(
    repo_root: &Path,
    changed_files: &[String],
    options: TestRadiusOptions<'_>,
) -> TestRadiusReport {
    let impact = analyze_impact(
        repo_root,
        changed_files,
        ImpactOptions {
            base: options.base,
            build_mode: options.build_mode,
            max_depth: options.max_depth,
            max_impacted_files: options.max_impacted_files,
        },
    );

    let graph = parse_changed_files(repo_root, changed_files);
    let mut target_nodes = select_query_targets(&graph, options.max_targets);
    let mut all_tests = BTreeMap::<String, SymbolGraphNode>::new();
    let mut all_test_files = impact
        .impacted_test_files
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut query_failures = Vec::<QueryFailure>::new();
    let edge_lookup = impact.edges.clone();

    for target in &mut target_nodes {
        let query = query_graph(&graph, "tests_for", &target.qualified_name);
        match query {
            QueryResult::Ok { results, .. } => {
                target.tests = results
                    .into_iter()
                    .filter_map(|node| match node {
                        super::model::GraphNodePayload::Symbol(symbol) => Some(symbol),
                        super::model::GraphNodePayload::File(_) => None,
                    })
                    .collect();
                target.tests_count = target.tests.len();
                for test in &target.tests {
                    all_tests.insert(test.qualified_name.clone(), test.clone());
                    all_test_files.insert(test.file_path.clone());
                }
            }
            QueryResult::Err {
                status, summary, ..
            } => {
                query_failures.push(QueryFailure {
                    qualified_name: target.qualified_name.clone(),
                    status,
                    summary,
                });
                target.tests.clear();
                target.tests_count = 0;
            }
        }
    }

    let inherited = propagate_local_test_coverage(&target_nodes, &edge_lookup);
    for target in &mut target_nodes {
        let inherited_tests = inherited
            .get(&target.qualified_name)
            .cloned()
            .unwrap_or_default();
        target.inherited_tests = inherited_tests.clone();
        target.inherited_tests_count = inherited_tests.len();
        for test in inherited_tests {
            all_test_files.insert(test.file_path.clone());
            all_tests.insert(test.qualified_name.clone(), test);
        }
    }

    let untested_targets = target_nodes
        .iter()
        .filter(|target| target.tests.is_empty() && target.inherited_tests.is_empty())
        .map(|target| UntestedTarget {
            qualified_name: target.qualified_name.clone(),
            kind: target.kind.clone(),
            file_path: target.file_path.clone(),
        })
        .collect::<Vec<_>>();

    let targets_with_tests = target_nodes
        .iter()
        .filter(|target| !target.tests.is_empty())
        .count();
    let inherited_targets_with_tests = target_nodes
        .iter()
        .filter(|target| !target.inherited_tests.is_empty())
        .count();

    let summary = if target_nodes.is_empty() {
        format!(
            "Estimated test radius for {} changed file(s): no queryable changed nodes found.",
            changed_files.len()
        )
    } else if inherited_targets_with_tests > 0 {
        format!(
            "Estimated test radius for {} changed file(s): {} queryable target(s), {} with explicit tests, {} unique test file(s), {} with inherited coverage.",
            changed_files.len(),
            target_nodes.len(),
            targets_with_tests,
            all_test_files.len(),
            inherited_targets_with_tests
        )
    } else {
        format!(
            "Estimated test radius for {} changed file(s): {} queryable target(s), {} with explicit tests, {} unique test file(s).",
            changed_files.len(),
            target_nodes.len(),
            targets_with_tests,
            all_test_files.len()
        )
    };

    TestRadiusReport {
        status: "ok".to_string(),
        analysis_mode: "current_graph".to_string(),
        summary,
        base: options.base.to_string(),
        changed_files: impact.changed_files,
        skipped_files: impact.skipped_files,
        changed_nodes: impact.changed_nodes,
        impacted_nodes: impact.impacted_nodes,
        impacted_files: impact.impacted_files,
        impacted_test_files: impact.impacted_test_files,
        target_nodes,
        query_failures,
        tests: all_tests.into_values().collect(),
        test_files: all_test_files.into_iter().collect(),
        untested_targets,
        wide_blast_radius: impact.wide_blast_radius,
        build: impact.build,
        edges: impact.edges,
    }
}

pub fn query_current_graph(
    repo_root: &Path,
    target: &str,
    pattern: &str,
    build_mode: ReviewBuildMode,
) -> GraphQueryReport {
    if build_mode == ReviewBuildMode::Skip {
        return GraphQueryReport {
            status: "skipped".to_string(),
            pattern: pattern.to_string(),
            target: target.to_string(),
            summary: "Graph build skipped.".to_string(),
            results: Vec::new(),
            edges: Vec::new(),
        };
    }

    let query = if matches!(pattern, "imports_of" | "importers_of") {
        query_file_imports(repo_root, target, pattern == "importers_of")
    } else {
        let graph = if matches!(pattern, "callers_of" | "callees_of") || !target.contains(':') {
            parse_repo_graph(repo_root)
        } else if target.contains(':') {
            let file_path = target.split(':').next().unwrap_or(target).to_string();
            parse_changed_files(repo_root, &[file_path])
        } else {
            parse_repo_graph(repo_root)
        };
        query_graph(&graph, pattern, target)
    };

    match query {
        QueryResult::Ok { results, edges } => GraphQueryReport {
            status: "ok".to_string(),
            pattern: pattern.to_string(),
            target: target.to_string(),
            summary: format!(
                "Found {} result(s) for {}('{}')",
                results.len(),
                pattern,
                target
            ),
            results,
            edges,
        },
        QueryResult::Err { status, summary } => GraphQueryReport {
            status,
            pattern: pattern.to_string(),
            target: target.to_string(),
            summary,
            results: Vec::new(),
            edges: Vec::new(),
        },
    }
}

pub fn analyze_history(
    repo_root: &Path,
    count: usize,
    git_ref: &str,
    build_mode: ReviewBuildMode,
    max_depth: usize,
    max_targets: usize,
) -> GraphHistoryReport {
    let build = build_graph(repo_root, build_mode);
    let commits = git_recent_commits(repo_root, count, git_ref)
        .into_iter()
        .map(|(commit, short_commit, subject)| {
            let raw_changed_files = git_commit_changed_files(repo_root, &commit);
            let changed_files = filter_code_files(repo_root, &raw_changed_files);
            let radius = analyze_test_radius(
                repo_root,
                &changed_files,
                TestRadiusOptions {
                    base: git_ref,
                    build_mode: ReviewBuildMode::Skip,
                    max_depth,
                    max_targets,
                    max_impacted_files: 200,
                },
            );
            CommitHistoryEntry {
                commit,
                short_commit,
                subject,
                raw_changed_files,
                changed_file_count: changed_files.len(),
                changed_files,
                target_count: radius.target_nodes.len(),
                test_file_count: radius.test_files.len(),
                untested_target_count: radius.untested_targets.len(),
                wide_blast_radius: radius.wide_blast_radius,
                summary: radius.summary,
                test_files: radius.test_files,
                untested_targets: radius.untested_targets,
            }
        })
        .collect::<Vec<_>>();

    GraphHistoryReport {
        status: "ok".to_string(),
        analysis_mode: "retrospective_current_graph".to_string(),
        summary: format!(
            "Estimated test radius for {} recent commit(s) using the current graph.",
            commits.len()
        ),
        r#ref: git_ref.to_string(),
        build,
        commits,
    }
}

fn build_impact_report(
    changed_files: &[String],
    options: ImpactOptions<'_>,
    graph: &ParsedReviewGraph,
) -> ImpactAnalysisReport {
    let changed_nodes = graph
        .changed_nodes
        .iter()
        .map(node_to_payload)
        .collect::<Vec<_>>();
    let impacted_nodes = graph
        .impacted_nodes
        .iter()
        .map(node_to_payload)
        .collect::<Vec<_>>();
    let impacted_files = collect_impacted_files(graph);
    let impacted_test_files = impacted_files
        .iter()
        .filter(|path| is_test_file(path))
        .cloned()
        .collect::<Vec<_>>();

    ImpactAnalysisReport {
        status: "ok".to_string(),
        summary: format!(
            "Blast radius for {} changed file(s): {} changed node(s), {} impacted node(s).",
            changed_files.len(),
            changed_nodes.len(),
            impacted_nodes.len()
        ),
        base: options.base.to_string(),
        changed_files: changed_files.to_vec(),
        skipped_files: Vec::new(),
        changed_nodes,
        impacted_nodes,
        impacted_files: impacted_files.clone(),
        impacted_test_files,
        edges: graph.graph_edges.clone(),
        wide_blast_radius: impacted_files.len() > options.max_impacted_files,
        build: ReviewBuildInfo {
            status: "ok".to_string(),
            backend: Some("builtin-tree-sitter".to_string()),
            build_type: Some("full".to_string()),
            summary: format!(
                "Full build: parsed {} file(s), {} nodes, {} edges.",
                graph.files_updated,
                graph.changed_nodes.len() + graph.impacted_nodes.len(),
                graph.total_edges
            ),
            files_updated: Some(graph.files_updated),
            changed_files: Some(changed_files.to_vec()),
            stale_files: Some(Vec::new()),
            total_nodes: Some(graph.changed_nodes.len() + graph.impacted_nodes.len()),
            total_edges: Some(graph.total_edges),
            languages: Some(graph.languages.clone()),
        },
    }
}

fn select_query_targets(graph: &ParsedReviewGraph, max_targets: usize) -> Vec<ReviewTarget> {
    let nodes_by_qualified_name = graph
        .changed_nodes
        .iter()
        .filter(|node| !node.qualified_name.is_empty())
        .map(|node| (node.qualified_name.clone(), node))
        .collect::<BTreeMap<_, _>>();

    graph
        .changed_nodes
        .iter()
        .filter(|node| node.kind != "File" && !node.is_test)
        .filter(|node| !is_nested_local_target(node, &nodes_by_qualified_name))
        .take(max_targets)
        .map(|node| ReviewTarget {
            qualified_name: node.qualified_name.clone(),
            name: node.name.clone(),
            kind: node.kind.clone(),
            file_path: node.file_path.clone(),
            tests: Vec::new(),
            tests_count: 0,
            inherited_tests: Vec::new(),
            inherited_tests_count: 0,
        })
        .collect()
}

fn is_nested_local_target<'a>(
    node: &super::model::ChangedNode,
    nodes_by_qualified_name: &'a BTreeMap<String, &'a super::model::ChangedNode>,
) -> bool {
    let Some(parent_name) = node.parent_name.as_deref() else {
        return false;
    };
    let parent_qn = format!("{}:{parent_name}", node.file_path);
    let Some(parent) = nodes_by_qualified_name.get(&parent_qn) else {
        return false;
    };
    matches!(parent.kind.as_str(), "Function" | "Method" | "Test")
}

fn propagate_local_test_coverage(
    target_nodes: &[ReviewTarget],
    edges: &[GraphEdge],
) -> BTreeMap<String, Vec<SymbolGraphNode>> {
    let queryable = target_nodes
        .iter()
        .map(|target| (target.qualified_name.clone(), target))
        .collect::<BTreeMap<_, _>>();
    let mut adjacency = BTreeMap::<String, BTreeSet<String>>::new();

    for edge in edges.iter().filter(|edge| edge.kind == "CALLS") {
        if !queryable.contains_key(&edge.source_qualified)
            || !queryable.contains_key(&edge.target_qualified)
        {
            continue;
        }
        let source = queryable[&edge.source_qualified];
        let target = queryable[&edge.target_qualified];
        if source.file_path != target.file_path {
            continue;
        }
        adjacency
            .entry(edge.source_qualified.clone())
            .or_default()
            .insert(edge.target_qualified.clone());
        adjacency
            .entry(edge.target_qualified.clone())
            .or_default()
            .insert(edge.source_qualified.clone());
    }

    let mut propagated = BTreeMap::new();
    for target in target_nodes {
        if !target.tests.is_empty() {
            continue;
        }
        let mut inherited = BTreeMap::<String, SymbolGraphNode>::new();
        for neighbor in adjacency
            .get(&target.qualified_name)
            .into_iter()
            .flat_map(|neighbors| neighbors.iter())
        {
            if let Some(neighbor_target) = queryable.get(neighbor) {
                for test in &neighbor_target.tests {
                    inherited.insert(test.qualified_name.clone(), test.clone());
                }
            }
        }
        if !inherited.is_empty() {
            propagated.insert(
                target.qualified_name.clone(),
                inherited.into_values().collect(),
            );
        }
    }
    propagated
}

fn collect_impacted_files(graph: &ParsedReviewGraph) -> Vec<String> {
    let changed_files = graph
        .changed_nodes
        .iter()
        .filter(|node| node.kind == "File")
        .map(|node| node.file_path.as_str())
        .collect::<BTreeSet<_>>();
    graph
        .impacted_nodes
        .iter()
        .map(|node| node.file_path.clone())
        .filter(|path| !changed_files.contains(path.as_str()))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn is_test_file(path: &str) -> bool {
    let lowered = path.to_ascii_lowercase();
    lowered.contains("/src/test/java/")
        || lowered.ends_with("_test.go")
        || lowered.contains(".test.")
        || lowered.contains(".spec.")
}

fn git_recent_commits(
    repo_root: &Path,
    count: usize,
    git_ref: &str,
) -> Vec<(String, String, String)> {
    let output = Command::new("git")
        .args(["log", "--format=%H%x09%s", &format!("-n{count}"), git_ref])
        .current_dir(repo_root)
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let commit = parts.next()?;
            let subject = parts.next()?;
            Some((
                commit.to_string(),
                commit.chars().take(8).collect::<String>(),
                subject.to_string(),
            ))
        })
        .collect()
}

fn git_commit_changed_files(repo_root: &Path, commit: &str) -> Vec<String> {
    let output = Command::new("git")
        .args([
            "show",
            "--pretty=",
            "--name-only",
            "--diff-filter=ACMR",
            commit,
            "--",
            "src",
            "apps",
            "crates",
        ])
        .current_dir(repo_root)
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn filter_code_files(repo_root: &Path, files: &[String]) -> Vec<String> {
    files
        .iter()
        .filter(|file| {
            let extension = std::path::Path::new(file)
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            let extension = format!(".{extension}");
            CODE_EXTENSIONS.contains(&extension.as_str()) && repo_root.join(file).exists()
        })
        .map(ToString::to_string)
        .collect()
}

const CODE_EXTENSIONS: [&str; 8] = [".go", ".java", ".py", ".rs", ".ts", ".tsx", ".js", ".jsx"];
