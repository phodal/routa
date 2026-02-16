# A2A Protocol Integration Guide

This guide explains how to use Routa JS's A2A (Agent-to-Agent) protocol integration to enable external agents to discover and interact with backend sessions.

## Overview

The A2A protocol integration allows external A2A-compatible agents to:
- Discover Routa as an available agent
- List active backend sessions
- Call coordination methods (create agents, delegate tasks, send messages)
- Subscribe to session events via Server-Sent Events

## Discovery

### Agent Card

External agents can discover Routa's capabilities by fetching the agent card:

```bash
curl http://localhost:3000/api/a2a/card
```

Response:
```json
{
  "name": "Routa Multi-Agent Coordinator",
  "description": "Multi-agent coordination platform with ACP and MCP support",
  "protocolVersion": "0.3.0",
  "version": "0.1.0",
  "url": "http://localhost:3000/api/a2a/rpc",
  "skills": [
    {
      "id": "coordination",
      "name": "Agent Coordination",
      "description": "Create, delegate tasks to, and coordinate multiple AI agents"
    },
    {
      "id": "acp-proxy",
      "name": "ACP Session Proxy",
      "description": "Proxy access to backend ACP agent sessions"
    }
  ],
  "capabilities": {
    "pushNotifications": true
  }
}
```

### Active Sessions

List all active backend sessions:

```bash
curl http://localhost:3000/api/a2a/sessions
```

Response:
```json
{
  "sessions": [
    {
      "id": "abc123",
      "agentName": "routa-opencode-abc123",
      "provider": "opencode",
      "status": "connected",
      "capabilities": ["initialize", "session/new", "session/prompt", ...],
      "rpcUrl": "http://localhost:3000/api/a2a/rpc?sessionId=abc123",
      "eventStreamUrl": "http://localhost:3000/api/a2a/rpc?sessionId=abc123",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "count": 1
}
```

## JSON-RPC Methods

### Initialize

Initialize connection with Routa:

```bash
curl -X POST http://localhost:3000/api/a2a/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize"
  }'
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "0.3.0",
    "agentInfo": {
      "name": "routa-a2a-bridge",
      "version": "0.1.0"
    },
    "capabilities": {
      "sessions": true,
      "coordination": true
    }
  }
}
```

### Method List

List available methods:

```bash
curl -X POST http://localhost:3000/api/a2a/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "method_list"
  }'
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "methods": [
      "method_list",
      "initialize",
      "session/new",
      "session/prompt",
      "session/cancel",
      "session/load",
      "list_agents",
      "create_agent",
      "delegate_task",
      "message_agent"
    ]
  }
}
```

## Coordination Methods

### List Agents

List all agents in a workspace:

```bash
curl -X POST http://localhost:3000/api/a2a/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "list_agents",
    "params": {
      "workspaceId": "default"
    }
  }'
```

### Create Agent

Create a new agent:

```bash
curl -X POST http://localhost:3000/api/a2a/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "create_agent",
    "params": {
      "name": "external-crafter",
      "role": "CRAFTER",
      "workspaceId": "default"
    }
  }'
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "success": true,
    "data": {
      "agentId": "995e341f-8c40-4c11-8b69-52fdfb460376",
      "name": "external-crafter",
      "role": "CRAFTER",
      "status": "PENDING"
    }
  }
}
```

### Delegate Task

Delegate a task to an agent:

```bash
curl -X POST http://localhost:3000/api/a2a/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "delegate_task",
    "params": {
      "agentId": "agent-id",
      "taskId": "task-id",
      "callerAgentId": "caller-agent-id"
    }
  }'
```

### Message Agent

Send a message between agents:

```bash
curl -X POST http://localhost:3000/api/a2a/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 6,
    "method": "message_agent",
    "params": {
      "fromAgentId": "sender-id",
      "toAgentId": "receiver-id",
      "message": "Hello from external agent!"
    }
  }'
```

## Session-Specific Methods

To interact with a specific backend session, include `sessionId` as a query parameter:

```bash
curl -X POST "http://localhost:3000/api/a2a/rpc?sessionId=abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 7,
    "method": "session/prompt",
    "params": {
      "prompt": "What tasks are assigned to me?"
    }
  }'
```

## Server-Sent Events

Subscribe to real-time session updates:

```bash
curl -N "http://localhost:3000/api/a2a/rpc?sessionId=abc123"
```

The server will stream events as they occur:

```
data: {"jsonrpc":"2.0","method":"notification","params":{"type":"connected","sessionId":"abc123"}}

data: {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"abc123","update":{...}}}
```

## Error Handling

All errors follow JSON-RPC error format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": "Session abc123 not found"
  }
}
```

Common error codes:
- `-32600` - Invalid Request
- `-32603` - Internal error
- `-32700` - Parse error

## Using with A2A-compatible Clients

To use Routa with an A2A-compatible client library:

```typescript
import { A2AClient } from '@a2a-js/sdk/client';

// Create client pointing to Routa
const client = new A2AClient({
  url: 'http://localhost:3000/api/a2a/rpc'
});

// Initialize connection
await client.initialize();

// List agents
const agents = await client.call('list_agents', {
  workspaceId: 'default'
});

// Create an agent
const newAgent = await client.call('create_agent', {
  name: 'my-agent',
  role: 'CRAFTER',
  workspaceId: 'default'
});
```

## Best Practices

1. **Session Discovery**: Always list sessions first to find available backend agents
2. **Error Handling**: Check for JSON-RPC error responses and handle appropriately
3. **Validation**: Ensure required parameters are provided for each method
4. **CORS**: The A2A endpoints include CORS headers for cross-origin access
5. **Monitoring**: Use SSE streams to monitor session events in real-time

## Security Considerations

- The current implementation does not include authentication
- All A2A endpoints are open with CORS enabled
- For production use, add authentication middleware
- Consider rate limiting for external access
- Validate all input parameters (currently implemented)

## Next Steps

- Add authentication/authorization for A2A endpoints
- Implement session/task forwarding to backend ACP processes
- Add webhook support for push notifications
- Extend method list with more coordination capabilities
