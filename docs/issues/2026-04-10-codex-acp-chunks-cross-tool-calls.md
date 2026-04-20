---
title: "codex-acp live chunks continued into the same assistant bubble after tool calls"
date: "2026-04-10"
status: resolved
severity: medium
area: "acp"
tags: ["codex-acp", "streaming", "chat-ui", "tool-call", "desktop", "web"]
reported_by: "human"
related_issues: []
---

# codex-acp 在 tool call 后继续把 live message chunk 写进同一个 assistant 气泡

## What Happened

在 Rust standalone / desktop 路径下，`codex-acp` 的 live 会话中如果出现“先输出文本，再发起 tool call，再继续输出文本”的事件序列，后续 `agent_message_chunk` 会继续 append 到 tool call 之前的同一个 assistant message。

用户可见症状是：

- tool 卡片已经出现
- 但后续文本没有作为新的 assistant 气泡出现
- 看起来像 message chunk 被“挤到一起”
- `claude code` 路径通常不明显复现同样现象

## Expected Behavior

一旦当前 turn 中出现 `tool_call` / `tool_call_update` / `tool_call_start` / `tool_call_params_delta`，后续 assistant/thought chunk 应该开启新的流式消息，而不是续写到工具前的那条 assistant/thought 消息。

## Reproduction Context

- Environment: both
- Trigger: `codex-acp` 会话产生“assistant chunk -> tool event -> assistant chunk”的 live SSE 序列

## Why This Happened

问题不在 Rust history/transcript 的 consolidate 逻辑，而在共享前端流式消息状态机：

- `src/client/components/chat-panel/hooks/message-processor.ts` 允许 `agent_message_chunk` 在 `tool_call`、`tool_call_update`、`tool_call_start`、`tool_call_params_delta` 之后继续复用同一个 streaming message id。
- 因此只要 provider 采用“同一 turn 内交错输出文本与工具事件”的模式，后续 chunk 就会被错误续写到旧 assistant message。
- `codex-acp` 更常产生这种交错序列，所以比 `claude code` 更容易暴露问题。

## Relevant Files

- `src/client/components/chat-panel/hooks/message-processor.ts`
- `src/client/components/chat-panel/hooks/__tests__/use-chat-messages.test.tsx`

## Observations

- 对会话 `0054a058-e6a2-4cc1-a6bf-14544e4e4655` 的 persisted `history?consolidated=false` 观察到只有一长串 `agent_message_chunk`，而该会话本身没有保留下来可验证的 `tool_call` 事件，因此它不能单独证明 Rust 持久化顺序错误。
- 共享前端状态机里存在显式逻辑，允许 assistant chunk 跨 tool 事件继续合并，这与预期的 UI 边界相冲突。
- 修复方式是：
  - 不再允许 assistant/thought chunk 跨 tool 事件续写
  - 收到 tool 事件时立即重置当前 session 的 streaming message/thought id

## References

- Commit: `15abbebc` `fix(chat): split codex chunks across tool calls`
