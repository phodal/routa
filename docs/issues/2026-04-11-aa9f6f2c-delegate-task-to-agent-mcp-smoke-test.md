---
title: "Smoke test for delegate_task_to_agent MCP tool"
date: "2026-04-11"
kind: issue
status: open
severity: medium
area: mcp-tools
tags: [smoke-test, delegate-task, mcp, crafter]
reported_by: kiro
github_issue: null
github_state: null
github_url: null
---

# Smoke test for delegate_task_to_agent MCP tool - validates the execution path by creating a task and delegating it to a CRAFTER agent

## Scope

Smoke test for delegate_task_to_agent MCP tool - validates the execution path by creating a task and delegating it to a CRAFTER agent

## Acceptance Criteria

1. Task created successfully via /api/tasks
2. delegate_task_to_agent returns success=true with taskId and agentId
3. Response contains proper delegation payload with specialist type

## Verification Commands

```
cd crates/routa-server && cargo test api_mcp_tools_delegate_task_to_agent_contract -- --nocapture
```

## Test Cases

Test creating a task then delegating it to CRAFTER agent via delegate_task_to_agent tool call