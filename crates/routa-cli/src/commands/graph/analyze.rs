//! TreeSitter-backed dependency graph analyzer for Rust and TypeScript code.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use tree_sitter::{Language, Node, Parser};
use walkdir::WalkDir;

use crate::commands::graph::{AnalyzeArgs, GraphOutputFormat};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphNode {
    pub id: String,
    pub path: String,
    pub language: String,
    pub kind: NodeKind,

    // Optional fields for normal mode (detailed AST analysis)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    // Fast mode - file level
    File,
    ExternalCrate,
    ExternalPackage,
    UnresolvedModule,

    // Normal mode - detailed AST nodes
    Package,
    Class,
    Interface,
    Enum,
    Method,
    Field,
    Constructor,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    pub kind: EdgeKind,
    pub specifier: String,
    pub resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    Uses,
    Imports,
    MadeOf,     // Package contains Class, Class contains Method
    DependsOn,  // Package/Class depends on another through import
    Extends,    // Class extends SuperClass
    Implements, // Class implements Interface
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyGraph {
    pub generated_at: String,
    pub root_dir: String,
    pub language: String,
    pub node_count: usize,
    pub edge_count: usize,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnalysisLang {
    Auto,
    Rust,
    TypeScript,
    Java,
    // Kotlin,  // Temporarily disabled due to tree-sitter version conflict
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnalysisDepth {
    Fast,   // File-level imports/uses only
    Normal, // Full AST with classes, methods, relationships
}

#[derive(Debug, Clone)]
struct RustWorkspaceContext {
    crates: Vec<RustCrate>,
    local_import_roots: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
struct RustCrate {
    src_dir: PathBuf,
    entry_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ResolvedDependency {
    LocalFile(String),
    External(NodeKind, String),
    Unresolved(String),
}

pub fn run_analyze(args: &AnalyzeArgs) -> Result<(), String> {
    let root = match &args.dir {
        Some(dir) => PathBuf::from(dir),
        None => {
            std::env::current_dir().map_err(|error| format!("failed to determine cwd: {error}"))?
        }
    };

    if !root.exists() {
        return Err(format!("directory does not exist: {}", root.display()));
    }

    let graph = analyze_directory(
        &root,
        args.lang.into_analysis_lang(),
        args.depth.into_analysis_depth(),
    );
    let output = match args.format {
        GraphOutputFormat::Json => serde_json::to_string_pretty(&graph)
            .map_err(|error| format!("failed to serialize graph: {error}"))?,
        GraphOutputFormat::Dot => render_dot(&graph),
    };

    if let Some(path) = &args.output {
        fs::write(path, &output)
            .map_err(|error| format!("failed to write graph output {path}: {error}"))?;
        println!("Graph written to: {path}");
    } else {
        println!("{output}");
    }

    Ok(())
}

pub fn analyze_directory(
    root: &Path,
    requested_lang: AnalysisLang,
    depth: AnalysisDepth,
) -> DependencyGraph {
    let rust_workspace = build_rust_workspace_context(root);
    let mut nodes: BTreeMap<String, GraphNode> = BTreeMap::new();
    let mut edges = BTreeSet::new();

    // Branch based on analysis depth
    match depth {
        AnalysisDepth::Fast => analyze_fast(
            root,
            requested_lang,
            &rust_workspace,
            &mut nodes,
            &mut edges,
        ),
        AnalysisDepth::Normal => analyze_normal(
            root,
            requested_lang,
            &rust_workspace,
            &mut nodes,
            &mut edges,
        ),
    }

    // Placeholder - actual implementation in analyze_fast/analyze_normal

    build_graph_result(root, requested_lang, nodes, edges)
}

// ─── Fast Mode Analysis ─────────────────────────────────────────────────────

fn analyze_fast(
    root: &Path,
    requested_lang: AnalysisLang,
    rust_workspace: &RustWorkspaceContext,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !is_ignored_path(entry.path()))
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
    {
        let path = entry.path();
        let effective_lang = match effective_lang_for_path(path, requested_lang) {
            Some(lang) => lang,
            None => continue,
        };

        let relative_path = repo_relative_path(root, path);
        let language = display_language(effective_lang).to_string();
        nodes
            .entry(relative_path.clone())
            .or_insert_with(|| GraphNode {
                id: relative_path.clone(),
                path: relative_path.clone(),
                language: language.clone(),
                kind: NodeKind::File,
                name: None,
                package_name: None,
                parent_id: None,
                start_line: None,
                end_line: None,
            });

        let source = match fs::read_to_string(path) {
            Ok(source) => source,
            Err(_) => continue,
        };

        let specifiers = match effective_lang {
            AnalysisLang::Rust => extract_rust_uses(&source),
            AnalysisLang::TypeScript => extract_typescript_imports(&source),
            AnalysisLang::Java => extract_java_imports(&source),
            AnalysisLang::Auto => continue,
        };

        for specifier in specifiers {
            let resolved = match effective_lang {
                AnalysisLang::Rust => {
                    resolve_rust_dependency(root, path, &specifier, rust_workspace)
                }
                AnalysisLang::TypeScript => resolve_typescript_dependency(root, path, &specifier),
                AnalysisLang::Java => resolve_java_dependency(root, path, &specifier),
                AnalysisLang::Auto => continue,
            };

            let (target_id, target_kind, resolved_flag) = match resolved {
                ResolvedDependency::LocalFile(path) => (path, NodeKind::File, true),
                ResolvedDependency::External(kind, id) => (id.clone(), kind, false),
                ResolvedDependency::Unresolved(id) => {
                    (id.clone(), NodeKind::UnresolvedModule, false)
                }
            };

            nodes.entry(target_id.clone()).or_insert_with(|| GraphNode {
                id: target_id.clone(),
                path: target_id.clone(),
                language: language.clone(),
                kind: target_kind,
                name: None,
                package_name: None,
                parent_id: None,
                start_line: None,
                end_line: None,
            });

            edges.insert((
                relative_path.clone(),
                target_id,
                match effective_lang {
                    AnalysisLang::Rust => EdgeKind::Uses,
                    AnalysisLang::TypeScript => EdgeKind::Imports,
                    AnalysisLang::Java => EdgeKind::Imports,
                    AnalysisLang::Auto => unreachable!(),
                },
                specifier,
                resolved_flag,
            ));
        }
    }
}

// ─── Normal Mode Analysis ────────────────────────────────────────────────────

fn analyze_normal(
    root: &Path,
    requested_lang: AnalysisLang,
    _rust_workspace: &RustWorkspaceContext,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !is_ignored_path(entry.path()))
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
    {
        let path = entry.path();
        let effective_lang = match effective_lang_for_path(path, requested_lang) {
            Some(lang) => lang,
            None => continue,
        };

        let source = match fs::read_to_string(path) {
            Ok(source) => source,
            Err(_) => continue,
        };

        // Delegate to language-specific normal mode analyzers
        match effective_lang {
            AnalysisLang::Java => {
                analyze_java_normal(root, path, &source, nodes, edges);
            }
            AnalysisLang::Rust => {
                analyze_rust_normal(root, path, &source, nodes, edges);
            }
            AnalysisLang::TypeScript => {
                analyze_typescript_normal(root, path, &source, nodes, edges);
            }
            AnalysisLang::Auto => continue,
        }
    }
}

fn build_graph_result(
    root: &Path,
    requested_lang: AnalysisLang,
    nodes: BTreeMap<String, GraphNode>,
    edges: BTreeSet<(String, String, EdgeKind, String, bool)>,
) -> DependencyGraph {
    let edges = edges
        .into_iter()
        .map(|(from, to, kind, specifier, resolved)| GraphEdge {
            from,
            to,
            kind,
            specifier,
            resolved,
        })
        .collect::<Vec<_>>();

    let nodes = nodes.into_values().collect::<Vec<_>>();
    DependencyGraph {
        generated_at: chrono::Utc::now().to_rfc3339(),
        root_dir: root.display().to_string(),
        language: display_language(requested_lang).to_string(),
        node_count: nodes.len(),
        edge_count: edges.len(),
        nodes,
        edges,
    }
}

pub fn render_dot(graph: &DependencyGraph) -> String {
    let mut out = String::from("digraph dependencies {\n");
    out.push_str("  rankdir=LR;\n");
    out.push_str("  node [shape=box, style=filled];\n");
    out.push_str("  edge [fontsize=10];\n");

    for node in &graph.nodes {
        let label = node.name.as_deref().unwrap_or(&node.id);
        let escaped_id = node.id.replace('"', "\\\"");
        let escaped_label = label.replace('"', "\\\"");

        // Choose color based on node kind
        let (color, shape) = match node.kind {
            NodeKind::Package => ("lightblue", "folder"),
            NodeKind::Class => ("lightgreen", "box"),
            NodeKind::Interface => ("lightyellow", "box"),
            NodeKind::Enum => ("lightcoral", "box"),
            NodeKind::Method => ("lightcyan", "ellipse"),
            NodeKind::Field => ("lavender", "ellipse"),
            NodeKind::Constructor => ("lightpink", "ellipse"),
            NodeKind::File => ("white", "note"),
            NodeKind::ExternalPackage => ("lightgray", "box"),
            NodeKind::ExternalCrate => ("lightgray", "box"),
            NodeKind::UnresolvedModule => ("pink", "box"),
        };

        out.push_str(&format!(
            "  \"{escaped_id}\" [label=\"{escaped_label}\", fillcolor={color}, shape={shape}];\n"
        ));
    }

    for edge in &graph.edges {
        let from = edge.from.replace('"', "\\\"");
        let to = edge.to.replace('"', "\\\"");

        // Add edge label and style based on kind
        let (label, style) = match edge.kind {
            EdgeKind::MadeOf => ("contains", "solid"),
            EdgeKind::DependsOn => ("depends on", "dashed"),
            EdgeKind::Extends => ("extends", "bold"),
            EdgeKind::Implements => ("implements", "dotted"),
            EdgeKind::Imports => ("imports", "solid"),
            EdgeKind::Uses => ("uses", "solid"),
        };

        out.push_str(&format!(
            "  \"{from}\" -> \"{to}\" [label=\"{label}\", style={style}];\n"
        ));
    }

    out.push_str("}\n");
    out
}

fn display_language(value: AnalysisLang) -> &'static str {
    match value {
        AnalysisLang::Auto => "auto",
        AnalysisLang::Rust => "rust",
        AnalysisLang::TypeScript => "typescript",
        AnalysisLang::Java => "java",
        // AnalysisLang::Kotlin => "kotlin",
    }
}

fn effective_lang_for_path(path: &Path, requested_lang: AnalysisLang) -> Option<AnalysisLang> {
    match requested_lang {
        AnalysisLang::Rust => match path.extension().and_then(|ext| ext.to_str()) {
            Some("rs") => Some(AnalysisLang::Rust),
            _ => None,
        },
        AnalysisLang::TypeScript => match path.extension().and_then(|ext| ext.to_str()) {
            Some("ts" | "tsx" | "mts" | "cts") => Some(AnalysisLang::TypeScript),
            _ => None,
        },
        AnalysisLang::Java => match path.extension().and_then(|ext| ext.to_str()) {
            Some("java") => Some(AnalysisLang::Java),
            _ => None,
        },
        // AnalysisLang::Kotlin => match path.extension().and_then(|ext| ext.to_str()) {
        //     Some("kt" | "kts") => Some(AnalysisLang::Kotlin),
        //     _ => None,
        // },
        AnalysisLang::Auto => match path.extension().and_then(|ext| ext.to_str()) {
            Some("rs") => Some(AnalysisLang::Rust),
            Some("ts" | "tsx" | "mts" | "cts") => Some(AnalysisLang::TypeScript),
            Some("java") => Some(AnalysisLang::Java),
            // Some("kt" | "kts") => Some(AnalysisLang::Kotlin),
            _ => None,
        },
    }
}

fn is_ignored_path(path: &Path) -> bool {
    const IGNORED: &[&str] = &[
        ".git",
        ".next",
        ".routa",
        ".worktrees",
        "build",
        "coverage",
        "dist",
        "node_modules",
        "out",
        "target",
    ];

    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|value| IGNORED.contains(&value))
            .unwrap_or(false)
    })
}

fn rust_language() -> Language {
    tree_sitter_rust::LANGUAGE.into()
}

fn typescript_language() -> Language {
    tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
}

fn java_language() -> Language {
    tree_sitter_java::LANGUAGE.into()
}

// fn kotlin_language() -> Language {
//     tree_sitter_kotlin::language()
// }

fn extract_rust_uses(source: &str) -> Vec<String> {
    let mut parser = Parser::new();
    parser
        .set_language(&rust_language())
        .expect("Rust grammar load failed");

    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };

    let mut paths = Vec::new();
    collect_rust_uses(tree.root_node(), source.as_bytes(), &mut paths);
    paths.sort();
    paths.dedup();
    paths
}

fn collect_rust_uses(node: Node<'_>, source: &[u8], out: &mut Vec<String>) {
    if node.kind() == "use_declaration" {
        if let Some(path_node) = node.child_by_field_name("argument") {
            let raw = path_node.utf8_text(source).unwrap_or("").trim().to_string();
            if !raw.is_empty() {
                out.push(raw);
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_rust_uses(child, source, out);
    }
}

fn extract_typescript_imports(source: &str) -> Vec<String> {
    let mut parser = Parser::new();
    parser
        .set_language(&typescript_language())
        .expect("TypeScript grammar load failed");

    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };

    let mut imports = Vec::new();
    collect_typescript_specifiers(tree.root_node(), source.as_bytes(), &mut imports);
    imports.sort();
    imports.dedup();
    imports
}

fn collect_typescript_specifiers(node: Node<'_>, source: &[u8], out: &mut Vec<String>) {
    if matches!(node.kind(), "import_statement" | "export_statement") {
        if let Some(source_node) = node.child_by_field_name("source") {
            let raw = source_node
                .utf8_text(source)
                .unwrap_or("")
                .trim()
                .to_string();
            let specifier = raw.trim_matches(|ch| ch == '"' || ch == '\'').to_string();
            if !specifier.is_empty() {
                out.push(specifier);
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_typescript_specifiers(child, source, out);
    }
}

fn resolve_typescript_dependency(
    root: &Path,
    importer: &Path,
    specifier: &str,
) -> ResolvedDependency {
    let candidate = if specifier.starts_with("./") || specifier.starts_with("../") {
        importer
            .parent()
            .map(|dir| normalize_path(&dir.join(specifier)))
    } else {
        specifier
            .strip_prefix("@/")
            .map(|path| normalize_path(&root.join("src").join(path)))
    };

    if let Some(candidate) = candidate {
        if let Some(resolved) = resolve_typescript_local_candidate(&candidate) {
            return ResolvedDependency::LocalFile(repo_relative_path(root, &resolved));
        }
        return ResolvedDependency::Unresolved(specifier.to_string());
    }

    ResolvedDependency::External(
        NodeKind::ExternalPackage,
        package_id_from_specifier(specifier),
    )
}

fn resolve_typescript_local_candidate(candidate: &Path) -> Option<PathBuf> {
    if candidate.is_file() {
        return Some(candidate.to_path_buf());
    }

    if candidate.extension().is_none() {
        for extension in [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".d.ts"] {
            let resolved = PathBuf::from(format!("{}{}", candidate.display(), extension));
            if resolved.is_file() {
                return Some(resolved);
            }
        }
    }

    if candidate.is_dir() {
        for index in [
            "index.ts",
            "index.tsx",
            "index.mts",
            "index.cts",
            "index.js",
            "index.jsx",
            "index.d.ts",
        ] {
            let resolved = candidate.join(index);
            if resolved.is_file() {
                return Some(resolved);
            }
        }
    }

    None
}

fn package_id_from_specifier(specifier: &str) -> String {
    if specifier.starts_with("node:") {
        return specifier.to_string();
    }

    if let Some(rest) = specifier.strip_prefix('@') {
        let mut segments = rest.split('/');
        if let (Some(scope), Some(package)) = (segments.next(), segments.next()) {
            return format!("@{scope}/{package}");
        }
    }

    specifier.split('/').next().unwrap_or(specifier).to_string()
}

fn build_rust_workspace_context(root: &Path) -> RustWorkspaceContext {
    let mut crates = Vec::new();
    let mut local_import_roots = BTreeMap::new();

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !is_ignored_path(entry.path()))
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && entry.file_name() == "Cargo.toml")
    {
        let manifest_path = entry.path();
        let Ok(contents) = fs::read_to_string(manifest_path) else {
            continue;
        };
        let Some(package_name) = parse_cargo_package_name(&contents) else {
            continue;
        };

        let crate_dir = manifest_path.parent().unwrap_or(root);
        let src_dir = crate_dir.join("src");
        if !src_dir.is_dir() {
            continue;
        }

        let entry_file = if src_dir.join("lib.rs").is_file() {
            src_dir.join("lib.rs")
        } else if src_dir.join("main.rs").is_file() {
            src_dir.join("main.rs")
        } else {
            continue;
        };

        let import_root = package_name.replace('-', "_");
        let entry_path = repo_relative_path(root, &entry_file);
        local_import_roots.insert(import_root.clone(), entry_path.clone());
        crates.push(RustCrate {
            src_dir,
            entry_path,
        });
    }

    crates.sort_by(|left, right| {
        right
            .src_dir
            .components()
            .count()
            .cmp(&left.src_dir.components().count())
    });
    RustWorkspaceContext {
        crates,
        local_import_roots,
    }
}

fn parse_cargo_package_name(contents: &str) -> Option<String> {
    let mut in_package = false;

    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_package = trimmed == "[package]";
            continue;
        }

        if !in_package || !trimmed.starts_with("name") {
            continue;
        }

        let value = trimmed.split_once('=')?.1.trim();
        if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
            return Some(value.trim_matches('"').to_string());
        }
    }

    None
}

fn resolve_rust_dependency(
    root: &Path,
    importer: &Path,
    specifier: &str,
    workspace: &RustWorkspaceContext,
) -> ResolvedDependency {
    let normalized = normalize_rust_use_specifier(specifier);
    if normalized.is_empty() {
        return ResolvedDependency::Unresolved(specifier.to_string());
    }

    let owning_crate = workspace
        .crates
        .iter()
        .find(|crate_info| importer.starts_with(&crate_info.src_dir));

    if let Some(crate_info) = owning_crate {
        if normalized == "crate" {
            return ResolvedDependency::LocalFile(crate_info.entry_path.clone());
        }

        if let Some(rest) = normalized.strip_prefix("crate::") {
            if let Some(path) = resolve_rust_module_path(root, crate_info, &[], rest) {
                return ResolvedDependency::LocalFile(path);
            }
        }

        if normalized.starts_with("self::") {
            let base = rust_module_segments(importer, crate_info);
            if let Some(path) = resolve_rust_module_path(
                root,
                crate_info,
                &base,
                normalized.trim_start_matches("self::"),
            ) {
                return ResolvedDependency::LocalFile(path);
            }
        }

        if normalized.starts_with("super::") {
            let mut base = rust_module_segments(importer, crate_info);
            let mut rest = normalized.as_str();
            while let Some(next) = rest.strip_prefix("super::") {
                if !base.is_empty() {
                    base.pop();
                }
                rest = next;
            }
            if let Some(path) = resolve_rust_module_path(root, crate_info, &base, rest) {
                return ResolvedDependency::LocalFile(path);
            }
        }

        if let Some(path) = resolve_rust_module_path(root, crate_info, &[], &normalized) {
            return ResolvedDependency::LocalFile(path);
        }
    }

    let first_segment = normalized.split("::").next().unwrap_or("");
    if let Some(path) = workspace.local_import_roots.get(first_segment) {
        return ResolvedDependency::LocalFile(path.clone());
    }

    if !first_segment.is_empty() {
        return ResolvedDependency::External(NodeKind::ExternalCrate, first_segment.to_string());
    }

    ResolvedDependency::Unresolved(specifier.to_string())
}

fn normalize_rust_use_specifier(specifier: &str) -> String {
    let mut value = specifier.trim().trim_start_matches("::").to_string();
    if let Some((head, _)) = value.split_once(" as ") {
        value = head.trim().to_string();
    }
    if let Some(index) = value.find('{') {
        value = value[..index].trim_end_matches("::").trim().to_string();
    }
    value
}

fn rust_module_segments(importer: &Path, crate_info: &RustCrate) -> Vec<String> {
    let Ok(relative) = importer.strip_prefix(&crate_info.src_dir) else {
        return Vec::new();
    };

    let file_name = relative.file_name().and_then(|name| name.to_str());
    match file_name {
        Some("lib.rs") | Some("main.rs") => Vec::new(),
        Some("mod.rs") => relative
            .parent()
            .into_iter()
            .flat_map(Path::components)
            .filter_map(|component| component.as_os_str().to_str().map(str::to_string))
            .collect(),
        _ => relative
            .with_extension("")
            .components()
            .filter_map(|component| component.as_os_str().to_str().map(str::to_string))
            .collect(),
    }
}

fn resolve_rust_module_path(
    root: &Path,
    crate_info: &RustCrate,
    base_segments: &[String],
    rest: &str,
) -> Option<String> {
    let mut segments = base_segments.to_vec();
    segments.extend(
        rest.split("::")
            .filter(|segment| !segment.is_empty())
            .map(str::to_string),
    );

    if segments.is_empty() {
        return Some(crate_info.entry_path.clone());
    }

    for length in (1..=segments.len()).rev() {
        let mut module_base = crate_info.src_dir.clone();
        for segment in &segments[..length] {
            module_base.push(segment);
        }

        for candidate in [module_base.with_extension("rs"), module_base.join("mod.rs")] {
            if candidate.is_file() {
                return Some(repo_relative_path(root, &candidate));
            }
        }
    }

    None
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn repo_relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

// ─── Java Support ───────────────────────────────────────────────────────────

fn extract_java_imports(source: &str) -> Vec<String> {
    let mut parser = Parser::new();
    parser
        .set_language(&java_language())
        .expect("Java grammar load failed");

    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };

    let mut imports = Vec::new();
    collect_java_imports(tree.root_node(), source.as_bytes(), &mut imports);
    imports.sort();
    imports.dedup();
    imports
}

fn collect_java_imports(node: Node<'_>, source: &[u8], out: &mut Vec<String>) {
    if node.kind() == "import_declaration" {
        // Extract the import path from Java import statements
        // Example: import java.util.List; -> java.util.List
        for i in 0..node.child_count() {
            if let Some(child) = node.child(i) {
                if child.kind() == "scoped_identifier" || child.kind() == "identifier" {
                    let raw = child.utf8_text(source).unwrap_or("").trim().to_string();
                    if !raw.is_empty() {
                        out.push(raw);
                    }
                    break;
                }
            }
        }
    }

    for child in node.children(&mut node.walk()) {
        collect_java_imports(child, source, out);
    }
}

fn resolve_java_dependency(root: &Path, _importer: &Path, specifier: &str) -> ResolvedDependency {
    // Check if it's a standard Java library
    if specifier.starts_with("java.") || specifier.starts_with("javax.") {
        return ResolvedDependency::External(
            NodeKind::ExternalPackage,
            specifier.split('.').next().unwrap_or(specifier).to_string(),
        );
    }

    // Try to resolve as a local file
    // Convert package notation to file path: com.example.Foo -> com/example/Foo.java
    let path_parts: Vec<&str> = specifier.split('.').collect();
    if let Some(class_name) = path_parts.last() {
        let dir_parts = &path_parts[..path_parts.len() - 1];

        // Try common Java source locations
        for src_root in &["src/main/java", "src", "."] {
            let mut candidate = root.join(src_root);
            for part in dir_parts {
                candidate = candidate.join(part);
            }
            candidate = candidate.join(format!("{class_name}.java"));

            if candidate.exists() && candidate.is_file() {
                return ResolvedDependency::LocalFile(repo_relative_path(root, &candidate));
            }
        }
    }

    // If not found locally, treat as external package
    ResolvedDependency::External(
        NodeKind::ExternalPackage,
        path_parts.first().unwrap_or(&specifier).to_string(),
    )
}

// ─── Kotlin Support (Temporarily Disabled) ──────────────────────────────────
// Disabled due to tree-sitter version conflict with tree-sitter-kotlin 0.3.8
// which requires tree-sitter 0.21 but routa-cli uses 0.25

// fn extract_kotlin_imports(source: &str) -> Vec<String> {
//     let mut parser = Parser::new();
//     parser
//         .set_language(&kotlin_language())
//         .expect("Kotlin grammar load failed");

//     let Some(tree) = parser.parse(source, None) else {
//         return Vec::new();
//     };

//     let mut imports = Vec::new();
//     collect_kotlin_imports(tree.root_node(), source.as_bytes(), &mut imports);
//     imports.sort();
//     imports.dedup();
//     imports
// }

// fn collect_kotlin_imports(node: Node<'_>, source: &[u8], out: &mut Vec<String>) {
//     if node.kind() == "import_header" {
//         // Extract the import path from Kotlin import statements
//         // Example: import kotlin.collections.List -> kotlin.collections.List
//         for i in 0..node.child_count() {
//             if let Some(child) = node.child(i) {
//                 if child.kind() == "identifier" {
//                     let raw = child.utf8_text(source).unwrap_or("").trim().to_string();
//                     if !raw.is_empty() && raw != "import" {
//                         out.push(raw);
//                     }
//                     break;
//                 }
//             }
//         }
//     }

//     for child in node.children(&mut node.walk()) {
//         collect_kotlin_imports(child, source, out);
//     }
// }

// fn resolve_kotlin_dependency(
//     root: &Path,
//     _importer: &Path,
//     specifier: &str,
// ) -> ResolvedDependency {
//     // Check if it's a standard Kotlin library
//     if specifier.starts_with("kotlin.") || specifier.starts_with("kotlinx.") {
//         return ResolvedDependency::External(
//             NodeKind::ExternalPackage,
//             specifier.split('.').next().unwrap_or(specifier).to_string(),
//         );
//     }

//     // Try to resolve as a local file
//     // Convert package notation to file path: com.example.Foo -> com/example/Foo.kt
//     let path_parts: Vec<&str> = specifier.split('.').collect();
//     if let Some(class_name) = path_parts.last() {
//         let dir_parts = &path_parts[..path_parts.len() - 1];

//         // Try common Kotlin source locations
//         for src_root in &["src/main/kotlin", "src/main/java", "src", "."] {
//             let mut candidate = root.join(src_root);
//             for part in dir_parts {
//                 candidate = candidate.join(part);
//             }

//             // Try both .kt and .kts extensions
//             for ext in &["kt", "kts"] {
//                 let file_candidate = candidate.join(format!("{}.{}", class_name, ext));
//                 if file_candidate.exists() && file_candidate.is_file() {
//                     return ResolvedDependency::LocalFile(repo_relative_path(root, &file_candidate));
//                 }
//             }
//         }
//     }

//     // If not found locally, treat as external package
//     ResolvedDependency::External(
//         NodeKind::ExternalPackage,
//         path_parts.first().unwrap_or(&specifier).to_string(),
//     )
// }

// ─── Java Normal Mode Analysis (SASK-style) ──────────────────────────────────

fn analyze_java_normal(
    root: &Path,
    path: &Path,
    source: &str,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let mut parser = Parser::new();
    parser
        .set_language(&java_language())
        .expect("Java grammar load failed");

    let Some(tree) = parser.parse(source, None) else {
        return;
    };

    let relative_path = repo_relative_path(root, path);
    let file_id = relative_path.clone();

    // Add file node
    nodes.entry(file_id.clone()).or_insert_with(|| GraphNode {
        id: file_id.clone(),
        path: relative_path.clone(),
        language: "java".to_string(),
        kind: NodeKind::File,
        name: None,
        package_name: None,
        parent_id: None,
        start_line: None,
        end_line: None,
    });

    let root_node = tree.root_node();
    let source_bytes = source.as_bytes();

    // Extract package declaration
    let package_name = extract_java_package(root_node, source_bytes);

    // Extract import dependencies (DEPENDS_ON relationships)
    extract_java_import_dependencies(root_node, source_bytes, &package_name, nodes, edges);

    // Extract all AST nodes
    extract_java_ast_nodes(
        root_node,
        source_bytes,
        &file_id,
        &package_name,
        nodes,
        edges,
    );
}

fn extract_java_package(node: Node, source: &[u8]) -> Option<String> {
    for child in node.children(&mut node.walk()) {
        if child.kind() == "package_declaration" {
            for i in 0..child.child_count() {
                if let Some(id_node) = child.child(i) {
                    if id_node.kind() == "scoped_identifier" || id_node.kind() == "identifier" {
                        return Some(id_node.utf8_text(source).unwrap_or("").trim().to_string());
                    }
                }
            }
        }
    }
    None
}

fn extract_java_import_dependencies(
    node: Node,
    source: &[u8],
    package_name: &Option<String>,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    for child in node.children(&mut node.walk()) {
        if child.kind() == "import_declaration" {
            // Extract import path
            for i in 0..child.child_count() {
                if let Some(import_node) = child.child(i) {
                    if import_node.kind() == "scoped_identifier"
                        || import_node.kind() == "identifier"
                    {
                        let import_path = import_node.utf8_text(source).unwrap_or("").trim();
                        if !import_path.is_empty() {
                            // Extract the package from the import (e.g., java.util.List -> java.util)
                            let imported_package = if let Some(last_dot) = import_path.rfind('.') {
                                &import_path[..last_dot]
                            } else {
                                import_path
                            };

                            // Create package node for imported package if it's external
                            if imported_package.starts_with("java.")
                                || imported_package.starts_with("javax.")
                                || imported_package.starts_with("org.")
                                || imported_package.starts_with("com.")
                            {
                                let target_package_id = format!("package:{imported_package}");

                                // Add external package node
                                nodes.entry(target_package_id.clone()).or_insert_with(|| {
                                    GraphNode {
                                        id: target_package_id.clone(),
                                        path: imported_package.to_string(),
                                        language: "java".to_string(),
                                        kind: NodeKind::Package,
                                        name: Some(imported_package.to_string()),
                                        package_name: Some(imported_package.to_string()),
                                        parent_id: None,
                                        start_line: None,
                                        end_line: None,
                                    }
                                });

                                // Add DEPENDS_ON edge from current package to imported package
                                if let Some(current_pkg) = package_name {
                                    let source_package_id = format!("package:{current_pkg}");

                                    // Only add edge if it's a different package
                                    if current_pkg != imported_package {
                                        edges.insert((
                                            source_package_id,
                                            target_package_id,
                                            EdgeKind::DependsOn,
                                            import_path.to_string(),
                                            false, // External dependency
                                        ));
                                    }
                                }
                            }
                        }
                        break;
                    }
                }
            }
        }
    }
}

fn extract_java_ast_nodes(
    node: Node,
    source: &[u8],
    file_id: &str,
    package_name: &Option<String>,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    match node.kind() {
        "package_declaration" => {
            if let Some(pkg_name) = package_name {
                let pkg_id = format!("package:{pkg_name}");
                nodes.entry(pkg_id.clone()).or_insert_with(|| GraphNode {
                    id: pkg_id.clone(),
                    path: file_id.to_string(),
                    language: "java".to_string(),
                    kind: NodeKind::Package,
                    name: Some(pkg_name.clone()),
                    package_name: Some(pkg_name.clone()),
                    parent_id: None,
                    start_line: Some(node.start_position().row + 1),
                    end_line: Some(node.end_position().row + 1),
                });
            }
        }
        "class_declaration" => {
            extract_java_class(node, source, file_id, package_name, nodes, edges);
        }
        "interface_declaration" => {
            extract_java_interface(node, source, file_id, package_name, nodes, edges);
        }
        "enum_declaration" => {
            extract_java_enum(node, source, file_id, package_name, nodes, edges);
        }
        _ => {}
    }

    for child in node.children(&mut node.walk()) {
        extract_java_ast_nodes(child, source, file_id, package_name, nodes, edges);
    }
}

fn extract_java_class(
    node: Node,
    source: &[u8],
    file_id: &str,
    package_name: &Option<String>,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let class_name = find_child_text(node, "identifier", source);
    if class_name.is_empty() {
        return;
    }

    let full_name = if let Some(pkg) = package_name {
        format!("{pkg}.{class_name}")
    } else {
        class_name.clone()
    };

    let class_id = format!("class:{full_name}");
    nodes.entry(class_id.clone()).or_insert_with(|| GraphNode {
        id: class_id.clone(),
        path: file_id.to_string(),
        language: "java".to_string(),
        kind: NodeKind::Class,
        name: Some(class_name.clone()),
        package_name: package_name.clone(),
        parent_id: package_name.as_ref().map(|pkg| format!("package:{pkg}")),
        start_line: Some(node.start_position().row + 1),
        end_line: Some(node.end_position().row + 1),
    });

    // MADE_OF: Package → Class
    if let Some(pkg) = package_name {
        edges.insert((
            format!("package:{pkg}"),
            class_id.clone(),
            EdgeKind::MadeOf,
            full_name.clone(),
            true,
        ));
    }

    // Extract extends/implements relationships
    extract_java_inheritance(node, source, &class_id, package_name, edges);

    // Extract methods and fields from class_body
    for child in node.children(&mut node.walk()) {
        if child.kind() == "class_body" {
            // Iterate through class_body children
            for body_child in child.children(&mut child.walk()) {
                match body_child.kind() {
                    "method_declaration" | "constructor_declaration" => {
                        extract_java_method(
                            body_child,
                            source,
                            file_id,
                            &class_id,
                            package_name,
                            nodes,
                            edges,
                        );
                    }
                    "field_declaration" => {
                        extract_java_field(
                            body_child,
                            source,
                            file_id,
                            &class_id,
                            package_name,
                            nodes,
                            edges,
                        );
                    }
                    _ => {}
                }
            }
        }
    }
}

fn extract_java_interface(
    node: Node,
    source: &[u8],
    file_id: &str,
    package_name: &Option<String>,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let interface_name = find_child_text(node, "identifier", source);
    if interface_name.is_empty() {
        return;
    }

    let full_name = if let Some(pkg) = package_name {
        format!("{pkg}.{interface_name}")
    } else {
        interface_name.clone()
    };

    let interface_id = format!("interface:{full_name}");
    nodes
        .entry(interface_id.clone())
        .or_insert_with(|| GraphNode {
            id: interface_id.clone(),
            path: file_id.to_string(),
            language: "java".to_string(),
            kind: NodeKind::Interface,
            name: Some(interface_name.clone()),
            package_name: package_name.clone(),
            parent_id: package_name.as_ref().map(|pkg| format!("package:{pkg}")),
            start_line: Some(node.start_position().row + 1),
            end_line: Some(node.end_position().row + 1),
        });

    // MADE_OF: Package → Interface
    if let Some(pkg) = package_name {
        edges.insert((
            format!("package:{pkg}"),
            interface_id.clone(),
            EdgeKind::MadeOf,
            full_name.clone(),
            true,
        ));
    }

    // Extract methods from interface_body
    for child in node.children(&mut node.walk()) {
        if child.kind() == "interface_body" {
            for body_child in child.children(&mut child.walk()) {
                if body_child.kind() == "method_declaration" {
                    extract_java_method(
                        body_child,
                        source,
                        file_id,
                        &interface_id,
                        package_name,
                        nodes,
                        edges,
                    );
                }
            }
        }
    }
}

fn extract_java_enum(
    node: Node,
    source: &[u8],
    file_id: &str,
    package_name: &Option<String>,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let enum_name = find_child_text(node, "identifier", source);
    if enum_name.is_empty() {
        return;
    }

    let full_name = if let Some(pkg) = package_name {
        format!("{pkg}.{enum_name}")
    } else {
        enum_name.clone()
    };

    let enum_id = format!("enum:{full_name}");
    nodes.entry(enum_id.clone()).or_insert_with(|| GraphNode {
        id: enum_id.clone(),
        path: file_id.to_string(),
        language: "java".to_string(),
        kind: NodeKind::Enum,
        name: Some(enum_name.clone()),
        package_name: package_name.clone(),
        parent_id: package_name.as_ref().map(|pkg| format!("package:{pkg}")),
        start_line: Some(node.start_position().row + 1),
        end_line: Some(node.end_position().row + 1),
    });

    // MADE_OF: Package → Enum
    if let Some(pkg) = package_name {
        edges.insert((
            format!("package:{pkg}"),
            enum_id,
            EdgeKind::MadeOf,
            full_name,
            true,
        ));
    }
}

fn extract_java_method(
    node: Node,
    source: &[u8],
    file_id: &str,
    parent_id: &str,
    package_name: &Option<String>,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let method_name = find_child_text(node, "identifier", source);
    if method_name.is_empty() {
        return;
    }

    let method_id = format!("{parent_id}::{method_name}");
    let kind = if node.kind() == "constructor_declaration" {
        NodeKind::Constructor
    } else {
        NodeKind::Method
    };

    nodes.entry(method_id.clone()).or_insert_with(|| GraphNode {
        id: method_id.clone(),
        path: file_id.to_string(),
        language: "java".to_string(),
        kind,
        name: Some(method_name.clone()),
        package_name: package_name.clone(),
        parent_id: Some(parent_id.to_string()),
        start_line: Some(node.start_position().row + 1),
        end_line: Some(node.end_position().row + 1),
    });

    // MADE_OF: Class/Interface → Method
    edges.insert((
        parent_id.to_string(),
        method_id,
        EdgeKind::MadeOf,
        method_name,
        true,
    ));
}

fn extract_java_field(
    node: Node,
    source: &[u8],
    file_id: &str,
    parent_id: &str,
    package_name: &Option<String>,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    for child in node.children(&mut node.walk()) {
        if child.kind() == "variable_declarator" {
            let field_name = find_child_text(child, "identifier", source);
            if field_name.is_empty() {
                continue;
            }

            let field_id = format!("{parent_id}::{field_name}");
            nodes.entry(field_id.clone()).or_insert_with(|| GraphNode {
                id: field_id.clone(),
                path: file_id.to_string(),
                language: "java".to_string(),
                kind: NodeKind::Field,
                name: Some(field_name.clone()),
                package_name: package_name.clone(),
                parent_id: Some(parent_id.to_string()),
                start_line: Some(node.start_position().row + 1),
                end_line: Some(node.end_position().row + 1),
            });

            // MADE_OF: Class → Field
            edges.insert((
                parent_id.to_string(),
                field_id,
                EdgeKind::MadeOf,
                field_name,
                true,
            ));
        }
    }
}

fn extract_java_inheritance(
    node: Node,
    source: &[u8],
    class_id: &str,
    package_name: &Option<String>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    for child in node.children(&mut node.walk()) {
        match child.kind() {
            "superclass" => {
                // extends SuperClass
                if let Some(type_id) = child.child(1) {
                    let super_class = type_id.utf8_text(source).unwrap_or("").trim();
                    if !super_class.is_empty() {
                        let target_id = if super_class.contains('.') {
                            format!("class:{super_class}")
                        } else if let Some(pkg) = package_name {
                            format!("class:{pkg}.{super_class}")
                        } else {
                            format!("class:{super_class}")
                        };

                        edges.insert((
                            class_id.to_string(),
                            target_id,
                            EdgeKind::Extends,
                            super_class.to_string(),
                            false, // May not resolve if external
                        ));
                    }
                }
            }
            "super_interfaces" => {
                // implements Interface1, Interface2
                for interface_node in child.children(&mut child.walk()) {
                    // Can be type_identifier or type_list containing type_identifier
                    let interface_name = if interface_node.kind() == "type_identifier" {
                        interface_node
                            .utf8_text(source)
                            .unwrap_or("")
                            .trim()
                            .to_string()
                    } else if interface_node.kind() == "type_list" {
                        // For multiple interfaces, iterate through type_list
                        for type_node in interface_node.children(&mut interface_node.walk()) {
                            if type_node.kind() == "type_identifier"
                                || type_node.kind() == "scoped_type_identifier"
                            {
                                let name = type_node.utf8_text(source).unwrap_or("").trim();
                                if !name.is_empty() {
                                    let target_id = if name.contains('.') {
                                        format!("interface:{name}")
                                    } else if let Some(pkg) = package_name {
                                        format!("interface:{pkg}.{name}")
                                    } else {
                                        format!("interface:{name}")
                                    };

                                    edges.insert((
                                        class_id.to_string(),
                                        target_id,
                                        EdgeKind::Implements,
                                        name.to_string(),
                                        false,
                                    ));
                                }
                            }
                        }
                        continue;
                    } else {
                        continue;
                    };

                    if !interface_name.is_empty() {
                        let target_id = if interface_name.contains('.') {
                            format!("interface:{interface_name}")
                        } else if let Some(pkg) = package_name {
                            format!("interface:{pkg}.{interface_name}")
                        } else {
                            format!("interface:{interface_name}")
                        };

                        edges.insert((
                            class_id.to_string(),
                            target_id,
                            EdgeKind::Implements,
                            interface_name,
                            false,
                        ));
                    }
                }
            }
            _ => {}
        }
    }
}

fn find_child_text(node: Node, kind: &str, source: &[u8]) -> String {
    for child in node.children(&mut node.walk()) {
        if child.kind() == kind {
            return child.utf8_text(source).unwrap_or("").trim().to_string();
        }
    }
    String::new()
}

// ─── Rust Normal Mode Analysis ───────────────────────────────────────────────

fn analyze_rust_normal(
    root: &Path,
    path: &Path,
    source: &str,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let mut parser = Parser::new();
    parser
        .set_language(&rust_language())
        .expect("Rust grammar load failed");

    let Some(tree) = parser.parse(source, None) else {
        return;
    };

    let relative_path = repo_relative_path(root, path);
    let file_id = relative_path.clone();

    // Add file node
    nodes.entry(file_id.clone()).or_insert_with(|| GraphNode {
        id: file_id.clone(),
        path: relative_path.clone(),
        language: "rust".to_string(),
        kind: NodeKind::File,
        name: None,
        package_name: None,
        parent_id: None,
        start_line: None,
        end_line: None,
    });

    // Extract module path from file path (e.g., src/foo/bar.rs -> foo::bar)
    let module_path = extract_rust_module_path(root, path);

    // Extract all Rust AST nodes
    extract_rust_ast_nodes(
        tree.root_node(),
        source.as_bytes(),
        &file_id,
        &module_path,
        nodes,
        edges,
    );
}

fn extract_rust_module_path(root: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);
    let mut parts: Vec<&str> = Vec::new();

    for component in relative.components() {
        if let std::path::Component::Normal(os_str) = component {
            if let Some(s) = os_str.to_str() {
                if s != "src" && s != "lib.rs" && s != "main.rs" {
                    let name = s.trim_end_matches(".rs");
                    if !name.is_empty() && name != "mod" {
                        parts.push(name);
                    }
                }
            }
        }
    }

    if parts.is_empty() {
        "crate".to_string()
    } else {
        parts.join("::")
    }
}

fn extract_rust_ast_nodes(
    node: Node,
    source: &[u8],
    file_id: &str,
    module_path: &str,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    match node.kind() {
        "struct_item" => {
            extract_rust_struct(node, source, file_id, module_path, nodes, edges);
        }
        "trait_item" => {
            extract_rust_trait(node, source, file_id, module_path, nodes, edges);
        }
        "impl_item" => {
            extract_rust_impl(node, source, file_id, module_path, nodes, edges);
        }
        "function_item" => {
            extract_rust_function(node, source, file_id, module_path, nodes, edges);
        }
        "enum_item" => {
            extract_rust_enum(node, source, file_id, module_path, nodes, edges);
        }
        _ => {}
    }

    for child in node.children(&mut node.walk()) {
        extract_rust_ast_nodes(child, source, file_id, module_path, nodes, edges);
    }
}

fn extract_rust_struct(
    node: Node,
    source: &[u8],
    file_id: &str,
    module_path: &str,
    nodes: &mut BTreeMap<String, GraphNode>,
    _edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let struct_name = find_child_text(node, "type_identifier", source);
    if struct_name.is_empty() {
        return;
    }

    let full_name = format!("{module_path}::{struct_name}");
    let struct_id = format!("struct:{full_name}");

    nodes.entry(struct_id.clone()).or_insert_with(|| GraphNode {
        id: struct_id.clone(),
        path: file_id.to_string(),
        language: "rust".to_string(),
        kind: NodeKind::Class, // Use Class for struct
        name: Some(struct_name.clone()),
        package_name: Some(module_path.to_string()),
        parent_id: None,
        start_line: Some(node.start_position().row + 1),
        end_line: Some(node.end_position().row + 1),
    });
}

fn extract_rust_trait(
    node: Node,
    source: &[u8],
    file_id: &str,
    module_path: &str,
    nodes: &mut BTreeMap<String, GraphNode>,
    _edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let trait_name = find_child_text(node, "type_identifier", source);
    if trait_name.is_empty() {
        return;
    }

    let full_name = format!("{module_path}::{trait_name}");
    let trait_id = format!("trait:{full_name}");

    nodes.entry(trait_id.clone()).or_insert_with(|| GraphNode {
        id: trait_id,
        path: file_id.to_string(),
        language: "rust".to_string(),
        kind: NodeKind::Interface, // Use Interface for trait
        name: Some(trait_name),
        package_name: Some(module_path.to_string()),
        parent_id: None,
        start_line: Some(node.start_position().row + 1),
        end_line: Some(node.end_position().row + 1),
    });
}

fn extract_rust_impl(
    node: Node,
    source: &[u8],
    _file_id: &str,
    module_path: &str,
    _nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    // Extract impl Trait for Type pattern
    // Collect all type_identifiers to find trait and type
    let mut type_identifiers = Vec::new();

    for child in node.children(&mut node.walk()) {
        if child.kind() == "type_identifier" {
            if let Ok(name) = child.utf8_text(source) {
                type_identifiers.push(name.trim().to_string());
            }
        }
    }

    // If we have 2 type identifiers, it's "impl Trait for Type"
    if type_identifiers.len() == 2 {
        let trait_name = &type_identifiers[0];
        let type_name = &type_identifiers[1];

        let struct_id = format!("struct:{module_path}::{type_name}");
        let trait_id = format!("trait:{module_path}::{trait_name}");

        edges.insert((
            struct_id,
            trait_id,
            EdgeKind::Implements,
            trait_name.clone(),
            false,
        ));
    }
}

fn extract_rust_function(
    node: Node,
    source: &[u8],
    file_id: &str,
    module_path: &str,
    nodes: &mut BTreeMap<String, GraphNode>,
    _edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let fn_name = find_child_text(node, "identifier", source);
    if fn_name.is_empty() {
        return;
    }

    let full_name = format!("{module_path}::{fn_name}");
    let fn_id = format!("fn:{full_name}");

    nodes.entry(fn_id).or_insert_with(|| GraphNode {
        id: format!("fn:{full_name}"),
        path: file_id.to_string(),
        language: "rust".to_string(),
        kind: NodeKind::Method,
        name: Some(fn_name),
        package_name: Some(module_path.to_string()),
        parent_id: None,
        start_line: Some(node.start_position().row + 1),
        end_line: Some(node.end_position().row + 1),
    });
}

fn extract_rust_enum(
    node: Node,
    source: &[u8],
    file_id: &str,
    module_path: &str,
    nodes: &mut BTreeMap<String, GraphNode>,
    _edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let enum_name = find_child_text(node, "type_identifier", source);
    if enum_name.is_empty() {
        return;
    }

    let full_name = format!("{module_path}::{enum_name}");
    let enum_id = format!("enum:{full_name}");

    nodes.entry(enum_id).or_insert_with(|| GraphNode {
        id: format!("enum:{full_name}"),
        path: file_id.to_string(),
        language: "rust".to_string(),
        kind: NodeKind::Enum,
        name: Some(enum_name),
        package_name: Some(module_path.to_string()),
        parent_id: None,
        start_line: Some(node.start_position().row + 1),
        end_line: Some(node.end_position().row + 1),
    });
}

// ─── TypeScript Normal Mode Analysis ─────────────────────────────────────────

fn analyze_typescript_normal(
    root: &Path,
    path: &Path,
    source: &str,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let mut parser = Parser::new();
    parser
        .set_language(&typescript_language())
        .expect("TypeScript grammar load failed");

    let Some(tree) = parser.parse(source, None) else {
        return;
    };

    let relative_path = repo_relative_path(root, path);
    let file_id = relative_path.clone();

    // Add file node
    nodes.entry(file_id.clone()).or_insert_with(|| GraphNode {
        id: file_id.clone(),
        path: relative_path.clone(),
        language: "typescript".to_string(),
        kind: NodeKind::File,
        name: None,
        package_name: None,
        parent_id: None,
        start_line: None,
        end_line: None,
    });

    let module_path = relative_path
        .trim_end_matches(".ts")
        .trim_end_matches(".tsx")
        .replace('/', ".");

    // Extract all TypeScript AST nodes
    extract_typescript_ast_nodes(
        tree.root_node(),
        source.as_bytes(),
        &file_id,
        &module_path,
        nodes,
        edges,
    );
}

fn extract_typescript_ast_nodes(
    node: Node,
    source: &[u8],
    file_id: &str,
    module_path: &str,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    match node.kind() {
        "class_declaration" => {
            extract_typescript_class(node, source, file_id, module_path, nodes, edges);
        }
        "interface_declaration" => {
            extract_typescript_interface(node, source, file_id, module_path, nodes, edges);
        }
        "function_declaration" => {
            extract_typescript_function(node, source, file_id, module_path, nodes, edges);
        }
        "enum_declaration" => {
            extract_typescript_enum(node, source, file_id, module_path, nodes, edges);
        }
        _ => {}
    }

    for child in node.children(&mut node.walk()) {
        extract_typescript_ast_nodes(child, source, file_id, module_path, nodes, edges);
    }
}

fn extract_typescript_class(
    node: Node,
    source: &[u8],
    file_id: &str,
    module_path: &str,
    nodes: &mut BTreeMap<String, GraphNode>,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let class_name = find_child_text(node, "type_identifier", source);
    if class_name.is_empty() {
        return;
    }

    let full_name = format!("{module_path}.{class_name}");
    let class_id = format!("class:{full_name}");

    nodes.entry(class_id.clone()).or_insert_with(|| GraphNode {
        id: class_id.clone(),
        path: file_id.to_string(),
        language: "typescript".to_string(),
        kind: NodeKind::Class,
        name: Some(class_name.clone()),
        package_name: Some(module_path.to_string()),
        parent_id: None,
        start_line: Some(node.start_position().row + 1),
        end_line: Some(node.end_position().row + 1),
    });

    // Extract extends/implements - recursively search for extends_clause and implements_clause
    extract_typescript_inheritance(&node, source, &class_id, module_path, edges);
}

fn extract_typescript_inheritance(
    node: &Node,
    source: &[u8],
    class_id: &str,
    module_path: &str,
    edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    for child in node.children(&mut node.walk()) {
        match child.kind() {
            "extends_clause" => {
                // Find all type_identifier nodes in extends_clause
                for type_child in child.children(&mut child.walk()) {
                    if type_child.kind() == "type_identifier" || type_child.kind() == "identifier" {
                        let super_class = type_child.utf8_text(source).unwrap_or("").trim();
                        if !super_class.is_empty() {
                            edges.insert((
                                class_id.to_string(),
                                format!("class:{module_path}.{super_class}"),
                                EdgeKind::Extends,
                                super_class.to_string(),
                                false,
                            ));
                        }
                    }
                }
            }
            "implements_clause" => {
                // Find all type_identifier nodes in implements_clause
                for type_child in child.children(&mut child.walk()) {
                    if type_child.kind() == "type_identifier" || type_child.kind() == "identifier" {
                        let interface_name = type_child.utf8_text(source).unwrap_or("").trim();
                        if !interface_name.is_empty() {
                            edges.insert((
                                class_id.to_string(),
                                format!("interface:{module_path}.{interface_name}"),
                                EdgeKind::Implements,
                                interface_name.to_string(),
                                false,
                            ));
                        }
                    }
                }
            }
            _ => {
                // Recursively search in children
                extract_typescript_inheritance(&child, source, class_id, module_path, edges);
            }
        }
    }
}

fn extract_typescript_interface(
    node: Node,
    source: &[u8],
    file_id: &str,
    module_path: &str,
    nodes: &mut BTreeMap<String, GraphNode>,
    _edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let interface_name = find_child_text(node, "type_identifier", source);
    if interface_name.is_empty() {
        return;
    }

    let full_name = format!("{module_path}.{interface_name}");
    let interface_id = format!("interface:{full_name}");

    nodes.entry(interface_id).or_insert_with(|| GraphNode {
        id: format!("interface:{full_name}"),
        path: file_id.to_string(),
        language: "typescript".to_string(),
        kind: NodeKind::Interface,
        name: Some(interface_name),
        package_name: Some(module_path.to_string()),
        parent_id: None,
        start_line: Some(node.start_position().row + 1),
        end_line: Some(node.end_position().row + 1),
    });
}

fn extract_typescript_function(
    node: Node,
    source: &[u8],
    file_id: &str,
    module_path: &str,
    nodes: &mut BTreeMap<String, GraphNode>,
    _edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let fn_name = find_child_text(node, "identifier", source);
    if fn_name.is_empty() {
        return;
    }

    let full_name = format!("{module_path}.{fn_name}");
    let fn_id = format!("function:{full_name}");

    nodes.entry(fn_id).or_insert_with(|| GraphNode {
        id: format!("function:{full_name}"),
        path: file_id.to_string(),
        language: "typescript".to_string(),
        kind: NodeKind::Method,
        name: Some(fn_name),
        package_name: Some(module_path.to_string()),
        parent_id: None,
        start_line: Some(node.start_position().row + 1),
        end_line: Some(node.end_position().row + 1),
    });
}

fn extract_typescript_enum(
    node: Node,
    source: &[u8],
    file_id: &str,
    module_path: &str,
    nodes: &mut BTreeMap<String, GraphNode>,
    _edges: &mut BTreeSet<(String, String, EdgeKind, String, bool)>,
) {
    let enum_name = find_child_text(node, "identifier", source);
    if enum_name.is_empty() {
        return;
    }

    let full_name = format!("{module_path}.{enum_name}");
    let enum_id = format!("enum:{full_name}");

    nodes.entry(enum_id).or_insert_with(|| GraphNode {
        id: format!("enum:{full_name}"),
        path: file_id.to_string(),
        language: "typescript".to_string(),
        kind: NodeKind::Enum,
        name: Some(enum_name),
        package_name: Some(module_path.to_string()),
        parent_id: None,
        start_line: Some(node.start_position().row + 1),
        end_line: Some(node.end_position().row + 1),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn write_file(dir: &TempDir, relative: &str, content: &str) -> PathBuf {
        let path = dir.path().join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
        path
    }

    #[test]
    fn extracts_rust_use_paths() {
        let source = r#"
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use crate::state::AppState;
"#;

        let uses = extract_rust_uses(source);
        assert!(uses.contains(&"std::collections::HashMap".to_string()));
        assert!(uses.contains(&"serde::{Deserialize, Serialize}".to_string()));
        assert!(uses.contains(&"crate::state::AppState".to_string()));
    }

    #[test]
    fn extracts_typescript_imports_and_exports() {
        let source = r#"
import React from "react";
import { helper } from "../lib/paths";
export { feature } from "@/core/feature";
"#;

        let imports = extract_typescript_imports(source);
        assert!(imports.contains(&"react".to_string()));
        assert!(imports.contains(&"../lib/paths".to_string()));
        assert!(imports.contains(&"@/core/feature".to_string()));
    }

    #[test]
    fn resolves_typescript_relative_and_alias_imports_to_repo_files() {
        let dir = TempDir::new().unwrap();
        let importer = write_file(
            &dir,
            "src/app/page.ts",
            r#"import { feature } from "@/core/feature";
import { helper } from "../lib/helper";"#,
        );
        write_file(&dir, "src/core/feature.ts", "export const feature = true;");
        write_file(&dir, "src/lib/helper.ts", "export const helper = true;");

        let alias = resolve_typescript_dependency(dir.path(), &importer, "@/core/feature");
        let relative = resolve_typescript_dependency(dir.path(), &importer, "../lib/helper");

        assert_eq!(
            alias,
            ResolvedDependency::LocalFile("src/core/feature.ts".to_string())
        );
        assert_eq!(
            relative,
            ResolvedDependency::LocalFile("src/lib/helper.ts".to_string())
        );
    }

    #[test]
    fn resolves_workspace_crate_imports_to_local_entry_files() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "crates/alpha/Cargo.toml",
            r#"[package]
name = "alpha"
version = "0.1.0"
edition = "2021"
"#,
        );
        let importer = write_file(
            &dir,
            "crates/alpha/src/lib.rs",
            "use beta::service::run;\nuse crate::state::AppState;\n",
        );
        write_file(&dir, "crates/alpha/src/state.rs", "pub struct AppState;");
        write_file(
            &dir,
            "crates/beta/Cargo.toml",
            r#"[package]
name = "beta"
version = "0.1.0"
edition = "2021"
"#,
        );
        write_file(&dir, "crates/beta/src/lib.rs", "pub mod service;");

        let workspace = build_rust_workspace_context(dir.path());
        let external =
            resolve_rust_dependency(dir.path(), &importer, "beta::service::run", &workspace);
        let internal =
            resolve_rust_dependency(dir.path(), &importer, "crate::state::AppState", &workspace);

        assert_eq!(
            external,
            ResolvedDependency::LocalFile("crates/beta/src/lib.rs".to_string())
        );
        assert_eq!(
            internal,
            ResolvedDependency::LocalFile("crates/alpha/src/state.rs".to_string())
        );
    }

    #[test]
    fn analyzes_typescript_directory_into_graph() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "src/app/page.ts",
            r#"import { feature } from "@/core/feature";
import React from "react";"#,
        );
        write_file(&dir, "src/core/feature.ts", "export const feature = true;");

        let graph = analyze_directory(dir.path(), AnalysisLang::TypeScript, AnalysisDepth::Fast);

        assert!(graph.nodes.iter().any(|node| node.id == "src/app/page.ts"));
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.id == "src/core/feature.ts"));
        assert!(graph.edges.iter().any(|edge| {
            edge.from == "src/app/page.ts" && edge.to == "src/core/feature.ts" && edge.resolved
        }));
    }

    #[test]
    fn renders_dot_output() {
        let graph = DependencyGraph {
            generated_at: "2026-01-01T00:00:00Z".to_string(),
            root_dir: "/tmp".to_string(),
            language: "rust".to_string(),
            node_count: 2,
            edge_count: 1,
            nodes: vec![
                GraphNode {
                    id: "src/main.rs".to_string(),
                    path: "src/main.rs".to_string(),
                    language: "rust".to_string(),
                    kind: NodeKind::File,
                    name: None,
                    package_name: None,
                    parent_id: None,
                    start_line: None,
                    end_line: None,
                },
                GraphNode {
                    id: "serde".to_string(),
                    path: "serde".to_string(),
                    language: "rust".to_string(),
                    kind: NodeKind::ExternalCrate,
                    name: None,
                    package_name: None,
                    parent_id: None,
                    start_line: None,
                    end_line: None,
                },
            ],
            edges: vec![GraphEdge {
                from: "src/main.rs".to_string(),
                to: "serde".to_string(),
                kind: EdgeKind::Uses,
                specifier: "serde::Serialize".to_string(),
                resolved: false,
            }],
        };

        let dot = render_dot(&graph);
        assert!(dot.contains("\"src/main.rs\""));
        assert!(dot.contains("\"serde\""));
        assert!(dot.contains("->"));
    }

    #[test]
    fn analyzes_java_normal_mode_with_methods_and_fields() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "src/main/java/com/example/Person.java",
            r#"package com.example;

public class Person {
    private String name;
    private int age;

    public Person(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}"#,
        );

        let graph = analyze_directory(dir.path(), AnalysisLang::Java, AnalysisDepth::Normal);

        // Should have package, class, constructor, 2 fields, 2 methods, and file
        assert_eq!(graph.node_count, 8);

        // Check package node
        assert!(graph
            .nodes
            .iter()
            .any(|n| n.kind == NodeKind::Package && n.name.as_deref() == Some("com.example")));

        // Check class node
        assert!(graph.nodes.iter().any(|n| n.kind == NodeKind::Class
            && n.name.as_deref() == Some("Person")
            && n.package_name.as_deref() == Some("com.example")));

        // Check constructor
        assert!(graph
            .nodes
            .iter()
            .any(|n| n.kind == NodeKind::Constructor && n.name.as_deref() == Some("Person")));

        // Check methods
        assert!(graph
            .nodes
            .iter()
            .any(|n| n.kind == NodeKind::Method && n.name.as_deref() == Some("getName")));
        assert!(graph
            .nodes
            .iter()
            .any(|n| n.kind == NodeKind::Method && n.name.as_deref() == Some("setName")));

        // Check fields
        assert!(graph
            .nodes
            .iter()
            .any(|n| n.kind == NodeKind::Field && n.name.as_deref() == Some("name")));
        assert!(graph
            .nodes
            .iter()
            .any(|n| n.kind == NodeKind::Field && n.name.as_deref() == Some("age")));

        // Check MADE_OF edges
        let made_of_edges: Vec<_> = graph
            .edges
            .iter()
            .filter(|e| e.kind == EdgeKind::MadeOf)
            .collect();
        assert_eq!(made_of_edges.len(), 6); // Package->Class + Class->(Constructor+2Fields+2Methods)
    }

    #[test]
    fn analyzes_java_normal_mode_with_inheritance() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "src/main/java/com/example/Animal.java",
            r#"package com.example;

public class Animal {
    public void eat() {}
}"#,
        );
        write_file(
            &dir,
            "src/main/java/com/example/Dog.java",
            r#"package com.example;

public class Dog extends Animal {
    public void bark() {}
}"#,
        );

        let graph = analyze_directory(dir.path(), AnalysisLang::Java, AnalysisDepth::Normal);

        // Check EXTENDS edge
        assert!(graph.edges.iter().any(|e| e.kind == EdgeKind::Extends
            && e.from.contains("Dog")
            && e.to.contains("Animal")));
    }

    #[test]
    fn analyzes_java_normal_mode_with_interface() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "src/main/java/com/example/Flyable.java",
            r#"package com.example;

public interface Flyable {
    void fly();
}"#,
        );
        write_file(
            &dir,
            "src/main/java/com/example/Bird.java",
            r#"package com.example;

public class Bird implements Flyable {
    public void fly() {}
}"#,
        );

        let graph = analyze_directory(dir.path(), AnalysisLang::Java, AnalysisDepth::Normal);

        // Check interface node
        assert!(graph
            .nodes
            .iter()
            .any(|n| n.kind == NodeKind::Interface && n.name.as_deref() == Some("Flyable")));

        // Check IMPLEMENTS edge
        assert!(graph.edges.iter().any(|e| e.kind == EdgeKind::Implements
            && e.from.contains("Bird")
            && e.to.contains("Flyable")));
    }

    #[test]
    fn fast_mode_only_extracts_file_level_imports() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "src/main/java/com/example/Test.java",
            r#"package com.example;

import java.util.List;

public class Test {
    private List<String> items;

    public void add(String item) {
        items.add(item);
    }
}"#,
        );

        let graph = analyze_directory(dir.path(), AnalysisLang::Java, AnalysisDepth::Fast);

        // Fast mode: only file and external package nodes
        assert!(graph
            .nodes
            .iter()
            .all(|n| n.kind == NodeKind::File || n.kind == NodeKind::ExternalPackage));

        // No class, method, or field nodes
        assert!(!graph.nodes.iter().any(|n| n.kind == NodeKind::Class));
        assert!(!graph.nodes.iter().any(|n| n.kind == NodeKind::Method));
        assert!(!graph.nodes.iter().any(|n| n.kind == NodeKind::Field));
    }

    #[test]
    fn normal_mode_extracts_import_dependencies() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "src/main/java/com/example/Service.java",
            r#"package com.example;

import java.util.List;
import java.util.ArrayList;
import javax.servlet.http.HttpServlet;

public class Service {
    private List<String> items = new ArrayList<>();
}"#,
        );

        let graph = analyze_directory(dir.path(), AnalysisLang::Java, AnalysisDepth::Normal);

        // Should have DEPENDS_ON edges
        let depends_on_edges: Vec<_> = graph
            .edges
            .iter()
            .filter(|e| e.kind == EdgeKind::DependsOn)
            .collect();

        assert!(depends_on_edges.len() >= 2); // At least java.util dependencies

        // Check that external packages are created
        assert!(graph
            .nodes
            .iter()
            .any(|n| n.kind == NodeKind::Package && n.name.as_deref() == Some("java.util")));
        assert!(graph.nodes.iter().any(
            |n| n.kind == NodeKind::Package && n.name.as_deref() == Some("javax.servlet.http")
        ));

        // Check specific DEPENDS_ON edge
        assert!(depends_on_edges
            .iter()
            .any(|e| e.from.contains("com.example") && e.to.contains("java.util")));
    }
}
