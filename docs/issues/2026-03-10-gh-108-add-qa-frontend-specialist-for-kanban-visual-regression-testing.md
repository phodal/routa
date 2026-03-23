---
title: "[GitHub #108] Add QA Frontend Specialist for Kanban visual regression testing"
date: "2026-03-10"
status: resolved
severity: medium
area: "frontend"
tags: ["github", "github-sync", "gh-108", "enhancement", "area-frontend", "complexity-medium"]
reported_by: "phodal"
related_issues: ["https://github.com/phodal/routa/issues/108"]
github_issue: 108
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/108"
---

# [GitHub #108] Add QA Frontend Specialist for Kanban visual regression testing

## Sync Metadata

- Source: GitHub issue sync
- GitHub Issue: #108
- URL: https://github.com/phodal/routa/issues/108
- State: closed
- Author: phodal
- Created At: 2026-03-10T10:20:17Z
- Updated At: 2026-03-10T10:22:19Z

## Labels

- `enhancement`
- `area:frontend`
- `complexity:medium`

## Original GitHub Body

# Problem

The Kanban workflow needs a QA Frontend Specialist that validates completed features through automated visual testing. Currently, when developers finish work, there's no automated process to:

1. Verify that visual snapshots exist for the implemented features
2. Start the dev service if not running
3. Run Playwright CLI tests to capture screenshots and Playwright-specific snapshots
4. Compare new snapshots against baselines to detect unintended changes
5. Provide review artifacts for stakeholders before approval

## Context

- Current behavior: Dev work is done manually, no automated visual regression testing
- Desired behavior: Automated QA specialist that validates frontend changes through visual testing
- Related code: Existing specialists in `resources/specialists/`, Kanban workflow in `src/core/kanban/`

## Relevant Files

### Specialist Patterns
- `resources/specialists/desk-check.md` - Review specialist for Dev → Review transitions
- `resources/specialists/gate.yaml` - Verifier agent pattern
- `resources/specialists/kanban-agent.md` - Kanban orchestrator pattern
- `resources/specialists/issue-refiner.yaml` - Issue analysis pattern

### Kanban Workflow
- `src/core/kanban/column-transition.ts` - Column transition event handling
- `src/core/kanban/agent-trigger.ts` - Agent triggering logic
- `src/core/kanban/workflow-orchestrator.ts` - Workflow orchestration

### Testing Infrastructure
- `playwright.config.ts` - Playwright test configuration
- `.claude/skills/playwright-cli/SKILL.md` - Playwright CLI skill for browser automation
- `e2e/*.spec.ts` - Example E2E test patterns

## Proposed Approaches

### Approach 1: New QA Specialist with Playwright CLI Integration

Create a new specialist `qa-frontend` that:
- Triggers on column transition from "Dev" → "Review" (or "Done")
- Checks for existing snapshots in `test-results/` or e2e test files
- Uses Playwright CLI skill to navigate the app and capture screenshots
- Compares against baseline using `expect(page).toHaveScreenshot()`
- Reports visual differences and approves/rejects the transition

**Libraries**: 
- `@playwright/test` (already installed ^1.58.2) - E2E testing framework
- Built-in playwright skill in `.claude/skills/playwright-cli/` - Browser automation

**Pros**:
- Leverages existing Playwright setup
- Reuses playwright-cli skill already available
- Fits existing specialist pattern (like desk-check.md)
- Can be triggered automatically via column transition events

**Cons**:
- Requires new specialist configuration and testing
- Snapshot comparison logic needs careful tuning for dynamic content
- May need to handle service startup/shutdown

**Estimated effort**: Medium

### Approach 2: Extend Existing Desk Check Agent

Enhance `desk-check.md` to include visual regression capabilities:
- Add screenshot verification to existing review checklist
- Trigger Playwright tests from within the desk-check workflow
- Compare results and include in approval decision

**Libraries**: Same as Approach 1

**Pros**:
- Reuses existing desk-check specialist
- Less configuration overhead
- Visual checks integrated with code review

**Cons**:
- Desk-check has different purpose (code review vs. QA testing)
- May blur responsibilities between review and testing
- Harder to maintain separation of concerns

**Estimated effort**: Medium

### Approach 3: Separate E2E Test Flow with Visual Assertions

Create a dedicated Playwright test suite for visual regression:
- Add `e2e/visual-regression.spec.ts` with screenshot assertions
- Run via npm script `test:e2e:visual`
- Integrate into Kanban workflow via post-dev hook

**Libraries**: 
- `@playwright/test` with `toHaveScreenshot()` assertions
- Optionally: `@playwright/visual-reporter` for diff reports

**Pros**:
- Standard Playwright pattern, well-documented
- Easy to run independently (`npm run test:e2e:visual`)
- Can integrate with CI/CD pipelines
- Simple to add to existing test suite

**Cons**:
- Requires test file maintenance for each feature
- Less intelligent than agent-based approach (no context-aware testing)
- Doesn't fit the specialist/agent pattern

**Estimated effort**: Small

## Recommendation

**Start with Approach 1** - Create a dedicated QA Frontend Specialist.

This approach:
- Fits the existing Kanban specialist architecture
- Leverages the playwright-cli skill already available
- Provides intelligent, context-aware testing (the agent can read the task requirements and test accordingly)
- Can be triggered automatically when cards move to Review column
- Extensible to add more sophisticated checks over time

The specialist would:
1. Read the task card to understand what was implemented
2. Check if the dev server is running (start if needed via `npm run dev`)
3. Use playwright-cli skill to navigate to relevant pages
4. Capture screenshots and Playwright DOM snapshots
5. Compare against baselines (or create new baselines for first-time features)
6. Attach results to the card for review
7. Move to "Done" if passing, or back to "Dev" if issues found

## Out of Scope

- Backend API testing (handled by existing `api:test` scripts)
- Unit testing (handled by `vitest`)
- Performance testing
- Security testing
- Mobile/Responsive testing (initial version focuses on desktop viewport)

## Labels

`enhancement`, `area:frontend`, `complexity:medium`

## Resolution

Resolved based on shipped implementation.

Current repository evidence:

- `resources/specialists/workflows/kanban/qa-frontend.yaml` defines the Kanban QA frontend specialist.
- `docs/specialists/workflows/kanban/kanban-qa-frontend.md` documents the generated specialist surface.
- `src/core/kanban/boards.ts` includes `specialistId: "kanban-qa-frontend"` in the Kanban specialist mapping.
- `e2e/desktop-shell-visual.spec.ts` contains Playwright screenshot assertions using `toHaveScreenshot()`.
- `.github/workflows/page-snapshot-validation.yml` provides snapshot validation automation in CI.
- Follow-up history includes `a5f343c` (`i18n: add kanban qa frontend specialist overlays for #108`).

The issue remained open after the implementation landed, so the tracker state was synchronized and the GitHub issue was closed on 2026-03-23.
