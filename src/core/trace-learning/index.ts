/**
 * Trace Learning - Learn from execution patterns to generate playbooks and guidance.
 *
 * This module provides normalized run outcome tracking that extends the existing
 * trace infrastructure. It enables pattern detection, playbook generation, and
 * runtime preflight guidance based on historical execution data.
 *
 * Architecture:
 * - RunOutcome: High-level session summary with outcome, evidence, and context
 * - RunOutcomeWriter: JSONL append-only writer to docs/fitness/trace-learning/
 * - Pattern detection: TBD (Phase 3)
 * - Playbook generation: TBD (Phase 3)
 * - Runtime loading: TBD (Phase 4)
 *
 * Related: Issue #294 - Trace learning for self-improving agents
 */

export * from "./types";
export * from "./writer";
