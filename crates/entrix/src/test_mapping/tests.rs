use super::*;
use tempfile::tempdir;

#[test]
fn typescript_resolver_marks_changed_when_matching_test_is_also_dirty() {
    let temp = tempdir().expect("tempdir");
    let repo_root = temp.path();
    fs::create_dir_all(repo_root.join("src/core/skills/__tests__")).expect("create test dir");
    fs::write(
        repo_root.join("src/core/skills/skill-loader.ts"),
        "export function load() {}\n",
    )
    .expect("write source");
    fs::write(
        repo_root.join("src/core/skills/__tests__/skill-loader.test.ts"),
        "test('load', () => {})\n",
    )
    .expect("write test");

    let report = analyze_changed_files(
        repo_root,
        &[
            "src/core/skills/skill-loader.ts".to_string(),
            "src/core/skills/__tests__/skill-loader.test.ts".to_string(),
        ],
    );

    assert_eq!(
        report.skipped_test_files,
        vec!["src/core/skills/__tests__/skill-loader.test.ts"]
    );
    assert_eq!(report.mappings.len(), 1);
    let mapping = &report.mappings[0];
    assert_eq!(mapping.language, "typescript");
    assert_eq!(mapping.status, TestMappingStatus::Changed);
    assert_eq!(
        mapping.related_test_files,
        vec!["src/core/skills/__tests__/skill-loader.test.ts"]
    );
    assert_eq!(report.status_counts.get("changed"), Some(&1));
    assert_eq!(report.resolver_counts.get("path_heuristic"), Some(&1));
}

#[test]
fn rust_resolver_marks_inline_tests() {
    let temp = tempdir().expect("tempdir");
    let repo_root = temp.path();
    fs::create_dir_all(repo_root.join("crates/demo/src")).expect("create src dir");
    fs::write(
        repo_root.join("crates/demo/Cargo.toml"),
        "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n",
    )
    .expect("write cargo");
    fs::write(
        repo_root.join("crates/demo/src/pty.rs"),
        "pub fn run() {}\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn works() {}\n}\n",
    )
    .expect("write source");

    let report = analyze_changed_files(repo_root, &["crates/demo/src/pty.rs".to_string()]);

    let mapping = &report.mappings[0];
    assert_eq!(mapping.language, "rust");
    assert_eq!(mapping.status, TestMappingStatus::Inline);
    assert!(mapping.has_inline_tests);
    assert_eq!(report.status_counts.get("inline"), Some(&1));
    assert_eq!(report.resolver_counts.get("inline_test"), Some(&1));
}

#[test]
fn rust_resolver_finds_sibling_tests_for_mod_rs() {
    let temp = tempdir().expect("tempdir");
    let repo_root = temp.path();
    fs::create_dir_all(repo_root.join("crates/demo/src/commands/fitness/fluency"))
        .expect("create src dir");
    fs::write(
        repo_root.join("crates/demo/Cargo.toml"),
        "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n",
    )
    .expect("write cargo");
    fs::write(
        repo_root.join("crates/demo/src/commands/fitness/fluency/mod.rs"),
        "pub fn report() {}\n",
    )
    .expect("write mod");
    fs::write(
        repo_root.join("crates/demo/src/commands/fitness/fluency/tests_projection.rs"),
        "#[test]\nfn projection() {}\n",
    )
    .expect("write sibling tests");

    let report = analyze_changed_files(
        repo_root,
        &["crates/demo/src/commands/fitness/fluency/mod.rs".to_string()],
    );

    let mapping = &report.mappings[0];
    assert_eq!(mapping.status, TestMappingStatus::Exists);
    assert_eq!(
        mapping.related_test_files,
        vec!["crates/demo/src/commands/fitness/fluency/tests_projection.rs"]
    );
}

#[test]
fn java_resolver_marks_missing_for_standard_src_main_layout_without_tests() {
    let temp = tempdir().expect("tempdir");
    let repo_root = temp.path();
    fs::create_dir_all(repo_root.join("src/main/java/com/example")).expect("create java dir");
    fs::write(
        repo_root.join("src/main/java/com/example/OrderService.java"),
        "class OrderService {}\n",
    )
    .expect("write java source");

    let report = analyze_changed_files(
        repo_root,
        &["src/main/java/com/example/OrderService.java".to_string()],
    );

    let mapping = &report.mappings[0];
    assert_eq!(mapping.language, "java");
    assert_eq!(mapping.status, TestMappingStatus::Missing);
    assert!(mapping.related_test_files.is_empty());
    assert_eq!(report.status_counts.get("missing"), Some(&1));
    assert_eq!(report.resolver_counts.get("path_heuristic"), Some(&1));
}

#[test]
fn graph_enrichment_upgrades_mapping_and_merges_related_tests() {
    let temp = tempdir().expect("tempdir");
    let repo_root = temp.path();
    let source_dir = repo_root.join("src");
    let tests_dir = source_dir.join("__tests__");
    fs::create_dir_all(&tests_dir).expect("create test dir");
    fs::write(source_dir.join("service.ts"), "export function run() {}\n").expect("write source");
    fs::write(
        tests_dir.join("service.extra.test.ts"),
        "it('works', () => {})\n",
    )
    .expect("write graph test");

    let registry = ResolverRegistry::default();
    let report = registry.analyze_changed_files_with_graph(
        repo_root,
        &["src/service.ts".to_string()],
        &BTreeMap::from([(
            "src/service.ts".to_string(),
            vec!["src/__tests__/service.extra.test.ts".to_string()],
        )]),
    );

    assert_eq!(report.mappings.len(), 1);
    let mapping = &report.mappings[0];
    assert_eq!(mapping.status, TestMappingStatus::Exists);
    assert_eq!(mapping.resolver_kind, ResolverKind::SemanticGraph);
    assert_eq!(mapping.confidence, Confidence::High);
    assert_eq!(
        mapping.graph_test_files,
        vec!["src/__tests__/service.extra.test.ts".to_string()]
    );
    assert_eq!(
        mapping.related_test_files,
        vec!["src/__tests__/service.extra.test.ts".to_string()]
    );
    assert_eq!(report.status_counts.get("exists"), Some(&1));
    assert_eq!(report.resolver_counts.get("semantic_graph"), Some(&1));
}
