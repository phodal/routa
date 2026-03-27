use chrono::Utc;
use glob::{MatchOptions, Pattern};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use walkdir::{DirEntry, WalkDir};

const CELL_PASS_THRESHOLD: f64 = 0.8;
const MAX_REGEX_PATTERN_LENGTH: usize = 256;
const MAX_REGEX_INPUT_LENGTH: usize = 20_000;
const MAX_RECOMMENDATIONS: usize = 5;

const ALLOWED_COMMAND_EXECUTABLES: &[&str] = &[
    "cargo", "entrix", "git", "node", "npm", "npx", "pnpm", "python", "python3", "uv",
];

const DEFAULT_GLOB_IGNORE: &[&str] = &[
    "**/.git/**",
    "**/.next/**",
    "**/.next-*/**",
    "**/.next-desktop/**",
    "**/_next/**",
    "**/.nuxt/**",
    "**/.pnpm-store/**",
    "**/.pytest_cache/**",
    "**/.routa/**",
    "**/.ruff_cache/**",
    "**/.turbo/**",
    "**/.venv/**",
    "**/__pycache__/**",
    "**/build/**",
    "**/coverage/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/target/**",
    "**/venv/**",
    "**/vendor/**",
    "**/.worktrees/**",
];

#[derive(Clone, Debug)]
pub struct EvaluateOptions {
    pub repo_root: PathBuf,
    pub model_path: PathBuf,
    pub profile: String,
    pub snapshot_path: PathBuf,
    pub compare_last: bool,
    pub save: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CriterionStatus {
    Pass,
    Fail,
    Skipped,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LevelChange {
    Same,
    Up,
    Down,
}

#[derive(Clone, Debug)]
enum DetectorDefinition {
    FileExists { path: String },
    FileContainsRegex {
        path: String,
        pattern: String,
        flags: String,
    },
    AnyOf { detectors: Vec<DetectorDefinition> },
    AnyFileExists { paths: Vec<String> },
    GlobCount { patterns: Vec<String>, min: usize },
    GlobContainsRegex {
        patterns: Vec<String>,
        pattern: String,
        flags: String,
        min_matches: usize,
    },
    JsonPathExists {
        path: String,
        json_path: Vec<PathSegment>,
    },
    YamlPathExists {
        path: String,
        yaml_path: Vec<PathSegment>,
    },
    CommandExitCode {
        command: String,
        expected_exit_code: i32,
        timeout_ms: u64,
    },
    CommandOutputRegex {
        command: String,
        pattern: String,
        flags: String,
        expected_exit_code: i32,
        timeout_ms: u64,
    },
    ManualAttestation { prompt: String },
}

impl DetectorDefinition {
    fn detector_type(&self) -> &'static str {
        match self {
            Self::FileExists { .. } => "file_exists",
            Self::FileContainsRegex { .. } => "file_contains_regex",
            Self::AnyOf { .. } => "any_of",
            Self::AnyFileExists { .. } => "any_file_exists",
            Self::GlobCount { .. } => "glob_count",
            Self::GlobContainsRegex { .. } => "glob_contains_regex",
            Self::JsonPathExists { .. } => "json_path_exists",
            Self::YamlPathExists { .. } => "yaml_path_exists",
            Self::CommandExitCode { .. } => "command_exit_code",
            Self::CommandOutputRegex { .. } => "command_output_regex",
            Self::ManualAttestation { .. } => "manual_attestation",
        }
    }
}

#[derive(Clone, Debug)]
enum PathSegment {
    Key(String),
    Index(usize),
}

#[derive(Clone, Debug)]
struct FluencyLevel {
    id: String,
    name: String,
}

#[derive(Clone, Debug)]
struct FluencyDimension {
    id: String,
    name: String,
}

#[derive(Clone, Debug)]
struct FluencyCriterion {
    id: String,
    level: String,
    dimension: String,
    weight: u32,
    critical: bool,
    why_it_matters: String,
    recommended_action: String,
    evidence_hint: String,
    detector: DetectorDefinition,
}

#[derive(Clone, Debug)]
struct FluencyModel {
    version: u32,
    levels: Vec<FluencyLevel>,
    dimensions: Vec<FluencyDimension>,
    criteria: Vec<FluencyCriterion>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionResult {
    pub id: String,
    pub level: String,
    pub dimension: String,
    pub weight: u32,
    pub critical: bool,
    pub status: CriterionStatus,
    pub detector_type: String,
    pub detail: String,
    pub evidence: Vec<String>,
    pub why_it_matters: String,
    pub recommended_action: String,
    pub evidence_hint: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellResult {
    pub id: String,
    pub level: String,
    pub level_name: String,
    pub dimension: String,
    pub dimension_name: String,
    pub score: f64,
    pub passed: bool,
    pub passed_weight: u32,
    pub applicable_weight: u32,
    pub criteria: Vec<CriterionResult>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionResult {
    pub dimension: String,
    pub name: String,
    pub level: String,
    pub level_name: String,
    pub level_index: usize,
    pub score: f64,
    pub next_level: Option<String>,
    pub next_level_name: Option<String>,
    pub next_level_progress: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub criterion_id: String,
    pub action: String,
    pub why_it_matters: String,
    pub evidence_hint: String,
    pub critical: bool,
    pub weight: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionChange {
    pub dimension: String,
    pub previous_level: String,
    pub current_level: String,
    pub change: LevelChange,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionChange {
    pub id: String,
    pub previous_status: Option<CriterionStatus>,
    pub current_status: Option<CriterionStatus>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportComparison {
    pub previous_generated_at: String,
    pub previous_overall_level: String,
    pub overall_change: LevelChange,
    pub dimension_changes: Vec<DimensionChange>,
    pub criteria_changes: Vec<CriterionChange>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessFluencyReport {
    pub model_version: u32,
    pub model_path: String,
    pub profile: String,
    pub repo_root: String,
    pub generated_at: String,
    pub snapshot_path: String,
    pub overall_level: String,
    pub overall_level_name: String,
    pub current_level_readiness: f64,
    pub next_level: Option<String>,
    pub next_level_name: Option<String>,
    pub next_level_readiness: Option<f64>,
    pub blocking_target_level: Option<String>,
    pub blocking_target_level_name: Option<String>,
    pub dimensions: HashMap<String, DimensionResult>,
    pub cells: Vec<CellResult>,
    pub criteria: Vec<CriterionResult>,
    pub blocking_criteria: Vec<CriterionResult>,
    pub recommendations: Vec<Recommendation>,
    pub comparison: Option<ReportComparison>,
}

struct DetectorResult {
    status: CriterionStatus,
    detail: String,
    evidence: Vec<String>,
}

struct EvaluationContext {
    repo_root: PathBuf,
    ignore_patterns: Vec<Pattern>,
    text_cache: HashMap<PathBuf, String>,
    json_cache: HashMap<PathBuf, JsonValue>,
    yaml_cache: HashMap<PathBuf, JsonValue>,
}

impl EvaluationContext {
    fn new(repo_root: PathBuf) -> Result<Self, String> {
        Ok(Self {
            repo_root,
            ignore_patterns: compile_patterns(DEFAULT_GLOB_IGNORE)?,
            text_cache: HashMap::new(),
            json_cache: HashMap::new(),
            yaml_cache: HashMap::new(),
        })
    }
}

struct CommandExecutionResult {
    exit_code: i32,
    output: String,
    timed_out: bool,
}

struct MutableCellAccumulator {
    id: String,
    level: String,
    level_name: String,
    dimension: String,
    dimension_name: String,
    criteria: Vec<CriterionResult>,
}

pub fn evaluate_harness_fluency(options: &EvaluateOptions) -> Result<HarnessFluencyReport, String> {
    let model = load_fluency_model(&options.model_path)?;
    let level_order: HashMap<String, usize> = model
        .levels
        .iter()
        .enumerate()
        .map(|(index, level)| (level.id.clone(), index))
        .collect();
    let level_by_id: HashMap<String, FluencyLevel> = model
        .levels
        .iter()
        .cloned()
        .map(|level| (level.id.clone(), level))
        .collect();
    let dimension_by_id: HashMap<String, FluencyDimension> = model
        .dimensions
        .iter()
        .cloned()
        .map(|dimension| (dimension.id.clone(), dimension))
        .collect();

    let previous_snapshot = if options.compare_last {
        load_previous_snapshot(&options.snapshot_path)?
    } else {
        None
    };

    let mut context = EvaluationContext::new(options.repo_root.clone())?;
    let mut criteria_results = Vec::with_capacity(model.criteria.len());
    for criterion in &model.criteria {
        criteria_results.push(evaluate_criterion(criterion, &mut context)?);
    }

    let mut cell_accumulators: HashMap<String, MutableCellAccumulator> = HashMap::new();
    for criterion_result in &criteria_results {
        let level = level_by_id
            .get(&criterion_result.level)
            .ok_or_else(|| format!("unknown level {}", criterion_result.level))?;
        let dimension = dimension_by_id
            .get(&criterion_result.dimension)
            .ok_or_else(|| format!("unknown dimension {}", criterion_result.dimension))?;
        let cell_id = build_cell_id(&criterion_result.level, &criterion_result.dimension);
        cell_accumulators
            .entry(cell_id.clone())
            .and_modify(|accumulator| accumulator.criteria.push(criterion_result.clone()))
            .or_insert_with(|| MutableCellAccumulator {
                id: cell_id,
                level: criterion_result.level.clone(),
                level_name: level.name.clone(),
                dimension: criterion_result.dimension.clone(),
                dimension_name: dimension.name.clone(),
                criteria: vec![criterion_result.clone()],
            });
    }

    let mut cells = Vec::with_capacity(model.levels.len() * model.dimensions.len());
    for level in &model.levels {
        for dimension in &model.dimensions {
            let cell_id = build_cell_id(&level.id, &dimension.id);
            let mut accumulator = cell_accumulators
                .remove(&cell_id)
                .ok_or_else(|| format!("missing accumulated cell {}:{}", dimension.id, level.id))?;
            accumulator.criteria.sort_by(|left, right| left.id.cmp(&right.id));
            let applicable_weight: u32 = accumulator
                .criteria
                .iter()
                .filter(|criterion| criterion.status != CriterionStatus::Skipped)
                .map(|criterion| criterion.weight)
                .sum();
            let passed_weight: u32 = accumulator
                .criteria
                .iter()
                .filter(|criterion| criterion.status == CriterionStatus::Pass)
                .map(|criterion| criterion.weight)
                .sum();
            let score = if applicable_weight == 0 {
                0.0
            } else {
                passed_weight as f64 / applicable_weight as f64
            };

            cells.push(CellResult {
                id: accumulator.id,
                level: accumulator.level,
                level_name: accumulator.level_name,
                dimension: accumulator.dimension,
                dimension_name: accumulator.dimension_name,
                score,
                passed: applicable_weight > 0 && score >= CELL_PASS_THRESHOLD,
                passed_weight,
                applicable_weight,
                criteria: accumulator.criteria,
            });
        }
    }

    let cell_by_id: HashMap<String, CellResult> =
        cells.iter().cloned().map(|cell| (cell.id.clone(), cell)).collect();
    let mut dimensions = HashMap::new();
    for dimension in &model.dimensions {
        let mut achieved_index: isize = -1;
        for (index, level) in model.levels.iter().enumerate() {
            let cell = cell_by_id.get(&build_cell_id(&level.id, &dimension.id));
            if !cell.map(|entry| entry.passed).unwrap_or(false) {
                break;
            }
            achieved_index = index as isize;
        }

        let resolved_index = achieved_index.max(0) as usize;
        let current_level = &model.levels[resolved_index];
        let next_level = model.levels.get(resolved_index + 1);
        let current_cell_id = build_cell_id(&current_level.id, &dimension.id);
        dimensions.insert(
            dimension.id.clone(),
            DimensionResult {
                dimension: dimension.id.clone(),
                name: dimension.name.clone(),
                level: current_level.id.clone(),
                level_name: current_level.name.clone(),
                level_index: resolved_index,
                score: cell_by_id
                    .get(&current_cell_id)
                    .map(|cell| cell.score)
                    .unwrap_or(0.0),
                next_level: next_level.map(|level| level.id.clone()),
                next_level_name: next_level.map(|level| level.name.clone()),
                next_level_progress: next_level
                    .and_then(|level| cell_by_id.get(&build_cell_id(&level.id, &dimension.id)))
                    .map(|cell| cell.score),
            },
        );
    }

    let overall_level_index = dimensions
        .values()
        .map(|dimension| dimension.level_index)
        .min()
        .ok_or_else(|| "fluency model has no dimensions".to_string())?;
    let overall_level = &model.levels[overall_level_index];
    let next_level = model.levels.get(overall_level_index + 1);
    let current_level_readiness = average_cell_scores(&model.dimensions, &cell_by_id, &overall_level.id);
    let current_level_debt =
        collect_failing_criteria_for_level(&model.dimensions, &cell_by_id, &overall_level.id);
    let next_level_readiness = if next_level.is_none() || !current_level_debt.is_empty() {
        None
    } else {
        Some(average_cell_scores(
            &model.dimensions,
            &cell_by_id,
            &next_level.expect("checked above").id,
        ))
    };
    let blocking_target_level = if !current_level_debt.is_empty() {
        Some(overall_level)
    } else {
        next_level
    };
    let mut blocking_criteria = match blocking_target_level {
        None => Vec::new(),
        Some(level) if level.id == overall_level.id => current_level_debt.clone(),
        Some(level) => collect_failing_criteria_for_level(&model.dimensions, &cell_by_id, &level.id),
    };
    blocking_criteria.sort_by(|left, right| left.id.cmp(&right.id));

    criteria_results.sort_by(|left, right| left.id.cmp(&right.id));
    let mut report = HarnessFluencyReport {
        model_version: model.version,
        model_path: options.model_path.display().to_string(),
        profile: options.profile.clone(),
        repo_root: options.repo_root.display().to_string(),
        generated_at: Utc::now().to_rfc3339(),
        snapshot_path: options.snapshot_path.display().to_string(),
        overall_level: overall_level.id.clone(),
        overall_level_name: overall_level.name.clone(),
        current_level_readiness,
        next_level: next_level.map(|level| level.id.clone()),
        next_level_name: next_level.map(|level| level.name.clone()),
        next_level_readiness,
        blocking_target_level: blocking_target_level.map(|level| level.id.clone()),
        blocking_target_level_name: blocking_target_level.map(|level| level.name.clone()),
        dimensions,
        cells,
        criteria: criteria_results,
        blocking_criteria: blocking_criteria.clone(),
        recommendations: collect_recommendations(&blocking_criteria),
        comparison: None,
    };

    if let Some(previous_report) = previous_snapshot {
        if can_compare_reports(&previous_report, &report) {
            report.comparison = Some(build_comparison(&previous_report, &report, &level_order));
        }
    }

    if options.save {
        persist_snapshot(&report, &options.snapshot_path)?;
    }

    Ok(report)
}

pub fn format_text_report(report: &HarnessFluencyReport) -> String {
    let next_level_readiness_line = if report.next_level_name.is_some()
        && report.next_level_readiness.is_none()
        && report.blocking_target_level == Some(report.overall_level.clone())
    {
        format!(
            "Next Level Readiness: Blocked until {} is stable",
            report.overall_level_name
        )
    } else {
        format!(
            "Next Level Readiness: {}",
            format_percent(report.next_level_readiness)
        )
    };
    let blocking_header = match &report.blocking_target_level_name {
        Some(name) if report.blocking_target_level == Some(report.overall_level.clone()) => {
            format!("Blocking Gaps To Stabilize {name}:")
        }
        Some(name) => format!("Blocking Gaps To {name}:"),
        None => "Blocking Gaps: none".to_string(),
    };

    let mut lines = vec![
        "HARNESS FLUENCY REPORT".to_string(),
        String::new(),
        format!("Repository: {}", report.repo_root),
        format!("Profile: {}", report.profile),
        format!("Model Version: {}", report.model_version),
        format!("Overall Level: {}", report.overall_level_name),
        format!(
            "Current Level Readiness: {}",
            format_percent(Some(report.current_level_readiness))
        ),
        format!(
            "Next Level: {}",
            report
                .next_level_name
                .clone()
                .unwrap_or_else(|| "Reached top level".to_string())
        ),
        next_level_readiness_line,
        String::new(),
        "Dimensions:".to_string(),
    ];

    let mut dimensions = report.dimensions.values().cloned().collect::<Vec<_>>();
    dimensions.sort_by(|left, right| left.name.cmp(&right.name));
    for dimension in dimensions {
        lines.push(format!(
            "- {}: {} ({})",
            dimension.name,
            dimension.level_name,
            format_percent(Some(dimension.score))
        ));
    }

    lines.push(String::new());
    lines.push(blocking_header);
    if report.blocking_target_level_name.is_some() {
        if report.blocking_criteria.is_empty() {
            lines.push("- None".to_string());
        } else {
            for criterion in &report.blocking_criteria {
                lines.push(format!("- {} — {}", criterion.id, criterion.evidence_hint));
            }
        }
    }

    lines.push(String::new());
    lines.push("Recommended Next Actions:".to_string());
    if report.recommendations.is_empty() {
        lines.push("- None".to_string());
    } else {
        for recommendation in &report.recommendations {
            lines.push(format!("- {}", recommendation.action));
        }
    }

    if let Some(comparison) = &report.comparison {
        lines.push(String::new());
        lines.push("Comparison To Last Snapshot:".to_string());
        lines.push(format!(
            "- Overall: {} ({} -> {})",
            level_change_label(&comparison.overall_change),
            comparison.previous_overall_level,
            report.overall_level
        ));
        lines.push(format!(
            "- Dimensions changed: {}",
            comparison
                .dimension_changes
                .iter()
                .filter(|entry| entry.change != LevelChange::Same)
                .count()
        ));
        lines.push(format!(
            "- Criteria changed: {}",
            comparison.criteria_changes.len()
        ));
    }

    lines.push(String::new());
    lines.push(format!("Snapshot: {}", report.snapshot_path));
    lines.join("\n")
}

fn build_cell_id(level: &str, dimension: &str) -> String {
    format!("{dimension}:{level}")
}

fn compile_patterns(patterns: &[&str]) -> Result<Vec<Pattern>, String> {
    patterns
        .iter()
        .map(|pattern| Pattern::new(pattern).map_err(|error| error.to_string()))
        .collect()
}

fn glob_match_options() -> MatchOptions {
    MatchOptions {
        case_sensitive: true,
        require_literal_separator: false,
        require_literal_leading_dot: false,
    }
}

fn is_ignored(relative_path: &Path, ignore_patterns: &[Pattern]) -> bool {
    ignore_patterns
        .iter()
        .any(|pattern| pattern.matches_path_with(relative_path, glob_match_options()))
}

fn keep_entry(entry: &DirEntry, repo_root: &Path, ignore_patterns: &[Pattern]) -> bool {
    if entry.path() == repo_root {
        return true;
    }

    entry
        .path()
        .strip_prefix(repo_root)
        .map(|relative| !is_ignored(relative, ignore_patterns))
        .unwrap_or(true)
}

fn collect_glob_matches(
    patterns: &[String],
    repo_root: &Path,
    ignore_patterns: &[Pattern],
    nodir: bool,
) -> Result<Vec<String>, String> {
    let compiled_patterns = patterns
        .iter()
        .map(|pattern| Pattern::new(pattern).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?;

    let mut matches = HashSet::new();
    for entry in WalkDir::new(repo_root)
        .into_iter()
        .filter_entry(|entry| keep_entry(entry, repo_root, ignore_patterns))
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.path() == repo_root {
            continue;
        }
        if nodir && entry.file_type().is_dir() {
            continue;
        }

        let relative = entry
            .path()
            .strip_prefix(repo_root)
            .map_err(|error| error.to_string())?;
        if compiled_patterns
            .iter()
            .any(|pattern| pattern.matches_path_with(relative, glob_match_options()))
        {
            matches.insert(path_to_slash(relative));
        }
    }

    let mut values = matches.into_iter().collect::<Vec<_>>();
    values.sort();
    Ok(values)
}

fn path_to_slash(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn normalize_absolute_path(base_path: &Path, target_path: &str) -> PathBuf {
    let candidate = Path::new(target_path);
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        base_path.join(candidate)
    }
}

fn path_exists(target_path: &Path) -> bool {
    target_path.exists()
}

fn read_text_file(context: &mut EvaluationContext, relative_path: &str) -> Result<String, String> {
    let absolute_path = normalize_absolute_path(&context.repo_root, relative_path);
    if let Some(cached) = context.text_cache.get(&absolute_path) {
        return Ok(cached.clone());
    }

    let content = fs::read_to_string(&absolute_path)
        .map_err(|error| format!("unable to read {}: {error}", relative_path))?;
    context.text_cache.insert(absolute_path, content.clone());
    Ok(content)
}

fn read_json_file(context: &mut EvaluationContext, relative_path: &str) -> Result<JsonValue, String> {
    let absolute_path = normalize_absolute_path(&context.repo_root, relative_path);
    if let Some(cached) = context.json_cache.get(&absolute_path) {
        return Ok(cached.clone());
    }

    let content = fs::read_to_string(&absolute_path)
        .map_err(|error| format!("unable to read {}: {error}", relative_path))?;
    let document = serde_json::from_str::<JsonValue>(&content)
        .map_err(|error| format!("unable to parse {}: {error}", relative_path))?;
    context.json_cache.insert(absolute_path, document.clone());
    Ok(document)
}

fn read_yaml_file(context: &mut EvaluationContext, relative_path: &str) -> Result<JsonValue, String> {
    let absolute_path = normalize_absolute_path(&context.repo_root, relative_path);
    if let Some(cached) = context.yaml_cache.get(&absolute_path) {
        return Ok(cached.clone());
    }

    let content = fs::read_to_string(&absolute_path)
        .map_err(|error| format!("unable to read {}: {error}", relative_path))?;
    let document = serde_yaml::from_str::<JsonValue>(&content)
        .map_err(|error| format!("unable to parse {}: {error}", relative_path))?;
    context.yaml_cache.insert(absolute_path, document.clone());
    Ok(document)
}

fn build_regex(pattern: &str, flags: &str, label: &str) -> Result<regex::Regex, String> {
    if pattern.len() > MAX_REGEX_PATTERN_LENGTH {
        return Err(format!(
            "{label}.pattern exceeds max length {MAX_REGEX_PATTERN_LENGTH}"
        ));
    }

    let mut builder = RegexBuilder::new(pattern);
    for flag in flags.chars() {
        match flag {
            'i' => {
                builder.case_insensitive(true);
            }
            'm' => {
                builder.multi_line(true);
            }
            's' => {
                builder.dot_matches_new_line(true);
            }
            'U' => {
                builder.swap_greed(true);
            }
            'u' => {
                builder.unicode(true);
            }
            'x' => {
                builder.ignore_whitespace(true);
            }
            'R' => {
                builder.crlf(true);
            }
            _ => {
                return Err(format!(
                    "{label} has invalid regex settings: unsupported flag '{flag}'"
                ));
            }
        }
    }

    builder
        .build()
        .map_err(|error| format!("{label} has invalid regex settings: {error}"))
}

fn test_regex_against_text(pattern: &str, flags: &str, text: &str, label: &str) -> Result<bool, String> {
    let regex = build_regex(pattern, flags, label)?;
    let capped = if text.len() > MAX_REGEX_INPUT_LENGTH {
        &text[..MAX_REGEX_INPUT_LENGTH]
    } else {
        text
    };
    Ok(regex.is_match(capped))
}

fn lookup_path<'a>(source: &'a JsonValue, spec: &[PathSegment]) -> Option<&'a JsonValue> {
    let mut current = source;
    for segment in spec {
        match segment {
            PathSegment::Index(index) => {
                let array = current.as_array()?;
                current = array.get(*index)?;
            }
            PathSegment::Key(key) => {
                let object = current.as_object()?;
                current = object.get(key)?;
            }
        }
    }
    Some(current)
}

fn evaluate_detector(
    detector: &DetectorDefinition,
    context: &mut EvaluationContext,
) -> Result<DetectorResult, String> {
    match detector {
        DetectorDefinition::FileExists { path } => {
            let exists = path_exists(&normalize_absolute_path(&context.repo_root, path));
            Ok(DetectorResult {
                status: if exists {
                    CriterionStatus::Pass
                } else {
                    CriterionStatus::Fail
                },
                detail: if exists {
                    format!("found {path}")
                } else {
                    format!("missing {path}")
                },
                evidence: if exists { vec![path.clone()] } else { Vec::new() },
            })
        }
        DetectorDefinition::FileContainsRegex {
            path,
            pattern,
            flags,
        } => match read_text_file(context, path) {
            Ok(content) => {
                let passed = test_regex_against_text(pattern, flags, &content, "file_contains_regex")?;
                Ok(DetectorResult {
                    status: if passed {
                        CriterionStatus::Pass
                    } else {
                        CriterionStatus::Fail
                    },
                    detail: if passed {
                        format!("content in {path} matched {pattern}")
                    } else {
                        format!("content in {path} did not match {pattern}")
                    },
                    evidence: if passed { vec![path.clone()] } else { Vec::new() },
                })
            }
            Err(error) => Ok(DetectorResult {
                status: CriterionStatus::Fail,
                detail: error,
                evidence: Vec::new(),
            }),
        },
        DetectorDefinition::AnyOf { detectors } => {
            let mut failures = Vec::new();
            let mut skipped_count = 0;
            for nested in detectors {
                let result = evaluate_detector(nested, context)?;
                if result.status == CriterionStatus::Pass {
                    return Ok(DetectorResult {
                        status: CriterionStatus::Pass,
                        detail: format!("matched {}: {}", nested.detector_type(), result.detail),
                        evidence: result.evidence,
                    });
                }
                if result.status == CriterionStatus::Skipped {
                    skipped_count += 1;
                }
                failures.push(format!("{}: {}", nested.detector_type(), result.detail));
            }

            if skipped_count == detectors.len() {
                return Ok(DetectorResult {
                    status: CriterionStatus::Skipped,
                    detail: "all alternatives were skipped".to_string(),
                    evidence: Vec::new(),
                });
            }

            Ok(DetectorResult {
                status: CriterionStatus::Fail,
                detail: format!("all alternatives failed: {}", failures.join(" | ")),
                evidence: Vec::new(),
            })
        }
        DetectorDefinition::AnyFileExists { paths } => {
            let matched = paths
                .iter()
                .filter(|candidate| path_exists(&normalize_absolute_path(&context.repo_root, candidate)))
                .cloned()
                .collect::<Vec<_>>();
            Ok(DetectorResult {
                status: if matched.is_empty() {
                    CriterionStatus::Fail
                } else {
                    CriterionStatus::Pass
                },
                detail: if matched.is_empty() {
                    format!("missing all candidates: {}", paths.join(", "))
                } else {
                    format!("found {}", matched.join(", "))
                },
                evidence: matched,
            })
        }
        DetectorDefinition::GlobCount { patterns, min } => match collect_glob_matches(
            patterns,
            &context.repo_root,
            &context.ignore_patterns,
            false,
        ) {
            Ok(matches) => Ok(DetectorResult {
                status: if matches.len() >= *min {
                    CriterionStatus::Pass
                } else {
                    CriterionStatus::Fail
                },
                detail: format!("matched {} paths (min {min})", matches.len()),
                evidence: matches.into_iter().take(10).collect(),
            }),
            Err(error) => Ok(DetectorResult {
                status: CriterionStatus::Fail,
                detail: format!("glob failed: {error}"),
                evidence: Vec::new(),
            }),
        },
        DetectorDefinition::GlobContainsRegex {
            patterns,
            pattern,
            flags,
            min_matches,
        } => match collect_glob_matches(patterns, &context.repo_root, &context.ignore_patterns, true) {
            Ok(candidates) => {
                let mut matched = Vec::new();
                for candidate in candidates.iter() {
                    let content = match read_text_file(context, candidate) {
                        Ok(content) => content,
                        Err(_) => continue,
                    };
                    if test_regex_against_text(pattern, flags, &content, "glob_contains_regex")? {
                        matched.push(candidate.clone());
                    }
                    if matched.len() >= *min_matches {
                        break;
                    }
                }

                Ok(DetectorResult {
                    status: if matched.len() >= *min_matches {
                        CriterionStatus::Pass
                    } else {
                        CriterionStatus::Fail
                    },
                    detail: format!(
                        "regex matched {} files (min {min_matches}) across {} candidates",
                        matched.len(),
                        candidates.len()
                    ),
                    evidence: matched.into_iter().take(10).collect(),
                })
            }
            Err(error) => Ok(DetectorResult {
                status: CriterionStatus::Fail,
                detail: format!("glob regex failed: {error}"),
                evidence: Vec::new(),
            }),
        },
        DetectorDefinition::JsonPathExists { path, json_path } => match read_json_file(context, path) {
            Ok(document) => {
                let resolved = lookup_path(&document, json_path);
                Ok(DetectorResult {
                    status: if resolved.is_some() {
                        CriterionStatus::Pass
                    } else {
                        CriterionStatus::Fail
                    },
                    detail: if resolved.is_some() {
                        format!("found JSON path {} in {path}", path_spec_label(json_path))
                    } else {
                        format!("missing JSON path {} in {path}", path_spec_label(json_path))
                    },
                    evidence: if resolved.is_some() { vec![path.clone()] } else { Vec::new() },
                })
            }
            Err(error) => Ok(DetectorResult {
                status: CriterionStatus::Fail,
                detail: error,
                evidence: Vec::new(),
            }),
        },
        DetectorDefinition::YamlPathExists { path, yaml_path } => match read_yaml_file(context, path) {
            Ok(document) => {
                let resolved = lookup_path(&document, yaml_path);
                Ok(DetectorResult {
                    status: if resolved.is_some() {
                        CriterionStatus::Pass
                    } else {
                        CriterionStatus::Fail
                    },
                    detail: if resolved.is_some() {
                        format!("found YAML path {} in {path}", path_spec_label(yaml_path))
                    } else {
                        format!("missing YAML path {} in {path}", path_spec_label(yaml_path))
                    },
                    evidence: if resolved.is_some() { vec![path.clone()] } else { Vec::new() },
                })
            }
            Err(error) => Ok(DetectorResult {
                status: CriterionStatus::Fail,
                detail: error,
                evidence: Vec::new(),
            }),
        },
        DetectorDefinition::CommandExitCode {
            command,
            expected_exit_code,
            timeout_ms,
        } => match run_command(command, &context.repo_root, *timeout_ms) {
            Ok(result) => Ok(DetectorResult {
                status: if result.exit_code == *expected_exit_code {
                    CriterionStatus::Pass
                } else {
                    CriterionStatus::Fail
                },
                detail: if result.timed_out {
                    format!("command timed out after {timeout_ms}ms")
                } else {
                    format!(
                        "exit code {}, expected {}",
                        result.exit_code, expected_exit_code
                    )
                },
                evidence: if result.output.is_empty() {
                    Vec::new()
                } else {
                    vec![result.output]
                },
            }),
            Err(error) => Ok(build_command_failure(error)),
        },
        DetectorDefinition::CommandOutputRegex {
            command,
            pattern,
            flags,
            expected_exit_code,
            timeout_ms,
        } => match run_command(command, &context.repo_root, *timeout_ms) {
            Ok(result) => {
                let passed = !result.timed_out
                    && result.exit_code == *expected_exit_code
                    && test_regex_against_text(
                        pattern,
                        flags,
                        &result.output,
                        "command_output_regex",
                    )?;
                Ok(DetectorResult {
                    status: if passed {
                        CriterionStatus::Pass
                    } else {
                        CriterionStatus::Fail
                    },
                    detail: if result.timed_out {
                        format!("command timed out after {timeout_ms}ms")
                    } else if passed {
                        format!("command output matched {pattern}")
                    } else {
                        format!("command output did not match {pattern}")
                    },
                    evidence: if result.output.is_empty() {
                        Vec::new()
                    } else {
                        vec![result.output]
                    },
                })
            }
            Err(error) => Ok(build_command_failure(error)),
        },
        DetectorDefinition::ManualAttestation { prompt } => Ok(DetectorResult {
            status: CriterionStatus::Skipped,
            detail: format!("manual attestation required: {prompt}"),
            evidence: Vec::new(),
        }),
    }
}

fn build_command_failure(error: String) -> DetectorResult {
    DetectorResult {
        status: CriterionStatus::Fail,
        detail: error,
        evidence: Vec::new(),
    }
}

fn evaluate_criterion(
    criterion: &FluencyCriterion,
    context: &mut EvaluationContext,
) -> Result<CriterionResult, String> {
    let detector_result = evaluate_detector(&criterion.detector, context)?;
    Ok(CriterionResult {
        id: criterion.id.clone(),
        level: criterion.level.clone(),
        dimension: criterion.dimension.clone(),
        weight: criterion.weight,
        critical: criterion.critical,
        status: detector_result.status,
        detector_type: criterion.detector.detector_type().to_string(),
        detail: detector_result.detail,
        evidence: detector_result.evidence,
        why_it_matters: criterion.why_it_matters.clone(),
        recommended_action: criterion.recommended_action.clone(),
        evidence_hint: criterion.evidence_hint.clone(),
    })
}

fn deterministic_priority(detector_type: &str) -> u8 {
    if detector_type == "manual_attestation" {
        1
    } else {
        0
    }
}

fn compare_level_ids(
    previous_level: &str,
    current_level: &str,
    order: &HashMap<String, usize>,
) -> LevelChange {
    let previous_index = order.get(previous_level).copied().unwrap_or(usize::MAX);
    let current_index = order.get(current_level).copied().unwrap_or(usize::MAX);
    if previous_index == current_index {
        LevelChange::Same
    } else if current_index > previous_index {
        LevelChange::Up
    } else {
        LevelChange::Down
    }
}

fn collect_recommendations(criteria: &[CriterionResult]) -> Vec<Recommendation> {
    let mut deduped = HashSet::new();
    let mut sorted = criteria
        .iter()
        .filter(|criterion| criterion.status == CriterionStatus::Fail)
        .cloned()
        .collect::<Vec<_>>();
    sorted.sort_by(|left, right| {
        right
            .critical
            .cmp(&left.critical)
            .then(right.weight.cmp(&left.weight))
            .then(
                deterministic_priority(&left.detector_type)
                    .cmp(&deterministic_priority(&right.detector_type)),
            )
            .then(left.id.cmp(&right.id))
    });

    sorted
        .into_iter()
        .filter(|criterion| deduped.insert(criterion.recommended_action.clone()))
        .take(MAX_RECOMMENDATIONS)
        .map(|criterion| Recommendation {
            criterion_id: criterion.id,
            action: criterion.recommended_action,
            why_it_matters: criterion.why_it_matters,
            evidence_hint: criterion.evidence_hint,
            critical: criterion.critical,
            weight: criterion.weight,
        })
        .collect()
}

fn average_cell_scores(
    dimensions: &[FluencyDimension],
    cell_by_id: &HashMap<String, CellResult>,
    level_id: &str,
) -> f64 {
    let total: f64 = dimensions
        .iter()
        .map(|dimension| {
            cell_by_id
                .get(&build_cell_id(level_id, &dimension.id))
                .map(|cell| cell.score)
                .unwrap_or(0.0)
        })
        .sum();
    total / dimensions.len() as f64
}

fn collect_failing_criteria_for_level(
    dimensions: &[FluencyDimension],
    cell_by_id: &HashMap<String, CellResult>,
    level_id: &str,
) -> Vec<CriterionResult> {
    let mut failing = Vec::new();
    for dimension in dimensions {
        if let Some(cell) = cell_by_id.get(&build_cell_id(level_id, &dimension.id)) {
            if !cell.passed {
                failing.extend(
                    cell.criteria
                        .iter()
                        .filter(|criterion| criterion.status == CriterionStatus::Fail)
                        .cloned(),
                );
            }
        }
    }
    failing
}

fn load_previous_snapshot(snapshot_path: &Path) -> Result<Option<HarnessFluencyReport>, String> {
    if !snapshot_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(snapshot_path)
        .map_err(|error| format!("unable to read snapshot {}: {error}", snapshot_path.display()))?;
    let report = serde_json::from_str::<HarnessFluencyReport>(&content).map_err(|error| {
        format!(
            "unable to parse snapshot {}: {error}",
            snapshot_path.display()
        )
    })?;
    Ok(Some(report))
}

fn build_comparison(
    previous_report: &HarnessFluencyReport,
    current_report: &HarnessFluencyReport,
    level_order: &HashMap<String, usize>,
) -> ReportComparison {
    let mut dimension_changes = current_report
        .dimensions
        .values()
        .map(|dimension| {
            let previous_dimension = previous_report.dimensions.get(&dimension.dimension);
            DimensionChange {
                dimension: dimension.dimension.clone(),
                previous_level: previous_dimension
                    .map(|entry| entry.level.clone())
                    .unwrap_or_else(|| "unknown".to_string()),
                current_level: dimension.level.clone(),
                change: previous_dimension
                    .map(|entry| compare_level_ids(&entry.level, &dimension.level, level_order))
                    .unwrap_or(LevelChange::Up),
            }
        })
        .collect::<Vec<_>>();
    dimension_changes.sort_by(|left, right| left.dimension.cmp(&right.dimension));

    let previous_criteria = previous_report
        .criteria
        .iter()
        .map(|criterion| (criterion.id.clone(), criterion.status.clone()))
        .collect::<HashMap<_, _>>();
    let current_criteria = current_report
        .criteria
        .iter()
        .map(|criterion| (criterion.id.clone(), criterion.status.clone()))
        .collect::<HashMap<_, _>>();

    let mut all_ids = previous_criteria
        .keys()
        .chain(current_criteria.keys())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    all_ids.sort();

    let criteria_changes = all_ids
        .into_iter()
        .filter_map(|id| {
            let previous_status = previous_criteria.get(&id).cloned();
            let current_status = current_criteria.get(&id).cloned();
            if previous_status == current_status {
                None
            } else {
                Some(CriterionChange {
                    id,
                    previous_status,
                    current_status,
                })
            }
        })
        .collect::<Vec<_>>();

    ReportComparison {
        previous_generated_at: previous_report.generated_at.clone(),
        previous_overall_level: previous_report.overall_level.clone(),
        overall_change: compare_level_ids(
            &previous_report.overall_level,
            &current_report.overall_level,
            level_order,
        ),
        dimension_changes,
        criteria_changes,
    }
}

fn can_compare_reports(
    previous_report: &HarnessFluencyReport,
    current_report: &HarnessFluencyReport,
) -> bool {
    previous_report.model_version == current_report.model_version
        && previous_report.profile == current_report.profile
}

fn persist_snapshot(report: &HarnessFluencyReport, snapshot_path: &Path) -> Result<(), String> {
    if let Some(parent) = snapshot_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("unable to create {}: {error}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(report)
        .map_err(|error| format!("unable to serialize report: {error}"))?;
    fs::write(snapshot_path, format!("{json}\n"))
        .map_err(|error| format!("unable to write {}: {error}", snapshot_path.display()))
}

fn format_percent(value: Option<f64>) -> String {
    match value {
        Some(value) => format!("{}%", (value * 100.0).round() as i64),
        None => "n/a".to_string(),
    }
}

fn level_change_label(change: &LevelChange) -> &'static str {
    match change {
        LevelChange::Same => "same",
        LevelChange::Up => "up",
        LevelChange::Down => "down",
    }
}

fn path_spec_label(spec: &[PathSegment]) -> String {
    spec.iter()
        .map(|segment| match segment {
            PathSegment::Key(key) => key.clone(),
            PathSegment::Index(index) => index.to_string(),
        })
        .collect::<Vec<_>>()
        .join(".")
}

fn parse_command(command: &str) -> Result<(String, Vec<String>), String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaping = false;

    let push_current = |tokens: &mut Vec<String>, current: &mut String| {
        if !current.is_empty() {
            tokens.push(std::mem::take(current));
        }
    };

    for ch in command.chars() {
        if escaping {
            current.push(ch);
            escaping = false;
            continue;
        }

        if ch == '\\' {
            escaping = true;
            continue;
        }

        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }

        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            continue;
        }

        if ch.is_whitespace() {
            push_current(&mut tokens, &mut current);
            continue;
        }

        current.push(ch);
    }

    if escaping || quote.is_some() {
        return Err("command contains unterminated escaping or quotes".to_string());
    }

    push_current(&mut tokens, &mut current);
    if tokens.is_empty() {
        return Err("command must not be empty".to_string());
    }

    Ok((tokens[0].clone(), tokens[1..].to_vec()))
}

fn validate_executable(executable: &str) -> Result<(), String> {
    if executable.contains('/') || executable.contains('\\') {
        return Err(format!(
            "command executable \"{executable}\" must be a bare allowlisted name"
        ));
    }

    let command_name = Path::new(executable)
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or(executable);
    if !ALLOWED_COMMAND_EXECUTABLES.contains(&command_name) {
        return Err(format!(
            "command executable \"{command_name}\" is not allowed"
        ));
    }

    Ok(())
}

fn read_pipe(mut pipe: impl Read + Send + 'static) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = pipe.read_to_end(&mut buffer);
        String::from_utf8_lossy(&buffer).to_string()
    })
}

fn run_command(command: &str, repo_root: &Path, timeout_ms: u64) -> Result<CommandExecutionResult, String> {
    let (executable, args) = parse_command(command)?;
    validate_executable(&executable)?;

    let mut child = Command::new(&executable)
        .args(&args)
        .current_dir(repo_root)
        .env("PATH", routa_core::shell_env::full_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    let stdout_handle = child
        .stdout
        .take()
        .map(read_pipe)
        .ok_or_else(|| "failed to capture command stdout".to_string())?;
    let stderr_handle = child
        .stderr
        .take()
        .map(read_pipe)
        .ok_or_else(|| "failed to capture command stderr".to_string())?;

    let start = Instant::now();
    let timeout = Duration::from_millis(timeout_ms);
    let (status, timed_out) = loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => break (status, false),
            None if start.elapsed() >= timeout => {
                let _ = child.kill();
                let status = child.wait().map_err(|error| error.to_string())?;
                break (status, true);
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    };

    let stdout = stdout_handle
        .join()
        .map_err(|_| "failed to join stdout reader".to_string())?;
    let stderr = stderr_handle
        .join()
        .map_err(|_| "failed to join stderr reader".to_string())?;
    let output = format!("{stdout}{stderr}").trim().to_string();

    Ok(CommandExecutionResult {
        exit_code: status.code().unwrap_or(1),
        output,
        timed_out,
    })
}

fn load_fluency_model(model_path: &Path) -> Result<FluencyModel, String> {
    let raw_model = load_raw_fluency_model(model_path, &mut HashSet::new())?;
    let root = expect_object(&raw_model, "harness fluency model")?;

    let levels_raw = expect_array(get_required(root, "levels", "model.levels")?, "model.levels")?;
    if levels_raw.is_empty() {
        return Err("harness fluency model.levels must be a non-empty array".to_string());
    }
    let mut levels = Vec::with_capacity(levels_raw.len());
    for (index, entry) in levels_raw.iter().enumerate() {
        let record = expect_object(entry, &format!("levels[{index}]"))?;
        levels.push(FluencyLevel {
            id: expect_string(
                get_required(record, "id", &format!("levels[{index}].id"))?,
                &format!("levels[{index}].id"),
            )?,
            name: expect_string(
                get_required(record, "name", &format!("levels[{index}].name"))?,
                &format!("levels[{index}].name"),
            )?,
        });
    }

    let dimensions_raw =
        expect_array(get_required(root, "dimensions", "model.dimensions")?, "model.dimensions")?;
    if dimensions_raw.is_empty() {
        return Err("harness fluency model.dimensions must be a non-empty array".to_string());
    }
    let mut dimensions = Vec::with_capacity(dimensions_raw.len());
    for (index, entry) in dimensions_raw.iter().enumerate() {
        let record = expect_object(entry, &format!("dimensions[{index}]"))?;
        dimensions.push(FluencyDimension {
            id: expect_string(
                get_required(record, "id", &format!("dimensions[{index}].id"))?,
                &format!("dimensions[{index}].id"),
            )?,
            name: expect_string(
                get_required(record, "name", &format!("dimensions[{index}].name"))?,
                &format!("dimensions[{index}].name"),
            )?,
        });
    }

    let level_ids = levels
        .iter()
        .map(|level| level.id.clone())
        .collect::<HashSet<_>>();
    if level_ids.len() != levels.len() {
        return Err("harness fluency model.levels contains duplicate ids".to_string());
    }
    let dimension_ids = dimensions
        .iter()
        .map(|dimension| dimension.id.clone())
        .collect::<HashSet<_>>();
    if dimension_ids.len() != dimensions.len() {
        return Err("harness fluency model.dimensions contains duplicate ids".to_string());
    }

    let criteria_raw =
        expect_array(get_required(root, "criteria", "model.criteria")?, "model.criteria")?;
    if criteria_raw.is_empty() {
        return Err("harness fluency model.criteria must be a non-empty array".to_string());
    }
    let mut criteria = Vec::with_capacity(criteria_raw.len());
    for (index, entry) in criteria_raw.iter().enumerate() {
        let record = expect_object(entry, &format!("criteria[{index}]"))?;
        let level = expect_string(
            get_required(record, "level", &format!("criteria[{index}].level"))?,
            &format!("criteria[{index}].level"),
        )?;
        let dimension = expect_string(
            get_required(record, "dimension", &format!("criteria[{index}].dimension"))?,
            &format!("criteria[{index}].dimension"),
        )?;
        if !level_ids.contains(&level) {
            return Err(format!(
                "criteria[{index}].level references unknown level \"{level}\""
            ));
        }
        if !dimension_ids.contains(&dimension) {
            return Err(format!(
                "criteria[{index}].dimension references unknown dimension \"{dimension}\""
            ));
        }

        criteria.push(FluencyCriterion {
            id: expect_string(
                get_required(record, "id", &format!("criteria[{index}].id"))?,
                &format!("criteria[{index}].id"),
            )?,
            level,
            dimension,
            weight: expect_u32(record.get("weight"), &format!("criteria[{index}].weight"), 1)?,
            critical: expect_bool(record.get("critical"), &format!("criteria[{index}].critical"), false)?,
            why_it_matters: expect_string(
                get_required(record, "why_it_matters", &format!("criteria[{index}].why_it_matters"))?,
                &format!("criteria[{index}].why_it_matters"),
            )?,
            recommended_action: expect_string(
                get_required(
                    record,
                    "recommended_action",
                    &format!("criteria[{index}].recommended_action"),
                )?,
                &format!("criteria[{index}].recommended_action"),
            )?,
            evidence_hint: expect_string(
                get_required(record, "evidence_hint", &format!("criteria[{index}].evidence_hint"))?,
                &format!("criteria[{index}].evidence_hint"),
            )?,
            detector: parse_detector(
                get_required(record, "detector", &format!("criteria[{index}].detector"))?,
                &format!("criteria[{index}].detector"),
            )?,
        });
    }

    let criterion_ids = criteria
        .iter()
        .map(|criterion| criterion.id.clone())
        .collect::<HashSet<_>>();
    if criterion_ids.len() != criteria.len() {
        return Err("harness fluency model.criteria contains duplicate ids".to_string());
    }

    for level in &levels {
        for dimension in &dimensions {
            let count = criteria
                .iter()
                .filter(|criterion| criterion.level == level.id && criterion.dimension == dimension.id)
                .count();
            if count < 2 {
                return Err(format!(
                    "cell {} × {} must declare at least 2 criteria",
                    dimension.id, level.id
                ));
            }
        }
    }

    Ok(FluencyModel {
        version: expect_u32(root.get("version"), "model.version", 1)?,
        levels,
        dimensions,
        criteria,
    })
}

fn load_raw_fluency_model(
    model_path: &Path,
    visited: &mut HashSet<PathBuf>,
) -> Result<JsonValue, String> {
    let resolved_model_path = if model_path.is_absolute() {
        model_path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join(model_path)
    };

    if visited.contains(&resolved_model_path) {
        return Err(format!(
            "cyclic harness fluency model extends detected at {}",
            resolved_model_path.display()
        ));
    }

    visited.insert(resolved_model_path.clone());
    let raw_content = fs::read_to_string(&resolved_model_path)
        .map_err(|error| format!("unable to read {}: {error}", resolved_model_path.display()))?;
    let raw_model = serde_yaml::from_str::<JsonValue>(&raw_content)
        .map_err(|error| format!("unable to parse {}: {error}", resolved_model_path.display()))?;
    let raw_object = expect_object(&raw_model, "harness fluency model")?;

    let extends_path = raw_object.get("extends").cloned();
    if extends_path.is_none() {
        visited.remove(&resolved_model_path);
        return Ok(raw_model);
    }

    let extends_value = extends_path.expect("checked above");
    let extends_relative = expect_string(&extends_value, "model.extends")?;
    let base_model_path = resolved_model_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(extends_relative);
    let base_model = load_raw_fluency_model(&base_model_path, visited)?;
    visited.remove(&resolved_model_path);

    let base_object = expect_object(&base_model, "base harness fluency model")?;
    let mut merged = base_object.clone();
    for (key, value) in raw_object {
        merged.insert(key.clone(), value.clone());
    }
    merged.remove("extends");

    if let Some(raw_criteria) = raw_object.get("criteria") {
        let base_criteria = expect_array(
            base_object
                .get("criteria")
                .ok_or_else(|| "base model.criteria must be an array".to_string())?,
            "base model.criteria",
        )?;
        let raw_criteria = expect_array(raw_criteria, "model.criteria")?;
        let mut merged_criteria = base_criteria.to_vec();
        merged_criteria.extend(raw_criteria.iter().cloned());
        merged.insert("criteria".to_string(), JsonValue::Array(merged_criteria));
    }

    Ok(JsonValue::Object(merged))
}

fn get_required<'a>(
    object: &'a JsonMap<String, JsonValue>,
    key: &str,
    label: &str,
) -> Result<&'a JsonValue, String> {
    object
        .get(key)
        .ok_or_else(|| format!("{label} must be present"))
}

fn expect_object<'a>(
    value: &'a JsonValue,
    label: &str,
) -> Result<&'a JsonMap<String, JsonValue>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("{label} must be an object"))
}

fn expect_array<'a>(value: &'a JsonValue, label: &str) -> Result<&'a Vec<JsonValue>, String> {
    value
        .as_array()
        .ok_or_else(|| format!("{label} must be a non-empty array"))
}

fn expect_string(value: &JsonValue, label: &str) -> Result<String, String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{label} must be a non-empty string"))
}

fn expect_bool(value: Option<&JsonValue>, label: &str, default: bool) -> Result<bool, String> {
    match value {
        None => Ok(default),
        Some(value) => value
            .as_bool()
            .ok_or_else(|| format!("{label} must be a boolean")),
    }
}

fn expect_u32(value: Option<&JsonValue>, label: &str, default: u32) -> Result<u32, String> {
    match value {
        None => Ok(default),
        Some(value) => value
            .as_u64()
            .and_then(|number| u32::try_from(number).ok())
            .ok_or_else(|| format!("{label} must be a number")),
    }
}

fn expect_usize(value: Option<&JsonValue>, label: &str, default: usize) -> Result<usize, String> {
    match value {
        None => Ok(default),
        Some(value) => value
            .as_u64()
            .and_then(|number| usize::try_from(number).ok())
            .ok_or_else(|| format!("{label} must be a number")),
    }
}

fn expect_i32(value: Option<&JsonValue>, label: &str, default: i32) -> Result<i32, String> {
    match value {
        None => Ok(default),
        Some(value) => value
            .as_i64()
            .and_then(|number| i32::try_from(number).ok())
            .ok_or_else(|| format!("{label} must be a number")),
    }
}

fn expect_u64(value: Option<&JsonValue>, label: &str, default: u64) -> Result<u64, String> {
    match value {
        None => Ok(default),
        Some(value) => value
            .as_u64()
            .ok_or_else(|| format!("{label} must be a number")),
    }
}

fn parse_string_array(value: &JsonValue, label: &str) -> Result<Vec<String>, String> {
    let items = expect_array(value, label)?;
    if items.is_empty() {
        return Err(format!("{label} must be a non-empty array"));
    }

    items.iter()
        .enumerate()
        .map(|(index, item)| expect_string(item, &format!("{label}[{index}]")))
        .collect()
}

fn parse_path_spec(value: &JsonValue, label: &str) -> Result<Vec<PathSegment>, String> {
    if let Some(raw) = value.as_str() {
        let parts = raw
            .split('.')
            .map(str::trim)
            .filter(|segment| !segment.is_empty())
            .map(|segment| match segment.parse::<usize>() {
                Ok(index) => PathSegment::Index(index),
                Err(_) => PathSegment::Key(segment.to_string()),
            })
            .collect::<Vec<_>>();
        if parts.is_empty() {
            return Err(format!("{label} must be a non-empty path array or dotted string"));
        }
        return Ok(parts);
    }

    let items = expect_array(value, label)?;
    if items.is_empty() {
        return Err(format!("{label} must be a non-empty path array or dotted string"));
    }

    items.iter()
        .map(|segment| {
            if let Some(value) = segment.as_str() {
                if value.is_empty() {
                    return Err(format!("{label} contains an invalid segment"));
                }
                return Ok(PathSegment::Key(value.to_string()));
            }
            if let Some(value) = segment.as_u64() {
                return usize::try_from(value)
                    .map(PathSegment::Index)
                    .map_err(|_| format!("{label} contains an invalid segment"));
            }
            Err(format!("{label} contains an invalid segment"))
        })
        .collect()
}

fn parse_regex_settings(
    detector: &JsonMap<String, JsonValue>,
    label: &str,
    default_flags: &str,
) -> Result<(String, String), String> {
    let pattern = expect_string(
        get_required(detector, "pattern", &format!("{label}.pattern"))?,
        &format!("{label}.pattern"),
    )?;
    let flags = match detector.get("flags") {
        Some(value) => value
            .as_str()
            .map(ToOwned::to_owned)
            .ok_or_else(|| format!("{label}.flags must be a string"))?,
        None => default_flags.to_string(),
    };
    let _ = build_regex(&pattern, &flags, label)?;
    Ok((pattern, flags))
}

fn parse_detector(value: &JsonValue, label: &str) -> Result<DetectorDefinition, String> {
    let detector = expect_object(value, label)?;
    let detector_type = expect_string(
        get_required(detector, "type", &format!("{label}.type"))?,
        &format!("{label}.type"),
    )?;

    match detector_type.as_str() {
        "file_exists" => Ok(DetectorDefinition::FileExists {
            path: expect_string(
                get_required(detector, "path", &format!("{label}.path"))?,
                &format!("{label}.path"),
            )?,
        }),
        "file_contains_regex" => {
            let (pattern, flags) = parse_regex_settings(detector, label, "i")?;
            Ok(DetectorDefinition::FileContainsRegex {
                path: expect_string(
                    get_required(detector, "path", &format!("{label}.path"))?,
                    &format!("{label}.path"),
                )?,
                pattern,
                flags,
            })
        }
        "any_of" => {
            let nested = expect_array(
                get_required(detector, "detectors", &format!("{label}.detectors"))?,
                &format!("{label}.detectors"),
            )?;
            if nested.is_empty() {
                return Err(format!("{label}.detectors must be a non-empty array"));
            }
            Ok(DetectorDefinition::AnyOf {
                detectors: nested
                    .iter()
                    .enumerate()
                    .map(|(index, item)| {
                        parse_detector(item, &format!("{label}.detectors[{index}]"))
                    })
                    .collect::<Result<Vec<_>, _>>()?,
            })
        }
        "any_file_exists" => Ok(DetectorDefinition::AnyFileExists {
            paths: parse_string_array(
                get_required(detector, "paths", &format!("{label}.paths"))?,
                &format!("{label}.paths"),
            )?,
        }),
        "glob_count" => Ok(DetectorDefinition::GlobCount {
            patterns: if let Some(patterns) = detector.get("patterns") {
                parse_string_array(patterns, &format!("{label}.patterns"))?
            } else {
                vec![expect_string(
                    get_required(detector, "pattern", &format!("{label}.pattern"))?,
                    &format!("{label}.pattern"),
                )?]
            },
            min: expect_usize(detector.get("min"), &format!("{label}.min"), 1)?,
        }),
        "glob_contains_regex" => {
            let (pattern, flags) = parse_regex_settings(detector, label, "i")?;
            Ok(DetectorDefinition::GlobContainsRegex {
                patterns: if let Some(patterns) = detector.get("patterns") {
                    parse_string_array(patterns, &format!("{label}.patterns"))?
                } else {
                    vec![expect_string(
                        get_required(detector, "pattern_glob", &format!("{label}.pattern_glob"))?,
                        &format!("{label}.pattern_glob"),
                    )?]
                },
                pattern,
                flags,
                min_matches: expect_usize(
                    detector.get("minMatches"),
                    &format!("{label}.minMatches"),
                    1,
                )?,
            })
        }
        "json_path_exists" => Ok(DetectorDefinition::JsonPathExists {
            path: expect_string(
                get_required(detector, "path", &format!("{label}.path"))?,
                &format!("{label}.path"),
            )?,
            json_path: parse_path_spec(
                get_required(detector, "jsonPath", &format!("{label}.jsonPath"))?,
                &format!("{label}.jsonPath"),
            )?,
        }),
        "yaml_path_exists" => Ok(DetectorDefinition::YamlPathExists {
            path: expect_string(
                get_required(detector, "path", &format!("{label}.path"))?,
                &format!("{label}.path"),
            )?,
            yaml_path: parse_path_spec(
                get_required(detector, "yamlPath", &format!("{label}.yamlPath"))?,
                &format!("{label}.yamlPath"),
            )?,
        }),
        "command_exit_code" => Ok(DetectorDefinition::CommandExitCode {
            command: expect_string(
                get_required(detector, "command", &format!("{label}.command"))?,
                &format!("{label}.command"),
            )?,
            expected_exit_code: expect_i32(
                detector.get("expectedExitCode"),
                &format!("{label}.expectedExitCode"),
                0,
            )?,
            timeout_ms: expect_u64(detector.get("timeoutMs"), &format!("{label}.timeoutMs"), 10_000)?,
        }),
        "command_output_regex" => {
            let (pattern, flags) = parse_regex_settings(detector, label, "i")?;
            Ok(DetectorDefinition::CommandOutputRegex {
                command: expect_string(
                    get_required(detector, "command", &format!("{label}.command"))?,
                    &format!("{label}.command"),
                )?,
                pattern,
                flags,
                expected_exit_code: expect_i32(
                    detector.get("expectedExitCode"),
                    &format!("{label}.expectedExitCode"),
                    0,
                )?,
                timeout_ms: expect_u64(
                    detector.get("timeoutMs"),
                    &format!("{label}.timeoutMs"),
                    10_000,
                )?,
            })
        }
        "manual_attestation" => Ok(DetectorDefinition::ManualAttestation {
            prompt: expect_string(
                get_required(detector, "prompt", &format!("{label}.prompt"))?,
                &format!("{label}.prompt"),
            )?,
        }),
        _ => Err(format!("{label}.type \"{detector_type}\" is not supported")),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        evaluate_harness_fluency, format_text_report, load_fluency_model, EvaluateOptions,
    };
    use serde_json::json;
    use std::fs::{create_dir_all, write};
    use std::path::Path;
    use tempfile::tempdir;

    fn write_json(path: &Path, value: serde_json::Value) {
        write(path, format!("{}\n", serde_json::to_string_pretty(&value).unwrap())).unwrap();
    }

    #[test]
    fn loads_generic_model_and_enforces_two_criteria_per_cell() {
        let model = load_fluency_model(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .parent()
                .unwrap()
                .join("docs/fitness/harness-fluency.model.yaml")
                .as_path(),
        )
        .expect("model");

        assert_eq!(model.levels.len(), 5);
        assert_eq!(model.dimensions.len(), 5);
        assert_eq!(model.criteria.len(), 50);

        for level in &model.levels {
            for dimension in &model.dimensions {
                let count = model
                    .criteria
                    .iter()
                    .filter(|criterion| criterion.level == level.id && criterion.dimension == dimension.id)
                    .count();
                assert!(count >= 2, "missing coverage for {} × {}", dimension.id, level.id);
            }
        }
    }

    #[test]
    fn evaluates_snapshots_commands_and_manual_attestation() {
        let repo = tempdir().unwrap();
        let repo_root = repo.path();
        create_dir_all(repo_root.join("docs/fitness")).unwrap();
        create_dir_all(repo_root.join("docs/issues")).unwrap();
        create_dir_all(repo_root.join(".claude/skills")).unwrap();

        write(repo_root.join(".claude/skills/README.md"), "skill\n").unwrap();
        write(repo_root.join("docs/issues/one.md"), "# one\n").unwrap();
        write(repo_root.join("docs/issues/two.md"), "# two\n").unwrap();

        let model_path = repo_root.join("docs/fitness/model.yaml");
        let snapshot_path = repo_root.join("docs/fitness/latest.json");
        write(
            &model_path,
            r#"version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.skill_dir
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: skills matter
    recommended_action: add skills
    evidence_hint: .claude/skills
    detector:
      type: any_file_exists
      paths:
        - .claude/skills
        - .agents/skills
  - id: collaboration.awareness.issue_history
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: history matters
    recommended_action: add issues
    evidence_hint: docs/issues/*.md
    detector:
      type: glob_count
      patterns:
        - docs/issues/*.md
      min: 2
  - id: collaboration.assisted.command_exit
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: command checks matter
    recommended_action: add command checks
    evidence_hint: node -p 1
    detector:
      type: command_exit_code
      command: node -p 1
      expectedExitCode: 0
  - id: collaboration.assisted.command_output
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: output checks matter
    recommended_action: add output checks
    evidence_hint: node -p process.platform
    detector:
      type: command_output_regex
      command: node -p process.platform
      pattern: ^(darwin|linux|win32)$
      flags: ""
  - id: collaboration.assisted.attestation
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: manual checks matter
    recommended_action: document manual checks
    evidence_hint: manual prompt
    detector:
      type: manual_attestation
      prompt: Confirm org process
"#,
        )
        .unwrap();

        let report = evaluate_harness_fluency(&EvaluateOptions {
            repo_root: repo_root.to_path_buf(),
            model_path,
            profile: "generic".to_string(),
            snapshot_path,
            compare_last: false,
            save: false,
        })
        .expect("report");

        assert_eq!(report.overall_level, "assisted");
        assert!(report.criteria.iter().any(|criterion| {
            criterion.id == "collaboration.assisted.command_exit"
                && criterion.status == super::CriterionStatus::Pass
        }));
        assert!(report.criteria.iter().any(|criterion| {
            criterion.id == "collaboration.assisted.attestation"
                && criterion.status == super::CriterionStatus::Skipped
        }));
    }

    #[test]
    fn ignores_generated_and_workspace_noise_in_glob_detectors() {
        let repo = tempdir().unwrap();
        let repo_root = repo.path();
        create_dir_all(repo_root.join("docs/fitness")).unwrap();
        create_dir_all(repo_root.join(".routa/repos/demo/tests")).unwrap();
        create_dir_all(repo_root.join(".next-page-snapshots/dev/server/chunks")).unwrap();
        create_dir_all(repo_root.join("frontend/_next/static/chunks")).unwrap();
        create_dir_all(repo_root.join(".worktrees/demo/tests")).unwrap();
        create_dir_all(repo_root.join("tests")).unwrap();

        write(repo_root.join("README.md"), "# repo\n").unwrap();
        write(repo_root.join(".routa/repos/demo/tests/fake.spec.ts"), "fake\n").unwrap();
        write(repo_root.join(".worktrees/demo/tests/fake.spec.ts"), "fake\n").unwrap();
        write(
            repo_root.join(".next-page-snapshots/dev/server/chunks/runtime.ts"),
            "export class RuntimeManager {}\n",
        )
        .unwrap();
        write(
            repo_root.join("frontend/_next/static/chunks/runtime.js"),
            "export class RuntimeManager {}\n",
        )
        .unwrap();
        write(repo_root.join("tests/app.spec.ts"), "real\n").unwrap();

        let model_path = repo_root.join("docs/fitness/model.yaml");
        let snapshot_path = repo_root.join("docs/fitness/latest.json");
        write(
            &model_path,
            r#"version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.readme
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: readme
    recommended_action: readme
    evidence_hint: README.md
    detector:
      type: file_exists
      path: README.md
  - id: collaboration.awareness.readme_text
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: readme text
    recommended_action: readme text
    evidence_hint: README.md
    detector:
      type: file_contains_regex
      path: README.md
      pattern: repo
      flags: i
  - id: collaboration.assisted.real_tests
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: real tests
    recommended_action: real tests
    evidence_hint: tests/**/*.spec.ts
    detector:
      type: glob_count
      patterns:
        - tests/**/*.spec.ts
        - .routa/**/*.spec.ts
        - .worktrees/**/*.spec.ts
      min: 2
  - id: collaboration.assisted.real_runtime
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: runtime
    recommended_action: runtime
    evidence_hint: tests/**/*.spec.ts
    detector:
      type: glob_contains_regex
      patterns:
        - tests/**/*.spec.ts
        - .next-page-snapshots/**/*.ts
        - frontend/_next/**/*.js
      pattern: RuntimeManager|real
      flags: i
      minMatches: 1
"#,
        )
        .unwrap();

        let report = evaluate_harness_fluency(&EvaluateOptions {
            repo_root: repo_root.to_path_buf(),
            model_path,
            profile: "generic".to_string(),
            snapshot_path,
            compare_last: false,
            save: false,
        })
        .expect("report");

        let count = report
            .criteria
            .iter()
            .find(|criterion| criterion.id == "collaboration.assisted.real_tests")
            .unwrap();
        assert_eq!(count.status, super::CriterionStatus::Fail);
        assert_eq!(count.detail, "matched 1 paths (min 2)");

        let regex = report
            .criteria
            .iter()
            .find(|criterion| criterion.id == "collaboration.assisted.real_runtime")
            .unwrap();
        assert_eq!(regex.status, super::CriterionStatus::Pass);
        assert_eq!(regex.evidence, vec!["tests/app.spec.ts".to_string()]);
    }

    #[test]
    fn compares_against_previous_snapshot() {
        let repo = tempdir().unwrap();
        let repo_root = repo.path();
        create_dir_all(repo_root.join("docs/fitness")).unwrap();
        write(repo_root.join("AGENTS.md"), "# contract\n").unwrap();

        let model_path = repo_root.join("docs/fitness/model.yaml");
        let snapshot_path = repo_root.join("docs/fitness/latest.json");
        write(
            &model_path,
            r#"version: 1
levels:
  - id: awareness
    name: Awareness
  - id: assisted
    name: Assisted
dimensions:
  - id: collaboration
    name: Collaboration
criteria:
  - id: collaboration.awareness.file
    level: awareness
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: file
    recommended_action: file
    evidence_hint: AGENTS.md
    detector:
      type: file_exists
      path: AGENTS.md
  - id: collaboration.awareness.path
    level: awareness
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: path
    recommended_action: path
    evidence_hint: AGENTS.md
    detector:
      type: any_file_exists
      paths:
        - AGENTS.md
  - id: collaboration.assisted.script
    level: assisted
    dimension: collaboration
    weight: 1
    critical: true
    why_it_matters: script
    recommended_action: script
    evidence_hint: package.json
    detector:
      type: file_exists
      path: package.json
  - id: collaboration.assisted.path
    level: assisted
    dimension: collaboration
    weight: 1
    critical: false
    why_it_matters: path
    recommended_action: path
    evidence_hint: package.json
    detector:
      type: any_file_exists
      paths:
        - package.json
"#,
        )
        .unwrap();
        write_json(
            &snapshot_path,
            json!({
                "modelVersion": 1,
                "modelPath": model_path.display().to_string(),
                "profile": "generic",
                "repoRoot": repo_root.display().to_string(),
                "generatedAt": "2026-03-26T00:00:00.000Z",
                "snapshotPath": snapshot_path.display().to_string(),
                "overallLevel": "assisted",
                "overallLevelName": "Assisted",
                "currentLevelReadiness": 1.0,
                "nextLevel": null,
                "nextLevelName": null,
                "nextLevelReadiness": null,
                "blockingTargetLevel": null,
                "blockingTargetLevelName": null,
                "dimensions": {
                    "collaboration": {
                        "dimension": "collaboration",
                        "name": "Collaboration",
                        "level": "assisted",
                        "levelName": "Assisted",
                        "levelIndex": 1,
                        "score": 1.0,
                        "nextLevel": null,
                        "nextLevelName": null,
                        "nextLevelProgress": null
                    }
                },
                "cells": [],
                "criteria": [
                    {
                        "id": "collaboration.awareness.file",
                        "level": "awareness",
                        "dimension": "collaboration",
                        "weight": 1,
                        "critical": true,
                        "status": "pass",
                        "detectorType": "file_exists",
                        "detail": "found AGENTS.md",
                        "evidence": ["AGENTS.md"],
                        "whyItMatters": "file",
                        "recommendedAction": "file",
                        "evidenceHint": "AGENTS.md"
                    },
                    {
                        "id": "collaboration.awareness.path",
                        "level": "awareness",
                        "dimension": "collaboration",
                        "weight": 1,
                        "critical": false,
                        "status": "pass",
                        "detectorType": "any_file_exists",
                        "detail": "found AGENTS.md",
                        "evidence": ["AGENTS.md"],
                        "whyItMatters": "path",
                        "recommendedAction": "path",
                        "evidenceHint": "AGENTS.md"
                    },
                    {
                        "id": "collaboration.assisted.path",
                        "level": "assisted",
                        "dimension": "collaboration",
                        "weight": 1,
                        "critical": false,
                        "status": "pass",
                        "detectorType": "any_file_exists",
                        "detail": "found package.json",
                        "evidence": ["package.json"],
                        "whyItMatters": "path",
                        "recommendedAction": "path",
                        "evidenceHint": "package.json"
                    },
                    {
                        "id": "collaboration.assisted.script",
                        "level": "assisted",
                        "dimension": "collaboration",
                        "weight": 1,
                        "critical": true,
                        "status": "pass",
                        "detectorType": "file_exists",
                        "detail": "found package.json",
                        "evidence": ["package.json"],
                        "whyItMatters": "script",
                        "recommendedAction": "script",
                        "evidenceHint": "package.json"
                    }
                ],
                "blockingCriteria": [],
                "recommendations": [],
                "comparison": null
            }),
        );

        let report = evaluate_harness_fluency(&EvaluateOptions {
            repo_root: repo_root.to_path_buf(),
            model_path,
            profile: "generic".to_string(),
            snapshot_path,
            compare_last: true,
            save: false,
        })
        .expect("report");

        assert_eq!(report.overall_level, "awareness");
        assert_eq!(
            report.comparison.as_ref().unwrap().overall_change,
            super::LevelChange::Down
        );
        let text = format_text_report(&report);
        assert!(text.contains("HARNESS FLUENCY REPORT"));
        assert!(text.contains("Comparison To Last Snapshot:"));
    }
}
