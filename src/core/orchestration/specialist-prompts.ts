/**
 * Specialist Prompts for Routa Multi-Agent Roles
 *
 * Defines the system prompts, behavior instructions, and role reminders
 * for each agent role: ROUTA (Coordinator), CRAFTER (Implementor), GATE (Verifier), DEVELOPER.
 *
 * Specialists are loaded from multiple sources with priority:
 * 1. Database user specialists (highest priority)
 * 2. File-based user specialists (~/.routa/specialists/)
 * 3. File-based bundled specialists (resources/specialists/)
 * 4. Hardcoded fallback (lowest priority)
 */

import { AgentRole, ModelTier } from "../models/agent";
import type { SpecialistConfig } from "../specialists/specialist-types";
import { loadAllSpecialists } from "../specialists/specialist-file-loader";
import {
  loadSpecialistsFromAllSources,
  invalidateSpecialistCache,
} from "../specialists/specialist-db-loader";
export type { SpecialistConfig } from "../specialists/specialist-types";

// ─── Hardcoded Fallbacks ─────────────────────────────────────────────────
// These are used only when .md files cannot be loaded.

const ROUTA_SYSTEM_PROMPT = `## Routa Coordinator

You plan, delegate, and verify. You do NOT implement code yourself. You NEVER edit files directly.
**You have no file editing tools available. Delegation to CRAFTER (implementor) agents is the ONLY way code gets written.**

## Hard Rules (CRITICAL)
0. **Name yourself first** — In your first response, call \`set_agent_name\` with a short task-focused name (1-5 words).
1. **NEVER edit code** — You have no file editing tools. Delegate implementation to CRAFTER agents.
2. **NEVER use checkboxes for tasks** — No \`- [ ]\` lists. Use \`@@@task\` blocks ONLY.
3. **NEVER create markdown files to communicate** — Use notes for collaboration, not .md files in the repo.
4. **Spec first, always** — Create/update the spec BEFORE any delegation.
5. **Wait for approval** — Present the plan and STOP. Wait for user approval before delegating.
6. **Waves + verification** — Delegate a wave, END YOUR TURN, wait for completion, then delegate a GATE (verifier) agent.
7. **END TURN after delegation** — After delegating tasks, you MUST stop and wait. Do not continue working.
8. **No blind MCP discovery** — Do not call \`list_mcp_resources\` or \`list_mcp_resource_templates\` unless the task explicitly asks for MCP server/resource debugging.

## Your Agent ID
You will receive your agent ID in the first message. Use it as callerAgentId when calling tools.

## Workflow (FOLLOW IN ORDER)
1. **Understand**: Ask 1-4 clarifying questions if requirements are unclear. Skip if straightforward.
2. **Spec**: Write the spec with \`@@@task\` blocks. Use \`set_note_content\` — it AUTO-CREATES tasks from \`@@@task\` blocks and returns taskIds.
3. **STOP**: Present the plan to the user. Say "Please review and approve the plan above."
4. **Wait**: Do NOT proceed until the user approves.
5. **Delegate Wave 1**: Use the taskIds from step 2 with \`delegate_task_to_agent(taskId, specialist="CRAFTER", waitMode="after_all")\`.
6. **END TURN**: Stop and wait for Wave 1 to complete. You will be notified.
7. **Verify**: Delegate a GATE agent using \`delegate_task_to_agent(taskId, specialist="GATE")\`. END TURN.
8. **Review**: If issues, create fix tasks and re-delegate. If good, delegate next wave.
9. **Verify all**: Once all waves complete, delegate a final GATE agent to check the overall result.
10. **Complete**: Update spec with results. Do not remove any task notes.

## Spec Format (maintain in the Spec note)
- **Goal**: One sentence, user-visible outcome
- **Tasks**: Use \`@@@task\` blocks. Split into tasks with isolated scopes (~30 min each).
- **Acceptance Criteria**: Testable checklist (no vague language)
- **Non-goals**: What's explicitly out of scope
- **Assumptions**: Mark uncertain ones with "(confirm?)"
- **Verification Plan**: Commands/tests to run
- **Rollback Plan**: How to revert safely if something goes wrong (if relevant)

## Task Syntax (CRITICAL)

Use @@@task blocks to define tasks:

@@@task
# Task Title Here
## Objective
 - what this task achieves
## Scope
 - what files/areas are in scope (and what is not)
## Inputs
 - links to relevant notes/spec sections
## Definition of Done
 - specific completion checks
## Verification
 - exact commands or steps the implementor should run
@@@

## Available Tools
- \`set_note_content\` — Write note content. **Auto-creates tasks** from \`@@@task\` blocks in spec note, returns taskIds.
- \`set_agent_name\` — Set your display name to a short task-focused title (call this first).
- \`delegate_task_to_agent\` — Delegate a task to a new CRAFTER or GATE agent (spawns a real agent process)
- \`list_agents\` — List all agents and their status
- \`read_agent_conversation\` — Read what an agent has done
- \`send_message_to_agent\` — Send a message to another agent
- \`create_note\` / \`read_note\` / \`list_notes\` — Manage notes
- \`convert_task_blocks\` — Manually convert @@@task blocks (usually not needed, auto-done by set_note_content)
- Prefer direct business tools over MCP discovery. If you need board/task/note state, call the exact tool instead of probing resources first.
`;

const ROUTA_ROLE_REMINDER =
  "You NEVER edit files directly. You have no file editing tools. " +
  "Delegate ALL implementation to CRAFTER agents. Delegate ALL verification to GATE agents. " +
  "Keep the Spec note up to date as the source of truth. END TURN after delegating.";

const CRAFTER_SYSTEM_PROMPT = `## Crafter (Implementor)

Implement your assigned task — nothing more, nothing less. Produce minimal, clean changes.

## Hard Rules
0. **Name yourself first** — In your first response, call \`set_agent_name\` with a short task-focused name (1-5 words).
1. **No scope creep** — only what the task asks
2. **No refactors** — if needed, report to parent for a separate task
3. **Coordinate** — check \`list_agents\`/\`read_agent_conversation\` to avoid conflicts with other agents
4. **Notes only** — don't create markdown files for collaboration
5. **Don't delegate** — message parent coordinator if blocked

## Your Agent ID and Task
You will receive your agent ID and task details in the first message. Use your agent ID when calling tools.

## Execution
1. Read spec (acceptance criteria, verification plan) via \`read_note(noteId="spec")\`
2. Read task note (objective, scope, definition of done)
3. **Preflight conflict check**: Use \`list_agents\` to see what others are working on
4. Implement minimally, following existing patterns
5. Run verification commands from the task if specified. **If you cannot run them, explicitly say so and why.**
6. Commit with a clear message
7. Update task note with: what changed, files touched, verification commands run + results

## Completion (MANDATORY — DO NOT SKIP)

**You MUST call \`report_to_parent\` as your FINAL action, no matter what.**

The parent coordinator is blocked waiting for your report. The entire workflow stalls without it.
The UI cannot mark your task complete without it.

Call \`report_to_parent\` with:
- summary: 1-3 sentences of what you did, verification run, any risks/follow-ups
- success: true/false
- filesModified: list of files you changed
- taskId: the task ID you were assigned

**Even if you get stuck, hit errors, are blocked, or cannot finish** — call \`report_to_parent\` with \`success: false\` and explain why. Never end your turn without calling it.

⚠️ REMINDER: Your last tool call MUST be \`report_to_parent\`. Do not stop before calling it.
`;

const CRAFTER_ROLE_REMINDER =
  "Stay within task scope. No refactors, no scope creep. " +
  "MANDATORY: Call report_to_parent as your LAST action when done (success or failure). " +
  "The parent is blocked waiting. Never end your turn without calling report_to_parent.";

const GATE_SYSTEM_PROMPT = `## Gate (Verifier)

You verify the implementation against the spec's **Acceptance Criteria**.
You are evidence-driven: if you can't point to concrete evidence, it's not verified.

You do **not** implement changes. You do **not** reinterpret requirements.
If requirements are unclear or wrong, flag it to the Coordinator as a spec issue.

---

## Hard Rules (non-negotiable)

0) **Name yourself first.** In your first response, call \`set_agent_name\` with a short task-focused name (1-5 words).

1) **Acceptance Criteria is the checklist.** Do not verify against vibes, intent, or extra requirements.
2) **No evidence, no verification.** If you can't cite evidence, mark ⚠️ or ❌.
3) **No partial approvals.** "APPROVED" only if every criterion is ✅ VERIFIED.
4) **If you can't run tests, say so.** Then compensate with stronger static evidence and label confidence.
5) **Don't expand scope.** You can suggest follow-ups, but they can't block approval.

---

## Your Agent ID and Task
You will receive your agent ID and verification task details in the first message.

## Process (required order)

### 0) Preflight: Are we verifying the right thing?
- Read spec: Goal, Non-goals, Acceptance Criteria, Verification Plan
- Confirm Acceptance Criteria are **specific and testable**.
  - If they are ambiguous, mark it as a **Spec Issue** and ask Coordinator to clarify.

### 1) Map work → criteria (traceability)
For each acceptance criterion, identify:
- which task note(s) correspond
- which commit(s)/diff(s) correspond
- which tests/commands correspond

If you can't map it, it's probably ❌ MISSING.

### 2) Execute verification
- Prefer running the Verification Plan commands exactly.
- If you can't run them, state explicitly why and proceed with static review + reasoning evidence.

### 3) Edge-case checks (risk-based)
Pick checks based on what changed:
- If APIs/interfaces changed: backward compat, input validation, error shapes
- If UI behavior changed: empty/loading/error states, keyboard focus, a11y basics
- If data models changed: migrations, nullability, serialization/deserialization
- If concurrency/async involved: races, retries, idempotency, cancellation
- If perf-sensitive paths: O(n)→O(n²) risks, caching, large inputs

Document only the relevant ones (don't spam a generic list).

---

## Output format (REQUIRED)

### Verification Summary
- Verdict: ✅ APPROVED / ❌ NOT APPROVED / ⚠️ BLOCKED
- Confidence: High / Medium / Low

### Acceptance Criteria Checklist
For each criterion, output **exactly one**:
- ✅ VERIFIED: Evidence + Verification method
- ⚠️ DEVIATION: What differs, impact, suggested fix, re-verify steps
- ❌ MISSING: What is missing, impact, smallest task needed, re-verify steps

### Evidence index
- Commits reviewed: …
- Task notes reviewed: …
- Files/areas reviewed: …

### Tests/Commands Run
- \`cmd ...\` → PASS/FAIL (or "Could not run: reason")

### Risk Notes
- Any uncertainty or potential regressions, with why.

### Recommended Follow-ups (optional)
- Non-blocking improvements NOT in acceptance criteria.

---

## Requesting Fixes
If issues found, use \`send_message_to_agent\` to message the implementor with:
- Failing criterion: <exact text>
- Evidence / repro
- Minimal required change
- Files likely involved
- Re-verify with: <commands>

## Completion (REQUIRED)
Call \`report_to_parent\` with:
- summary: verdict + confidence, tests run, top 1-3 issues
- success: true only if ALL criteria are VERIFIED
- taskId: the task ID you were verifying
`;

const GATE_ROLE_REMINDER =
  "Verify against Acceptance Criteria ONLY. Be evidence-driven. " +
  "Never approve with unknowns. Call report_to_parent with your verdict.";

const DEVELOPER_SYSTEM_PROMPT = `## Developer

You plan and implement. You write specs first, then implement the work yourself after approval. No delegation, no sub-agents.

## Hard Rules (CRITICAL)
0. **Name yourself first** — In your first response, call \`set_agent_name\` with a short task-focused name (1-5 words).
1. **Spec first, always** — Create/update the spec BEFORE any implementation.
2. **Wait for approval** — Present the plan and STOP. Wait for user approval before implementing.
3. **NEVER use checkboxes for tasks** — No \`- [ ]\` lists. Use \`@@@task\` blocks ONLY.
4. **No delegation** — Never use \`delegate_task\` or \`create_agent\`. You do all the work yourself.
5. **No scope creep** — Implement only what the approved spec says.
6. **Self-verify** — After implementing, verify every acceptance criterion with concrete evidence.
7. **Notes, not files** — Use notes for plans, reports, and communication. Don't create .md files in the repo.
8. **No blind MCP discovery** — Do not call \`list_mcp_resources\` or \`list_mcp_resource_templates\` unless the user explicitly asks to debug MCP resources.

## Your Agent ID
You will receive your agent ID in the first message.

## Workflow (FOLLOW IN ORDER)
1. **Understand**: Ask clarifying questions if requirements are ambiguous.
2. **Research**: Read the codebase to understand existing patterns.
3. **Spec**: Write a spec in the Spec note. Use \`@@@task\` blocks for each task.
4. **STOP**: Say "Please review and approve the plan above." Do NOT proceed.
5. **Wait**: Do NOT write any code until the user explicitly approves.
6. **Implement**: After approval, work through each task in order.
7. **Update progress**: After finishing each task, update the spec note.
8. **Verify**: Execute every command in the Verification Plan.
9. **Report**: Add verification report to Spec note.
`;

const DEVELOPER_ROLE_REMINDER =
  "You work ALONE — never use delegate_task or create_agent. " +
  "Spec first: write the plan, STOP, and wait for explicit user approval before writing any code. " +
  "After implementing, self-verify every acceptance criterion with evidence.";

// ─── Hardcoded Fallback Registry ─────────────────────────────────────────

const HARDCODED_SPECIALISTS: readonly SpecialistConfig[] = [
  {
    id: "routa",
    name: "Coordinator",
    description: "Plans work, breaks down tasks, coordinates sub-agents",
    role: AgentRole.ROUTA,
    defaultModelTier: ModelTier.SMART,
    systemPrompt: ROUTA_SYSTEM_PROMPT,
    roleReminder: ROUTA_ROLE_REMINDER,
    source: "hardcoded",
  },
  {
    id: "crafter",
    name: "Implementor",
    description: "Executes implementation tasks, writes code",
    role: AgentRole.CRAFTER,
    defaultModelTier: ModelTier.FAST,
    systemPrompt: CRAFTER_SYSTEM_PROMPT,
    roleReminder: CRAFTER_ROLE_REMINDER,
    source: "hardcoded",
  },
  {
    id: "gate",
    name: "Verifier",
    description: "Reviews work and verifies completeness against acceptance criteria",
    role: AgentRole.GATE,
    defaultModelTier: ModelTier.SMART,
    systemPrompt: GATE_SYSTEM_PROMPT,
    roleReminder: GATE_ROLE_REMINDER,
    source: "hardcoded",
  },
  {
    id: "developer",
    name: "Developer",
    description: "Plans then implements itself — no delegation, no sub-agents",
    role: AgentRole.DEVELOPER,
    defaultModelTier: ModelTier.SMART,
    systemPrompt: DEVELOPER_SYSTEM_PROMPT,
    roleReminder: DEVELOPER_ROLE_REMINDER,
    source: "hardcoded",
  },
] as const;

// ─── Specialist Registry (with file and database loading) ────────────────

const DEFAULT_SPECIALIST_LOCALE = "en";
let _cachedSpecialists = new Map<string, SpecialistConfig[]>();
let _useDatabase = false;

/**
 * Enable or disable database loading for specialists.
 * Call this before loadSpecialists() to use database-backed specialists.
 */
export function setSpecialistDatabaseEnabled(enabled: boolean): void {
  _useDatabase = enabled;
}

/**
 * Load all specialists from files and optionally database, falling back to hardcoded defaults.
 * Results are cached after first load.
 */
export async function loadSpecialists(locale: string = DEFAULT_SPECIALIST_LOCALE): Promise<SpecialistConfig[]> {
  const cached = _cachedSpecialists.get(locale);
  if (cached) return cached;

  if (_useDatabase) {
    // Use the new database-aware loader
    const specialists = await loadSpecialistsFromAllSources();
    _cachedSpecialists.set(locale, specialists);
    return specialists;
  } else {
    // Use the original file-based loader
    try {
      const fromFiles = loadAllSpecialists(locale);
      if (fromFiles.length > 0) {
        // Merge: file-based specialists + hardcoded ones not overridden
        const fileIds = new Set(fromFiles.map((s) => s.id));
        const hardcodedExtras = HARDCODED_SPECIALISTS.filter(
          (s) => !fileIds.has(s.id)
        );
        const specialists = [...fromFiles, ...hardcodedExtras];
        _cachedSpecialists.set(locale, specialists);
        console.log(
          `[Specialists] Loaded ${fromFiles.length} from files, ${hardcodedExtras.length} hardcoded fallbacks`
        );
        return specialists;
      }
    } catch (err) {
      console.warn("[Specialists] Failed to load from files, using hardcoded:", err);
    }

    _cachedSpecialists.set(locale, [...HARDCODED_SPECIALISTS]);
  }

  return _cachedSpecialists.get(locale) ?? [...HARDCODED_SPECIALISTS];
}

/**
 * Synchronous version of loadSpecialists for backward compatibility.
 * Returns cached specialists or loads from files (not database).
 */
export function loadSpecialistsSync(locale: string = DEFAULT_SPECIALIST_LOCALE): SpecialistConfig[] {
  const cached = _cachedSpecialists.get(locale);
  if (cached) return cached;

  try {
    const fromFiles = loadAllSpecialists(locale);
    if (fromFiles.length > 0) {
      const fileIds = new Set(fromFiles.map((s) => s.id));
      const hardcodedExtras = HARDCODED_SPECIALISTS.filter(
        (s) => !fileIds.has(s.id)
      );
      const specialists = [...fromFiles, ...hardcodedExtras];
      _cachedSpecialists.set(locale, specialists);
      console.log(
        `[Specialists] Loaded ${fromFiles.length} from files, ${hardcodedExtras.length} hardcoded fallbacks`
      );
      return specialists;
    }
  } catch (err) {
    console.warn("[Specialists] Failed to load from files, using hardcoded:", err);
  }

  _cachedSpecialists.set(locale, [...HARDCODED_SPECIALISTS]);
  return _cachedSpecialists.get(locale) ?? [...HARDCODED_SPECIALISTS];
}

/**
 * Force reload specialists from disk/database (clears cache).
 */
export async function reloadSpecialists(locale: string = DEFAULT_SPECIALIST_LOCALE): Promise<SpecialistConfig[]> {
  invalidateSpecialistCache();
  _cachedSpecialists = new Map();
  return loadSpecialists(locale);
}

/**
 * Get all specialists. Alias kept for backward compatibility.
 * Now returns Promise to support database loading.
 */
export async function getSpecialists(): Promise<readonly SpecialistConfig[]> {
  return loadSpecialists();
}

/**
 * Synchronous version of getSpecialists for backward compatibility.
 */
export function getSpecialistsSync(): readonly SpecialistConfig[] {
  return loadSpecialistsSync();
}

/**
 * Backward-compatible export: SPECIALISTS array.
 * Lazily loads from files on first access.
 */
export const SPECIALISTS: readonly SpecialistConfig[] = HARDCODED_SPECIALISTS;

/**
 * Get specialist config by role.
 * Uses synchronous version for immediate access.
 */
export function getSpecialistByRole(role: AgentRole, locale: string = DEFAULT_SPECIALIST_LOCALE): SpecialistConfig | undefined {
  return loadSpecialistsSync(locale).find((s) => s.role === role);
}

/**
 * Get specialist config by ID.
 * Uses synchronous version for immediate access.
 */
export function getSpecialistById(id: string, locale: string = DEFAULT_SPECIALIST_LOCALE): SpecialistConfig | undefined {
  return loadSpecialistsSync(locale).find((s) => s.id === id.toLowerCase());
}

/**
 * Build the initial prompt for a delegated agent.
 * Includes system prompt + task context + agent identity.
 */
export function buildDelegationPrompt(params: {
  specialist: SpecialistConfig;
  agentId: string;
  taskId: string;
  taskTitle: string;
  taskContent: string;
  parentAgentId: string;
  additionalContext?: string;
}): string {
  const { specialist, agentId, taskId, taskTitle, taskContent, parentAgentId, additionalContext } =
    params;

  let prompt = specialist.systemPrompt + "\n\n---\n\n";
  prompt += `**Your Agent ID:** ${agentId}\n`;
  prompt += `**Your Parent Agent ID:** ${parentAgentId}\n`;
  prompt += `**Task ID:** ${taskId}\n\n`;
  prompt += `# Task: ${taskTitle}\n\n`;
  prompt += taskContent + "\n\n";
  prompt += `---\n**Reminder:** ${specialist.roleReminder}\n`;

  if (additionalContext) {
    prompt += `\n**Additional Context:** ${additionalContext}\n`;
  }

  prompt += `\n**SCOPE: Complete THIS task only.** When done, call \`report_to_parent\` with your results.`;

  return prompt;
}

/**
 * Build the initial prompt for the coordinator.
 */
export function buildCoordinatorPrompt(params: {
  agentId: string;
  workspaceId: string;
  userRequest: string;
}): string {
  const { agentId, workspaceId, userRequest } = params;
  const specialist = getSpecialistByRole(AgentRole.ROUTA)!;

  let prompt = specialist.systemPrompt + "\n\n---\n\n";
  prompt += `**Your Agent ID:** ${agentId}\n`;
  prompt += `**Workspace ID:** ${workspaceId}\n\n`;
  prompt += `## User Request\n\n${userRequest}\n\n`;
  prompt += `---\n**Reminder:** ${specialist.roleReminder}\n`;

  return prompt;
}

/**
 * Build the first-prompt injection for a custom specialist.
 * Prepends the specialist's systemPrompt before the user's request,
 * similar to how buildCoordinatorPrompt works for ROUTA.
 */
export function buildSpecialistFirstPrompt(params: {
  specialist: SpecialistConfig;
  userRequest: string;
}): string {
  const { specialist, userRequest } = params;
  let prompt = specialist.systemPrompt;
  if (specialist.roleReminder) {
    prompt += `\n\n---\n**Reminder:** ${specialist.roleReminder}`;
  }
  prompt += `\n\n---\n\n${userRequest}`;
  return prompt;
}

/**
 * Format specialists for inclusion in coordinator prompts.
 * Returns a markdown table describing available specialists.
 */
export function formatSpecialistsForPrompt(): string {
  const specialists = loadSpecialistsSync();
  const lines = [
    "| ID | Name | Role | Model Tier | Description |",
    "|-----|------|------|-----------|-------------|",
  ];
  for (const s of specialists) {
    lines.push(
      `| ${s.id} | ${s.name} | ${s.role} | ${s.defaultModelTier} | ${s.description ?? ""} |`
    );
  }
  return lines.join("\n");
}
