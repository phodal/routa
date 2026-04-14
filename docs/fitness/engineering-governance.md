---
dimension: engineering_governance
weight: 6
tier: normal
threshold:
  pass: 90
  warn: 80

metrics:
  - name: scripts_root_file_count_guard
    command: |
      base_ref="${ROUTA_FITNESS_CHANGED_BASE:-HEAD}"
      target_limit=20
      baseline_count=$(git ls-tree -r --name-only "$base_ref" -- scripts 2>/dev/null | awk -F/ 'NF==2' | wc -l | tr -d ' ')
      current_count=$(find scripts -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')
      baseline_count="${baseline_count:-0}"
      current_count="${current_count:-0}"
      effective_limit="$baseline_count"
      if [ "$effective_limit" -lt "$target_limit" ]; then
        effective_limit="$target_limit"
      fi
      echo "scripts_root_file_count: $current_count"
      echo "scripts_root_file_limit: $effective_limit"
      if [ "$current_count" -le "$effective_limit" ]; then
        echo "scripts_root_file_count_ok"
      else
        echo "scripts_root_file_count_blocked"
        exit 1
      fi
    pattern: "scripts_root_file_count_ok"
    hard_gate: false
    tier: fast
    execution_scope: ci
    gate: advisory
    kind: atomic
    analysis: static
    evidence_type: command
    scope: [tools]
    run_when_changed:
      - scripts/**
    description: "scripts/ 根目录文件数采用冻结预算；当前超标目录不得继续膨胀，推动按职责归类而不是继续平铺"

  - name: graph_blast_radius_probe
    command: graph:impact
    tier: normal
    execution_scope: ci
    gate: advisory
    kind: holistic
    analysis: static
    evidence_type: probe
    scope: [web, rust]
    run_when_changed:
      - src/**
      - apps/**
      - crates/**
    description: "通过代码图估算本次变更的 blast radius；图后端缺失时跳过不计分"

  - name: markdown_external_links
    command: node --import tsx tools/hook-runtime/src/check-markdown-links.ts 2>&1
    hard_gate: false
    tier: normal
    execution_scope: ci
    gate: advisory
    description: "Markdown 中的外链必须可达；429 与需要鉴权的 4xx 记为告警不阻断；外链检查受网络影响大，降级为 advisory"

  - name: todo_fixme_count
    command: |
      grep -rn "TODO\|FIXME\|XXX\|HACK" --include="*.ts" --include="*.tsx" --include="*.rs" \
        src apps crates 2>/dev/null | wc -l | awk '{print "todo_count:", $1}'
    pattern: "todo_count: [0-9]$|todo_count: [1-9][0-9]$"
    hard_gate: false
    tier: normal
    description: "TODO/FIXME 数量监控（<100）"
---

# Engineering Governance 证据

> 本文件记录仓库治理、影响面控制和工程卫生类检查，避免把这些信号继续伪装成 code quality。
>
> **核心理念**: 限制仓库结构熵增，暴露高风险改动的影响面，并把文档与技术债卫生纳入持续治理。

## 检测矩阵

| 检测项 | 阈值 | Hard Gate | 工具 |
|--------|------|-----------|------|
| scripts 根目录文件数 | 超标目录按基线冻结；当前目标上限 20，已超标时不得继续长大 | ❌ | `git ls-tree` + `find` |
| blast radius 探针 | 变更范围可解释、可视 | ❌ | `graph:impact` |
| Markdown 外链 | 外链可达（advisory，受网络影响大） | ❌ | markdown link checker |
| TODO/FIXME | <100 | ❌ | grep |

## 为什么单独成维度

这些检查都重要，但它们衡量的是不同层面的工程约束：

- `scripts_root_file_count_guard` 约束的是仓库结构和目录治理，不是单个代码文件的质量。
- `graph_blast_radius_probe` 暴露的是变更影响面和 review 风险，不是代码复杂度本身。
- `markdown_external_links` 约束的是文档和外部依赖卫生，不是实现质量。
- `todo_fixme_count` 反映的是技术债和实现卫生趋势，更接近仓库治理信号。

把它们独立出来之后：

- `code_quality` 可以回到代码本体质量和静态质量底线；
- `engineering_governance` 则专门承接仓库治理和卫生规则。

## 本地执行

```bash
# scripts 根目录冻结预算
base_ref="${ROUTA_FITNESS_CHANGED_BASE:-HEAD}"
git ls-tree -r --name-only "$base_ref" -- scripts
find scripts -maxdepth 1 -type f

# blast radius 探针
entrix run --dimension engineering_governance --tier normal --scope ci

# Markdown 外链检查
node --import tsx tools/hook-runtime/src/check-markdown-links.ts

# TODO/FIXME 统计
grep -rn "TODO\|FIXME\|XXX\|HACK" --include="*.ts" --include="*.tsx" --include="*.rs" src apps crates
```

## 相关文件

| 文件 | 用途 |
|------|------|
| `docs/fitness/code-quality.md` | 代码本体质量与静态门禁 |
| `docs/fitness/review-triggers.yaml` | review 触发规则与目录治理信号 |
| `docs/fitness/file_budgets.json` | 文件预算与历史热点冻结配置 |
| `docs/fitness/README.md` | Fitness 规则手册 |
