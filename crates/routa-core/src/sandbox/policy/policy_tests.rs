use std::path::Path;

use super::*;

fn write_dir(path: &Path) {
    std::fs::create_dir_all(path).expect("directory should be created");
}

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        write_dir(parent);
    }
    std::fs::write(path, content).expect("file should be written");
}

fn canonical(path: &Path) -> String {
    std::fs::canonicalize(path)
        .expect("path should be canonicalizable")
        .to_string_lossy()
        .to_string()
}

#[test]
fn empty_policy_is_detected() {
    assert!(SandboxPolicyInput::default().is_empty());
}

#[test]
fn resolve_policy_uses_explicit_workdir_as_scope_when_no_context() {
    let temp = tempfile::tempdir().expect("tempdir should exist");
    let repo = temp.path().join("repo");
    let child = repo.join("src");
    write_dir(&child);

    let policy = SandboxPolicyInput {
        workdir: Some(repo.to_string_lossy().to_string()),
        read_write_paths: vec![child.to_string_lossy().to_string()],
        capabilities: vec![SandboxCapability::WorkspaceWrite],
        ..Default::default()
    };

    let resolved = policy.resolve(None).expect("policy should resolve");
    assert_eq!(resolved.scope_root, canonical(&repo));
    assert_eq!(resolved.container_workdir, SANDBOX_SCOPE_CONTAINER_ROOT);
    assert_eq!(resolved.mounts[0].access, SandboxMountAccess::ReadOnly);
    assert!(resolved.mounts.iter().any(|mount| {
        mount.container_path.ends_with("/src") && mount.access == SandboxMountAccess::ReadWrite
    }));
}

#[test]
fn resolve_policy_uses_workspace_root_for_relative_paths() {
    let temp = tempfile::tempdir().expect("tempdir should exist");
    let repo = temp.path().join("repo");
    let scripts = repo.join("scripts");
    write_dir(&scripts);

    let policy = SandboxPolicyInput {
        workdir: Some("scripts".to_string()),
        read_write_paths: vec!["scripts".to_string()],
        capabilities: vec![SandboxCapability::WorkspaceWrite],
        ..Default::default()
    };
    let context = SandboxPolicyContext {
        workspace_id: Some("ws-1".to_string()),
        codebase_id: Some("cb-1".to_string()),
        workspace_root: Some(repo.clone()),
        available_worktrees: Vec::new(),
    };

    let resolved = policy
        .resolve(Some(context))
        .expect("policy should resolve");
    assert_eq!(resolved.host_workdir, canonical(&scripts));
    assert_eq!(resolved.container_workdir, "/workspace/scripts");
}

#[test]
fn resolve_policy_rejects_workdir_outside_scope_root() {
    let temp = tempfile::tempdir().expect("tempdir should exist");
    let repo = temp.path().join("repo");
    let outside = temp.path().join("outside");
    write_dir(&repo);
    write_dir(&outside);

    let policy = SandboxPolicyInput {
        workdir: Some(outside.to_string_lossy().to_string()),
        ..Default::default()
    };
    let context = SandboxPolicyContext {
        workspace_root: Some(repo),
        ..Default::default()
    };

    let err = policy
        .resolve(Some(context))
        .expect_err("workdir outside root should fail");
    assert!(err.contains("escapes scope root"));
}

#[test]
fn read_write_grant_wins_over_read_only_duplicate() {
    let temp = tempfile::tempdir().expect("tempdir should exist");
    let repo = temp.path().join("repo");
    let cache = repo.join("cache");
    write_dir(&cache);

    let policy = SandboxPolicyInput {
        workdir: Some(repo.to_string_lossy().to_string()),
        read_only_paths: vec![cache.to_string_lossy().to_string()],
        read_write_paths: vec![cache.to_string_lossy().to_string()],
        capabilities: vec![SandboxCapability::WorkspaceWrite],
        ..Default::default()
    };

    let resolved = policy.resolve(None).expect("policy should resolve");
    assert!(resolved.read_only_paths.is_empty());
    assert_eq!(resolved.read_write_paths, vec![canonical(&cache)]);
}

#[test]
fn trusted_workspace_config_is_loaded_and_merged() {
    let temp = tempfile::tempdir().expect("tempdir should exist");
    let repo = temp.path().join("repo");
    let scripts = repo.join("scripts");
    let cache = repo.join("cache");
    let output = repo.join("output");
    write_dir(&scripts);
    write_dir(&cache);
    write_dir(&output);
    write_file(
        &repo.join(".routa").join("sandbox.json"),
        r#"{
            "workdir": "scripts",
            "readOnlyPaths": ["cache"],
            "networkMode": "none",
            "envAllowlist": ["OPENAI_API_KEY"],
            "capabilities": ["workspaceWrite"]
        }"#,
    );

    let policy = SandboxPolicyInput {
        trust_workspace_config: true,
        read_write_paths: vec!["output".to_string()],
        env_allowlist: vec!["LANG".to_string()],
        ..Default::default()
    };
    let context = SandboxPolicyContext {
        workspace_root: Some(repo.clone()),
        ..Default::default()
    };

    let resolved = policy
        .resolve(Some(context))
        .expect("policy should resolve");

    assert_eq!(resolved.host_workdir, canonical(&scripts));
    assert_eq!(resolved.network_mode, SandboxNetworkMode::None);
    assert_eq!(
        resolved.env_allowlist,
        vec!["LANG".to_string(), "OPENAI_API_KEY".to_string()]
    );
    assert_eq!(
        resolved.workspace_config,
        Some(ResolvedSandboxWorkspaceConfig {
            path: canonical(&repo.join(".routa").join("sandbox.json")),
            trusted: true,
            loaded: true,
            reason: "loaded".to_string(),
        })
    );
    assert!(resolved.read_only_paths.contains(&canonical(&cache)));
    assert!(resolved.read_write_paths.contains(&canonical(&output)));
    assert!(resolved
        .notes
        .iter()
        .any(|note| note.contains("Loaded trusted workspace sandbox config")));
}

#[test]
fn workspace_config_is_ignored_without_trust() {
    let temp = tempfile::tempdir().expect("tempdir should exist");
    let repo = temp.path().join("repo");
    let scripts = repo.join("scripts");
    write_dir(&scripts);
    write_file(
        &repo.join(".routa").join("sandbox.json"),
        r#"{"workdir":"scripts","networkMode":"none"}"#,
    );

    let context = SandboxPolicyContext {
        workspace_root: Some(repo.clone()),
        ..Default::default()
    };
    let resolved = SandboxPolicyInput {
        workdir: Some(repo.to_string_lossy().to_string()),
        ..Default::default()
    }
    .resolve(Some(context))
    .expect("policy should resolve");

    assert_eq!(resolved.host_workdir, canonical(&repo));
    assert_eq!(resolved.network_mode, SandboxNetworkMode::None);
    assert_eq!(
        resolved.workspace_config,
        Some(ResolvedSandboxWorkspaceConfig {
            path: canonical(&repo.join(".routa").join("sandbox.json")),
            trusted: false,
            loaded: false,
            reason: "trustDisabled".to_string(),
        })
    );
}

#[test]
fn invalid_trusted_workspace_config_fails_resolution() {
    let temp = tempfile::tempdir().expect("tempdir should exist");
    let repo = temp.path().join("repo");
    write_dir(&repo);
    write_file(&repo.join(".routa").join("sandbox.json"), "{not-json");

    let err = SandboxPolicyInput {
        trust_workspace_config: true,
        ..Default::default()
    }
    .resolve(Some(SandboxPolicyContext {
        workspace_root: Some(repo),
        ..Default::default()
    }))
    .expect_err("invalid trusted config should fail");

    assert!(err.contains("Failed to parse trusted workspace sandbox config"));
}

#[test]
fn read_write_grants_require_workspace_write_capability() {
    let temp = tempfile::tempdir().expect("tempdir should exist");
    let repo = temp.path().join("repo");
    let cache = repo.join("cache");
    write_dir(&cache);

    let err = SandboxPolicyInput {
        workdir: Some(repo.to_string_lossy().to_string()),
        read_write_paths: vec![cache.to_string_lossy().to_string()],
        ..Default::default()
    }
    .resolve(None)
    .expect_err("write grants should require explicit capability");

    assert!(err.contains("workspaceWrite capability"));
}

#[test]
fn linked_worktrees_are_mounted_read_only_when_capability_is_enabled() {
    let temp = tempfile::tempdir().expect("tempdir should exist");
    let repo = temp.path().join("repo");
    let worktree = temp.path().join("wt-review");
    write_dir(&repo);
    write_dir(&worktree);

    let resolved = SandboxPolicyInput {
        workdir: Some(repo.to_string_lossy().to_string()),
        capabilities: vec![SandboxCapability::LinkedWorktreeRead],
        linked_worktree_mode: Some(SandboxLinkedWorktreeMode::All),
        ..Default::default()
    }
    .resolve(Some(SandboxPolicyContext {
        workspace_root: Some(repo.clone()),
        available_worktrees: vec![SandboxPolicyWorktree {
            id: "wt-1".to_string(),
            codebase_id: "cb-1".to_string(),
            worktree_path: worktree.to_string_lossy().to_string(),
            branch: "review".to_string(),
        }],
        ..Default::default()
    }))
    .expect("linked worktrees should resolve");

    assert_eq!(resolved.linked_worktrees.len(), 1);
    assert_eq!(resolved.linked_worktrees[0].id, "wt-1");
    assert!(resolved.mounts.iter().any(|mount| {
        mount.reason.as_deref() == Some("linkedWorktree")
            && mount.access == SandboxMountAccess::ReadOnly
    }));
    assert!(resolved
        .capabilities
        .iter()
        .any(|cap| cap.capability == SandboxCapability::LinkedWorktreeRead && cap.enabled));
}

#[test]
fn network_defaults_to_none_without_network_access_capability() {
    let temp = tempfile::tempdir().expect("tempdir should exist");
    let repo = temp.path().join("repo");
    write_dir(&repo);

    let resolved = SandboxPolicyInput {
        workdir: Some(repo.to_string_lossy().to_string()),
        ..Default::default()
    }
    .resolve(None)
    .expect("policy should resolve");

    assert_eq!(resolved.network_mode, SandboxNetworkMode::None);
    assert!(resolved
        .notes
        .iter()
        .any(|note| note.contains("Defaulted network mode to none")));
}
