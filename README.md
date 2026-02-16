# Routa JS

<div align="center">

**Multi-Agent Coordination Platform for AI Development**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.1-black.svg)](https://nextjs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Features](#features) • [Quick Start](#quick-start) • [Documentation](#documentation) • [Architecture](#architecture) • [Contributing](#contributing)

</div>

---

## Overview

Routa JS is a powerful **multi-agent coordination platform** that enables seamless collaboration between AI agents through standardized protocols. Built with TypeScript and Next.js, it provides a full-stack solution for orchestrating multiple AI agents working together on complex tasks.

The platform supports three major protocols:
- **MCP (Model Context Protocol)** - For AI model integration (Claude Code, etc.)
- **ACP (Agent Client Protocol)** - For agent communication and session management
- **Skills System** - OpenCode-compatible skill discovery and execution

Whether you're building autonomous coding assistants, orchestrating multi-agent workflows, or creating collaborative AI systems, Routa JS provides the infrastructure you need.

## ✨ Features

### Multi-Protocol Support
- **MCP Server** - Expose 12 coordination tools to AI clients via HTTP/SSE
- **ACP Agent** - Full Agent Client Protocol implementation with session management
- **Skills Registry** - Automatic discovery and loading of SKILL.md files from multiple directories

### Agent Orchestration
- **Three Agent Roles**: ROUTA (coordinator), CRAFTER (implementor), GATE (verifier)
- **Task Delegation** - Assign tasks to agents and track their progress
- **Inter-Agent Messaging** - Direct communication between agents
- **Event System** - Subscribe to agent events and coordinate workflows

### Developer Experience
- **Browser UI** - Full-featured web interface for agent management, chat, and monitoring
- **Real-time Updates** - SSE-based streaming for live agent status and messages
- **Repository Integration** - Clone and work with Git repositories
- **Skill Management** - Browse, upload, and execute skills dynamically

### Built for Production
- **TypeScript** - Full type safety across the stack
- **Next.js 15** - Modern React framework with App Router
- **In-Memory Stores** - Fast, efficient data storage (extensible to persistent stores)
- **Comprehensive Testing** - E2E tests with Playwright

## 🏗 Architecture

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

## 📋 Protocols

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

## 👥 Agent Roles

| Role | Purpose |
|------|---------|
| **ROUTA** | Coordinator - plans, delegates, orchestrates |
| **CRAFTER** | Implementor - writes code, makes changes |
| **GATE** | Verifier - reviews and validates work |

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18.x or higher
- **npm** 9.x or higher
- **Git** (for repository cloning features)

### Installation

```bash
# Clone the repository
git clone https://github.com/phodal/routa-js.git
cd routa-js

# Install dependencies
npm install --legacy-peer-deps

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to access the UI.

### Using with AI Clients

#### MCP Client Connection

Configure your MCP-compatible client (Claude Code, MCP Inspector, etc.) to connect to:
```
http://localhost:3000/api/mcp
```

The server exposes 12 coordination tools for agent management, task delegation, and event subscription.

#### ACP Client Connection

ACP-compatible clients (OpenCode, Codex, etc.) can connect to:
```
http://localhost:3000/api/acp
```

Supports session management, prompts, skill loading, and tool calls.

### Example Workflows

#### 1. Create and Delegate a Task

```typescript
// Using MCP tools
const agent = await tools.createAgent({
  workspaceId: "my-workspace",
  role: "CRAFTER",
  name: "code-agent"
});

const task = await tools.delegate({
  parentAgentId: agent.id,
  targetAgentId: agent.id,
  title: "Implement user authentication",
  description: "Add JWT-based auth to the API"
});
```

#### 2. Subscribe to Agent Events

```typescript
// Monitor agent activities in real-time
const subscription = await tools.subscribeToEvents({
  agentId: "agent-123",
  eventTypes: ["TASK_ASSIGNED", "TASK_COMPLETED", "MESSAGE_SENT"]
});
```

## 📚 Documentation

### Available Tools (MCP)

Routa JS provides 12 coordination tools accessible via MCP:

**Core Tools:**
1. `list_agents` - List all agents in a workspace
2. `read_agent_conversation` - Read another agent's conversation history
3. `create_agent` - Create ROUTA/CRAFTER/GATE agents
4. `delegate` - Assign tasks to agents
5. `message_agent` - Send messages between agents
6. `report_to_parent` - Report task completion to parent agent

**Task Lifecycle:**
7. `wake_or_create_task_agent` - Wake existing or create new task agent
8. `send_message_to_task_agent` - Send message to task's assigned agent
9. `get_agent_status` - Get current agent status
10. `get_agent_summary` - Get agent summary with recent activities

**Event Management:**
11. `subscribe_to_events` - Subscribe to workspace events
12. `unsubscribe_from_events` - Unsubscribe from events

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mcp` | GET | MCP SSE stream for real-time updates |
| `/api/mcp` | POST | MCP JSON-RPC message handling |
| `/api/acp` | GET | ACP SSE stream with session support |
| `/api/acp` | POST | ACP JSON-RPC message handling |
| `/api/agents` | GET/POST | REST API for agent management |
| `/api/skills` | GET/POST | REST API for skill management |
| `/api/sessions` | GET | Session management |

## 🛠 Development

### Project Structure

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

### Building and Testing

```bash
# Development server with hot reload
npm run dev

# Production build
npm run build

# Start production server
npm start

# Run linting
npm run lint

# Run E2E tests
npx playwright test

# Run E2E tests in UI mode
npx playwright test --ui
```

### Adding New Tools

To add a new coordination tool:

1. Define the tool in `src/core/tools/agent-tools.ts`:
```typescript
async myNewTool(params: MyParams): Promise<ToolResult> {
  // Implementation
  return successResult({ data: "result" });
}
```

2. Register it in `src/core/mcp/routa-mcp-tool-manager.ts`:
```typescript
{
  name: "my_new_tool",
  description: "Description of the tool",
  inputSchema: zodToJsonSchema(MyParamsSchema),
}
```

3. Add the handler in `src/app/api/mcp/route.ts`

### Adding Skills

Skills are discovered automatically from:
- `.opencode/skills/`
- `.claude/skills/`
- `.agents/skills/`

Create a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does
permissions:
  allow: ["read:*"]
  deny: []
---

# Skill Implementation

Skill content here...
```

## 🚢 Deployment

### Vercel (Recommended)

The project is optimized for Vercel deployment:

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

Or connect your GitHub repository to Vercel for automatic deployments.

### Docker

```bash
# Build Docker image
docker build -t routa-js .

# Run container
docker run -p 3000:3000 routa-js
```

### Environment Variables

Create a `.env.local` file for local development:

```env
# Optional: Configure custom ports
PORT=3000

# Optional: Configure workspace paths
WORKSPACE_ROOT=/path/to/workspaces
```

## 🤝 Contributing

We welcome contributions! Here's how you can help:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes**: Follow the existing code style
4. **Test your changes**: `npm run lint && npx playwright test`
5. **Commit your changes**: `git commit -m 'Add amazing feature'`
6. **Push to the branch**: `git push origin feature/amazing-feature`
7. **Open a Pull Request**

### Development Guidelines

- Write TypeScript with strict type checking
- Follow the existing code organization
- Add tests for new features
- Update documentation as needed
- Keep commits atomic and well-described

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- Uses [Agent Client Protocol](https://github.com/agentclientprotocol/sdk) for agent communication
- Inspired by the multi-agent coordination patterns in modern AI systems
- Special thanks to all [contributors](https://github.com/phodal/routa-js/graphs/contributors)

## 📮 Support

- **Issues**: [GitHub Issues](https://github.com/phodal/routa-js/issues)
- **Discussions**: [GitHub Discussions](https://github.com/phodal/routa-js/discussions)
- **Documentation**: [docs/](docs/)

## 🗺 Roadmap

- [ ] Persistent storage backend (PostgreSQL, Redis)
- [ ] WebSocket support for real-time communication
- [ ] Agent marketplace and skill sharing
- [ ] Multi-workspace support
- [ ] Advanced agent analytics and monitoring
- [ ] Integration with more AI providers
- [ ] Plugin system for custom protocols

---

<div align="center">

**[⬆ back to top](#routa-js)**

Made with ❤️ by the Routa community

</div>
