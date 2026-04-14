use super::{
    analyze_impact, query_current_graph, GraphNodePayload, ImpactOptions, ReviewBuildMode,
};
use std::fs;
use tempfile::tempdir;

#[test]
fn query_current_graph_parses_python_and_tracks_import_impact() {
    let temp = tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/service.py"),
        "def run():\n    return helper()\n\n\ndef helper():\n    return 1\n",
    )
    .unwrap();
    fs::write(
        root.join("src/consumer.py"),
        "from .service import run\n\n\ndef consume():\n    return run()\n",
    )
    .unwrap();
    fs::write(
        root.join("src/test_service.py"),
        "from .service import run\n\n\ndef test_run():\n    assert run() == 1\n",
    )
    .unwrap();

    let impact = analyze_impact(
        root,
        &["src/service.py".to_string()],
        ImpactOptions {
            base: "HEAD",
            build_mode: ReviewBuildMode::Auto,
            max_depth: 1,
            max_impacted_files: 200,
        },
    );
    let tests = query_current_graph(
        root,
        "src/service.py:run",
        "tests_for",
        ReviewBuildMode::Auto,
    );

    assert_eq!(impact.status, "ok");
    assert_eq!(
        impact.impacted_files,
        vec!["src/test_service.py".to_string()]
    );
    assert_eq!(tests.status, "ok");
    assert_eq!(tests.results.len(), 1);
    assert!(matches!(
        &tests.results[0],
        GraphNodePayload::Symbol(node) if node.qualified_name == "src/test_service.py:test_run"
    ));
}
