---
status: generated
purpose: Auto-generated route and API surface index for Routa.js.
sources:
  - src/app/**/page.tsx
  - api-contract.yaml
  - src/app/api/**/route.ts
  - crates/routa-server/src/api/**/*.rs
update_policy:
  - "Regenerate with `routa feature-tree generate` or via the Feature Explorer UI."
  - "Hand-edit semantic `feature_metadata` fields in this frontmatter block."
  - "`feature_metadata.features[].source_files` is regenerated from declared pages/APIs."
  - "Do not hand-edit generated endpoint or route tables below."
feature_metadata:
  schema_version: 1
  capability_groups:
    - id: workspace-coordination
      name: Workspace Coordination
      description: Workspace-scoped navigation, overview, and cross-surface coordination.
    - id: agent-execution
      name: Agent Execution
      description: Session-centric agent runs, recovery, and traceable execution context.
    - id: kanban-automation
      name: Kanban Automation
      description: Task flow, lane automation, and workflow progression.
    - id: team-collaboration
      name: Team Collaboration
      description: Multi-agent and multi-session collaboration inside a workspace.
    - id: governance-settings
      name: Governance and Settings
      description: Harness, fluency, MCP, settings, and platform governance surfaces.
  features:
    - id: workspace-overview
      name: Workspace Overview
      group: workspace-coordination
      summary: Entry point for a selected workspace and its scoped surfaces.
      status: shipped
      pages:
        - /workspace/:workspaceId
        - /workspace/:workspaceId/overview
      domain_objects:
        - activity
        - codebase
        - note
        - workspace
      source_files:
        - src/app/workspace/[workspaceId]/overview/page.tsx
        - src/app/workspace/[workspaceId]/page.tsx
    - id: feature-explorer
      name: Feature Explorer
      group: workspace-coordination
      summary: Inspect workspace feature surfaces and session-backed file activity.
      status: evolving
      pages:
        - /workspace/:workspaceId/feature-explorer
      apis:
        - GET /api/feature-explorer
        - GET /api/feature-explorer/{featureId}
        - GET /api/feature-explorer/{featureId}/apis
        - GET /api/feature-explorer/{featureId}/files
      source_files:
        - crates/routa-server/src/api/feature_explorer.rs
        - src/app/api/feature-explorer/[featureId]/apis/route.ts
        - src/app/api/feature-explorer/[featureId]/files/route.ts
        - src/app/api/feature-explorer/[featureId]/route.ts
        - src/app/api/feature-explorer/route.ts
        - >-
          src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx
        - src/app/workspace/[workspaceId]/feature-explorer/page.tsx
    - id: session-recovery
      name: Session Recovery
      group: agent-execution
      summary: Restore, inspect, and continue workspace-scoped agent sessions.
      status: shipped
      pages:
        - /workspace/:workspaceId/sessions
        - /workspace/:workspaceId/sessions/:sessionId
      apis:
        - DELETE /api/sessions/{id}
        - GET /api/sessions
        - GET /api/sessions/{id}
        - GET /api/sessions/{id}/history
        - GET /api/sessions/{id}/transcript
        - GET /api/sessions/{sessionId}/context
        - GET /api/sessions/{sessionId}/reposlide-result
        - GET /api/sessions/{sessionId}/reposlide-result/download
        - PATCH /api/sessions/{id}
        - POST /api/sessions/{id}/disconnect
        - POST /api/sessions/{sessionId}/fork
      domain_objects:
        - session
        - trace
        - workspace
      related_features:
        - team-runs
        - workspace-overview
      source_files:
        - crates/routa-server/src/api/sessions.rs
        - src/app/api/sessions/[sessionId]/context/route.ts
        - src/app/api/sessions/[sessionId]/disconnect/route.ts
        - src/app/api/sessions/[sessionId]/fork/route.ts
        - src/app/api/sessions/[sessionId]/history/route.ts
        - src/app/api/sessions/[sessionId]/reposlide-result/download/route.ts
        - src/app/api/sessions/[sessionId]/reposlide-result/route.ts
        - src/app/api/sessions/[sessionId]/route.ts
        - src/app/api/sessions/[sessionId]/transcript/route.ts
        - src/app/api/sessions/route.ts
        - src/app/workspace/[workspaceId]/sessions/[sessionId]/page.tsx
        - src/app/workspace/[workspaceId]/sessions/page.tsx
    - id: kanban-workflow
      name: Kanban Workflow
      group: kanban-automation
      summary: >-
        Coordinate tasks through lane transitions, automation, and git-aware
        execution.
      status: shipped
      pages:
        - /workspace/:workspaceId/kanban
      apis:
        - GET /api/kanban/boards
        - GET /api/kanban/boards/{boardId}
        - GET /api/kanban/events
        - GET /api/kanban/export
        - PATCH /api/kanban/boards/{boardId}
        - POST /api/kanban/boards
        - POST /api/kanban/decompose
        - POST /api/kanban/import
      domain_objects:
        - board
        - task
        - workflow
        - workspace
      related_features:
        - session-recovery
      source_files:
        - crates/routa-server/src/api/kanban.rs
        - src/app/api/kanban/boards/[boardId]/route.ts
        - src/app/api/kanban/boards/route.ts
        - src/app/api/kanban/decompose/route.ts
        - src/app/api/kanban/events/route.ts
        - src/app/api/kanban/export/route.ts
        - src/app/api/kanban/import/route.ts
        - src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx
        - src/app/workspace/[workspaceId]/kanban/page.tsx
    - id: team-runs
      name: Team Runs
      group: team-collaboration
      summary: Orchestrate and inspect multi-agent team runs within a workspace.
      status: shipped
      pages:
        - /workspace/:workspaceId/team
        - /workspace/:workspaceId/team/:sessionId
      domain_objects:
        - session
        - team-run
        - workspace
      related_features:
        - session-recovery
      source_files:
        - src/app/workspace/[workspaceId]/team/[sessionId]/page.tsx
        - src/app/workspace/[workspaceId]/team/page.tsx
    - id: harness-console
      name: Harness Console
      group: governance-settings
      summary: >-
        Inspect repo signals, governance surfaces, and fitness-related runtime
        status.
      status: evolving
      pages:
        - /settings/harness
        - /workspace/:workspaceId/spec
      apis:
        - GET /api/fitness/architecture
        - GET /api/fitness/plan
        - GET /api/fitness/report
        - GET /api/fitness/runtime
        - GET /api/fitness/specs
        - GET /api/harness/agent-hooks
        - GET /api/harness/automations
        - GET /api/harness/codeowners
        - GET /api/harness/design-decisions
        - GET /api/harness/github-actions
        - GET /api/harness/hooks
        - GET /api/harness/hooks/preview
        - GET /api/harness/instructions
        - GET /api/harness/repo-signals
        - GET /api/harness/spec-sources
        - POST /api/fitness/analyze
      domain_objects:
        - fitness
        - harness
        - spec
      source_files:
        - crates/routa-server/src/api/fitness.rs
        - crates/routa-server/src/api/harness.rs
        - src/app/api/fitness/analyze/route.ts
        - src/app/api/fitness/architecture/route.ts
        - src/app/api/fitness/plan/route.ts
        - src/app/api/fitness/report/route.ts
        - src/app/api/fitness/runtime/route.ts
        - src/app/api/fitness/specs/route.ts
        - src/app/api/harness/agent-hooks/route.ts
        - src/app/api/harness/automations/route.ts
        - src/app/api/harness/codeowners/route.ts
        - src/app/api/harness/design-decisions/route.ts
        - src/app/api/harness/github-actions/route.ts
        - src/app/api/harness/hooks/preview/route.ts
        - src/app/api/harness/hooks/route.ts
        - src/app/api/harness/instructions/route.ts
        - src/app/api/harness/repo-signals/route.ts
        - src/app/api/harness/spec-sources/route.ts
        - src/app/settings/harness/page.tsx
        - src/app/workspace/[workspaceId]/spec/page.tsx
        - src/client/hooks/use-harness-settings-data.ts
---

# Routa.js — Product Feature Specification

Multi-agent coordination platform. This document is auto-generated from:
- Frontend routes: `src/app/**/page.tsx`
- Contract API: `api-contract.yaml`
- Next.js API routes: `src/app/api/**/route.ts`
- Rust API routes: `crates/routa-server/src/api/**/*.rs`
- Feature metadata: `feature_metadata` frontmatter in this file (`source_files` regenerated)

---

## Frontend Pages

| Page | Route | Source File | Description |
|------|-------|-------------|-------------|
| Home | `/` | `src/app/page.tsx` | Workspace-first landing page for selecting a workspace, connecting providers, an |
| A2A Protocol Test Page | `/a2a` | `src/app/a2a/page.tsx` | Interactive testing interface for the Agent-to-Agent (A2A) protocol |
| AG-UI Protocol Test Page | `/ag-ui` | `src/app/ag-ui/page.tsx` | Standalone page for testing AG-UI protocol integration |
| Canvas | `/canvas/:id` | `src/app/canvas/[id]/page.tsx` | Viewer page for opening a saved canvas artifact by ID, including static-export p |
| Debug / Acp Replay | `/debug/acp-replay` | `src/app/debug/acp-replay/page.tsx` | Debug surface for replaying ACP transcripts and inspecting session event sequenc |
| Mcp Tools | `/mcp-tools` | `src/app/mcp-tools/page.tsx` | Shortcut route that redirects to the MCP tools settings experience for browsing  |
| Messages Page - Notification & PR Agent Execution History | `/messages` | `src/app/messages/page.tsx` | Shows: - All notifications with filtering - PR Agent execution history from back |
| Settings Page | `/settings` | `src/app/settings/page.tsx` | Provides a full-page UI for all Routa settings: - Providers (default agent provi |
| Settings / Agents | `/settings/agents` | `src/app/settings/agents/page.tsx` | Settings page for installing, discovering, and managing ACP-compatible agent run |
| Settings / Fitness | `/settings/fitness` | `src/app/settings/fitness/page.tsx` | Compatibility route that forwards fitness configuration requests to the fluency  |
| Settings / Fluency | `/settings/fluency` | `src/app/settings/fluency/page.tsx` | Settings page for repository fluency analysis, fitness snapshots, and harnessabi |
| Settings / Harness | `/settings/harness` | `src/app/settings/harness/page.tsx` | Settings entry for the harness console, including repository signals, design dec |
| Settings / Mcp | `/settings/mcp` | `src/app/settings/mcp/page.tsx` | Settings page for managing MCP servers, tools, and transport-level configuration |
| Settings / Schedules | `/settings/schedules` | `src/app/settings/schedules/page.tsx` | Workspace-aware schedule management page for triggers, recurring runs, and sched |
| Settings / Specialists | `/settings/specialists` | `src/app/settings/specialists/page.tsx` | Settings page for configuring specialist personas, bindings, and model-aware spe |
| Settings / Webhooks | `/settings/webhooks` | `src/app/settings/webhooks/page.tsx` | Settings page for configuring GitHub webhook ingestion and inspecting the webhoo |
| Settings / Workflows | `/settings/workflows` | `src/app/settings/workflows/page.tsx` | Settings page for defining reusable workflows and reviewing workflow-focused exe |
| Trace Page | `/traces` | `src/app/traces/page.tsx` | Full-page view for browsing and analyzing Agent Trace records |
| Workspace Page (Server Component Wrapper) | `/workspace/:workspaceId` | `src/app/workspace/[workspaceId]/page.tsx` | This server component provides generateStaticParams for static export and redire |
| Codebases / Reposlide | `/workspace/:workspaceId/codebases/:codebaseId/reposlide` | `src/app/workspace/[workspaceId]/codebases/[codebaseId]/reposlide/page.tsx` | Workspace-scoped RepoSlide surface for generating and reviewing presentation out |
| Workspace / Feature Explorer | `/workspace/:workspaceId/feature-explorer` | `src/app/workspace/[workspaceId]/feature-explorer/page.tsx` |  |
| Workspace / Kanban | `/workspace/:workspaceId/kanban` | `src/app/workspace/[workspaceId]/kanban/page.tsx` | Main kanban board for workspace-scoped task coordination, lane automation, and g |
| Workspace / Overview | `/workspace/:workspaceId/overview` | `src/app/workspace/[workspaceId]/overview/page.tsx` | Workspace entry route that currently redirects to the sessions surface while pre |
| Workspace / Sessions | `/workspace/:workspaceId/sessions` | `src/app/workspace/[workspaceId]/sessions/page.tsx` | Workspace-scoped session index for browsing, filtering, and opening agent execut |
| Workspace Session Page (Server Component Wrapper) | `/workspace/:workspaceId/sessions/:sessionId` | `src/app/workspace/[workspaceId]/sessions/[sessionId]/page.tsx` | This server component provides generateStaticParams for static export and render |
| Workspace / Spec | `/workspace/:workspaceId/spec` | `src/app/workspace/[workspaceId]/spec/page.tsx` | Dense issue relationship board for local docs/issues records |
| Workspace / Team | `/workspace/:workspaceId/team` | `src/app/workspace/[workspaceId]/team/page.tsx` | Workspace-scoped team run index for multi-agent collaboration and coordination h |
| Workspace / Team | `/workspace/:workspaceId/team/:sessionId` | `src/app/workspace/[workspaceId]/team/[sessionId]/page.tsx` | Detail page for inspecting a specific workspace team run and its coordinated ses |

---

## API Contract Endpoints

### A2a (8)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/a2a/card` | A2A agent card | `src/app/api/a2a/card/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| POST | `/api/a2a/message` | Send a message via the A2A protocol | `src/app/api/a2a/message/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| GET | `/api/a2a/rpc` | A2A SSE stream | `src/app/api/a2a/rpc/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| POST | `/api/a2a/rpc` | A2A JSON-RPC | `src/app/api/a2a/rpc/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| GET | `/api/a2a/sessions` | List A2A sessions | `src/app/api/a2a/sessions/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| GET | `/api/a2a/tasks` | List A2A tasks | `src/app/api/a2a/tasks/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| GET | `/api/a2a/tasks/{id}` | Get an A2A task by ID | `src/app/api/a2a/tasks/[id]/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| POST | `/api/a2a/tasks/{id}` | Update / respond to an A2A task | `src/app/api/a2a/tasks/[id]/route.ts` | `crates/routa-server/src/api/a2a.rs` |

### A2ui (2)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/a2ui/dashboard` | Get A2UI v0.10 dashboard data | `src/app/api/a2ui/dashboard/route.ts` | `crates/routa-server/src/api/a2ui.rs` |
| POST | `/api/a2ui/dashboard` | Add custom A2UI messages to the dashboard | `src/app/api/a2ui/dashboard/route.ts` | `crates/routa-server/src/api/a2ui.rs` |

### Acp (15)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/acp` | ACP SSE stream | `src/app/api/acp/route.ts` | `crates/routa-server/src/api/acp_routes.rs` |
| POST | `/api/acp` | ACP JSON-RPC endpoint | `src/app/api/acp/route.ts` | `crates/routa-server/src/api/acp_routes.rs` |
| POST | `/api/acp/docker/container/start` | Start a Docker container for OpenCode agent | `src/app/api/acp/docker/container/start/route.ts` | `crates/routa-server/src/api/acp_docker.rs` |
| POST | `/api/acp/docker/container/stop` | Stop a Docker container | `src/app/api/acp/docker/container/stop/route.ts` | `crates/routa-server/src/api/acp_docker.rs` |
| GET | `/api/acp/docker/containers` | List Docker containers for OpenCode agents | `src/app/api/acp/docker/containers/route.ts` | `crates/routa-server/src/api/acp_docker.rs` |
| POST | `/api/acp/docker/pull` | Pull a Docker image | `src/app/api/acp/docker/pull/route.ts` | `crates/routa-server/src/api/acp_docker.rs` |
| GET | `/api/acp/docker/status` | Get Docker daemon status | `src/app/api/acp/docker/status/route.ts` | `crates/routa-server/src/api/acp_docker.rs` |
| DELETE | `/api/acp/install` | Uninstall an ACP agent | `src/app/api/acp/install/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| POST | `/api/acp/install` | Install an ACP agent | `src/app/api/acp/install/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| GET | `/api/acp/registry` | List agents in the ACP registry | `src/app/api/acp/registry/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| POST | `/api/acp/registry` | Register an agent in the ACP registry | `src/app/api/acp/registry/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| GET | `/api/acp/runtime` | Get ACP runtime status | `src/app/api/acp/runtime/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| POST | `/api/acp/runtime` | Start ACP runtime | `src/app/api/acp/runtime/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| GET | `/api/acp/warmup` | Get ACP warmup status | `src/app/api/acp/warmup/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| POST | `/api/acp/warmup` | Trigger ACP warmup | `src/app/api/acp/warmup/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |

### Ag-Ui (1)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| POST | `/api/ag-ui` | Process AG-UI protocol request (SSE stream) | `src/app/api/ag-ui/route.ts` | `crates/routa-server/src/api/ag_ui.rs` |

### Agents (5)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/agents` | List agents (or get single by id query param) | `src/app/api/agents/route.ts` | `crates/routa-server/src/api/agents.rs` |
| POST | `/api/agents` | Create a new agent | `src/app/api/agents/route.ts` | `crates/routa-server/src/api/agents.rs` |
| DELETE | `/api/agents/{id}` | Delete an agent | `src/app/api/agents/[id]/route.ts` | `crates/routa-server/src/api/agents.rs` |
| GET | `/api/agents/{id}` | Get agent by ID (REST-style path param) | `src/app/api/agents/[id]/route.ts` | `crates/routa-server/src/api/agents.rs` |
| POST | `/api/agents/{id}/status` | Update agent status | `src/app/api/agents/[id]/status/route.ts` | `crates/routa-server/src/api/agents.rs` |

### Background-Tasks (7)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/background-tasks` | List background tasks | `src/app/api/background-tasks/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |
| POST | `/api/background-tasks` | Create a background task | `src/app/api/background-tasks/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |
| DELETE | `/api/background-tasks/{id}` | Cancel a background task | `src/app/api/background-tasks/[id]/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |
| GET | `/api/background-tasks/{id}` | Get a background task by ID | `src/app/api/background-tasks/[id]/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |
| PATCH | `/api/background-tasks/{id}` | Update a background task (PENDING only) | `src/app/api/background-tasks/[id]/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |
| POST | `/api/background-tasks/{id}/retry` | Retry a failed background task | `src/app/api/background-tasks/[id]/retry/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |
| POST | `/api/background-tasks/process` | Process the next pending background task | `src/app/api/background-tasks/process/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |

### Clone (9)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/clone` | List cloned repositories |
| POST | `/api/clone` | Clone a GitHub repository |
| PATCH | `/api/clone` | Switch branch on cloned repo |
| POST | `/api/clone/progress` | Clone with SSE progress |
| POST | `/api/clone/local` | Load an existing local git repository |
| GET | `/api/clone/branches` | Get branch info |
| POST | `/api/clone/branches` | Fetch remote branches |
| PATCH | `/api/clone/branches` | Checkout branch |
| DELETE | `/api/clone/branches` | Delete local branch |

### Codebases (3)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/codebases/{id}` | Delete a codebase | `src/app/api/codebases/[codebaseId]/route.ts` | `crates/routa-server/src/api/codebases.rs` |
| PATCH | `/api/codebases/{id}` | Update codebase metadata | `src/app/api/codebases/[codebaseId]/route.ts` | `crates/routa-server/src/api/codebases.rs` |
| POST | `/api/codebases/{id}/default` | Set a codebase as the default | `src/app/api/codebases/[codebaseId]/default/route.ts` | `crates/routa-server/src/api/codebases.rs` |

### Debug (1)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/debug/path` | Debug endpoint — returns resolved binary paths (desktop only) | `src/app/api/debug/path/route.ts` | `crates/routa-server/src/api/debug.rs` |

### Files (1)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/files/search` | Search files in a codebase | `src/app/api/files/search/route.ts` | `crates/routa-server/src/api/files.rs` |

### Fitness (5)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/fitness/architecture` | Get backend architecture quality report for a repo context |
| POST | `/api/fitness/analyze` | Run harness fluency analysis and return the additive harnessability baseline for one or more profiles |
| GET | `/api/fitness/plan` | Build the executable fitness plan for a repository context |
| GET | `/api/fitness/report` | Read persisted harness fluency snapshots and their additive harnessability baseline payloads |
| GET | `/api/fitness/specs` | Inspect docs/fitness source files and parsed metric metadata |

### GitHub (8)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/github` | List active GitHub virtual workspaces |
| POST | `/api/github/import` | Import a GitHub repo as a virtual workspace (zipball download) |
| GET | `/api/github/issues` | List GitHub issues for a workspace codebase |
| GET | `/api/github/pulls` | List GitHub pull requests for a workspace codebase |
| GET | `/api/github/tree` | Get file tree for an imported GitHub repo |
| GET | `/api/github/file` | Read a file from an imported GitHub repo |
| GET | `/api/github/search` | Search files in an imported GitHub repo |
| POST | `/api/github/pr-comment` | Post a comment on a GitHub pull request |

### Graph (1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/graph/analyze` | Analyze repository dependency graph and return graph data |

### Harness (13)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/harness/templates` | List harness templates for a repo context |
| GET | `/api/harness/templates/validate` | Validate a harness template for a repo context |
| GET | `/api/harness/templates/doctor` | Run harness template diagnostics for a repo context |
| GET | `/api/harness/github-actions` | Inspect repository GitHub Actions workflow files |
| GET | `/api/harness/agent-hooks` | Read and validate agent hook lifecycle configuration |
| GET | `/api/harness/hooks` | Inspect hook runtime profiles, bound hook files, and resolved metrics |
| GET | `/api/harness/hooks/preview` | Run hook runtime preview for a configured profile |
| GET | `/api/harness/instructions` | Read repository guidance documents used by harness views |
| GET | `/api/harness/codeowners` | Parse CODEOWNERS and report ownership coverage for the selected repository |
| GET | `/api/harness/repo-signals` | Detect YAML-driven build and test harness surfaces for the selected repository |
| GET | `/api/harness/automations` | Inspect repo-defined automation definitions, pending findings, and runtime schedule state |
| GET | `/api/harness/spec-sources` | Detect specification and planning source systems for the selected repository |
| GET | `/api/harness/design-decisions` | Detect architecture and ADR design decision sources for the selected repository |

### Health (1)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/health` | Health check — returns service status | `src/app/api/health/route.ts` | `crates/routa-server/src/lib.rs` |

### Kanban (8)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/kanban/boards` | List Kanban boards for a workspace | `src/app/api/kanban/boards/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| POST | `/api/kanban/boards` | Create a Kanban board | `src/app/api/kanban/boards/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| GET | `/api/kanban/boards/{boardId}` | Get a Kanban board by ID | `src/app/api/kanban/boards/[boardId]/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| PATCH | `/api/kanban/boards/{boardId}` | Update a Kanban board | `src/app/api/kanban/boards/[boardId]/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| POST | `/api/kanban/decompose` | Decompose natural language input into multiple Kanban tasks | `src/app/api/kanban/decompose/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| GET | `/api/kanban/events` | Stream kanban workspace events over SSE | `src/app/api/kanban/events/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| GET | `/api/kanban/export` | Export kanban boards as YAML | `src/app/api/kanban/export/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| POST | `/api/kanban/import` | Import kanban boards from YAML | `src/app/api/kanban/import/route.ts` | `crates/routa-server/src/api/kanban.rs` |

### Mcp (6)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/mcp` | Terminate MCP session | `src/app/api/mcp/route.ts` | `crates/routa-server/src/api/mcp_routes.rs`, `crates/routa-server/src/api/mcp_routes/rmcp_service.rs`, `crates/routa-server/src/api/mcp_routes/tool_catalog.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/agents_tasks.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/delegation.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/events_kanban.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/notes_workspace.rs` |
| GET | `/api/mcp` | MCP SSE stream | `src/app/api/mcp/route.ts` | `crates/routa-server/src/api/mcp_routes.rs`, `crates/routa-server/src/api/mcp_routes/rmcp_service.rs`, `crates/routa-server/src/api/mcp_routes/tool_catalog.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/agents_tasks.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/delegation.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/events_kanban.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/notes_workspace.rs` |
| POST | `/api/mcp` | MCP Streamable HTTP (JSON-RPC) | `src/app/api/mcp/route.ts` | `crates/routa-server/src/api/mcp_routes.rs`, `crates/routa-server/src/api/mcp_routes/rmcp_service.rs`, `crates/routa-server/src/api/mcp_routes/tool_catalog.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/agents_tasks.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/delegation.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/events_kanban.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/notes_workspace.rs` |
| GET | `/api/mcp/tools` | List MCP tools | `src/app/api/mcp/tools/route.ts` | `crates/routa-server/src/api/mcp_tools.rs` |
| PATCH | `/api/mcp/tools` | Update MCP tool configuration | `src/app/api/mcp/tools/route.ts` | `crates/routa-server/src/api/mcp_tools.rs` |
| POST | `/api/mcp/tools` | Execute an MCP tool | `src/app/api/mcp/tools/route.ts` | `crates/routa-server/src/api/mcp_tools.rs` |

### Mcp-Server (3)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/mcp-server` | Stop MCP server | `src/app/api/mcp-server/route.ts` | `crates/routa-server/src/api/mcp_server_mgmt.rs` |
| GET | `/api/mcp-server` | Get MCP server status | `src/app/api/mcp-server/route.ts` | `crates/routa-server/src/api/mcp_server_mgmt.rs` |
| POST | `/api/mcp-server` | Start MCP server | `src/app/api/mcp-server/route.ts` | `crates/routa-server/src/api/mcp_server_mgmt.rs` |

### Mcp-Servers (4)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/mcp-servers` | Delete a custom MCP server | `src/app/api/mcp-servers/route.ts` | `crates/routa-server/src/api/mcp_servers.rs` |
| GET | `/api/mcp-servers` | List custom MCP servers (or get single by id query param) | `src/app/api/mcp-servers/route.ts` | `crates/routa-server/src/api/mcp_servers.rs` |
| POST | `/api/mcp-servers` | Create a new custom MCP server | `src/app/api/mcp-servers/route.ts` | `crates/routa-server/src/api/mcp_servers.rs` |
| PUT | `/api/mcp-servers` | Update an existing custom MCP server | `src/app/api/mcp-servers/route.ts` | `crates/routa-server/src/api/mcp_servers.rs` |

### Memory (3)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/memory` | Delete memory entries | `src/app/api/memory/route.ts` | `crates/routa-server/src/api/memory.rs` |
| GET | `/api/memory` | List memory entries for a workspace | `src/app/api/memory/route.ts` | `crates/routa-server/src/api/memory.rs` |
| POST | `/api/memory` | Create a memory entry | `src/app/api/memory/route.ts` | `crates/routa-server/src/api/memory.rs` |

### Notes (6)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/notes` | Delete note by query params | `src/app/api/notes/route.ts` | `crates/routa-server/src/api/notes.rs` |
| GET | `/api/notes` | List notes or get single by noteId | `src/app/api/notes/route.ts` | `crates/routa-server/src/api/notes.rs` |
| POST | `/api/notes` | Create or update a note | `src/app/api/notes/route.ts` | `crates/routa-server/src/api/notes.rs` |
| DELETE | `/api/notes/{workspaceId}/{noteId}` | Delete note by path params | `src/app/api/notes/[workspaceId]/[noteId]/route.ts` | `crates/routa-server/src/api/notes.rs` |
| GET | `/api/notes/{workspaceId}/{noteId}` | Get note by workspace + note ID | `src/app/api/notes/[workspaceId]/[noteId]/route.ts` | `crates/routa-server/src/api/notes.rs` |
| GET | `/api/notes/events` | SSE stream for note change events | `src/app/api/notes/events/route.ts` | `crates/routa-server/src/api/notes.rs` |

### Polling (4)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/polling/check` | Run a polling check (GET) | `src/app/api/polling/check/route.ts` | `crates/routa-server/src/api/polling.rs` |
| POST | `/api/polling/check` | Run a polling check (POST) | `src/app/api/polling/check/route.ts` | `crates/routa-server/src/api/polling.rs` |
| GET | `/api/polling/config` | Get polling configuration | `src/app/api/polling/config/route.ts` | `crates/routa-server/src/api/polling.rs` |
| POST | `/api/polling/config` | Update polling configuration | `src/app/api/polling/config/route.ts` | `crates/routa-server/src/api/polling.rs` |

### Providers (2)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/providers` | List configured LLM providers | `src/app/api/providers/route.ts` | `crates/routa-server/src/api/providers.rs` |
| GET | `/api/providers/models` | List available models for configured providers | `src/app/api/providers/models/route.ts` | `crates/routa-server/src/api/provider_models.rs` |

### Review (1)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| POST | `/api/review/analyze` | Analyze a git diff with the single public PR Reviewer specialist | `src/app/api/review/analyze/route.ts` | `crates/routa-server/src/api/review.rs` |

### Rpc (2)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| POST | `/api/rpc` | Generic JSON-RPC endpoint | `src/app/api/rpc/route.ts` | `crates/routa-server/src/api/rpc.rs` |
| GET | `/api/rpc/methods` | List available RPC methods | `src/app/api/rpc/methods/route.ts` | `crates/routa-server/src/api/rpc.rs` |

### Sandboxes (8)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/sandboxes` | List all active sandbox containers | `src/app/api/sandboxes/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes` | Create a new sandbox container | `src/app/api/sandboxes/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| DELETE | `/api/sandboxes/{id}` | Stop and remove a sandbox container | `src/app/api/sandboxes/[id]/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| GET | `/api/sandboxes/{id}` | Get sandbox info by ID | `src/app/api/sandboxes/[id]/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes/{id}/execute` | Execute code in a sandbox and stream results as NDJSON | `src/app/api/sandboxes/[id]/execute/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes/{id}/permissions/apply` | Recreate a sandbox with permission constraints applied to its policy | `src/app/api/sandboxes/[id]/permissions/apply/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes/{id}/permissions/explain` | Preview the effective sandbox policy after applying permission constraints | `src/app/api/sandboxes/[id]/permissions/explain/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes/explain` | Resolve and explain an effective sandbox policy without creating a sandbox | `src/app/api/sandboxes/explain/route.ts` | `crates/routa-server/src/api/sandbox.rs` |

### Schedules (8)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/schedules` | List scheduled tasks | `src/app/api/schedules/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| POST | `/api/schedules` | Create a new schedule | `src/app/api/schedules/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| DELETE | `/api/schedules/{id}` | Delete a schedule | `src/app/api/schedules/[id]/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| GET | `/api/schedules/{id}` | Get a schedule by ID | `src/app/api/schedules/[id]/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| PATCH | `/api/schedules/{id}` | Update a schedule | `src/app/api/schedules/[id]/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| POST | `/api/schedules/{id}/run` | Trigger a schedule to run immediately | `src/app/api/schedules/[id]/run/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| GET | `/api/schedules/tick` | Get tick status for scheduled tasks | `src/app/api/schedules/tick/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| POST | `/api/schedules/tick` | Manually trigger the schedule tick | `src/app/api/schedules/tick/route.ts` | `crates/routa-server/src/api/schedules.rs` |

### Sessions (10)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/sessions` | List ACP sessions | `src/app/api/sessions/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| DELETE | `/api/sessions/{id}` | Delete a session | `src/app/api/sessions/[sessionId]/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{id}` | Get session by ID | `src/app/api/sessions/[sessionId]/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| PATCH | `/api/sessions/{id}` | Update session metadata | `src/app/api/sessions/[sessionId]/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| POST | `/api/sessions/{id}/disconnect` | Disconnect and kill an active session process | `src/app/api/sessions/[sessionId]/disconnect/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{id}/history` | Get message history for a session | `src/app/api/sessions/[sessionId]/history/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{id}/transcript` | Get preferred transcript payload for a session | `src/app/api/sessions/[sessionId]/transcript/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{sessionId}/context` | Get hierarchical context for a session | `src/app/api/sessions/[sessionId]/context/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{sessionId}/reposlide-result` | Read the RepoSlide result payload extracted from a session transcript | `src/app/api/sessions/[sessionId]/reposlide-result/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{sessionId}/reposlide-result/download` | Download the generated RepoSlide PPTX artifact for a completed session | `src/app/api/sessions/[sessionId]/reposlide-result/download/route.ts` | `crates/routa-server/src/api/sessions.rs` |

### Shared-Sessions (12)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/shared-sessions` | List shared sessions | `src/app/api/shared-sessions/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions` | Create a shared session | `src/app/api/shared-sessions/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| DELETE | `/api/shared-sessions/{sharedSessionId}` | Close a shared session | `src/app/api/shared-sessions/[sharedSessionId]/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| GET | `/api/shared-sessions/{sharedSessionId}` | Get a shared session with participants and approvals | `src/app/api/shared-sessions/[sharedSessionId]/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{sharedSessionId}/approvals/{approvalId}` | Approve or reject a pending shared session prompt | `src/app/api/shared-sessions/[sharedSessionId]/approvals/[approvalId]/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{sharedSessionId}/join` | Join a shared session | `src/app/api/shared-sessions/[sharedSessionId]/join/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{sharedSessionId}/leave` | Leave a shared session | `src/app/api/shared-sessions/[sharedSessionId]/leave/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| GET | `/api/shared-sessions/{sharedSessionId}/messages` | List shared session messages | `src/app/api/shared-sessions/[sharedSessionId]/messages/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{sharedSessionId}/messages` | Send a shared session message | `src/app/api/shared-sessions/[sharedSessionId]/messages/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| GET | `/api/shared-sessions/{sharedSessionId}/participants` | List shared session participants | `src/app/api/shared-sessions/[sharedSessionId]/participants/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{sharedSessionId}/prompts` | Send a shared session prompt | `src/app/api/shared-sessions/[sharedSessionId]/prompts/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| GET | `/api/shared-sessions/{sharedSessionId}/stream` | Stream shared session events over SSE | `src/app/api/shared-sessions/[sharedSessionId]/stream/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |

### Skills (7)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/skills` | List skills or get by name | `src/app/api/skills/route.ts` | `crates/routa-server/src/api/skills.rs` |
| POST | `/api/skills` | Reload skills from disk | `src/app/api/skills/route.ts` | `crates/routa-server/src/api/skills.rs` |
| GET | `/api/skills/catalog` | List available skills in the registry | `src/app/api/skills/catalog/route.ts` | `crates/routa-server/src/api/skills_catalog.rs` |
| POST | `/api/skills/catalog` | Refresh the local skill catalog from registry | `src/app/api/skills/catalog/route.ts` | `crates/routa-server/src/api/skills_catalog.rs` |
| GET | `/api/skills/clone` | Discover skills from repo path | `src/app/api/skills/clone/route.ts` | `crates/routa-server/src/api/skills_clone.rs` |
| POST | `/api/skills/clone` | Clone a skill repository | `src/app/api/skills/clone/route.ts` | `crates/routa-server/src/api/skills_clone.rs` |
| POST | `/api/skills/upload` | Upload skill as zip | `src/app/api/skills/upload/route.ts` | `crates/routa-server/src/api/skills_upload.rs` |

### Spec (3)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| POST | `/api/spec/feature-tree/generate` | Scan the repository and generate FEATURE_TREE.md + feature-tree.index.json | `src/app/api/spec/feature-tree/generate/route.ts` | `crates/routa-server/src/api/spec.rs` |
| GET | `/api/spec/issues` | List local issue specs | `src/app/api/spec/issues/route.ts` | `crates/routa-server/src/api/spec.rs` |
| GET | `/api/spec/surface-index` | Read the generated product surface index for spec analysis | `src/app/api/spec/surface-index/route.ts` | `crates/routa-server/src/api/spec.rs` |

### Specialists (4)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/specialists` | Delete a specialist | `src/app/api/specialists/route.ts` | `crates/routa-server/src/api/specialists.rs` |
| GET | `/api/specialists` | List configured specialist agents | `src/app/api/specialists/route.ts` | `crates/routa-server/src/api/specialists.rs` |
| POST | `/api/specialists` | Create a specialist configuration | `src/app/api/specialists/route.ts` | `crates/routa-server/src/api/specialists.rs` |
| PUT | `/api/specialists` | Update an existing specialist | `src/app/api/specialists/route.ts` | `crates/routa-server/src/api/specialists.rs` |

### Tasks (12)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List tasks |
| POST | `/api/tasks` | Create a task |
| DELETE | `/api/tasks` | Delete all tasks for a workspace |
| GET | `/api/tasks/{id}` | Get task by ID |
| PATCH | `/api/tasks/{id}` | Update a task |
| DELETE | `/api/tasks/{id}` | Delete a task |
| POST | `/api/tasks/{id}/status` | Update task status |
| GET | `/api/tasks/ready` | Find tasks with all dependencies satisfied |
| GET | `/api/tasks/{id}/artifacts` | List all artifacts for a task |
| POST | `/api/tasks/{id}/artifacts` | Attach an artifact to a task |
| GET | `/api/tasks/{id}/runs` | List normalized execution runs for a task |
| GET | `/api/tasks/{taskId}/changes` | Get repository or worktree changes associated with a task |

### Test-Mcp (1)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/test-mcp` | Test MCP config | `src/app/api/test-mcp/route.ts` | `crates/routa-server/src/api/test_mcp.rs` |

### Traces (4)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/traces` | List agent execution traces | `src/app/api/traces/route.ts` | `crates/routa-server/src/api/traces.rs` |
| GET | `/api/traces/{id}` | Get a single trace by ID | `src/app/api/traces/[id]/route.ts` | `crates/routa-server/src/api/traces.rs` |
| POST | `/api/traces/export` | Export trace records in Agent Trace JSON format | `src/app/api/traces/export/route.ts` | `crates/routa-server/src/api/traces.rs` |
| GET | `/api/traces/stats` | Get aggregated trace statistics | `src/app/api/traces/stats/route.ts` | `crates/routa-server/src/api/traces.rs` |

### Webhooks (10)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/webhooks/configs` | Delete a webhook configuration | `src/app/api/webhooks/configs/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| GET | `/api/webhooks/configs` | List webhook configurations | `src/app/api/webhooks/configs/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| POST | `/api/webhooks/configs` | Create a webhook configuration | `src/app/api/webhooks/configs/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| PUT | `/api/webhooks/configs` | Update a webhook configuration | `src/app/api/webhooks/configs/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| GET | `/api/webhooks/github` | List registered GitHub webhooks | `src/app/api/webhooks/github/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| POST | `/api/webhooks/github` | Handle an incoming GitHub webhook event | `src/app/api/webhooks/github/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| DELETE | `/api/webhooks/register` | Unregister a webhook | `src/app/api/webhooks/register/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| GET | `/api/webhooks/register` | List webhook registrations | `src/app/api/webhooks/register/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| POST | `/api/webhooks/register` | Register a new webhook | `src/app/api/webhooks/register/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| GET | `/api/webhooks/webhook-logs` | List webhook delivery logs | `src/app/api/webhooks/webhook-logs/route.ts` | `crates/routa-server/src/api/webhooks.rs` |

### Workflows (6)

| Method | Endpoint | Details | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/workflows` | List all workflow YAML definitions from resources/flows/ | `src/app/api/workflows/route.ts` | `crates/routa-server/src/api/workflows.rs` |
| POST | `/api/workflows` | Create a new workflow YAML file | `src/app/api/workflows/route.ts` | `crates/routa-server/src/api/workflows.rs` |
| DELETE | `/api/workflows/{id}` | Delete a workflow YAML file | `src/app/api/workflows/[id]/route.ts` | `crates/routa-server/src/api/workflows.rs` |
| GET | `/api/workflows/{id}` | Get a specific workflow by ID | `src/app/api/workflows/[id]/route.ts` | `crates/routa-server/src/api/workflows.rs` |
| PUT | `/api/workflows/{id}` | Update a workflow YAML file | `src/app/api/workflows/[id]/route.ts` | `crates/routa-server/src/api/workflows.rs` |
| POST | `/api/workflows/{id}/trigger` | Trigger a workflow run inside a workspace | `src/app/api/workflows/[id]/trigger/route.ts` | `crates/routa-server/src/api/workflows.rs` |

### Workspaces (13)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workspaces` | List all workspaces |
| POST | `/api/workspaces` | Create a workspace |
| GET | `/api/workspaces/{id}` | Get workspace by ID |
| PATCH | `/api/workspaces/{id}` | Update workspace (title, repoPath, branch, status, metadata) |
| DELETE | `/api/workspaces/{id}` | Delete workspace |
| POST | `/api/workspaces/{id}/archive` | Archive or unarchive a workspace |
| GET | `/api/workspaces/{id}/codebases` | List codebases in a workspace |
| POST | `/api/workspaces/{id}/codebases` | Add a codebase to a workspace |
| GET | `/api/workspaces/{id}/codebases/changes` | List git change summaries for workspace codebases |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/reposlide` | Get RepoSlide launch context for an agent-driven deck generation session |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/wiki` | Generate an architecture-aware RepoWiki summary payload for a codebase |
| GET | `/api/workspaces/{workspace_id}/codebases/{codebase_id}/worktrees` | List worktrees for a codebase |
| POST | `/api/workspaces/{workspace_id}/codebases/{codebase_id}/worktrees` | Create a new git worktree |

### Worktrees (3)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/worktrees/{id}` | Get a single worktree |
| DELETE | `/api/worktrees/{id}` | Remove a worktree |
| POST | `/api/worktrees/{id}/validate` | Validate worktree health on disk |

