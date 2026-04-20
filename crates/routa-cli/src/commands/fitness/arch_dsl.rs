use crate::commands::graph::{analyze_directory, AnalysisLang, DependencyGraph};
use clap::{Args, ValueEnum};
use glob::Pattern;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Args, Clone, Debug)]
pub struct ArchDslArgs {
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

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
enum SelectorLanguage {
    Typescript,
    Rust,
}

impl SelectorLanguage {
    fn into_analysis_lang(self) -> AnalysisLang {
        match self {
            Self::Typescript => AnalysisLang::TypeScript,
            Self::Rust => AnalysisLang::Rust,
        }
    }
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
    engine_hints: Vec<EngineHint>,
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

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
enum EngineHint {
    Archunitts,
    Graph,
}

impl EngineHint {
    fn as_str(self) -> &'static str {
        match self {
            Self::Archunitts => "archunitts",
            Self::Graph => "graph",
        }
    }
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
    execution_status: ExecutionStatus,
    selector_count: usize,
    rule_count: usize,
    executable_rule_count: usize,
    unsupported_rule_count: usize,
    invalid_rule_count: usize,
    executed_rule_count: usize,
    passed_rule_count: usize,
    failed_rule_count: usize,
    skipped_rule_count: usize,
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

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ExecutionStatus {
    Pass,
    Fail,
    Partial,
    Skipped,
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
    supported_engines: Vec<String>,
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
    execution: Option<ArchitectureDslRuleExecution>,
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
struct ArchitectureDslRuleExecution {
    status: RuleExecutionStatus,
    violation_count: usize,
    violations: Vec<ArchitectureDslViolation>,
    note: Option<String>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RuleExecutionStatus {
    Pass,
    Fail,
    Skipped,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ArchitectureDslViolation {
    Dependency {
        source: String,
        target: String,
        specifier: String,
    },
    Cycle {
        path: Vec<String>,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct ArchitectureDslIssue {
    code: String,
    path: String,
    message: String,
}

struct SelectorMatcher {
    include: Vec<Pattern>,
    exclude: Vec<Pattern>,
}

impl SelectorMatcher {
    fn new(selector: &ArchitectureDslSelector) -> Result<Self, String> {
        Ok(Self {
            include: selector
                .include
                .iter()
                .map(|pattern| {
                    Pattern::new(pattern)
                        .map_err(|error| format!("invalid include glob '{pattern}': {error}"))
                })
                .collect::<Result<Vec<_>, _>>()?,
            exclude: selector
                .exclude
                .iter()
                .map(|pattern| {
                    Pattern::new(pattern)
                        .map_err(|error| format!("invalid exclude glob '{pattern}': {error}"))
                })
                .collect::<Result<Vec<_>, _>>()?,
        })
    }

    fn matches(&self, value: &str) -> bool {
        self.include.iter().any(|pattern| pattern.matches(value))
            && !self.exclude.iter().any(|pattern| pattern.matches(value))
    }
}

pub(super) fn run(args: &ArchDslArgs) -> Result<(), String> {
    let repo_root = super::resolve_repo_root(args.repo_root.as_deref())?;
    let dsl_path = resolve_dsl_path(args, &repo_root)?;
    let report = evaluate_architecture_dsl(&repo_root, &dsl_path)?;

    match resolved_output_format(args) {
        ArchDslOutputFormat::Text => println!("{}", format_text_report(&report)),
        ArchDslOutputFormat::Json => println!(
            "{}",
            serde_json::to_string_pretty(&report)
                .map_err(|error| format!("failed to serialize architecture DSL report: {error}"))?
        ),
    }

    if should_fail_fitness_command(&report) {
        return Err(format!(
            "architecture dsl failed: validation={}, execution={}",
            display_validation_status(report.summary.validation_status),
            display_execution_status(report.summary.execution_status),
        ));
    }

    Ok(())
}

fn should_fail_fitness_command(report: &ArchitectureDslReport) -> bool {
    report.summary.validation_status == ValidationStatus::Fail
        || report.summary.execution_status == ExecutionStatus::Fail
}

fn resolved_output_format(args: &ArchDslArgs) -> ArchDslOutputFormat {
    if args.json {
        ArchDslOutputFormat::Json
    } else {
        args.format
    }
}

fn resolve_dsl_path(args: &ArchDslArgs, repo_root: &Path) -> Result<PathBuf, String> {
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
    let mut rules = plan_rules(&document, &issues);
    let warnings = build_warnings(&rules);
    let graph_root = resolve_graph_root(repo_root, document.defaults.root.as_deref())?;

    execute_graph_rules(&document, &graph_root, &mut rules)?;

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
    let invalid_rule_count = rules
        .iter()
        .filter(|rule| rule.status == RulePlanStatus::Invalid)
        .count();
    let executed_rule_count = rules
        .iter()
        .filter(|rule| {
            rule.execution
                .as_ref()
                .map(|execution| execution.status != RuleExecutionStatus::Skipped)
                .unwrap_or(false)
        })
        .count();
    let passed_rule_count = rules
        .iter()
        .filter(|rule| {
            rule.execution
                .as_ref()
                .map(|execution| execution.status == RuleExecutionStatus::Pass)
                .unwrap_or(false)
        })
        .count();
    let failed_rule_count = rules
        .iter()
        .filter(|rule| {
            rule.execution
                .as_ref()
                .map(|execution| execution.status == RuleExecutionStatus::Fail)
                .unwrap_or(false)
        })
        .count();
    let skipped_rule_count = rules
        .iter()
        .filter(|rule| {
            rule.execution
                .as_ref()
                .map(|execution| execution.status == RuleExecutionStatus::Skipped)
                .unwrap_or(false)
        })
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
    let execution_status = if failed_rule_count > 0 {
        ExecutionStatus::Fail
    } else if executed_rule_count > 0 && skipped_rule_count > 0 {
        ExecutionStatus::Partial
    } else if executed_rule_count > 0 {
        ExecutionStatus::Pass
    } else {
        ExecutionStatus::Skipped
    };

    Ok(ArchitectureDslReport {
        report_type: "architecture_dsl".to_string(),
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
            execution_status,
            selector_count,
            rule_count,
            executable_rule_count,
            unsupported_rule_count,
            invalid_rule_count,
            executed_rule_count,
            passed_rule_count,
            failed_rule_count,
            skipped_rule_count,
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
                    format!("selector '{selector_ref}' is not defined"),
                ));
            }
        }

        if effective_engine_hints(rule).contains(&EngineHint::Archunitts) {
            for (field_name, selector_ref) in referenced_selector_fields(rule) {
                let Some(selector) = document.selectors.get(&selector_ref) else {
                    continue;
                };
                if selector.language != SelectorLanguage::Typescript {
                    issues.push(issue(
                        "rule.engine.archunitts.language",
                        &format!("{path}.{field_name}"),
                        format!(
                            "rule '{}' uses archunitts but selector '{}' is {}",
                            rule.id,
                            selector_ref,
                            display_selector_language(selector.language)
                        ),
                    ));
                }
                if selector.include.len() != 1 {
                    issues.push(issue(
                        "rule.engine.archunitts.include_count",
                        &format!("{path}.{field_name}"),
                        format!(
                            "rule '{}' uses archunitts but selector '{}' has {} include globs; exactly one is required",
                            rule.id,
                            selector_ref,
                            selector.include.len()
                        ),
                    ));
                }
            }
        }

        if effective_engine_hints(rule).contains(&EngineHint::Graph) {
            let languages = referenced_selector_fields(rule)
                .into_iter()
                .filter_map(|(_, selector_ref)| document.selectors.get(&selector_ref))
                .map(|selector| selector.language)
                .collect::<BTreeSet<_>>();
            if languages.len() > 1 {
                issues.push(issue(
                    "rule.engine.graph.language_mismatch",
                    &format!("{path}.engine_hints"),
                    format!(
                        "rule '{}' uses graph but mixes selector languages; graph rules must stay within one language",
                        rule.id
                    ),
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
            supported_engines: supported_engines_for_selector(selector)
                .into_iter()
                .map(|engine| engine.as_str().to_string())
                .collect(),
        })
        .collect()
}

fn supported_engines_for_selector(selector: &ArchitectureDslSelector) -> Vec<EngineHint> {
    match selector.language {
        SelectorLanguage::Typescript => vec![EngineHint::Archunitts, EngineHint::Graph],
        SelectorLanguage::Rust => vec![EngineHint::Graph],
    }
}

fn effective_engine_hints(rule: &ArchitectureDslRule) -> Vec<EngineHint> {
    if rule.engine_hints.is_empty() {
        vec![EngineHint::Archunitts]
    } else {
        rule.engine_hints.clone()
    }
}

fn plan_rules(
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
            let executor = select_executor(rule, document);
            let unsupported_reason = if has_rule_issues {
                Some("rule has validation issues".to_string())
            } else if executor.is_none() {
                Some("no supported executor can run this rule in the Rust CLI".to_string())
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

            ArchitectureDslRulePlan {
                id: rule.id.clone(),
                title: rule.title.clone(),
                message_key: rule.message_key.clone(),
                kind: rule.kind,
                suite: rule.suite,
                severity: rule.severity,
                relation: rule.relation,
                references: references.clone(),
                executor: executor.map(|engine| engine.as_str().to_string()),
                status,
                compiled_expression: (status == RulePlanStatus::Ready)
                    .then(|| compiled_expression(rule, document)),
                unsupported_reason,
                execution: None,
            }
        })
        .collect()
}

fn select_executor(
    rule: &ArchitectureDslRule,
    document: &ArchitectureDslDocument,
) -> Option<EngineHint> {
    let hints = effective_engine_hints(rule);
    if hints.contains(&EngineHint::Graph) && rule_graph_language(rule, document).is_some() {
        return Some(EngineHint::Graph);
    }

    if hints.contains(&EngineHint::Archunitts)
        && referenced_selector_fields(rule)
            .into_iter()
            .filter_map(|(_, selector_ref)| document.selectors.get(&selector_ref))
            .all(|selector| {
                selector.language == SelectorLanguage::Typescript && selector.include.len() == 1
            })
    {
        return Some(EngineHint::Archunitts);
    }

    None
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

fn build_warnings(rules: &[ArchitectureDslRulePlan]) -> Vec<String> {
    let mut warnings = Vec::new();
    if rules
        .iter()
        .any(|rule| rule.executor.as_deref() == Some("archunitts"))
    {
        warnings.push(
            "ArchUnitTS-compatible rules are planned here but still execute through scripts/fitness/check-backend-architecture.ts".to_string(),
        );
    }
    warnings
}

fn execute_graph_rules(
    document: &ArchitectureDslDocument,
    graph_root: &Path,
    rules: &mut [ArchitectureDslRulePlan],
) -> Result<(), String> {
    let mut graph_cache = BTreeMap::new();

    for (index, rule_plan) in rules.iter_mut().enumerate() {
        if rule_plan.status != RulePlanStatus::Ready {
            continue;
        }

        let document_rule = &document.rules[index];
        match select_executor(document_rule, document) {
            Some(EngineHint::Graph) => {
                let language = rule_graph_language(document_rule, document).ok_or_else(|| {
                    format!(
                        "graph rule '{}' has no resolvable language",
                        document_rule.id
                    )
                })?;
                let graph = graph_cache.entry(language).or_insert_with(|| {
                    analyze_directory(
                        graph_root,
                        language.into_analysis_lang(),
                        crate::commands::graph::AnalysisDepth::Fast, // Use Fast mode for fitness checks
                    )
                });
                rule_plan.execution = Some(execute_graph_rule(document_rule, document, graph)?);
            }
            Some(EngineHint::Archunitts) => {
                rule_plan.execution = Some(ArchitectureDslRuleExecution {
                    status: RuleExecutionStatus::Skipped,
                    violation_count: 0,
                    violations: Vec::new(),
                    note: Some(
                        "archunitts rules are intentionally executed via the TypeScript fitness path".to_string(),
                    ),
                });
            }
            None => {}
        }
    }

    Ok(())
}

fn resolve_graph_root(repo_root: &Path, defaults_root: Option<&str>) -> Result<PathBuf, String> {
    let Some(raw_root) = defaults_root.filter(|value| !value.trim().is_empty()) else {
        return Ok(repo_root.to_path_buf());
    };

    let candidate = if Path::new(raw_root).is_absolute() {
        PathBuf::from(raw_root)
    } else {
        repo_root.join(raw_root)
    };
    let metadata = fs::metadata(&candidate).map_err(|error| {
        format!(
            "defaults.root path does not exist: {} ({error})",
            candidate.display()
        )
    })?;

    if !metadata.is_dir() {
        return Err(format!(
            "defaults.root path is not a directory: {}",
            candidate.display()
        ));
    }

    Ok(candidate)
}

fn rule_graph_language(
    rule: &ArchitectureDslRule,
    document: &ArchitectureDslDocument,
) -> Option<SelectorLanguage> {
    let languages = referenced_selector_fields(rule)
        .into_iter()
        .filter_map(|(_, selector_ref)| document.selectors.get(&selector_ref))
        .map(|selector| selector.language)
        .collect::<BTreeSet<_>>();
    if languages.len() == 1 {
        languages.iter().next().copied()
    } else {
        None
    }
}

fn execute_graph_rule(
    rule: &ArchitectureDslRule,
    document: &ArchitectureDslDocument,
    graph: &DependencyGraph,
) -> Result<ArchitectureDslRuleExecution, String> {
    match rule.kind {
        RuleKind::Dependency => execute_graph_dependency_rule(rule, document, graph),
        RuleKind::Cycle => execute_graph_cycle_rule(rule, document, graph),
    }
}

fn execute_graph_dependency_rule(
    rule: &ArchitectureDslRule,
    document: &ArchitectureDslDocument,
    graph: &DependencyGraph,
) -> Result<ArchitectureDslRuleExecution, String> {
    let from_selector = document
        .selectors
        .get(rule.from.as_deref().unwrap_or_default())
        .ok_or_else(|| format!("missing from selector for rule '{}'", rule.id))?;
    let to_selector = document
        .selectors
        .get(rule.to.as_deref().unwrap_or_default())
        .ok_or_else(|| format!("missing to selector for rule '{}'", rule.id))?;
    let from_matcher = SelectorMatcher::new(from_selector)?;
    let to_matcher = SelectorMatcher::new(to_selector)?;

    let violations = graph
        .edges
        .iter()
        .filter(|edge| from_matcher.matches(&edge.from) && to_matcher.matches(&edge.to))
        .map(|edge| ArchitectureDslViolation::Dependency {
            source: edge.from.clone(),
            target: edge.to.clone(),
            specifier: edge.specifier.clone(),
        })
        .collect::<Vec<_>>();

    Ok(ArchitectureDslRuleExecution {
        status: if violations.is_empty() {
            RuleExecutionStatus::Pass
        } else {
            RuleExecutionStatus::Fail
        },
        violation_count: violations.len(),
        violations,
        note: None,
    })
}

fn execute_graph_cycle_rule(
    rule: &ArchitectureDslRule,
    document: &ArchitectureDslDocument,
    graph: &DependencyGraph,
) -> Result<ArchitectureDslRuleExecution, String> {
    let scope_selector = document
        .selectors
        .get(rule.scope.as_deref().unwrap_or_default())
        .ok_or_else(|| format!("missing scope selector for rule '{}'", rule.id))?;
    let scope_matcher = SelectorMatcher::new(scope_selector)?;

    let scoped_nodes = graph
        .nodes
        .iter()
        .filter(|node| scope_matcher.matches(&node.path))
        .map(|node| node.id.clone())
        .collect::<BTreeSet<_>>();

    let mut adjacency = BTreeMap::<String, Vec<String>>::new();
    for node in &scoped_nodes {
        adjacency.entry(node.clone()).or_default();
    }

    for edge in &graph.edges {
        if scoped_nodes.contains(&edge.from) && scoped_nodes.contains(&edge.to) {
            adjacency
                .entry(edge.from.clone())
                .or_default()
                .push(edge.to.clone());
        }
    }

    for edges in adjacency.values_mut() {
        edges.sort();
        edges.dedup();
    }

    let violations = strongly_connected_components(&adjacency)
        .into_iter()
        .filter_map(|component| {
            if component.len() > 1 {
                Some(ArchitectureDslViolation::Cycle {
                    path: component.clone(),
                })
            } else if component.len() == 1 {
                let node = &component[0];
                adjacency
                    .get(node)
                    .filter(|targets| targets.iter().any(|target| target == node))
                    .map(|_| ArchitectureDslViolation::Cycle {
                        path: vec![node.clone(), node.clone()],
                    })
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    Ok(ArchitectureDslRuleExecution {
        status: if violations.is_empty() {
            RuleExecutionStatus::Pass
        } else {
            RuleExecutionStatus::Fail
        },
        violation_count: violations.len(),
        violations,
        note: None,
    })
}

fn strongly_connected_components(adjacency: &BTreeMap<String, Vec<String>>) -> Vec<Vec<String>> {
    struct TarjanState<'a> {
        adjacency: &'a BTreeMap<String, Vec<String>>,
        index: usize,
        indices: BTreeMap<String, usize>,
        low_links: BTreeMap<String, usize>,
        stack: Vec<String>,
        on_stack: BTreeSet<String>,
        components: Vec<Vec<String>>,
    }

    impl<'a> TarjanState<'a> {
        fn visit(&mut self, node: &str) {
            let node_key = node.to_string();
            self.indices.insert(node_key.clone(), self.index);
            self.low_links.insert(node_key.clone(), self.index);
            self.index += 1;
            self.stack.push(node_key.clone());
            self.on_stack.insert(node_key.clone());

            for next in self.adjacency.get(node).into_iter().flatten() {
                if !self.indices.contains_key(next) {
                    self.visit(next);
                    let next_low = self.low_links[next];
                    let low = self.low_links[&node_key].min(next_low);
                    self.low_links.insert(node_key.clone(), low);
                } else if self.on_stack.contains(next) {
                    let next_index = self.indices[next];
                    let low = self.low_links[&node_key].min(next_index);
                    self.low_links.insert(node_key.clone(), low);
                }
            }

            if self.low_links[&node_key] == self.indices[&node_key] {
                let mut component = Vec::new();
                while let Some(current) = self.stack.pop() {
                    self.on_stack.remove(&current);
                    component.push(current.clone());
                    if current == node_key {
                        break;
                    }
                }
                component.sort();
                self.components.push(component);
            }
        }
    }

    let mut state = TarjanState {
        adjacency,
        index: 0,
        indices: BTreeMap::new(),
        low_links: BTreeMap::new(),
        stack: Vec::new(),
        on_stack: BTreeSet::new(),
        components: Vec::new(),
    };

    for node in adjacency.keys() {
        if !state.indices.contains_key(node) {
            state.visit(node);
        }
    }

    state.components
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

fn display_execution_status(value: ExecutionStatus) -> &'static str {
    match value {
        ExecutionStatus::Pass => "pass",
        ExecutionStatus::Fail => "fail",
        ExecutionStatus::Partial => "partial",
        ExecutionStatus::Skipped => "skipped",
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

fn display_rule_execution_status(value: RuleExecutionStatus) -> &'static str {
    match value {
        RuleExecutionStatus::Pass => "pass",
        RuleExecutionStatus::Fail => "fail",
        RuleExecutionStatus::Skipped => "skipped",
    }
}

fn format_text_report(report: &ArchitectureDslReport) -> String {
    let mut out = String::new();
    writeln!(&mut out, "architecture dsl").ok();
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
        "execution: {}",
        display_execution_status(report.summary.execution_status)
    )
    .ok();
    writeln!(
        &mut out,
        "selectors: {}  rules: {}  executable: {}  unsupported: {}  invalid: {}  executed: {}  failed: {}  skipped: {}  issues: {}",
        report.summary.selector_count,
        report.summary.rule_count,
        report.summary.executable_rule_count,
        report.summary.unsupported_rule_count,
        report.summary.invalid_rule_count,
        report.summary.executed_rule_count,
        report.summary.failed_rule_count,
        report.summary.skipped_rule_count,
        report.summary.issue_count
    )
    .ok();

    writeln!(&mut out).ok();
    writeln!(&mut out, "selectors").ok();
    for selector in &report.selectors {
        writeln!(
            &mut out,
            "  - {} [{}/{}]",
            selector.id,
            display_selector_kind(selector.kind),
            display_selector_language(selector.language)
        )
        .ok();
        writeln!(&mut out, "    include: {}", selector.include.join(", ")).ok();
        if !selector.exclude.is_empty() {
            writeln!(&mut out, "    exclude: {}", selector.exclude.join(", ")).ok();
        }
        writeln!(
            &mut out,
            "    engines: {}",
            selector.supported_engines.join(", ")
        )
        .ok();
        if let Some(description) = &selector.description {
            writeln!(&mut out, "    description: {description}").ok();
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
        if let Some(executor) = &rule.executor {
            writeln!(&mut out, "    executor: {executor}").ok();
        }
        if let Some(expression) = &rule.compiled_expression {
            writeln!(&mut out, "    expression: {expression}").ok();
        }
        if let Some(reason) = &rule.unsupported_reason {
            writeln!(&mut out, "    reason: {reason}").ok();
        }
        if let Some(execution) = &rule.execution {
            writeln!(
                &mut out,
                "    execution: {} ({})",
                display_rule_execution_status(execution.status),
                execution.violation_count
            )
            .ok();
            if let Some(note) = &execution.note {
                writeln!(&mut out, "    note: {note}").ok();
            }
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
            writeln!(&mut out, "  - {warning}").ok();
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
    fn loads_backend_core_sample_and_reports_partial_execution_in_rust_cli() {
        let repo_root = workspace_root();
        let dsl_path = repo_root.join("architecture/rules/backend-core.archdsl.yaml");

        let report = evaluate_architecture_dsl(&repo_root, &dsl_path).expect("report");

        assert_eq!(report.report_type, "architecture_dsl");
        assert_eq!(report.summary.validation_status, ValidationStatus::Pass);
        assert_eq!(report.summary.plan_status, PlanStatus::Ready);
        assert_eq!(report.summary.execution_status, ExecutionStatus::Partial);
        assert_eq!(report.summary.selector_count, 4);
        assert_eq!(report.summary.rule_count, 4);
        assert_eq!(report.summary.executable_rule_count, 4);
        assert_eq!(report.summary.unsupported_rule_count, 0);
        assert_eq!(report.summary.executed_rule_count, 1);
        assert_eq!(report.summary.passed_rule_count, 1);
        assert_eq!(report.summary.failed_rule_count, 0);
        assert_eq!(report.summary.skipped_rule_count, 3);
        assert!(report.issues.is_empty());
        assert!(report
            .rules
            .iter()
            .any(|rule| rule.id == "ts_backend_core_no_core_to_app"
                && rule.execution.as_ref().map(|execution| execution.status)
                    == Some(RuleExecutionStatus::Pass)));
        assert!(report
            .rules
            .iter()
            .any(|rule| rule.id == "ts_backend_core_no_cycles"
                && rule.execution.as_ref().map(|execution| execution.status)
                    == Some(RuleExecutionStatus::Skipped)));

        let text = format_text_report(&report);
        assert!(text.contains("architecture dsl"));
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
    fn executes_graph_backed_rust_boundary_rules() {
        let repo = tempdir().expect("temp dir");
        write(
            repo.path().join("Cargo.toml"),
            r#"[workspace]
members = ["crates/*"]
"#,
        )
        .expect("workspace");
        fs::create_dir_all(repo.path().join("crates/alpha/src")).expect("alpha src");
        fs::create_dir_all(repo.path().join("crates/beta/src")).expect("beta src");
        write(
            repo.path().join("crates/alpha/Cargo.toml"),
            r#"[package]
name = "alpha"
version = "0.1.0"
edition = "2021"
"#,
        )
        .expect("alpha manifest");
        write(
            repo.path().join("crates/alpha/src/lib.rs"),
            "use beta::service::run;\npub fn call() { run(); }\n",
        )
        .expect("alpha lib");
        write(
            repo.path().join("crates/beta/Cargo.toml"),
            r#"[package]
name = "beta"
version = "0.1.0"
edition = "2021"
"#,
        )
        .expect("beta manifest");
        write(
            repo.path().join("crates/beta/src/lib.rs"),
            "pub mod service;\n",
        )
        .expect("beta lib");
        write(
            repo.path().join("crates/beta/src/service.rs"),
            "pub fn run() {}\n",
        )
        .expect("beta service");

        let dsl_path = repo.path().join("rust.archdsl.yaml");
        write(
            &dsl_path,
            r#"schema: routa.archdsl/v1
model:
  id: rust_graph
  title: Rust Graph
selectors:
  alpha:
    kind: files
    language: rust
    include: [crates/alpha/**]
  beta:
    kind: files
    language: rust
    include: [crates/beta/**]
rules:
  - id: alpha_no_beta
    title: alpha must not depend on beta
    kind: dependency
    suite: boundaries
    severity: advisory
    from: alpha
    relation: must_not_depend_on
    to: beta
    engine_hints:
      - graph
"#,
        )
        .expect("dsl");

        let report = evaluate_architecture_dsl(repo.path(), &dsl_path).expect("report");
        assert_eq!(report.summary.validation_status, ValidationStatus::Pass);
        assert_eq!(report.summary.execution_status, ExecutionStatus::Fail);
        assert_eq!(report.summary.executed_rule_count, 1);
        assert_eq!(report.summary.failed_rule_count, 1);
        let execution = report.rules[0].execution.as_ref().expect("execution");
        assert_eq!(execution.status, RuleExecutionStatus::Fail);
        assert_eq!(execution.violation_count, 1);
        match &execution.violations[0] {
            ArchitectureDslViolation::Dependency { source, target, .. } => {
                assert_eq!(source, "crates/alpha/src/lib.rs");
                assert_eq!(target, "crates/beta/src/lib.rs");
            }
            violation => panic!("unexpected violation: {violation:?}"),
        }
    }

    #[test]
    fn executes_graph_backed_rust_rules_from_defaults_root() {
        let repo = tempdir().expect("temp dir");
        write(
            repo.path().join("Cargo.toml"),
            r#"[workspace]
members = ["crates/*"]
"#,
        )
        .expect("workspace");
        fs::create_dir_all(repo.path().join("crates/alpha/src")).expect("alpha src");
        fs::create_dir_all(repo.path().join("crates/beta/src")).expect("beta src");
        write(
            repo.path().join("crates/alpha/Cargo.toml"),
            r#"[package]
name = "alpha"
version = "0.1.0"
edition = "2021"
"#,
        )
        .expect("alpha manifest");
        write(
            repo.path().join("crates/alpha/src/lib.rs"),
            "use beta::service::run;\npub fn call() { run(); }\n",
        )
        .expect("alpha lib");
        write(
            repo.path().join("crates/beta/Cargo.toml"),
            r#"[package]
name = "beta"
version = "0.1.0"
edition = "2021"
"#,
        )
        .expect("beta manifest");
        write(
            repo.path().join("crates/beta/src/lib.rs"),
            "pub mod service;\n",
        )
        .expect("beta lib");
        write(
            repo.path().join("crates/beta/src/service.rs"),
            "pub fn run() {}\n",
        )
        .expect("beta service");

        let dsl_path = repo.path().join("alpha-core.archdsl.yaml");
        write(
            &dsl_path,
            r#"schema: routa.archdsl/v1
model:
  id: alpha_graph
  title: Alpha Graph
defaults:
  root: crates/alpha
selectors:
  alpha:
    kind: files
    language: rust
    include: [crates/alpha/src/**]
  beta:
    kind: files
    language: rust
    include: [crates/beta/src/**]
rules:
  - id: alpha_no_beta
    title: alpha must not depend on beta
    kind: dependency
    suite: boundaries
    severity: advisory
    from: alpha
    relation: must_not_depend_on
    to: beta
    engine_hints:
      - graph
"#,
        )
        .expect("dsl");

        let report = evaluate_architecture_dsl(repo.path(), &dsl_path).expect("report");
        assert_eq!(report.summary.validation_status, ValidationStatus::Pass);
        assert_eq!(report.summary.execution_status, ExecutionStatus::Pass);
        assert_eq!(report.summary.executed_rule_count, 1);
        assert_eq!(report.summary.failed_rule_count, 0);
        let execution = report.rules[0].execution.as_ref().expect("execution");
        assert_eq!(execution.status, RuleExecutionStatus::Pass);
        assert_eq!(execution.violation_count, 0);
    }

    #[test]
    fn executes_graph_backed_rust_cycle_rules() {
        let repo = tempdir().expect("temp dir");
        write(
            repo.path().join("Cargo.toml"),
            r#"[workspace]
members = ["crates/*"]
"#,
        )
        .expect("workspace");
        fs::create_dir_all(repo.path().join("crates/alpha/src")).expect("alpha src");
        write(
            repo.path().join("crates/alpha/Cargo.toml"),
            r#"[package]
name = "alpha"
version = "0.1.0"
edition = "2021"
"#,
        )
        .expect("alpha manifest");
        write(
            repo.path().join("crates/alpha/src/lib.rs"),
            "mod a;\nmod b;\npub use a::A;\npub use b::B;\n",
        )
        .expect("lib");
        write(
            repo.path().join("crates/alpha/src/a.rs"),
            "use crate::b::B;\npub struct A(pub B);\n",
        )
        .expect("a");
        write(
            repo.path().join("crates/alpha/src/b.rs"),
            "use crate::a::A;\npub struct B(pub Box<A>);\n",
        )
        .expect("b");

        let dsl_path = repo.path().join("cycle.archdsl.yaml");
        write(
            &dsl_path,
            r#"schema: routa.archdsl/v1
model:
  id: rust_cycle
  title: Rust Cycle
selectors:
  alpha:
    kind: files
    language: rust
    include: [crates/alpha/**]
rules:
  - id: alpha_acyclic
    title: alpha must be acyclic
    kind: cycle
    suite: cycles
    severity: advisory
    scope: alpha
    relation: must_be_acyclic
    engine_hints:
      - graph
"#,
        )
        .expect("dsl");

        let report = evaluate_architecture_dsl(repo.path(), &dsl_path).expect("report");
        assert_eq!(report.summary.validation_status, ValidationStatus::Pass);
        assert_eq!(report.summary.execution_status, ExecutionStatus::Fail);
        let execution = report.rules[0].execution.as_ref().expect("execution");
        assert_eq!(execution.status, RuleExecutionStatus::Fail);
        assert_eq!(execution.violation_count, 1);
        match &execution.violations[0] {
            ArchitectureDslViolation::Cycle { path } => {
                assert!(path.contains(&"crates/alpha/src/a.rs".to_string()));
                assert!(path.contains(&"crates/alpha/src/b.rs".to_string()));
            }
            violation => panic!("unexpected violation: {violation:?}"),
        }
    }

    #[test]
    fn rejects_graph_rules_that_mix_languages() {
        let repo = tempdir().expect("temp dir");
        let dsl_path = repo.path().join("mixed.archdsl.yaml");
        write(
            &dsl_path,
            r#"schema: routa.archdsl/v1
model:
  id: mixed
  title: Mixed
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
  - id: mixed_graph_rule
    title: mixed graph rule
    kind: dependency
    suite: boundaries
    severity: advisory
    from: rust_core
    relation: must_not_depend_on
    to: ts_app
    engine_hints:
      - graph
"#,
        )
        .expect("dsl");

        let report = evaluate_architecture_dsl(repo.path(), &dsl_path).expect("report");
        assert_eq!(report.summary.validation_status, ValidationStatus::Fail);
        assert!(report.issues.iter().any(|issue| {
            issue.code == "rule.engine.graph.language_mismatch"
                && issue.message.contains("mixed_graph_rule")
        }));
    }
}
