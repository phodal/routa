use super::{collect_identifier_mentions, resolve_go_import, sanitize_test_name};
use crate::review_context::model::ChangedNode;
use std::path::Path;
use tree_sitter::Node;

pub(super) fn parse_nodes(relative_path: &str, source: &str, root: Node<'_>) -> Vec<ChangedNode> {
    let mut nodes = Vec::new();
    collect_nodes(relative_path, source.as_bytes(), root, None, &mut nodes);
    nodes
}

pub(super) fn parse_imports(
    repo_root: &Path,
    relative_path: &str,
    source: &str,
    root: Node<'_>,
) -> Vec<String> {
    let mut imports = Vec::new();
    collect_imports(
        repo_root,
        relative_path,
        source.as_bytes(),
        root,
        false,
        &mut imports,
    );
    imports.sort();
    imports.dedup();
    imports
}

fn collect_imports(
    repo_root: &Path,
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    in_import: bool,
    out: &mut Vec<String>,
) {
    let in_import = in_import || node.kind() == "import_declaration";
    if in_import
        && matches!(
            node.kind(),
            "interpreted_string_literal" | "raw_string_literal"
        )
    {
        if let Ok(raw) = node.utf8_text(source) {
            if let Some(resolved) = resolve_go_import(repo_root, relative_path, raw.trim()) {
                out.push(resolved);
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_imports(repo_root, relative_path, source, child, in_import, out);
    }
}

fn collect_nodes(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    parent_name: Option<&str>,
    out: &mut Vec<ChangedNode>,
) {
    match node.kind() {
        "function_declaration" => {
            if let Some(parsed) = parse_function(relative_path, source, node, parent_name) {
                out.push(parsed);
            }
        }
        "method_declaration" => {
            if let Some(parsed) = parse_method(relative_path, source, node) {
                let receiver_name = parsed.parent_name.clone();
                out.push(parsed);
                for child in node.children(&mut node.walk()) {
                    collect_nodes(relative_path, source, child, receiver_name.as_deref(), out);
                }
                return;
            }
        }
        "call_expression" => {
            collect_test_subcases(relative_path, source, node, out);
        }
        "type_declaration" => {
            for child in node.children(&mut node.walk()) {
                if child.kind() == "type_spec" {
                    if let Some(parsed) = parse_type_spec(relative_path, source, child) {
                        out.push(parsed);
                    }
                }
            }
        }
        _ => {}
    }

    for child in node.children(&mut node.walk()) {
        collect_nodes(relative_path, source, child, parent_name, out);
    }
}

fn parse_function(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    parent_name: Option<&str>,
) -> Option<ChangedNode> {
    let name = node
        .child_by_field_name("name")
        .and_then(|child| child.utf8_text(source).ok())
        .map(str::trim)
        .filter(|name| !name.is_empty())?
        .to_string();
    let is_test = name.starts_with("Test");
    let qualified_name = if let Some(parent_name) = parent_name {
        format!("{relative_path}:{parent_name}.{name}")
    } else {
        format!("{relative_path}:{name}")
    };
    Some(ChangedNode {
        qualified_name,
        name,
        kind: if is_test {
            "Test".to_string()
        } else {
            "Function".to_string()
        },
        file_path: relative_path.to_string(),
        language: "go".to_string(),
        is_test,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: parent_name.map(ToString::to_string),
        references: Vec::new(),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn parse_method(relative_path: &str, source: &[u8], node: Node<'_>) -> Option<ChangedNode> {
    let name = node
        .child_by_field_name("name")
        .and_then(|child| child.utf8_text(source).ok())
        .map(str::trim)
        .filter(|name| !name.is_empty())?
        .to_string();
    let receiver_name = node
        .child_by_field_name("receiver")
        .and_then(|receiver| receiver.utf8_text(source).ok())
        .map(simplify_receiver)
        .filter(|name| !name.is_empty());
    let is_test = name.starts_with("Test");
    let qualified_name = if let Some(receiver_name) = receiver_name.as_deref() {
        format!("{relative_path}:{receiver_name}.{name}")
    } else {
        format!("{relative_path}:{name}")
    };
    Some(ChangedNode {
        qualified_name,
        name,
        kind: if is_test {
            "Test".to_string()
        } else {
            "Method".to_string()
        },
        file_path: relative_path.to_string(),
        language: "go".to_string(),
        is_test,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: receiver_name,
        references: Vec::new(),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn parse_type_spec(relative_path: &str, source: &[u8], node: Node<'_>) -> Option<ChangedNode> {
    let name = node
        .child_by_field_name("name")
        .and_then(|child| child.utf8_text(source).ok())
        .map(str::trim)
        .filter(|name| !name.is_empty())?
        .to_string();
    let kind = if node
        .child_by_field_name("type")
        .is_some_and(|child| child.kind() == "interface_type")
    {
        "Interface"
    } else if node
        .child_by_field_name("type")
        .is_some_and(|child| child.kind() == "struct_type")
    {
        "Class"
    } else {
        "Type"
    };
    Some(ChangedNode {
        qualified_name: format!("{relative_path}:{name}"),
        name,
        kind: kind.to_string(),
        file_path: relative_path.to_string(),
        language: "go".to_string(),
        is_test: false,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: None,
        references: Vec::new(),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn collect_test_subcases(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    out: &mut Vec<ChangedNode>,
) {
    let Some(function) = node.child_by_field_name("function") else {
        return;
    };
    let Ok(callee) = function.utf8_text(source) else {
        return;
    };
    if !callee.trim().ends_with(".Run") {
        return;
    }

    let Some(arguments) = node.child_by_field_name("arguments") else {
        return;
    };
    let mut label = None;
    for child in arguments.children(&mut arguments.walk()) {
        if child.kind() == "interpreted_string_literal" || child.kind() == "raw_string_literal" {
            let raw = child.utf8_text(source).unwrap_or("").trim().to_string();
            let normalized = raw.trim_matches('"').trim_matches('`').to_string();
            if !normalized.is_empty() {
                label = Some(normalized);
                break;
            }
        }
    }
    let Some(label) = label else {
        return;
    };
    let test_name = format!("subtest_{}", sanitize_test_name(&label));
    out.push(ChangedNode {
        qualified_name: format!("{relative_path}:{test_name}"),
        name: test_name,
        kind: "Test".to_string(),
        file_path: relative_path.to_string(),
        language: "go".to_string(),
        is_test: true,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: None,
        references: Vec::new(),
        extends: String::new(),
        mentions: vec![label],
    });
}

fn simplify_receiver(text: &str) -> String {
    let trimmed = text
        .trim()
        .trim_start_matches('(')
        .trim_end_matches(')')
        .trim();
    trimmed
        .split_whitespace()
        .last()
        .unwrap_or(trimmed)
        .trim_start_matches('*')
        .to_string()
}
