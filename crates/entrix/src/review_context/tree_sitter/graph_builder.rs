use crate::review_context::model::{ChangedNode, GraphEdge};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn derive_target_tests(
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

pub(super) fn derive_graph_edges(
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
