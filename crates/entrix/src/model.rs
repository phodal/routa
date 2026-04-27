//! Domain model for evolutionary architecture fitness functions.
//!
//! Aligns with concepts from "Building Evolutionary Architectures":
//! - Fitness Function → Metric (an executable architectural check)
//! - Dimension → architectural characteristic category
//! - Atomic vs Holistic → FitnessKind
//! - Static vs Dynamic → AnalysisMode
//! - Triggered vs Continuous → Tier (execution frequency)

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

/// Execution speed tier — maps to trigger frequency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    /// <30s: lints, static analysis
    Fast,
    /// <5min: unit tests, contract checks
    Normal,
    /// <15min: E2E, security scans
    Deep,
}

impl Tier {
    pub fn order(self) -> u8 {
        match self {
            Self::Fast => 0,
            Self::Normal => 1,
            Self::Deep => 2,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Normal => "normal",
            Self::Deep => "deep",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "fast" => Some(Self::Fast),
            "normal" => Some(Self::Normal),
            "deep" => Some(Self::Deep),
            _ => None,
        }
    }
}

/// Atomic checks one thing; holistic checks system-wide properties.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FitnessKind {
    Atomic,
    Holistic,
}

/// Static analyzes code structure; dynamic analyzes runtime behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisMode {
    Static,
    Dynamic,
}

/// Execution environment where a metric is authoritative.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionScope {
    Local,
    Ci,
    Staging,
    ProdObservation,
}

/// Governance severity for a metric outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Gate {
    Hard,
    Soft,
    Advisory,
}

/// Signal stability classification for runtime-aware metrics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stability {
    Deterministic,
    Noisy,
}

/// How evidence is collected or represented.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceType {
    Command,
    Test,
    Probe,
    Sarif,
    ManualAttestation,
}

/// Confidence level for a metric's evidence quality.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    High,
    Medium,
    Low,
    Unknown,
}

/// Expanded result states for Fitness V2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultState {
    Pass,
    Fail,
    Unknown,
    Skipped,
    Waived,
}

impl ResultState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pass => "pass",
            Self::Fail => "fail",
            Self::Unknown => "unknown",
            Self::Skipped => "skipped",
            Self::Waived => "waived",
        }
    }
}

/// Optional waiver metadata for temporarily bypassed metrics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Waiver {
    pub reason: String,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub tracking_issue: Option<i64>,
    #[serde(default)]
    pub expires_at: Option<NaiveDate>,
}

impl Waiver {
    /// Return true when the waiver is still active.
    pub fn is_active(&self, today: Option<NaiveDate>) -> bool {
        let reference = today.unwrap_or_else(|| chrono::Utc::now().date_naive());
        match self.expires_at {
            None => true,
            Some(expiry) => expiry >= reference,
        }
    }
}

/// A single executable fitness function.
#[derive(Debug, Clone, PartialEq)]
pub struct Metric {
    pub name: String,
    pub command: String,
    pub pattern: String,
    pub hard_gate: bool,
    pub tier: Tier,
    pub description: String,
    pub kind: FitnessKind,
    pub analysis: AnalysisMode,
    pub execution_scope: ExecutionScope,
    pub gate: Gate,
    pub stability: Stability,
    pub evidence_type: EvidenceType,
    pub scope: Vec<String>,
    pub run_when_changed: Vec<String>,
    pub timeout_seconds: Option<u64>,
    pub owner: String,
    pub confidence: Confidence,
    pub waiver: Option<Waiver>,
}

impl Metric {
    /// Create a new metric with defaults matching the Python implementation.
    pub fn new(name: impl Into<String>, command: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            command: command.into(),
            pattern: String::new(),
            hard_gate: false,
            tier: Tier::Normal,
            description: String::new(),
            kind: FitnessKind::Atomic,
            analysis: AnalysisMode::Static,
            execution_scope: ExecutionScope::Local,
            gate: Gate::Soft,
            stability: Stability::Deterministic,
            evidence_type: EvidenceType::Command,
            scope: Vec::new(),
            run_when_changed: Vec::new(),
            timeout_seconds: None,
            owner: String::new(),
            confidence: Confidence::Unknown,
            waiver: None,
        }
    }

    /// Create a metric with hard_gate set, which also sets gate to Hard.
    pub fn with_hard_gate(mut self, hard_gate: bool) -> Self {
        self.hard_gate = hard_gate;
        if hard_gate {
            self.gate = Gate::Hard;
        } else if self.gate == Gate::Hard {
            self.gate = Gate::Soft;
        }
        self
    }
}

/// An architectural characteristic being measured (e.g. security, evolvability).
#[derive(Debug, Clone, PartialEq)]
pub struct Dimension {
    pub name: String,
    /// Percentage, all dimensions should sum to 100
    pub weight: i32,
    pub threshold_pass: i32,
    pub threshold_warn: i32,
    pub metrics: Vec<Metric>,
    pub source_file: String,
}

impl Dimension {
    pub fn new(name: impl Into<String>, weight: i32) -> Self {
        Self {
            name: name.into(),
            weight,
            threshold_pass: 90,
            threshold_warn: 80,
            metrics: Vec::new(),
            source_file: String::new(),
        }
    }
}

/// Outcome of executing a single Metric.
#[derive(Debug, Clone, PartialEq)]
pub struct MetricResult {
    pub metric_name: String,
    pub passed: bool,
    pub output: String,
    pub tier: Tier,
    pub hard_gate: bool,
    pub duration_ms: f64,
    pub state: ResultState,
    pub returncode: Option<i32>,
}

impl MetricResult {
    pub fn new(
        metric_name: impl Into<String>,
        passed: bool,
        output: impl Into<String>,
        tier: Tier,
    ) -> Self {
        let state = if passed {
            ResultState::Pass
        } else {
            ResultState::Fail
        };
        Self {
            metric_name: metric_name.into(),
            passed,
            output: output.into(),
            tier,
            hard_gate: false,
            duration_ms: 0.0,
            state,
            returncode: None,
        }
    }

    /// Create with explicit state (overrides the passed-derived default).
    pub fn with_state(mut self, state: ResultState) -> Self {
        self.state = state;
        self
    }

    pub fn with_hard_gate(mut self, hard_gate: bool) -> Self {
        self.hard_gate = hard_gate;
        self
    }

    pub fn with_duration_ms(mut self, duration_ms: f64) -> Self {
        self.duration_ms = duration_ms;
        self
    }

    pub fn with_returncode(mut self, returncode: i32) -> Self {
        self.returncode = Some(returncode);
        self
    }

    pub fn is_infra_error(&self) -> bool {
        self.state == ResultState::Unknown && !self.passed
    }
}

/// Aggregated score for one Dimension.
#[derive(Debug, Clone, PartialEq)]
pub struct DimensionScore {
    pub dimension: String,
    pub weight: i32,
    pub passed: usize,
    pub total: usize,
    pub score: f64,
    pub hard_gate_failures: Vec<String>,
    pub results: Vec<MetricResult>,
}

impl DimensionScore {
    pub fn new(
        dimension: impl Into<String>,
        weight: i32,
        passed: usize,
        total: usize,
        score: f64,
    ) -> Self {
        Self {
            dimension: dimension.into(),
            weight,
            passed,
            total,
            score,
            hard_gate_failures: Vec::new(),
            results: Vec::new(),
        }
    }
}

/// Final report across all dimensions.
#[derive(Debug, Clone, PartialEq)]
pub struct FitnessReport {
    pub dimensions: Vec<DimensionScore>,
    pub final_score: f64,
    pub hard_gate_blocked: bool,
    /// final_score < threshold
    pub score_blocked: bool,
    pub runtime_timed_out: bool,
}

impl Default for FitnessReport {
    fn default() -> Self {
        Self {
            dimensions: Vec::new(),
            final_score: 0.0,
            hard_gate_blocked: false,
            score_blocked: false,
            runtime_timed_out: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tier_order() {
        assert!(Tier::Fast.order() < Tier::Normal.order());
        assert!(Tier::Normal.order() < Tier::Deep.order());
    }

    #[test]
    fn test_tier_values() {
        assert_eq!(Tier::Fast.as_str(), "fast");
        assert_eq!(Tier::Normal.as_str(), "normal");
        assert_eq!(Tier::Deep.as_str(), "deep");
    }

    #[test]
    fn test_metric_defaults() {
        let m = Metric::new("lint", "npm run lint");
        assert_eq!(m.pattern, "");
        assert!(!m.hard_gate);
        assert_eq!(m.tier, Tier::Normal);
        assert_eq!(m.kind, FitnessKind::Atomic);
        assert_eq!(m.analysis, AnalysisMode::Static);
        assert_eq!(m.execution_scope, ExecutionScope::Local);
        assert_eq!(m.gate, Gate::Soft);
        assert_eq!(m.stability, Stability::Deterministic);
        assert_eq!(m.evidence_type, EvidenceType::Command);
        assert!(m.scope.is_empty());
        assert!(m.run_when_changed.is_empty());
        assert_eq!(m.timeout_seconds, None);
        assert_eq!(m.owner, "");
        assert_eq!(m.confidence, Confidence::Unknown);
        assert!(m.waiver.is_none());
    }

    #[test]
    fn test_metric_hard_gate_sets_default_gate() {
        let m = Metric::new("lint", "npm run lint").with_hard_gate(true);
        assert_eq!(m.gate, Gate::Hard);
    }

    #[test]
    fn test_metric_disabling_hard_gate_resets_hard_gate_default() {
        let m = Metric::new("lint", "npm run lint")
            .with_hard_gate(true)
            .with_hard_gate(false);
        assert!(!m.hard_gate);
        assert_eq!(m.gate, Gate::Soft);
    }

    #[test]
    fn test_metric_disabling_hard_gate_preserves_non_hard_gate() {
        let mut m = Metric::new("lint", "npm run lint");
        m.gate = Gate::Advisory;
        let m = m.with_hard_gate(false);
        assert_eq!(m.gate, Gate::Advisory);
    }

    #[test]
    fn test_dimension_defaults() {
        let d = Dimension::new("security", 20);
        assert_eq!(d.threshold_pass, 90);
        assert_eq!(d.threshold_warn, 80);
        assert!(d.metrics.is_empty());
        assert_eq!(d.source_file, "");
    }

    #[test]
    fn test_metric_result() {
        let r = MetricResult::new("lint", true, "ok", Tier::Fast);
        assert!(!r.hard_gate);
        assert_eq!(r.duration_ms, 0.0);
        assert_eq!(r.state, ResultState::Pass);
        assert_eq!(r.returncode, None);
    }

    #[test]
    fn test_metric_result_failed_defaults_state() {
        let r = MetricResult::new("lint", false, "boom", Tier::Fast);
        assert_eq!(r.state, ResultState::Fail);
    }

    #[test]
    fn test_metric_result_explicit_state_preserved() {
        let r = MetricResult::new("lint", false, "skipped", Tier::Fast)
            .with_state(ResultState::Skipped);
        assert_eq!(r.state, ResultState::Skipped);
    }

    #[test]
    fn test_metric_result_infra_error_detection() {
        let result = MetricResult::new("lint", false, "missing tool", Tier::Fast)
            .with_state(ResultState::Unknown);
        assert!(result.is_infra_error());
    }

    #[test]
    fn test_waiver_model() {
        let waiver = Waiver {
            reason: "legacy hotspot".to_string(),
            owner: "platform".to_string(),
            tracking_issue: Some(217),
            expires_at: None,
        };
        assert_eq!(waiver.reason, "legacy hotspot");
        assert_eq!(waiver.owner, "platform");
        assert_eq!(waiver.tracking_issue, Some(217));
    }

    #[test]
    fn test_dimension_score() {
        let ds = DimensionScore::new("security", 20, 3, 4, 75.0);
        assert!(ds.hard_gate_failures.is_empty());
        assert!(ds.results.is_empty());
    }

    #[test]
    fn test_fitness_report_defaults() {
        let r = FitnessReport::default();
        assert!(r.dimensions.is_empty());
        assert_eq!(r.final_score, 0.0);
        assert!(!r.hard_gate_blocked);
        assert!(!r.score_blocked);
        assert!(!r.runtime_timed_out);
    }
}
