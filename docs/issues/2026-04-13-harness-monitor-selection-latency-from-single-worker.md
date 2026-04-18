---
title: "Harness monitor 文件切换仍会被 facts / git history enrichment 拖慢"
date: "2026-04-13"
kind: issue
status: open
severity: high
area: "harness-monitor"
tags: ["harness-monitor", "tui", "performance", "selection-latency", "background-worker"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-13-harness-monitor-user-value-gap-to-decision-console.md"
  - "docs/issues/2026-04-12-harness-monitor-task-tracking-from-codex-hooks.md"
github_issue: null
github_state: null
github_url: null
---

# Harness monitor 文件切换仍会被 facts / git history enrichment 拖慢

## What Happened

`crates/harness-monitor` 当前已经补上了：

- transcript/session recovery
- prompt-first runs
- lazy file preview 的首屏 100 行加载

但在真实仓库里切换 `Git Status` / `Change Status` 选中项时，UI 仍然会明显发卡，尤其是大仓库或 dirty files 较多时更明显。

当前实现已经不再是“一个 omnibus worker”：

- preview / diff 走独立 preview worker
- facts / git history / diff stats 走 facts worker
- fitness / test mapping / scc 走 eval worker

但选中项切换时的感知延迟仍然存在，因为 facts lane 里仍把这些 enrichment 串在一起：

- diff stats
- file facts
- git history count

其中 `git history` 仍会触发 `git log --follow`，而这条慢路径会继续拖住 facts/enrichment 结果返回，进而让用户把“元数据未跟上”感知成“切换发卡”。

## Expected Behavior

用户切换文件或 run 选中项时，预览内容应尽快更新，不能因为慢元数据任务而排队。

更具体地说：

- 文件预览 / diff 应属于 selection-critical path
- facts / git history / test mapping / fitness / scc 应属于 background enrichment path
- 即使 enrichment 很慢，主交互也应保持可用

## Reproduction Context

- Environment: desktop TUI / terminal TUI
- Trigger: 在存在多个 dirty files、snapshot 文件、大型 repo 或慢 `git log --follow` 的仓库中切换选中项

## Why This Might Happen

- selection-critical preview 已经拆出独立 worker，但 facts lane 仍把 `diff stats / facts / git history` 串在一个后台路径里
- `git log --follow` 仍然是慢点，容易在 enrichment lane 里形成 head-of-line blocking
- UI 仍会把一部分 enrichment 缺失感知成“当前切换没完成”，所以用户体感上仍像选中项切换被拖慢

## Relevant Files

- `crates/harness-monitor/src/ui/cache.rs`
- `crates/harness-monitor/src/ui/tui.rs`
- `crates/harness-monitor/src/ui/panels.rs`
- `/Users/phodal/ai/codex/codex-rs/tui/src/app.rs`
- `/Users/phodal/ai/codex/codex-rs/tui/src/file_search.rs`
- `/Users/phodal/ai/codex/codex-rs/tui/src/tui/frame_requester.rs`

## Observations

- 已经做过一次 lazy preview，只读前 100 行，说明热点已从“读整文件”部分转移到“facts / git history enrichment 竞争”
- `codex-rs` 更接近 event-driven + feature-owned async tasks，而不是一个 omnibus worker
- 这张 issue 的根因表述需要更新：问题还在，但已经不是“single worker”，而是 “facts lane 仍然过宽”
- 这一问题不只是性能问题，也直接影响 run/session 旅程在 UI 上的可信度，因为用户会把延迟误判成状态错误

## References

- `docs/issues/2026-04-13-harness-monitor-user-value-gap-to-decision-console.md`
