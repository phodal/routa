use chrono::Utc;
use regex::Regex;
use serde_yaml::Value;
use std::sync::LazyLock;

use crate::models::task::{InvestValidation, InvestValidationPrinciple, InvestValidationStatus};

static YAML_BLOCK_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)```yaml\s*\n([\s\S]*?)\n```").unwrap());

const SECTION_NAMES: &[&str] = &[
    "Summary",
    "Objective",
    "Description",
    "Problem Statement",
    "User Value",
    "Acceptance Criteria",
    "Acceptance",
    "Definition of Done",
    "Dependencies",
    "Dependency Plan",
    "Prerequisites",
    "Scope",
    "Constraints",
];

#[derive(Debug, Default)]
struct ObjectiveSignals {
    summary: String,
    problem_statement: String,
    user_value: String,
    acceptance_criteria: Vec<String>,
    dependency_notes: Vec<String>,
    scope_notes: Vec<String>,
    word_count: usize,
    has_canonical_yaml: bool,
}

pub fn derive_invest_validation_from_objective(
    objective: impl AsRef<str>,
) -> Option<InvestValidation> {
    let objective = objective.as_ref();
    if let Some(explicit) = derive_explicit_invest_validation(objective) {
        return Some(explicit);
    }
    build_heuristic_validation(objective)
}

pub fn resolve_invest_validation(
    objective: Option<&str>,
    provided: Option<InvestValidation>,
    keep_existing: Option<&InvestValidation>,
) -> Option<InvestValidation> {
    if let Some(validation) = provided {
        return Some(validation);
    }
    if let Some(value) = objective.and_then(derive_invest_validation_from_objective) {
        return Some(value);
    }
    if objective.is_none() {
        return keep_existing.cloned();
    }
    None
}

fn derive_explicit_invest_validation(objective: &str) -> Option<InvestValidation> {
    let root = load_story_root(objective)?;
    let invest = root.get("invest")?.as_mapping()?;
    let validation = ExplicitValidation {
        independent: read_explicit_principle(invest, "independent")?,
        negotiable: read_explicit_principle(invest, "negotiable")?,
        valuable: read_explicit_principle(invest, "valuable")?,
        estimable: read_explicit_principle(invest, "estimable")?,
        small: read_explicit_principle(invest, "small")?,
        testable: read_explicit_principle(invest, "testable")?,
    };
    Some(build_validation(
        validation.independent,
        validation.negotiable,
        validation.valuable,
        validation.estimable,
        validation.small,
        validation.testable,
    ))
}

fn build_heuristic_validation(objective: &str) -> Option<InvestValidation> {
    let signals = extract_objective_signals(objective);
    if signals.summary.is_empty()
        && signals.problem_statement.is_empty()
        && signals.acceptance_criteria.is_empty()
    {
        return None;
    }

    Some(build_validation(
        evaluate_independent(&signals),
        evaluate_negotiable(&signals),
        evaluate_valuable(&signals),
        evaluate_estimable(&signals),
        evaluate_small(&signals),
        evaluate_testable(&signals),
    ))
}

fn build_validation(
    independent: InvestValidationPrinciple,
    negotiable: InvestValidationPrinciple,
    valuable: InvestValidationPrinciple,
    estimable: InvestValidationPrinciple,
    small: InvestValidationPrinciple,
    testable: InvestValidationPrinciple,
) -> InvestValidation {
    let statuses = [
        &independent.status,
        &negotiable.status,
        &valuable.status,
        &estimable.status,
        &small.status,
        &testable.status,
    ];
    let overall = if statuses
        .iter()
        .any(|status| **status == InvestValidationStatus::Fail)
    {
        InvestValidationStatus::Fail
    } else if statuses
        .iter()
        .any(|status| **status == InvestValidationStatus::Warning)
    {
        InvestValidationStatus::Warning
    } else {
        InvestValidationStatus::Pass
    };

    let issues = [
        ("Independent", &independent),
        ("Negotiable", &negotiable),
        ("Valuable", &valuable),
        ("Estimable", &estimable),
        ("Small", &small),
        ("Testable", &testable),
    ]
    .into_iter()
    .filter(|(_, principle)| principle.status != InvestValidationStatus::Pass)
    .map(|(label, principle)| format!("{label}: {}", principle.reason))
    .collect::<Vec<_>>();

    InvestValidation {
        independent,
        negotiable,
        valuable,
        estimable,
        small,
        testable,
        overall,
        validated_at: Utc::now().to_rfc3339(),
        issues,
    }
}

fn evaluate_independent(signals: &ObjectiveSignals) -> InvestValidationPrinciple {
    let text = signals.dependency_notes.join(" ");
    if contains_any(
        &text,
        &[
            "blocked by",
            "depends on",
            "waiting for",
            "after ",
            "prerequisite",
        ],
    ) && !contains_any(
        &text,
        &[
            "no dependencies",
            "none",
            "n/a",
            "independent",
            "can start now",
            "not blocked",
        ],
    ) {
        return principle(
            InvestValidationStatus::Fail,
            "Blocking or prerequisite work is still declared.",
        );
    }
    if signals.dependency_notes.iter().any(|note| {
        contains_any(
            note,
            &[
                "no dependencies",
                "none",
                "n/a",
                "independent",
                "can start now",
                "not blocked",
            ],
        )
    }) || (signals.has_canonical_yaml && signals.dependency_notes.is_empty())
    {
        return principle(
            InvestValidationStatus::Pass,
            "No blocking dependencies are declared.",
        );
    }
    principle(
        InvestValidationStatus::Warning,
        "No explicit dependency plan proves the story is independent.",
    )
}

fn evaluate_negotiable(_signals: &ObjectiveSignals) -> InvestValidationPrinciple {
    principle(
        InvestValidationStatus::Warning,
        "Story is actionable, but negotiability still depends on team discussion.",
    )
}

fn evaluate_valuable(signals: &ObjectiveSignals) -> InvestValidationPrinciple {
    if !signals.problem_statement.is_empty() && !signals.user_value.is_empty() {
        return principle(
            InvestValidationStatus::Pass,
            "Problem statement and user value are both explicit.",
        );
    }
    if !signals.summary.is_empty() && !signals.acceptance_criteria.is_empty() {
        return principle(
            InvestValidationStatus::Warning,
            "Outcome is described, but the user or business value remains implicit.",
        );
    }
    principle(
        InvestValidationStatus::Fail,
        "Story does not clearly explain why this work matters.",
    )
}

fn evaluate_estimable(signals: &ObjectiveSignals) -> InvestValidationPrinciple {
    if signals.acceptance_criteria.len() >= 2
        && (!signals.scope_notes.is_empty() || signals.word_count <= 260)
    {
        return principle(
            InvestValidationStatus::Pass,
            "Acceptance criteria and scope are concrete enough to estimate.",
        );
    }
    if !signals.acceptance_criteria.is_empty() || signals.summary.len() >= 40 {
        return principle(
            InvestValidationStatus::Warning,
            "There is enough context to start discussion, but estimation is still fuzzy.",
        );
    }
    principle(
        InvestValidationStatus::Fail,
        "Story lacks enough detail to estimate effort confidently.",
    )
}

fn evaluate_small(signals: &ObjectiveSignals) -> InvestValidationPrinciple {
    let broad_scope_text = format!(
        "{} {} {}",
        signals.summary,
        signals.problem_statement,
        signals.scope_notes.join(" ")
    )
    .to_lowercase();
    let broad_scope = contains_any(
        &broad_scope_text,
        &[
            "end-to-end",
            "across the stack",
            "multiple systems",
            "large refactor",
            "platform-wide",
        ],
    );

    if signals.word_count > 450 || signals.acceptance_criteria.len() > 6 {
        return principle(
            InvestValidationStatus::Fail,
            "Story appears too large for a single focused iteration.",
        );
    }
    if signals.word_count > 240 || signals.acceptance_criteria.len() > 4 || broad_scope {
        return principle(
            InvestValidationStatus::Warning,
            "Scope may still need trimming before implementation.",
        );
    }
    principle(
        InvestValidationStatus::Pass,
        "Scope looks focused enough for a single iteration.",
    )
}

fn evaluate_testable(signals: &ObjectiveSignals) -> InvestValidationPrinciple {
    if signals.acceptance_criteria.is_empty() {
        return principle(
            InvestValidationStatus::Fail,
            "No explicit acceptance criteria or verification checks were provided.",
        );
    }
    if signals.acceptance_criteria.iter().any(|criterion| {
        contains_any(
            &criterion.to_lowercase(),
            &[
                "works correctly",
                "works well",
                "appropriate",
                "properly",
                "intuitive",
                "user-friendly",
                "robust",
                "as expected",
                "etc.",
            ],
        )
    }) {
        return principle(
            InvestValidationStatus::Warning,
            "Some acceptance criteria use vague wording that is hard to verify objectively.",
        );
    }
    principle(
        InvestValidationStatus::Pass,
        "Acceptance criteria are concrete enough to verify objectively.",
    )
}

fn extract_objective_signals(objective: &str) -> ObjectiveSignals {
    let root = load_story_root(objective);
    let story_dependencies = root
        .as_ref()
        .and_then(|story| story.get("dependencies_and_sequencing"))
        .and_then(Value::as_mapping);
    let dependencies = story_dependencies
        .and_then(|mapping| mapping.get(Value::String("depends_on".to_string())))
        .map(read_yaml_strings)
        .unwrap_or_default();
    let unblock = story_dependencies
        .and_then(|mapping| mapping.get(Value::String("unblock_condition".to_string())))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    ObjectiveSignals {
        summary: root
            .as_ref()
            .and_then(|story| story.get("title"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string()
            .or_else_if_empty(|| {
                extract_section(objective, &["Summary", "Objective", "Description"])
            })
            .or_else_if_empty(|| leading_paragraph(objective)),
        problem_statement: root
            .as_ref()
            .and_then(|story| story.get("problem_statement"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string()
            .or_else_if_empty(|| extract_section(objective, &["Problem Statement"])),
        user_value: root
            .as_ref()
            .and_then(|story| story.get("user_value"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string()
            .or_else_if_empty(|| extract_section(objective, &["User Value"])),
        acceptance_criteria: {
            let mut values = root
                .as_ref()
                .and_then(|story| story.get("acceptance_criteria"))
                .map(read_yaml_strings)
                .unwrap_or_default();
            values.extend(extract_bullets(&extract_section(
                objective,
                &["Acceptance Criteria", "Acceptance", "Definition of Done"],
            )));
            values
        },
        dependency_notes: {
            let mut values = dependencies;
            if let Some(value) = unblock {
                values.push(value);
            }
            values.extend(extract_bullets(&extract_section(
                objective,
                &["Dependencies", "Dependency Plan", "Prerequisites"],
            )));
            values
        },
        scope_notes: {
            let mut values = root
                .as_ref()
                .and_then(|story| story.get("constraints_and_affected_areas"))
                .map(read_yaml_strings)
                .unwrap_or_default();
            values.extend(extract_bullets(&extract_section(
                objective,
                &["Scope", "Constraints"],
            )));
            values
        },
        word_count: objective.split_whitespace().count(),
        has_canonical_yaml: root.is_some(),
    }
}

fn load_story_root(objective: &str) -> Option<Value> {
    let raw_yaml = extract_canonical_story_yaml(objective)?;
    let parsed: Value = serde_yaml::from_str(raw_yaml).ok()?;
    parsed.get("story").cloned()
}

fn extract_canonical_story_yaml(content: &str) -> Option<&str> {
    YAML_BLOCK_REGEX
        .captures(content)
        .and_then(|captures| captures.get(1).map(|m| m.as_str().trim()))
}

fn extract_section(content: &str, names: &[&str]) -> String {
    let target_names = names
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<Vec<_>>();
    let all_names = SECTION_NAMES
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<Vec<_>>();

    let mut capturing = false;
    let mut lines = Vec::new();
    for line in content.lines() {
        if let Some(heading) = normalized_heading(line) {
            if capturing {
                if all_names.iter().any(|name| name == &heading) {
                    break;
                }
            }
            if target_names.iter().any(|name| name == &heading) {
                capturing = true;
                continue;
            }
        }
        if capturing {
            lines.push(line);
        }
    }

    lines.join("\n").trim().to_string()
}

fn extract_bullets(content: &str) -> Vec<String> {
    content
        .lines()
        .map(str::trim)
        .filter_map(|line| {
            if let Some(value) = line.strip_prefix("- ") {
                Some(value.trim().to_string())
            } else if let Some(value) = line.strip_prefix("* ") {
                Some(value.trim().to_string())
            } else {
                let digits = line
                    .chars()
                    .take_while(|ch| ch.is_ascii_digit())
                    .collect::<String>();
                line.strip_prefix(&format!("{digits}. "))
                    .map(|value| value.trim().to_string())
            }
        })
        .filter(|value| !value.is_empty())
        .collect()
}

fn leading_paragraph(content: &str) -> String {
    YAML_BLOCK_REGEX
        .replace(content, "")
        .split("\n#")
        .next()
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn normalized_heading(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_hashes = trimmed.trim_start_matches('#').trim();
    let without_bold = without_hashes
        .trim_start_matches("**")
        .trim_end_matches("**")
        .trim_end_matches(':')
        .trim();
    let normalized = without_bold.to_ascii_lowercase();
    if SECTION_NAMES
        .iter()
        .any(|name| normalized == name.to_ascii_lowercase())
    {
        Some(normalized)
    } else {
        None
    }
}

fn read_yaml_strings(value: &Value) -> Vec<String> {
    match value {
        Value::Sequence(items) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(value) => Some(value.trim().to_string()),
                Value::Mapping(mapping) => mapping
                    .get(Value::String("text".to_string()))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .map(str::to_string),
                _ => None,
            })
            .filter(|value| !value.is_empty())
            .collect(),
        Value::String(value) if !value.trim().is_empty() => vec![value.trim().to_string()],
        _ => Vec::new(),
    }
}

fn read_explicit_principle(
    invest: &serde_yaml::Mapping,
    key: &str,
) -> Option<InvestValidationPrinciple> {
    let value = invest.get(Value::String(key.to_string()))?.as_mapping()?;
    let status = match value.get(Value::String("status".to_string()))?.as_str()? {
        "pass" => InvestValidationStatus::Pass,
        "fail" => InvestValidationStatus::Fail,
        "warning" => InvestValidationStatus::Warning,
        _ => return None,
    };
    let reason = value
        .get(Value::String("reason".to_string()))?
        .as_str()?
        .trim()
        .to_string();
    if reason.is_empty() {
        return None;
    }
    Some(InvestValidationPrinciple { status, reason })
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    let haystack = haystack.to_lowercase();
    needles.iter().any(|needle| haystack.contains(needle))
}

fn principle(status: InvestValidationStatus, reason: &str) -> InvestValidationPrinciple {
    InvestValidationPrinciple {
        status,
        reason: reason.to_string(),
    }
}

trait StringExt {
    fn or_else_if_empty(self, fallback: impl FnOnce() -> String) -> String;
}

impl StringExt for String {
    fn or_else_if_empty(self, fallback: impl FnOnce() -> String) -> String {
        if self.trim().is_empty() {
            fallback()
        } else {
            self
        }
    }
}

struct ExplicitValidation {
    independent: InvestValidationPrinciple,
    negotiable: InvestValidationPrinciple,
    valuable: InvestValidationPrinciple,
    estimable: InvestValidationPrinciple,
    small: InvestValidationPrinciple,
    testable: InvestValidationPrinciple,
}

#[cfg(test)]
mod tests {
    use super::{derive_invest_validation_from_objective, resolve_invest_validation};
    use crate::models::task::InvestValidationStatus;

    #[test]
    fn keeps_explicit_yaml_invest_snapshot() {
        let validation = derive_invest_validation_from_objective(
            r#"Story

```yaml
story:
  title: Automatic INVEST
  problem_statement: Teams need visible validation results.
  user_value: Reviewers can inspect story quality quickly.
  acceptance_criteria:
    - id: AC1
      text: Persist validation results.
      testable: true
  constraints_and_affected_areas:
    - src/app/api/tasks/route.ts
  dependencies_and_sequencing:
    independent_story_check: pass
    depends_on: []
    unblock_condition: none
  invest:
    independent:
      status: pass
      reason: No dependency is declared.
    negotiable:
      status: warning
      reason: Details can still be refined.
    valuable:
      status: pass
      reason: Reviewers can see the signal.
    estimable:
      status: pass
      reason: Scope is narrow.
    small:
      status: pass
      reason: Delivery fits within one change set.
    testable:
      status: pass
      reason: API assertions can verify the snapshot.
```
"#,
        )
        .expect("validation");

        assert_eq!(validation.overall, InvestValidationStatus::Warning);
        assert_eq!(
            validation.negotiable.status,
            InvestValidationStatus::Warning
        );
    }

    #[test]
    fn evaluates_plain_markdown_story() {
        let validation = derive_invest_validation_from_objective(
            r#"## Summary
Validate stories automatically when they are created.

## Acceptance Criteria
- A new task gets an INVEST snapshot without requiring canonical YAML.
- Reviewers can see which principles are warnings or failures.

## Dependencies
- None. This can start now.
"#,
        )
        .expect("validation");

        assert_eq!(validation.overall, InvestValidationStatus::Warning);
        assert_eq!(validation.independent.status, InvestValidationStatus::Pass);
        assert_eq!(validation.testable.status, InvestValidationStatus::Pass);
    }

    #[test]
    fn resolves_existing_snapshot_when_objective_is_unchanged() {
        let existing =
            derive_invest_validation_from_objective("## Summary\nKeep the prior result.")
                .expect("existing validation");
        let resolved = resolve_invest_validation(None, None, Some(&existing)).expect("resolved");
        assert_eq!(resolved.overall, existing.overall);
    }
}
