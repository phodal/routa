use crate::evidence::load_dimensions;
use crate::governance::{filter_dimensions, GovernancePolicy};
use crate::model::{ExecutionScope, FitnessReport, Tier};
use crate::reporting::report_to_dict;
use crate::review_context::{analyze_impact, ImpactOptions, ReviewBuildMode};
use crate::review_trigger::collect_changed_files;
use crate::run_support::{run_metric_batch, RunMetricBatchOptions};
use crate::runner::ShellRunner;
use crate::sarif::SarifRunner;
use crate::scoring::{score_dimension, score_report};
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Content, ErrorData, Implementation, ServerCapabilities, ServerInfo},
    schemars,
    schemars::JsonSchema,
    tool, tool_handler, tool_router, ServerHandler, ServiceExt,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct EntrixMcpServer {
    project_root: PathBuf,
    tool_router: ToolRouter<Self>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
pub struct RunFitnessRequest {
    pub tier: Option<String>,
    pub scope: Option<String>,
    #[serde(default)]
    pub parallel: bool,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default = "default_min_score")]
    pub min_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct GetDimensionStatusRequest {
    pub dimension: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
pub struct AnalyzeChangeImpactRequest {
    pub changed_files: Option<Vec<String>>,
    #[serde(default = "default_depth")]
    pub depth: usize,
    #[serde(default = "default_base")]
    pub base: String,
}

fn default_min_score() -> f64 {
    80.0
}

fn default_depth() -> usize {
    2
}

fn default_base() -> String {
    "HEAD".to_string()
}

#[tool_router]
impl EntrixMcpServer {
    pub fn new(project_root: impl Into<PathBuf>) -> Self {
        Self {
            project_root: project_root.into(),
            tool_router: Self::tool_router(),
        }
    }

    #[tool(description = "Run fitness checks and return a structured report.")]
    async fn run_fitness(
        &self,
        Parameters(request): Parameters<RunFitnessRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let report = run_fitness_report_json(
            &self.project_root,
            request.tier.as_deref(),
            request.scope.as_deref(),
            request.parallel,
            request.dry_run,
            request.min_score,
        )?;
        Ok(json_tool_result(report))
    }

    #[tool(description = "Get current status of a specific fitness dimension.")]
    async fn get_dimension_status(
        &self,
        Parameters(request): Parameters<GetDimensionStatusRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let report = dimension_status_json(&self.project_root, &request.dimension)?;
        Ok(json_tool_result(report))
    }

    #[tool(description = "Analyze blast radius of changes using the code graph.")]
    async fn analyze_change_impact(
        &self,
        Parameters(request): Parameters<AnalyzeChangeImpactRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let report = analyze_change_impact_json(
            &self.project_root,
            request.changed_files,
            request.depth,
            &request.base,
        );
        Ok(json_tool_result(report))
    }
}

#[tool_handler]
impl ServerHandler for EntrixMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            server_info: Implementation {
                name: "entrix".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                title: None,
                description: None,
                icons: None,
                website_url: None,
            },
            instructions: Some("Evolutionary architecture fitness engine".to_string()),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

pub async fn serve_stdio(project_root: impl AsRef<Path>) -> Result<(), String> {
    let server = EntrixMcpServer::new(project_root.as_ref());
    let service = server
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|error| error.to_string())?;
    service.waiting().await.map_err(|error| error.to_string())?;
    Ok(())
}

fn json_tool_result(payload: Value) -> CallToolResult {
    let text = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string());
    CallToolResult::success(vec![Content::text(text)])
}

fn run_fitness_report_json(
    project_root: &Path,
    tier: Option<&str>,
    scope: Option<&str>,
    parallel: bool,
    dry_run: bool,
    min_score: f64,
) -> Result<Value, ErrorData> {
    let fitness_dir = project_root.join("docs/fitness");
    let all_dimensions = load_dimensions(&fitness_dir);
    let policy = GovernancePolicy {
        tier_filter: tier.and_then(Tier::from_str_opt),
        parallel,
        dry_run,
        verbose: false,
        min_score,
        fail_on_hard_gate: true,
        execution_scope: scope.and_then(parse_execution_scope),
        dimension_filters: Vec::new(),
        metric_filters: Vec::new(),
    };

    let dimensions = filter_dimensions(&all_dimensions, &policy);
    if dimensions.is_empty() {
        return Ok(report_to_dict(&FitnessReport::default()));
    }

    let shell_runner = ShellRunner::new(project_root);
    let sarif_runner = SarifRunner::new(project_root);
    let mut dimension_scores = Vec::new();
    for dimension in &dimensions {
        let results = run_metric_batch(
            project_root,
            &dimension.metrics,
            &shell_runner,
            &sarif_runner,
            RunMetricBatchOptions {
                dry_run: policy.dry_run,
                parallel: policy.parallel,
                changed_files: &[],
                base: "HEAD",
                progress_callback: None,
                deadline: None,
            },
        );
        dimension_scores.push(score_dimension(&results, &dimension.name, dimension.weight));
    }

    Ok(report_to_dict(&score_report(
        &dimension_scores,
        policy.min_score,
    )))
}

fn dimension_status_json(project_root: &Path, dimension_name: &str) -> Result<Value, ErrorData> {
    let report = run_fitness_report_json(project_root, None, None, false, false, 80.0)?;
    let Some(dimensions) = report.get("dimensions").and_then(Value::as_array) else {
        return Ok(json!({ "error": format!("Dimension '{dimension_name}' not found") }));
    };

    let matching = dimensions.iter().find(|dimension| {
        dimension
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|name| name == dimension_name)
    });

    if let Some(dimension) = matching {
        return Ok(json!({
            "final_score": report.get("final_score").cloned().unwrap_or(Value::Null),
            "name": dimension.get("name").cloned().unwrap_or(Value::Null),
            "weight": dimension.get("weight").cloned().unwrap_or(Value::Null),
            "score": dimension.get("score").cloned().unwrap_or(Value::Null),
            "passed": dimension.get("passed").cloned().unwrap_or(Value::Null),
            "total": dimension.get("total").cloned().unwrap_or(Value::Null),
            "hard_gate_failures": dimension.get("hard_gate_failures").cloned().unwrap_or_else(|| json!([])),
            "results": dimension.get("results").cloned().unwrap_or_else(|| json!([])),
        }));
    }

    Ok(json!({ "error": format!("Dimension '{dimension_name}' not found") }))
}

fn analyze_change_impact_json(
    project_root: &Path,
    changed_files: Option<Vec<String>>,
    depth: usize,
    base: &str,
) -> Value {
    let effective_changed_files =
        changed_files.unwrap_or_else(|| collect_changed_files(project_root, base));
    let result = analyze_impact(
        project_root,
        &effective_changed_files,
        ImpactOptions {
            base,
            build_mode: ReviewBuildMode::Auto,
            max_depth: depth,
            max_impacted_files: 200,
        },
    );

    json!({
        "status": "ok",
        "passed": !result.wide_blast_radius,
        "output": format!(
            "graph_probe_status: {}\ngraph_changed_files: {}\ngraph_impacted_files: {}\ngraph_impacted_test_files: {}\ngraph_wide_blast_radius: {}\ngraph_summary: {}",
            result.status,
            result.changed_files.len(),
            result.impacted_files.len(),
            result.impacted_test_files.len(),
            if result.wide_blast_radius { "yes" } else { "no" },
            result.summary,
        ),
    })
}

fn parse_execution_scope(value: &str) -> Option<ExecutionScope> {
    match value {
        "local" => Some(ExecutionScope::Local),
        "ci" => Some(ExecutionScope::Ci),
        "staging" => Some(ExecutionScope::Staging),
        "prod_observation" => Some(ExecutionScope::ProdObservation),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn parse_execution_scope_accepts_python_values() {
        assert_eq!(parse_execution_scope("local"), Some(ExecutionScope::Local));
        assert_eq!(parse_execution_scope("ci"), Some(ExecutionScope::Ci));
        assert_eq!(
            parse_execution_scope("prod_observation"),
            Some(ExecutionScope::ProdObservation)
        );
        assert_eq!(parse_execution_scope("unknown"), None);
    }

    #[test]
    fn run_fitness_report_json_matches_expected_shape() {
        let tmp = tempfile::tempdir().unwrap();
        let fitness_dir = tmp.path().join("docs/fitness");
        fs::create_dir_all(&fitness_dir).unwrap();
        fs::write(
            fitness_dir.join("code-quality.md"),
            r#"---
dimension: code_quality
weight: 100
metrics:
  - name: lint_pass
    command: echo ok
    pattern: ok
    hard_gate: true
    tier: fast
---
"#,
        )
        .unwrap();

        let payload =
            run_fitness_report_json(tmp.path(), Some("fast"), None, false, true, 80.0).unwrap();
        assert_eq!(payload["final_score"], 100.0);
        assert_eq!(payload["dimensions"][0]["name"], "code_quality");
        assert_eq!(payload["dimensions"][0]["results"][0]["name"], "lint_pass");
        assert_eq!(payload["dimensions"][0]["results"][0]["state"], "pass");
        assert_eq!(payload["dimensions"][0]["results"][0]["tier"], "fast");
        assert_eq!(payload["dimensions"][0]["results"][0]["hard_gate"], true);
    }

    #[test]
    fn dimension_status_json_returns_error_for_missing_dimension() {
        let tmp = tempfile::tempdir().unwrap();
        let payload = dimension_status_json(tmp.path(), "missing").unwrap();
        assert_eq!(payload["error"], "Dimension 'missing' not found");
    }

    #[test]
    fn analyze_change_impact_json_returns_probe_payload() {
        let tmp = tempfile::tempdir().unwrap();
        let src_dir = tmp.path().join("src");
        fs::create_dir_all(&src_dir).unwrap();
        fs::write(
            src_dir.join("service.ts"),
            "export function run() { return helper(); }\nfunction helper() { return 1; }\n",
        )
        .unwrap();

        let payload = analyze_change_impact_json(
            tmp.path(),
            Some(vec!["src/service.ts".to_string()]),
            2,
            "HEAD",
        );
        assert_eq!(payload["status"], "ok");
        assert!(payload["passed"].is_boolean());
        let output = payload["output"].as_str().unwrap();
        assert!(output.contains("graph_probe_status: ok"));
        assert!(output.contains("graph_changed_files: 1"));
        assert!(output.contains("graph_summary:"));
    }
}
