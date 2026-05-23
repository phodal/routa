# Kanban Transition Gates

Routa supports generic transition gates on `KanbanColumnAutomation`. These gates are platform-level lane transition checks, not project-specific release policy.

## Fields

```yaml
automation:
  requiredChecklist:
    - browser smoke
    - release evidence
  requiredHumanApproval: true
  validatorCommand: npm test -- --run smoke
  gateMode: blocking
```

- `requiredChecklist`: requires matching checked markdown items such as `- [x] browser smoke` in task text or evidence.
- `requiredHumanApproval`: requires the task verification verdict to be `APPROVED`.
- `validatorCommand`: declarative evidence gate. Routa does not execute arbitrary shell during transition; it checks that the configured command appears in verification evidence with a passing result such as `passed`, `success`, `ok`, or `green`.
- `gateMode`: `blocking` rejects the transition when gates are unmet. `warning` allows the transition and writes an audit warning to the task comment stream.

## Enforcement Paths

- Next.js task route: `PATCH /api/tasks/:taskId`
- Kanban MCP/native tool: `move_card`
- Rust core Kanban RPC: `move_card`
- Kanban automation prompts: agents are told which transition gates must be satisfied before calling `move_card`.
- Kanban settings UI: lane automation settings can configure checklist, human approval, validator evidence, and blocking/warning mode.

## Boundaries

- Transition gates complement existing artifact, story-readiness, canonical contract, and delivery gates.
- `validatorCommand` is intentionally evidence-based. Executing commands belongs to an agent/session or project-specific validator workflow, not the transition API.
- Project-specific release gates should configure these fields on board columns or layer their own validators; they should not be hard-coded into Routa core.
