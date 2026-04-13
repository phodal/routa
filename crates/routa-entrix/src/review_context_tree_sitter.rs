use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use tree_sitter::{Language, Node, Parser};

#[derive(Debug, Clone)]
pub struct ParsedReviewGraph {
    pub changed_nodes: Vec<ChangedNode>,
    pub target_tests: Vec<(String, String)>,
    pub files_updated: usize,
    pub total_edges: usize,
    pub languages: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ChangedNode {
    pub qualified_name: String,
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub language: String,
    pub is_test: bool,
    pub line_start: Option<usize>,
    pub line_end: Option<usize>,
    pub parent_name: Option<String>,
    pub references: Vec<String>,
    pub extends: String,
    pub mentions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum GraphNodePayload {
    File(FileGraphNode),
    Symbol(SymbolGraphNode),
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileGraphNode {
    pub qualified_name: String,
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub language: String,
    pub is_test: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SymbolGraphNode {
    pub qualified_name: String,
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub line_start: usize,
    pub line_end: usize,
    pub language: String,
    pub parent_name: Option<String>,
    pub is_test: bool,
    pub references: Vec<String>,
    pub extends: String,
}

pub fn parse_changed_files(repo_root: &Path, changed_files: &[String]) -> ParsedReviewGraph {
    let mut changed_nodes = Vec::new();
    let mut files_updated = 0usize;
    let mut languages = BTreeSet::new();
    let mut total_edges = 0usize;

    for relative_path in changed_files {
        let full_path = repo_root.join(relative_path);
        let Ok(source) = fs::read_to_string(&full_path) else {
            continue;
        };
        let Some(language) = language_for_path(relative_path) else {
            continue;
        };
        files_updated += 1;
        languages.insert(language.name().to_string());

        changed_nodes.push(ChangedNode {
            qualified_name: relative_path.clone(),
            name: file_name(relative_path),
            kind: "File".to_string(),
            file_path: relative_path.clone(),
            language: language.name().to_string(),
            is_test: false,
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

        let mut file_nodes = match language {
            SupportedLanguage::Rust => parse_rust_nodes(relative_path, &source, tree.root_node()),
            SupportedLanguage::TypeScript => {
                parse_typescript_nodes(relative_path, &source, tree.root_node())
            }
            SupportedLanguage::Java => parse_java_nodes(relative_path, &source, tree.root_node()),
            SupportedLanguage::Go => parse_go_nodes(relative_path, &source, tree.root_node()),
        };
        total_edges += file_nodes.len();
        changed_nodes.append(&mut file_nodes);
    }

    let target_tests = derive_target_tests(&changed_nodes);
    total_edges += target_tests.len();

    ParsedReviewGraph {
        changed_nodes,
        target_tests,
        files_updated,
        total_edges,
        languages: languages.into_iter().collect(),
    }
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

fn derive_target_tests(nodes: &[ChangedNode]) -> Vec<(String, String)> {
    let targets: Vec<&ChangedNode> = nodes
        .iter()
        .filter(|node| node.kind != "File" && !node.is_test)
        .collect();
    let tests: Vec<&ChangedNode> = nodes.iter().filter(|node| node.is_test).collect();
    let mut edges = Vec::new();
    for target in targets {
        for test in &tests {
            if test.file_path != target.file_path {
                continue;
            }
            if test.mentions.iter().any(|name| name == &target.name) {
                edges.push((target.qualified_name.clone(), test.qualified_name.clone()));
            }
        }
    }
    edges
}

fn parse_rust_nodes(relative_path: &str, source: &str, root: Node<'_>) -> Vec<ChangedNode> {
    let mut nodes = Vec::new();
    collect_rust_nodes(relative_path, source.as_bytes(), root, &mut nodes);
    nodes
}

fn collect_rust_nodes(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    out: &mut Vec<ChangedNode>,
) {
    match node.kind() {
        "function_item" => {
            if let Some(parsed) = parse_rust_function(relative_path, source, node) {
                out.push(parsed);
            }
        }
        "struct_item" => {
            if let Some(parsed) = parse_named_node(relative_path, source, node, "Class", "rust") {
                out.push(parsed);
            }
        }
        "trait_item" => {
            if let Some(parsed) = parse_named_node(relative_path, source, node, "Interface", "rust")
            {
                out.push(parsed);
            }
        }
        "enum_item" => {
            if let Some(parsed) = parse_named_node(relative_path, source, node, "Enum", "rust") {
                out.push(parsed);
            }
        }
        _ => {}
    }

    for child in node.children(&mut node.walk()) {
        collect_rust_nodes(relative_path, source, child, out);
    }
}

fn parse_rust_function(relative_path: &str, source: &[u8], node: Node<'_>) -> Option<ChangedNode> {
    let name = node
        .child_by_field_name("name")
        .and_then(|child| child.utf8_text(source).ok())
        .map(str::trim)
        .filter(|name| !name.is_empty())?
        .to_string();
    let is_test = rust_function_is_test(node, source, &name);
    Some(ChangedNode {
        qualified_name: format!("{relative_path}:{name}"),
        name,
        kind: if is_test {
            "Test".to_string()
        } else {
            "Function".to_string()
        },
        file_path: relative_path.to_string(),
        language: "rust".to_string(),
        is_test,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: None,
        references: collect_rust_macro_references(node, source),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn rust_function_is_test(node: Node<'_>, source: &[u8], name: &str) -> bool {
    if name.starts_with("test_") {
        return true;
    }
    let mut sibling = node.prev_named_sibling();
    while let Some(prev) = sibling {
        if prev.kind() != "attribute_item" {
            break;
        }
        if prev
            .utf8_text(source)
            .map(|text| text.contains("#[test]") || text.contains("::test]"))
            .unwrap_or(false)
        {
            return true;
        }
        sibling = prev.prev_named_sibling();
    }
    false
}

fn collect_rust_macro_references(node: Node<'_>, source: &[u8]) -> Vec<String> {
    let mut refs = BTreeSet::new();
    collect_rust_macro_references_inner(node, source, &mut refs);
    refs.into_iter().collect()
}

fn collect_rust_macro_references_inner(node: Node<'_>, source: &[u8], out: &mut BTreeSet<String>) {
    if node.kind() == "macro_invocation" {
        if let Some(child) = node.child_by_field_name("macro") {
            if let Ok(name) = child.utf8_text(source) {
                let normalized = name.trim().trim_end_matches('!').to_string();
                if !normalized.is_empty() {
                    out.insert(normalized);
                }
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_rust_macro_references_inner(child, source, out);
    }
}

fn parse_typescript_nodes(relative_path: &str, source: &str, root: Node<'_>) -> Vec<ChangedNode> {
    let mut nodes = Vec::new();
    collect_typescript_nodes(relative_path, source.as_bytes(), root, None, &mut nodes);
    nodes
}

fn collect_typescript_nodes(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    parent_name: Option<&str>,
    out: &mut Vec<ChangedNode>,
) {
    match node.kind() {
        "function_declaration" => {
            if let Some(parsed) =
                parse_typescript_symbol(relative_path, source, node, "Function", parent_name, "")
            {
                out.push(parsed);
            }
        }
        "class_declaration" => {
            let extends = extract_typescript_extends(node, source);
            let class_name = node
                .child_by_field_name("name")
                .and_then(|child| child.utf8_text(source).ok())
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(ToString::to_string);
            if let Some(class_name) = class_name {
                out.push(ChangedNode {
                    qualified_name: format!("{relative_path}:{class_name}"),
                    name: class_name.clone(),
                    kind: "Class".to_string(),
                    file_path: relative_path.to_string(),
                    language: "typescript".to_string(),
                    is_test: false,
                    line_start: Some(node.start_position().row + 1),
                    line_end: Some(node.end_position().row + 1),
                    parent_name: parent_name.map(ToString::to_string),
                    references: Vec::new(),
                    extends,
                    mentions: collect_identifier_mentions(node, source),
                });
                for child in node.children(&mut node.walk()) {
                    collect_typescript_nodes(relative_path, source, child, Some(&class_name), out);
                }
                return;
            }
        }
        "method_definition" => {
            if let Some(parsed) =
                parse_typescript_symbol(relative_path, source, node, "Method", parent_name, "")
            {
                out.push(parsed);
            }
        }
        "interface_declaration" => {
            if let Some(parsed) =
                parse_typescript_symbol(relative_path, source, node, "Interface", parent_name, "")
            {
                out.push(parsed);
            }
        }
        "enum_declaration" => {
            if let Some(parsed) =
                parse_typescript_symbol(relative_path, source, node, "Enum", parent_name, "")
            {
                out.push(parsed);
            }
        }
        _ => {}
    }

    for child in node.children(&mut node.walk()) {
        collect_typescript_nodes(relative_path, source, child, parent_name, out);
    }
}

fn parse_typescript_symbol(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    kind: &str,
    parent_name: Option<&str>,
    extends: &str,
) -> Option<ChangedNode> {
    let name = node
        .child_by_field_name("name")
        .and_then(|child| child.utf8_text(source).ok())
        .map(str::trim)
        .filter(|name| !name.is_empty())?
        .to_string();
    let qualified_name = if let Some(parent) = parent_name {
        format!("{relative_path}:{parent}.{name}")
    } else {
        format!("{relative_path}:{name}")
    };
    Some(ChangedNode {
        qualified_name,
        name,
        kind: kind.to_string(),
        file_path: relative_path.to_string(),
        language: "typescript".to_string(),
        is_test: false,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: parent_name.map(ToString::to_string),
        references: Vec::new(),
        extends: extends.to_string(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn extract_typescript_extends(node: Node<'_>, source: &[u8]) -> String {
    for child in node.children(&mut node.walk()) {
        if child.kind() == "class_heritage" || child.kind() == "extends_clause" {
            let text = child.utf8_text(source).unwrap_or("").trim().to_string();
            if !text.is_empty() {
                return text
                    .strip_prefix("extends")
                    .map(str::trim)
                    .unwrap_or(text.as_str())
                    .to_string();
            }
        }
    }
    String::new()
}

fn parse_java_nodes(relative_path: &str, source: &str, root: Node<'_>) -> Vec<ChangedNode> {
    let mut nodes = Vec::new();
    let package_name = extract_java_package(root, source.as_bytes());
    collect_java_nodes(
        relative_path,
        source.as_bytes(),
        root,
        package_name.as_deref(),
        None,
        &mut nodes,
    );
    nodes
}

fn extract_java_package(node: Node<'_>, source: &[u8]) -> Option<String> {
    for child in node.children(&mut node.walk()) {
        if child.kind() == "package_declaration" {
            for inner in child.children(&mut child.walk()) {
                if matches!(inner.kind(), "scoped_identifier" | "identifier") {
                    let value = inner.utf8_text(source).ok()?.trim().to_string();
                    if !value.is_empty() {
                        return Some(value);
                    }
                }
            }
        }
    }
    None
}

fn collect_java_nodes(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    package_name: Option<&str>,
    parent_name: Option<&str>,
    out: &mut Vec<ChangedNode>,
) {
    match node.kind() {
        "class_declaration" => {
            let extends = extract_java_extends(node, source);
            if let Some(class_name) = find_java_identifier(node, source) {
                out.push(ChangedNode {
                    qualified_name: qualify_java_name(relative_path, package_name, &class_name),
                    name: class_name.clone(),
                    kind: "Class".to_string(),
                    file_path: relative_path.to_string(),
                    language: "java".to_string(),
                    is_test: false,
                    line_start: Some(node.start_position().row + 1),
                    line_end: Some(node.end_position().row + 1),
                    parent_name: parent_name.map(ToString::to_string),
                    references: Vec::new(),
                    extends,
                    mentions: collect_identifier_mentions(node, source),
                });
                for child in node.children(&mut node.walk()) {
                    collect_java_nodes(
                        relative_path,
                        source,
                        child,
                        package_name,
                        Some(&class_name),
                        out,
                    );
                }
                return;
            }
        }
        "interface_declaration" => {
            if let Some(parsed) = parse_java_type_node(
                relative_path,
                source,
                node,
                package_name,
                parent_name,
                "Interface",
            ) {
                out.push(parsed);
            }
        }
        "enum_declaration" => {
            if let Some(parsed) = parse_java_type_node(
                relative_path,
                source,
                node,
                package_name,
                parent_name,
                "Enum",
            ) {
                out.push(parsed);
            }
        }
        "method_declaration" => {
            if let Some(parsed) =
                parse_java_callable_node(relative_path, source, node, package_name, parent_name)
            {
                out.push(parsed);
            }
        }
        "constructor_declaration" => {
            if let Some(parsed) =
                parse_java_callable_node(relative_path, source, node, package_name, parent_name)
            {
                out.push(parsed);
            }
        }
        _ => {}
    }

    for child in node.children(&mut node.walk()) {
        collect_java_nodes(relative_path, source, child, package_name, parent_name, out);
    }
}

fn parse_java_type_node(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    package_name: Option<&str>,
    parent_name: Option<&str>,
    kind: &str,
) -> Option<ChangedNode> {
    let name = find_java_identifier(node, source)?;
    Some(ChangedNode {
        qualified_name: qualify_java_name(relative_path, package_name, &name),
        name,
        kind: kind.to_string(),
        file_path: relative_path.to_string(),
        language: "java".to_string(),
        is_test: false,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: parent_name.map(ToString::to_string),
        references: Vec::new(),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn parse_java_callable_node(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    package_name: Option<&str>,
    parent_name: Option<&str>,
) -> Option<ChangedNode> {
    let name = find_java_identifier(node, source)?;
    let is_test = java_callable_is_test(node, source, &name);
    Some(ChangedNode {
        qualified_name: qualify_callable_name(relative_path, package_name, parent_name, &name),
        name,
        kind: if is_test {
            "Test".to_string()
        } else {
            "Method".to_string()
        },
        file_path: relative_path.to_string(),
        language: "java".to_string(),
        is_test,
        line_start: Some(node.start_position().row + 1),
        line_end: Some(node.end_position().row + 1),
        parent_name: parent_name.map(ToString::to_string),
        references: collect_identifier_mentions(node, source)
            .into_iter()
            .filter(|item| item != "Override" && item != "Test")
            .collect(),
        extends: String::new(),
        mentions: collect_identifier_mentions(node, source),
    })
}

fn extract_java_extends(node: Node<'_>, source: &[u8]) -> String {
    for child in node.children(&mut node.walk()) {
        if child.kind() == "superclass" || child.kind() == "super_interfaces" {
            let text = child.utf8_text(source).unwrap_or("").trim().to_string();
            if !text.is_empty() {
                return text;
            }
        }
    }
    String::new()
}

fn find_java_identifier(node: Node<'_>, source: &[u8]) -> Option<String> {
    for child in node.children(&mut node.walk()) {
        if child.kind() == "identifier" {
            let value = child.utf8_text(source).ok()?.trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

fn qualify_java_name(relative_path: &str, package_name: Option<&str>, name: &str) -> String {
    if let Some(package_name) = package_name {
        format!("{relative_path}:{package_name}.{name}")
    } else {
        format!("{relative_path}:{name}")
    }
}

fn qualify_callable_name(
    relative_path: &str,
    package_name: Option<&str>,
    parent_name: Option<&str>,
    name: &str,
) -> String {
    match (package_name, parent_name) {
        (Some(package_name), Some(parent_name)) => {
            format!("{relative_path}:{package_name}.{parent_name}.{name}")
        }
        (_, Some(parent_name)) => format!("{relative_path}:{parent_name}.{name}"),
        (Some(package_name), None) => format!("{relative_path}:{package_name}.{name}"),
        (None, None) => format!("{relative_path}:{name}"),
    }
}

fn java_callable_is_test(node: Node<'_>, source: &[u8], name: &str) -> bool {
    if name.starts_with("test") {
        return true;
    }
    let text = node.utf8_text(source).unwrap_or("");
    text.contains("@Test")
}

fn parse_go_nodes(relative_path: &str, source: &str, root: Node<'_>) -> Vec<ChangedNode> {
    let mut nodes = Vec::new();
    collect_go_nodes(relative_path, source.as_bytes(), root, None, &mut nodes);
    nodes
}

fn collect_go_nodes(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
    parent_name: Option<&str>,
    out: &mut Vec<ChangedNode>,
) {
    match node.kind() {
        "function_declaration" => {
            if let Some(parsed) = parse_go_function(relative_path, source, node, parent_name) {
                out.push(parsed);
            }
        }
        "method_declaration" => {
            if let Some(parsed) = parse_go_method(relative_path, source, node) {
                let receiver_name = parsed.parent_name.clone();
                out.push(parsed);
                for child in node.children(&mut node.walk()) {
                    collect_go_nodes(relative_path, source, child, receiver_name.as_deref(), out);
                }
                return;
            }
        }
        "type_declaration" => {
            for child in node.children(&mut node.walk()) {
                if child.kind() == "type_spec" {
                    if let Some(parsed) = parse_go_type_spec(relative_path, source, child) {
                        out.push(parsed);
                    }
                }
            }
        }
        _ => {}
    }

    for child in node.children(&mut node.walk()) {
        collect_go_nodes(relative_path, source, child, parent_name, out);
    }
}

fn parse_go_function(
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

fn parse_go_method(relative_path: &str, source: &[u8], node: Node<'_>) -> Option<ChangedNode> {
    let name = node
        .child_by_field_name("name")
        .and_then(|child| child.utf8_text(source).ok())
        .map(str::trim)
        .filter(|name| !name.is_empty())?
        .to_string();
    let receiver_name = node
        .child_by_field_name("receiver")
        .and_then(|receiver| receiver.utf8_text(source).ok())
        .map(|text| simplify_go_receiver(text))
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

fn parse_go_type_spec(relative_path: &str, source: &[u8], node: Node<'_>) -> Option<ChangedNode> {
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

fn simplify_go_receiver(text: &str) -> String {
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

fn parse_named_node(
    relative_path: &str,
    source: &[u8],
    node: Node<'_>,
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

fn collect_identifier_mentions(node: Node<'_>, source: &[u8]) -> Vec<String> {
    let mut mentions = BTreeSet::new();
    collect_identifier_mentions_inner(node, source, &mut mentions);
    mentions.into_iter().collect()
}

fn collect_identifier_mentions_inner(node: Node<'_>, source: &[u8], out: &mut BTreeSet<String>) {
    if matches!(
        node.kind(),
        "identifier" | "type_identifier" | "field_identifier"
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

fn language_for_path(path: &str) -> Option<SupportedLanguage> {
    match Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "rs" => Some(SupportedLanguage::Rust),
        "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" => Some(SupportedLanguage::TypeScript),
        "java" => Some(SupportedLanguage::Java),
        "go" => Some(SupportedLanguage::Go),
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

#[derive(Debug, Clone, Copy)]
enum SupportedLanguage {
    Rust,
    TypeScript,
    Java,
    Go,
}

impl SupportedLanguage {
    fn name(self) -> &'static str {
        match self {
            Self::Rust => "rust",
            Self::TypeScript => "typescript",
            Self::Java => "java",
            Self::Go => "go",
        }
    }

    fn ts_language(self) -> Language {
        match self {
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Java => tree_sitter_java::LANGUAGE.into(),
            Self::Go => tree_sitter_go::LANGUAGE.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_changed_files;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn parses_java_class_and_test_method_nodes() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("src/main/java/com/example")).unwrap();
        fs::write(
            root.join("src/main/java/com/example/Service.java"),
            "package com.example;\nclass Service extends BaseService {\n  String run() { return helper(); }\n  @Test\n  void testRun() { run(); }\n}\n",
        )
        .unwrap();

        let graph = parse_changed_files(
            root,
            &["src/main/java/com/example/Service.java".to_string()],
        );

        let qualified = graph
            .changed_nodes
            .iter()
            .map(|node| node.qualified_name.as_str())
            .collect::<Vec<_>>();
        assert!(qualified.contains(&"src/main/java/com/example/Service.java"));
        assert!(qualified.contains(&"src/main/java/com/example/Service.java:com.example.Service"));
        assert!(
            qualified.contains(&"src/main/java/com/example/Service.java:com.example.Service.run")
        );
        assert!(qualified
            .contains(&"src/main/java/com/example/Service.java:com.example.Service.testRun"));

        let test_node = graph
            .changed_nodes
            .iter()
            .find(|node| node.qualified_name.ends_with(".testRun"))
            .unwrap();
        assert!(test_node.is_test);
        assert_eq!(test_node.kind, "Test");
    }

    #[test]
    fn parses_go_types_functions_and_methods() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("pkg/demo")).unwrap();
        fs::write(
            root.join("pkg/demo/service.go"),
            "package demo\n\ntype Service struct{}\n\ntype Runner interface { Run() }\n\nfunc Build() int { return 1 }\n\nfunc (s *Service) Run() int { return Build() }\n",
        )
        .unwrap();

        let graph = parse_changed_files(root, &["pkg/demo/service.go".to_string()]);

        let qualified = graph
            .changed_nodes
            .iter()
            .map(|node| node.qualified_name.as_str())
            .collect::<Vec<_>>();
        assert!(qualified.contains(&"pkg/demo/service.go"));
        assert!(qualified.contains(&"pkg/demo/service.go:Service"));
        assert!(qualified.contains(&"pkg/demo/service.go:Runner"));
        assert!(qualified.contains(&"pkg/demo/service.go:Build"));
        assert!(qualified.contains(&"pkg/demo/service.go:Service.Run"));

        let method_node = graph
            .changed_nodes
            .iter()
            .find(|node| node.qualified_name == "pkg/demo/service.go:Service.Run")
            .unwrap();
        assert_eq!(method_node.kind, "Method");
        assert_eq!(method_node.parent_name.as_deref(), Some("Service"));
    }
}
