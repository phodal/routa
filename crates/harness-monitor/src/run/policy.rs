use crate::govern::evidence::EvidenceType;
use crate::shared::ids::RunId;
use serde::{Deserialize, Serialize};

/// Classification of side-effect severity for a tool or action.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectClass {
    ReadOnly,
    LocalWrite,
    RepoWrite,
    GitWrite,
    NetworkRead,
    NetworkWrite,
    SecretAccess,
    PrCreate,
    Merge,
    Deploy,
    ProdWrite,
}

impl EffectClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            EffectClass::ReadOnly => "read_only",
            EffectClass::LocalWrite => "local_write",
            EffectClass::RepoWrite => "repo_write",
            EffectClass::GitWrite => "git_write",
            EffectClass::NetworkRead => "network_read",
            EffectClass::NetworkWrite => "network_write",
            EffectClass::SecretAccess => "secret_access",
            EffectClass::PrCreate => "pr_create",
            EffectClass::Merge => "merge",
            EffectClass::Deploy => "deploy",
            EffectClass::ProdWrite => "prod_write",
        }
    }

    pub fn requires_explicit_allow(&self) -> bool {
        matches!(
            self,
            EffectClass::NetworkWrite
                | EffectClass::SecretAccess
                | EffectClass::Merge
                | EffectClass::Deploy
                | EffectClass::ProdWrite
        )
    }
}

/// What kind of decision the policy engine makes for a given action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyDecisionKind {
    Allow,
    AllowWithEvidence,
    RequireApproval,
    Deny,
    DryRunOnly,
}

impl PolicyDecisionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            PolicyDecisionKind::Allow => "allow",
            PolicyDecisionKind::AllowWithEvidence => "allow_with_evidence",
            PolicyDecisionKind::RequireApproval => "require_approval",
            PolicyDecisionKind::Deny => "deny",
            PolicyDecisionKind::DryRunOnly => "dry_run_only",
        }
    }

    pub fn is_blocking(&self) -> bool {
        matches!(
            self,
            PolicyDecisionKind::RequireApproval | PolicyDecisionKind::Deny
        )
    }
}

/// An explicit declaration of what a tool is allowed to do.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSpec {
    pub name: String,
    pub effect_class: EffectClass,
    pub allowed_scopes: Vec<String>,
    pub requires_approval: bool,
    pub requires_evidence: Vec<EvidenceType>,
}

/// Scope of secrets accessible to a run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretScope {
    pub visible_secrets: Vec<String>,
    pub allow_export: bool,
}

/// A single policy decision recorded against a tool call or action.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct PolicyDecision {
    pub run_id: RunId,
    pub checkpoint: String,
    pub effect: EffectClass,
    pub decision: PolicyDecisionKind,
    pub reason: String,
    pub decided_at_ms: i64,
}
