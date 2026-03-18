//! Sandbox module — Docker-based isolated code execution for LLM agents.
//!
//! Provides the [`SandboxManager`] for managing sandbox container lifetimes
//! and the types used by the HTTP API layer.
//!
//! # Architecture
//!
//! ```text
//!  ┌─────────────────────────────────────────┐
//!  │  SandboxManager (Rust)                  │
//!  │  - creates / lists / deletes containers │
//!  │  - proxies /execute requests            │
//!  └────────────────┬────────────────────────┘
//!                   │ Docker CLI / HTTP
//!          ┌────────┴────────┐
//!          │  Docker         │
//!          │  routa/sandbox  │ ← Jupyter + FastAPI in-sandbox server
//!          └─────────────────┘
//! ```
//!
//! Reference: <https://amirmalik.net/2025/03/07/code-sandboxes-for-llm-ai-agents>

pub mod manager;
pub mod policy;
pub mod types;

pub use manager::SandboxManager;
pub use policy::{
    ResolvedSandboxCapability, ResolvedSandboxLinkedWorktree, ResolvedSandboxPolicy,
    ResolvedSandboxWorkspaceConfig, SandboxCapability, SandboxCapabilityTier, SandboxEnvMode,
    SandboxLinkedWorktreeMode, SandboxMount, SandboxMountAccess, SandboxNetworkMode,
    SandboxPolicyContext, SandboxPolicyInput, SandboxPolicyWorktree, SANDBOX_SCOPE_CONTAINER_ROOT,
};
pub use types::{
    CreateSandboxRequest, ExecuteRequest, ResolvedCreateSandboxRequest, SandboxInfo,
    SandboxOutputEvent, SANDBOX_IMAGE, SANDBOX_LABEL,
};
