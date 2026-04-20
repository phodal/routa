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
    let external = resolve_rust_dependency(dir.path(), &importer, "beta::service::run", &workspace);
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

    assert_eq!(graph.node_count, 8);
    assert!(graph
        .nodes
        .iter()
        .any(|n| n.kind == NodeKind::Package && n.name.as_deref() == Some("com.example")));
    assert!(graph.nodes.iter().any(|n| n.kind == NodeKind::Class
        && n.name.as_deref() == Some("Person")
        && n.package_name.as_deref() == Some("com.example")));
    assert!(graph
        .nodes
        .iter()
        .any(|n| n.kind == NodeKind::Constructor && n.name.as_deref() == Some("Person")));
    assert!(graph
        .nodes
        .iter()
        .any(|n| n.kind == NodeKind::Method && n.name.as_deref() == Some("getName")));
    assert!(graph
        .nodes
        .iter()
        .any(|n| n.kind == NodeKind::Method && n.name.as_deref() == Some("setName")));
    assert!(graph
        .nodes
        .iter()
        .any(|n| n.kind == NodeKind::Field && n.name.as_deref() == Some("name")));
    assert!(graph
        .nodes
        .iter()
        .any(|n| n.kind == NodeKind::Field && n.name.as_deref() == Some("age")));

    let made_of_edges: Vec<_> = graph
        .edges
        .iter()
        .filter(|e| e.kind == EdgeKind::MadeOf)
        .collect();
    assert_eq!(made_of_edges.len(), 6);
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

    assert!(graph
        .edges
        .iter()
        .any(|e| e.kind == EdgeKind::Extends && e.from.contains("Dog") && e.to.contains("Animal")));
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

    assert!(graph
        .nodes
        .iter()
        .any(|n| n.kind == NodeKind::Interface && n.name.as_deref() == Some("Flyable")));
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

    assert!(graph
        .nodes
        .iter()
        .all(|n| n.kind == NodeKind::File || n.kind == NodeKind::ExternalPackage));
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

    let depends_on_edges: Vec<_> = graph
        .edges
        .iter()
        .filter(|e| e.kind == EdgeKind::DependsOn)
        .collect();

    assert!(depends_on_edges.len() >= 2);
    assert!(graph
        .nodes
        .iter()
        .any(|n| n.kind == NodeKind::Package && n.name.as_deref() == Some("java.util")));
    assert!(graph
        .nodes
        .iter()
        .any(|n| n.kind == NodeKind::Package && n.name.as_deref() == Some("javax.servlet.http")));
    assert!(depends_on_edges
        .iter()
        .any(|e| e.from.contains("com.example") && e.to.contains("java.util")));
}
