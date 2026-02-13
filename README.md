# Routa JS - Multi-Agent Coordinator (Browser + Server)

TypeScript/Next.js implementation of the Routa multi-agent coordination system with MCP + ACP + A2A protocol support.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React)                                            │
│  ├─ ChatPanel      → ACP JSON-RPC → /api/acp               │
│  ├─ AgentPanel     → REST         → /api/agents             │
│  ├─ SkillPanel     → REST         → /api/skills             │
│  └─ BrowserAcpClient + SkillClient (SSE + HTTP)             │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────────────┐
│  Next.js Server                                             │
│  ├─ /api/mcp    → MCP Server (SSE + JSON-RPC)               │
│  │   └─ RoutaMcpServer → RoutaMcpToolManager → AgentTools   │
│  ├─ /api/acp    → ACP Agent (JSON-RPC + SSE streaming)      │
│  │   └─ RoutaAcpAgent → AgentTools + SkillRegistry          │
│  ├─ /api/agents → REST API for agent management             │
│  └─ /api/skills → REST API for skill discovery              │
│                                                             │
│  Core Layer:                                                │
│  ├─ AgentTools (12 coordination tools)                      │
│  ├─ RoutaSystem (stores + event bus)                        │
│  ├─ SkillRegistry (SKILL.md discovery)                      │
│  └─ Models (Agent, Task, Message)                           │
└─────────────────────────────────────────────────────────────┘
          │                         │
          │ MCP (SSE/WS)            │ ACP (stdio/JSON-RPC)
          ▼                         ▼
   Claude Code / MCP         OpenCode / Codex
   Inspector / etc.          / external agents
```

## Protocols

### MCP (Model Context Protocol)
- **Server**: `@modelcontextprotocol/sdk` - Exposes 12 coordination tools
- **Endpoint**: `POST /api/mcp` (JSON-RPC), `GET /api/mcp` (SSE)
- **Tools**: list_agents, create_agent, delegate_task, send_message_to_agent, report_to_parent, wake_or_create_task_agent, get_agent_status, get_agent_summary, subscribe_to_events, etc.

### ACP (Agent Client Protocol)
- **Agent**: `@agentclientprotocol/sdk` - AgentSideConnection implementation
- **Endpoint**: `POST /api/acp` (JSON-RPC), `GET /api/acp?sessionId=x` (SSE)
- **Methods**: initialize, session/new, session/prompt, session/cancel, session/load, skills/list, skills/load, tools/call

### Skills (OpenCode Compatible)
- Discovers SKILL.md files from `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`
- Dynamic loading via ACP slash commands or REST API
- Pattern-based permissions (allow/deny/ask)

## Agent Roles

| Role | Purpose |
|------|---------|
| **ROUTA** | Coordinator - plans, delegates, orchestrates |
| **CRAFTER** | Implementor - writes code, makes changes |
| **GATE** | Verifier - reviews and validates work |

## Quick Start

```bash
cd routa-js
npm install --legacy-peer-deps
npm run dev
```

Open http://localhost:3000 to use the browser UI.

### MCP Client Connection

Configure your MCP client (Claude Code, etc.) to connect to:
```
http://localhost:3000/api/mcp
```

### ACP Client Connection

OpenCode or other ACP clients can connect to:
```
http://localhost:3000/api/acp
```

## Project Structure

```
src/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Main UI (Agent, Skill, Chat panels)
│   └── api/
│       ├── mcp/route.ts          # MCP Server endpoint
│       ├── acp/route.ts          # ACP Agent endpoint
│       ├── agents/route.ts       # Agent REST API
│       └── skills/route.ts       # Skills REST API
├── core/                         # Server-side core
│   ├── models/                   # Data models
│   │   ├── agent.ts              # Agent, AgentRole, AgentStatus
│   │   ├── task.ts               # Task, TaskStatus
│   │   └── message.ts            # Message, CompletionReport
│   ├── store/                    # In-memory stores
│   │   ├── agent-store.ts        # AgentStore interface + impl
│   │   ├── conversation-store.ts # ConversationStore interface + impl
│   │   └── task-store.ts         # TaskStore interface + impl
│   ├── tools/
│   │   ├── agent-tools.ts        # 12 coordination tools
│   │   └── tool-result.ts        # ToolResult type
│   ├── mcp/
│   │   ├── routa-mcp-server.ts   # MCP Server factory
│   │   └── routa-mcp-tool-manager.ts # Tool registration
│   ├── acp/
│   │   ├── routa-acp-agent.ts    # ACP Agent (AgentSideConnection)
│   │   └── acp-session-manager.ts # Session management
│   ├── skills/
│   │   ├── skill-loader.ts       # SKILL.md discovery & parsing
│   │   └── skill-registry.ts     # Runtime skill registry
│   ├── events/
│   │   └── event-bus.ts          # EventBus for inter-agent events
│   └── routa-system.ts           # Central system (stores + tools)
└── client/                       # Browser-side
    ├── acp-client.ts             # BrowserAcpClient (JSON-RPC + SSE)
    ├── skill-client.ts           # SkillClient (REST)
    ├── hooks/
    │   ├── use-acp.ts            # React hook for ACP
    │   └── use-skills.ts         # React hook for skills
    └── components/
        ├── agent-panel.tsx       # Agent management UI
        ├── skill-panel.tsx       # Skill discovery UI
        └── chat-panel.tsx        # Chat interface
```

## Dependencies

- `@modelcontextprotocol/sdk` - MCP Server (tools, resources)
- `@agentclientprotocol/sdk` - ACP Agent (sessions, prompts)
- `next` - Full-stack React framework
- `zod` - Schema validation for MCP tools
- `gray-matter` - YAML frontmatter parsing for SKILL.md
- `uuid` - ID generation
