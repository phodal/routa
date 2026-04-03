---
status: generated
purpose: Auto-generated route and API surface index for Routa.js.
sources:
  - src/app/**/page.tsx
  - api-contract.yaml
update_policy:
  - Regenerate with `node --import tsx scripts/docs/feature-tree-generator.ts --save`.
  - Do not hand-edit generated endpoint or route tables.
---

# Routa.js — Product Feature Specification

Multi-agent coordination platform. This document is auto-generated from:
- Frontend routes: `src/app/**/page.tsx`
- API contract: `api-contract.yaml`

---

## Frontend Pages

| Page | Route | Description |
|------|-------|-------------|
| Home | `/` |  |
| A2A Protocol Test Page | `/a2a` | Interactive testing interface for the Agent-to-Agent (A2A) protocol |
| AG-UI Protocol Test Page | `/ag-ui` | Standalone page for testing AG-UI protocol integration |
| Debug / Acp Replay | `/debug/acp-replay` |  |
| Mcp Tools | `/mcp-tools` |  |
| Messages Page - Notification & PR Agent Execution History | `/messages` | Shows: - All notifications with filtering - PR Agent execution history from back |
| Settings Page | `/settings` | Provides a full-page UI for all Routa settings: - Providers (default agent provi |
| Agent Installation Settings Page | `/settings/agents` | Provides a full-page UI for managing ACP agent installations |
| Settings / Fitness | `/settings/fitness` |  |
| Settings / Fluency | `/settings/fluency` |  |
| Settings / Harness | `/settings/harness` |  |
| Settings / Mcp | `/settings/mcp` |  |
| Settings / Schedules | `/settings/schedules` |  |
| Settings / Specialists | `/settings/specialists` |  |
| GitHub Webhook Trigger Settings Page | `/settings/webhooks` | Provides a full-page UI for configuring GitHub webhook event-driven triggers |
| Settings / Workflows | `/settings/workflows` |  |
| Trace Page | `/traces` | Full-page view for browsing and analyzing Agent Trace records |
| Workspace Page (Server Component Wrapper) | `/workspace/:workspaceId` | This server component provides generateStaticParams for static export and redire |
| Codebases / Reposlide | `/workspace/:workspaceId/codebases/:codebaseId/reposlide` |  |
| Workspace / Kanban | `/workspace/:workspaceId/kanban` |  |
| Workspace / Overview | `/workspace/:workspaceId/overview` |  |
| Workspace Session Page (Server Component Wrapper) | `/workspace/:workspaceId/sessions/:sessionId` | This server component provides generateStaticParams for static export and render |
| Workspace / Team | `/workspace/:workspaceId/team` |  |
| Workspace / Team | `/workspace/:workspaceId/team/:sessionId` |  |

---

## API Endpoints

### A2A (8)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/a2a/sessions` | List A2A sessions |
| GET | `/api/a2a/card` | A2A agent card |
| POST | `/api/a2a/rpc` | A2A JSON-RPC |
| GET | `/api/a2a/rpc` | A2A SSE stream |
| POST | `/api/a2a/message` | Send a message via the A2A protocol |
| GET | `/api/a2a/tasks` | List A2A tasks |
| GET | `/api/a2a/tasks/{id}` | Get an A2A task by ID |
| POST | `/api/a2a/tasks/{id}` | Update / respond to an A2A task |

### A2ui (2)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/a2ui/dashboard` | Get A2UI v0.10 dashboard data |
| POST | `/api/a2ui/dashboard` | Add custom A2UI messages to the dashboard |

### ACP (15)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/acp` | ACP JSON-RPC endpoint |
| GET | `/api/acp` | ACP SSE stream |
| GET | `/api/acp/registry` | List agents in the ACP registry |
| POST | `/api/acp/registry` | Register an agent in the ACP registry |
| POST | `/api/acp/install` | Install an ACP agent |
| DELETE | `/api/acp/install` | Uninstall an ACP agent |
| GET | `/api/acp/runtime` | Get ACP runtime status |
| POST | `/api/acp/runtime` | Start ACP runtime |
| GET | `/api/acp/warmup` | Get ACP warmup status |
| POST | `/api/acp/warmup` | Trigger ACP warmup |
| GET | `/api/acp/docker/status` | Get Docker daemon status |
| POST | `/api/acp/docker/pull` | Pull a Docker image |
| GET | `/api/acp/docker/containers` | List Docker containers for OpenCode agents |
| POST | `/api/acp/docker/container/start` | Start a Docker container for OpenCode agent |
| POST | `/api/acp/docker/container/stop` | Stop a Docker container |

### Ag-Ui (1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ag-ui` | Process AG-UI protocol request (SSE stream) |

### Agents (5)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agents` | List agents (or get single by id query param) |
| POST | `/api/agents` | Create a new agent |
| GET | `/api/agents/{id}` | Get agent by ID (REST-style path param) |
| DELETE | `/api/agents/{id}` | Delete an agent |
| POST | `/api/agents/{id}/status` | Update agent status |

### Background-Tasks (7)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/background-tasks` | List background tasks |
| POST | `/api/background-tasks` | Create a background task |
| POST | `/api/background-tasks/process` | Process the next pending background task |
| GET | `/api/background-tasks/{id}` | Get a background task by ID |
| PATCH | `/api/background-tasks/{id}` | Update a background task (PENDING only) |
| DELETE | `/api/background-tasks/{id}` | Cancel a background task |
| POST | `/api/background-tasks/{id}/retry` | Retry a failed background task |

### Clone (8)

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

### Codebases (3)

| Method | Endpoint | Description |
|--------|----------|-------------|
| PATCH | `/api/codebases/{id}` | Update codebase metadata |
| DELETE | `/api/codebases/{id}` | Delete a codebase |
| POST | `/api/codebases/{id}/default` | Set a codebase as the default |

### Debug (1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/debug/path` | Debug endpoint — returns resolved binary paths (desktop only) |

### Files (1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files/search` | Search files in a codebase |

### Fitness (4)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/fitness/analyze` | Run harness fitness fluency analysis for one or more profiles |
| GET | `/api/fitness/plan` | Build the executable fitness plan for a repository context |
| GET | `/api/fitness/report` | Read persisted fitness fluency report snapshots |
| GET | `/api/fitness/specs` | Inspect docs/fitness source files and parsed metric metadata |

### GitHub (7)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/github` | List active GitHub virtual workspaces |
| POST | `/api/github/import` | Import a GitHub repo as a virtual workspace (zipball download) |
| GET | `/api/github/issues` | List GitHub issues for a workspace codebase |
| GET | `/api/github/tree` | Get file tree for an imported GitHub repo |
| GET | `/api/github/file` | Read a file from an imported GitHub repo |
| GET | `/api/github/search` | Search files in an imported GitHub repo |
| POST | `/api/github/pr-comment` | Post a comment on a GitHub pull request |

### Harness (10)

| Method | Endpoint | Description |
|--------|----------|-------------|
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

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check — returns service status |

### Kanban (8)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/kanban/boards` | List Kanban boards for a workspace |
| POST | `/api/kanban/boards` | Create a Kanban board |
| GET | `/api/kanban/boards/{boardId}` | Get a Kanban board by ID |
| PATCH | `/api/kanban/boards/{boardId}` | Update a Kanban board |
| POST | `/api/kanban/decompose` | Decompose natural language input into multiple Kanban tasks |
| GET | `/api/kanban/export` | Export kanban boards as YAML |
| POST | `/api/kanban/import` | Import kanban boards from YAML |
| GET | `/api/kanban/events` | Stream kanban workspace events over SSE |

### MCP (6)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/mcp` | MCP Streamable HTTP (JSON-RPC) |
| GET | `/api/mcp` | MCP SSE stream |
| DELETE | `/api/mcp` | Terminate MCP session |
| GET | `/api/mcp/tools` | List MCP tools |
| POST | `/api/mcp/tools` | Execute an MCP tool |
| PATCH | `/api/mcp/tools` | Update MCP tool configuration |

### Mcp-Server (3)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mcp-server` | Get MCP server status |
| POST | `/api/mcp-server` | Start MCP server |
| DELETE | `/api/mcp-server` | Stop MCP server |

### Mcp-Servers (4)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mcp-servers` | List custom MCP servers (or get single by id query param) |
| POST | `/api/mcp-servers` | Create a new custom MCP server |
| PUT | `/api/mcp-servers` | Update an existing custom MCP server |
| DELETE | `/api/mcp-servers` | Delete a custom MCP server |

### Memory (3)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/memory` | List memory entries for a workspace |
| POST | `/api/memory` | Create a memory entry |
| DELETE | `/api/memory` | Delete memory entries |

### Notes (6)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notes` | List notes or get single by noteId |
| POST | `/api/notes` | Create or update a note |
| DELETE | `/api/notes` | Delete note by query params |
| GET | `/api/notes/events` | SSE stream for note change events |
| GET | `/api/notes/{workspaceId}/{noteId}` | Get note by workspace + note ID |
| DELETE | `/api/notes/{workspaceId}/{noteId}` | Delete note by path params |

### Polling (4)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/polling/config` | Get polling configuration |
| POST | `/api/polling/config` | Update polling configuration |
| GET | `/api/polling/check` | Run a polling check (GET) |
| POST | `/api/polling/check` | Run a polling check (POST) |

### Providers (2)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/providers` | List configured LLM providers |
| GET | `/api/providers/models` | List available models for configured providers |

### Review (1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/review/analyze` | Analyze a git diff with the single public PR Reviewer specialist |

### Rpc (2)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/rpc` | Generic JSON-RPC endpoint |
| GET | `/api/rpc/methods` | List available RPC methods |

### Sandboxes (8)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sandboxes` | List all active sandbox containers |
| POST | `/api/sandboxes` | Create a new sandbox container |
| POST | `/api/sandboxes/explain` | Resolve and explain an effective sandbox policy without creating a sandbox |
| GET | `/api/sandboxes/{id}` | Get sandbox info by ID |
| DELETE | `/api/sandboxes/{id}` | Stop and remove a sandbox container |
| POST | `/api/sandboxes/{id}/permissions/explain` | Preview the effective sandbox policy after applying permission constraints |
| POST | `/api/sandboxes/{id}/permissions/apply` | Recreate a sandbox with permission constraints applied to its policy |
| POST | `/api/sandboxes/{id}/execute` | Execute code in a sandbox and stream results as NDJSON |

### Schedules (8)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/schedules` | List scheduled tasks |
| POST | `/api/schedules` | Create a new schedule |
| GET | `/api/schedules/{id}` | Get a schedule by ID |
| PATCH | `/api/schedules/{id}` | Update a schedule |
| DELETE | `/api/schedules/{id}` | Delete a schedule |
| POST | `/api/schedules/{id}/run` | Trigger a schedule to run immediately |
| GET | `/api/schedules/tick` | Get tick status for scheduled tasks |
| POST | `/api/schedules/tick` | Manually trigger the schedule tick |

### Sessions (10)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List ACP sessions |
| GET | `/api/sessions/{sessionId}/context` | Get hierarchical context for a session |
| GET | `/api/sessions/{sessionId}/reposlide-result` | Read the RepoSlide result payload extracted from a session transcript |
| GET | `/api/sessions/{sessionId}/reposlide-result/download` | Download the generated RepoSlide PPTX artifact for a completed session |
| GET | `/api/sessions/{id}` | Get session by ID |
| PATCH | `/api/sessions/{id}` | Update session metadata |
| DELETE | `/api/sessions/{id}` | Delete a session |
| GET | `/api/sessions/{id}/history` | Get message history for a session |
| GET | `/api/sessions/{id}/transcript` | Get preferred transcript payload for a session |
| POST | `/api/sessions/{id}/disconnect` | Disconnect and kill an active session process |

### Shared-Sessions (12)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/shared-sessions` | List shared sessions |
| POST | `/api/shared-sessions` | Create a shared session |
| GET | `/api/shared-sessions/{sharedSessionId}` | Get a shared session with participants and approvals |
| DELETE | `/api/shared-sessions/{sharedSessionId}` | Close a shared session |
| POST | `/api/shared-sessions/{sharedSessionId}/join` | Join a shared session |
| POST | `/api/shared-sessions/{sharedSessionId}/leave` | Leave a shared session |
| GET | `/api/shared-sessions/{sharedSessionId}/participants` | List shared session participants |
| GET | `/api/shared-sessions/{sharedSessionId}/messages` | List shared session messages |
| POST | `/api/shared-sessions/{sharedSessionId}/messages` | Send a shared session message |
| POST | `/api/shared-sessions/{sharedSessionId}/prompts` | Send a shared session prompt |
| POST | `/api/shared-sessions/{sharedSessionId}/approvals/{approvalId}` | Approve or reject a pending shared session prompt |
| GET | `/api/shared-sessions/{sharedSessionId}/stream` | Stream shared session events over SSE |

### Skills (7)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/skills` | List skills or get by name |
| POST | `/api/skills` | Reload skills from disk |
| GET | `/api/skills/clone` | Discover skills from repo path |
| POST | `/api/skills/clone` | Clone a skill repository |
| POST | `/api/skills/upload` | Upload skill as zip |
| GET | `/api/skills/catalog` | List available skills in the registry |
| POST | `/api/skills/catalog` | Refresh the local skill catalog from registry |

### Specialists (4)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/specialists` | List configured specialist agents |
| POST | `/api/specialists` | Create a specialist configuration |
| PUT | `/api/specialists` | Update an existing specialist |
| DELETE | `/api/specialists` | Delete a specialist |

### Tasks (11)

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

### Test-Mcp (1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/test-mcp` | Test MCP config |

### Traces (4)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/traces` | List agent execution traces |
| POST | `/api/traces` | Create a new trace record |
| GET | `/api/traces/stats` | Get aggregated trace statistics |
| GET | `/api/traces/{id}` | Get a single trace by ID |

### Webhooks (10)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/webhooks/configs` | List webhook configurations |
| POST | `/api/webhooks/configs` | Create a webhook configuration |
| PUT | `/api/webhooks/configs` | Update a webhook configuration |
| DELETE | `/api/webhooks/configs` | Delete a webhook configuration |
| GET | `/api/webhooks/github` | List registered GitHub webhooks |
| POST | `/api/webhooks/github` | Handle an incoming GitHub webhook event |
| GET | `/api/webhooks/register` | List webhook registrations |
| POST | `/api/webhooks/register` | Register a new webhook |
| DELETE | `/api/webhooks/register` | Unregister a webhook |
| GET | `/api/webhooks/webhook-logs` | List webhook delivery logs |

### Workflows (6)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workflows` | List all workflow YAML definitions from resources/flows/ |
| POST | `/api/workflows` | Create a new workflow YAML file |
| GET | `/api/workflows/{id}` | Get a specific workflow by ID |
| PUT | `/api/workflows/{id}` | Update a workflow YAML file |
| DELETE | `/api/workflows/{id}` | Delete a workflow YAML file |
| POST | `/api/workflows/{id}/trigger` | Trigger a workflow run inside a workspace |

### Workspaces (12)

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
| GET | `/api/workspaces/{workspace_id}/codebases/{codebase_id}/worktrees` | List worktrees for a codebase |
| POST | `/api/workspaces/{workspace_id}/codebases/{codebase_id}/worktrees` | Create a new git worktree |

### Worktrees (3)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/worktrees/{id}` | Get a single worktree |
| DELETE | `/api/worktrees/{id}` | Remove a worktree |
| POST | `/api/worktrees/{id}/validate` | Validate worktree health on disk |
