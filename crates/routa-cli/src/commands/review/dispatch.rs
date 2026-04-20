use std::collections::HashMap;

use routa_core::state::AppState;
use routa_core::workflow::specialist::{SpecialistDef, SpecialistLoader};

use super::acp_runner::{call_security_specialist_via_acp, resolve_security_provider};
use super::aggregator::{group_candidates_by_category, parse_specialist_output};
use super::output::truncate;
use super::shared::{
    load_specialist_by_id, SecurityCandidate, SecurityCandidateWorkload, SecurityDispatchInput,
    SecurityReviewPayload, SecuritySpecialistDispatch, SecuritySpecialistReport,
    SECURITY_DISPATCH_MAX_SPECIALISTS, SECURITY_DISPATCH_OUTPUT_PREVIEW_CHARS,
};

pub(crate) async fn dispatch_security_specialists(
    state: &AppState,
    specialist_dir: Option<&str>,
    payload: &SecurityReviewPayload,
    verbose: bool,
) -> Result<
    (
        Vec<SecuritySpecialistDispatch>,
        Vec<SecuritySpecialistReport>,
    ),
    String,
> {
    let workloads = select_security_specialist_workloads(specialist_dir, payload, verbose)?;
    if workloads.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }

    let mut plans = Vec::new();
    let mut reports = Vec::new();
    for workload in workloads {
        let specialist = load_specialist_by_id(&workload.specialist_id, specialist_dir)?;
        let provider = resolve_security_provider(&specialist);
        let task = SecurityDispatchInput {
            specialist_id: specialist.id.clone(),
            categories: workload.categories.clone(),
            evidence_pack: payload.evidence_pack.clone(),
            repo_path: payload.repo_path.clone(),
            base: payload.base.clone(),
            head: payload.head.clone(),
            diff: truncate(&payload.diff, 12_000),
            changed_files: payload.changed_files.clone(),
            tool_trace: payload.tool_trace.clone(),
            security_guidance: payload.security_guidance.clone(),
            candidates: workload.candidates.clone(),
        };
        let task_json = serde_json::to_string_pretty(&task).map_err(|err| {
            format!(
                "Failed to serialize dispatch task {}: {}",
                workload.specialist_id, err
            )
        })?;
        let prompt = [
            "You are a scoped security specialist.",
            "Use only the evidence and candidate payload below.",
            "Return strict JSON only.",
            "You must use this schema:",
            r#"{"specialist_id":"string","category":"optional canonical category","findings":[{"title":"string","severity":"CRITICAL|HIGH|MEDIUM|LOW","root_cause":"string","affected_locations":["string"],"attack_path":"string","why_it_matters":"string","guardrails_present":["string"],"recommended_fix":"string","related_variants":["string"],"confidence":"LOW|MEDIUM|HIGH"}],"notes":"optional text"}"#,
            &task_json,
        ]
        .join("\n\n");
        if verbose {
            println!(
                "── Dispatch Specialist: {} ({} candidates) ──",
                specialist.id,
                workload.candidates.len()
            );
        }

        let response = call_security_specialist_via_acp(
            state,
            &specialist,
            &prompt,
            false,
            &provider,
            &payload.repo_root,
        )
        .await?;
        plans.push(SecuritySpecialistDispatch {
            specialist_id: specialist.id.clone(),
            categories: workload.categories.clone(),
            candidate_count: workload.candidates.len(),
            reason: workload.reason.clone(),
        });

        let raw_output = response.trim().to_string();
        let parsed = parse_specialist_output(&raw_output);
        let status = if parsed.is_some() {
            "ok"
        } else {
            "unstructured"
        };
        let findings = parsed
            .as_ref()
            .map_or_else(Vec::new, |parsed| parsed.findings.clone());
        let trace = vec![if parsed.is_some() {
            "parsed JSON output".to_string()
        } else {
            "failed to parse JSON output, returning raw output preview".to_string()
        }
        .to_string()];
        let parse_error = if parsed.is_none() {
            Some("Could not parse specialist JSON; output may still be used by root aggregator as raw_text".to_string())
        } else {
            None
        };

        reports.push(SecuritySpecialistReport {
            specialist_id: specialist.id.clone(),
            status: status.to_string(),
            categories: workload.categories.clone(),
            findings,
            trace,
            parse_error,
            output_preview: truncate(&raw_output, SECURITY_DISPATCH_OUTPUT_PREVIEW_CHARS),
        });
    }

    Ok((plans, reports))
}

pub(crate) fn select_security_specialist_workloads(
    specialist_dir: Option<&str>,
    payload: &SecurityReviewPayload,
    verbose: bool,
) -> Result<Vec<SecurityCandidateWorkload>, String> {
    let specialist_candidates = load_security_candidates_for_dispatch(specialist_dir)?;
    let mut category_map: HashMap<String, SecurityCandidate> = HashMap::new();
    for candidate in payload
        .heuristic_candidates
        .iter()
        .chain(payload.semgrep_candidates.iter())
    {
        let key = format!(
            "{}|{}|{}",
            candidate.rule_id,
            candidate.category,
            candidate.locations.first().cloned().unwrap_or_default()
        );
        category_map.entry(key).or_insert_with(|| candidate.clone());
    }

    let mut candidates_by_category =
        group_candidates_by_category(category_map.into_values().collect());
    if candidates_by_category.is_empty() {
        return Ok(Vec::new());
    }

    candidates_by_category.sort_by_key(|bucket| std::cmp::Reverse(bucket.candidate_count));

    let mut workload_map: HashMap<String, SecurityCandidateWorkload> = HashMap::new();
    for bucket in candidates_by_category {
        if bucket.candidates.is_empty() {
            continue;
        }
        let selected_specialist =
            select_security_specialist_for_category(&specialist_candidates, &bucket.category);
        let Some((specialist_id, reason, max_candidates)) = selected_specialist else {
            if verbose {
                println!(
                    "── Dispatch mapping: no specialist for category `{}` ({} candidates)",
                    bucket.category, bucket.candidate_count
                );
            }
            continue;
        };

        let entry =
            workload_map
                .entry(specialist_id.clone())
                .or_insert(SecurityCandidateWorkload {
                    specialist_id: specialist_id.clone(),
                    categories: Vec::new(),
                    candidates: Vec::new(),
                    max_candidates,
                    reason: reason.clone(),
                });

        entry.categories.push(bucket.category);
        entry.categories.sort();
        entry.categories.dedup();
        entry.candidates.extend(bucket.candidates);
        if entry.max_candidates.is_none() {
            entry.max_candidates = max_candidates;
        } else if let (Some(current), Some(next)) = (entry.max_candidates, max_candidates) {
            entry.max_candidates = Some(current.max(next));
        }
    }

    let mut workloads: Vec<SecurityCandidateWorkload> = workload_map
        .into_values()
        .filter(|workload| !workload.candidates.is_empty())
        .collect();
    for workload in workloads.iter_mut() {
        if let Some(limit) = workload.max_candidates {
            if workload.candidates.len() > limit {
                workload.candidates.truncate(limit);
            }
        }
    }
    workloads.sort_by_key(|workload| std::cmp::Reverse(workload.candidates.len()));

    if workloads.len() > SECURITY_DISPATCH_MAX_SPECIALISTS {
        workloads.truncate(SECURITY_DISPATCH_MAX_SPECIALISTS);
    }

    workloads.sort_by(|left, right| left.specialist_id.cmp(&right.specialist_id));

    Ok(workloads)
}

fn select_security_specialist_for_category(
    specialists: &[SpecialistDef],
    category: &str,
) -> Option<(String, String, Option<usize>)> {
    let normalized_category = category.to_lowercase();
    let direct_id = format!("security-{normalized_category}-reviewer");
    for specialist in specialists {
        if specialist.id == direct_id {
            return Some((
                specialist.id.clone(),
                "direct-id-match".to_string(),
                specialist
                    .capabilities
                    .as_ref()
                    .and_then(|capabilities| capabilities.max_candidates),
            ));
        }
        if let Some(capabilities) = &specialist.capabilities {
            if capabilities
                .categories
                .iter()
                .any(|capability| capability.eq_ignore_ascii_case(&normalized_category))
            {
                return Some((
                    specialist.id.clone(),
                    "capability-match".to_string(),
                    capabilities.max_candidates,
                ));
            }
        }
    }
    None
}

pub(crate) fn load_security_candidates_for_dispatch(
    specialist_dir: Option<&str>,
) -> Result<Vec<SpecialistDef>, String> {
    let mut loader = SpecialistLoader::new();
    if let Some(dir) = specialist_dir {
        loader.load_dir(dir)?;
    } else {
        loader.load_default_dirs();
    }
    let mut specialists = loader.specialists.values().cloned().collect::<Vec<_>>();
    for builtin in SpecialistLoader::builtin_specialists() {
        if !specialists.iter().any(|entry| entry.id == builtin.id) {
            specialists.push(builtin);
        }
    }
    Ok(specialists)
}
