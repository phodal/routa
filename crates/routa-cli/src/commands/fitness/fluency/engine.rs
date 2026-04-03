use chrono::Utc;
use std::collections::{HashMap, HashSet};

use super::detector::{evaluate_criterion, EvaluationContext};
use super::evidence_pack::build_evidence_packs;
use super::model::load_fluency_model;
use super::snapshot::{
    build_comparison, can_compare_reports, load_previous_snapshot, persist_snapshot,
};
use super::types::{
    AutonomyBand, AutonomyRecommendation, CapabilityGroupResult, CellResult, CriterionResult,
    CriterionStatus, DimensionResult, EvaluateOptions, FluencyDimension, FluencyFraming,
    FluencyLevel, FluencyTermMapping, HarnessFluencyReport, LifecycleSensorPlacementSummary,
    MissingDimensionInsight, Recommendation, SensorPlacementTierSummary, CELL_PASS_THRESHOLD,
    MAX_RECOMMENDATIONS, TOP_PRIORITIZED_ACTION_LIMIT,
};

struct MutableCellAccumulator {
    id: String,
    level: String,
    level_name: String,
    dimension: String,
    dimension_name: String,
    criteria: Vec<CriterionResult>,
}

struct MutableCapabilityGroupAccumulator {
    id: String,
    name: String,
    criterion_count: usize,
    passing_criteria: usize,
    failing_criteria: usize,
    critical_failures: usize,
    applicable_weight: u32,
    passed_weight: u32,
    evidence_modes: HashMap<String, usize>,
}

#[derive(Default)]
struct MissingDimensionAccumulator {
    failing_criteria: usize,
    critical_failures: usize,
    failed_weight: u32,
    blocking_failures: usize,
}

#[derive(Copy, Clone)]
enum LifecycleTierBucket {
    Fast,
    Normal,
    FullOrDeep,
    Continuous,
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
    let capability_group_names = build_capability_group_names(&model);
    for criterion in &model.criteria {
        if !criterion.profiles.is_empty()
            && !criterion
                .profiles
                .iter()
                .any(|profile| profile == &options.profile)
        {
            continue;
        }

        let mut result = evaluate_criterion(criterion, &mut context)?;
        result.capability_group_name = Some(resolve_capability_group_name(
            &capability_group_names,
            &criterion.capability_group,
        ));
        criteria_results.push(result);
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
            accumulator
                .criteria
                .sort_by(|left, right| left.id.cmp(&right.id));
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

    let cell_by_id: HashMap<String, CellResult> = cells
        .iter()
        .cloned()
        .map(|cell| (cell.id.clone(), cell))
        .collect();
    let capability_groups =
        build_capability_group_results(&criteria_results, &capability_group_names);
    let evidence_packs = build_evidence_packs(
        &options.repo_root,
        &model.criteria,
        &criteria_results,
        &options.mode,
    );
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
    let current_level_readiness =
        average_cell_scores(&model.dimensions, &cell_by_id, &overall_level.id);
    let current_level_debt =
        collect_failing_criteria_for_level(&model.dimensions, &cell_by_id, &overall_level.id);
    let next_level_readiness = match (next_level, current_level_debt.is_empty()) {
        (Some(level), true) => Some(average_cell_scores(
            &model.dimensions,
            &cell_by_id,
            &level.id,
        )),
        _ => None,
    };
    let blocking_target_level = if !current_level_debt.is_empty() {
        Some(overall_level)
    } else {
        next_level
    };
    let mut blocking_criteria = match blocking_target_level {
        None => Vec::new(),
        Some(level) if level.id == overall_level.id => current_level_debt.clone(),
        Some(level) => {
            collect_failing_criteria_for_level(&model.dimensions, &cell_by_id, &level.id)
        }
    };
    blocking_criteria.sort_by(|left, right| left.id.cmp(&right.id));

    criteria_results.sort_by(|left, right| left.id.cmp(&right.id));
    let recommendations = collect_recommendations(&blocking_criteria);
    let top_prioritized_actions = recommendations
        .iter()
        .take(TOP_PRIORITIZED_ACTION_LIMIT)
        .cloned()
        .collect::<Vec<_>>();
    let dominant_missing_dimensions = collect_dominant_missing_dimensions(
        &criteria_results,
        &dimension_by_id,
        &blocking_criteria,
    );
    let autonomy_recommendation = derive_autonomy_recommendation(
        overall_level_index,
        current_level_readiness,
        &blocking_criteria,
        &overall_level.name,
    );
    let lifecycle_sensor_placement =
        summarize_lifecycle_sensor_placement(&criteria_results, &level_order, model.levels.len());

    let mut report = HarnessFluencyReport {
        model_version: model.version,
        model_path: options.model_path.display().to_string(),
        profile: options.profile.clone(),
        mode: options.mode.clone(),
        framing: FluencyFraming::default(),
        term_mapping: FluencyTermMapping::default(),
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
        capability_groups,
        evidence_packs,
        cells,
        criteria: criteria_results,
        blocking_criteria: blocking_criteria.clone(),
        recommendations,
        top_prioritized_actions,
        dominant_missing_dimensions,
        autonomy_recommendation,
        lifecycle_sensor_placement,
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

fn build_cell_id(level: &str, dimension: &str) -> String {
    format!("{dimension}:{level}")
}

fn build_capability_group_names(model: &super::types::FluencyModel) -> HashMap<String, String> {
    let mut names = model
        .capability_groups
        .iter()
        .map(|group| (group.id.clone(), group.name.clone()))
        .collect::<HashMap<_, _>>();
    for dimension in &model.dimensions {
        names
            .entry(dimension.id.clone())
            .or_insert_with(|| dimension.name.clone());
    }
    names
}

fn resolve_capability_group_name(
    capability_group_names: &HashMap<String, String>,
    capability_group: &str,
) -> String {
    capability_group_names
        .get(capability_group)
        .cloned()
        .unwrap_or_else(|| capability_group.to_string())
}

fn build_capability_group_results(
    criteria_results: &[CriterionResult],
    capability_group_names: &HashMap<String, String>,
) -> HashMap<String, CapabilityGroupResult> {
    let mut accumulators = HashMap::<String, MutableCapabilityGroupAccumulator>::new();

    for criterion in criteria_results {
        let Some(group_id) = criterion.capability_group.clone() else {
            continue;
        };
        let evidence_mode = evidence_mode_key(criterion);
        let accumulator = accumulators.entry(group_id.clone()).or_insert_with(|| {
            MutableCapabilityGroupAccumulator {
                id: group_id.clone(),
                name: resolve_capability_group_name(capability_group_names, &group_id),
                criterion_count: 0,
                passing_criteria: 0,
                failing_criteria: 0,
                critical_failures: 0,
                applicable_weight: 0,
                passed_weight: 0,
                evidence_modes: HashMap::new(),
            }
        });
        accumulator.criterion_count += 1;
        *accumulator.evidence_modes.entry(evidence_mode).or_insert(0) += 1;

        match criterion.status {
            CriterionStatus::Pass => {
                accumulator.passing_criteria += 1;
                accumulator.applicable_weight += criterion.weight;
                accumulator.passed_weight += criterion.weight;
            }
            CriterionStatus::Fail => {
                accumulator.failing_criteria += 1;
                accumulator.applicable_weight += criterion.weight;
                if criterion.critical {
                    accumulator.critical_failures += 1;
                }
            }
            CriterionStatus::Skipped => {}
        }
    }

    accumulators
        .into_iter()
        .map(|(group_id, accumulator)| {
            let score = if accumulator.applicable_weight == 0 {
                0.0
            } else {
                accumulator.passed_weight as f64 / accumulator.applicable_weight as f64
            };
            (
                group_id,
                CapabilityGroupResult {
                    capability_group: accumulator.id,
                    name: accumulator.name,
                    score,
                    criterion_count: accumulator.criterion_count,
                    passing_criteria: accumulator.passing_criteria,
                    failing_criteria: accumulator.failing_criteria,
                    critical_failures: accumulator.critical_failures,
                    applicable_weight: accumulator.applicable_weight,
                    passed_weight: accumulator.passed_weight,
                    evidence_modes: accumulator.evidence_modes,
                },
            )
        })
        .collect()
}

fn evidence_mode_key(criterion: &CriterionResult) -> String {
    format!("{:?}", criterion.evidence_mode).to_lowercase()
}

fn deterministic_priority(detector_type: &str) -> u8 {
    if detector_type == "manual_attestation" {
        1
    } else {
        0
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

fn collect_dominant_missing_dimensions(
    criteria: &[CriterionResult],
    dimension_by_id: &HashMap<String, FluencyDimension>,
    blocking_criteria: &[CriterionResult],
) -> Vec<MissingDimensionInsight> {
    let mut accumulators = HashMap::<String, MissingDimensionAccumulator>::new();

    for criterion in criteria
        .iter()
        .filter(|criterion| criterion.status == CriterionStatus::Fail)
    {
        let accumulator = accumulators.entry(criterion.dimension.clone()).or_default();
        accumulator.failing_criteria += 1;
        accumulator.failed_weight += criterion.weight;
        if criterion.critical {
            accumulator.critical_failures += 1;
        }
    }

    for criterion in blocking_criteria
        .iter()
        .filter(|criterion| criterion.status == CriterionStatus::Fail)
    {
        if let Some(accumulator) = accumulators.get_mut(&criterion.dimension) {
            accumulator.blocking_failures += 1;
        }
    }

    let mut ranked = accumulators
        .into_iter()
        .map(|(dimension, accumulator)| MissingDimensionInsight {
            name: dimension_by_id
                .get(&dimension)
                .map(|entry| entry.name.clone())
                .unwrap_or_else(|| dimension.clone()),
            dimension,
            failing_criteria: accumulator.failing_criteria,
            critical_failures: accumulator.critical_failures,
            failed_weight: accumulator.failed_weight,
            blocking_failures: accumulator.blocking_failures,
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .blocking_failures
            .cmp(&left.blocking_failures)
            .then(right.critical_failures.cmp(&left.critical_failures))
            .then(right.failed_weight.cmp(&left.failed_weight))
            .then(right.failing_criteria.cmp(&left.failing_criteria))
            .then(left.dimension.cmp(&right.dimension))
    });
    ranked
}

fn derive_autonomy_recommendation(
    overall_level_index: usize,
    current_level_readiness: f64,
    blocking_criteria: &[CriterionResult],
    overall_level_name: &str,
) -> AutonomyRecommendation {
    let blocking_count = blocking_criteria.len();
    let critical_blockers = blocking_criteria
        .iter()
        .filter(|criterion| criterion.critical)
        .count();

    let mut score = (overall_level_index as i32) * 2;
    if current_level_readiness >= CELL_PASS_THRESHOLD {
        score += 2;
    } else if current_level_readiness >= 0.5 {
        score += 1;
    }

    if critical_blockers == 0 {
        score += 2;
    } else if critical_blockers == 1 {
        score += 1;
    }

    if blocking_count == 0 {
        score += 1;
    }

    let band = if score >= 10 {
        AutonomyBand::High
    } else if score >= 5 {
        AutonomyBand::Medium
    } else {
        AutonomyBand::Low
    };
    let readiness_percent = (current_level_readiness * 100.0).round() as i32;
    let rationale = format!(
        "Band set to {}: {} readiness is {}% with {} blocking gaps ({} critical).",
        autonomy_band_label(band),
        overall_level_name,
        readiness_percent,
        blocking_count,
        critical_blockers
    );

    AutonomyRecommendation { band, rationale }
}

fn autonomy_band_label(band: AutonomyBand) -> &'static str {
    match band {
        AutonomyBand::Low => "low",
        AutonomyBand::Medium => "medium",
        AutonomyBand::High => "high",
    }
}

fn summarize_lifecycle_sensor_placement(
    criteria: &[CriterionResult],
    level_order: &HashMap<String, usize>,
    level_count: usize,
) -> LifecycleSensorPlacementSummary {
    let mut summary = LifecycleSensorPlacementSummary::default();

    for criterion in criteria {
        if criterion.status == CriterionStatus::Skipped {
            continue;
        }

        let tier = resolve_lifecycle_tier(&criterion.level, level_order, level_count);
        let tier_summary = tier_summary_mut(&mut summary, tier);
        tier_summary.applicable_criteria += 1;
        *tier_summary
            .evidence_modes
            .entry(evidence_mode_key(criterion))
            .or_insert(0) += 1;

        match criterion.status {
            CriterionStatus::Pass => tier_summary.passing_criteria += 1,
            CriterionStatus::Fail => {
                tier_summary.failing_criteria += 1;
                if criterion.critical {
                    tier_summary.critical_failures += 1;
                }
            }
            CriterionStatus::Skipped => {}
        }
    }

    summary
}

fn resolve_lifecycle_tier(
    level_id: &str,
    level_order: &HashMap<String, usize>,
    level_count: usize,
) -> LifecycleTierBucket {
    let level_index = level_order.get(level_id).copied().unwrap_or(0);
    if level_index == 0 {
        LifecycleTierBucket::Fast
    } else if level_index == 1 {
        LifecycleTierBucket::Normal
    } else if level_count >= 4 && level_index + 1 == level_count {
        LifecycleTierBucket::Continuous
    } else {
        LifecycleTierBucket::FullOrDeep
    }
}

fn tier_summary_mut(
    summary: &mut LifecycleSensorPlacementSummary,
    tier: LifecycleTierBucket,
) -> &mut SensorPlacementTierSummary {
    match tier {
        LifecycleTierBucket::Fast => &mut summary.fast,
        LifecycleTierBucket::Normal => &mut summary.normal,
        LifecycleTierBucket::FullOrDeep => &mut summary.full_or_deep,
        LifecycleTierBucket::Continuous => &mut summary.continuous,
    }
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
