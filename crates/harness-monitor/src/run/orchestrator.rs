use crate::attribute::attribution::{
    assess_run, summarize_planes, PlaneAssessment, RunAssessmentInput, RunOrigin, WorkspaceType,
};
use crate::evaluate::gates::{
    effect_classes_summary, evidence_inline_summary, EvidenceRequirementStatus,
};
use crate::observe::detect::scan_agents;
use crate::run::run::{Role, RunMode};
use crate::run::workspace::WorkspaceState;
use crate::shared::db::{Db, SessionListRow};
use crate::shared::models::{self, DetectedAgent};
use crate::{RunCommand, WorkspaceCommand};
use anyhow::{bail, Context, Result};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

#[derive(Debug, Clone)]
struct CliRunSummary {
    run_id: String,
    client: String,
    cwd: String,
    model: String,
    started_at_ms: i64,
    last_seen_at_ms: i64,
    status: String,
    ended_at_ms: Option<i64>,
    role: Role,
    mode: RunMode,
    workspace_id: String,
    workspace_path: String,
    workspace_state: WorkspaceState,
    origin: RunOrigin,
    operator_state: String,
    effect_classes: Vec<crate::run::policy::EffectClass>,
    policy_decision: crate::run::policy::PolicyDecisionKind,
    approval_label: String,
    block_reason: Option<String>,
    integrity_warning: Option<String>,
    next_action: String,
    handoff_summary: Option<String>,
    recovery_hints: Vec<String>,
    evidence: Vec<EvidenceRequirementStatus>,
    exact_files: usize,
    inferred_files: usize,
    unknown_files: usize,
    changed_files: Vec<String>,
    latest_eval: Option<crate::evaluate::eval::EvalSnapshot>,
    planes: Vec<PlaneAssessment>,
}

#[derive(Debug, Clone, Default)]
struct GitWorktreeRecord {
    path: String,
    head: Option<String>,
    branch: Option<String>,
    detached: bool,
}

#[derive(Debug, Clone)]
struct CliWorkspaceSummary {
    id: String,
    path: String,
    branch: Option<String>,
    head: Option<String>,
    detached: bool,
    state: String,
    dirty_files: usize,
    dirty_paths: Vec<String>,
    attached_runs: Vec<String>,
    attached_agents: Vec<String>,
    integrity_warnings: Vec<String>,
    recovery_hint: Option<String>,
}

pub(crate) fn handle_run_command(action: RunCommand, db: &Db, repo_root: &str) -> Result<()> {
    let detected_agents = scan_agents(repo_root).unwrap_or_default();
    let worktrees = load_git_worktree_records(repo_root).unwrap_or_else(|_| {
        vec![GitWorktreeRecord {
            path: repo_root.to_string(),
            head: None,
            branch: Some("main".to_string()),
            detached: false,
        }]
    });
    match action {
        RunCommand::List => {
            let runs = load_cli_run_summaries(db, repo_root, &detected_agents, &worktrees)?;
            if runs.is_empty() {
                println!("No active runs.");
                return Ok(());
            }
            println!(
                "{:<24}  {:<10}  {:<11}  {:<10}  {:<14}  {:>5}",
                "RUN / SESSION", "ROLE", "STATE", "WORKSPACE", "ORIGIN", "FILES"
            );
            println!("{}", "-".repeat(92));
            for run in &runs {
                println!(
                    "{:<24}  {:<10}  {:<11}  {:<10}  {:<14}  {:>5}",
                    run.run_id,
                    run.role.as_str(),
                    run.operator_state,
                    run.workspace_id,
                    run.origin.as_str(),
                    run.changed_files.len()
                );
            }
        }
        RunCommand::Show { id } => {
            let runs = load_cli_run_summaries(db, repo_root, &detected_agents, &worktrees)?;
            let found = runs.iter().find(|run| run.run_id == id);
            match found {
                Some(run) => {
                    println!("run_id:      {}", run.run_id);
                    println!("mode:        {}", run.mode.as_str());
                    println!("origin:      {}", run.origin.as_str());
                    println!("role:        {}", run.role.as_str());
                    println!("state:       {}", run.operator_state);
                    println!(
                        "block:       {}",
                        run.block_reason.as_deref().unwrap_or("-")
                    );
                    println!("client:      {}", run.client);
                    println!("status:      {}", run.status);
                    println!("cwd:         {}", run.cwd);
                    println!(
                        "workspace:   {} ({})",
                        run.workspace_id,
                        run.workspace_state.as_str()
                    );
                    println!("worktree:    {}", run.workspace_path);
                    println!(
                        "files:       {} exact / {} inferred / {} unknown",
                        run.exact_files, run.inferred_files, run.unknown_files
                    );
                    println!("started:     {}", format_timestamp_ms(run.started_at_ms));
                    println!("last_seen:   {}", format_timestamp_ms(run.last_seen_at_ms));
                    if let Some(ended_at_ms) = run.ended_at_ms.filter(|ms| *ms > 0) {
                        println!("ended:       {}", format_timestamp_ms(ended_at_ms));
                    }
                    if !run.model.is_empty() {
                        println!("model:       {}", run.model);
                    }
                    if let Some(eval) = &run.latest_eval {
                        println!("eval:        {}", summarize_eval(eval));
                    } else {
                        println!("eval:        pending");
                    }
                    println!("policy:      {}", run.policy_decision.as_str());
                    println!("approval:    {}", run.approval_label);
                    println!(
                        "effects:     {}",
                        effect_classes_summary(&run.effect_classes)
                    );
                    println!("evidence:    {}", evidence_inline_summary(&run.evidence));
                    println!("planes:      {}", summarize_planes(&run.planes));
                    if let Some(warning) = &run.integrity_warning {
                        println!("integrity:   {}", warning);
                    }
                    println!("next:        {}", run.next_action);
                    if let Some(handoff) = &run.handoff_summary {
                        println!("handoff:     {}", handoff);
                    }
                    if !run.recovery_hints.is_empty() {
                        println!("recovery:    {}", run.recovery_hints.join("; "));
                    }
                    if run.changed_files.is_empty() {
                        println!("changed:     -");
                    } else {
                        println!("changed:");
                        for path in &run.changed_files {
                            println!("  - {}", path);
                        }
                    }
                }
                None => println!("Run '{id}' not found."),
            }
        }
        RunCommand::Attach { session } => {
            println!("Attaching observer to session: {session}");
            println!("(Managed attachment is a Phase 3 capability.)");
        }
        RunCommand::Stop { id } => {
            println!("Stop requested for run: {id}");
            println!("(Managed stop/interrupt is a Phase 3 capability.)");
        }
    }
    Ok(())
}

pub(crate) fn handle_workspace_command(
    action: WorkspaceCommand,
    repo_root: &str,
    db: Option<&Db>,
) -> Result<()> {
    let worktrees = load_git_worktree_records(repo_root).unwrap_or_else(|_| {
        vec![GitWorktreeRecord {
            path: repo_root.to_string(),
            head: None,
            branch: Some("main".to_string()),
            detached: false,
        }]
    });
    let detected_agents = scan_agents(repo_root).unwrap_or_default();
    let runs = db
        .and_then(|db| load_cli_run_summaries(db, repo_root, &detected_agents, &worktrees).ok())
        .unwrap_or_default();
    let workspaces = load_cli_workspace_summaries(repo_root, &worktrees, &detected_agents, &runs)?;
    match action {
        WorkspaceCommand::List => {
            if !workspaces.is_empty() {
                println!(
                    "{:<16}  {:<10}  {:>4}  {:>6}  {:<20}  PATH",
                    "WORKSPACE", "STATE", "RUNS", "AGENTS", "BRANCH"
                );
                println!("{}", "-".repeat(108));
                for workspace in &workspaces {
                    println!(
                        "{:<16}  {:<10}  {:>4}  {:>6}  {:<20}  {}",
                        workspace.id,
                        workspace.state,
                        workspace.attached_runs.len(),
                        workspace.attached_agents.len(),
                        workspace
                            .branch
                            .clone()
                            .unwrap_or_else(|| "<detached>".to_string()),
                        workspace.path
                    );
                }
            } else {
                println!("worktree: {repo_root} (main)");
            }
        }
        WorkspaceCommand::Show { id } => {
            let found = workspaces.iter().find(|workspace| {
                workspace.path == id
                    || workspace.id == id
                    || (id == "main" && workspace.path == repo_root)
            });

            match found {
                Some(workspace) => {
                    println!("workspace:   {}", workspace.id);
                    println!("path:        {}", workspace.path);
                    println!(
                        "branch:      {}",
                        workspace
                            .branch
                            .clone()
                            .unwrap_or_else(|| "<detached>".to_string())
                    );
                    if let Some(head) = &workspace.head {
                        println!("head:        {}", head);
                    }
                    println!("state:       {}", workspace.state);
                    println!("dirty_files: {}", workspace.dirty_files);
                    if workspace.dirty_paths.is_empty() {
                        println!("dirty_paths: -");
                    } else {
                        println!("dirty_paths: {}", workspace.dirty_paths.join(", "));
                    }
                    println!("runs:        {}", workspace.attached_runs.len());
                    if workspace.attached_runs.is_empty() {
                        println!("run_ids:      -");
                    } else {
                        println!("run_ids:     {}", workspace.attached_runs.join(", "));
                    }
                    println!("agents:      {}", workspace.attached_agents.len());
                    if workspace.attached_agents.is_empty() {
                        println!("agent_ids:    -");
                    } else {
                        println!("agent_ids:   {}", workspace.attached_agents.join(", "));
                    }
                    if workspace.integrity_warnings.is_empty() {
                        println!("integrity:   ok");
                    } else {
                        println!("integrity:   {}", workspace.integrity_warnings.join("; "));
                    }
                    if let Some(hint) = &workspace.recovery_hint {
                        println!("recovery:    {}", hint);
                    }
                    println!("detached:    {}", workspace.detached);
                }
                None => println!("Workspace '{id}' not found."),
            }
        }
    }
    Ok(())
}

pub(crate) fn summarize_eval(eval: &crate::evaluate::eval::EvalSnapshot) -> String {
    let status = if eval.hard_gate_blocked {
        "blocked(hard)"
    } else if eval.score_blocked {
        "blocked(score)"
    } else {
        "pass"
    };
    format!(
        "{} {} {:.1}%",
        eval.mode.as_str(),
        status,
        eval.overall_score
    )
}

fn format_timestamp_ms(timestamp_ms: i64) -> String {
    if timestamp_ms <= 0 {
        return "unknown".to_string();
    }

    chrono::DateTime::from_timestamp_millis(timestamp_ms)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| timestamp_ms.to_string())
}

fn load_cli_run_summaries(
    db: &Db,
    repo_root: &str,
    detected_agents: &[DetectedAgent],
    worktrees: &[GitWorktreeRecord],
) -> Result<Vec<CliRunSummary>> {
    let sessions = db.list_active_sessions(repo_root)?;
    let dirty_files = db.file_state_all_dirty(repo_root)?;
    let latest_eval_by_run = load_latest_eval_by_run(db, &sessions)?;
    Ok(build_cli_run_summaries(
        repo_root,
        sessions,
        dirty_files,
        detected_agents,
        worktrees,
        &latest_eval_by_run,
    ))
}

fn build_cli_run_summaries(
    repo_root: &str,
    sessions: Vec<SessionListRow>,
    dirty_files: Vec<models::FileStateRow>,
    detected_agents: &[DetectedAgent],
    worktrees: &[GitWorktreeRecord],
    latest_eval_by_run: &BTreeMap<String, crate::evaluate::eval::EvalSnapshot>,
) -> Vec<CliRunSummary> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let active_cutoff_ms = now_ms - models::DEFAULT_INFERENCE_WINDOW_MS;
    let mut dirty_by_session: BTreeMap<String, Vec<models::FileStateRow>> = BTreeMap::new();
    let mut unknown_rows = Vec::new();

    for row in dirty_files {
        if let Some(session_id) = row.session_id.clone() {
            dirty_by_session.entry(session_id).or_default().push(row);
        } else {
            unknown_rows.push(row);
        }
    }

    let mut runs = Vec::new();
    let session_rows = sessions
        .into_iter()
        .filter(
            |(session_id, _cwd, _model, _started, last_seen, _client, _status, _ended)| {
                *last_seen >= active_cutoff_ms || dirty_by_session.contains_key(session_id)
            },
        )
        .collect::<Vec<_>>();
    let has_session_runs = !session_rows.is_empty();

    for (session_id, cwd, model, started_at_ms, last_seen_at_ms, client, status, ended_at_ms) in
        &session_rows
    {
        let rows = dirty_by_session.remove(session_id).unwrap_or_default();
        let exact_files = rows
            .iter()
            .filter(|row| row.confidence.as_deref() == Some("exact"))
            .count();
        let inferred_files = rows
            .iter()
            .filter(|row| row.confidence.as_deref() == Some("inferred"))
            .count();
        let unknown_files = rows
            .iter()
            .filter(|row| row.confidence.as_deref() != Some("exact"))
            .filter(|row| row.confidence.as_deref() != Some("inferred"))
            .count();
        let changed_files = rows
            .iter()
            .map(|row| row.rel_path.clone())
            .collect::<Vec<_>>();
        let latest_eval = latest_eval_by_run.get(session_id).cloned();
        let (workspace_id, workspace_path, workspace_detached, workspace_branch, workspace_type) =
            workspace_identity_for(Some(cwd), repo_root, worktrees);
        let missing_path = Path::new(repo_root).exists() && !Path::new(&workspace_path).exists();
        let assessment = assess_run(&RunAssessmentInput {
            run_id: session_id,
            display_name: session_id,
            client,
            status,
            last_event_name: None,
            last_tool_name: None,
            changed_files: &changed_files,
            touched_files_count: exact_files + inferred_files + unknown_files,
            exact_files_count: exact_files,
            inferred_files_count: inferred_files,
            unknown_files_count: unknown_files,
            is_unknown_bucket: false,
            is_synthetic_run: false,
            is_service_run: false,
            workspace_path: &workspace_path,
            workspace_branch: workspace_branch.as_deref(),
            workspace_type,
            workspace_detached,
            workspace_missing: missing_path,
            has_eval: latest_eval.is_some(),
            hard_gate_blocked: latest_eval
                .as_ref()
                .is_some_and(|eval| eval.hard_gate_blocked),
            score_blocked: latest_eval.as_ref().is_some_and(|eval| eval.score_blocked),
            has_coverage: latest_eval.as_ref().is_some_and(eval_has_coverage_evidence),
            api_contract_passed: latest_eval.as_ref().is_some_and(eval_api_contract_passed),
        });

        runs.push(CliRunSummary {
            run_id: session_id.clone(),
            client: client.clone(),
            cwd: cwd.clone(),
            model: model.clone(),
            started_at_ms: *started_at_ms,
            last_seen_at_ms: *last_seen_at_ms,
            status: status.clone(),
            ended_at_ms: *ended_at_ms,
            role: assessment.role,
            mode: assessment.mode,
            workspace_id,
            workspace_path,
            workspace_state: assessment.workspace_state,
            origin: assessment.origin,
            operator_state: assessment.operator_state,
            effect_classes: assessment.effect_classes,
            policy_decision: assessment.policy_decision,
            approval_label: assessment.approval_label,
            block_reason: assessment.block_reason,
            integrity_warning: assessment.integrity_warning,
            next_action: assessment.next_action,
            handoff_summary: assessment.handoff_summary,
            recovery_hints: assessment.recovery_hints,
            evidence: assessment.evidence,
            exact_files,
            inferred_files,
            unknown_files,
            changed_files,
            latest_eval,
            planes: assessment.planes,
        });
    }

    if !has_session_runs {
        for agent in detected_agents
            .iter()
            .filter(|agent| is_repo_local_agent_cli(agent, repo_root))
        {
            let (
                workspace_id,
                workspace_path,
                workspace_detached,
                workspace_branch,
                workspace_type,
            ) = workspace_identity_for(agent.cwd.as_deref(), repo_root, worktrees);
            let synthetic_status = agent.status.to_ascii_lowercase();
            let assessment = assess_run(&RunAssessmentInput {
                run_id: &format!("agent:{}:{}", agent.name.to_ascii_lowercase(), agent.pid),
                display_name: &format!("{}#{}", agent.name, agent.pid),
                client: &agent.name.to_ascii_lowercase(),
                status: &synthetic_status,
                last_event_name: Some("process-scan"),
                last_tool_name: None,
                changed_files: &[],
                touched_files_count: 0,
                exact_files_count: 0,
                inferred_files_count: 0,
                unknown_files_count: 0,
                is_unknown_bucket: false,
                is_synthetic_run: true,
                is_service_run: is_mcp_service_agent(agent),
                workspace_path: &workspace_path,
                workspace_branch: workspace_branch.as_deref(),
                workspace_type,
                workspace_detached,
                workspace_missing: Path::new(repo_root).exists()
                    && !Path::new(&workspace_path).exists(),
                has_eval: false,
                hard_gate_blocked: false,
                score_blocked: false,
                has_coverage: false,
                api_contract_passed: false,
            });

            runs.push(CliRunSummary {
                run_id: format!("agent:{}:{}", agent.name.to_ascii_lowercase(), agent.pid),
                client: agent.name.to_ascii_lowercase(),
                cwd: agent.cwd.clone().unwrap_or_else(|| repo_root.to_string()),
                model: String::new(),
                started_at_ms: 0,
                last_seen_at_ms: now_ms,
                status: synthetic_status,
                ended_at_ms: None,
                role: assessment.role,
                mode: assessment.mode,
                workspace_id,
                workspace_path,
                workspace_state: assessment.workspace_state,
                origin: assessment.origin,
                operator_state: assessment.operator_state,
                effect_classes: assessment.effect_classes,
                policy_decision: assessment.policy_decision,
                approval_label: assessment.approval_label,
                block_reason: assessment.block_reason,
                integrity_warning: assessment.integrity_warning,
                next_action: assessment.next_action,
                handoff_summary: assessment.handoff_summary,
                recovery_hints: assessment.recovery_hints,
                evidence: assessment.evidence,
                exact_files: 0,
                inferred_files: 0,
                unknown_files: 0,
                changed_files: Vec::new(),
                latest_eval: None,
                planes: assessment.planes,
            });
        }
    }

    if !unknown_rows.is_empty() {
        let (workspace_id, workspace_path, workspace_detached, workspace_branch, workspace_type) =
            workspace_identity_for(Some(repo_root), repo_root, worktrees);
        let changed_files = unknown_rows
            .iter()
            .map(|row| row.rel_path.clone())
            .collect::<Vec<_>>();
        let assessment = assess_run(&RunAssessmentInput {
            run_id: "unknown",
            display_name: "Unknown / review",
            client: "unknown",
            status: "unknown",
            last_event_name: Some("review"),
            last_tool_name: None,
            changed_files: &changed_files,
            touched_files_count: unknown_rows.len(),
            exact_files_count: 0,
            inferred_files_count: 0,
            unknown_files_count: unknown_rows.len(),
            is_unknown_bucket: true,
            is_synthetic_run: false,
            is_service_run: false,
            workspace_path: repo_root,
            workspace_branch: workspace_branch.as_deref(),
            workspace_type,
            workspace_detached,
            workspace_missing: false,
            has_eval: false,
            hard_gate_blocked: false,
            score_blocked: false,
            has_coverage: false,
            api_contract_passed: false,
        });

        runs.push(CliRunSummary {
            run_id: "unknown".to_string(),
            client: "unknown".to_string(),
            cwd: repo_root.to_string(),
            model: String::new(),
            started_at_ms: 0,
            last_seen_at_ms: unknown_rows
                .iter()
                .map(|row| row.last_seen_ms)
                .max()
                .unwrap_or(0),
            status: "unknown".to_string(),
            ended_at_ms: None,
            role: assessment.role,
            mode: assessment.mode,
            workspace_id,
            workspace_path,
            workspace_state: assessment.workspace_state,
            origin: assessment.origin,
            operator_state: assessment.operator_state,
            effect_classes: assessment.effect_classes,
            policy_decision: assessment.policy_decision,
            approval_label: assessment.approval_label,
            block_reason: assessment.block_reason,
            integrity_warning: assessment.integrity_warning,
            next_action: assessment.next_action,
            handoff_summary: assessment.handoff_summary,
            recovery_hints: assessment.recovery_hints,
            evidence: assessment.evidence,
            exact_files: 0,
            inferred_files: 0,
            unknown_files: unknown_rows.len(),
            changed_files,
            latest_eval: None,
            planes: assessment.planes,
        });
    }

    runs.sort_by(|a, b| {
        b.last_seen_at_ms
            .cmp(&a.last_seen_at_ms)
            .then_with(|| a.run_id.cmp(&b.run_id))
    });
    runs
}

fn infer_cli_workspace_state(
    dirty_files: usize,
    latest_eval: Option<&crate::evaluate::eval::EvalSnapshot>,
    _detached: bool,
    missing_path: bool,
) -> &'static str {
    if missing_path {
        "corrupted"
    } else if dirty_files > 0 {
        "dirty"
    } else if latest_eval.is_some_and(|eval| !eval.hard_gate_blocked && !eval.score_blocked) {
        "validated"
    } else {
        "ready"
    }
}

fn eval_has_coverage_evidence(eval: &crate::evaluate::eval::EvalSnapshot) -> bool {
    eval.evidence
        .iter()
        .any(|evidence| evidence.kind.eq_ignore_ascii_case("coverage_report"))
}

fn eval_api_contract_passed(eval: &crate::evaluate::eval::EvalSnapshot) -> bool {
    eval.dimensions
        .iter()
        .find(|dimension| dimension.name.eq_ignore_ascii_case("api_contract"))
        .is_some_and(|dimension| !dimension.blocked)
}

fn load_latest_eval_by_run(
    db: &Db,
    sessions: &[SessionListRow],
) -> Result<BTreeMap<String, crate::evaluate::eval::EvalSnapshot>> {
    let mut latest_eval_by_run = BTreeMap::new();
    for (session_id, _, _, _, _, _, _, _) in sessions {
        if let Some(eval) = db
            .list_eval_snapshots_for_run(session_id, 1)?
            .into_iter()
            .next()
        {
            latest_eval_by_run.insert(session_id.clone(), eval);
        }
    }
    Ok(latest_eval_by_run)
}

fn load_cli_workspace_summaries(
    repo_root: &str,
    worktrees: &[GitWorktreeRecord],
    detected_agents: &[DetectedAgent],
    runs: &[CliRunSummary],
) -> Result<Vec<CliWorkspaceSummary>> {
    let worktrees = if worktrees.is_empty() {
        vec![GitWorktreeRecord {
            path: repo_root.to_string(),
            head: None,
            branch: Some("main".to_string()),
            detached: false,
        }]
    } else {
        worktrees.to_vec()
    };

    worktrees
        .into_iter()
        .map(|record| {
            let workspace_id = workspace_id_for(&record.path, repo_root);
            let attached_runs = runs
                .iter()
                .filter(|run| run.workspace_id == workspace_id)
                .map(|run| run.run_id.clone())
                .collect::<Vec<_>>();
            let attached_agents = detected_agents
                .iter()
                .filter(|agent| is_repo_local_agent_cli(agent, repo_root))
                .filter(|agent| {
                    workspace_identity_for(
                        agent.cwd.as_deref(),
                        repo_root,
                        std::slice::from_ref(&record),
                    )
                    .0 == workspace_id
                })
                .map(|agent| format!("{}#{}", agent.name.to_ascii_lowercase(), agent.pid))
                .collect::<Vec<_>>();
            let derived_dirty_paths = runs
                .iter()
                .filter(|run| run.workspace_id == workspace_id)
                .flat_map(|run| run.changed_files.iter().cloned())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            let dirty_paths =
                git_dirty_paths(&record.path).unwrap_or_else(|_| derived_dirty_paths.clone());
            let dirty_files = dirty_paths.len();
            let latest_eval = runs
                .iter()
                .filter(|run| run.workspace_id == workspace_id)
                .filter_map(|run| run.latest_eval.as_ref())
                .max_by_key(|eval| eval.evaluated_at_ms);
            let missing_path = !Path::new(&record.path).exists();
            let mut integrity_warnings = Vec::new();
            if record.detached {
                integrity_warnings.push("workspace is on detached HEAD".to_string());
            }
            if missing_path {
                integrity_warnings.push("workspace path missing".to_string());
            }

            Ok(CliWorkspaceSummary {
                id: workspace_id,
                path: record.path,
                branch: record.branch,
                head: record.head,
                detached: record.detached,
                state: infer_cli_workspace_state(
                    dirty_files,
                    latest_eval,
                    record.detached,
                    missing_path,
                )
                .to_string(),
                dirty_files,
                dirty_paths,
                attached_runs,
                attached_agents,
                integrity_warnings: integrity_warnings.clone(),
                recovery_hint: integrity_warnings.first().map(|warning| {
                    if warning.contains("detached HEAD") {
                        "reattach to a branch or validate before continuing".to_string()
                    } else {
                        "repair or recreate the worktree path".to_string()
                    }
                }),
            })
        })
        .collect()
}

fn load_git_worktree_records(repo_root: &str) -> Result<Vec<GitWorktreeRecord>> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .context("run git worktree list")?;
    if !output.status.success() {
        bail!("git worktree list failed");
    }
    Ok(parse_git_worktree_records(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn git_dirty_paths(worktree_path: &str) -> Result<Vec<String>> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("status")
        .arg("--porcelain")
        .arg("--untracked-files=all")
        .output()
        .with_context(|| format!("run git status for workspace {worktree_path}"))?;
    if !output.status.success() {
        bail!("git status failed for workspace {worktree_path}");
    }

    let lines = String::from_utf8(output.stdout).context("decode git status output")?;
    Ok(lines
        .lines()
        .filter_map(|line| line.get(3..))
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(|path| path.to_string())
        .collect())
}

fn parse_git_worktree_records(raw: &str) -> Vec<GitWorktreeRecord> {
    let mut records = Vec::new();
    let mut current = GitWorktreeRecord::default();

    for line in raw.lines() {
        if line.trim().is_empty() {
            if !current.path.is_empty() {
                records.push(current);
            }
            current = GitWorktreeRecord::default();
            continue;
        }
        if let Some(value) = line.strip_prefix("worktree ") {
            current.path = value.to_string();
        } else if let Some(value) = line.strip_prefix("HEAD ") {
            current.head = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("branch ") {
            current.branch = Some(
                value
                    .strip_prefix("refs/heads/")
                    .unwrap_or(value)
                    .to_string(),
            );
        } else if line == "detached" {
            current.detached = true;
        }
    }

    if !current.path.is_empty() {
        records.push(current);
    }
    records
}

fn workspace_id_for(path: &str, repo_root: &str) -> String {
    if path == repo_root {
        "main".to_string()
    } else {
        Path::new(path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string())
    }
}

fn workspace_identity_for(
    cwd: Option<&str>,
    repo_root: &str,
    worktrees: &[GitWorktreeRecord],
) -> (String, String, bool, Option<String>, WorkspaceType) {
    let normalized_repo_root = normalize_match_path(repo_root);
    let Some(cwd) = cwd else {
        return (
            "main".to_string(),
            repo_root.to_string(),
            false,
            None,
            WorkspaceType::Main,
        );
    };
    let normalized_cwd = normalize_match_path(cwd);
    let matching = worktrees.iter().find(|record| {
        let normalized_path = normalize_match_path(&record.path);
        normalized_path == normalized_cwd || path_contains(&normalized_path, &normalized_cwd)
    });
    if let Some(record) = matching {
        let ws_type = if record.path == repo_root
            || normalize_match_path(&record.path) == normalized_repo_root
        {
            WorkspaceType::Main
        } else {
            WorkspaceType::Linked
        };
        return (
            workspace_id_for(&record.path, repo_root),
            record.path.clone(),
            record.detached,
            record.branch.clone(),
            ws_type,
        );
    }
    if normalized_cwd == normalized_repo_root
        || path_contains(&normalized_repo_root, &normalized_cwd)
    {
        (
            "main".to_string(),
            repo_root.to_string(),
            false,
            None,
            WorkspaceType::Main,
        )
    } else {
        (
            Path::new(cwd)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "external".to_string()),
            cwd.to_string(),
            false,
            None,
            WorkspaceType::External,
        )
    }
}

fn normalize_match_path(path: &str) -> String {
    path.trim_end_matches('/').to_string()
}

fn path_contains(base: &str, candidate: &str) -> bool {
    candidate
        .strip_prefix(base)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

fn canonical_repo_identity(path: &str) -> String {
    let normalized = normalize_match_path(path);
    let basename = normalized.rsplit('/').next().unwrap_or(normalized.as_str());

    basename
        .split_once("-broken-")
        .map(|(prefix, _)| prefix)
        .or_else(|| basename.split_once("-remote-").map(|(prefix, _)| prefix))
        .unwrap_or(basename)
        .to_string()
}

fn is_repo_local_agent_cli(agent: &DetectedAgent, repo_root: &str) -> bool {
    agent.cwd.as_deref().is_some_and(|cwd| {
        let repo_root = normalize_match_path(repo_root);
        let cwd = normalize_match_path(cwd);
        cwd == repo_root
            || path_contains(&repo_root, &cwd)
            || canonical_repo_identity(&cwd) == canonical_repo_identity(&repo_root)
    })
}

fn is_mcp_service_agent(agent: &DetectedAgent) -> bool {
    agent.name.eq_ignore_ascii_case("auggie")
        && agent.command.to_ascii_lowercase().contains("--mcp")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evaluate::eval::{EvalMode, EvalSnapshot};

    #[test]
    fn parse_git_worktree_records_reads_multiple_entries() {
        let records = parse_git_worktree_records(
            "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /repo-wt\nHEAD def456\nbranch refs/heads/feature/x\n",
        );

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].path, "/repo");
        assert_eq!(records[0].branch.as_deref(), Some("main"));
        assert_eq!(records[1].path, "/repo-wt");
        assert_eq!(records[1].branch.as_deref(), Some("feature/x"));
    }

    #[test]
    fn workspace_id_maps_repo_root_to_main() {
        assert_eq!(workspace_id_for("/repo", "/repo"), "main");
        assert_eq!(workspace_id_for("/repo-worktree", "/repo"), "repo-worktree");
    }

    #[test]
    fn cli_run_state_prefers_failed_over_active() {
        let changed_files = vec!["src/main.rs".to_string()];
        let assessment = assess_run(&RunAssessmentInput {
            run_id: "run-1",
            display_name: "run-1",
            client: "codex",
            status: "active",
            last_event_name: None,
            last_tool_name: Some("write"),
            changed_files: &changed_files,
            touched_files_count: 1,
            exact_files_count: 1,
            inferred_files_count: 0,
            unknown_files_count: 0,
            is_unknown_bucket: false,
            is_synthetic_run: false,
            is_service_run: false,
            workspace_path: "/repo",
            workspace_branch: Some("main"),
            workspace_type: WorkspaceType::Main,
            workspace_detached: false,
            workspace_missing: false,
            has_eval: true,
            hard_gate_blocked: true,
            score_blocked: false,
            has_coverage: true,
            api_contract_passed: true,
        });

        assert_eq!(assessment.operator_state, "failed");
    }

    #[test]
    fn cli_run_summaries_include_repo_local_process_scan_runs() {
        let runs = build_cli_run_summaries(
            "/repo",
            Vec::new(),
            Vec::new(),
            &[DetectedAgent {
                key: "OpenAI:42".to_string(),
                name: "Codex".to_string(),
                vendor: "OpenAI".to_string(),
                icon: "◈".to_string(),
                pid: 42,
                cwd: Some("/repo".to_string()),
                cpu_percent: 0.0,
                mem_mb: 32.0,
                uptime_seconds: 90,
                status: "IDLE".to_string(),
                confidence: 80,
                project: "repo".to_string(),
                command: "codex --cwd /repo".to_string(),
            }],
            &[GitWorktreeRecord {
                path: "/repo".to_string(),
                head: Some("abc123".to_string()),
                branch: Some("main".to_string()),
                detached: false,
            }],
            &BTreeMap::new(),
        );

        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].run_id, "agent:codex:42");
        assert_eq!(runs[0].origin.as_str(), "process-scan");
        assert_eq!(runs[0].workspace_id, "main");
        assert_eq!(runs[0].workspace_state.as_str(), "ready");
        assert_eq!(runs[0].operator_state, "observing");
    }

    #[test]
    fn cli_run_summaries_prefer_session_rows_over_process_scan_runs() {
        let now = chrono::Utc::now().timestamp_millis();
        let runs = build_cli_run_summaries(
            "/repo",
            vec![(
                "sess-1".to_string(),
                "/repo".to_string(),
                "gpt-5.4".to_string(),
                now - 10 * 60 * 1000,
                now - 30_000,
                "codex".to_string(),
                "active".to_string(),
                None,
            )],
            Vec::new(),
            &[DetectedAgent {
                key: "OpenAI:42".to_string(),
                name: "Codex".to_string(),
                vendor: "OpenAI".to_string(),
                icon: "◈".to_string(),
                pid: 42,
                cwd: Some("/repo".to_string()),
                cpu_percent: 0.0,
                mem_mb: 32.0,
                uptime_seconds: 90,
                status: "IDLE".to_string(),
                confidence: 80,
                project: "repo".to_string(),
                command: "codex --cwd /repo".to_string(),
            }],
            &[GitWorktreeRecord {
                path: "/repo".to_string(),
                head: Some("abc123".to_string()),
                branch: Some("main".to_string()),
                detached: false,
            }],
            &BTreeMap::new(),
        );

        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].run_id, "sess-1");
        assert_eq!(runs[0].origin.as_str(), "hook-backed");
    }

    #[test]
    fn cli_run_summaries_hide_stale_sessions_without_dirty_signal() {
        let now = chrono::Utc::now().timestamp_millis();
        let runs = build_cli_run_summaries(
            "/repo",
            vec![(
                "sess-stale".to_string(),
                "/repo".to_string(),
                "gpt-5.4".to_string(),
                now - 60 * 60 * 1000,
                now - models::DEFAULT_INFERENCE_WINDOW_MS - 60_000,
                "codex".to_string(),
                "idle".to_string(),
                None,
            )],
            Vec::new(),
            &[],
            &[GitWorktreeRecord {
                path: "/repo".to_string(),
                head: Some("abc123".to_string()),
                branch: Some("main".to_string()),
                detached: false,
            }],
            &BTreeMap::new(),
        );

        assert!(runs.is_empty());
    }

    #[test]
    fn workspace_summaries_count_attached_runs_and_agents() {
        let temp = tempfile::tempdir().unwrap();
        let repo_root = temp.path().to_string_lossy().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        let mut evals = BTreeMap::new();
        evals.insert(
            "run-1".to_string(),
            EvalSnapshot {
                run_id: Some(crate::shared::ids::RunId::new("run-1")),
                mode: EvalMode::Fast,
                overall_score: 96.0,
                hard_gate_blocked: false,
                score_blocked: false,
                dimensions: Vec::new(),
                evidence: Vec::new(),
                recommendations: Vec::new(),
                evaluated_at_ms: 100,
                duration_ms: 10.0,
            },
        );
        let runs = build_cli_run_summaries(
            &repo_root,
            vec![(
                "run-1".to_string(),
                repo_root.clone(),
                "gpt-5.4".to_string(),
                now - 10 * 60 * 1000,
                now - 1_000,
                "codex".to_string(),
                "idle".to_string(),
                None,
            )],
            Vec::new(),
            &[DetectedAgent {
                key: "OpenAI:42".to_string(),
                name: "Codex".to_string(),
                vendor: "OpenAI".to_string(),
                icon: "◈".to_string(),
                pid: 42,
                cwd: Some(repo_root.clone()),
                cpu_percent: 0.0,
                mem_mb: 32.0,
                uptime_seconds: 90,
                status: "IDLE".to_string(),
                confidence: 80,
                project: temp
                    .path()
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                command: format!("codex --cwd {repo_root}"),
            }],
            &[GitWorktreeRecord {
                path: repo_root.clone(),
                head: Some("abc123".to_string()),
                branch: Some("main".to_string()),
                detached: false,
            }],
            &evals,
        );
        let workspaces = load_cli_workspace_summaries(
            &repo_root,
            &[GitWorktreeRecord {
                path: repo_root.clone(),
                head: Some("abc123".to_string()),
                branch: Some("main".to_string()),
                detached: false,
            }],
            &[DetectedAgent {
                key: "OpenAI:42".to_string(),
                name: "Codex".to_string(),
                vendor: "OpenAI".to_string(),
                icon: "◈".to_string(),
                pid: 42,
                cwd: Some(repo_root.clone()),
                cpu_percent: 0.0,
                mem_mb: 32.0,
                uptime_seconds: 90,
                status: "IDLE".to_string(),
                confidence: 80,
                project: temp
                    .path()
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                command: format!("codex --cwd {repo_root}"),
            }],
            &runs,
        )
        .unwrap();

        assert_eq!(workspaces.len(), 1);
        assert_eq!(workspaces[0].id, "main");
        assert_eq!(workspaces[0].state, "validated");
        assert_eq!(workspaces[0].attached_runs, vec!["run-1".to_string()]);
        assert_eq!(workspaces[0].attached_agents, vec!["codex#42".to_string()]);
    }

    #[test]
    fn git_dirty_paths_reads_real_worktree_status() {
        let temp = tempfile::tempdir().unwrap();
        std::process::Command::new("git")
            .arg("init")
            .arg(temp.path())
            .output()
            .expect("init git repo");
        std::process::Command::new("git")
            .arg("-C")
            .arg(temp.path())
            .args(["config", "user.email", "codex@example.com"])
            .output()
            .expect("set user email");
        std::process::Command::new("git")
            .arg("-C")
            .arg(temp.path())
            .args(["config", "user.name", "Codex"])
            .output()
            .expect("set user name");

        let tracked = temp.path().join("tracked.txt");
        std::fs::write(&tracked, "v1\n").unwrap();
        std::process::Command::new("git")
            .arg("-C")
            .arg(temp.path())
            .args(["add", "tracked.txt"])
            .output()
            .expect("stage tracked file");
        std::process::Command::new("git")
            .arg("-C")
            .arg(temp.path())
            .args(["commit", "-m", "init"])
            .output()
            .expect("commit tracked file");

        std::fs::write(&tracked, "v2\n").unwrap();
        std::fs::write(temp.path().join("untracked.txt"), "new\n").unwrap();

        let paths = git_dirty_paths(&temp.path().to_string_lossy()).unwrap();
        assert_eq!(
            paths,
            vec!["tracked.txt".to_string(), "untracked.txt".to_string()]
        );
    }

    #[test]
    fn format_timestamp_ms_marks_zero_as_unknown() {
        assert_eq!(format_timestamp_ms(0), "unknown");
        assert_eq!(format_timestamp_ms(-1), "unknown");
    }

    #[test]
    fn format_timestamp_ms_formats_valid_timestamp() {
        assert_eq!(
            format_timestamp_ms(1_700_000_000_000),
            "2023-11-14T22:13:20+00:00"
        );
    }
}
