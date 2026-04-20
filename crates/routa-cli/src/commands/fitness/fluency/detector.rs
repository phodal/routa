use glob::{MatchOptions, Pattern};
use routa_core::codeowners::detect_codeowners;
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use walkdir::{DirEntry, WalkDir};

use super::support::build_regex;
use super::types::{
    CriterionResult, CriterionStatus, DetectorDefinition, FluencyCriterion, PathSegment,
    ALLOWED_COMMAND_EXECUTABLES, DEFAULT_GLOB_IGNORE, MAX_REGEX_INPUT_LENGTH,
};

struct DetectorResult {
    status: CriterionStatus,
    detail: String,
    evidence: Vec<String>,
}

pub(super) struct EvaluationContext {
    repo_root: PathBuf,
    ignore_patterns: Vec<Pattern>,
    text_cache: HashMap<PathBuf, String>,
    json_cache: HashMap<PathBuf, JsonValue>,
    yaml_cache: HashMap<PathBuf, JsonValue>,
}

impl EvaluationContext {
    pub(super) fn new(repo_root: PathBuf) -> Result<Self, String> {
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

pub(super) fn evaluate_criterion(
    criterion: &FluencyCriterion,
    context: &mut EvaluationContext,
) -> Result<CriterionResult, String> {
    let detector_result = evaluate_detector(&criterion.detector, context)?;
    Ok(CriterionResult {
        id: criterion.id.clone(),
        level: criterion.level.clone(),
        dimension: criterion.dimension.clone(),
        capability_group: Some(criterion.capability_group.clone()),
        capability_group_name: None,
        weight: criterion.weight,
        critical: criterion.critical,
        status: detector_result.status,
        detector_type: criterion.detector.detector_type().to_string(),
        profiles: criterion.profiles.clone(),
        evidence_mode: criterion.evidence_mode.clone(),
        detail: detector_result.detail,
        evidence: detector_result.evidence,
        why_it_matters: criterion.why_it_matters.clone(),
        recommended_action: criterion.recommended_action.clone(),
        evidence_hint: criterion.evidence_hint.clone(),
    })
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

    let mut matches = std::collections::HashSet::new();
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
        .map_err(|error| format!("unable to read {relative_path}: {error}"))?;
    context.text_cache.insert(absolute_path, content.clone());
    Ok(content)
}

fn read_json_file(
    context: &mut EvaluationContext,
    relative_path: &str,
) -> Result<JsonValue, String> {
    let absolute_path = normalize_absolute_path(&context.repo_root, relative_path);
    if let Some(cached) = context.json_cache.get(&absolute_path) {
        return Ok(cached.clone());
    }

    let content = fs::read_to_string(&absolute_path)
        .map_err(|error| format!("unable to read {relative_path}: {error}"))?;
    let document = serde_json::from_str::<JsonValue>(&content)
        .map_err(|error| format!("unable to parse {relative_path}: {error}"))?;
    context.json_cache.insert(absolute_path, document.clone());
    Ok(document)
}

fn read_yaml_file(
    context: &mut EvaluationContext,
    relative_path: &str,
) -> Result<JsonValue, String> {
    let absolute_path = normalize_absolute_path(&context.repo_root, relative_path);
    if let Some(cached) = context.yaml_cache.get(&absolute_path) {
        return Ok(cached.clone());
    }

    let content = fs::read_to_string(&absolute_path)
        .map_err(|error| format!("unable to read {relative_path}: {error}"))?;
    let document = serde_yaml::from_str::<JsonValue>(&content)
        .map_err(|error| format!("unable to parse {relative_path}: {error}"))?;
    context.yaml_cache.insert(absolute_path, document.clone());
    Ok(document)
}

fn test_regex_against_text(
    pattern: &str,
    flags: &str,
    text: &str,
    label: &str,
) -> Result<bool, String> {
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
                evidence: if exists {
                    vec![path.clone()]
                } else {
                    Vec::new()
                },
            })
        }
        DetectorDefinition::FileContainsRegex {
            path,
            pattern,
            flags,
        } => match read_text_file(context, path) {
            Ok(content) => {
                let passed =
                    test_regex_against_text(pattern, flags, &content, "file_contains_regex")?;
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
                    evidence: if passed {
                        vec![path.clone()]
                    } else {
                        Vec::new()
                    },
                })
            }
            Err(error) => Ok(DetectorResult {
                status: CriterionStatus::Fail,
                detail: error,
                evidence: Vec::new(),
            }),
        },
        DetectorDefinition::AllOf { detectors } => {
            let mut evidence = Vec::new();
            let mut skipped_count = 0;

            for nested in detectors {
                let result = evaluate_detector(nested, context)?;
                match result.status {
                    CriterionStatus::Pass => {
                        evidence.extend(result.evidence);
                    }
                    CriterionStatus::Fail => {
                        return Ok(DetectorResult {
                            status: CriterionStatus::Fail,
                            detail: format!(
                                "required {} failed: {}",
                                nested.detector_type(),
                                result.detail
                            ),
                            evidence,
                        });
                    }
                    CriterionStatus::Skipped => {
                        skipped_count += 1;
                    }
                }
            }

            if skipped_count == detectors.len() {
                return Ok(DetectorResult {
                    status: CriterionStatus::Skipped,
                    detail: "all required checks were skipped".to_string(),
                    evidence: Vec::new(),
                });
            }

            if skipped_count > 0 {
                return Ok(DetectorResult {
                    status: CriterionStatus::Skipped,
                    detail: "some required checks were skipped".to_string(),
                    evidence,
                });
            }

            evidence.truncate(10);
            Ok(DetectorResult {
                status: CriterionStatus::Pass,
                detail: format!("all {} required checks passed", detectors.len()),
                evidence,
            })
        }
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
                .filter(|candidate| {
                    path_exists(&normalize_absolute_path(&context.repo_root, candidate))
                })
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
        DetectorDefinition::CodeownersRouting {
            require_codeowners,
            max_unowned_files,
            max_sensitive_unowned_files,
            max_overlapping_files,
            require_trigger_alignment,
        } => evaluate_codeowners_routing(
            context,
            *require_codeowners,
            *max_unowned_files,
            *max_sensitive_unowned_files,
            *max_overlapping_files,
            *require_trigger_alignment,
        ),
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
        } => {
            match collect_glob_matches(patterns, &context.repo_root, &context.ignore_patterns, true)
            {
                Ok(candidates) => {
                    let mut matched = Vec::new();
                    for candidate in &candidates {
                        let content = match read_text_file(context, candidate) {
                            Ok(content) => content,
                            Err(_) => continue,
                        };
                        if test_regex_against_text(pattern, flags, &content, "glob_contains_regex")?
                        {
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
            }
        }
        DetectorDefinition::JsonPathExists { path, json_path } => {
            match read_json_file(context, path) {
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
                        evidence: if resolved.is_some() {
                            vec![path.clone()]
                        } else {
                            Vec::new()
                        },
                    })
                }
                Err(error) => Ok(DetectorResult {
                    status: CriterionStatus::Fail,
                    detail: error,
                    evidence: Vec::new(),
                }),
            }
        }
        DetectorDefinition::YamlPathExists { path, yaml_path } => {
            match read_yaml_file(context, path) {
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
                        evidence: if resolved.is_some() {
                            vec![path.clone()]
                        } else {
                            Vec::new()
                        },
                    })
                }
                Err(error) => Ok(DetectorResult {
                    status: CriterionStatus::Fail,
                    detail: error,
                    evidence: Vec::new(),
                }),
            }
        }
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

fn evaluate_codeowners_routing(
    context: &mut EvaluationContext,
    require_codeowners: bool,
    max_unowned_files: Option<usize>,
    max_sensitive_unowned_files: Option<usize>,
    max_overlapping_files: Option<usize>,
    require_trigger_alignment: bool,
) -> Result<DetectorResult, String> {
    let report = detect_codeowners(&context.repo_root)
        .map_err(|error| format!("failed to evaluate CODEOWNERS routing: {error}"))?;
    let mut evidence = Vec::new();
    if let Some(path) = &report.codeowners_file {
        evidence.push(path.clone());
    }
    if let Some(path) = &report.correlation.review_trigger_file {
        evidence.push(path.clone());
    }

    if require_codeowners && report.codeowners_file.is_none() {
        return Ok(DetectorResult {
            status: CriterionStatus::Fail,
            detail: report
                .warnings
                .first()
                .cloned()
                .unwrap_or_else(|| "missing CODEOWNERS".to_string()),
            evidence,
        });
    }

    let trigger_gap_count = report
        .correlation
        .trigger_correlations
        .iter()
        .filter(|correlation| correlation.has_ownership_gap)
        .count();
    let mut violations = Vec::new();

    if let Some(limit) = max_unowned_files {
        let count = report.coverage.unowned_files.len();
        if count > limit {
            violations.push(format!("unowned files: {count} > {limit}"));
            evidence.extend(report.coverage.unowned_files.iter().take(5).cloned());
        }
    }
    if let Some(limit) = max_sensitive_unowned_files {
        let count = report.coverage.sensitive_unowned_files.len();
        if count > limit {
            violations.push(format!("sensitive unowned files: {count} > {limit}"));
            evidence.extend(
                report
                    .coverage
                    .sensitive_unowned_files
                    .iter()
                    .take(5)
                    .cloned(),
            );
        }
    }
    if let Some(limit) = max_overlapping_files {
        let count = report.coverage.overlapping_files.len();
        if count > limit {
            violations.push(format!("overlapping ownership paths: {count} > {limit}"));
            evidence.extend(report.coverage.overlapping_files.iter().take(5).cloned());
        }
    }
    if require_trigger_alignment && trigger_gap_count > 0 {
        violations.push(format!("trigger ownership gaps: {trigger_gap_count}"));
        evidence.extend(
            report
                .correlation
                .trigger_correlations
                .iter()
                .filter(|correlation| correlation.has_ownership_gap)
                .map(|correlation| format!("trigger:{}", correlation.trigger_name))
                .take(5),
        );
    }

    if !violations.is_empty() {
        return Ok(DetectorResult {
            status: CriterionStatus::Fail,
            detail: violations.join(" | "),
            evidence,
        });
    }

    Ok(DetectorResult {
        status: CriterionStatus::Pass,
        detail: format!(
            "CODEOWNERS routing healthy: {} unowned, {} sensitive gaps, {} overlaps, {} trigger gaps",
            report.coverage.unowned_files.len(),
            report.coverage.sensitive_unowned_files.len(),
            report.coverage.overlapping_files.len(),
            trigger_gap_count
        ),
        evidence,
    })
}

fn build_command_failure(error: String) -> DetectorResult {
    DetectorResult {
        status: CriterionStatus::Fail,
        detail: error,
        evidence: Vec::new(),
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

fn run_command(
    command: &str,
    repo_root: &Path,
    timeout_ms: u64,
) -> Result<CommandExecutionResult, String> {
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
