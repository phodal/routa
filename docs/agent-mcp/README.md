# MCP Implementation for Routa-JS

This document describes the MCP (Model Context Protocol) implementation for connecting AI providers (Claude Code, Codex, OpenCode) to the Routa MCP server.

## Overview

The Routa MCP server exposes coordination tools via HTTP at `/api/mcp`. AI providers can connect to this server using MCP to access multi-agent coordination capabilities.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Routa-JS Application                        │
│                                                                     │
│  ┌────────────────┐         ┌──────────────────┐                  │
│  │  Next.js App   │         │  Routa MCP       │                  │
│  │  /api/mcp      │◄────────│  Server          │                  │
│  │  (HTTP API)    │         │  (createRouta    │                  │
│  └────────────────┘         │   McpServer)     │                  │
│         ▲                   └──────────────────┘                  │
│         │                            │                             │
│         │                            ▼                             │
│         │                   ┌──────────────────┐                  │
│         │                   │  AgentTools      │                  │
│         │                   │  (Coordination)  │                  │
│         │                   └──────────────────┘                  │
└─────────┼───────────────────────────────────────────────────────────┘
          │
          │ MCP over HTTP
          │
┌─────────┼───────────────────────────────────────────────────────────┐
│         │                                                           │
│  ┌──────▼──────┐    ┌──────────────┐    ┌──────────────┐          │
│  │  Claude     │    │  Codex       │    │  OpenCode    │          │
│  │  Code       │    │  (codex-acp) │    │              │          │
│  │             │    │              │    │              │          │
│  │  --mcp-     │    │  --mcp-      │    │  --mcp-      │          │
│  │  config     │    │  config      │    │  config      │          │
│  └─────────────┘    └──────────────┘    └──────────────┘          │
│                                                                     │
│                    AI Provider Processes                            │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. MCP Server (`/api/mcp/route.ts`)

The HTTP endpoint that exposes MCP tools:

- **GET /api/mcp** - SSE stream for MCP messages
- **POST /api/mcp** - Send MCP JSON-RPC messages

Supported methods:
- `initialize` - Initialize MCP connection
- `tools/list` - List available tools
- `tools/call` - Execute a tool

### 2. MCP Configuration Generator (`mcp-config-generator.ts`)

Generates MCP configuration JSON for providers:

```typescript
import { generateRoutaMcpConfigJson } from './mcp-config-generator';

const mcpConfigJson = generateRoutaMcpConfigJson({
  routaServerUrl: 'http://localhost:3000',
  workspaceId: 'my-workspace'
});
// Returns: '{"name":"routa-coordination","type":"http","url":"http://localhost:3000/api/mcp",...}'
```

### 3. MCP Setup Helpers (`mcp-setup.ts`)

Provider-specific MCP setup functions:

```typescript
import { setupMcpForCodex, setupMcpForClaudeCode, setupMcpForOpenCode } from './mcp-setup';

// Setup for Codex
const codexMcp = setupMcpForCodex({ routaServerUrl: 'http://localhost:3000' });

// Setup for Claude Code
const claudeMcp = setupMcpForClaudeCode({ routaServerUrl: 'http://localhost:3000' });

// Setup for OpenCode
const opencodeMcp = setupMcpForOpenCode({ routaServerUrl: 'http://localhost:3000' });
```

### 4. ACP Process Integration

Updated `AcpProcess` and `ClaudeCodeProcess` to support MCP configs:

```typescript
import { AcpProcess } from './acp-process';
import { buildConfigFromPreset } from './opencode-process';
import { setupMcpForCodex } from './mcp-setup';

const mcpConfigs = setupMcpForCodex({ routaServerUrl: 'http://localhost:3000' });
const config = buildConfigFromPreset('codex', '/workspace', [], {}, mcpConfigs);
const process = new AcpProcess(config, (notification) => {
  console.log('Notification:', notification);
});
await process.start();
```

## Available MCP Tools

The Routa MCP server exposes the following coordination tools:

1. **list_agents** - List all agents in the workspace
2. **read_agent_conversation** - Read conversation history of another agent
3. **create_agent** - Create a new agent (ROUTA/CRAFTER/GATE)
4. **delegate_task** - Assign a task to an agent
5. **send_message_to_agent** - Send message from one agent to another
6. **report_to_parent** - Submit completion report to parent agent
7. **wake_or_create_task_agent** - Wake existing or create new agent for a task
8. **send_message_to_task_agent** - Send message to task's assigned agent
9. **get_agent_status** - Get agent status, message count, and tasks
10. **get_agent_summary** - Get agent summary with last response and active tasks
11. **subscribe_to_events** - Subscribe to workspace events
12. **unsubscribe_from_events** - Remove an event subscription

## Usage Examples

See `src/core/acp/mcp-example.ts` for complete examples.

### Quick Start

```typescript
import { startCodexWithMcp } from './mcp-example';

// Start Codex with MCP enabled
const process = await startCodexWithMcp('/path/to/workspace');
```

### Environment Variables

```bash
export ROUTA_SERVER_URL=http://localhost:3000
export ROUTA_WORKSPACE_ID=my-workspace
```

## Testing

To test the MCP implementation:

1. Start the routa-js server:
   ```bash
   npm run dev
   ```

2. Verify the MCP endpoint is accessible:
   ```bash
   curl -X POST http://localhost:3000/api/mcp \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
   ```

3. Start a provider with MCP:
   ```bash
   # Example with Codex (if it supports --mcp-config)
   codex-acp --mcp-config '{"name":"routa","type":"http","url":"http://localhost:3000/api/mcp"}'
   ```

## Provider Support

| Provider | MCP Support | Flag | Status |
|----------|-------------|------|--------|
| Claude Code | ✅ Yes | `--mcp-config` | Implemented |
| Codex | ⚠️ TBD | `--mcp-config` | Implemented (needs verification) |
| OpenCode | ⚠️ TBD | `--mcp-config` | Implemented (needs verification) |
| Auggie | ✅ Yes | `--mcp-config` | Implemented |
| Gemini | ⚠️ TBD | `--mcp-config` | Implemented (needs verification) |

**Note**: Some providers may not support the `--mcp-config` flag. Check the provider's documentation for MCP support.

## Files Modified/Created

### Created:
- `src/core/acp/mcp-config-generator.ts` - MCP configuration generator
- `src/core/acp/mcp-setup.ts` - Provider-specific MCP setup helpers
- `src/core/acp/mcp-example.ts` - Usage examples
- `src/core/acp/MCP_SETUP_GUIDE.md` - Detailed setup guide
- `MCP_IMPLEMENTATION.md` - This file

### Modified:
- `src/core/acp/opencode-process.ts` - Added `mcpConfigs` to `AcpProcessConfig`
- `src/core/acp/acp-process.ts` - Added MCP config handling in `start()` method
- `src/core/acp/index.ts` - Added MCP exports

## Next Steps

1. **Test with actual providers** - Verify that Codex and OpenCode support `--mcp-config`
2. **Add validation** - Implement MCP config validation before starting processes
3. **Error handling** - Add better error messages for MCP connection failures
4. **Documentation** - Add more examples and troubleshooting guides
5. **UI Integration** - Add UI controls for enabling/disabling MCP per provider

