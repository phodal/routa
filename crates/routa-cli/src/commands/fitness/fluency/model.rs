use serde_json::{Map as JsonMap, Value as JsonValue};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::support::build_regex;
use super::types::{
    DetectorDefinition, EvidenceMode, FluencyAiCheck, FluencyCapabilityGroup, FluencyCriterion,
    FluencyDimension, FluencyLevel, FluencyModel, PathSegment,
};

pub(super) fn load_fluency_model(model_path: &Path) -> Result<FluencyModel, String> {
    let raw_model = load_raw_fluency_model(model_path, &mut HashSet::new())?;
    let root = expect_object(&raw_model, "harness fluency model")?;

    let levels_raw = expect_array(
        get_required(root, "levels", "model.levels")?,
        "model.levels",
    )?;
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

    let dimensions_raw = expect_array(
        get_required(root, "dimensions", "model.dimensions")?,
        "model.dimensions",
    )?;
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

    let capability_groups = match root.get("capability_groups") {
        Some(value) => {
            let capability_groups_raw = expect_array(value, "model.capability_groups")?;
            let mut groups = Vec::with_capacity(capability_groups_raw.len());
            for (index, entry) in capability_groups_raw.iter().enumerate() {
                let record = expect_object(entry, &format!("capability_groups[{index}]"))?;
                groups.push(FluencyCapabilityGroup {
                    id: expect_string(
                        get_required(record, "id", &format!("capability_groups[{index}].id"))?,
                        &format!("capability_groups[{index}].id"),
                    )?,
                    name: expect_string(
                        get_required(record, "name", &format!("capability_groups[{index}].name"))?,
                        &format!("capability_groups[{index}].name"),
                    )?,
                });
            }
            groups
        }
        None => Vec::new(),
    };
    let capability_group_ids = capability_groups
        .iter()
        .map(|group| group.id.clone())
        .collect::<HashSet<_>>();
    if capability_group_ids.len() != capability_groups.len() {
        return Err("harness fluency model.capability_groups contains duplicate ids".to_string());
    }

    let criteria_raw = expect_array(
        get_required(root, "criteria", "model.criteria")?,
        "model.criteria",
    )?;
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
        let capability_group = match record.get("capability_group") {
            Some(value) => expect_string(value, &format!("criteria[{index}].capability_group"))?,
            None => dimension.clone(),
        };
        if !capability_group_ids.is_empty()
            && !capability_group_ids.contains(&capability_group)
            && !dimension_ids.contains(&capability_group)
        {
            return Err(format!(
                "criteria[{index}].capability_group references unknown group \"{capability_group}\""
            ));
        }

        criteria.push(FluencyCriterion {
            id: expect_string(
                get_required(record, "id", &format!("criteria[{index}].id"))?,
                &format!("criteria[{index}].id"),
            )?,
            level,
            dimension,
            capability_group,
            weight: expect_u32(
                record.get("weight"),
                &format!("criteria[{index}].weight"),
                1,
            )?,
            critical: expect_bool(
                record.get("critical"),
                &format!("criteria[{index}].critical"),
                false,
            )?,
            profiles: match record.get("profiles") {
                Some(value) => parse_string_array(value, &format!("criteria[{index}].profiles"))?,
                None => Vec::new(),
            },
            evidence_mode: parse_evidence_mode(
                record.get("evidence_mode"),
                &format!("criteria[{index}].evidence_mode"),
                record.get("detector"),
            )?,
            why_it_matters: expect_string(
                get_required(
                    record,
                    "why_it_matters",
                    &format!("criteria[{index}].why_it_matters"),
                )?,
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
                get_required(
                    record,
                    "evidence_hint",
                    &format!("criteria[{index}].evidence_hint"),
                )?,
                &format!("criteria[{index}].evidence_hint"),
            )?,
            ai_check: match record.get("ai_check") {
                Some(value) => Some(parse_ai_check(
                    value,
                    &format!("criteria[{index}].ai_check"),
                )?),
                None => None,
            },
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
                .filter(|criterion| {
                    criterion.level == level.id && criterion.dimension == dimension.id
                })
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
        capability_groups,
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

    items
        .iter()
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
            return Err(format!(
                "{label} must be a non-empty path array or dotted string"
            ));
        }
        return Ok(parts);
    }

    let items = expect_array(value, label)?;
    if items.is_empty() {
        return Err(format!(
            "{label} must be a non-empty path array or dotted string"
        ));
    }

    items
        .iter()
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

fn parse_evidence_mode(
    value: Option<&JsonValue>,
    label: &str,
    detector: Option<&JsonValue>,
) -> Result<EvidenceMode, String> {
    match value {
        Some(value) => match expect_string(value, label)?.as_str() {
            "static" => Ok(EvidenceMode::Static),
            "runtime" => Ok(EvidenceMode::Runtime),
            "hybrid" => Ok(EvidenceMode::Hybrid),
            "manual" => Ok(EvidenceMode::Manual),
            "ai" | "ai_only" => Ok(EvidenceMode::Ai),
            _ => Err(format!(
                "{label} must be one of static, runtime, hybrid, manual, ai"
            )),
        },
        None => match detector {
            Some(value) => parse_detector(value, &format!("{label}.detector_default"))
                .map(|detector| detector.default_evidence_mode()),
            None => Ok(EvidenceMode::Static),
        },
    }
}

fn parse_ai_check(value: &JsonValue, label: &str) -> Result<FluencyAiCheck, String> {
    let record = expect_object(value, label)?;
    Ok(FluencyAiCheck {
        prompt_template: expect_string(
            get_required(
                record,
                "prompt_template",
                &format!("{label}.prompt_template"),
            )?,
            &format!("{label}.prompt_template"),
        )?,
        requires: match record.get("requires") {
            Some(value) => parse_string_array(value, &format!("{label}.requires"))?,
            None => Vec::new(),
        },
    })
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
        "all_of" => {
            let nested = expect_array(
                get_required(detector, "detectors", &format!("{label}.detectors"))?,
                &format!("{label}.detectors"),
            )?;
            if nested.is_empty() {
                return Err(format!("{label}.detectors must be a non-empty array"));
            }
            Ok(DetectorDefinition::AllOf {
                detectors: nested
                    .iter()
                    .enumerate()
                    .map(|(index, item)| {
                        parse_detector(item, &format!("{label}.detectors[{index}]"))
                    })
                    .collect::<Result<Vec<_>, _>>()?,
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
        "codeowners_routing" => Ok(DetectorDefinition::CodeownersRouting {
            require_codeowners: expect_bool(
                detector.get("requireCodeowners"),
                &format!("{label}.requireCodeowners"),
                true,
            )?,
            max_unowned_files: detector
                .get("maxUnownedFiles")
                .map(|_| {
                    expect_usize(
                        detector.get("maxUnownedFiles"),
                        &format!("{label}.maxUnownedFiles"),
                        0,
                    )
                })
                .transpose()?,
            max_sensitive_unowned_files: detector
                .get("maxSensitiveUnownedFiles")
                .map(|_| {
                    expect_usize(
                        detector.get("maxSensitiveUnownedFiles"),
                        &format!("{label}.maxSensitiveUnownedFiles"),
                        0,
                    )
                })
                .transpose()?,
            max_overlapping_files: detector
                .get("maxOverlappingFiles")
                .map(|_| {
                    expect_usize(
                        detector.get("maxOverlappingFiles"),
                        &format!("{label}.maxOverlappingFiles"),
                        0,
                    )
                })
                .transpose()?,
            require_trigger_alignment: expect_bool(
                detector.get("requireTriggerAlignment"),
                &format!("{label}.requireTriggerAlignment"),
                false,
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
            timeout_ms: expect_u64(
                detector.get("timeoutMs"),
                &format!("{label}.timeoutMs"),
                10_000,
            )?,
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
