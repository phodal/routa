use crate::shared::ids::{EvidenceId, RunId, TaskId};
use serde::{Deserialize, Serialize};

/// Type of evidence artifact attached to a run or task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceType {
    TestReport,
    CoverageReport,
    Screenshot,
    Video,
    DiffSummary,
    ContractReport,
    BenchmarkReport,
    LogBundle,
    HumanApproval,
}

impl EvidenceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            EvidenceType::TestReport => "test_report",
            EvidenceType::CoverageReport => "coverage_report",
            EvidenceType::Screenshot => "screenshot",
            EvidenceType::Video => "video",
            EvidenceType::DiffSummary => "diff_summary",
            EvidenceType::ContractReport => "contract_report",
            EvidenceType::BenchmarkReport => "benchmark_report",
            EvidenceType::LogBundle => "log_bundle",
            EvidenceType::HumanApproval => "human_approval",
        }
    }
}

/// An evidence artifact produced during or after a run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct Evidence {
    pub id: EvidenceId,
    pub task_id: TaskId,
    pub run_id: Option<RunId>,
    pub kind: EvidenceType,
    /// URI pointing to the actual artifact (file path, URL, or content digest).
    pub uri: String,
    pub summary: String,
    pub created_at_ms: i64,
    pub verified: bool,
}

/// A named requirement that a run must satisfy before proceeding to merge/deploy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceRequirement {
    pub kind: EvidenceType,
    pub description: String,
    pub required: bool,
}
