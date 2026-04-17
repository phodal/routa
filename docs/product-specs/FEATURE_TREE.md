---
status: generated
purpose: Auto-generated route and API surface index for Routa.js.
sources:
  - src/app/**/page.tsx
  - api-contract.yaml
  - src/app/api/**/route.ts
  - crates/routa-server/src/api/**/*.rs
update_policy:
  - "Regenerate with `node --import tsx scripts/docs/feature-tree-generator.ts --save`."
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
        - workspace
        - codebase
        - note
        - activity
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
        - GET /api/feature-explorer/{featureId}/files
        - GET /api/feature-explorer/{featureId}/apis
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
        - GET /api/sessions
        - GET /api/sessions/{id}
        - GET /api/sessions/{sessionId}/context
      domain_objects:
        - workspace
        - session
        - trace
      related_features:
        - workspace-overview
        - team-runs
      source_files:
        - crates/routa-server/src/api/sessions.rs
        - src/app/api/sessions/[sessionId]/context/route.ts
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
        - POST /api/kanban/boards
        - GET /api/kanban/events
      domain_objects:
        - workspace
        - board
        - task
        - workflow
      related_features:
        - session-recovery
      source_files:
        - crates/routa-server/src/api/kanban.rs
        - src/app/api/kanban/boards/route.ts
        - src/app/api/kanban/events/route.ts
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
        - workspace
        - team-run
        - session
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
        - GET /api/harness/repo-signals
        - GET /api/harness/design-decisions
        - GET /api/fitness/runtime
      domain_objects:
        - harness
        - spec
        - fitness
      source_files:
        - crates/routa-server/src/api/fitness.rs
        - crates/routa-server/src/api/harness.rs
        - src/app/api/fitness/runtime/route.ts
        - src/app/api/harness/design-decisions/route.ts
        - src/app/api/harness/repo-signals/route.ts
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

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/a2a/card` | A2A agent card |
| POST | `/api/a2a/message` | Send a message via the A2A protocol |
| GET | `/api/a2a/rpc` | A2A SSE stream |
| POST | `/api/a2a/rpc` | A2A JSON-RPC |
| GET | `/api/a2a/sessions` | List A2A sessions |
| GET | `/api/a2a/tasks` | List A2A tasks |
| GET | `/api/a2a/tasks/{id}` | Get an A2A task by ID |
| POST | `/api/a2a/tasks/{id}` | Update / respond to an A2A task |

### A2ui (2)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/a2ui/dashboard` | Get A2UI v0.10 dashboard data |
| POST | `/api/a2ui/dashboard` | Add custom A2UI messages to the dashboard |

### Acp (15)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/acp` | ACP SSE stream |
| POST | `/api/acp` | ACP JSON-RPC endpoint |
| POST | `/api/acp/docker/container/start` | Start a Docker container for OpenCode agent |
| POST | `/api/acp/docker/container/stop` | Stop a Docker container |
| GET | `/api/acp/docker/containers` | List Docker containers for OpenCode agents |
| POST | `/api/acp/docker/pull` | Pull a Docker image |
| GET | `/api/acp/docker/status` | Get Docker daemon status |
| DELETE | `/api/acp/install` | Uninstall an ACP agent |
| POST | `/api/acp/install` | Install an ACP agent |
| GET | `/api/acp/registry` | List agents in the ACP registry |
| POST | `/api/acp/registry` | Register an agent in the ACP registry |
| GET | `/api/acp/runtime` | Get ACP runtime status |
| POST | `/api/acp/runtime` | Start ACP runtime |
| GET | `/api/acp/warmup` | Get ACP warmup status |
| POST | `/api/acp/warmup` | Trigger ACP warmup |

### Ag-Ui (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| POST | `/api/ag-ui` | Process AG-UI protocol request (SSE stream) |

### Agents (5)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/agents` | List agents (or get single by id query param) |
| POST | `/api/agents` | Create a new agent |
| DELETE | `/api/agents/{id}` | Delete an agent |
| GET | `/api/agents/{id}` | Get agent by ID (REST-style path param) |
| POST | `/api/agents/{id}/status` | Update agent status |

### Background-Tasks (7)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/background-tasks` | List background tasks |
| POST | `/api/background-tasks` | Create a background task |
| DELETE | `/api/background-tasks/{id}` | Cancel a background task |
| GET | `/api/background-tasks/{id}` | Get a background task by ID |
| PATCH | `/api/background-tasks/{id}` | Update a background task (PENDING only) |
| POST | `/api/background-tasks/{id}/retry` | Retry a failed background task |
| POST | `/api/background-tasks/process` | Process the next pending background task |

### Canvas (5)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/canvas` | List canvas artifacts for a workspace |
| POST | `/api/canvas` | Create a canvas artifact |
| DELETE | `/api/canvas/{id}` | Delete a canvas artifact |
| GET | `/api/canvas/{id}` | Fetch a canvas artifact by ID |
| POST | `/api/canvas/specialist` | Generate a canvas artifact directly from a specialist prompt |

### Clone (9)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/clone` | List cloned repositories |
| PATCH | `/api/clone` | Switch branch on cloned repo |
| POST | `/api/clone` | Clone a GitHub repository |
| DELETE | `/api/clone/branches` | Delete local branch |
| GET | `/api/clone/branches` | Get branch info |
| PATCH | `/api/clone/branches` | Checkout branch |
| POST | `/api/clone/branches` | Fetch remote branches |
| POST | `/api/clone/local` | Load an existing local git repository |
| POST | `/api/clone/progress` | Clone with SSE progress |

### Codebases (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/codebases/{id}` | Delete a codebase |
| PATCH | `/api/codebases/{id}` | Update codebase metadata |
| POST | `/api/codebases/{id}/default` | Set a codebase as the default |

### Debug (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/debug/path` | Debug endpoint — returns resolved binary paths (desktop only) |

### Files (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/files/search` | Search files in a codebase |

### Fitness (6)

| Method | Endpoint | Details |
|--------|----------|---------|
| POST | `/api/fitness/analyze` | Run harness fluency analysis and return the additive harnessability baseline for one or more profiles |
| GET | `/api/fitness/architecture` | Get backend architecture quality report for a repo context |
| GET | `/api/fitness/plan` | Build the executable fitness plan for a repository context |
| GET | `/api/fitness/report` | Read persisted harness fluency snapshots and their additive harnessability baseline payloads |
| GET | `/api/fitness/runtime` | Read latest Entrix runtime fitness status and artifact summary for a repository context |
| GET | `/api/fitness/specs` | Inspect docs/fitness source files and parsed metric metadata |

### Git (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/git/commit` | Get git commit metadata and changed files |
| GET | `/api/git/log` | List git commit history for a local repository |
| GET | `/api/git/refs` | List git refs for a local repository |

### Github (8)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/github` | List active GitHub virtual workspaces |
| GET | `/api/github/file` | Read a file from an imported GitHub repo |
| POST | `/api/github/import` | Import a GitHub repo as a virtual workspace (zipball download) |
| GET | `/api/github/issues` | List GitHub issues for a workspace codebase |
| POST | `/api/github/pr-comment` | Post a comment on a GitHub pull request |
| GET | `/api/github/pulls` | List GitHub pull requests for a workspace codebase |
| GET | `/api/github/search` | Search files in an imported GitHub repo |
| GET | `/api/github/tree` | Get file tree for an imported GitHub repo |

### Graph (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/graph/analyze` | Analyze repository module dependencies and return a graph snapshot |

### Harness (13)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/harness/agent-hooks` | Read and validate agent hook lifecycle configuration |
| GET | `/api/harness/automations` | Inspect repo-defined automation definitions, pending findings, and runtime schedule state |
| GET | `/api/harness/codeowners` | Parse CODEOWNERS and report ownership coverage for the selected repository |
| GET | `/api/harness/design-decisions` | Detect architecture and ADR design decision sources for the selected repository |
| GET | `/api/harness/github-actions` | Inspect repository GitHub Actions workflow files |
| GET | `/api/harness/hooks` | Inspect hook runtime profiles, bound hook files, and resolved metrics |
| GET | `/api/harness/hooks/preview` | Run hook runtime preview for a configured profile |
| GET | `/api/harness/instructions` | Read repository guidance documents used by harness views |
| GET | `/api/harness/repo-signals` | Detect YAML-driven build and test harness surfaces for the selected repository |
| GET | `/api/harness/spec-sources` | Detect specification and planning source systems for the selected repository |
| GET | `/api/harness/templates` | List harness templates for a repo context |
| GET | `/api/harness/templates/doctor` | Run harness template diagnostics for a repo context |
| GET | `/api/harness/templates/validate` | Validate a harness template for a repo context |

### Health (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/health` | Health check — returns service status |

### Kanban (8)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/kanban/boards` | List Kanban boards for a workspace |
| POST | `/api/kanban/boards` | Create a Kanban board |
| GET | `/api/kanban/boards/{boardId}` | Get a Kanban board by ID |
| PATCH | `/api/kanban/boards/{boardId}` | Update a Kanban board |
| POST | `/api/kanban/decompose` | Decompose natural language input into multiple Kanban tasks |
| GET | `/api/kanban/events` | Stream kanban workspace events over SSE |
| GET | `/api/kanban/export` | Export kanban boards as YAML |
| POST | `/api/kanban/import` | Import kanban boards from YAML |

### Mcp (6)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/mcp` | Terminate MCP session |
| GET | `/api/mcp` | MCP SSE stream |
| POST | `/api/mcp` | MCP Streamable HTTP (JSON-RPC) |
| GET | `/api/mcp/tools` | List MCP tools |
| PATCH | `/api/mcp/tools` | Update MCP tool configuration |
| POST | `/api/mcp/tools` | Execute an MCP tool |

### Mcp-Server (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/mcp-server` | Stop MCP server |
| GET | `/api/mcp-server` | Get MCP server status |
| POST | `/api/mcp-server` | Start MCP server |

### Mcp-Servers (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/mcp-servers` | Delete a custom MCP server |
| GET | `/api/mcp-servers` | List custom MCP servers (or get single by id query param) |
| POST | `/api/mcp-servers` | Create a new custom MCP server |
| PUT | `/api/mcp-servers` | Update an existing custom MCP server |

### Memory (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/memory` | Delete memory entries |
| GET | `/api/memory` | List memory entries for a workspace |
| POST | `/api/memory` | Create a memory entry |

### Notes (6)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/notes` | Delete note by query params |
| GET | `/api/notes` | List notes or get single by noteId |
| POST | `/api/notes` | Create or update a note |
| DELETE | `/api/notes/{workspaceId}/{noteId}` | Delete note by path params |
| GET | `/api/notes/{workspaceId}/{noteId}` | Get note by workspace + note ID |
| GET | `/api/notes/events` | SSE stream for note change events |

### Polling (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/polling/check` | Run a polling check (GET) |
| POST | `/api/polling/check` | Run a polling check (POST) |
| GET | `/api/polling/config` | Get polling configuration |
| POST | `/api/polling/config` | Update polling configuration |

### Providers (2)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/providers` | List configured LLM providers |
| GET | `/api/providers/models` | List available models for configured providers |

### Review (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| POST | `/api/review/analyze` | Analyze a git diff with the single public PR Reviewer specialist |

### Rpc (2)

| Method | Endpoint | Details |
|--------|----------|---------|
| POST | `/api/rpc` | Generic JSON-RPC endpoint |
| GET | `/api/rpc/methods` | List available RPC methods |

### Sandboxes (8)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/sandboxes` | List all active sandbox containers |
| POST | `/api/sandboxes` | Create a new sandbox container |
| DELETE | `/api/sandboxes/{id}` | Stop and remove a sandbox container |
| GET | `/api/sandboxes/{id}` | Get sandbox info by ID |
| POST | `/api/sandboxes/{id}/execute` | Execute code in a sandbox and stream results as NDJSON |
| POST | `/api/sandboxes/{id}/permissions/apply` | Recreate a sandbox with permission constraints applied to its policy |
| POST | `/api/sandboxes/{id}/permissions/explain` | Preview the effective sandbox policy after applying permission constraints |
| POST | `/api/sandboxes/explain` | Resolve and explain an effective sandbox policy without creating a sandbox |

### Schedules (8)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/schedules` | List scheduled tasks |
| POST | `/api/schedules` | Create a new schedule |
| DELETE | `/api/schedules/{id}` | Delete a schedule |
| GET | `/api/schedules/{id}` | Get a schedule by ID |
| PATCH | `/api/schedules/{id}` | Update a schedule |
| POST | `/api/schedules/{id}/run` | Trigger a schedule to run immediately |
| GET | `/api/schedules/tick` | Get tick status for scheduled tasks |
| POST | `/api/schedules/tick` | Manually trigger the schedule tick |

### Sessions (10)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/sessions` | List ACP sessions |
| DELETE | `/api/sessions/{id}` | Delete a session |
| GET | `/api/sessions/{id}` | Get session by ID |
| PATCH | `/api/sessions/{id}` | Update session metadata |
| POST | `/api/sessions/{id}/disconnect` | Disconnect and kill an active session process |
| GET | `/api/sessions/{id}/history` | Get message history for a session |
| GET | `/api/sessions/{id}/transcript` | Get preferred transcript payload for a session |
| GET | `/api/sessions/{sessionId}/context` | Get hierarchical context for a session |
| GET | `/api/sessions/{sessionId}/reposlide-result` | Read the RepoSlide result payload extracted from a session transcript |
| GET | `/api/sessions/{sessionId}/reposlide-result/download` | Download the generated RepoSlide PPTX artifact for a completed session |

### Shared-Sessions (12)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/shared-sessions` | List shared sessions |
| POST | `/api/shared-sessions` | Create a shared session |
| DELETE | `/api/shared-sessions/{sharedSessionId}` | Close a shared session |
| GET | `/api/shared-sessions/{sharedSessionId}` | Get a shared session with participants and approvals |
| POST | `/api/shared-sessions/{sharedSessionId}/approvals/{approvalId}` | Approve or reject a pending shared session prompt |
| POST | `/api/shared-sessions/{sharedSessionId}/join` | Join a shared session |
| POST | `/api/shared-sessions/{sharedSessionId}/leave` | Leave a shared session |
| GET | `/api/shared-sessions/{sharedSessionId}/messages` | List shared session messages |
| POST | `/api/shared-sessions/{sharedSessionId}/messages` | Send a shared session message |
| GET | `/api/shared-sessions/{sharedSessionId}/participants` | List shared session participants |
| POST | `/api/shared-sessions/{sharedSessionId}/prompts` | Send a shared session prompt |
| GET | `/api/shared-sessions/{sharedSessionId}/stream` | Stream shared session events over SSE |

### Skills (7)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/skills` | List skills or get by name |
| POST | `/api/skills` | Reload skills from disk |
| GET | `/api/skills/catalog` | List available skills in the registry |
| POST | `/api/skills/catalog` | Refresh the local skill catalog from registry |
| GET | `/api/skills/clone` | Discover skills from repo path |
| POST | `/api/skills/clone` | Clone a skill repository |
| POST | `/api/skills/upload` | Upload skill as zip |

### Spec (2)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/spec/issues` | List local issue specs |
| GET | `/api/spec/surface-index` | Read the generated product surface index for spec analysis |

### Specialists (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/specialists` | Delete a specialist |
| GET | `/api/specialists` | List configured specialist agents |
| POST | `/api/specialists` | Create a specialist configuration |
| PUT | `/api/specialists` | Update an existing specialist |

### Tasks (15)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/tasks` | Delete all tasks for a workspace |
| GET | `/api/tasks` | List tasks |
| POST | `/api/tasks` | Create a task |
| DELETE | `/api/tasks/{id}` | Delete a task |
| GET | `/api/tasks/{id}` | Get task by ID |
| PATCH | `/api/tasks/{id}` | Update a task |
| GET | `/api/tasks/{id}/artifacts` | List all artifacts for a task |
| POST | `/api/tasks/{id}/artifacts` | Attach an artifact to a task |
| GET | `/api/tasks/{id}/runs` | List normalized execution runs for a task |
| POST | `/api/tasks/{id}/status` | Update task status |
| GET | `/api/tasks/{taskId}/changes` | Get repository or worktree changes associated with a task |
| GET | `/api/tasks/{taskId}/changes/commit` | Get diff for a single commit associated with a task repository |
| GET | `/api/tasks/{taskId}/changes/file` | Get diff for a single changed file associated with a task |
| GET | `/api/tasks/{taskId}/changes/stats` | Get additions and deletions for a subset of changed files associated with a task |
| GET | `/api/tasks/ready` | Find tasks with all dependencies satisfied |

### Test-Mcp (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/test-mcp` | Test MCP config |

### Traces (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/traces` | List agent execution traces |
| GET | `/api/traces/{id}` | Get a single trace by ID |
| POST | `/api/traces/export` | Export trace records in Agent Trace JSON format |
| GET | `/api/traces/stats` | Get aggregated trace statistics |

### Webhooks (10)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/webhooks/configs` | Delete a webhook configuration |
| GET | `/api/webhooks/configs` | List webhook configurations |
| POST | `/api/webhooks/configs` | Create a webhook configuration |
| PUT | `/api/webhooks/configs` | Update a webhook configuration |
| GET | `/api/webhooks/github` | List registered GitHub webhooks |
| POST | `/api/webhooks/github` | Handle an incoming GitHub webhook event |
| DELETE | `/api/webhooks/register` | Unregister a webhook |
| GET | `/api/webhooks/register` | List webhook registrations |
| POST | `/api/webhooks/register` | Register a new webhook |
| GET | `/api/webhooks/webhook-logs` | List webhook delivery logs |

### Workflows (6)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/workflows` | List all workflow YAML definitions from resources/flows/ |
| POST | `/api/workflows` | Create a new workflow YAML file |
| DELETE | `/api/workflows/{id}` | Delete a workflow YAML file |
| GET | `/api/workflows/{id}` | Get a specific workflow by ID |
| PUT | `/api/workflows/{id}` | Update a workflow YAML file |
| POST | `/api/workflows/{id}/trigger` | Trigger a workflow run inside a workspace |

### Workspaces (14)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/workspaces` | List all workspaces |
| POST | `/api/workspaces` | Create a workspace |
| DELETE | `/api/workspaces/{id}` | Delete workspace |
| GET | `/api/workspaces/{id}` | Get workspace by ID |
| PATCH | `/api/workspaces/{id}` | Update workspace (title, repoPath, branch, status, metadata) |
| POST | `/api/workspaces/{id}/archive` | Archive or unarchive a workspace |
| GET | `/api/workspaces/{id}/codebases` | List codebases in a workspace |
| POST | `/api/workspaces/{id}/codebases` | Add a codebase to a workspace |
| GET | `/api/workspaces/{id}/codebases/changes` | List git change summaries for workspace codebases |
| GET | `/api/workspaces/{workspace_id}/codebases/{codebase_id}/worktrees` | List worktrees for a codebase |
| POST | `/api/workspaces/{workspace_id}/codebases/{codebase_id}/worktrees` | Create a new git worktree |
| DELETE | `/api/workspaces/{workspaceId}/codebases/{codebaseId}` | Delete a codebase from a workspace-scoped route |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/reposlide` | Get RepoSlide launch context for an agent-driven deck generation session |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/wiki` | Generate an architecture-aware RepoWiki summary payload for a codebase |

### Worktrees (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/worktrees/{id}` | Remove a worktree |
| GET | `/api/worktrees/{id}` | Get a single worktree |
| POST | `/api/worktrees/{id}/validate` | Validate worktree health on disk |

---

## Next.js API Routes

### A2a (8)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/a2a/card` | `src/app/api/a2a/card/route.ts` |
| POST | `/api/a2a/message` | `src/app/api/a2a/message/route.ts` |
| GET | `/api/a2a/rpc` | `src/app/api/a2a/rpc/route.ts` |
| POST | `/api/a2a/rpc` | `src/app/api/a2a/rpc/route.ts` |
| GET | `/api/a2a/sessions` | `src/app/api/a2a/sessions/route.ts` |
| GET | `/api/a2a/tasks` | `src/app/api/a2a/tasks/route.ts` |
| GET | `/api/a2a/tasks/{id}` | `src/app/api/a2a/tasks/[id]/route.ts` |
| POST | `/api/a2a/tasks/{id}` | `src/app/api/a2a/tasks/[id]/route.ts` |

### A2ui (2)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/a2ui/dashboard` | `src/app/api/a2ui/dashboard/route.ts` |
| POST | `/api/a2ui/dashboard` | `src/app/api/a2ui/dashboard/route.ts` |

### Acp (15)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/acp` | `src/app/api/acp/route.ts` |
| POST | `/api/acp` | `src/app/api/acp/route.ts` |
| POST | `/api/acp/docker/container/start` | `src/app/api/acp/docker/container/start/route.ts` |
| POST | `/api/acp/docker/container/stop` | `src/app/api/acp/docker/container/stop/route.ts` |
| GET | `/api/acp/docker/containers` | `src/app/api/acp/docker/containers/route.ts` |
| POST | `/api/acp/docker/pull` | `src/app/api/acp/docker/pull/route.ts` |
| GET | `/api/acp/docker/status` | `src/app/api/acp/docker/status/route.ts` |
| DELETE | `/api/acp/install` | `src/app/api/acp/install/route.ts` |
| POST | `/api/acp/install` | `src/app/api/acp/install/route.ts` |
| GET | `/api/acp/registry` | `src/app/api/acp/registry/route.ts` |
| POST | `/api/acp/registry` | `src/app/api/acp/registry/route.ts` |
| GET | `/api/acp/runtime` | `src/app/api/acp/runtime/route.ts` |
| POST | `/api/acp/runtime` | `src/app/api/acp/runtime/route.ts` |
| GET | `/api/acp/warmup` | `src/app/api/acp/warmup/route.ts` |
| POST | `/api/acp/warmup` | `src/app/api/acp/warmup/route.ts` |

### Ag-Ui (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| POST | `/api/ag-ui` | `src/app/api/ag-ui/route.ts` |

### Agents (5)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/agents` | `src/app/api/agents/route.ts` |
| POST | `/api/agents` | `src/app/api/agents/route.ts` |
| DELETE | `/api/agents/{id}` | `src/app/api/agents/[id]/route.ts` |
| GET | `/api/agents/{id}` | `src/app/api/agents/[id]/route.ts` |
| POST | `/api/agents/{id}/status` | `src/app/api/agents/[id]/status/route.ts` |

### Background-Tasks (7)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/background-tasks` | `src/app/api/background-tasks/route.ts` |
| POST | `/api/background-tasks` | `src/app/api/background-tasks/route.ts` |
| DELETE | `/api/background-tasks/{id}` | `src/app/api/background-tasks/[id]/route.ts` |
| GET | `/api/background-tasks/{id}` | `src/app/api/background-tasks/[id]/route.ts` |
| PATCH | `/api/background-tasks/{id}` | `src/app/api/background-tasks/[id]/route.ts` |
| POST | `/api/background-tasks/{id}/retry` | `src/app/api/background-tasks/[id]/retry/route.ts` |
| POST | `/api/background-tasks/process` | `src/app/api/background-tasks/process/route.ts` |

### Canvas (6)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/canvas` | `src/app/api/canvas/route.ts` |
| POST | `/api/canvas` | `src/app/api/canvas/route.ts` |
| DELETE | `/api/canvas/{id}` | `src/app/api/canvas/[id]/route.ts` |
| GET | `/api/canvas/{id}` | `src/app/api/canvas/[id]/route.ts` |
| POST | `/api/canvas/specialist` | `src/app/api/canvas/specialist/route.ts` |
| POST | `/api/canvas/specialist/materialize` | `src/app/api/canvas/specialist/materialize/route.ts` |

### Clone (9)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/clone` | `src/app/api/clone/route.ts` |
| PATCH | `/api/clone` | `src/app/api/clone/route.ts` |
| POST | `/api/clone` | `src/app/api/clone/route.ts` |
| DELETE | `/api/clone/branches` | `src/app/api/clone/branches/route.ts` |
| GET | `/api/clone/branches` | `src/app/api/clone/branches/route.ts` |
| PATCH | `/api/clone/branches` | `src/app/api/clone/branches/route.ts` |
| POST | `/api/clone/branches` | `src/app/api/clone/branches/route.ts` |
| POST | `/api/clone/local` | `src/app/api/clone/local/route.ts` |
| POST | `/api/clone/progress` | `src/app/api/clone/progress/route.ts` |

### Codebases (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/codebases/{codebaseId}` | `src/app/api/codebases/[codebaseId]/route.ts` |
| PATCH | `/api/codebases/{codebaseId}` | `src/app/api/codebases/[codebaseId]/route.ts` |
| POST | `/api/codebases/{codebaseId}/default` | `src/app/api/codebases/[codebaseId]/default/route.ts` |

### Debug (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/debug/path` | `src/app/api/debug/path/route.ts` |

### Feature-Explorer (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/feature-explorer` | `src/app/api/feature-explorer/route.ts` |
| GET | `/api/feature-explorer/{featureId}` | `src/app/api/feature-explorer/[featureId]/route.ts` |
| GET | `/api/feature-explorer/{featureId}/apis` | `src/app/api/feature-explorer/[featureId]/apis/route.ts` |
| GET | `/api/feature-explorer/{featureId}/files` | `src/app/api/feature-explorer/[featureId]/files/route.ts` |

### Files (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/files/search` | `src/app/api/files/search/route.ts` |

### Fitness (7)

| Method | Endpoint | Details |
|--------|----------|---------|
| POST | `/api/fitness/analyze` | `src/app/api/fitness/analyze/route.ts` |
| GET | `/api/fitness/architecture` | `src/app/api/fitness/architecture/route.ts` |
| GET | `/api/fitness/plan` | `src/app/api/fitness/plan/route.ts` |
| GET | `/api/fitness/report` | `src/app/api/fitness/report/route.ts` |
| POST | `/api/fitness/run` | `src/app/api/fitness/run/route.ts` |
| GET | `/api/fitness/runtime` | `src/app/api/fitness/runtime/route.ts` |
| GET | `/api/fitness/specs` | `src/app/api/fitness/specs/route.ts` |

### Git (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/git/commit` | `src/app/api/git/commit/route.ts` |
| GET | `/api/git/log` | `src/app/api/git/log/route.ts` |
| GET | `/api/git/refs` | `src/app/api/git/refs/route.ts` |

### Github (9)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/github` | `src/app/api/github/route.ts` |
| GET | `/api/github/access` | `src/app/api/github/access/route.ts` |
| GET | `/api/github/file` | `src/app/api/github/file/route.ts` |
| POST | `/api/github/import` | `src/app/api/github/import/route.ts` |
| GET | `/api/github/issues` | `src/app/api/github/issues/route.ts` |
| POST | `/api/github/pr-comment` | `src/app/api/github/pr-comment/route.ts` |
| GET | `/api/github/pulls` | `src/app/api/github/pulls/route.ts` |
| GET | `/api/github/search` | `src/app/api/github/search/route.ts` |
| GET | `/api/github/tree` | `src/app/api/github/tree/route.ts` |

### Graph (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/graph/analyze` | `src/app/api/graph/analyze/route.ts` |

### Harness (13)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/harness/agent-hooks` | `src/app/api/harness/agent-hooks/route.ts` |
| GET | `/api/harness/automations` | `src/app/api/harness/automations/route.ts` |
| GET | `/api/harness/codeowners` | `src/app/api/harness/codeowners/route.ts` |
| GET | `/api/harness/design-decisions` | `src/app/api/harness/design-decisions/route.ts` |
| GET | `/api/harness/github-actions` | `src/app/api/harness/github-actions/route.ts` |
| GET | `/api/harness/hooks` | `src/app/api/harness/hooks/route.ts` |
| GET | `/api/harness/hooks/preview` | `src/app/api/harness/hooks/preview/route.ts` |
| GET | `/api/harness/instructions` | `src/app/api/harness/instructions/route.ts` |
| GET | `/api/harness/repo-signals` | `src/app/api/harness/repo-signals/route.ts` |
| GET | `/api/harness/spec-sources` | `src/app/api/harness/spec-sources/route.ts` |
| GET | `/api/harness/templates` | `src/app/api/harness/templates/route.ts` |
| GET | `/api/harness/templates/doctor` | `src/app/api/harness/templates/doctor/route.ts` |
| GET | `/api/harness/templates/validate` | `src/app/api/harness/templates/validate/route.ts` |

### Health (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/health` | `src/app/api/health/route.ts` |

### Kanban (8)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/kanban/boards` | `src/app/api/kanban/boards/route.ts` |
| POST | `/api/kanban/boards` | `src/app/api/kanban/boards/route.ts` |
| GET | `/api/kanban/boards/{boardId}` | `src/app/api/kanban/boards/[boardId]/route.ts` |
| PATCH | `/api/kanban/boards/{boardId}` | `src/app/api/kanban/boards/[boardId]/route.ts` |
| POST | `/api/kanban/decompose` | `src/app/api/kanban/decompose/route.ts` |
| GET | `/api/kanban/events` | `src/app/api/kanban/events/route.ts` |
| GET | `/api/kanban/export` | `src/app/api/kanban/export/route.ts` |
| POST | `/api/kanban/import` | `src/app/api/kanban/import/route.ts` |

### Mcp (6)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/mcp` | `src/app/api/mcp/route.ts` |
| GET | `/api/mcp` | `src/app/api/mcp/route.ts` |
| POST | `/api/mcp` | `src/app/api/mcp/route.ts` |
| GET | `/api/mcp/tools` | `src/app/api/mcp/tools/route.ts` |
| PATCH | `/api/mcp/tools` | `src/app/api/mcp/tools/route.ts` |
| POST | `/api/mcp/tools` | `src/app/api/mcp/tools/route.ts` |

### Mcp-Server (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/mcp-server` | `src/app/api/mcp-server/route.ts` |
| GET | `/api/mcp-server` | `src/app/api/mcp-server/route.ts` |
| POST | `/api/mcp-server` | `src/app/api/mcp-server/route.ts` |

### Mcp-Servers (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/mcp-servers` | `src/app/api/mcp-servers/route.ts` |
| GET | `/api/mcp-servers` | `src/app/api/mcp-servers/route.ts` |
| POST | `/api/mcp-servers` | `src/app/api/mcp-servers/route.ts` |
| PUT | `/api/mcp-servers` | `src/app/api/mcp-servers/route.ts` |

### Memory (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/memory` | `src/app/api/memory/route.ts` |
| GET | `/api/memory` | `src/app/api/memory/route.ts` |
| POST | `/api/memory` | `src/app/api/memory/route.ts` |

### Notes (6)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/notes` | `src/app/api/notes/route.ts` |
| GET | `/api/notes` | `src/app/api/notes/route.ts` |
| POST | `/api/notes` | `src/app/api/notes/route.ts` |
| DELETE | `/api/notes/{workspaceId}/{noteId}` | `src/app/api/notes/[workspaceId]/[noteId]/route.ts` |
| GET | `/api/notes/{workspaceId}/{noteId}` | `src/app/api/notes/[workspaceId]/[noteId]/route.ts` |
| GET | `/api/notes/events` | `src/app/api/notes/events/route.ts` |

### Polling (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/polling/check` | `src/app/api/polling/check/route.ts` |
| POST | `/api/polling/check` | `src/app/api/polling/check/route.ts` |
| GET | `/api/polling/config` | `src/app/api/polling/config/route.ts` |
| POST | `/api/polling/config` | `src/app/api/polling/config/route.ts` |

### Providers (2)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/providers` | `src/app/api/providers/route.ts` |
| GET | `/api/providers/models` | `src/app/api/providers/models/route.ts` |

### Review (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| POST | `/api/review/analyze` | `src/app/api/review/analyze/route.ts` |

### Rpc (2)

| Method | Endpoint | Details |
|--------|----------|---------|
| POST | `/api/rpc` | `src/app/api/rpc/route.ts` |
| GET | `/api/rpc/methods` | `src/app/api/rpc/methods/route.ts` |

### Sandboxes (8)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/sandboxes` | `src/app/api/sandboxes/route.ts` |
| POST | `/api/sandboxes` | `src/app/api/sandboxes/route.ts` |
| DELETE | `/api/sandboxes/{id}` | `src/app/api/sandboxes/[id]/route.ts` |
| GET | `/api/sandboxes/{id}` | `src/app/api/sandboxes/[id]/route.ts` |
| POST | `/api/sandboxes/{id}/execute` | `src/app/api/sandboxes/[id]/execute/route.ts` |
| POST | `/api/sandboxes/{id}/permissions/apply` | `src/app/api/sandboxes/[id]/permissions/apply/route.ts` |
| POST | `/api/sandboxes/{id}/permissions/explain` | `src/app/api/sandboxes/[id]/permissions/explain/route.ts` |
| POST | `/api/sandboxes/explain` | `src/app/api/sandboxes/explain/route.ts` |

### Schedules (8)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/schedules` | `src/app/api/schedules/route.ts` |
| POST | `/api/schedules` | `src/app/api/schedules/route.ts` |
| DELETE | `/api/schedules/{id}` | `src/app/api/schedules/[id]/route.ts` |
| GET | `/api/schedules/{id}` | `src/app/api/schedules/[id]/route.ts` |
| PATCH | `/api/schedules/{id}` | `src/app/api/schedules/[id]/route.ts` |
| POST | `/api/schedules/{id}/run` | `src/app/api/schedules/[id]/run/route.ts` |
| GET | `/api/schedules/tick` | `src/app/api/schedules/tick/route.ts` |
| POST | `/api/schedules/tick` | `src/app/api/schedules/tick/route.ts` |

### Sessions (11)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/sessions` | `src/app/api/sessions/route.ts` |
| DELETE | `/api/sessions/{sessionId}` | `src/app/api/sessions/[sessionId]/route.ts` |
| GET | `/api/sessions/{sessionId}` | `src/app/api/sessions/[sessionId]/route.ts` |
| PATCH | `/api/sessions/{sessionId}` | `src/app/api/sessions/[sessionId]/route.ts` |
| GET | `/api/sessions/{sessionId}/context` | `src/app/api/sessions/[sessionId]/context/route.ts` |
| POST | `/api/sessions/{sessionId}/disconnect` | `src/app/api/sessions/[sessionId]/disconnect/route.ts` |
| POST | `/api/sessions/{sessionId}/fork` | `src/app/api/sessions/[sessionId]/fork/route.ts` |
| GET | `/api/sessions/{sessionId}/history` | `src/app/api/sessions/[sessionId]/history/route.ts` |
| GET | `/api/sessions/{sessionId}/reposlide-result` | `src/app/api/sessions/[sessionId]/reposlide-result/route.ts` |
| GET | `/api/sessions/{sessionId}/reposlide-result/download` | `src/app/api/sessions/[sessionId]/reposlide-result/download/route.ts` |
| GET | `/api/sessions/{sessionId}/transcript` | `src/app/api/sessions/[sessionId]/transcript/route.ts` |

### Shared-Sessions (12)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/shared-sessions` | `src/app/api/shared-sessions/route.ts` |
| POST | `/api/shared-sessions` | `src/app/api/shared-sessions/route.ts` |
| DELETE | `/api/shared-sessions/{sharedSessionId}` | `src/app/api/shared-sessions/[sharedSessionId]/route.ts` |
| GET | `/api/shared-sessions/{sharedSessionId}` | `src/app/api/shared-sessions/[sharedSessionId]/route.ts` |
| POST | `/api/shared-sessions/{sharedSessionId}/approvals/{approvalId}` | `src/app/api/shared-sessions/[sharedSessionId]/approvals/[approvalId]/route.ts` |
| POST | `/api/shared-sessions/{sharedSessionId}/join` | `src/app/api/shared-sessions/[sharedSessionId]/join/route.ts` |
| POST | `/api/shared-sessions/{sharedSessionId}/leave` | `src/app/api/shared-sessions/[sharedSessionId]/leave/route.ts` |
| GET | `/api/shared-sessions/{sharedSessionId}/messages` | `src/app/api/shared-sessions/[sharedSessionId]/messages/route.ts` |
| POST | `/api/shared-sessions/{sharedSessionId}/messages` | `src/app/api/shared-sessions/[sharedSessionId]/messages/route.ts` |
| GET | `/api/shared-sessions/{sharedSessionId}/participants` | `src/app/api/shared-sessions/[sharedSessionId]/participants/route.ts` |
| POST | `/api/shared-sessions/{sharedSessionId}/prompts` | `src/app/api/shared-sessions/[sharedSessionId]/prompts/route.ts` |
| GET | `/api/shared-sessions/{sharedSessionId}/stream` | `src/app/api/shared-sessions/[sharedSessionId]/stream/route.ts` |

### Skills (7)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/skills` | `src/app/api/skills/route.ts` |
| POST | `/api/skills` | `src/app/api/skills/route.ts` |
| GET | `/api/skills/catalog` | `src/app/api/skills/catalog/route.ts` |
| POST | `/api/skills/catalog` | `src/app/api/skills/catalog/route.ts` |
| GET | `/api/skills/clone` | `src/app/api/skills/clone/route.ts` |
| POST | `/api/skills/clone` | `src/app/api/skills/clone/route.ts` |
| POST | `/api/skills/upload` | `src/app/api/skills/upload/route.ts` |

### Spec (2)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/spec/issues` | `src/app/api/spec/issues/route.ts` |
| GET | `/api/spec/surface-index` | `src/app/api/spec/surface-index/route.ts` |

### Specialists (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/specialists` | `src/app/api/specialists/route.ts` |
| GET | `/api/specialists` | `src/app/api/specialists/route.ts` |
| POST | `/api/specialists` | `src/app/api/specialists/route.ts` |
| PUT | `/api/specialists` | `src/app/api/specialists/route.ts` |

### Tasks (16)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/tasks` | `src/app/api/tasks/route.ts` |
| GET | `/api/tasks` | `src/app/api/tasks/route.ts` |
| POST | `/api/tasks` | `src/app/api/tasks/route.ts` |
| DELETE | `/api/tasks/{taskId}` | `src/app/api/tasks/[taskId]/route.ts` |
| GET | `/api/tasks/{taskId}` | `src/app/api/tasks/[taskId]/route.ts` |
| PATCH | `/api/tasks/{taskId}` | `src/app/api/tasks/[taskId]/route.ts` |
| GET | `/api/tasks/{taskId}/artifacts` | `src/app/api/tasks/[taskId]/artifacts/route.ts` |
| POST | `/api/tasks/{taskId}/artifacts` | `src/app/api/tasks/[taskId]/artifacts/route.ts` |
| GET | `/api/tasks/{taskId}/changes` | `src/app/api/tasks/[taskId]/changes/route.ts` |
| GET | `/api/tasks/{taskId}/changes/commit` | `src/app/api/tasks/[taskId]/changes/commit/route.ts` |
| GET | `/api/tasks/{taskId}/changes/file` | `src/app/api/tasks/[taskId]/changes/file/route.ts` |
| GET | `/api/tasks/{taskId}/changes/stats` | `src/app/api/tasks/[taskId]/changes/stats/route.ts` |
| POST | `/api/tasks/{taskId}/pr-run` | `src/app/api/tasks/[taskId]/pr-run/route.ts` |
| GET | `/api/tasks/{taskId}/runs` | `src/app/api/tasks/[taskId]/runs/route.ts` |
| POST | `/api/tasks/{taskId}/status` | `src/app/api/tasks/[taskId]/status/route.ts` |
| GET | `/api/tasks/ready` | `src/app/api/tasks/ready/route.ts` |

### Test-Mcp (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/test-mcp` | `src/app/api/test-mcp/route.ts` |

### Traces (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/traces` | `src/app/api/traces/route.ts` |
| GET | `/api/traces/{id}` | `src/app/api/traces/[id]/route.ts` |
| POST | `/api/traces/export` | `src/app/api/traces/export/route.ts` |
| GET | `/api/traces/stats` | `src/app/api/traces/stats/route.ts` |

### Webhooks (10)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/webhooks/configs` | `src/app/api/webhooks/configs/route.ts` |
| GET | `/api/webhooks/configs` | `src/app/api/webhooks/configs/route.ts` |
| POST | `/api/webhooks/configs` | `src/app/api/webhooks/configs/route.ts` |
| PUT | `/api/webhooks/configs` | `src/app/api/webhooks/configs/route.ts` |
| GET | `/api/webhooks/github` | `src/app/api/webhooks/github/route.ts` |
| POST | `/api/webhooks/github` | `src/app/api/webhooks/github/route.ts` |
| DELETE | `/api/webhooks/register` | `src/app/api/webhooks/register/route.ts` |
| GET | `/api/webhooks/register` | `src/app/api/webhooks/register/route.ts` |
| POST | `/api/webhooks/register` | `src/app/api/webhooks/register/route.ts` |
| GET | `/api/webhooks/webhook-logs` | `src/app/api/webhooks/webhook-logs/route.ts` |

### Workflows (6)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/workflows` | `src/app/api/workflows/route.ts` |
| POST | `/api/workflows` | `src/app/api/workflows/route.ts` |
| DELETE | `/api/workflows/{id}` | `src/app/api/workflows/[id]/route.ts` |
| GET | `/api/workflows/{id}` | `src/app/api/workflows/[id]/route.ts` |
| PUT | `/api/workflows/{id}` | `src/app/api/workflows/[id]/route.ts` |
| POST | `/api/workflows/{id}/trigger` | `src/app/api/workflows/[id]/trigger/route.ts` |

### Workspaces (25)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/workspaces` | `src/app/api/workspaces/route.ts` |
| POST | `/api/workspaces` | `src/app/api/workspaces/route.ts` |
| DELETE | `/api/workspaces/{workspaceId}` | `src/app/api/workspaces/[workspaceId]/route.ts` |
| GET | `/api/workspaces/{workspaceId}` | `src/app/api/workspaces/[workspaceId]/route.ts` |
| PATCH | `/api/workspaces/{workspaceId}` | `src/app/api/workspaces/[workspaceId]/route.ts` |
| POST | `/api/workspaces/{workspaceId}/archive` | `src/app/api/workspaces/[workspaceId]/archive/route.ts` |
| GET | `/api/workspaces/{workspaceId}/codebases` | `src/app/api/workspaces/[workspaceId]/codebases/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases` | `src/app/api/workspaces/[workspaceId]/codebases/route.ts` |
| DELETE | `/api/workspaces/{workspaceId}/codebases/{codebaseId}` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/commit` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/commit/route.ts` |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/commits` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/commits/route.ts` |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/commits/{sha}/diff` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/commits/[sha]/diff/route.ts` |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/diff` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/diff/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/discard` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/discard/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/export` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/export/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/pull` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/pull/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/rebase` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/rebase/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/reset` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/reset/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/stage` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/stage/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/unstage` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/unstage/route.ts` |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/reposlide` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/reposlide/route.ts` |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/wiki` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/wiki/route.ts` |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/worktrees` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/worktrees/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/worktrees` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/worktrees/route.ts` |
| GET | `/api/workspaces/{workspaceId}/codebases/changes` | `src/app/api/workspaces/[workspaceId]/codebases/changes/route.ts` |

### Worktrees (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/worktrees/{worktreeId}` | `src/app/api/worktrees/[worktreeId]/route.ts` |
| GET | `/api/worktrees/{worktreeId}` | `src/app/api/worktrees/[worktreeId]/route.ts` |
| POST | `/api/worktrees/{worktreeId}/validate` | `src/app/api/worktrees/[worktreeId]/validate/route.ts` |

---

## Rust API Routes

### A2a (8)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/a2a/card` | `crates/routa-server/src/api/a2a.rs` |
| POST | `/api/a2a/message` | `crates/routa-server/src/api/a2a.rs` |
| GET | `/api/a2a/rpc` | `crates/routa-server/src/api/a2a.rs` |
| POST | `/api/a2a/rpc` | `crates/routa-server/src/api/a2a.rs` |
| GET | `/api/a2a/sessions` | `crates/routa-server/src/api/a2a.rs` |
| GET | `/api/a2a/tasks` | `crates/routa-server/src/api/a2a.rs` |
| GET | `/api/a2a/tasks/{id}` | `crates/routa-server/src/api/a2a.rs` |
| POST | `/api/a2a/tasks/{id}` | `crates/routa-server/src/api/a2a.rs` |

### A2ui (2)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/a2ui/dashboard` | `crates/routa-server/src/api/a2ui.rs` |
| POST | `/api/a2ui/dashboard` | `crates/routa-server/src/api/a2ui.rs` |

### Acp (15)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/acp` | `crates/routa-server/src/api/acp_routes.rs` |
| POST | `/api/acp` | `crates/routa-server/src/api/acp_routes.rs` |
| POST | `/api/acp/docker/container/start` | `crates/routa-server/src/api/acp_docker.rs` |
| POST | `/api/acp/docker/container/stop` | `crates/routa-server/src/api/acp_docker.rs` |
| GET | `/api/acp/docker/containers` | `crates/routa-server/src/api/acp_docker.rs` |
| POST | `/api/acp/docker/pull` | `crates/routa-server/src/api/acp_docker.rs` |
| GET | `/api/acp/docker/status` | `crates/routa-server/src/api/acp_docker.rs` |
| DELETE | `/api/acp/install` | `crates/routa-server/src/api/acp_registry.rs` |
| POST | `/api/acp/install` | `crates/routa-server/src/api/acp_registry.rs` |
| GET | `/api/acp/registry` | `crates/routa-server/src/api/acp_registry.rs` |
| POST | `/api/acp/registry` | `crates/routa-server/src/api/acp_registry.rs` |
| GET | `/api/acp/runtime` | `crates/routa-server/src/api/acp_registry.rs` |
| POST | `/api/acp/runtime` | `crates/routa-server/src/api/acp_registry.rs` |
| GET | `/api/acp/warmup` | `crates/routa-server/src/api/acp_registry.rs` |
| POST | `/api/acp/warmup` | `crates/routa-server/src/api/acp_registry.rs` |

### Ag-Ui (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| POST | `/api/ag-ui` | `crates/routa-server/src/api/ag_ui.rs` |

### Agents (5)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/agents` | `crates/routa-server/src/api/agents.rs` |
| POST | `/api/agents` | `crates/routa-server/src/api/agents.rs` |
| DELETE | `/api/agents/{id}` | `crates/routa-server/src/api/agents.rs` |
| GET | `/api/agents/{id}` | `crates/routa-server/src/api/agents.rs` |
| POST | `/api/agents/{id}/status` | `crates/routa-server/src/api/agents.rs` |

### Background-Tasks (7)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/background-tasks` | `crates/routa-server/src/api/background_tasks.rs` |
| POST | `/api/background-tasks` | `crates/routa-server/src/api/background_tasks.rs` |
| DELETE | `/api/background-tasks/{id}` | `crates/routa-server/src/api/background_tasks.rs` |
| GET | `/api/background-tasks/{id}` | `crates/routa-server/src/api/background_tasks.rs` |
| PATCH | `/api/background-tasks/{id}` | `crates/routa-server/src/api/background_tasks.rs` |
| POST | `/api/background-tasks/{id}/retry` | `crates/routa-server/src/api/background_tasks.rs` |
| POST | `/api/background-tasks/process` | `crates/routa-server/src/api/background_tasks.rs` |

### Canvas (6)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/canvas` | `crates/routa-server/src/api/canvas.rs` |
| POST | `/api/canvas` | `crates/routa-server/src/api/canvas.rs` |
| DELETE | `/api/canvas/{id}` | `crates/routa-server/src/api/canvas.rs` |
| GET | `/api/canvas/{id}` | `crates/routa-server/src/api/canvas.rs` |
| POST | `/api/canvas/specialist` | `crates/routa-server/src/api/canvas.rs` |
| POST | `/api/canvas/specialist/materialize` | `crates/routa-server/src/api/canvas.rs` |

### Clone (9)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/clone` | `crates/routa-server/src/api/clone.rs` |
| PATCH | `/api/clone` | `crates/routa-server/src/api/clone.rs` |
| POST | `/api/clone` | `crates/routa-server/src/api/clone.rs` |
| DELETE | `/api/clone/branches` | `crates/routa-server/src/api/clone_branches.rs` |
| GET | `/api/clone/branches` | `crates/routa-server/src/api/clone_branches.rs` |
| PATCH | `/api/clone/branches` | `crates/routa-server/src/api/clone_branches.rs` |
| POST | `/api/clone/branches` | `crates/routa-server/src/api/clone_branches.rs` |
| POST | `/api/clone/local` | `crates/routa-server/src/api/clone_local.rs` |
| POST | `/api/clone/progress` | `crates/routa-server/src/api/clone_progress.rs` |

### Codebases (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/codebases/{id}` | `crates/routa-server/src/api/codebases.rs` |
| PATCH | `/api/codebases/{id}` | `crates/routa-server/src/api/codebases.rs` |
| POST | `/api/codebases/{id}/default` | `crates/routa-server/src/api/codebases.rs` |

### Debug (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/debug/path` | `crates/routa-server/src/api/debug.rs` |

### Feature-Explorer (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/feature-explorer` | `crates/routa-server/src/api/feature_explorer.rs` |
| GET | `/api/feature-explorer/{featureId}` | `crates/routa-server/src/api/feature_explorer.rs` |
| GET | `/api/feature-explorer/{featureId}/apis` | `crates/routa-server/src/api/feature_explorer.rs` |
| GET | `/api/feature-explorer/{featureId}/files` | `crates/routa-server/src/api/feature_explorer.rs` |

### Files (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/files/search` | `crates/routa-server/src/api/files.rs` |

### Fitness (6)

| Method | Endpoint | Details |
|--------|----------|---------|
| POST | `/api/fitness/analyze` | `crates/routa-server/src/api/fitness.rs` |
| GET | `/api/fitness/architecture` | `crates/routa-server/src/api/fitness.rs` |
| GET | `/api/fitness/plan` | `crates/routa-server/src/api/fitness.rs` |
| GET | `/api/fitness/report` | `crates/routa-server/src/api/fitness.rs` |
| GET | `/api/fitness/runtime` | `crates/routa-server/src/api/fitness.rs` |
| GET | `/api/fitness/specs` | `crates/routa-server/src/api/fitness.rs` |

### Git (14)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/git/commit` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/commit` | `crates/routa-server/src/api/git.rs` |
| GET | `/api/git/commits` | `crates/routa-server/src/api/git.rs` |
| GET | `/api/git/commits/{sha}/diff` | `crates/routa-server/src/api/git.rs` |
| GET | `/api/git/diff` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/discard` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/export` | `crates/routa-server/src/api/git.rs` |
| GET | `/api/git/log` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/pull` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/rebase` | `crates/routa-server/src/api/git.rs` |
| GET | `/api/git/refs` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/reset` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/stage` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/unstage` | `crates/routa-server/src/api/git.rs` |

### Github (9)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/github` | `crates/routa-server/src/api/github.rs` |
| GET | `/api/github/access` | `crates/routa-server/src/api/github.rs` |
| GET | `/api/github/file` | `crates/routa-server/src/api/github.rs` |
| POST | `/api/github/import` | `crates/routa-server/src/api/github.rs` |
| GET | `/api/github/issues` | `crates/routa-server/src/api/github.rs` |
| POST | `/api/github/pr-comment` | `crates/routa-server/src/api/github.rs` |
| GET | `/api/github/pulls` | `crates/routa-server/src/api/github.rs` |
| GET | `/api/github/search` | `crates/routa-server/src/api/github.rs` |
| GET | `/api/github/tree` | `crates/routa-server/src/api/github.rs` |

### Graph (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/graph/analyze` | `crates/routa-server/src/api/graph.rs` |

### Harness (13)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/harness/agent-hooks` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/automations` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/codeowners` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/design-decisions` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/github-actions` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/hooks` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/hooks/preview` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/instructions` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/repo-signals` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/spec-sources` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/templates` | `crates/routa-server/src/api/harness_templates.rs` |
| GET | `/api/harness/templates/doctor` | `crates/routa-server/src/api/harness_templates.rs` |
| GET | `/api/harness/templates/validate` | `crates/routa-server/src/api/harness_templates.rs` |

### Health (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/health` | `crates/routa-server/src/lib.rs` |

### Kanban (8)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/kanban/boards` | `crates/routa-server/src/api/kanban.rs` |
| POST | `/api/kanban/boards` | `crates/routa-server/src/api/kanban.rs` |
| GET | `/api/kanban/boards/{boardId}` | `crates/routa-server/src/api/kanban.rs` |
| PATCH | `/api/kanban/boards/{boardId}` | `crates/routa-server/src/api/kanban.rs` |
| POST | `/api/kanban/decompose` | `crates/routa-server/src/api/kanban.rs` |
| GET | `/api/kanban/events` | `crates/routa-server/src/api/kanban.rs` |
| GET | `/api/kanban/export` | `crates/routa-server/src/api/kanban.rs` |
| POST | `/api/kanban/import` | `crates/routa-server/src/api/kanban.rs` |

### Mcp (6)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/mcp` | `crates/routa-server/src/api/mcp_routes.rs`, `crates/routa-server/src/api/mcp_routes/rmcp_service.rs`, `crates/routa-server/src/api/mcp_routes/tool_catalog.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/agents_tasks.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/delegation.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/events_kanban.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/notes_workspace.rs` |
| GET | `/api/mcp` | `crates/routa-server/src/api/mcp_routes.rs`, `crates/routa-server/src/api/mcp_routes/rmcp_service.rs`, `crates/routa-server/src/api/mcp_routes/tool_catalog.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/agents_tasks.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/delegation.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/events_kanban.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/notes_workspace.rs` |
| POST | `/api/mcp` | `crates/routa-server/src/api/mcp_routes.rs`, `crates/routa-server/src/api/mcp_routes/rmcp_service.rs`, `crates/routa-server/src/api/mcp_routes/tool_catalog.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/agents_tasks.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/delegation.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/events_kanban.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/notes_workspace.rs` |
| GET | `/api/mcp/tools` | `crates/routa-server/src/api/mcp_tools.rs` |
| PATCH | `/api/mcp/tools` | `crates/routa-server/src/api/mcp_tools.rs` |
| POST | `/api/mcp/tools` | `crates/routa-server/src/api/mcp_tools.rs` |

### Mcp-Server (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/mcp-server` | `crates/routa-server/src/api/mcp_server_mgmt.rs` |
| GET | `/api/mcp-server` | `crates/routa-server/src/api/mcp_server_mgmt.rs` |
| POST | `/api/mcp-server` | `crates/routa-server/src/api/mcp_server_mgmt.rs` |

### Mcp-Servers (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/mcp-servers` | `crates/routa-server/src/api/mcp_servers.rs` |
| GET | `/api/mcp-servers` | `crates/routa-server/src/api/mcp_servers.rs` |
| POST | `/api/mcp-servers` | `crates/routa-server/src/api/mcp_servers.rs` |
| PUT | `/api/mcp-servers` | `crates/routa-server/src/api/mcp_servers.rs` |

### Memory (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/memory` | `crates/routa-server/src/api/memory.rs` |
| GET | `/api/memory` | `crates/routa-server/src/api/memory.rs` |
| POST | `/api/memory` | `crates/routa-server/src/api/memory.rs` |

### Notes (6)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/notes` | `crates/routa-server/src/api/notes.rs` |
| GET | `/api/notes` | `crates/routa-server/src/api/notes.rs` |
| POST | `/api/notes` | `crates/routa-server/src/api/notes.rs` |
| DELETE | `/api/notes/{workspace_id}/{note_id}` | `crates/routa-server/src/api/notes.rs` |
| GET | `/api/notes/{workspace_id}/{note_id}` | `crates/routa-server/src/api/notes.rs` |
| GET | `/api/notes/events` | `crates/routa-server/src/api/notes.rs` |

### Polling (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/polling/check` | `crates/routa-server/src/api/polling.rs` |
| POST | `/api/polling/check` | `crates/routa-server/src/api/polling.rs` |
| GET | `/api/polling/config` | `crates/routa-server/src/api/polling.rs` |
| POST | `/api/polling/config` | `crates/routa-server/src/api/polling.rs` |

### Providers (2)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/providers` | `crates/routa-server/src/api/providers.rs` |
| GET | `/api/providers/models` | `crates/routa-server/src/api/provider_models.rs` |

### Review (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| POST | `/api/review/analyze` | `crates/routa-server/src/api/review.rs` |

### Rpc (2)

| Method | Endpoint | Details |
|--------|----------|---------|
| POST | `/api/rpc` | `crates/routa-server/src/api/rpc.rs` |
| GET | `/api/rpc/methods` | `crates/routa-server/src/api/rpc.rs` |

### Sandboxes (8)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/sandboxes` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes` | `crates/routa-server/src/api/sandbox.rs` |
| DELETE | `/api/sandboxes/{id}` | `crates/routa-server/src/api/sandbox.rs` |
| GET | `/api/sandboxes/{id}` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes/{id}/execute` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes/{id}/permissions/apply` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes/{id}/permissions/explain` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes/explain` | `crates/routa-server/src/api/sandbox.rs` |

### Schedules (8)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/schedules` | `crates/routa-server/src/api/schedules.rs` |
| POST | `/api/schedules` | `crates/routa-server/src/api/schedules.rs` |
| DELETE | `/api/schedules/{id}` | `crates/routa-server/src/api/schedules.rs` |
| GET | `/api/schedules/{id}` | `crates/routa-server/src/api/schedules.rs` |
| PATCH | `/api/schedules/{id}` | `crates/routa-server/src/api/schedules.rs` |
| POST | `/api/schedules/{id}/run` | `crates/routa-server/src/api/schedules.rs` |
| GET | `/api/schedules/tick` | `crates/routa-server/src/api/schedules.rs` |
| POST | `/api/schedules/tick` | `crates/routa-server/src/api/schedules.rs` |

### Sessions (11)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/sessions` | `crates/routa-server/src/api/sessions.rs` |
| DELETE | `/api/sessions/{session_id}` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{session_id}` | `crates/routa-server/src/api/sessions.rs` |
| PATCH | `/api/sessions/{session_id}` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{session_id}/context` | `crates/routa-server/src/api/sessions.rs` |
| POST | `/api/sessions/{session_id}/disconnect` | `crates/routa-server/src/api/sessions.rs` |
| POST | `/api/sessions/{session_id}/fork` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{session_id}/history` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{session_id}/reposlide-result` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{session_id}/reposlide-result/download` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{session_id}/transcript` | `crates/routa-server/src/api/sessions.rs` |

### Shared-Sessions (12)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/shared-sessions` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| DELETE | `/api/shared-sessions/{shared_session_id}` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| GET | `/api/shared-sessions/{shared_session_id}` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{shared_session_id}/approvals/{approval_id}` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{shared_session_id}/join` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{shared_session_id}/leave` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| GET | `/api/shared-sessions/{shared_session_id}/messages` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{shared_session_id}/messages` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| GET | `/api/shared-sessions/{shared_session_id}/participants` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{shared_session_id}/prompts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| GET | `/api/shared-sessions/{shared_session_id}/stream` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |

### Skills (7)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/skills` | `crates/routa-server/src/api/skills.rs` |
| POST | `/api/skills` | `crates/routa-server/src/api/skills.rs` |
| GET | `/api/skills/catalog` | `crates/routa-server/src/api/skills_catalog.rs` |
| POST | `/api/skills/catalog` | `crates/routa-server/src/api/skills_catalog.rs` |
| GET | `/api/skills/clone` | `crates/routa-server/src/api/skills_clone.rs` |
| POST | `/api/skills/clone` | `crates/routa-server/src/api/skills_clone.rs` |
| POST | `/api/skills/upload` | `crates/routa-server/src/api/skills_upload.rs` |

### Spec (2)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/spec/issues` | `crates/routa-server/src/api/spec.rs` |
| GET | `/api/spec/surface-index` | `crates/routa-server/src/api/spec.rs` |

### Specialists (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/specialists` | `crates/routa-server/src/api/specialists.rs` |
| GET | `/api/specialists` | `crates/routa-server/src/api/specialists.rs` |
| POST | `/api/specialists` | `crates/routa-server/src/api/specialists.rs` |
| PUT | `/api/specialists` | `crates/routa-server/src/api/specialists.rs` |

### Tasks (15)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/tasks` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| POST | `/api/tasks` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| DELETE | `/api/tasks/{id}` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{id}` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| PATCH | `/api/tasks/{id}` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{id}/artifacts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| POST | `/api/tasks/{id}/artifacts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{id}/changes` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{id}/changes/commit` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{id}/changes/file` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{id}/changes/stats` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{id}/runs` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| POST | `/api/tasks/{id}/status` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/ready` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |

### Test-Mcp (1)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/test-mcp` | `crates/routa-server/src/api/test_mcp.rs` |

### Traces (4)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/traces` | `crates/routa-server/src/api/traces.rs` |
| GET | `/api/traces/{id}` | `crates/routa-server/src/api/traces.rs` |
| POST | `/api/traces/export` | `crates/routa-server/src/api/traces.rs` |
| GET | `/api/traces/stats` | `crates/routa-server/src/api/traces.rs` |

### Webhooks (10)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/webhooks/configs` | `crates/routa-server/src/api/webhooks.rs` |
| GET | `/api/webhooks/configs` | `crates/routa-server/src/api/webhooks.rs` |
| POST | `/api/webhooks/configs` | `crates/routa-server/src/api/webhooks.rs` |
| PUT | `/api/webhooks/configs` | `crates/routa-server/src/api/webhooks.rs` |
| GET | `/api/webhooks/github` | `crates/routa-server/src/api/webhooks.rs` |
| POST | `/api/webhooks/github` | `crates/routa-server/src/api/webhooks.rs` |
| DELETE | `/api/webhooks/register` | `crates/routa-server/src/api/webhooks.rs` |
| GET | `/api/webhooks/register` | `crates/routa-server/src/api/webhooks.rs` |
| POST | `/api/webhooks/register` | `crates/routa-server/src/api/webhooks.rs` |
| GET | `/api/webhooks/webhook-logs` | `crates/routa-server/src/api/webhooks.rs` |

### Workflows (6)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/workflows` | `crates/routa-server/src/api/workflows.rs` |
| POST | `/api/workflows` | `crates/routa-server/src/api/workflows.rs` |
| DELETE | `/api/workflows/{id}` | `crates/routa-server/src/api/workflows.rs` |
| GET | `/api/workflows/{id}` | `crates/routa-server/src/api/workflows.rs` |
| PUT | `/api/workflows/{id}` | `crates/routa-server/src/api/workflows.rs` |
| POST | `/api/workflows/{id}/trigger` | `crates/routa-server/src/api/workflows.rs` |

### Workspaces (14)

| Method | Endpoint | Details |
|--------|----------|---------|
| GET | `/api/workspaces` | `crates/routa-server/src/api/workspaces.rs` |
| POST | `/api/workspaces` | `crates/routa-server/src/api/workspaces.rs` |
| DELETE | `/api/workspaces/{id}` | `crates/routa-server/src/api/workspaces.rs` |
| GET | `/api/workspaces/{id}` | `crates/routa-server/src/api/workspaces.rs` |
| PATCH | `/api/workspaces/{id}` | `crates/routa-server/src/api/workspaces.rs` |
| POST | `/api/workspaces/{id}/archive` | `crates/routa-server/src/api/workspaces.rs` |
| GET | `/api/workspaces/{workspace_id}/codebases` | `crates/routa-server/src/api/codebases.rs` |
| POST | `/api/workspaces/{workspace_id}/codebases` | `crates/routa-server/src/api/codebases.rs` |
| DELETE | `/api/workspaces/{workspace_id}/codebases/{codebase_id}` | `crates/routa-server/src/api/codebases.rs` |
| GET | `/api/workspaces/{workspace_id}/codebases/{codebase_id}/reposlide` | `crates/routa-server/src/api/codebases.rs` |
| GET | `/api/workspaces/{workspace_id}/codebases/{codebase_id}/wiki` | `crates/routa-server/src/api/codebases.rs` |
| GET | `/api/workspaces/{workspace_id}/codebases/{codebase_id}/worktrees` | `crates/routa-server/src/api/worktrees.rs` |
| POST | `/api/workspaces/{workspace_id}/codebases/{codebase_id}/worktrees` | `crates/routa-server/src/api/worktrees.rs` |
| GET | `/api/workspaces/{workspace_id}/codebases/changes` | `crates/routa-server/src/api/codebases.rs` |

### Worktrees (3)

| Method | Endpoint | Details |
|--------|----------|---------|
| DELETE | `/api/worktrees/{id}` | `crates/routa-server/src/api/worktrees.rs` |
| GET | `/api/worktrees/{id}` | `crates/routa-server/src/api/worktrees.rs` |
| POST | `/api/worktrees/{id}/validate` | `crates/routa-server/src/api/worktrees.rs` |

