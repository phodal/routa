mod go;
mod java;
mod python;
mod rust;
#[cfg(test)]
mod tests;
mod typescript;

use super::model::{
    ChangedNode, FileGraphNode, GraphEdge, GraphNodePayload, ParsedReviewGraph, SymbolGraphNode,
};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;
use tree_sitter::{Language, Parser};

pub fn parse_changed_files(repo_root: &Path, changed_files: &[String]) -> ParsedReviewGraph {
    let mut changed_nodes = Vec::new();
    let mut related_test_nodes = Vec::new();
    let mut impacted_nodes = Vec::new();
    let mut file_imports = BTreeMap::new();
    let mut files_updated = 0usize;
    let mut languages = BTreeSet::new();
    let mut related_test_files = BTreeSet::new();

    for relative_path in changed_files {
        let full_path = repo_root.join(relative_path);
        let Ok(source) = fs::read_to_string(&full_path) else {
            continue;
        };
        let Some(language) = language_config_for_path(relative_path) else {
            continue;
        };
        let is_test_file = (language.is_test_file)(relative_path);
        files_updated += 1;
        languages.insert(language.name.to_string());

        changed_nodes.push(ChangedNode {
            qualified_name: relative_path.clone(),
            name: file_name(relative_path),
            kind: "File".to_string(),
            file_path: relative_path.clone(),
            language: language.name.to_string(),
            is_test: is_test_file,
            line_start: None,
            line_end: None,
            parent_name: None,
            references: Vec::new(),
            extends: String::new(),
            mentions: Vec::new(),
        });

        let mut parser = Parser::new();
        if parser.set_language(&language.ts_language()).is_err() {
            continue;
        }
        let Some(tree) = parser.parse(&source, None) else {
            continue;
        };
        let imports = (language.parse_imports)(repo_root, relative_path, &source, tree.root_node());
        file_imports.insert(relative_path.clone(), imports);

        let mut file_nodes = (language.parse_nodes)(relative_path, &source, tree.root_node());
        mark_test_symbols(&mut file_nodes, is_test_file);
        changed_nodes.append(&mut file_nodes);

        if !(language.is_test_file)(relative_path) {
            for candidate in (language.companion_test_candidates)(relative_path) {
                if changed_files.contains(&candidate) || !repo_root.join(&candidate).is_file() {
                    continue;
                }
                if !related_test_files.insert(candidate.clone()) {
                    continue;
                }
                let Some(test_language) = language_config_for_path(&candidate) else {
                    continue;
                };
                languages.insert(test_language.name.to_string());
                impacted_nodes.push(ChangedNode {
                    qualified_name: candidate.clone(),
                    name: file_name(&candidate),
                    kind: "File".to_string(),
                    file_path: candidate.clone(),
                    language: test_language.name.to_string(),
                    is_test: true,
                    line_start: None,
                    line_end: None,
                    parent_name: None,
                    references: Vec::new(),
                    extends: String::new(),
                    mentions: Vec::new(),
                });
                let Ok(test_source) = fs::read_to_string(repo_root.join(&candidate)) else {
                    continue;
                };
                let mut parser = Parser::new();
                if parser.set_language(&test_language.ts_language()).is_err() {
                    continue;
                }
                let Some(test_tree) = parser.parse(&test_source, None) else {
                    continue;
                };
                let imports = (test_language.parse_imports)(
                    repo_root,
                    &candidate,
                    &test_source,
                    test_tree.root_node(),
                );
                file_imports.insert(candidate.clone(), imports);
                let mut test_nodes =
                    (test_language.parse_nodes)(&candidate, &test_source, test_tree.root_node());
                mark_test_symbols(&mut test_nodes, (test_language.is_test_file)(&candidate));
                impacted_nodes.extend(test_nodes.iter().cloned());
                related_test_nodes.append(&mut test_nodes);
            }
        }
    }

    let target_tests = derive_target_tests(&changed_nodes, &related_test_nodes);
    let graph_edges = derive_graph_edges(
        &changed_nodes,
        &related_test_nodes,
        &file_imports,
        &target_tests,
    );
    let total_edges = graph_edges.len();

    ParsedReviewGraph {
        changed_nodes,
        related_test_nodes,
        impacted_nodes,
        graph_edges,
        files_updated,
        total_edges,
        languages: languages.into_iter().collect(),
    }
}

fn mark_test_symbols(nodes: &mut [ChangedNode], is_test_file: bool) {
    if !is_test_file {
        return;
    }

    for node in nodes.iter_mut() {
        node.is_test = true;
        if node.kind == "Function" {
            node.kind = "Test".to_string();
        }
    }
}

pub fn parse_repo_graph(repo_root: &Path) -> ParsedReviewGraph {
    let files = collect_repo_files(repo_root);
    parse_changed_files(repo_root, &files)
}

pub fn node_to_payload(node: &ChangedNode) -> GraphNodePayload {
    if node.kind == "File" {
        return GraphNodePayload::File(FileGraphNode {
            qualified_name: node.qualified_name.clone(),
            name: node.name.clone(),
            kind: node.kind.clone(),
            file_path: node.file_path.clone(),
            language: node.language.clone(),
            is_test: node.is_test,
        });
    }

    GraphNodePayload::Symbol(SymbolGraphNode {
        qualified_name: node.qualified_name.clone(),
        name: node.name.clone(),
        kind: node.kind.clone(),
        file_path: node.file_path.clone(),
        line_start: node.line_start.unwrap_or(1),
        line_end: node.line_end.unwrap_or(1),
        language: node.language.clone(),
        parent_name: node.parent_name.clone(),
        is_test: node.is_test,
        references: node.references.clone(),
        extends: node.extends.clone(),
    })
}

pub enum QueryResult {
    Ok {
        results: Vec<GraphNodePayload>,
        edges: Vec<GraphEdge>,
    },
    Err {
        status: String,
        summary: String,
    },
}

pub fn query_graph(graph: &ParsedReviewGraph, query_type: &str, target: &str) -> QueryResult {
    let Some(resolved_target) = resolve_graph_target(graph, target) else {
        return QueryResult::Err {
            status: "not_found".to_string(),
            summary: format!("No node found matching '{target}'."),
        };
    };

    match query_type {
        "tests_for" => query_tests_for(graph, &resolved_target),
        "callers_of" => query_neighbors(graph, &resolved_target, true),
        "callees_of" => query_neighbors(graph, &resolved_target, false),
        "children_of" => query_children_of(graph, &resolved_target),
        "inheritors_of" => query_inheritors_of(graph, &resolved_target),
        "file_summary" => query_file_summary(graph, &resolved_target),
        _ => QueryResult::Err {
            status: "error".to_string(),
            summary: format!("Unknown query type '{query_type}'."),
        },
    }
}

fn derive_target_tests(
    changed_nodes: &[ChangedNode],
    related_test_nodes: &[ChangedNode],
) -> Vec<(String, String)> {
    let targets: Vec<&ChangedNode> = changed_nodes
        .iter()
        .filter(|node| node.kind != "File" && !node.is_test)
        .collect();
    let tests: Vec<&ChangedNode> = changed_nodes
        .iter()
        .chain(related_test_nodes.iter())
        .filter(|node| node.is_test)
        .collect();
    let mut edges = Vec::new();
    for target in targets {
        for test in &tests {
            if test_targets_node(test, target) {
                edges.push((target.qualified_name.clone(), test.qualified_name.clone()));
            }
        }
    }
    edges
}

fn derive_graph_edges(
    changed_nodes: &[ChangedNode],
    related_test_nodes: &[ChangedNode],
    file_imports: &BTreeMap<String, Vec<String>>,
    target_tests: &[(String, String)],
) -> Vec<GraphEdge> {
    let mut edges = Vec::new();
    let mut seen = BTreeSet::new();
    let file_nodes = changed_nodes
        .iter()
        .filter(|node| node.kind == "File")
        .chain(related_test_nodes.iter().filter(|node| node.kind == "File"))
        .collect::<Vec<_>>();
    let symbol_nodes = changed_nodes
        .iter()
        .chain(related_test_nodes.iter())
        .filter(|node| node.kind != "File")
        .collect::<Vec<_>>();

    for file in file_nodes {
        for symbol in symbol_nodes
            .iter()
            .filter(|symbol| symbol.file_path == file.file_path)
        {
            push_edge(
                &mut edges,
                &mut seen,
                GraphEdge {
                    kind: "CONTAINS",
                    source_qualified: file.qualified_name.clone(),
                    target_qualified: symbol.qualified_name.clone(),
                    file_path: file.file_path.clone(),
                    source_file: file.file_path.clone(),
                    target_file: symbol.file_path.clone(),
                },
            );
        }
    }

    for (target, test) in target_tests {
        let source_file = symbol_nodes
            .iter()
            .find(|node| node.qualified_name == *test)
            .map(|node| node.file_path.clone())
            .unwrap_or_default();
        let target_file = symbol_nodes
            .iter()
            .find(|node| node.qualified_name == *target)
            .map(|node| node.file_path.clone())
            .unwrap_or_default();
        push_edge(
            &mut edges,
            &mut seen,
            GraphEdge {
                kind: "TESTED_BY",
                source_qualified: test.clone(),
                target_qualified: target.clone(),
                file_path: source_file.clone(),
                source_file,
                target_file,
            },
        );
    }

    for source in &symbol_nodes {
        for target in &symbol_nodes {
            if source.qualified_name == target.qualified_name {
                continue;
            }
            if extends_target(source, target) {
                push_edge(
                    &mut edges,
                    &mut seen,
                    GraphEdge {
                        kind: "INHERITS",
                        source_qualified: source.qualified_name.clone(),
                        target_qualified: target.qualified_name.clone(),
                        file_path: source.file_path.clone(),
                        source_file: source.file_path.clone(),
                        target_file: target.file_path.clone(),
                    },
                );
            }
        }
    }

    for source in &symbol_nodes {
        for reference in source.references.iter().chain(source.mentions.iter()) {
            for target in resolve_call_targets(&symbol_nodes, file_imports, source, reference) {
                let kind = if !source.is_test && !target.is_test {
                    "CALLS"
                } else {
                    "REFERENCES"
                };
                push_edge(
                    &mut edges,
                    &mut seen,
                    GraphEdge {
                        kind,
                        source_qualified: source.qualified_name.clone(),
                        target_qualified: target.qualified_name.clone(),
                        file_path: source.file_path.clone(),
                        source_file: source.file_path.clone(),
                        target_file: target.file_path.clone(),
                    },
                );
            }
        }
    }

    edges
}

fn resolve_call_targets<'a>(
    symbol_nodes: &'a [&ChangedNode],
    file_imports: &BTreeMap<String, Vec<String>>,
    source: &ChangedNode,
    reference: &str,
) -> Vec<&'a ChangedNode> {
    let mut candidates = BTreeMap::<String, &ChangedNode>::new();

    for candidate in symbol_nodes.iter().copied() {
        if candidate.qualified_name == source.qualified_name || candidate.is_test {
            continue;
        }
        if candidate.file_path == source.file_path && candidate.name == reference {
            candidates.insert(candidate.qualified_name.clone(), candidate);
        }
    }

    for imported in file_imports
        .get(&source.file_path)
        .into_iter()
        .flat_map(|imports| imports.iter())
    {
        for candidate in symbol_nodes.iter().copied() {
            if candidate.is_test {
                continue;
            }
            if &candidate.file_path == imported && candidate.name == reference {
                candidates.insert(candidate.qualified_name.clone(), candidate);
            }
        }
    }

    if !candidates.is_empty() {
        return candidates.into_values().collect();
    }

    let global_candidates = symbol_nodes
        .iter()
        .copied()
        .filter(|candidate| {
            !candidate.is_test
                && candidate.name == reference
                && candidate.qualified_name != source.qualified_name
        })
        .collect::<Vec<_>>();
    if global_candidates.len() == 1 && !is_generic_symbol_name(reference) {
        return global_candidates;
    }
    Vec::new()
}

fn is_generic_symbol_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "new"
            | "default"
            | "get"
            | "set"
            | "save"
            | "load"
            | "run"
            | "main"
            | "from"
            | "into"
            | "clone"
            | "update"
            | "create"
    )
}

fn push_edge(
    out: &mut Vec<GraphEdge>,
    seen: &mut BTreeSet<(String, String, &'static str)>,
    edge: GraphEdge,
) {
    let key = (
        edge.source_qualified.clone(),
        edge.target_qualified.clone(),
        edge.kind,
    );
    if seen.insert(key) {
        out.push(edge);
    }
}

fn query_tests_for(graph: &ParsedReviewGraph, target: &str) -> QueryResult {
    let mut results = BTreeMap::<String, GraphNodePayload>::new();
    let symbol_nodes = graph
        .changed_nodes
        .iter()
        .chain(graph.related_test_nodes.iter())
        .filter(|node| node.kind != "File")
        .map(|node| (node.qualified_name.clone(), node))
        .collect::<BTreeMap<_, _>>();
    let targets = if graph
        .changed_nodes
        .iter()
        .any(|node| node.qualified_name == target && node.kind == "File")
    {
        graph
            .changed_nodes
            .iter()
            .filter(|node| node.file_path == target && node.kind != "File")
            .map(|node| node.qualified_name.clone())
            .collect::<Vec<_>>()
    } else {
        vec![target.to_string()]
    };
    for edge in graph
        .graph_edges
        .iter()
        .filter(|edge| edge.kind == "TESTED_BY")
    {
        if targets
            .iter()
            .any(|candidate| candidate == &edge.target_qualified)
        {
            if let Some(node) = symbol_nodes.get(&edge.source_qualified) {
                results.insert(
                    edge.source_qualified.clone(),
                    GraphNodePayload::Symbol(symbol_to_payload(node)),
                );
            }
        }
    }
    QueryResult::Ok {
        results: results.into_values().collect(),
        edges: graph
            .graph_edges
            .iter()
            .filter(|edge| {
                edge.kind == "TESTED_BY"
                    && targets
                        .iter()
                        .any(|candidate| candidate == &edge.target_qualified)
            })
            .cloned()
            .collect(),
    }
}

fn query_neighbors(graph: &ParsedReviewGraph, target: &str, reverse: bool) -> QueryResult {
    let symbol_nodes = graph
        .changed_nodes
        .iter()
        .chain(graph.related_test_nodes.iter())
        .filter(|node| node.kind != "File")
        .map(|node| (node.qualified_name.clone(), node))
        .collect::<BTreeMap<_, _>>();
    let mut results = BTreeMap::<String, GraphNodePayload>::new();
    for edge in graph.graph_edges.iter().filter(|edge| edge.kind == "CALLS") {
        let matches = if reverse {
            edge.target_qualified == target
        } else {
            edge.source_qualified == target
        };
        if !matches {
            continue;
        }
        let qn = if reverse {
            &edge.source_qualified
        } else {
            &edge.target_qualified
        };
        if let Some(node) = symbol_nodes.get(qn) {
            results.insert(
                qn.clone(),
                GraphNodePayload::Symbol(symbol_to_payload(node)),
            );
        }
    }
    QueryResult::Ok {
        results: results.into_values().collect(),
        edges: graph
            .graph_edges
            .iter()
            .filter(|edge| {
                edge.kind == "CALLS"
                    && if reverse {
                        edge.target_qualified == target
                    } else {
                        edge.source_qualified == target
                    }
            })
            .cloned()
            .collect(),
    }
}

fn query_file_summary(graph: &ParsedReviewGraph, target: &str) -> QueryResult {
    let mut results = graph
        .changed_nodes
        .iter()
        .chain(graph.related_test_nodes.iter())
        .filter(|node| node.file_path == target && node.kind != "File")
        .map(|node| GraphNodePayload::Symbol(symbol_to_payload(node)))
        .collect::<Vec<_>>();
    if let Some(file_node) = graph
        .changed_nodes
        .iter()
        .chain(graph.related_test_nodes.iter())
        .find(|node| node.kind == "File" && node.file_path == target)
    {
        results.insert(0, node_to_payload(file_node));
    }
    QueryResult::Ok {
        results,
        edges: Vec::new(),
    }
}

fn query_children_of(graph: &ParsedReviewGraph, target: &str) -> QueryResult {
    let results = graph
        .changed_nodes
        .iter()
        .chain(graph.related_test_nodes.iter())
        .filter(|node| node.file_path == target && node.kind != "File")
        .map(|node| GraphNodePayload::Symbol(symbol_to_payload(node)))
        .collect::<Vec<_>>();
    QueryResult::Ok {
        results,
        edges: graph
            .graph_edges
            .iter()
            .filter(|edge| edge.kind == "CONTAINS" && edge.source_qualified == target)
            .cloned()
            .collect(),
    }
}

fn resolve_graph_target(graph: &ParsedReviewGraph, target: &str) -> Option<String> {
    let nodes = graph
        .changed_nodes
        .iter()
        .chain(graph.related_test_nodes.iter())
        .collect::<Vec<_>>();
    if nodes.iter().any(|node| node.qualified_name == target) {
        return Some(target.to_string());
    }
    if nodes
        .iter()
        .any(|node| node.kind == "File" && node.file_path == target)
    {
        return Some(target.to_string());
    }
    let matches = nodes
        .iter()
        .filter(|node| node.name == target)
        .map(|node| node.qualified_name.clone())
        .collect::<BTreeSet<_>>();
    if matches.len() == 1 {
        return matches.into_iter().next();
    }
    None
}

fn query_inheritors_of(graph: &ParsedReviewGraph, target: &str) -> QueryResult {
    let symbol_nodes = graph
        .changed_nodes
        .iter()
        .chain(graph.related_test_nodes.iter())
        .filter(|node| node.kind != "File")
        .map(|node| (node.qualified_name.clone(), node))
        .collect::<BTreeMap<_, _>>();
    let mut results = BTreeMap::<String, GraphNodePayload>::new();
    for edge in graph
        .graph_edges
        .iter()
        .filter(|edge| edge.kind == "INHERITS")
    {
        if edge.target_qualified != target {
            continue;
        }
        if let Some(node) = symbol_nodes.get(&edge.source_qualified) {
            results.insert(
                edge.source_qualified.clone(),
                GraphNodePayload::Symbol(symbol_to_payload(node)),
            );
        }
    }
    QueryResult::Ok {
        results: results.into_values().collect(),
        edges: graph
            .graph_edges
            .iter()
            .filter(|edge| edge.kind == "INHERITS" && edge.target_qualified == target)
            .cloned()
            .collect(),
    }
}

fn symbol_to_payload(node: &ChangedNode) -> SymbolGraphNode {
    SymbolGraphNode {
        qualified_name: node.qualified_name.clone(),
        name: node.name.clone(),
        kind: node.kind.clone(),
        file_path: node.file_path.clone(),
        line_start: node.line_start.unwrap_or(1),
        line_end: node.line_end.unwrap_or(1),
        language: node.language.clone(),
        parent_name: node.parent_name.clone(),
        is_test: node.is_test,
        references: node.references.clone(),
        extends: node.extends.clone(),
    }
}

pub fn query_file_imports(repo_root: &Path, target: &str, reverse: bool) -> QueryResult {
    let Some(target_file) = resolve_query_target_file(repo_root, target).or_else(|| {
        resolve_query_target_file_by_symbol(repo_root, target)
    }) else {
        return QueryResult::Err {
            status: "not_found".to_string(),
            summary: format!("No file found matching '{target}'."),
        };
    };

    if reverse {
        query_importers(repo_root, &target_file)
    } else {
        query_imports_for_file(repo_root, &target_file)
    }
}

fn extends_target(source: &ChangedNode, target: &ChangedNode) -> bool {
    let extends = source.extends.trim();
    if extends.is_empty() {
        return false;
    }
    let normalized = extends
        .trim_start_matches("extends")
        .trim_start_matches("implements")
        .trim()
        .trim_start_matches("superclass")
        .trim();
    if normalized.is_empty() {
        return false;
    }
    let qualified_tail = target
        .qualified_name
        .split(':')
        .next_back()
        .unwrap_or(target.name.as_str());
    normalized == target.name
        || normalized.ends_with(&target.name)
        || normalized == qualified_tail
        || normalized.ends_with(qualified_tail)
}

fn test_targets_node(test: &ChangedNode, target: &ChangedNode) -> bool {
    if test.file_path == target.file_path && test.mentions.iter().any(|name| name == &target.name) {
        return true;
    }
    if test.mentions.iter().any(|name| name == &target.name) {
        return true;
    }

    let test_name_lower = test.name.to_ascii_lowercase();
    let target_name_lower = target.name.to_ascii_lowercase();
    if test_name_lower.contains(&target_name_lower) {
        return true;
    }

    if let Some(parent_name) = target.parent_name.as_deref() {
        let parent_lower = parent_name.to_ascii_lowercase();
        if test_name_lower.contains(&parent_lower) {
            return true;
        }
    }
    false
}

fn query_imports_for_file(repo_root: &Path, target_file: &str) -> QueryResult {
    let Some(importer) = parse_file_import_record(repo_root, target_file) else {
        return QueryResult::Err {
            status: "not_found".to_string(),
            summary: format!("No file found matching '{target_file}'."),
        };
    };
    let results = importer
        .imports
        .iter()
        .filter_map(|imported| file_node_payload(repo_root, imported))
        .collect::<Vec<_>>();
    let edges = importer
        .imports
        .iter()
        .map(|imported| GraphEdge {
            kind: "IMPORTS_FROM",
            source_qualified: importer.file_path.clone(),
            target_qualified: imported.clone(),
            file_path: importer.file_path.clone(),
            source_file: importer.file_path.clone(),
            target_file: imported.clone(),
        })
        .collect::<Vec<_>>();
    QueryResult::Ok { results, edges }
}

fn query_importers(repo_root: &Path, target_file: &str) -> QueryResult {
    let mut results = Vec::new();
    let mut edges = Vec::new();
    let mut seen = BTreeSet::new();
    for relative_path in collect_repo_files(repo_root) {
        let Some(record) = parse_file_import_record(repo_root, &relative_path) else {
            continue;
        };
        if !record
            .imports
            .iter()
            .any(|imported| imported == target_file)
        {
            continue;
        }
        if seen.insert(record.file_path.clone()) {
            results.push(GraphNodePayload::File(FileGraphNode {
                qualified_name: record.file_path.clone(),
                name: file_name(&record.file_path),
                kind: "File".to_string(),
                file_path: record.file_path.clone(),
                language: record.language.clone(),
                is_test: record.is_test,
            }));
        }
        edges.push(GraphEdge {
            kind: "IMPORTS_FROM",
            source_qualified: record.file_path.clone(),
            target_qualified: target_file.to_string(),
            file_path: record.file_path.clone(),
            source_file: record.file_path.clone(),
            target_file: target_file.to_string(),
        });
    }
    QueryResult::Ok { results, edges }
}

fn resolve_query_target_file(repo_root: &Path, target: &str) -> Option<String> {
    let candidate = if target.contains(':') {
        target.split(':').next().unwrap_or(target)
    } else {
        target
    };
    resolve_repo_relative_path(repo_root, candidate)
}

fn resolve_query_target_file_by_symbol(repo_root: &Path, target: &str) -> Option<String> {
    let graph = parse_repo_graph(repo_root);
    if let Some(target_file) = graph
        .changed_nodes
        .iter()
        .chain(graph.related_test_nodes.iter())
        .find(|node| node.qualified_name == target)
        .map(|node| node.file_path.clone())
    {
        return Some(target_file);
    }

    let mut matches = BTreeSet::new();
    for node in graph.changed_nodes.iter().chain(graph.related_test_nodes.iter()) {
        if node.kind == "File" {
            continue;
        }
        if node.name == target || node.qualified_name == target {
            matches.insert(node.file_path.clone());
        }
    }

    if matches.len() == 1 {
        matches.into_iter().next()
    } else {
        None
    }
}

fn file_node_payload(_repo_root: &Path, relative_path: &str) -> Option<GraphNodePayload> {
    let language = language_config_for_path(relative_path)?;
    Some(GraphNodePayload::File(FileGraphNode {
        qualified_name: relative_path.to_string(),
        name: file_name(relative_path),
        kind: "File".to_string(),
        file_path: relative_path.to_string(),
        language: language.name.to_string(),
        is_test: (language.is_test_file)(relative_path),
    }))
}

struct FileImportRecord {
    file_path: String,
    language: String,
    is_test: bool,
    imports: Vec<String>,
}

fn parse_file_import_record(repo_root: &Path, relative_path: &str) -> Option<FileImportRecord> {
    let language = language_config_for_path(relative_path)?;
    let source = fs::read_to_string(repo_root.join(relative_path)).ok()?;
    let mut parser = Parser::new();
    parser.set_language(&language.ts_language()).ok()?;
    let tree = parser.parse(&source, None)?;
    let imports = (language.parse_imports)(repo_root, relative_path, &source, tree.root_node());
    Some(FileImportRecord {
        file_path: relative_path.to_string(),
        language: language.name.to_string(),
        is_test: (language.is_test_file)(relative_path),
        imports,
    })
}

pub(super) fn resolve_repo_relative_path(repo_root: &Path, target: &str) -> Option<String> {
    let candidate = repo_root.join(target);
    let resolved = candidate.canonicalize().ok()?;
    let root = repo_root.canonicalize().ok()?;
    let relative = resolved.strip_prefix(root).ok()?;
    Some(relative.to_string_lossy().replace('\\', "/"))
}

pub(super) fn resolve_relative_import(
    repo_root: &Path,
    relative_path: &str,
    import_path: &str,
) -> Option<String> {
    if !import_path.starts_with('.') {
        return None;
    }
    let base_dir = repo_root.join(relative_path).parent()?.to_path_buf();
    let candidate = base_dir.join(import_path);
    let suffix = Path::new(relative_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"));
    let mut extensions = Vec::new();
    if let Some(suffix) = suffix {
        extensions.push(suffix);
    }
    for fallback in [".ts", ".tsx", ".js", ".jsx", ".py", ".rs"] {
        if !extensions.iter().any(|ext| ext == fallback) {
            extensions.push(fallback.to_string());
        }
    }

    let mut candidates = vec![candidate.clone()];
    if candidate.extension().is_none() {
        for ext in &extensions {
            candidates.push(candidate.with_extension(ext.trim_start_matches('.')));
            candidates.push(candidate.join(format!("index{ext}")));
        }
    }

    for path in candidates {
        if path.is_file() {
            if let Some(relative) = resolve_repo_relative_path(repo_root, &path.to_string_lossy()) {
                return Some(relative);
            }
        }
    }
    None
}

pub(super) fn resolve_python_import(
    repo_root: &Path,
    relative_path: &str,
    import_path: &str,
) -> Option<String> {
    let leading_dots = import_path.len() - import_path.trim_start_matches('.').len();
    let relative_part = import_path.trim_start_matches('.').replace('.', "/");
    let mut anchor = repo_root.join(relative_path).parent()?.to_path_buf();
    for _ in 0..leading_dots.saturating_sub(1) {
        anchor = anchor.parent()?.to_path_buf();
    }
    let candidate = if relative_part.is_empty() {
        anchor
    } else {
        anchor.join(relative_part)
    };
    for path in [
        candidate.with_extension("py"),
        candidate.join("__init__.py"),
    ] {
        if path.is_file() {
            if let Some(relative) = resolve_repo_relative_path(repo_root, &path.to_string_lossy()) {
                return Some(relative);
            }
        }
    }
    None
}

pub(super) fn resolve_go_import(
    repo_root: &Path,
    relative_path: &str,
    import_path: &str,
) -> Option<String> {
    let import_path = import_path.trim().trim_matches(&['"', '\'', '`'][..]).to_string();
    if import_path.is_empty() {
        return None;
    }

    let relative_anchor = repo_root.join(relative_path).parent()?.to_path_buf();
    let candidates = if import_path.starts_with('.')
        || import_path.starts_with("./")
        || import_path.starts_with("../")
        || import_path == "."
        || import_path == ".."
    {
        vec![relative_anchor.join(import_path)]
    } else if import_path.contains('/') || import_path.contains('.') {
        vec![repo_root.join(import_path.replace('.', "/"))]
    } else {
        Vec::new()
    };

    for candidate in candidates {
        if let Some(resolved) = resolve_import_file_reference(repo_root, &candidate, "go", Some("_test.go"))
        {
            return Some(resolved);
        }
    }
    None
}

pub(super) fn resolve_java_import(
    repo_root: &Path,
    _relative_path: &str,
    import_path: &str,
    is_static_import: bool,
) -> Option<String> {
    let mut import_path = import_path.trim().trim_end_matches(';').trim().to_string();
    if import_path.is_empty() {
        return None;
    }
    if import_path.starts_with("java.")
        || import_path.starts_with("javax.")
        || import_path.starts_with("kotlin.")
        || import_path.starts_with("scala.")
    {
        return None;
    }

    if is_static_import {
        let mut parts = import_path.split('.').collect::<Vec<_>>();
        if parts.len() > 1 {
            parts.pop();
            import_path = parts.join(".");
        }
    }

    if import_path.ends_with(".*") {
        import_path = import_path.trim_end_matches(".*").to_string();
    }
    if import_path.is_empty() {
        return None;
    }

    let package_path = import_path.replace('.', "/");
    let class_file = repo_root.join(format!("{package_path}.java"));
    let package_dir = repo_root.join(&package_path);
    let mut candidates = vec![class_file.to_path_buf(), package_dir.to_path_buf()];
    candidates.push(repo_root.join("src/main/java").join(format!("{package_path}.java")));
    candidates.push(repo_root.join("src/main/java").join(&package_path));
    candidates.push(repo_root.join("src/test/java").join(format!("{package_path}.java")));
    candidates.push(repo_root.join("src/test/java").join(&package_path));

    for candidate in candidates {
        if let Some(found) = resolve_import_file_reference(repo_root, &candidate, "java", Some("_test.java"))
        {
            return Some(found);
        }
    }

    let target_suffix = format!("{package_path}.java");
    for repo_file in collect_repo_files(repo_root) {
        if repo_file.ends_with(&target_suffix) {
            return Some(repo_file);
        }
    }
    None
}

fn resolve_import_file_reference(
    repo_root: &Path,
    candidate: &Path,
    extension: &str,
    skip_test_suffix: Option<&str>,
) -> Option<String> {
    if candidate.extension().is_none() {
        if candidate.is_dir() {
            let file = first_source_file_in_directory(candidate, extension, skip_test_suffix)?;
            return resolve_repo_relative_path(repo_root, &file);
        }
        let as_file = candidate.with_extension(extension);
        if as_file.is_file() {
            return resolve_repo_relative_path(repo_root, &as_file.to_string_lossy());
        }
        return None;
    }
    if candidate.extension().and_then(|ext| ext.to_str()) == Some(extension) {
        if candidate.is_file() {
            return resolve_repo_relative_path(repo_root, &candidate.to_string_lossy());
        }
    }
    None
}

fn first_source_file_in_directory(
    dir: &Path,
    extension: &str,
    skip_test_suffix: Option<&str>,
) -> Option<String> {
    let mut preferred = Vec::new();
    let mut skipped = Vec::new();
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_none_or(|ext| ext != extension)
        {
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        if skip_test_suffix
            .is_some_and(|suffix| file_name.ends_with(suffix))
        {
            skipped.push(path);
            continue;
        }
        preferred.push(path);
    }
    preferred.sort();
    if let Some(path) = preferred.first() {
        return Some(path.to_string_lossy().to_string());
    }
    skipped.sort();
    skipped.first().map(|path| path.to_string_lossy().to_string())
}

pub fn analyze_single_file(repo_root: &Path, target: &str) -> Option<SingleFileAnalysis> {
    let relative_path = resolve_repo_relative_path(repo_root, target)?;
    let language = language_config_for_path(&relative_path)?;
    let source = fs::read_to_string(repo_root.join(&relative_path)).ok()?;
    let mut parser = Parser::new();
    parser.set_language(&language.ts_language()).ok()?;
    let tree = parser.parse(&source, None)?;
    let symbols = (language.parse_nodes)(&relative_path, &source, tree.root_node())
        .into_iter()
        .filter(|node| node.kind != "File")
        .map(|node| symbol_to_payload(&node))
        .collect::<Vec<_>>();
    let imports = (language.parse_imports)(repo_root, &relative_path, &source, tree.root_node());
    Some(SingleFileAnalysis {
        file_path: relative_path.clone(),
        language: language.name.to_string(),
        is_test_file: (language.is_test_file)(&relative_path),
        imports,
        comments: Vec::new(),
        symbols,
        source_basename: normalized_source_basename(&relative_path),
    })
}

pub struct SingleFileAnalysis {
    pub file_path: String,
    pub language: String,
    pub is_test_file: bool,
    pub imports: Vec<String>,
    pub comments: Vec<serde_json::Value>,
    pub symbols: Vec<SymbolGraphNode>,
    pub source_basename: String,
}

fn normalized_source_basename(relative_path: &str) -> String {
    let mut name = Path::new(relative_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(relative_path)
        .to_string();
    for marker in [".test", ".spec", "_test", "_spec"] {
        name = name.replace(marker, "");
    }
    while let Some(extension) = Path::new(&name)
        .extension()
        .and_then(|value| value.to_str())
    {
        let suffix = format!(".{extension}");
        if let Some(stripped) = name.strip_suffix(&suffix) {
            name = stripped.to_string();
        } else {
            break;
        }
    }
    name
}

pub(super) fn resolve_rust_import(
    repo_root: &Path,
    relative_path: &str,
    import_text: &str,
) -> Option<String> {
    let path_text = import_text
        .trim()
        .trim_start_matches("pub ")
        .trim_start_matches("use")
        .trim()
        .trim_end_matches(';')
        .trim();
    if !path_text.contains("::") {
        return None;
    }

    let crate_root = rust_crate_root(repo_root, relative_path)?;
    let parts = rust_import_parts(path_text);
    if parts.is_empty() {
        return None;
    }

    let current_dir = repo_root.join(relative_path).parent()?.to_path_buf();
    let compact_path = path_text.split_whitespace().collect::<String>();
    let mut anchors = Vec::new();
    if compact_path.starts_with("crate::") {
        anchors.push(crate_root.clone());
    } else if compact_path.starts_with("super::") {
        if let Some(parent) = current_dir.parent() {
            anchors.push(parent.to_path_buf());
        }
    } else if compact_path.starts_with("self::") {
        anchors.push(current_dir.clone());
    } else {
        anchors.push(crate_root.clone());
    }

    let module_parts = if parts.len() > 1 {
        parts[..parts.len() - 1].to_vec()
    } else {
        parts.clone()
    };
    for anchor in anchors {
        for candidate in rust_module_candidate_paths(&anchor, &module_parts, &crate_root) {
            if candidate.is_file() {
                if let Some(relative) =
                    resolve_repo_relative_path(repo_root, &candidate.to_string_lossy())
                {
                    return Some(relative);
                }
            }
        }
    }
    None
}

fn rust_crate_root(repo_root: &Path, relative_path: &str) -> Option<std::path::PathBuf> {
    let mut current = repo_root.join(relative_path).parent()?.to_path_buf();
    loop {
        let src_dir = current.join("src");
        if src_dir.join("lib.rs").is_file() || src_dir.join("main.rs").is_file() {
            return Some(src_dir);
        }
        if !current.pop() {
            break;
        }
    }
    None
}

fn rust_import_parts(path_text: &str) -> Vec<String> {
    let normalized = if let Some((prefix, _)) = path_text.split_once('{') {
        prefix.trim().trim_end_matches("::").to_string()
    } else {
        path_text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .split(" as ")
            .next()
            .unwrap_or(path_text)
            .trim_end_matches("::*")
            .trim()
            .to_string()
    };
    normalized
        .split("::")
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .filter(|part| !matches!(*part, "crate" | "self" | "super"))
        .map(ToString::to_string)
        .collect()
}

fn rust_module_candidate_paths(
    anchor: &Path,
    module_parts: &[String],
    crate_root: &Path,
) -> Vec<std::path::PathBuf> {
    if module_parts.is_empty() {
        return Vec::new();
    }
    let joined = module_parts
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join("/");
    let mut candidates = vec![
        anchor.join(format!("{joined}.rs")),
        anchor.join(&joined).join("mod.rs"),
    ];
    if anchor == crate_root && module_parts.first().is_some_and(|part| part == "src") {
        let rest = module_parts[1..]
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join("/");
        if !rest.is_empty() {
            candidates.push(crate_root.join(format!("{rest}.rs")));
            candidates.push(crate_root.join(rest).join("mod.rs"));
        }
    }
    candidates
}

pub(crate) fn collect_identifier_mentions(
    node: tree_sitter::Node<'_>,
    source: &[u8],
) -> Vec<String> {
    let mut mentions = BTreeSet::new();
    collect_identifier_mentions_inner(node, source, &mut mentions);
    mentions.into_iter().collect()
}

fn collect_identifier_mentions_inner(
    node: tree_sitter::Node<'_>,
    source: &[u8],
    out: &mut BTreeSet<String>,
) {
    if matches!(
        node.kind(),
        "identifier" | "type_identifier" | "field_identifier" | "property_identifier"
    ) {
        if let Ok(name) = node.utf8_text(source) {
            let normalized = name.trim().to_string();
            if !normalized.is_empty() {
                out.insert(normalized);
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_identifier_mentions_inner(child, source, out);
    }
}

pub(crate) fn parse_named_node(
    relative_path: &str,
    source: &[u8],
    node: tree_sitter::Node<'_>,
    kind: &str,
    language: &str,
) -> Option<ChangedNode> {
    let name = node
        .child_by_field_name("name")
        .and_then(|child| child.utf8_text(source).ok())
        .map(str::trim)
        .filter(|name| !name.is_empty())?
        .to_string();
    Some(ChangedNode {
        qualified_name: format!("{relative_path}:{name}"),
        name,
        kind: kind.to_string(),
        file_path: relative_path.to_string(),
        language: language.to_string(),
        is_test: false,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: None,
        references: Vec::new(),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

pub(crate) fn sanitize_test_name(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
        } else if matches!(ch, ' ' | '-' | '.' | '/' | ':') {
            out.push('_');
        }
    }
    out.trim_matches('_').to_string()
}

fn java_companion_test_candidates(relative_path: &str) -> Vec<String> {
    if let Some(rest) = relative_path.strip_prefix("src/main/java/") {
        let stem = Path::new(rest)
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let parent = Path::new(rest).parent().unwrap_or_else(|| Path::new(""));
        return ["Test", "Tests", "IT"]
            .into_iter()
            .map(|suffix| {
                Path::new("src/test/java")
                    .join(parent)
                    .join(format!("{stem}{suffix}.java"))
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
    }
    Vec::new()
}

fn go_companion_test_candidates(relative_path: &str) -> Vec<String> {
    let path = Path::new(relative_path);
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if stem.ends_with("_test") || stem.is_empty() {
        return Vec::new();
    }
    vec![parent
        .join(format!("{stem}_test.go"))
        .to_string_lossy()
        .replace('\\', "/")]
}

fn python_companion_test_candidates(relative_path: &str) -> Vec<String> {
    let path = Path::new(relative_path);
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if stem.is_empty() || stem.starts_with("test_") || stem.ends_with("_test") {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    for name in [format!("test_{stem}.py"), format!("{stem}_test.py")] {
        candidates.push(parent.join(&name).to_string_lossy().replace('\\', "/"));
        candidates.push(
            parent
                .join("tests")
                .join(&name)
                .to_string_lossy()
                .replace('\\', "/"),
        );
    }
    candidates
}

fn typescript_companion_test_candidates(relative_path: &str) -> Vec<String> {
    let path = Path::new(relative_path);
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let ext = path
        .extension()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if stem.is_empty() || ext.is_empty() {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    for suffix in ["test", "spec"] {
        candidates.push(
            parent
                .join(format!("{stem}.{suffix}.{ext}"))
                .to_string_lossy()
                .replace('\\', "/"),
        );
        candidates.push(
            parent
                .join("__tests__")
                .join(format!("{stem}.{suffix}.{ext}"))
                .to_string_lossy()
                .replace('\\', "/"),
        );
        candidates.push(
            parent
                .join("tests")
                .join(format!("{stem}.{suffix}.{ext}"))
                .to_string_lossy()
                .replace('\\', "/"),
        );
    }
    candidates
}

fn is_generic_test_file(relative_path: &str) -> bool {
    let lowered = relative_path.to_ascii_lowercase();
    lowered.contains("/tests/")
        || lowered.contains("/__tests__/")
        || lowered.ends_with("_test.go")
        || lowered.ends_with("_test.rs")
        || lowered.contains(".test.")
        || lowered.contains(".spec.")
}

fn language_config_for_path(path: &str) -> Option<&'static LanguageConfig> {
    match Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "rs" => Some(&RUST_LANGUAGE),
        "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" => Some(&TYPESCRIPT_LANGUAGE),
        "java" => Some(&JAVA_LANGUAGE),
        "go" => Some(&GO_LANGUAGE),
        "py" => Some(&PYTHON_LANGUAGE),
        _ => None,
    }
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

fn collect_repo_files(repo_root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    collect_repo_files_inner(repo_root, repo_root, &mut files);
    files.sort();
    files
}

fn collect_repo_files_inner(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if matches!(
                name,
                ".git" | "target" | "node_modules" | ".next" | "dist" | "build"
            ) {
                continue;
            }
            collect_repo_files_inner(root, &path, out);
            continue;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let rel = relative.to_string_lossy().replace('\\', "/");
        if language_config_for_path(&rel).is_some() {
            out.push(rel);
        }
    }
}

struct LanguageConfig {
    name: &'static str,
    parse_nodes: fn(&str, &str, tree_sitter::Node<'_>) -> Vec<ChangedNode>,
    parse_imports: fn(&Path, &str, &str, tree_sitter::Node<'_>) -> Vec<String>,
    companion_test_candidates: fn(&str) -> Vec<String>,
    is_test_file: fn(&str) -> bool,
    ts_language: fn() -> Language,
}

impl LanguageConfig {
    fn ts_language(&self) -> Language {
        (self.ts_language)()
    }
}

const RUST_LANGUAGE: LanguageConfig = LanguageConfig {
    name: "rust",
    parse_nodes: rust::parse_nodes,
    parse_imports: rust::parse_imports,
    companion_test_candidates: |_| Vec::new(),
    is_test_file: is_generic_test_file,
    ts_language: rust_language,
};

const TYPESCRIPT_LANGUAGE: LanguageConfig = LanguageConfig {
    name: "typescript",
    parse_nodes: typescript::parse_nodes,
    parse_imports: typescript::parse_imports,
    companion_test_candidates: typescript_companion_test_candidates,
    is_test_file: is_generic_test_file,
    ts_language: typescript_language,
};

const JAVA_LANGUAGE: LanguageConfig = LanguageConfig {
    name: "java",
    parse_nodes: java::parse_nodes,
    parse_imports: java::parse_imports,
    companion_test_candidates: java_companion_test_candidates,
    is_test_file: is_generic_test_file,
    ts_language: java_language,
};

const GO_LANGUAGE: LanguageConfig = LanguageConfig {
    name: "go",
    parse_nodes: go::parse_nodes,
    parse_imports: go::parse_imports,
    companion_test_candidates: go_companion_test_candidates,
    is_test_file: is_generic_test_file,
    ts_language: go_language,
};

const PYTHON_LANGUAGE: LanguageConfig = LanguageConfig {
    name: "python",
    parse_nodes: python::parse_nodes,
    parse_imports: python::parse_imports,
    companion_test_candidates: python_companion_test_candidates,
    is_test_file: is_generic_test_file,
    ts_language: python_language,
};

fn rust_language() -> Language {
    tree_sitter_rust::LANGUAGE.into()
}

fn typescript_language() -> Language {
    tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
}

fn java_language() -> Language {
    tree_sitter_java::LANGUAGE.into()
}

fn go_language() -> Language {
    tree_sitter_go::LANGUAGE.into()
}

fn python_language() -> Language {
    tree_sitter_python::LANGUAGE.into()
}
