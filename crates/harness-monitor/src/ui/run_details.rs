use super::fitness;
use super::*;
use crate::attribute::attribution::{
    assess_run, PlaneAssessment, RunAssessmentInput, RunOrigin, WorkspaceType,
};
use crate::evaluate::gates::{
    effect_classes_summary, evidence_inline_summary, EvidenceRequirementStatus,
};
use crate::feature_trace::{summarize_features, summarize_routes, SessionTraceMaterial};
use crate::run::run::{Role, RunMode};
use crate::run::workspace::WorkspaceState;
use crate::shared::models::{AttributionConfidence, FileView};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use std::collections::BTreeSet;

#[allow(dead_code)]
pub(super) struct RunOperatorModel {
    pub(super) role: Role,
    pub(super) mode: RunMode,
    pub(super) origin: RunOrigin,
    pub(super) operator_state: String,
    pub(super) workspace_path: String,
    pub(super) process_cwd: Option<String>,
    pub(super) workspace_state: WorkspaceState,
    pub(super) effect_classes: Vec<crate::run::policy::EffectClass>,
    pub(super) policy_decision: crate::run::policy::PolicyDecisionKind,
    pub(super) approval_label: String,
    pub(super) block_reason: Option<String>,
    pub(super) eval_summary: Option<String>,
    pub(super) evidence: Vec<EvidenceRequirementStatus>,
    pub(super) integrity_warning: Option<String>,
    pub(super) next_action: String,
    pub(super) handoff_summary: Option<String>,
    pub(super) recovery_hints: Vec<String>,
    pub(super) changed_files: Vec<String>,
    pub(super) journey_files: Vec<String>,
    pub(super) planes: Vec<PlaneAssessment>,
}

pub(super) fn render_run_details(
    state: &RuntimeState,
    cache: &mut AppCache,
    width: u16,
    colors: UiPalette,
) -> Vec<Line<'static>> {
    let Some(run) = state.selected_run_item() else {
        return vec![Line::from(Span::styled(
            "No run selected",
            Style::default().fg(colors.muted),
        ))];
    };

    let model = build_run_operator_model(state, cache, run);
    let origin_label = display_run_origin_label(model.origin);

    if run.is_synthetic_agent_run {
        return render_process_scan_run_details(state, run, &model, width, colors);
    }
    if run.is_all_runs_bucket {
        return vec![
            Line::from(Span::styled(
                "All",
                Style::default()
                    .fg(colors.text)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(vec![
                Span::styled("aggregate", Style::default().fg(colors.accent)),
                Span::raw("  "),
                Span::styled(
                    format!("{} dirty files", run.touched_files_count),
                    Style::default().fg(colors.text),
                ),
            ]),
            Line::from(vec![
                Span::styled("Confidence: ", Style::default().fg(colors.muted)),
                Span::styled(
                    format!(
                        "{} exact / {} inferred / {} unknown",
                        run.exact_count, run.inferred_count, run.unknown_count
                    ),
                    Style::default().fg(colors.text),
                ),
            ]),
            Line::from(vec![
                Span::styled("Workspace: ", Style::default().fg(colors.muted)),
                Span::styled(
                    shorten_path(&state.repo_root, width.saturating_sub(16) as usize),
                    Style::default().fg(colors.text),
                ),
            ]),
        ];
    }

    let prompt_history = recent_prompt_history_for_run(state, cache, run, 3);
    let mut lines = vec![
        Line::from(Span::styled(
            shorten_path(run.primary_label(), width.saturating_sub(4) as usize),
            Style::default()
                .fg(colors.text)
                .add_modifier(Modifier::BOLD),
        )),
        render_run_decision_line(run, &model, colors),
    ];

    if let Some(block_reason) = &model.block_reason {
        lines.push(Line::from(vec![
            Span::styled("Block: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(block_reason, width.saturating_sub(12) as usize),
                Style::default().fg(STOPPED),
            ),
        ]));
    }

    lines.push(Line::from(vec![
        Span::styled("Next: ", Style::default().fg(colors.muted)),
        Span::styled(
            shorten_path(&model.next_action, width.saturating_sub(12) as usize),
            Style::default().fg(colors.accent),
        ),
    ]));

    if let Some(handoff) = &model.handoff_summary {
        lines.push(Line::from(vec![
            Span::styled("Handoff: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(handoff, width.saturating_sub(14) as usize),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    if !model.evidence.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Evidence: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(
                    &evidence_inline_summary(&model.evidence),
                    width.saturating_sub(15) as usize,
                ),
                Style::default().fg(evidence_summary_color(&model.evidence)),
            ),
        ]));
    }

    if model.policy_decision != crate::run::policy::PolicyDecisionKind::Allow
        || model
            .effect_classes
            .iter()
            .any(|effect| *effect != crate::run::policy::EffectClass::ReadOnly)
    {
        lines.push(Line::from(vec![
            Span::styled("Policy: ", Style::default().fg(colors.muted)),
            Span::styled(
                model.policy_decision.as_str(),
                Style::default().fg(policy_decision_color(&model.policy_decision)),
            ),
            Span::raw("  "),
            Span::styled("Effects: ", Style::default().fg(colors.muted)),
            Span::styled(
                effect_classes_summary(&model.effect_classes),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    if let Some(task_title) = run
        .task_title
        .as_deref()
        .filter(|title| !title.trim().is_empty() && *title != run.primary_label())
    {
        lines.push(Line::from(vec![
            Span::styled("Task: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(task_title, width.saturating_sub(12) as usize),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    if let Some(prompt_trail) = prompt_trail_for_run(run, &prompt_history) {
        lines.push(Line::from(vec![
            Span::styled("Journey: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(&prompt_trail, width.saturating_sub(14) as usize),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    let feature_scope_summary = feature_trace_summary_for_run(state, cache, run, &model);
    if let Some(trace_summary) = activity_trace_for_run(state, run, &model) {
        let trace_text = match feature_scope_summary.as_deref() {
            Some(scope_summary) => format!("{trace_summary}  ->  {scope_summary}"),
            None => trace_summary,
        };
        lines.push(Line::from(vec![
            Span::styled("Trace: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(&trace_text, width.saturating_sub(12) as usize),
                Style::default().fg(colors.accent),
            ),
        ]));
    } else if let Some(scope_summary) = feature_scope_summary {
        lines.push(Line::from(vec![
            Span::styled("Scope: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(&scope_summary, width.saturating_sub(12) as usize),
                Style::default().fg(colors.accent),
            ),
        ]));
    }

    lines.push(render_run_meta_line(
        state,
        run,
        &model,
        origin_label,
        width,
        colors,
    ));

    if !prompt_history.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Recent: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(
                    &prompt_history.join("  |  "),
                    width.saturating_sub(12) as usize,
                ),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    lines.push(Line::from(vec![
        Span::styled("Workspace: ", Style::default().fg(colors.muted)),
        Span::styled(
            model.workspace_state.as_str(),
            Style::default().fg(workspace_state_color(&model.workspace_state)),
        ),
        Span::raw("  "),
        Span::styled(
            shorten_path(&model.workspace_path, width.saturating_sub(24) as usize),
            Style::default().fg(colors.text),
        ),
    ]));

    if let Some(event) = &run.last_event_name {
        let tool = run
            .last_tool_name
            .clone()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "-".to_string());
        lines.push(Line::from(vec![
            Span::styled("Last: ", Style::default().fg(colors.muted)),
            Span::styled(event.clone(), Style::default().fg(colors.accent)),
            Span::raw("  "),
            Span::styled("Tool: ", Style::default().fg(colors.muted)),
            Span::styled(tool, Style::default().fg(colors.text)),
        ]));
    }

    if !model.changed_files.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Files: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(
                    &model.changed_files.join(", "),
                    width.saturating_sub(12) as usize,
                ),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    if !model.journey_files.is_empty()
        && (model.changed_files.is_empty() || model.journey_files != model.changed_files)
    {
        lines.push(Line::from(vec![
            Span::styled("Touched: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(
                    &model.journey_files.join(", "),
                    width.saturating_sub(14) as usize,
                ),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    if let Some(session) = state.sessions.get(&run.session_id) {
        if !session.recent_git_activity.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("Commits: ", Style::default().fg(colors.muted)),
                Span::styled(
                    shorten_path(
                        &session.recent_git_activity.join("  |  "),
                        width.saturating_sub(14) as usize,
                    ),
                    Style::default().fg(colors.text),
                ),
            ]));
        }
    }

    if let Some(integrity_warning) = &model.integrity_warning {
        lines.push(Line::from(vec![
            Span::styled("Integrity: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(integrity_warning, width.saturating_sub(16) as usize),
                Style::default().fg(INFERRED),
            ),
        ]));
    }

    if !model.recovery_hints.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Recovery: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(
                    &model.recovery_hints.join("  |  "),
                    width.saturating_sub(15) as usize,
                ),
                Style::default().fg(INFERRED),
            ),
        ]));
    }

    lines
}

fn prompt_trail_for_run(
    run: &crate::ui::state::SessionListItem,
    prompt_history: &[String],
) -> Option<String> {
    let current = normalize_prompt_preview(run.primary_label());
    if current.is_empty() {
        return None;
    }

    let mut prompts = prompt_history
        .iter()
        .rev()
        .map(|prompt| normalize_prompt_preview(prompt))
        .filter(|prompt| !prompt.is_empty())
        .collect::<Vec<_>>();
    prompts.push(current);
    prompts.dedup();

    (prompts.len() > 1).then(|| prompts.join("  ->  "))
}

fn activity_trace_for_run(
    state: &RuntimeState,
    run: &crate::ui::state::SessionListItem,
    model: &RunOperatorModel,
) -> Option<String> {
    let mut segments = Vec::new();

    if let Some(event) = &run.last_event_name {
        let tool = run
            .last_tool_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("-");
        segments.push(format!("{event}/{tool}"));
    }

    if !model.changed_files.is_empty() {
        segments.push(format!("dirty {}", model.changed_files.join(", ")));
    } else if !model.journey_files.is_empty() {
        segments.push(format!("touched {}", model.journey_files.join(", ")));
    }

    if let Some(commit) = state
        .sessions
        .get(&run.session_id)
        .and_then(|session| session.recent_git_activity.first())
    {
        segments.push(commit.clone());
    }

    (!segments.is_empty()).then(|| segments.join("  ->  "))
}

fn feature_trace_material_for_run(
    state: &RuntimeState,
    run: &crate::ui::state::SessionListItem,
    model: &RunOperatorModel,
) -> Option<SessionTraceMaterial> {
    if run.is_all_runs_bucket || run.is_unknown_bucket || run.is_synthetic_agent_run {
        return None;
    }

    let mut changed_files = BTreeSet::new();
    if let Some(session) = state.sessions.get(&run.session_id) {
        changed_files.extend(session.touched_files.iter().cloned());
    }
    changed_files.extend(model.changed_files.iter().cloned());
    changed_files.extend(model.journey_files.iter().cloned());

    if changed_files.is_empty() {
        return None;
    }

    Some(SessionTraceMaterial::new(
        run.session_id.clone(),
        changed_files.into_iter().collect(),
        run.last_tool_name.clone().into_iter().collect(),
    ))
}

fn feature_trace_summary_for_run(
    state: &RuntimeState,
    cache: &mut AppCache,
    run: &crate::ui::state::SessionListItem,
    model: &RunOperatorModel,
) -> Option<String> {
    let material = feature_trace_material_for_run(state, run, model)?;
    let analysis = cache.session_feature_trace(material)?;
    let routes = summarize_routes(analysis, 2);
    let features = summarize_features(analysis, 2);

    match (features.is_empty(), routes.is_empty()) {
        (false, false) => Some(format!("{} @ {}", features.join(" | "), routes.join(" | "))),
        (false, true) => Some(features.join(" | ")),
        (true, false) => Some(routes.join(" | ")),
        (true, true) => None,
    }
}

fn recovered_history_label(
    state: &RuntimeState,
    run: &crate::ui::state::SessionListItem,
) -> &'static str {
    match state
        .sessions
        .get(&run.session_id)
        .and_then(|session| session.source.as_deref())
    {
        Some("auggie-session") => "session",
        _ => "transcript",
    }
}

fn render_run_meta_line(
    state: &RuntimeState,
    run: &crate::ui::state::SessionListItem,
    model: &RunOperatorModel,
    origin_label: &str,
    width: u16,
    colors: UiPalette,
) -> Line<'static> {
    let mut spans = vec![
        Span::styled(run.client.clone(), Style::default().fg(colors.accent)),
        Span::raw("  "),
        Span::styled(model.role.as_str(), Style::default().fg(colors.text)),
        Span::raw("  "),
        Span::styled(origin_label.to_string(), Style::default().fg(colors.accent)),
    ];

    if let Some(model_name) = &run.model {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(
            shorten_path(model_name, width.saturating_sub(24) as usize),
            Style::default().fg(colors.text),
        ));
    }

    if run.recovered_from_transcript {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(
            recovered_history_label(state, run),
            Style::default().fg(INFERRED),
        ));
    }

    spans.insert(
        0,
        Span::styled("Context: ", Style::default().fg(colors.muted)),
    );
    Line::from(spans)
}

fn render_run_decision_line(
    run: &crate::ui::state::SessionListItem,
    model: &RunOperatorModel,
    colors: UiPalette,
) -> Line<'static> {
    let semantic_status = semantic_run_status(run, model);
    let mut spans = vec![
        Span::styled("State: ", Style::default().fg(colors.muted)),
        Span::styled(
            display_run_status_label(semantic_status),
            Style::default().fg(run_status_color(semantic_status)),
        ),
    ];

    if let Some(eval_summary) = &model.eval_summary {
        spans.push(Span::raw("  "));
        spans.push(Span::styled("Eval: ", Style::default().fg(colors.muted)));
        spans.push(Span::styled(
            eval_summary.clone(),
            Style::default().fg(eval_summary_color(eval_summary)),
        ));
    }

    spans.push(Span::raw("  "));
    spans.push(Span::styled(
        "Approval: ",
        Style::default().fg(colors.muted),
    ));
    spans.push(Span::styled(
        model.approval_label.clone(),
        Style::default().fg(approval_label_color(&model.approval_label)),
    ));

    Line::from(spans)
}

fn approval_label_color(label: &str) -> Color {
    match label {
        "not_required" => ACTIVE,
        "waiting_on_evidence" => INFERRED,
        "required" | "blocked" => STOPPED,
        _ => IDLE,
    }
}

fn eval_summary_color(summary: &str) -> Color {
    if summary.contains("blocked") {
        STOPPED
    } else if summary.contains("pass") {
        ACTIVE
    } else {
        IDLE
    }
}

fn evidence_summary_color(evidence: &[EvidenceRequirementStatus]) -> Color {
    if evidence
        .iter()
        .any(|item| item.requirement.required && !item.satisfied)
    {
        INFERRED
    } else {
        ACTIVE
    }
}

fn policy_decision_color(decision: &crate::run::policy::PolicyDecisionKind) -> Color {
    match decision {
        crate::run::policy::PolicyDecisionKind::Allow => ACTIVE,
        crate::run::policy::PolicyDecisionKind::AllowWithEvidence
        | crate::run::policy::PolicyDecisionKind::DryRunOnly => INFERRED,
        crate::run::policy::PolicyDecisionKind::RequireApproval
        | crate::run::policy::PolicyDecisionKind::Deny => STOPPED,
    }
}

fn workspace_state_color(state: &WorkspaceState) -> Color {
    match state {
        WorkspaceState::Ready | WorkspaceState::Validated => ACTIVE,
        WorkspaceState::Dirty | WorkspaceState::Archived => INFERRED,
        WorkspaceState::Provisioning => IDLE,
        WorkspaceState::Corrupted => STOPPED,
    }
}

fn recent_prompt_history_for_run(
    state: &RuntimeState,
    cache: &mut AppCache,
    run: &crate::ui::state::SessionListItem,
    limit: usize,
) -> Vec<String> {
    if limit == 0 || run.is_all_runs_bucket || run.is_unknown_bucket || run.is_synthetic_agent_run {
        return Vec::new();
    }

    let mut prompts = state
        .sessions
        .get(&run.session_id)
        .and_then(|session| session.transcript_path.as_deref())
        .map(|transcript_path| cache.transcript_prompt_history(transcript_path, limit + 1))
        .unwrap_or_default();

    if prompts.is_empty() {
        let mut task_prompts = state
            .tasks
            .values()
            .filter(|task| task.session_id == run.session_id)
            .filter_map(|task| {
                task.prompt_preview
                    .clone()
                    .or_else(|| Some(task.title.clone()))
                    .filter(|prompt| !prompt.trim().is_empty())
                    .map(|prompt| (task.updated_at_ms, prompt))
            })
            .collect::<Vec<_>>();
        task_prompts.sort_by(|a, b| b.0.cmp(&a.0));
        prompts = task_prompts
            .into_iter()
            .map(|(_, prompt)| prompt)
            .collect::<Vec<_>>();
    }

    let current_prompt = normalize_prompt_preview(run.primary_label());
    let mut deduped = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for prompt in prompts {
        let normalized = normalize_prompt_preview(&prompt);
        if normalized.is_empty() || normalized == current_prompt || !seen.insert(normalized) {
            continue;
        }
        deduped.push(prompt);
        if deduped.len() >= limit {
            break;
        }
    }
    deduped
}

fn normalize_prompt_preview(prompt: &str) -> String {
    prompt.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn render_process_scan_run_details(
    state: &RuntimeState,
    run: &crate::ui::state::SessionListItem,
    model: &RunOperatorModel,
    width: u16,
    colors: UiPalette,
) -> Vec<Line<'static>> {
    let semantic_status = semantic_run_status(run, model);
    let workspace_path = shorten_path(&model.workspace_path, width.saturating_sub(18) as usize);
    let process_cwd = model
        .process_cwd
        .as_deref()
        .map(|path| shorten_path(path, width.saturating_sub(20) as usize))
        .unwrap_or_else(|| "-".to_string());
    let run_type = if model.origin == RunOrigin::McpService {
        "MCP service"
    } else {
        "process-scan agent"
    };
    let guard_text = model
        .integrity_warning
        .clone()
        .unwrap_or_else(|| "no hook-backed session".to_string());

    let mut lines = vec![
        Line::from(Span::styled(
            shorten_path(&run.display_name, width.saturating_sub(4) as usize),
            Style::default()
                .fg(colors.text)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(vec![
            Span::styled(run_type, Style::default().fg(colors.accent)),
            Span::raw("  "),
            Span::styled(model.role.as_str(), Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled(
                display_run_origin_label(model.origin),
                Style::default().fg(colors.muted),
            ),
        ]),
        Line::from(vec![
            Span::styled("Workspace: ", Style::default().fg(colors.muted)),
            Span::styled(workspace_path, Style::default().fg(colors.text)),
        ]),
        Line::from(vec![
            Span::styled("Process CWD: ", Style::default().fg(colors.muted)),
            Span::styled(process_cwd, Style::default().fg(colors.text)),
        ]),
        Line::from(vec![
            Span::styled("State: ", Style::default().fg(colors.muted)),
            Span::styled(
                display_run_status_label(semantic_status),
                Style::default().fg(run_status_color(semantic_status)),
            ),
        ]),
    ];

    if let Some(agent) = run
        .attached_agent_key
        .as_ref()
        .and_then(|key| state.detected_agents.iter().find(|agent| &agent.key == key))
    {
        lines.push(Line::from(vec![
            Span::styled("PID: ", Style::default().fg(colors.muted)),
            Span::styled(agent.pid.to_string(), Style::default().fg(colors.text)),
            Span::raw("  "),
            Span::styled("CPU: ", Style::default().fg(colors.muted)),
            Span::styled(
                format!("{:.1}%", agent.cpu_percent),
                Style::default().fg(colors.text),
            ),
            Span::raw("  "),
            Span::styled("Mem: ", Style::default().fg(colors.muted)),
            Span::styled(
                format!("{:.0}MB", agent.mem_mb),
                Style::default().fg(colors.text),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Cmd: ", Style::default().fg(colors.muted)),
            Span::styled(
                shorten_path(&agent.command, width.saturating_sub(10) as usize),
                Style::default().fg(colors.text),
            ),
        ]));
    }

    lines.push(Line::from(vec![
        Span::styled("Context: ", Style::default().fg(colors.muted)),
        Span::styled(
            shorten_path(&guard_text, width.saturating_sub(12) as usize),
            Style::default().fg(INFERRED),
        ),
    ]));

    lines
}

pub(super) fn semantic_run_status(
    run: &crate::ui::state::SessionListItem,
    model: &RunOperatorModel,
) -> &'static str {
    if run.is_all_runs_bucket {
        return "all";
    }
    if run.is_unknown_bucket {
        return "attention";
    }
    if run.recovered_from_transcript {
        return "recovered";
    }

    match model.operator_state.as_str() {
        "executing" => "active",
        "evaluating" | "ready" => "idle",
        "observing" => "observing",
        "attention" => "attention",
        "awaiting_approval" => "pending",
        "failed" => "blocked",
        "service" => "service",
        "replayed" => "recovered",
        _ => match run.status.to_ascii_lowercase().as_str() {
            "active" => "active",
            "idle" | "stopped" | "ended" => "idle",
            "unknown" => "attention",
            _ => "idle",
        },
    }
}

pub(super) fn run_status_color(status: &str) -> Color {
    match status {
        "active" | "executing" | "succeeded" => ACTIVE,
        "blocked" | "failed" => STOPPED,
        "recovered" | "attention" | "pending" | "unknown" | "unassigned" => INFERRED,
        "observing" | "idle" | "service" | "stopped" | "ended" => IDLE,
        _ => IDLE,
    }
}

pub(super) fn display_run_status_label(status: &str) -> String {
    match status {
        "active" | "executing" => "active".to_string(),
        "idle" | "evaluating" | "ready" => "idle".to_string(),
        "failed" | "blocked" => "blocked".to_string(),
        "attention" => "attention".to_string(),
        "observing" => "observing".to_string(),
        "recovered" => "recovered".to_string(),
        "unknown" => "unassigned".to_string(),
        "unassigned" => "unassigned".to_string(),
        "awaiting_approval" | "pending" => "pending".to_string(),
        "service" => "service".to_string(),
        _ => status.to_string(),
    }
}

pub(super) fn display_run_origin_label(origin: RunOrigin) -> &'static str {
    match origin {
        RunOrigin::HookBacked => "hook",
        RunOrigin::ProcessScan => "scan",
        RunOrigin::AttributionReview => "file-review",
        RunOrigin::McpService => "shared-service",
    }
}

pub(super) fn build_run_operator_model(
    state: &RuntimeState,
    cache: &AppCache,
    run: &crate::ui::state::SessionListItem,
) -> RunOperatorModel {
    let changed_files = changed_files_for_run(state, run);
    let journey_files = journey_files_for_run(state, run);
    let workspace_path = workspace_path_for_run(state, run);
    let process_cwd = process_cwd_for_run(state, run);
    let fitness_snapshot = fitness_snapshot_for_run(cache, run, &changed_files, &journey_files);
    let assessment = assess_run(&RunAssessmentInput {
        run_id: &run.session_id,
        display_name: &run.display_name,
        client: &run.client,
        status: &run.status,
        last_event_name: run.last_event_name.as_deref(),
        last_tool_name: run.last_tool_name.as_deref(),
        changed_files: &changed_files,
        touched_files_count: run.touched_files_count,
        exact_files_count: run.exact_count,
        inferred_files_count: run.inferred_count,
        unknown_files_count: run.unknown_count,
        is_unknown_bucket: run.is_unknown_bucket,
        is_synthetic_run: run.is_synthetic_agent_run,
        is_service_run: is_auggie_mcp_service_run(state, run),
        workspace_path: &workspace_path,
        workspace_branch: None,
        workspace_type: WorkspaceType::Main,
        workspace_detached: false,
        workspace_missing: std::path::Path::new(&state.repo_root).exists()
            && !std::path::Path::new(&workspace_path).exists(),
        has_eval: fitness_snapshot.is_some(),
        hard_gate_blocked: fitness_snapshot.is_some_and(|snapshot| snapshot.hard_gate_blocked),
        score_blocked: fitness_snapshot.is_some_and(|snapshot| snapshot.score_blocked),
        has_coverage: fitness_snapshot
            .is_some_and(|snapshot| snapshot.coverage_summary.has_any_sampled_source()),
        api_contract_passed: fitness_snapshot.is_some_and(api_contract_dimension_passed),
    });

    RunOperatorModel {
        role: assessment.role,
        mode: assessment.mode,
        origin: assessment.origin,
        operator_state: assessment.operator_state,
        workspace_path,
        process_cwd,
        workspace_state: assessment.workspace_state,
        effect_classes: assessment.effect_classes,
        policy_decision: assessment.policy_decision,
        approval_label: assessment.approval_label,
        block_reason: assessment.block_reason,
        eval_summary: if is_auggie_mcp_service_run(state, run) {
            Some("workspace-shared".to_string())
        } else {
            fitness_snapshot.map(summarize_eval_snapshot)
        },
        evidence: assessment.evidence,
        integrity_warning: assessment.integrity_warning,
        next_action: assessment.next_action,
        handoff_summary: assessment.handoff_summary,
        recovery_hints: assessment.recovery_hints,
        changed_files,
        journey_files,
        planes: assessment.planes,
    }
}

fn changed_files_for_run(
    state: &RuntimeState,
    run: &crate::ui::state::SessionListItem,
) -> Vec<String> {
    let mut files: Vec<&FileView> = state
        .files
        .values()
        .filter(|file| file.dirty || file.conflicted)
        .filter(|file| file_matches_run(file, run))
        .collect();
    files.sort_by(|a, b| {
        b.last_modified_at_ms
            .cmp(&a.last_modified_at_ms)
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    files
        .into_iter()
        .take(3)
        .map(|file| file.rel_path.clone())
        .collect()
}

fn journey_files_for_run(
    state: &RuntimeState,
    run: &crate::ui::state::SessionListItem,
) -> Vec<String> {
    if run.is_all_runs_bucket || run.is_unknown_bucket || run.is_synthetic_agent_run {
        return Vec::new();
    }
    let Some(session) = state.sessions.get(&run.session_id) else {
        return Vec::new();
    };

    let mut files: Vec<_> = if let Some(task_id) = run.task_id.as_deref() {
        let mut task_files: Vec<_> = state
            .files
            .values()
            .filter(|file| file.last_task_id.as_deref() == Some(task_id))
            .map(|file| file.rel_path.clone())
            .collect();
        task_files.sort();
        task_files.dedup();
        if task_files.is_empty() {
            session.touched_files.iter().cloned().collect()
        } else {
            task_files
        }
    } else {
        session.touched_files.iter().cloned().collect()
    };
    files.sort();
    files.truncate(3);
    files
}

fn file_matches_run(file: &FileView, run: &crate::ui::state::SessionListItem) -> bool {
    if run.is_all_runs_bucket {
        return file.dirty || file.conflicted;
    }
    if run.is_unknown_bucket {
        return file.conflicted
            || matches!(file.confidence, AttributionConfidence::Unknown)
            || file.last_session_id.is_none()
            || file.touched_by.is_empty();
    }
    if run.is_synthetic_agent_run {
        return false;
    }
    if let Some(task_id) = run.task_id.as_deref() {
        if file.last_task_id.as_deref() == Some(task_id) {
            return true;
        }
        if file.last_task_id.is_some() {
            return false;
        }
    }
    file.last_session_id.as_deref() == Some(run.session_id.as_str())
        || file.touched_by.contains(&run.session_id)
}

fn workspace_path_for_run(state: &RuntimeState, run: &crate::ui::state::SessionListItem) -> String {
    let _ = run;
    state
        .selected_workspace_path()
        .unwrap_or_else(|| state.repo_root.clone())
}

fn process_cwd_for_run(
    state: &RuntimeState,
    run: &crate::ui::state::SessionListItem,
) -> Option<String> {
    if run.is_all_runs_bucket {
        return Some(state.repo_root.clone());
    }
    if let Some(agent) = run
        .attached_agent_key
        .as_ref()
        .and_then(|key| state.detected_agents.iter().find(|agent| &agent.key == key))
    {
        return agent.cwd.clone();
    }
    state
        .sessions
        .get(&run.session_id)
        .map(|session| session.cwd.clone())
}

fn is_auggie_mcp_service_run(
    state: &RuntimeState,
    run: &crate::ui::state::SessionListItem,
) -> bool {
    run.attached_agent_key
        .as_ref()
        .and_then(|key| state.detected_agents.iter().find(|agent| &agent.key == key))
        .is_some_and(|agent| {
            agent.name.eq_ignore_ascii_case("auggie")
                && agent.command.to_ascii_lowercase().contains("--mcp")
        })
}

fn api_contract_dimension_passed(snapshot: &fitness::FitnessSnapshot) -> bool {
    snapshot
        .dimensions
        .iter()
        .find(|dim| dim.name.eq_ignore_ascii_case("api_contract"))
        .is_some_and(|dim| dim.hard_gate_failures.is_empty())
}

fn summarize_eval_snapshot(snapshot: &fitness::FitnessSnapshot) -> String {
    let status = if snapshot.hard_gate_blocked {
        "blocked(hard)"
    } else if snapshot.score_blocked {
        "blocked(score)"
    } else {
        "pass"
    };
    format!(
        "{} {} {:.1}%",
        snapshot.mode.as_str(),
        status,
        snapshot.final_score
    )
}

fn fitness_snapshot_for_run<'a>(
    cache: &'a AppCache,
    run: &crate::ui::state::SessionListItem,
    changed_files: &[String],
    journey_files: &[String],
) -> Option<&'a fitness::FitnessSnapshot> {
    if run_uses_fitness_snapshot(run, changed_files, journey_files) {
        cache.fitness_snapshot()
    } else {
        None
    }
}

fn run_uses_fitness_snapshot(
    run: &crate::ui::state::SessionListItem,
    changed_files: &[String],
    journey_files: &[String],
) -> bool {
    if run.is_synthetic_agent_run {
        return false;
    }
    if run.is_unknown_bucket {
        return !changed_files.is_empty() || run.unknown_count > 0;
    }
    if run.is_all_runs_bucket {
        return !changed_files.is_empty() || run.touched_files_count > 0 || run.unknown_count > 0;
    }
    !changed_files.is_empty()
        || !journey_files.is_empty()
        || run.touched_files_count > 0
        || run.unknown_count > 0
}
