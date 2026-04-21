/**
 * Specialist Database Loader
 *
 * Loads specialist configurations from both database and file system with proper priority:
 * 1. Database user specialists (highest priority)
 * 2. File-based user specialists (~/.routa/specialists/)
 * 3. File-based bundled specialists (resources/specialists/)
 * 4. Hardcoded fallback (lowest priority)
 *
 * Also provides sync functionality to ensure bundled specialists are in the database.
 */

import { AgentRole, ModelTier } from "../models/agent";
import type { SpecialistConfig } from "./specialist-types";
import {
  loadBundledSpecialists,
  loadUserSpecialists,
  toSpecialistConfig,
} from "../specialists/specialist-file-loader";
import type { SpecialistStore } from "../store/specialist-store";

// ─── Cached Specialists ─────────────────────────────────────────────────────

let _cachedSpecialists: SpecialistConfig[] | null = null;

/**
 * Invalidate the specialist cache (call after DB updates).
 */
export function invalidateSpecialistCache(): void {
  _cachedSpecialists = null;
}

// ─── Load Specialists with Priority ─────────────────────────────────────────

/**
 * Load all specialists from all sources with proper priority merging.
 * Priority order (highest to lowest):
 * 1. Database user specialists
 * 2. File-based user specialists (~/.routa/specialists/)
 * 3. File-based bundled specialists (resources/specialists/)
 * 4. Hardcoded fallback
 *
 * Results are cached after first load.
 */
export async function loadSpecialistsFromAllSources(
  specialistStore?: SpecialistStore
): Promise<SpecialistConfig[]> {
  if (_cachedSpecialists) {
    return _cachedSpecialists;
  }

  try {
    // Collect all sources
    const sources: Map<string, { config: SpecialistConfig; priority: number }> = new Map();

    // 1. Load from database (highest priority for user-defined)
    if (specialistStore) {
      try {
        const dbSpecialists = await specialistStore.list({ enabled: true });
        for (const spec of dbSpecialists) {
          sources.set(spec.id, { config: spec, priority: 100 });
        }
      } catch (error) {
        console.warn("[SpecialistLoader] Failed to load from database:", error);
      }
    }

    // 2. Load from user files
    const userFiles = loadUserSpecialists();
    for (const parsed of userFiles) {
      if (!sources.has(parsed.id) || sources.get(parsed.id)!.priority < 75) {
        sources.set(parsed.id, {
          config: toSpecialistConfig({ ...parsed, source: "user" }),
          priority: 75,
        });
      }
    }

    // 3. Load from bundled files
    const bundledFiles = loadBundledSpecialists();
    for (const parsed of bundledFiles) {
      if (!sources.has(parsed.id) || sources.get(parsed.id)!.priority < 50) {
        sources.set(parsed.id, {
          config: toSpecialistConfig({ ...parsed, source: "bundled" }),
          priority: 50,
        });
      }
    }

    // 4. Add hardcoded fallbacks (lowest priority)
    const hardcodedFallbacks = getHardcodedFallbacks();
    for (const spec of hardcodedFallbacks) {
      if (!sources.has(spec.id) || sources.get(spec.id)!.priority < 25) {
        sources.set(spec.id, { config: spec, priority: 25 });
      }
    }

    // Convert to array, sorted by priority (highest first), then by source type
    const result = Array.from(sources.values())
      .sort((a, b) => {
        // First by priority (descending)
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        // Then by source (user > bundled > hardcoded)
        const sourceOrder = { user: 3, bundled: 2, hardcoded: 1 };
        const aSourceOrder = sourceOrder[a.config.source || "hardcoded"] as number;
        const bSourceOrder = sourceOrder[b.config.source || "hardcoded"] as number;
        return bSourceOrder - aSourceOrder;
      })
      .map((v) => v.config);

    _cachedSpecialists = result;
    console.log(
      `[SpecialistLoader] Loaded ${result.length} specialists from all sources ` +
      `(${Array.from(sources.values()).filter((v) => v.priority >= 75).length} user-defined, ` +
      `${Array.from(sources.values()).filter((v) => v.priority >= 50 && v.priority < 75).length} bundled, ` +
      `${Array.from(sources.values()).filter((v) => v.priority < 50).length} hardcoded)`
    );

    return result;
  } catch (error) {
    console.error("[SpecialistLoader] Failed to load specialists:", error);
    return getHardcodedFallbacks();
  }
}

/**
 * Force reload specialists from all sources (clears cache).
 */
export async function reloadSpecialistsFromAllSources(
  specialistStore?: SpecialistStore
): Promise<SpecialistConfig[]> {
  _cachedSpecialists = null;
  return loadSpecialistsFromAllSources(specialistStore);
}

// ─── Hardcoded Fallbacks ───────────────────────────────────────────────────

function getHardcodedFallbacks(): SpecialistConfig[] {
  return [
    {
      id: "routa",
      name: "Coordinator",
      description: "Plans work, breaks down tasks, coordinates sub-agents",
      role: AgentRole.ROUTA,
      defaultModelTier: ModelTier.SMART,
      systemPrompt: getRoutaSystemPrompt(),
      roleReminder: "You NEVER edit files directly. Delegate ALL implementation to CRAFTER agents.",
      source: "hardcoded",
    },
    {
      id: "crafter",
      name: "Implementor",
      description: "Executes implementation tasks, writes code",
      role: AgentRole.CRAFTER,
      defaultModelTier: ModelTier.FAST,
      systemPrompt: getCrafterSystemPrompt(),
      roleReminder: "Stay within task scope. Call report_to_parent when complete.",
      source: "hardcoded",
    },
    {
      id: "gate",
      name: "Verifier",
      description: "Reviews work and verifies completeness",
      role: AgentRole.GATE,
      defaultModelTier: ModelTier.SMART,
      systemPrompt: getGateSystemPrompt(),
      roleReminder: "Verify against Acceptance Criteria ONLY. Be evidence-driven.",
      source: "hardcoded",
    },
    {
      id: "developer",
      name: "Developer",
      description: "Plans then implements itself — no delegation",
      role: AgentRole.DEVELOPER,
      defaultModelTier: ModelTier.SMART,
      systemPrompt: getDeveloperSystemPrompt(),
      roleReminder: "You work ALONE — never use delegate_task or create_agent.",
      source: "hardcoded",
    },
  ];
}

// ─── System Prompt Functions (simplified for fallback) ───────────────────────

function getRoutaSystemPrompt(): string {
  return `## Routa Coordinator

You plan, delegate, and verify. You do NOT implement code yourself.

## Hard Rules
1. NEVER edit code — Delegate implementation to CRAFTER agents
2. NEVER use checkboxes for tasks — Use @@@task blocks ONLY
3. Spec first, always — Create/update the spec BEFORE any delegation
4. Wait for approval — Present the plan and STOP
5. END TURN after delegation — Stop and wait for completion

## Workflow
1. Understand: Ask 1-4 clarifying questions if needed
2. Spec: Write the spec with @@@task blocks
3. STOP: Present the plan to the user
4. Wait: Do NOT proceed until user approves
5. Delegate: Use delegate_task_to_agent with taskIds
6. END TURN: Stop and wait for completion`;
}

function getCrafterSystemPrompt(): string {
  return `## Crafter (Implementor)

Implement your assigned task — nothing more, nothing less.

## Hard Rules
1. No scope creep — only what the task asks
2. No refactors — if needed, report to parent
3. Coordinate — check list_agents to avoid conflicts
4. Don't delegate — message parent if blocked

## Completion
When done, call report_to_parent with:
- summary: What you did
- success: true/false
- filesModified: List of files you changed
- taskId: Your assigned task ID`;
}

function getGateSystemPrompt(): string {
  return `## Gate (Verifier)

You verify the implementation against the spec's Acceptance Criteria.

## Hard Rules
1. Acceptance Criteria is the checklist
2. No evidence, no verification
3. No partial approvals — All criteria must be VERIFIED
4. Don't expand scope

## Completion
Call report_to_parent with:
- summary: Verdict + confidence + top issues
- success: true only if ALL criteria VERIFIED
- taskId: Your assigned task ID`;
}

function getDeveloperSystemPrompt(): string {
  return `## Developer

You plan and implement. You write specs first, then implement yourself.

## Hard Rules
1. Spec first, always — Create/update the spec BEFORE implementing
2. Wait for approval — STOP and wait for explicit approval
3. No delegation — Never use delegate_task or create_agent
4. Self-verify — Verify every acceptance criterion after implementing`;
}

// ─── Database Sync ─────────────────────────────────────────────────────────

/**
 * Sync bundled specialists from files to database.
 * This ensures the database has all bundled specialists for web UI management.
 */
export async function syncBundledSpecialistsToDatabase(
  specialistStore: SpecialistStore
): Promise<void> {
  const bundledFiles = loadBundledSpecialists();

  for (const parsed of bundledFiles) {
    const config = toSpecialistConfig({ ...parsed, source: "bundled" });

    await specialistStore.upsert({
      id: config.id,
      name: config.name,
      description: config.description,
      role: config.role,
      defaultModelTier: config.defaultModelTier,
      systemPrompt: config.systemPrompt,
      roleReminder: config.roleReminder,
      defaultProvider: config.defaultProvider,
      defaultAdapter: config.defaultAdapter,
      model: config.model,
      source: "bundled",
    });
  }

  console.log(
    `[SpecialistLoader] Synced ${bundledFiles.length} bundled specialists to database`
  );
}

/**
 * Create or update a user specialist in the database.
 * Also invalidates the cache.
 */
export async function saveUserSpecialist(
  specialistStore: SpecialistStore,
  input: {
    id: string;
    name: string;
    description?: string;
    role: AgentRole;
    defaultModelTier: ModelTier;
    systemPrompt: string;
    roleReminder?: string;
    defaultProvider?: string;
    defaultAdapter?: string;
    model?: string;
  }
): Promise<SpecialistConfig> {
  const result = await specialistStore.upsert({
    ...input,
    source: "user",
  });

  invalidateSpecialistCache();

  return result;
}

/**
 * Delete a user specialist from the database.
 * Also invalidates the cache.
 */
export async function deleteUserSpecialist(
  specialistStore: SpecialistStore,
  id: string
): Promise<boolean> {
  const result = await specialistStore.delete(id);

  if (result) {
    invalidateSpecialistCache();
  }

  return result;
}
