//! Scoring engine — weighted score calculation across dimensions.

use crate::model::{DimensionScore, FitnessReport, MetricResult, ResultState};

/// States that count as "passed" in scoring.
const SCORABLE_PASS_STATES: &[ResultState] = &[ResultState::Pass, ResultState::Waived];
/// States that count toward the total denominator.
const SCORABLE_TOTAL_STATES: &[ResultState] =
    &[ResultState::Pass, ResultState::Fail, ResultState::Waived];

/// Calculate score for a single dimension from its metric results.
pub fn score_dimension(
    results: &[MetricResult],
    dimension_name: &str,
    weight: i32,
) -> DimensionScore {
    if results.is_empty() {
        return DimensionScore {
            dimension: dimension_name.to_string(),
            weight,
            passed: 0,
            total: 0,
            score: 0.0,
            hard_gate_failures: Vec::new(),
            results: results.to_vec(),
        };
    }

    let passed = results
        .iter()
        .filter(|r| SCORABLE_PASS_STATES.contains(&r.state))
        .count();
    let total = results
        .iter()
        .filter(|r| SCORABLE_TOTAL_STATES.contains(&r.state))
        .count();
    let score = if total > 0 {
        (passed as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let hard_gate_failures: Vec<String> = results
        .iter()
        .filter(|r| r.state == ResultState::Fail && r.hard_gate)
        .map(|r| r.metric_name.clone())
        .collect();

    DimensionScore {
        dimension: dimension_name.to_string(),
        weight,
        passed,
        total,
        score,
        hard_gate_failures,
        results: results.to_vec(),
    }
}

/// Calculate final weighted score across all dimensions.
///
/// Score formula: Σ(Weight_i × Score_i) / Σ(Weight_i)
pub fn score_report(dimension_scores: &[DimensionScore], min_score: f64) -> FitnessReport {
    let mut all_hard_gate_failures = Vec::new();
    let mut weighted_sum = 0.0;
    let mut total_weight = 0;

    for ds in dimension_scores {
        all_hard_gate_failures.extend(ds.hard_gate_failures.iter().cloned());
        if ds.weight > 0 && ds.total > 0 {
            weighted_sum += ds.score * ds.weight as f64;
            total_weight += ds.weight;
        }
    }

    let final_score = if total_weight > 0 {
        weighted_sum / total_weight as f64
    } else {
        0.0
    };

    FitnessReport {
        dimensions: dimension_scores.to_vec(),
        final_score,
        hard_gate_blocked: !all_hard_gate_failures.is_empty(),
        score_blocked: total_weight > 0 && final_score < min_score,
        runtime_timed_out: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Tier;

    #[test]
    fn test_score_dimension_all_pass() {
        let results = vec![
            MetricResult::new("a", true, "", Tier::Fast),
            MetricResult::new("b", true, "", Tier::Fast),
        ];
        let ds = score_dimension(&results, "quality", 24);
        assert_eq!(ds.score, 100.0);
        assert_eq!(ds.passed, 2);
        assert_eq!(ds.total, 2);
        assert!(ds.hard_gate_failures.is_empty());
    }

    #[test]
    fn test_score_dimension_partial() {
        let results = vec![
            MetricResult::new("a", true, "", Tier::Fast),
            MetricResult::new("b", false, "", Tier::Fast),
        ];
        let ds = score_dimension(&results, "quality", 24);
        assert_eq!(ds.score, 50.0);
        assert_eq!(ds.passed, 1);
        assert_eq!(ds.total, 2);
    }

    #[test]
    fn test_score_dimension_hard_gate_failure() {
        let results = vec![MetricResult::new("lint", false, "", Tier::Fast).with_hard_gate(true)];
        let ds = score_dimension(&results, "quality", 24);
        assert_eq!(ds.hard_gate_failures, vec!["lint"]);
    }

    #[test]
    fn test_score_dimension_empty() {
        let ds = score_dimension(&[], "empty", 10);
        assert_eq!(ds.score, 0.0);
        assert_eq!(ds.total, 0);
    }

    #[test]
    fn test_score_report_weighted() {
        let results_a = vec![MetricResult::new("a", true, "", Tier::Fast)];
        let results_b = vec![MetricResult::new("b", false, "", Tier::Fast)];

        let ds_a = score_dimension(&results_a, "high_weight", 80);
        let ds_b = score_dimension(&results_b, "low_weight", 20);

        let report = score_report(&[ds_a, ds_b], 80.0);
        // (100 * 80 + 0 * 20) / 100 = 80.0
        assert_eq!(report.final_score, 80.0);
        assert!(!report.hard_gate_blocked);
        assert!(!report.score_blocked); // 80 >= 80
    }

    #[test]
    fn test_score_report_hard_gate_blocked() {
        let results = vec![MetricResult::new("gate", false, "", Tier::Fast).with_hard_gate(true)];
        let ds = score_dimension(&results, "sec", 20);
        let report = score_report(&[ds], 80.0);
        assert!(report.hard_gate_blocked);
    }

    #[test]
    fn test_score_report_score_blocked() {
        let results = vec![
            MetricResult::new("a", true, "", Tier::Fast),
            MetricResult::new("b", false, "", Tier::Fast),
            MetricResult::new("c", false, "", Tier::Fast),
        ];
        let ds = score_dimension(&results, "quality", 100);
        let report = score_report(&[ds], 80.0);
        // 33.3% < 80%
        assert!(report.score_blocked);
    }

    #[test]
    fn test_score_dimension_ignores_unknown_and_skipped() {
        let results = vec![
            MetricResult::new("pass", true, "", Tier::Fast),
            MetricResult::new("unknown", false, "unknown", Tier::Fast)
                .with_state(ResultState::Unknown),
            MetricResult::new("skipped", false, "skipped", Tier::Fast)
                .with_state(ResultState::Skipped),
        ];
        let ds = score_dimension(&results, "quality", 100);
        assert_eq!(ds.passed, 1);
        assert_eq!(ds.total, 1);
        assert_eq!(ds.score, 100.0);
    }

    #[test]
    fn test_score_dimension_counts_waived_as_pass() {
        let results = vec![
            MetricResult::new("waived", true, "waived", Tier::Fast).with_state(ResultState::Waived),
            MetricResult::new("fail", false, "", Tier::Fast),
        ];
        let ds = score_dimension(&results, "quality", 100);
        assert_eq!(ds.passed, 1);
        assert_eq!(ds.total, 2);
        assert_eq!(ds.score, 50.0);
    }

    #[test]
    fn test_score_report_does_not_block_when_no_scorable_weight() {
        let ds = score_dimension(
            &[
                MetricResult::new("graph_probe", false, "skipped", Tier::Normal)
                    .with_state(ResultState::Skipped),
            ],
            "observability",
            0,
        );
        let report = score_report(&[ds], 80.0);
        assert_eq!(report.final_score, 0.0);
        assert!(!report.score_blocked);
    }

    #[test]
    fn test_score_report_counts_weighted_zero_total_dimensions() {
        let scored = score_dimension(
            &[MetricResult::new("lint", true, "", Tier::Fast)],
            "quality",
            80,
        );
        let skipped_only = score_dimension(
            &[MetricResult::new("probe", false, "skipped", Tier::Normal)
                .with_state(ResultState::Skipped)],
            "observability",
            20,
        );

        let report = score_report(&[scored, skipped_only], 80.0);
        assert_eq!(report.final_score, 100.0);
        assert!(!report.score_blocked);
    }
}
