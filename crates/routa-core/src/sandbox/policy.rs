use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::env::parse_env_file_keys;

mod permission_constraints;
pub use permission_constraints::SandboxPermissionConstraints;

pub const SANDBOX_SCOPE_CONTAINER_ROOT: &str = "/workspace";
const SANDBOX_EXTRA_READONLY_ROOT: &str = "/workspace-extra/ro";
const SANDBOX_EXTRA_READWRITE_ROOT: &str = "/workspace-extra/rw";
const SANDBOX_LINKED_WORKTREE_ROOT: &str = "/workspace-worktrees";

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SandboxNetworkMode {
    #[default]
    Bridge,
    None,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SandboxEnvMode {
    #[default]
    Sanitized,
    Inherit,
}

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash, Default,
)]
#[serde(rename_all = "camelCase")]
pub enum SandboxCapability {
    #[default]
    WorkspaceRead,
    WorkspaceWrite,
    NetworkAccess,
    LinkedWorktreeRead,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SandboxCapabilityTier {
    Observation,
    Action,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SandboxLinkedWorktreeMode {
    #[default]
    Disabled,
    All,
    Explicit,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SandboxMountAccess {
    ReadOnly,
    ReadWrite,
}

impl SandboxMountAccess {
    pub fn docker_suffix(self) -> &'static str {
        match self {
            Self::ReadOnly => "ro",
            Self::ReadWrite => "rw",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxMount {
    pub host_path: String,
    pub container_path: String,
    pub access: SandboxMountAccess,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxPolicyInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codebase_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workdir: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub read_only_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub read_write_paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_mode: Option<SandboxNetworkMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_mode: Option<SandboxEnvMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_file: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env_allowlist: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<SandboxCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_worktree_mode: Option<SandboxLinkedWorktreeMode>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub linked_worktree_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub trust_workspace_config: bool,
}

impl SandboxPolicyInput {
    pub fn is_empty(&self) -> bool {
        self.workspace_id.is_none()
            && self.codebase_id.is_none()
            && self.workdir.is_none()
            && self.read_only_paths.is_empty()
            && self.read_write_paths.is_empty()
            && self.network_mode.is_none()
            && self.env_mode.is_none()
            && self.env_file.is_none()
            && self.env_allowlist.is_empty()
            && self.capabilities.is_empty()
            && self.linked_worktree_mode.is_none()
            && self.linked_worktree_ids.is_empty()
            && !self.trust_workspace_config
    }

    pub fn resolve(
        &self,
        context: Option<SandboxPolicyContext>,
    ) -> Result<ResolvedSandboxPolicy, String> {
        let derived_root = context
            .as_ref()
            .and_then(|ctx| ctx.workspace_root.as_ref())
            .map(|root| canonicalize_existing_path(root))
            .transpose()?;
        let workspace_config = resolve_workspace_config(self, derived_root.as_deref())?;
        let effective_input = merge_workspace_config(self, workspace_config.as_ref());
        let capability_set = effective_input
            .capabilities
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();

        let host_workdir = match effective_input.workdir.as_deref() {
            Some(raw) => resolve_user_path(raw, derived_root.as_deref())?,
            None => derived_root.clone().ok_or_else(|| {
                "Sandbox policy requires either policy.workdir or a workspace/codebase root."
                    .to_string()
            })?,
        };

        let scope_root = derived_root.clone().unwrap_or_else(|| host_workdir.clone());
        if !is_within(&scope_root, &host_workdir) {
            return Err(format!(
                "Resolved workdir '{}' escapes scope root '{}'.",
                host_workdir.display(),
                scope_root.display()
            ));
        }

        let mut notes = Vec::new();
        record_workspace_config_note(workspace_config.as_ref(), &mut notes);

        if derived_root.is_some() {
            notes.push(format!(
                "Resolved scope root from workspace/codebase context: {}",
                scope_root.display()
            ));
        } else {
            notes.push(format!(
                "No workspace/codebase root provided; using workdir as scope root: {}",
                scope_root.display()
            ));
        }

        let mut read_only_paths =
            resolve_grant_paths(&effective_input.read_only_paths, &scope_root)?;
        let read_write_paths = resolve_grant_paths(&effective_input.read_write_paths, &scope_root)?;

        if !read_write_paths.is_empty()
            && !capability_set.contains(&SandboxCapability::WorkspaceWrite)
        {
            return Err(
                "Sandbox policy readWritePaths require the workspaceWrite capability.".to_string(),
            );
        }

        let read_write_set: BTreeSet<PathBuf> = read_write_paths.iter().cloned().collect();
        read_only_paths.retain(|path| !read_write_set.contains(path));
        if effective_input.read_only_paths.len() != read_only_paths.len() {
            notes.push(
                "Dropped duplicate read-only grants that were also present in read-write grants."
                    .to_string(),
            );
        }

        let network_mode = resolve_network_mode(effective_input.network_mode, &capability_set)?;
        if network_mode == SandboxNetworkMode::None && effective_input.network_mode.is_none() {
            notes.push(
                "Defaulted network mode to none because networkAccess is not allow-listed."
                    .to_string(),
            );
        }

        let scope_access = if read_write_set.contains(&scope_root) {
            SandboxMountAccess::ReadWrite
        } else {
            SandboxMountAccess::ReadOnly
        };

        let container_workdir = to_container_path(&scope_root, &host_workdir);
        let mut mounts = vec![SandboxMount {
            host_path: scope_root.to_string_lossy().to_string(),
            container_path: SANDBOX_SCOPE_CONTAINER_ROOT.to_string(),
            access: scope_access,
            reason: Some("scopeRoot".to_string()),
        }];

        let overrides = collect_override_mounts(
            &scope_root,
            scope_access,
            &read_only_paths,
            &read_write_paths,
            &mut notes,
        );
        mounts.extend(overrides);
        mounts.extend(collect_external_mounts(
            &scope_root,
            &read_only_paths,
            SandboxMountAccess::ReadOnly,
        ));
        mounts.extend(collect_external_mounts(
            &scope_root,
            &read_write_paths,
            SandboxMountAccess::ReadWrite,
        ));
        let linked_worktrees = resolve_linked_worktrees(
            &effective_input,
            context.as_ref(),
            &scope_root,
            &capability_set,
            &mut notes,
        )?;
        for linked_worktree in &linked_worktrees {
            mounts.push(SandboxMount {
                host_path: linked_worktree.host_path.clone(),
                container_path: linked_worktree.container_path.clone(),
                access: SandboxMountAccess::ReadOnly,
                reason: Some("linkedWorktree".to_string()),
            });
        }

        let env_files =
            resolve_env_file_layers(self, workspace_config.as_ref(), &scope_root, &mut notes)?;
        let env_allowlist = effective_input
            .env_allowlist
            .iter()
            .map(|name| name.trim())
            .filter(|name| !name.is_empty())
            .map(ToOwned::to_owned)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();

        Ok(ResolvedSandboxPolicy {
            workspace_id: context.as_ref().and_then(|ctx| ctx.workspace_id.clone()),
            codebase_id: context.as_ref().and_then(|ctx| ctx.codebase_id.clone()),
            scope_root: scope_root.to_string_lossy().to_string(),
            host_workdir: host_workdir.to_string_lossy().to_string(),
            container_workdir,
            read_only_paths: read_only_paths
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect(),
            read_write_paths: read_write_paths
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect(),
            network_mode,
            env_mode: effective_input.env_mode.unwrap_or_default(),
            env_files,
            env_allowlist,
            mounts,
            capabilities: resolve_capability_view(
                &capability_set,
                !read_write_set.is_empty(),
                network_mode,
                !linked_worktrees.is_empty(),
            ),
            linked_worktrees,
            workspace_config: workspace_config.map(|entry| entry.descriptor),
            notes,
        })
    }
}

#[derive(Debug, Clone, Default)]
pub struct SandboxPolicyContext {
    pub workspace_id: Option<String>,
    pub codebase_id: Option<String>,
    pub workspace_root: Option<PathBuf>,
    pub available_worktrees: Vec<SandboxPolicyWorktree>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSandboxPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codebase_id: Option<String>,
    pub scope_root: String,
    pub host_workdir: String,
    pub container_workdir: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub read_only_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub read_write_paths: Vec<String>,
    pub network_mode: SandboxNetworkMode,
    pub env_mode: SandboxEnvMode,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env_files: Vec<ResolvedSandboxEnvFile>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env_allowlist: Vec<String>,
    pub mounts: Vec<SandboxMount>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<ResolvedSandboxCapability>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub linked_worktrees: Vec<ResolvedSandboxLinkedWorktree>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_config: Option<ResolvedSandboxWorkspaceConfig>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSandboxCapability {
    pub capability: SandboxCapability,
    pub tier: SandboxCapabilityTier,
    pub enabled: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSandboxLinkedWorktree {
    pub id: String,
    pub codebase_id: String,
    pub branch: String,
    pub host_path: String,
    pub container_path: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SandboxEnvFileSource {
    WorkspaceConfig,
    Request,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSandboxEnvFile {
    pub path: String,
    pub source: SandboxEnvFileSource,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSandboxWorkspaceConfig {
    pub path: String,
    pub trusted: bool,
    pub loaded: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSandboxConfigFile {
    #[serde(skip_serializing_if = "Option::is_none")]
    workdir: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    read_only_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    read_write_paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    network_mode: Option<SandboxNetworkMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    env_mode: Option<SandboxEnvMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    env_file: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    env_allowlist: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    capabilities: Vec<SandboxCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    linked_worktree_mode: Option<SandboxLinkedWorktreeMode>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    linked_worktree_ids: Vec<String>,
}

#[derive(Debug, Clone)]
struct WorkspaceConfigResolution {
    descriptor: ResolvedSandboxWorkspaceConfig,
    config: Option<WorkspaceSandboxConfigFile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxPolicyWorktree {
    pub id: String,
    pub codebase_id: String,
    pub worktree_path: String,
    pub branch: String,
}

fn resolve_grant_paths(raw_paths: &[String], scope_root: &Path) -> Result<Vec<PathBuf>, String> {
    raw_paths
        .iter()
        .map(|raw| resolve_user_path(raw, Some(scope_root)))
        .collect::<Result<BTreeSet<_>, _>>()
        .map(|set| set.into_iter().collect())
}

fn resolve_workspace_config(
    policy: &SandboxPolicyInput,
    derived_root: Option<&Path>,
) -> Result<Option<WorkspaceConfigResolution>, String> {
    let Some(root) = derived_root else {
        return Ok(None);
    };

    let config_path = root.join(".routa").join("sandbox.json");
    let config_path_string = config_path.to_string_lossy().to_string();
    if !config_path.exists() {
        return Ok(Some(WorkspaceConfigResolution {
            descriptor: ResolvedSandboxWorkspaceConfig {
                path: config_path_string,
                trusted: policy.trust_workspace_config,
                loaded: false,
                reason: "notFound".to_string(),
            },
            config: None,
        }));
    }

    if !policy.trust_workspace_config {
        return Ok(Some(WorkspaceConfigResolution {
            descriptor: ResolvedSandboxWorkspaceConfig {
                path: config_path_string,
                trusted: false,
                loaded: false,
                reason: "trustDisabled".to_string(),
            },
            config: None,
        }));
    }

    let raw = fs::read_to_string(&config_path).map_err(|err| {
        format!(
            "Failed to read trusted workspace sandbox config '{}': {}",
            config_path.display(),
            err
        )
    })?;
    let config = serde_json::from_str::<WorkspaceSandboxConfigFile>(&raw).map_err(|err| {
        format!(
            "Failed to parse trusted workspace sandbox config '{}': {}",
            config_path.display(),
            err
        )
    })?;

    Ok(Some(WorkspaceConfigResolution {
        descriptor: ResolvedSandboxWorkspaceConfig {
            path: config_path_string,
            trusted: true,
            loaded: true,
            reason: "loaded".to_string(),
        },
        config: Some(config),
    }))
}

fn merge_workspace_config(
    policy: &SandboxPolicyInput,
    workspace_config: Option<&WorkspaceConfigResolution>,
) -> SandboxPolicyInput {
    let Some(config) = workspace_config.and_then(|entry| entry.config.as_ref()) else {
        return policy.clone();
    };

    let mut merged = policy.clone();
    if merged.workdir.is_none() {
        merged.workdir = config.workdir.clone();
    }
    merged.read_only_paths = merge_string_lists(&config.read_only_paths, &policy.read_only_paths);
    merged.read_write_paths =
        merge_string_lists(&config.read_write_paths, &policy.read_write_paths);
    if merged.network_mode.is_none() {
        merged.network_mode = config.network_mode;
    }
    if merged.env_mode.is_none() {
        merged.env_mode = config.env_mode;
    }
    merged.env_allowlist = merge_string_lists(&config.env_allowlist, &policy.env_allowlist);
    merged.capabilities = merge_capabilities(&config.capabilities, &policy.capabilities);
    if merged.linked_worktree_mode.is_none() {
        merged.linked_worktree_mode = config.linked_worktree_mode;
    }
    merged.linked_worktree_ids =
        merge_string_lists(&config.linked_worktree_ids, &policy.linked_worktree_ids);

    merged
}

fn merge_string_lists(base: &[String], overlay: &[String]) -> Vec<String> {
    base.iter()
        .chain(overlay.iter())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn merge_capabilities(
    base: &[SandboxCapability],
    overlay: &[SandboxCapability],
) -> Vec<SandboxCapability> {
    base.iter()
        .chain(overlay.iter())
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn record_workspace_config_note(
    workspace_config: Option<&WorkspaceConfigResolution>,
    notes: &mut Vec<String>,
) {
    let Some(workspace_config) = workspace_config else {
        return;
    };

    let descriptor = &workspace_config.descriptor;
    let note = match descriptor.reason.as_str() {
        "loaded" => format!(
            "Loaded trusted workspace sandbox config: {}",
            descriptor.path
        ),
        "trustDisabled" => format!(
            "Ignored repo-local sandbox config because trustWorkspaceConfig is false: {}",
            descriptor.path
        ),
        "notFound" => format!("No repo-local sandbox config found at {}", descriptor.path),
        other => format!(
            "Workspace sandbox config state '{}' for {}",
            other, descriptor.path
        ),
    };
    notes.push(note);
}

fn resolve_user_path(raw_path: &str, base_dir: Option<&Path>) -> Result<PathBuf, String> {
    let raw_path = raw_path.trim();
    if raw_path.is_empty() {
        return Err("Sandbox policy path entries cannot be empty.".to_string());
    }

    let candidate = PathBuf::from(raw_path);
    if candidate.is_absolute() {
        canonicalize_existing_path(&candidate)
    } else if let Some(base_dir) = base_dir {
        canonicalize_existing_path(&base_dir.join(candidate))
    } else {
        Err(format!(
            "Relative sandbox path '{raw_path}' requires a workspace/codebase root or explicit workdir base."
        ))
    }
}

fn resolve_env_file_layers(
    policy: &SandboxPolicyInput,
    workspace_config: Option<&WorkspaceConfigResolution>,
    scope_root: &Path,
    notes: &mut Vec<String>,
) -> Result<Vec<ResolvedSandboxEnvFile>, String> {
    let mut env_files = Vec::new();

    if let Some(raw) = workspace_config
        .and_then(|entry| entry.config.as_ref())
        .and_then(|config| config.env_file.as_deref())
    {
        env_files.push(resolve_env_file(
            raw,
            scope_root,
            SandboxEnvFileSource::WorkspaceConfig,
        )?);
    }
    if let Some(raw) = policy.env_file.as_deref() {
        env_files.push(resolve_env_file(
            raw,
            scope_root,
            SandboxEnvFileSource::Request,
        )?);
    }

    if !env_files.is_empty() {
        notes.push(format!(
            "Resolved {} env file layer(s) for sandbox environment injection.",
            env_files.len()
        ));
    }

    Ok(env_files)
}

fn resolve_env_file(
    raw_path: &str,
    scope_root: &Path,
    source: SandboxEnvFileSource,
) -> Result<ResolvedSandboxEnvFile, String> {
    let path = resolve_user_path(raw_path, Some(scope_root))?;
    let keys = parse_env_file_keys(&path)?;

    Ok(ResolvedSandboxEnvFile {
        path: path.to_string_lossy().to_string(),
        source,
        keys,
    })
}

fn resolve_network_mode(
    requested: Option<SandboxNetworkMode>,
    capabilities: &BTreeSet<SandboxCapability>,
) -> Result<SandboxNetworkMode, String> {
    if capabilities.contains(&SandboxCapability::NetworkAccess) {
        return Ok(requested.unwrap_or(SandboxNetworkMode::Bridge));
    }

    match requested {
        Some(SandboxNetworkMode::Bridge) => Err(
            "Sandbox policy networkMode=bridge requires the networkAccess capability.".to_string(),
        ),
        _ => Ok(SandboxNetworkMode::None),
    }
}

fn resolve_linked_worktrees(
    policy: &SandboxPolicyInput,
    context: Option<&SandboxPolicyContext>,
    scope_root: &Path,
    capabilities: &BTreeSet<SandboxCapability>,
    notes: &mut Vec<String>,
) -> Result<Vec<ResolvedSandboxLinkedWorktree>, String> {
    let mode = policy.linked_worktree_mode.unwrap_or_default();
    if mode == SandboxLinkedWorktreeMode::Disabled {
        return Ok(Vec::new());
    }

    if !capabilities.contains(&SandboxCapability::LinkedWorktreeRead) {
        return Err(
            "Sandbox policy linkedWorktreeMode requires the linkedWorktreeRead capability."
                .to_string(),
        );
    }

    let available = context
        .map(|ctx| ctx.available_worktrees.as_slice())
        .unwrap_or(&[]);
    if available.is_empty() {
        notes.push("No active linked worktrees available for this sandbox context.".to_string());
        return Ok(Vec::new());
    }

    let requested_ids = policy
        .linked_worktree_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if mode == SandboxLinkedWorktreeMode::Explicit && requested_ids.is_empty() {
        return Err(
            "Sandbox policy linkedWorktreeMode=explicit requires linkedWorktreeIds.".to_string(),
        );
    }

    let mut selected = Vec::new();
    for worktree in available {
        let include = match mode {
            SandboxLinkedWorktreeMode::Disabled => false,
            SandboxLinkedWorktreeMode::All => true,
            SandboxLinkedWorktreeMode::Explicit => requested_ids.contains(&worktree.id),
        };
        if !include {
            continue;
        }

        let host_path = canonicalize_existing_path(Path::new(&worktree.worktree_path))?;
        if host_path == scope_root {
            notes.push(format!(
                "Skipped linked worktree {} because it matches the sandbox scope root.",
                worktree.id
            ));
            continue;
        }

        selected.push(ResolvedSandboxLinkedWorktree {
            id: worktree.id.clone(),
            codebase_id: worktree.codebase_id.clone(),
            branch: worktree.branch.clone(),
            host_path: host_path.to_string_lossy().to_string(),
            container_path: format!(
                "{}/{:02}-{}",
                SANDBOX_LINKED_WORKTREE_ROOT,
                selected.len(),
                sanitize_mount_name(Path::new(&worktree.worktree_path))
            ),
        });
    }

    if mode == SandboxLinkedWorktreeMode::Explicit {
        let selected_ids = selected
            .iter()
            .map(|worktree| worktree.id.clone())
            .collect::<BTreeSet<_>>();
        let missing = requested_ids
            .difference(&selected_ids)
            .cloned()
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(format!(
                "Sandbox policy linkedWorktreeIds not found or inactive: {}",
                missing.join(", ")
            ));
        }
    }

    if !selected.is_empty() {
        notes.push(format!(
            "Mounted {} linked worktree(s) as read-only comparison roots.",
            selected.len()
        ));
    }

    Ok(selected)
}

fn resolve_capability_view(
    capabilities: &BTreeSet<SandboxCapability>,
    uses_workspace_write: bool,
    network_mode: SandboxNetworkMode,
    has_linked_worktrees: bool,
) -> Vec<ResolvedSandboxCapability> {
    [
        SandboxCapability::WorkspaceRead,
        SandboxCapability::WorkspaceWrite,
        SandboxCapability::NetworkAccess,
        SandboxCapability::LinkedWorktreeRead,
    ]
    .into_iter()
    .map(|capability| ResolvedSandboxCapability {
        capability,
        tier: capability_tier(capability),
        enabled: capability == SandboxCapability::WorkspaceRead
            || capabilities.contains(&capability),
        reason: capability_reason(
            capability,
            capabilities,
            uses_workspace_write,
            network_mode,
            has_linked_worktrees,
        ),
    })
    .collect()
}

fn capability_tier(capability: SandboxCapability) -> SandboxCapabilityTier {
    match capability {
        SandboxCapability::WorkspaceRead | SandboxCapability::LinkedWorktreeRead => {
            SandboxCapabilityTier::Observation
        }
        SandboxCapability::WorkspaceWrite | SandboxCapability::NetworkAccess => {
            SandboxCapabilityTier::Action
        }
    }
}

fn capability_reason(
    capability: SandboxCapability,
    capabilities: &BTreeSet<SandboxCapability>,
    uses_workspace_write: bool,
    network_mode: SandboxNetworkMode,
    has_linked_worktrees: bool,
) -> String {
    match capability {
        SandboxCapability::WorkspaceRead => {
            "Implicitly enabled for the primary workspace/codebase mount.".to_string()
        }
        SandboxCapability::WorkspaceWrite => {
            if capabilities.contains(&SandboxCapability::WorkspaceWrite) {
                if uses_workspace_write {
                    "Allow-listed and used to authorize read-write path grants.".to_string()
                } else {
                    "Allow-listed, but no read-write path grants are currently in use.".to_string()
                }
            } else {
                "Not allow-listed; workspace and extra mounts remain read-only.".to_string()
            }
        }
        SandboxCapability::NetworkAccess => {
            if capabilities.contains(&SandboxCapability::NetworkAccess) {
                format!("Allow-listed with effective network mode {network_mode:?}.")
            } else {
                "Not allow-listed; network defaults to none.".to_string()
            }
        }
        SandboxCapability::LinkedWorktreeRead => {
            if capabilities.contains(&SandboxCapability::LinkedWorktreeRead) {
                if has_linked_worktrees {
                    "Allow-listed and used to mount linked worktrees read-only.".to_string()
                } else {
                    "Allow-listed, but no linked worktrees were selected.".to_string()
                }
            } else {
                "Not allow-listed; linked worktrees are unavailable.".to_string()
            }
        }
    }
}

fn canonicalize_existing_path(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path)
        .map_err(|e| format!("Failed to resolve sandbox path '{}': {}", path.display(), e))
}

fn is_within(root: &Path, path: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn to_container_path(scope_root: &Path, host_path: &Path) -> String {
    if host_path == scope_root {
        return SANDBOX_SCOPE_CONTAINER_ROOT.to_string();
    }

    let suffix = host_path
        .strip_prefix(scope_root)
        .unwrap_or(host_path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/");

    format!("{SANDBOX_SCOPE_CONTAINER_ROOT}/{suffix}")
}

fn collect_override_mounts(
    scope_root: &Path,
    scope_access: SandboxMountAccess,
    read_only_paths: &[PathBuf],
    read_write_paths: &[PathBuf],
    notes: &mut Vec<String>,
) -> Vec<SandboxMount> {
    let mut mounts = Vec::new();

    let mut push_override_mounts =
        |paths: &[PathBuf], access: SandboxMountAccess, redundant_when: SandboxMountAccess| {
            let mut paths = paths
                .iter()
                .filter(|path| is_within(scope_root, path) && *path != scope_root)
                .cloned()
                .collect::<Vec<_>>();

            paths.sort_by_key(|path| path.components().count());
            for path in paths {
                if scope_access == redundant_when {
                    notes.push(format!(
                        "Skipped redundant {:?} override inside scope root: {}",
                        access,
                        path.display()
                    ));
                    continue;
                }

                mounts.push(SandboxMount {
                    host_path: path.to_string_lossy().to_string(),
                    container_path: to_container_path(scope_root, &path),
                    access,
                    reason: Some("scopeOverride".to_string()),
                });
            }
        };

    push_override_mounts(
        read_only_paths,
        SandboxMountAccess::ReadOnly,
        SandboxMountAccess::ReadOnly,
    );
    push_override_mounts(
        read_write_paths,
        SandboxMountAccess::ReadWrite,
        SandboxMountAccess::ReadWrite,
    );

    mounts
}

fn collect_external_mounts(
    scope_root: &Path,
    paths: &[PathBuf],
    access: SandboxMountAccess,
) -> Vec<SandboxMount> {
    paths
        .iter()
        .filter(|path| !is_within(scope_root, path))
        .enumerate()
        .map(|(index, path)| SandboxMount {
            host_path: path.to_string_lossy().to_string(),
            container_path: format!(
                "{}/{:02}-{}",
                match access {
                    SandboxMountAccess::ReadOnly => SANDBOX_EXTRA_READONLY_ROOT,
                    SandboxMountAccess::ReadWrite => SANDBOX_EXTRA_READWRITE_ROOT,
                },
                index,
                sanitize_mount_name(path)
            ),
            access,
            reason: Some("explicitGrant".to_string()),
        })
        .collect()
}

fn sanitize_mount_name(path: &Path) -> String {
    let raw = path
        .file_name()
        .unwrap_or(path.as_os_str())
        .to_string_lossy();
    let name = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(48)
        .collect::<String>();

    if name.is_empty() {
        "path".to_string()
    } else {
        name
    }
}

#[cfg(test)]
mod policy_tests;
