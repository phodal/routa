use super::parse_changed_files;
use std::fs;
use tempfile::tempdir;

#[test]
fn parses_java_class_and_test_method_nodes() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src/main/java/com/example")).unwrap();
    fs::create_dir_all(root.join("src/test/java/com/example")).unwrap();
    fs::write(
        root.join("src/main/java/com/example/Service.java"),
        "package com.example;\nclass Service {\n  String run() { return \"ok\"; }\n}\n",
    )
    .unwrap();
    fs::write(
        root.join("src/test/java/com/example/ServiceTest.java"),
        "package com.example;\nclass ServiceTest {\n  @Test\n  void testRun() { new Service().run(); }\n}\n",
    )
    .unwrap();

    let graph = parse_changed_files(
        root,
        &["src/main/java/com/example/Service.java".to_string()],
    );

    assert!(graph
        .changed_nodes
        .iter()
        .any(|node| node.qualified_name
            == "src/main/java/com/example/Service.java:com.example.Service"));
    assert!(graph.related_test_nodes.iter().any(|node| {
        node.qualified_name
            == "src/test/java/com/example/ServiceTest.java:com.example.ServiceTest.testRun"
            && node.is_test
    }));
    assert!(graph.graph_edges.iter().any(|edge| {
        edge.kind == "TESTED_BY"
            && edge.source_qualified
                == "src/test/java/com/example/ServiceTest.java:com.example.ServiceTest.testRun"
    }));
}

#[test]
fn parses_go_types_functions_and_methods() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("pkg/demo")).unwrap();
    fs::write(
        root.join("pkg/demo/service.go"),
        "package demo\n\ntype Service struct{}\n\nfunc (s *Service) Run() int { return 1 }\n",
    )
    .unwrap();

    let graph = parse_changed_files(root, &["pkg/demo/service.go".to_string()]);

    assert!(graph
        .changed_nodes
        .iter()
        .any(|node| node.qualified_name == "pkg/demo/service.go:Service"));
    assert!(graph
        .changed_nodes
        .iter()
        .any(|node| node.qualified_name == "pkg/demo/service.go:Service.Run"));
}
