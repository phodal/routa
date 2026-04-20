use serde::Serialize;
#[derive(Debug, Clone)]
pub struct ParsedReviewGraph {
    pub changed_nodes: Vec<ChangedNode>,
    pub related_test_nodes: Vec<ChangedNode>,
    pub impacted_nodes: Vec<ChangedNode>,
    pub graph_edges: Vec<GraphEdge>,
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
pub struct GraphEdge {
    pub kind: &'static str,
    pub source_qualified: String,
    pub target_qualified: String,
    pub file_path: String,
    pub source_file: String,
    pub target_file: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewContextReport {
    pub status: String,
    pub analysis_mode: String,
    pub summary: String,
    pub base: String,
    pub context: ReviewContextPayload,
    pub build: ReviewBuildInfo,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImpactAnalysisReport {
    pub status: String,
    pub summary: String,
    pub base: String,
    pub changed_files: Vec<String>,
    pub skipped_files: Vec<String>,
    pub changed_nodes: Vec<GraphNodePayload>,
    pub impacted_nodes: Vec<GraphNodePayload>,
    pub impacted_files: Vec<String>,
    pub impacted_test_files: Vec<String>,
    pub edges: Vec<GraphEdge>,
    pub wide_blast_radius: bool,
    pub build: ReviewBuildInfo,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestRadiusReport {
    pub status: String,
    pub analysis_mode: String,
    pub summary: String,
    pub base: String,
    pub changed_files: Vec<String>,
    pub skipped_files: Vec<String>,
    pub changed_nodes: Vec<GraphNodePayload>,
    pub impacted_nodes: Vec<GraphNodePayload>,
    pub impacted_files: Vec<String>,
    pub impacted_test_files: Vec<String>,
    pub target_nodes: Vec<ReviewTarget>,
    pub query_failures: Vec<QueryFailure>,
    pub tests: Vec<SymbolGraphNode>,
    pub test_files: Vec<String>,
    pub untested_targets: Vec<UntestedTarget>,
    pub wide_blast_radius: bool,
    pub build: ReviewBuildInfo,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryFailure {
    pub qualified_name: String,
    pub status: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphQueryReport {
    pub status: String,
    pub pattern: String,
    pub target: String,
    pub summary: String,
    pub results: Vec<GraphNodePayload>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalyzeFileReport {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_test_file: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imports: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbols: Option<Vec<SymbolGraphNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_basename: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphBuildReport {
    pub status: String,
    pub backend: Option<String>,
    pub build_type: Option<String>,
    pub summary: String,
    pub files_updated: Option<usize>,
    pub changed_files: Option<Vec<String>>,
    pub stale_files: Option<Vec<String>>,
    pub total_nodes: Option<usize>,
    pub total_edges: Option<usize>,
    pub languages: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphStatsReport {
    pub status: String,
    pub nodes: usize,
    pub edges: usize,
    pub files: usize,
    pub languages: Vec<String>,
    pub backend: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommitHistoryEntry {
    pub commit: String,
    pub short_commit: String,
    pub subject: String,
    pub raw_changed_files: Vec<String>,
    pub changed_files: Vec<String>,
    pub changed_file_count: usize,
    pub target_count: usize,
    pub test_file_count: usize,
    pub untested_target_count: usize,
    pub wide_blast_radius: bool,
    pub summary: String,
    pub test_files: Vec<String>,
    pub untested_targets: Vec<UntestedTarget>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphHistoryReport {
    pub status: String,
    pub analysis_mode: String,
    pub summary: String,
    pub r#ref: String,
    pub build: GraphBuildReport,
    pub commits: Vec<CommitHistoryEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewContextPayload {
    pub changed_files: Vec<String>,
    pub impacted_files: Vec<String>,
    pub graph: GraphContext,
    pub targets: Vec<ReviewTarget>,
    pub tests: ReviewTests,
    pub review_guidance: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_snippets: Option<Vec<SourceSnippet>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphContext {
    pub changed_nodes: Vec<GraphNodePayload>,
    pub impacted_nodes: Vec<GraphNodePayload>,
    pub edges: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewTarget {
    pub qualified_name: String,
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub tests: Vec<SymbolGraphNode>,
    pub tests_count: usize,
    pub inherited_tests: Vec<SymbolGraphNode>,
    pub inherited_tests_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewTests {
    pub test_files: Vec<String>,
    pub untested_targets: Vec<UntestedTarget>,
    pub query_failures: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UntestedTarget {
    pub qualified_name: String,
    pub kind: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceSnippet {
    pub file_path: String,
    pub line_count: usize,
    pub truncated: bool,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewBuildInfo {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_type: Option<String>,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_updated: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_files: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stale_files: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_nodes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_edges: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub languages: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy)]
pub struct ReviewContextOptions<'a> {
    pub base: &'a str,
    pub include_source: bool,
    pub max_files: usize,
    pub max_lines_per_file: usize,
    pub build_mode: ReviewBuildMode,
    pub max_depth: usize,
    pub max_targets: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct ImpactOptions<'a> {
    pub base: &'a str,
    pub build_mode: ReviewBuildMode,
    pub max_depth: usize,
    pub max_impacted_files: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct TestRadiusOptions<'a> {
    pub base: &'a str,
    pub build_mode: ReviewBuildMode,
    pub max_depth: usize,
    pub max_targets: usize,
    pub max_impacted_files: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewBuildMode {
    Auto,
    Full,
    Skip,
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
