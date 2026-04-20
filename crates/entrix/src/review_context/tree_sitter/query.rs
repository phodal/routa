use super::resolver::resolve_query_target_file;
use super::{
    collect_repo_files, file_name, file_node_payload, language_config_for_path,
    parse_file_import_record, parse_repo_graph, resolve_graph_target, symbol_to_payload,
};
use crate::review_context::model::{FileGraphNode, GraphEdge, GraphNodePayload, ParsedReviewGraph};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

pub(crate) enum QueryResult {
    Ok {
        results: Vec<GraphNodePayload>,
        edges: Vec<GraphEdge>,
    },
    Err {
        status: String,
        summary: String,
    },
}

pub(super) fn query_graph(
    graph: &ParsedReviewGraph,
    query_type: &str,
    target: &str,
) -> QueryResult {
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

pub(super) fn query_file_imports(repo_root: &Path, target: &str, reverse: bool) -> QueryResult {
    let Some(target_file) = resolve_query_target_file(repo_root, target)
        .or_else(|| resolve_query_target_file_by_symbol(repo_root, target))
    else {
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
        results.insert(0, super::node_to_payload(file_node));
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
        .filter_map(|imported| file_node_payload(imported))
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
            let Some(language) = language_config_for_path(&record.file_path) else {
                continue;
            };
            results.push(GraphNodePayload::File(FileGraphNode {
                qualified_name: record.file_path.clone(),
                name: file_name(&record.file_path),
                kind: "File".to_string(),
                file_path: record.file_path.clone(),
                language: language.name.to_string(),
                is_test: (language.is_test_file)(&record.file_path),
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
    for node in graph
        .changed_nodes
        .iter()
        .chain(graph.related_test_nodes.iter())
    {
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
