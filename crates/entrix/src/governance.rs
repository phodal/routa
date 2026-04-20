//! Governance — policy enforcement for fitness function execution.

use crate::model::{Dimension, ExecutionScope, FitnessReport, Metric, Tier};

/// Controls which metrics run, when, and what blocks.
#[derive(Debug, Clone)]
pub struct GovernancePolicy {
    pub tier_filter: Option<Tier>,
    pub parallel: bool,
    pub dry_run: bool,
    pub verbose: bool,
    pub min_score: f64,
    pub fail_on_hard_gate: bool,
    pub execution_scope: Option<ExecutionScope>,
    pub dimension_filters: Vec<String>,
    pub metric_filters: Vec<String>,
}

impl Default for GovernancePolicy {
    fn default() -> Self {
        Self {
            tier_filter: None,
            parallel: false,
            dry_run: false,
            verbose: false,
            min_score: 80.0,
            fail_on_hard_gate: true,
            execution_scope: None,
            dimension_filters: Vec::new(),
            metric_filters: Vec::new(),
        }
    }
}

/// Check if a metric's tier is at or below the filter level.
///
/// Tier hierarchy: fast(0) < normal(1) < deep(2).
/// --tier normal runs both fast and normal metrics.
fn tier_passes_filter(metric_tier: Tier, filter_tier: Tier) -> bool {
    metric_tier.order() <= filter_tier.order()
}

/// Apply tier filtering to a list of metrics.
pub fn filter_metrics(metrics: &[Metric], policy: &GovernancePolicy) -> Vec<Metric> {
    let mut result: Vec<Metric> = metrics.to_vec();

    if let Some(filter_tier) = policy.tier_filter {
        result.retain(|m| tier_passes_filter(m.tier, filter_tier));
    }

    if let Some(scope) = policy.execution_scope {
        result.retain(|m| m.execution_scope == scope);
    }

    let allowed_metrics: Vec<String> = policy
        .metric_filters
        .iter()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_lowercase())
        .collect();
    if !allowed_metrics.is_empty() {
        result.retain(|m| allowed_metrics.contains(&m.name.to_lowercase()));
    }

    result
}

/// Apply tier filtering to dimensions, returning only those with remaining metrics.
pub fn filter_dimensions(dimensions: &[Dimension], policy: &GovernancePolicy) -> Vec<Dimension> {
    let allowed_dimensions: Vec<String> = policy
        .dimension_filters
        .iter()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_lowercase())
        .collect();

    let mut result = Vec::new();
    for dim in dimensions {
        if !allowed_dimensions.is_empty() && !allowed_dimensions.contains(&dim.name.to_lowercase())
        {
            continue;
        }
        let filtered = filter_metrics(&dim.metrics, policy);
        if !filtered.is_empty() {
            result.push(Dimension {
                name: dim.name.clone(),
                weight: dim.weight,
                threshold_pass: dim.threshold_pass,
                threshold_warn: dim.threshold_warn,
                metrics: filtered,
                source_file: dim.source_file.clone(),
            });
        }
    }
    result
}

/// Determine exit code from a fitness report.
///
/// Returns:
///   0 — pass
///   1 — score below minimum threshold
///   2 — hard gate failure
pub fn enforce(report: &FitnessReport, policy: &GovernancePolicy) -> i32 {
    if policy.fail_on_hard_gate && report.hard_gate_blocked {
        return 2;
    }

    let has_weighted_dimensions = report.dimensions.iter().any(|ds| ds.weight > 0);
    if has_weighted_dimensions && report.final_score < policy.min_score {
        return 1;
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ExecutionScope, Metric, Tier};

    #[test]
    fn test_filter_metrics_no_filter() {
        let metrics = vec![Metric::new("a", "x")];
        let policy = GovernancePolicy::default();
        assert_eq!(filter_metrics(&metrics, &policy).len(), 1);
    }

    #[test]
    fn test_filter_metrics_fast_only() {
        let mut fast = Metric::new("fast", "x");
        fast.tier = Tier::Fast;
        let mut normal = Metric::new("normal", "x");
        normal.tier = Tier::Normal;
        let mut deep = Metric::new("deep", "x");
        deep.tier = Tier::Deep;

        let metrics = vec![fast, normal, deep];
        let policy = GovernancePolicy {
            tier_filter: Some(Tier::Fast),
            ..Default::default()
        };
        let result = filter_metrics(&metrics, &policy);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "fast");
    }

    #[test]
    fn test_filter_metrics_normal_includes_fast() {
        let mut fast = Metric::new("fast", "x");
        fast.tier = Tier::Fast;
        let mut normal = Metric::new("normal", "x");
        normal.tier = Tier::Normal;
        let mut deep = Metric::new("deep", "x");
        deep.tier = Tier::Deep;

        let metrics = vec![fast, normal, deep];
        let policy = GovernancePolicy {
            tier_filter: Some(Tier::Normal),
            ..Default::default()
        };
        let result = filter_metrics(&metrics, &policy);
        assert_eq!(result.len(), 2);
        let names: Vec<&str> = result.iter().map(|m| m.name.as_str()).collect();
        assert!(names.contains(&"fast"));
        assert!(names.contains(&"normal"));
    }

    #[test]
    fn test_filter_dimensions_removes_empty() {
        let mut deep_only = Metric::new("deep_only", "x");
        deep_only.tier = Tier::Deep;
        let dims = vec![Dimension {
            name: "sec".to_string(),
            weight: 20,
            threshold_pass: 90,
            threshold_warn: 80,
            metrics: vec![deep_only],
            source_file: String::new(),
        }];
        let policy = GovernancePolicy {
            tier_filter: Some(Tier::Fast),
            ..Default::default()
        };
        let result = filter_dimensions(&dims, &policy);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_filter_dimensions_preserves_matching() {
        let mut lint = Metric::new("lint", "x");
        lint.tier = Tier::Fast;
        let mut test = Metric::new("test", "x");
        test.tier = Tier::Normal;

        let dims = vec![Dimension {
            name: "quality".to_string(),
            weight: 24,
            threshold_pass: 90,
            threshold_warn: 80,
            metrics: vec![lint, test],
            source_file: String::new(),
        }];
        let policy = GovernancePolicy {
            tier_filter: Some(Tier::Fast),
            ..Default::default()
        };
        let result = filter_dimensions(&dims, &policy);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].metrics.len(), 1);
        assert_eq!(result[0].metrics[0].name, "lint");
    }

    #[test]
    fn test_filter_dimensions_by_name() {
        let dims = vec![
            Dimension {
                name: "code_quality".to_string(),
                weight: 24,
                metrics: vec![Metric::new("lint", "x")],
                ..Dimension::new("code_quality", 24)
            },
            Dimension {
                name: "security".to_string(),
                weight: 20,
                metrics: vec![Metric::new("audit", "x")],
                ..Dimension::new("security", 20)
            },
        ];
        let policy = GovernancePolicy {
            dimension_filters: vec!["security".to_string()],
            ..Default::default()
        };
        let result = filter_dimensions(&dims, &policy);
        let names: Vec<&str> = result.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, vec!["security"]);
    }

    #[test]
    fn test_filter_dimensions_by_name_is_case_insensitive() {
        let dims = vec![Dimension {
            name: "observability".to_string(),
            weight: 0,
            metrics: vec![Metric::new("obs", "x")],
            ..Dimension::new("observability", 0)
        }];
        let policy = GovernancePolicy {
            dimension_filters: vec!["Observability".to_string()],
            ..Default::default()
        };
        let result = filter_dimensions(&dims, &policy);
        let names: Vec<&str> = result.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, vec!["observability"]);
    }

    #[test]
    fn test_filter_metrics_execution_scope() {
        let mut local = Metric::new("local", "x");
        local.execution_scope = ExecutionScope::Local;
        let mut staging = Metric::new("staging", "x");
        staging.execution_scope = ExecutionScope::Staging;

        let metrics = vec![local, staging];
        let policy = GovernancePolicy {
            execution_scope: Some(ExecutionScope::Staging),
            ..Default::default()
        };
        let result = filter_metrics(&metrics, &policy);
        let names: Vec<&str> = result.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, vec!["staging"]);
    }

    #[test]
    fn test_filter_metrics_by_name_is_case_insensitive() {
        let mut eslint = Metric::new("eslint_pass", "x");
        eslint.tier = Tier::Fast;
        let mut typecheck = Metric::new("ts_typecheck_pass", "x");
        typecheck.tier = Tier::Fast;

        let metrics = vec![eslint, typecheck];
        let policy = GovernancePolicy {
            metric_filters: vec!["Ts_Typecheck_Pass".to_string()],
            ..Default::default()
        };
        let result = filter_metrics(&metrics, &policy);
        let names: Vec<&str> = result.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, vec!["ts_typecheck_pass"]);
    }

    #[test]
    fn test_enforce_pass() {
        let report = FitnessReport {
            final_score: 95.0,
            hard_gate_blocked: false,
            score_blocked: false,
            ..Default::default()
        };
        assert_eq!(enforce(&report, &GovernancePolicy::default()), 0);
    }

    #[test]
    fn test_enforce_hard_gate() {
        let report = FitnessReport {
            final_score: 95.0,
            hard_gate_blocked: true,
            score_blocked: false,
            ..Default::default()
        };
        assert_eq!(enforce(&report, &GovernancePolicy::default()), 2);
    }

    #[test]
    fn test_enforce_score_block() {
        let report = FitnessReport {
            final_score: 70.0,
            hard_gate_blocked: false,
            score_blocked: true,
            dimensions: vec![crate::model::DimensionScore {
                dimension: "quality".to_string(),
                weight: 100,
                passed: 7,
                total: 10,
                score: 70.0,
                hard_gate_failures: Vec::new(),
                results: Vec::new(),
            }],
        };
        assert_eq!(enforce(&report, &GovernancePolicy::default()), 1);
    }

    #[test]
    fn test_enforce_hard_gate_takes_priority() {
        let report = FitnessReport {
            final_score: 70.0,
            hard_gate_blocked: true,
            score_blocked: true,
            dimensions: vec![crate::model::DimensionScore {
                dimension: "quality".to_string(),
                weight: 100,
                passed: 7,
                total: 10,
                score: 70.0,
                hard_gate_failures: Vec::new(),
                results: Vec::new(),
            }],
        };
        assert_eq!(enforce(&report, &GovernancePolicy::default()), 2);
    }

    #[test]
    fn test_enforce_hard_gate_disabled() {
        let report = FitnessReport {
            final_score: 95.0,
            hard_gate_blocked: true,
            score_blocked: false,
            ..Default::default()
        };
        let policy = GovernancePolicy {
            fail_on_hard_gate: false,
            ..Default::default()
        };
        assert_eq!(enforce(&report, &policy), 0);
    }

    #[test]
    fn test_enforce_uses_policy_min_score_even_when_report_flag_differs() {
        let report = FitnessReport {
            final_score: 70.0,
            hard_gate_blocked: false,
            score_blocked: false,
            dimensions: vec![crate::model::DimensionScore {
                dimension: "quality".to_string(),
                weight: 100,
                passed: 7,
                total: 10,
                score: 70.0,
                hard_gate_failures: Vec::new(),
                results: Vec::new(),
            }],
        };
        let policy = GovernancePolicy {
            min_score: 80.0,
            ..Default::default()
        };
        assert_eq!(enforce(&report, &policy), 1);
    }

    #[test]
    fn test_enforce_does_not_block_when_no_weighted_dimensions() {
        let report = FitnessReport {
            final_score: 0.0,
            hard_gate_blocked: false,
            score_blocked: true,
            dimensions: vec![crate::model::DimensionScore {
                dimension: "observability".to_string(),
                weight: 0,
                passed: 0,
                total: 0,
                score: 0.0,
                hard_gate_failures: Vec::new(),
                results: Vec::new(),
            }],
        };
        assert_eq!(enforce(&report, &GovernancePolicy::default()), 0);
    }
}
