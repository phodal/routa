pub mod eval;
pub mod evaluator;
pub mod events;
pub mod evidence;
pub mod ids;
pub mod policy;
pub mod run;
pub mod task;
pub mod workspace;

// Re-exports form the public domain API surface. Some types are not yet consumed
// within the crate but are part of the architecture contract (§7).
#[allow(unused_imports)]
pub use eval::{DimensionScore, EvalInput, EvalMode, EvalSnapshot, EvaluatorKind, EvidenceRef, Recommendation};
#[allow(unused_imports)]
pub use evaluator::{EntrixEvaluator, Evaluator};
#[allow(unused_imports)]
pub use events::{event_types, EventEnvelope, EventSource};
#[allow(unused_imports)]
pub use evidence::{Evidence, EvidenceRequirement, EvidenceType};
#[allow(unused_imports)]
pub use ids::{EvidenceId, EventId, RunId, TaskId, ToolCallId, WorkspaceId};
#[allow(unused_imports)]
pub use policy::{EffectClass, PolicyDecision, PolicyDecisionKind, SecretScope, ToolSpec};
#[allow(unused_imports)]
pub use run::{
    Checkpoint, EffectBudget, Handoff, Role, Run, RunEnvelope, RunMode, RunState,
};
#[allow(unused_imports)]
pub use task::{
    Capability, DeployPolicy, EscalationPolicy, MergePolicy, Owner, RiskLevel, SourceRef, Task,
    TaskSpec, TaskState,
};
#[allow(unused_imports)]
pub use workspace::{Workspace, WorkspaceState, WorkspaceSummary};
