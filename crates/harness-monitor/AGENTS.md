## Four-Layer Model

Harness Monitor is now documented with one primary story:

- `Context`: repo rules and task context decide what the agent should know
- `Run`: `Task / Run / Workspace / Policy` semantics decide what the agent may do
- `Observe`: hooks, process scan, git dirtiness, and attribution decide what the agent actually did
- `Govern`: Entrix, evidence, and readiness checks decide whether the result may move forward

For overview slides, the shorthand is `Observe -> Attribute -> Evaluate + Expand`.

## Package Structure

The current code map follows that model:

```text
Context  templates/, scripts/, AGENTS.md, docs/ARCHITECTURE.md
Run      src/domain/, src/application/run_assessment.rs, src/operator_guardrails.rs, src/repo.rs
Observe  src/observe.rs, src/detect.rs, src/hooks.rs, src/ipc.rs, src/state_events.rs
Govern   src/domain/evaluator.rs, src/state_fitness.rs, src/tui_fitness.rs
Surfaces src/main.rs, src/cli_operator.rs, src/state*.rs, src/tui*.rs
```