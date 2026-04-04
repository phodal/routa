use clap::{Args, ValueEnum};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Args, Clone, Debug)]
pub struct ArchDslPocArgs {
    /// Repository root to inspect. Defaults to the current git toplevel.
    #[arg(long)]
    pub repo_root: Option<String>,

    /// Path to the architecture-rule DSL YAML file.
    #[arg(long, default_value = "architecture/rules/backend-core.archdsl.yaml")]
    pub dsl: String,

    /// Output format.
    #[arg(long, value_enum, default_value_t = ArchDslOutputFormat::Text)]
    pub format: ArchDslOutputFormat,

    /// Shortcut for `--format json`.
    #[arg(long, default_value_t = false)]
    pub json: bool,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum ArchDslOutputFormat {
    Text,
    Json,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
struct ArchitectureDslDocument {
    schema: String,
    model: ArchitectureDslModel,
    #[serde(default)]
    defaults: ArchitectureDslDefaults,
    selectors: BTreeMap<String, ArchitectureDslSelector>,
    rules: Vec<ArchitectureDslRule>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
struct ArchitectureDslModel {
    id: String,
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    owners: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
struct ArchitectureDslDefaults {
    #[serde(default)]
    root: Option<String>,
    #[serde(default)]
    exclude: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
struct ArchitectureDslSelector {
    kind: SelectorKind,
    language: SelectorLanguage,
    #[serde(default)]
    description: Option<String>,
    include: Vec<String>,
    #[serde(default)]
    exclude: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum SelectorKind {
    Files,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum SelectorLanguage {
    Typescript,
    Rust,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
struct ArchitectureDslRule {
    id: String,
    title: String,
    #[serde(default)]
    message_key: Option<String>,
    kind: RuleKind,
    suite: SuiteName,
    severity: Severity,
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    scope: Option<String>,
    relation: RuleRelation,
    #[serde(default)]
    engine_hints: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RuleKind {
    Dependency,
    Cycle,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum SuiteName {
    Boundaries,
    Cycles,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Severity {
    Advisory,
    Warning,
    Error,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RuleRelation {
    MustNotDependOn,
    MustBeAcyclic,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct ArchitectureDslReport {
    report_type: String,
    generated_at: String,
    repo_root: String,
    dsl_path: String,
    schema: String,
    model: ArchitectureDslModelSummary,
    defaults: ArchitectureDslDefaultsSummary,
    summary: ArchitectureDslSummary,
    selectors: Vec<ArchitectureDslSelectorPlan>,
    rules: Vec<ArchitectureDslRulePlan>,
    issues: Vec<ArchitectureDslIssue>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct ArchitectureDslModelSummary {
    id: String,
    title: String,
    description: Option<String>,
    owners: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct ArchitectureDslDefaultsSummary {
    root: Option<String>,
    exclude: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct ArchitectureDslSummary {
    validation_status: ValidationStatus,
    plan_status: PlanStatus,
    selector_count: usize,
    rule_count: usize,
    executable_rule_count: usize,
    unsupported_rule_count: usize,
    issue_count: usize,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ValidationStatus {
    Pass,
    Fail,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum PlanStatus {
    Ready,
    Partial,
    Blocked,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct ArchitectureDslSelectorPlan {
    id: String,
    kind: SelectorKind,
    language: SelectorLanguage,
    include: Vec<String>,
    exclude: Vec<String>,
    description: Option<String>,
    supported_for_current_executor: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct ArchitectureDslRulePlan {
    id: String,
    title: String,
    message_key: Option<String>,
    kind: RuleKind,
    suite: SuiteName,
    severity: Severity,
    relation: RuleRelation,
    references: Vec<String>,
    executor: Option<String>,
    status: RulePlanStatus,
    compiled_expression: Option<String>,
    unsupported_reason: Option<String>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RulePlanStatus {
    Ready,
    Unsupported,
    Invalid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct ArchitectureDslIssue {
    code: String,
    path: String,
    message: String,
}

pub(super) fn run(args: &ArchDslPocArgs) -> Result<(), String> {
    let repo_root = super::resolve_repo_root(args.repo_root.as_deref())?;
    let dsl_path = resolve_dsl_path(args, &repo_root)?;
    let report = evaluate_architecture_dsl(&repo_root, &dsl_path)?;

    match resolved_output_format(args) {
        ArchDslOutputFormat::Text => {
            println!("{}", format_text_report(&report));
        }
        ArchDslOutputFormat::Json => {
            println!(
                "{}",
                serde_json::to_string_pretty(&report).map_err(|error| format!(
                    "failed to serialize architecture DSL report: {error}"
                ))?
            );
        }
    }

    Ok(())
}

fn resolved_output_format(args: &ArchDslPocArgs) -> ArchDslOutputFormat {
    if args.json {
        ArchDslOutputFormat::Json
    } else {
        args.format
    }
}

fn resolve_dsl_path(args: &ArchDslPocArgs, repo_root: &Path) -> Result<PathBuf, String> {
    let candidate = super::resolve_requested_path(args.dsl.as_str(), repo_root);
    validate_dsl_path(candidate)
}

fn validate_dsl_path(dsl_path: PathBuf) -> Result<PathBuf, String> {
    let metadata = fs::metadata(&dsl_path)
        .map_err(|error| format!("dsl path does not exist: {} ({error})", dsl_path.display()))?;
    if !metadata.is_file() {
        return Err(format!("dsl path is not a file: {}", dsl_path.display()));
    }

    Ok(dsl_path)
}

fn evaluate_architecture_dsl(
    repo_root: &Path,
    dsl_path: &Path,
) -> Result<ArchitectureDslReport, String> {
    let document = load_architecture_dsl(dsl_path)?;
    let issues = validate_architecture_dsl(&document);
    let selectors = summarize_selectors(&document.selectors);
    let rules = compile_rules(&document, &issues);
    let warnings = build_warnings(&document);
    let selector_count = selectors.len();
    let rule_count = rules.len();
    let executable_rule_count = rules
        .iter()
        .filter(|rule| rule.status == RulePlanStatus::Ready)
        .count();
    let unsupported_rule_count = rules
        .iter()
        .filter(|rule| rule.status == RulePlanStatus::Unsupported)
        .count();
    let issue_count = issues.len();
    let validation_status = if issue_count == 0 {
        ValidationStatus::Pass
    } else {
        ValidationStatus::Fail
    };
    let plan_status = if issue_count > 0 {
        PlanStatus::Blocked
    } else if unsupported_rule_count > 0 {
        PlanStatus::Partial
    } else {
        PlanStatus::Ready
    };

    Ok(ArchitectureDslReport {
        report_type: "architecture_dsl_poc".to_string(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        repo_root: repo_root.display().to_string(),
        dsl_path: dsl_path.display().to_string(),
        schema: document.schema,
        model: ArchitectureDslModelSummary {
            id: document.model.id,
            title: document.model.title,
            description: document.model.description,
            owners: document.model.owners,
        },
        defaults: ArchitectureDslDefaultsSummary {
            root: document.defaults.root,
            exclude: document.defaults.exclude,
        },
        summary: ArchitectureDslSummary {
            validation_status,
            plan_status,
            selector_count,
            rule_count,
            executable_rule_count,
            unsupported_rule_count,
            issue_count,
        },
        selectors,
        rules,
        issues,
        warnings,
    })
}

fn load_architecture_dsl(dsl_path: &Path) -> Result<ArchitectureDslDocument, String> {
    let raw = fs::read_to_string(dsl_path)
        .map_err(|error| format!("unable to read {}: {error}", dsl_path.display()))?;
    serde_yaml::from_str::<ArchitectureDslDocument>(&raw)
        .map_err(|error| format!("unable to parse {}: {error}", dsl_path.display()))
}

fn validate_architecture_dsl(document: &ArchitectureDslDocument) -> Vec<ArchitectureDslIssue> {
    let mut issues = Vec::new();

    if document.schema.trim() != "routa.archdsl/v1" {
        issues.push(issue(
            "schema",
            "schema",
            format!("unsupported schema '{}'", document.schema),
        ));
    }

    if document.model.id.trim().is_empty() {
        issues.push(issue(
            "model.id",
            "model.id",
            "model id is required".to_string(),
        ));
    }

    if document.model.title.trim().is_empty() {
        issues.push(issue(
            "model.title",
            "model.title",
            "model title is required".to_string(),
        ));
    }

    if document.rules.is_empty() {
        issues.push(issue(
            "rules.empty",
            "rules",
            "at least one rule is required".to_string(),
        ));
    }

    if document.selectors.is_empty() {
        issues.push(issue(
            "selectors.empty",
            "selectors",
            "at least one selector is required".to_string(),
        ));
    }

    let selector_ids: BTreeSet<String> = document.selectors.keys().cloned().collect();
    for (selector_id, selector) in &document.selectors {
        let base_path = format!("selectors.{selector_id}");

        if selector.kind != SelectorKind::Files {
            issues.push(issue(
                "selector.kind.unsupported",
                &format!("{base_path}.kind"),
                format!(
                    "selector kind '{:?}' is not supported in this POC",
                    selector.kind
                ),
            ));
        }

        if selector.include.is_empty() {
            issues.push(issue(
                "selector.include.empty",
                &format!("{base_path}.include"),
                "selector include globs must not be empty".to_string(),
            ));
        }

        if selector
            .include
            .iter()
            .any(|pattern| pattern.trim().is_empty())
        {
            issues.push(issue(
                "selector.include.blank",
                &format!("{base_path}.include"),
                "selector include globs must not contain blank entries".to_string(),
            ));
        }

        if selector
            .exclude
            .iter()
            .any(|pattern| pattern.trim().is_empty())
        {
            issues.push(issue(
                "selector.exclude.blank",
                &format!("{base_path}.exclude"),
                "selector exclude globs must not contain blank entries".to_string(),
            ));
        }
    }

    let mut seen_rule_ids = BTreeSet::new();
    for (index, rule) in document.rules.iter().enumerate() {
        let path = format!("rules[{index}]");
        if rule.id.trim().is_empty() {
            issues.push(issue(
                "rule.id.empty",
                &format!("{path}.id"),
                "rule id is required".to_string(),
            ));
        } else if !seen_rule_ids.insert(rule.id.clone()) {
            issues.push(issue(
                "rule.id.duplicate",
                &format!("{path}.id"),
                format!("duplicate rule id '{}'", rule.id),
            ));
        }

        if rule.title.trim().is_empty() {
            issues.push(issue(
                "rule.title.empty",
                &format!("{path}.title"),
                "rule title is required".to_string(),
            ));
        }

        if rule.severity != Severity::Advisory {
            issues.push(issue(
                "rule.severity.unsupported",
                &format!("{path}.severity"),
                format!(
                    "severity '{:?}' is not supported in this POC",
                    rule.severity
                ),
            ));
        }

        match rule.kind {
            RuleKind::Dependency => {
                if rule.suite != SuiteName::Boundaries {
                    issues.push(issue(
                        "rule.suite.mismatch",
                        &format!("{path}.suite"),
                        "dependency rules must use suite 'boundaries'".to_string(),
                    ));
                }
                if rule.relation != RuleRelation::MustNotDependOn {
                    issues.push(issue(
                        "rule.relation.mismatch",
                        &format!("{path}.relation"),
                        "dependency rules must use relation 'must_not_depend_on'".to_string(),
                    ));
                }
                if rule.from.is_none() {
                    issues.push(issue(
                        "rule.from.missing",
                        &format!("{path}.from"),
                        "dependency rules require a 'from' selector".to_string(),
                    ));
                }
                if rule.to.is_none() {
                    issues.push(issue(
                        "rule.to.missing",
                        &format!("{path}.to"),
                        "dependency rules require a 'to' selector".to_string(),
                    ));
                }
            }
            RuleKind::Cycle => {
                if rule.suite != SuiteName::Cycles {
                    issues.push(issue(
                        "rule.suite.mismatch",
                        &format!("{path}.suite"),
                        "cycle rules must use suite 'cycles'".to_string(),
                    ));
                }
                if rule.relation != RuleRelation::MustBeAcyclic {
                    issues.push(issue(
                        "rule.relation.mismatch",
                        &format!("{path}.relation"),
                        "cycle rules must use relation 'must_be_acyclic'".to_string(),
                    ));
                }
                if rule.scope.is_none() {
                    issues.push(issue(
                        "rule.scope.missing",
                        &format!("{path}.scope"),
                        "cycle rules require a 'scope' selector".to_string(),
                    ));
                }
            }
        }

        for (field_name, selector_ref) in referenced_selector_fields(rule) {
            if !selector_ids.contains(&selector_ref) {
                issues.push(issue(
                    "rule.selector.missing",
                    &format!("{path}.{field_name}"),
                    format!("selector '{}' is not defined", selector_ref),
                ));
            }
        }
    }

    issues
}

fn summarize_selectors(
    selectors: &BTreeMap<String, ArchitectureDslSelector>,
) -> Vec<ArchitectureDslSelectorPlan> {
    selectors
        .iter()
        .map(|(id, selector)| ArchitectureDslSelectorPlan {
            id: id.clone(),
            kind: selector.kind,
            language: selector.language,
            include: selector.include.clone(),
            exclude: selector.exclude.clone(),
            description: selector.description.clone(),
            supported_for_current_executor: selector.language == SelectorLanguage::Typescript,
        })
        .collect()
}

fn compile_rules(
    document: &ArchitectureDslDocument,
    issues: &[ArchitectureDslIssue],
) -> Vec<ArchitectureDslRulePlan> {
    document
        .rules
        .iter()
        .enumerate()
        .map(|(index, rule)| {
            let references = referenced_selectors(rule);
            let rule_path = format!("rules[{index}]");
            let has_rule_issues = issues
                .iter()
                .any(|issue| issue.path.starts_with(&rule_path));

            let unsupported_reason = if has_rule_issues {
                Some("rule has validation issues".to_string())
            } else if references.iter().any(|selector_id| {
                document
                    .selectors
                    .get(selector_id)
                    .map(|selector| selector.language != SelectorLanguage::Typescript)
                    .unwrap_or(true)
            }) {
                Some("current archunitts executor supports only typescript selectors".to_string())
            } else {
                None
            };

            let status = if has_rule_issues {
                RulePlanStatus::Invalid
            } else if unsupported_reason.is_some() {
                RulePlanStatus::Unsupported
            } else {
                RulePlanStatus::Ready
            };

            let executor = if let Some(hint) = rule
                .engine_hints
                .iter()
                .find(|hint| hint.eq_ignore_ascii_case("archunitts"))
            {
                Some(hint.clone())
            } else if let Some(first_hint) = rule.engine_hints.first() {
                Some(first_hint.clone())
            } else {
                Some("archunitts".to_string())
            };

            ArchitectureDslRulePlan {
                id: rule.id.clone(),
                title: rule.title.clone(),
                message_key: rule.message_key.clone(),
                kind: rule.kind,
                suite: rule.suite,
                severity: rule.severity,
                relation: rule.relation,
                references: references.clone(),
                executor,
                status,
                compiled_expression: if status == RulePlanStatus::Ready {
                    Some(compiled_expression(rule, document))
                } else {
                    None
                },
                unsupported_reason,
            }
        })
        .collect()
}

fn compiled_expression(rule: &ArchitectureDslRule, document: &ArchitectureDslDocument) -> String {
    match rule.kind {
        RuleKind::Dependency => {
            let from = rule
                .from
                .as_deref()
                .and_then(|id| document.selectors.get(id))
                .map(selector_signature)
                .unwrap_or_else(|| "<missing>".to_string());
            let to = rule
                .to
                .as_deref()
                .and_then(|id| document.selectors.get(id))
                .map(selector_signature)
                .unwrap_or_else(|| "<missing>".to_string());
            format!("{from} must_not_depend_on {to}")
        }
        RuleKind::Cycle => {
            let scope = rule
                .scope
                .as_deref()
                .and_then(|id| document.selectors.get(id))
                .map(selector_signature)
                .unwrap_or_else(|| "<missing>".to_string());
            format!("{scope} must_be_acyclic")
        }
    }
}

fn selector_signature(selector: &ArchitectureDslSelector) -> String {
    let mut parts = Vec::new();
    parts.push(selector.include.join(" | "));
    if !selector.exclude.is_empty() {
        parts.push(format!("exclude: {}", selector.exclude.join(" | ")));
    }
    parts.join(" ")
}

fn build_warnings(document: &ArchitectureDslDocument) -> Vec<String> {
    let mut warnings = Vec::new();
    if document
        .selectors
        .values()
        .any(|selector| selector.language == SelectorLanguage::Rust)
    {
        warnings.push(
            "Rust selectors are parsed and validated but remain unsupported by the current archunitts executor".to_string(),
        );
    }
    warnings
}

fn referenced_selectors(rule: &ArchitectureDslRule) -> Vec<String> {
    referenced_selector_fields(rule)
        .into_iter()
        .map(|(_, selector_id)| selector_id)
        .collect()
}

fn referenced_selector_fields(rule: &ArchitectureDslRule) -> Vec<(&'static str, String)> {
    match rule.kind {
        RuleKind::Dependency => {
            let mut fields = Vec::new();
            if let Some(from) = &rule.from {
                fields.push(("from", from.clone()));
            }
            if let Some(to) = &rule.to {
                fields.push(("to", to.clone()));
            }
            fields
        }
        RuleKind::Cycle => rule
            .scope
            .clone()
            .into_iter()
            .map(|scope| ("scope", scope))
            .collect(),
    }
}

fn issue(code: &str, path: &str, message: String) -> ArchitectureDslIssue {
    ArchitectureDslIssue {
        code: code.to_string(),
        path: path.to_string(),
        message,
    }
}

fn display_validation_status(value: ValidationStatus) -> &'static str {
    match value {
        ValidationStatus::Pass => "pass",
        ValidationStatus::Fail => "fail",
    }
}

fn display_plan_status(value: PlanStatus) -> &'static str {
    match value {
        PlanStatus::Ready => "ready",
        PlanStatus::Partial => "partial",
        PlanStatus::Blocked => "blocked",
    }
}

fn display_selector_kind(value: SelectorKind) -> &'static str {
    match value {
        SelectorKind::Files => "files",
    }
}

fn display_selector_language(value: SelectorLanguage) -> &'static str {
    match value {
        SelectorLanguage::Typescript => "typescript",
        SelectorLanguage::Rust => "rust",
    }
}

fn display_rule_kind(value: RuleKind) -> &'static str {
    match value {
        RuleKind::Dependency => "dependency",
        RuleKind::Cycle => "cycle",
    }
}

fn display_suite_name(value: SuiteName) -> &'static str {
    match value {
        SuiteName::Boundaries => "boundaries",
        SuiteName::Cycles => "cycles",
    }
}

fn display_rule_relation(value: RuleRelation) -> &'static str {
    match value {
        RuleRelation::MustNotDependOn => "must_not_depend_on",
        RuleRelation::MustBeAcyclic => "must_be_acyclic",
    }
}

fn display_rule_plan_status(value: RulePlanStatus) -> &'static str {
    match value {
        RulePlanStatus::Ready => "ready",
        RulePlanStatus::Unsupported => "unsupported",
        RulePlanStatus::Invalid => "invalid",
    }
}

fn format_text_report(report: &ArchitectureDslReport) -> String {
    let mut out = String::new();
    writeln!(&mut out, "architecture dsl poc").ok();
    writeln!(&mut out, "schema: {}", report.schema).ok();
    writeln!(
        &mut out,
        "model: {} ({})",
        report.model.id, report.model.title
    )
    .ok();
    writeln!(&mut out, "repo root: {}", report.repo_root).ok();
    writeln!(&mut out, "dsl: {}", report.dsl_path).ok();
    writeln!(
        &mut out,
        "validation: {}",
        display_validation_status(report.summary.validation_status)
    )
    .ok();
    writeln!(
        &mut out,
        "plan: {}",
        display_plan_status(report.summary.plan_status)
    )
    .ok();
    writeln!(
        &mut out,
        "selectors: {}  rules: {}  executable: {}  unsupported: {}  issues: {}",
        report.summary.selector_count,
        report.summary.rule_count,
        report.summary.executable_rule_count,
        report.summary.unsupported_rule_count,
        report.summary.issue_count
    )
    .ok();

    writeln!(&mut out).ok();
    writeln!(&mut out, "selectors").ok();
    for selector in &report.selectors {
        writeln!(
            &mut out,
            "  - {} [{}/{}] executable:{}",
            selector.id,
            display_selector_kind(selector.kind),
            display_selector_language(selector.language),
            selector.supported_for_current_executor
        )
        .ok();
        writeln!(&mut out, "    include: {}", selector.include.join(", ")).ok();
        if !selector.exclude.is_empty() {
            writeln!(&mut out, "    exclude: {}", selector.exclude.join(", ")).ok();
        }
        if let Some(description) = &selector.description {
            writeln!(&mut out, "    description: {}", description).ok();
        }
    }

    writeln!(&mut out).ok();
    writeln!(&mut out, "rules").ok();
    for rule in &report.rules {
        writeln!(
            &mut out,
            "  - {} [{}/{}] {}",
            rule.id,
            display_rule_kind(rule.kind),
            display_suite_name(rule.suite),
            display_rule_plan_status(rule.status)
        )
        .ok();
        writeln!(&mut out, "    title: {}", rule.title).ok();
        writeln!(
            &mut out,
            "    relation: {}",
            display_rule_relation(rule.relation)
        )
        .ok();
        writeln!(&mut out, "    refs: {}", rule.references.join(", ")).ok();
        if let Some(expression) = &rule.compiled_expression {
            writeln!(&mut out, "    expression: {}", expression).ok();
        }
        if let Some(reason) = &rule.unsupported_reason {
            writeln!(&mut out, "    reason: {}", reason).ok();
        }
    }

    if !report.issues.is_empty() {
        writeln!(&mut out).ok();
        writeln!(&mut out, "issues").ok();
        for issue in &report.issues {
            writeln!(
                &mut out,
                "  - {} @ {}: {}",
                issue.code, issue.path, issue.message
            )
            .ok();
        }
    }

    if !report.warnings.is_empty() {
        writeln!(&mut out).ok();
        writeln!(&mut out, "warnings").ok();
        for warning in &report.warnings {
            writeln!(&mut out, "  - {}", warning).ok();
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::write;
    use tempfile::tempdir;

    fn workspace_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    }

    #[test]
    fn loads_backend_core_sample_and_reports_ready_plan() {
        let repo_root = workspace_root();
        let dsl_path = repo_root.join("architecture/rules/backend-core.archdsl.yaml");

        let report = evaluate_architecture_dsl(&repo_root, &dsl_path).expect("report");

        assert_eq!(report.schema, "routa.archdsl/v1");
        assert_eq!(report.summary.validation_status, ValidationStatus::Pass);
        assert_eq!(report.summary.plan_status, PlanStatus::Ready);
        assert_eq!(report.summary.selector_count, 4);
        assert_eq!(report.summary.rule_count, 4);
        assert_eq!(report.summary.executable_rule_count, 4);
        assert_eq!(report.summary.unsupported_rule_count, 0);
        assert!(report.issues.is_empty());
        assert!(report
            .rules
            .iter()
            .any(|rule| rule.id == "ts_backend_core_no_cycles"
                && rule.status == RulePlanStatus::Ready));

        let text = format_text_report(&report);
        assert!(text.contains("architecture dsl poc"));
        assert!(text.contains("ts_backend_core_no_core_to_app"));
    }

    #[test]
    fn rejects_missing_selector_references() {
        let repo = tempdir().expect("temp dir");
        let dsl_path = repo.path().join("broken.archdsl.yaml");
        write(
            &dsl_path,
            r#"schema: routa.archdsl/v1
model:
  id: broken
  title: Broken
  description: Broken
selectors:
  core_ts:
    kind: files
    language: typescript
    include: [src/core/**]
rules:
  - id: broken_rule
    title: Broken rule
    kind: dependency
    suite: boundaries
    severity: advisory
    from: core_ts
    relation: must_not_depend_on
    to: missing_selector
"#,
        )
        .expect("write dsl");

        let report = evaluate_architecture_dsl(repo.path(), &dsl_path).expect("report");
        assert_eq!(report.summary.validation_status, ValidationStatus::Fail);
        assert_eq!(report.summary.plan_status, PlanStatus::Blocked);
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.code == "rule.selector.missing"));
        assert!(report
            .rules
            .iter()
            .any(|rule| rule.id == "broken_rule" && rule.status == RulePlanStatus::Invalid));
    }

    #[test]
    fn marks_rust_selectors_as_unsupported_for_current_executor() {
        let repo = tempdir().expect("temp dir");
        let dsl_path = repo.path().join("rust.archdsl.yaml");
        write(
            &dsl_path,
            r#"schema: routa.archdsl/v1
model:
  id: mixed
  title: Mixed
  description: Mixed
selectors:
  rust_core:
    kind: files
    language: rust
    include: [crates/routa-core/**]
  ts_app:
    kind: files
    language: typescript
    include: [src/app/**]
rules:
  - id: rust_core_no_app
    title: rust core must not depend on app
    kind: dependency
    suite: boundaries
    severity: advisory
    from: rust_core
    relation: must_not_depend_on
    to: ts_app
"#,
        )
        .expect("write dsl");

        let report = evaluate_architecture_dsl(repo.path(), &dsl_path).expect("report");
        assert_eq!(report.summary.validation_status, ValidationStatus::Pass);
        assert_eq!(report.summary.plan_status, PlanStatus::Partial);
        assert_eq!(report.summary.unsupported_rule_count, 1);
        assert!(report.rules.iter().any(
            |rule| rule.id == "rust_core_no_app" && rule.status == RulePlanStatus::Unsupported
        ));
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.contains("Rust selectors are parsed and validated")));
    }
}
