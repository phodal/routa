---
title: "[GitHub #43] Customize Routa Flow"
date: "2026-02-28"
status: resolved
severity: medium
area: "github"
tags: ["github", "github-sync", "gh-43"]
reported_by: "phodal"
related_issues: ["https://github.com/phodal/routa/issues/43"]
github_issue: 43
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/43"
---

# [GitHub #43] Customize Routa Flow

## Sync Metadata

- Source: GitHub issue sync
- GitHub Issue: #43
- URL: https://github.com/phodal/routa/issues/43
- State: closed
- Author: phodal
- Created At: 2026-02-28T13:24:23Z
- Updated At: 2026-03-01T02:14:51Z

## Labels

- (none)

## Original GitHub Body

# Customize Routa Flow

自定义 Flow 示例，由多个 ACP Agent 组成的完整 SDLC 流程。

## 🎯 Overview

This issue tracks the implementation of a customizable multi-agent workflow system that orchestrates the complete software development lifecycle from issue creation to deployment verification.

## 📋 Sub-Issues

- #37 - Event-driven webhook triggers for agents (PR, CI, Slack, Linear) — **基础设施** ✅ Phase 1 完成

## 📋 Required Capabilities

### 1. Event-Driven Trigger System (依赖 #37) ✅ 已实现

> ✅ Phase 1 已在 commit `20473e5` 中实现，基于 `src/core/webhooks/` 模块

- [x] **GitHub Webhook Receiver** — `POST /api/webhooks/github`
  - [x] HMAC-SHA256 签名验证（`github-webhook-handler.ts`）
  - [x] Webhook 配置 CRUD（`/api/webhooks/configs`）
  - [x] 审计日志（`/api/webhooks/webhook-logs`）
  - [x] 支持 events: `issues`, `pull_request`, `check_run`, `push`, `issue_comment`

- [x] **Background Task Dispatch**
  - [x] 事件匹配 → `createBackgroundTask()` → 队列到指定 Agent
  - [x] 支持 `claude-code`、`glm-4` 等 Agent

  - [ ] PR opened → 触发代码审查流程
  - [ ] CI failure → 触发调查修复 Agent
  - [ ] Issue labeled → 触发需求细化流程

### 2. Claude Code SDK Adapter（✅ 已实现）

> Routa 的核心 Agent 运行时基于 `ClaudeCodeSdkAdapter`（`src/core/acp/claude-code-sdk-adapter.ts`），封装 `@anthropic-ai/claude-agent-sdk`，通过 JSONL stream 与 `cli.js` 通信。

**已支持能力：**
- [x] **ACP-compatible streaming** — `promptStream()` 返回 SSE AsyncGenerator
- [x] **Multi-turn 会话** — `sdkSessionId` + `continue: true` + `resume`
- [x] **Per-instance 配置** — model / maxTurns / baseUrl / apiKey 运行时覆盖
- [x] **Skill 系统** — 通过 `systemPrompt.append` 注入 SKILL.md 内容
- [x] **工具调用** — Read, Write, Edit, Bash, Glob, Grep, Skill
- [x] **Serverless 支持** — Vercel Lambda (cli.js 路径解析 + `/tmp/.claude` 重定向)
- [x] **GLM 兼容** — 对不发 `stream_event` 的后端（如 GLM）自动降级为 `assistant` 块分发

**GLM / BigModel 集成方式（两条路径）：**

1. **Claude Code SDK Adapter + baseUrl 覆盖**
   - 设置 `ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`
   - 通过 `agent-instance-factory.ts` 的 `baseUrl` 参数注入

2. **OpenCode SDK Adapter**（`opencode-sdk-adapter.ts`）
   - 默认: `https://open.bigmodel.cn/api/coding/paas/v4`，模型 `glm-5.1`
   - 环境变量: `OPENCODE_BASE_URL`, `OPENCODE_MODEL_ID`

### 3. Requirement Refinement Agent

> 基于 `ClaudeCodeSdkAdapter`，通过 Specialist 配置 + Skills 注入实现

- [ ] **Issue Refinement Specialist** — `resources/specialists/issue-refiner.md`
  - [ ] 基于 `ClaudeCodeSdkAdapter` + Specialist prompt
  - [ ] 通过 `systemPrompt.append` 注入搜索 Skill（如 Web Search SKILL.md）
  - [ ] 需求提取与澄清（从 issue body 解析关键信息）
  - [ ] 生成精炼需求和 prompt
  - [ ] 通过 GitHub API 更新 issue 描述

- [ ] **搜索能力**
  - [ ] 通过 `Bash` 工具调用搜索（`curl` GitHub API / 第三方搜索）
  - [ ] 或通过 MCP Server 提供搜索工具（如 `@anthropic/web-search-mcp`）
  - [ ] 搜索结果格式化与摘要

### 4. Implementation Planning & Execution

> 基于 Routa Orchestrator（`src/core/orchestration/orchestrator.ts`）现有的 **Coordinator → Crafter → Gate** 层级委派模式

- [x] **Hierarchical Delegation** — ROUTA(Coordinator) → CRAFTER(Implementor) → GATE(Verifier)
  - [x] 最大委派深度 2 层（`delegation-depth.ts`）
  - [x] DelegationGroup 等待模式（`immediate` / `after_all`）
  - [x] `@@@task` block 解析（`task-block-parser.ts`）

- [x] **Multi-Provider Orchestration**
  - [x] Per-role provider/model 覆盖（`crafterModel`, `gateModel`, `routaModel`）
  - [x] `AgentInstanceConfig` 支持 model / provider / baseUrl / apiKey
  - [x] Provider Registry 模型层级（fast / balanced / smart）

- [ ] **扩展**
  - [ ] 任务分解输出格式标准化（与 Flow 系统对接）
  - [ ] 进度追踪可视化（跨 Agent 执行状态）
  - [ ] Commit 消息与 issue/task 可追溯性

### 5. Automated Testing with Playwright

> 基于 `ClaudeCodeSdkAdapter` + Specialist 配置

- [ ] **Test Generator Specialist** — `resources/specialists/test-generator.md`
  - [ ] Specialist 配置（基于 `ClaudeCodeSdkAdapter`）
  - [ ] 从需求生成 Playwright 测试用例
  - [ ] 通过 `Bash` 工具执行 `npx playwright test`
  - [ ] 集成现有 `playwright.config.ts`

- [ ] **Test Execution Infrastructure**
  - [ ] Background Task 触发测试运行
  - [ ] 测试结果存储与报告
  - [ ] Screenshot/trace 管理

### 6. Code Review Automation

> 基于 Specialist 系统（`resources/specialists/gate.md` 已有基础）

- [x] **GATE Specialist** — 已实现
  - [x] 验证实现是否满足 acceptance criteria
  - [x] Evidence-driven review（不直接修改代码）

- [ ] **PR Review Agent**
  - [ ] 基于 specialist 配置 + `ClaudeCodeSdkAdapter`
  - [ ] Git diff 分析（通过 `Read` / `Bash` 工具）
  - [ ] Review comment 生成并发布到 PR
  - [ ] 安全和质量检查
  - [ ] 支持多 provider（claude-code / copilot / auggie / kiro 等 ACP agent）

### 7. Workflow Orchestration

> 需要新增 YAML 配置驱动的 Flow 引擎，基于现有 `orchestrator.ts` + `background-task` 基础设施扩展

- [ ] **Flow Definition Schema** — `src/core/workflows/flow-schema.ts`
  - [ ] YAML 配置文件定义 Flow（见下方示例）
  - [ ] Flow 验证与解析
  - [ ] 支持条件分支（`branches` + `condition`）
  - [ ] 支持并行（`parallel`）和串行执行

- [ ] **Flow Executor** — `src/core/workflows/flow-executor.ts`
  - [ ] 基于 BackgroundTask 队列执行 Flow 步骤
  - [ ] 步骤间状态传递
  - [ ] 错误处理与重试（复用 `maxAttempts`）
  - [ ] Flow 监控与日志

- [ ] **Flow Templates**
  - [ ] 预置模板：SDLC、Hotfix、Feature、Code Review
  - [ ] 模板自定义 UI
  - [ ] Flow 版本管理

### 8. Integration & Infrastructure

- [x] **Background Task Queue** ✅
  - [x] `/api/background-tasks` CRUD
  - [x] `triggerSource: "webhook" | "manual" | "schedule"`
  - [x] Event-triggered task creation（via #37）

- [x] **Event Bus** ✅
  - [x] `AgentEventBus` / `AgentEventBridge` 已实现
  - [x] `REPORT_SUBMITTED` event 唤醒 parent agent

- [ ] **Flow Monitoring Dashboard**
  - [ ] 活跃 Flow 可视化
  - [ ] 执行历史
  - [ ] Agent 活动追踪
  - [ ] 性能指标

### 9. Configuration & Setup

- [ ] **Environment Variables**
  - [x] `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` — Claude Code SDK
  - [x] `ANTHROPIC_BASE_URL` — API 端点（可指向 BigModel）
  - [x] `ANTHROPIC_MODEL` — 模型覆盖
  - [x] `GITHUB_TOKEN` — GitHub API 访问
  - [x] `GITHUB_WEBHOOK_SECRET` — Webhook 签名验证（from #37）
  - [ ] `OPENCODE_BASE_URL` — OpenCode/GLM API 端点
  - [ ] `OPENCODE_MODEL_ID` — OpenCode 模型
  - [ ] `FLOW_CONFIG_PATH` — 自定义 Flow 配置目录

## 🔄 Example Flow: Complete SDLC

```yaml
name: "Complete SDLC Flow"
trigger:
  type: webhook           # 事件驱动（基于 #37 webhook 基础设施）
  source: github
  event: issues.opened
  filter:
    labels: ["feature", "enhancement"]

steps:
  - name: "Refine Requirements"
    specialist: issue-refiner       # Specialist ID（从 resources/specialists/ 加载）
    adapter: claude-code-sdk        # 基于 ClaudeCodeSdkAdapter
    config:
      model: "claude-sonnet-4-20250514"
      skills: ["web-search"]        # 通过 systemPrompt.append 注入
    actions:
      - search_similar_issues
      - extract_requirements
      - update_issue_description

  - name: "Plan Implementation"
    specialist: routa               # ROUTA Coordinator specialist
    adapter: claude-code-sdk
    config:
      model: "claude-sonnet-4-20250514"
    actions:
      - decompose_tasks             # 解析 @@@task blocks
      - assign_to_specialists       # 委派到 CRAFTER/GATE

  - name: "Implement Features"
    parallel:                       # 并行执行
      - specialist: crafter         # CRAFTER specialist
        adapter: claude-code-sdk
        config:
          model: "claude-sonnet-4-20250514"
      - specialist: crafter
        adapter: opencode-sdk       # 或使用 OpenCode SDK (GLM)
        config:
          baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4"
          model: "glm-5.1"

  - name: "Generate Tests"
    specialist: test-generator
    adapter: claude-code-sdk
    config:
      model: "claude-sonnet-4-20250514"
    actions:
      - generate_playwright_tests   # 通过 Bash 工具生成
      - run_tests                   # 通过 Bash 执行 npx playwright test

  - name: "Code Review"
    specialist: gate                # GATE Verifier specialist
    adapter: claude-code-sdk
    actions:
      - review_changes
      - post_comments

  - name: "Handle Build Result"
    trigger:
      type: webhook
      source: github
      event: check_run.completed
    branches:
      - condition: "conclusion == 'success'"
        actions:
          - update_pr_status
          - notify_reviewers
      - condition: "conclusion == 'failure'"
        specialist: developer       # DEVELOPER specialist（独立修复）
        actions:
          - analyze_failure
          - attempt_fix
```

## 🏗️ Architecture

### 现有模块（已实现）

| 模块 | 路径 | 状态 |
|------|------|------|
| **Claude Code SDK Adapter** | `src/core/acp/claude-code-sdk-adapter.ts` | ✅ |
| **OpenCode SDK Adapter** | `src/core/acp/opencode-sdk-adapter.ts` | ✅ |
| **Agent Instance Factory** | `src/core/acp/agent-instance-factory.ts` | ✅ |
| **Provider Registry** | `src/core/acp/provider-registry.ts` | ✅ |
| **Orchestrator** | `src/core/orchestration/orchestrator.ts` | ✅ |
| **Specialists** | `resources/specialists/{routa,crafter,gate,developer}.md` | ✅ |
| **Webhook Triggers** | `src/core/webhooks/` + `/api/webhooks/` | ✅ |
| **Background Tasks** | `src/core/background-worker/` + `/api/background-tasks/` | ✅ |
| **Event Bus** | `src/core/events/` | ✅ |
| **ACP Process Manager** | `src/core/acp/acp-process-manager.ts` | ✅ |

### 待实现模块

| 模块 | 路径 | 依赖 |
|------|------|------|
| **Flow Schema** | `src/core/workflows/flow-schema.ts` | 新增 |
| **Flow Executor** | `src/core/workflows/flow-executor.ts` | orchestrator + background-task |
| **Issue Refiner Specialist** | `resources/specialists/issue-refiner.md` | adapter + skills |
| **Test Generator Specialist** | `resources/specialists/test-generator.md` | adapter + Bash |
| **Flow Templates** | `resources/flows/*.yaml` | flow-schema |
| **Flow Monitoring UI** | `src/app/flows/` | flow-executor |

### 数据库 Schema（已有 + 待扩展）

```sql
-- ✅ 已有（#37 实现）
github_webhook_configs  -- Webhook trigger 配置
webhook_trigger_logs    -- Webhook 审计日志
background_tasks        -- 后台任务队列

-- 待新增
flows                  -- Flow 定义和状态
flow_executions        -- Flow 执行历史
flow_step_results      -- 每个步骤执行结果
```

## 📊 Success Criteria

- [x] Webhook 事件触发 Agent（via #37）✅
- [x] 多 Agent 通过 Orchestrator 协调 ✅
- [ ] YAML Flow 配置驱动完整 SDLC 流程
- [ ] 从 Issue 创建到 PR merge 的端到端执行
- [ ] 测试自动生成并执行
- [ ] Code review 反馈发布到 PR
- [ ] CI 失败触发调查 Agent
- [ ] Flow 执行在监控 Dashboard 可视化

## 🔗 Related

- **Sub-issue**: #37 - Event-driven webhook triggers ✅ Phase 1 完成
- Existing orchestration: `src/core/orchestration/orchestrator.ts`
- Background tasks: `src/app/api/background-tasks/`
- Agent coordination: `src/core/acp/routa-acp-agent.ts`
- Claude Code SDK: `src/core/acp/claude-code-sdk-adapter.ts`
- Specialists: `resources/specialists/`
- Playwright config: `playwright.config.ts`
