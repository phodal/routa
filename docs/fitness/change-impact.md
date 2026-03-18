---
dimension: change_impact
weight: 6
tier: normal
threshold:
  pass: 90
  warn: 75

metrics:
  - name: graph_probe_runs
    command: python3 docs/fitness/scripts/graph_fitness.py --base HEAD --max-depth 2 --max-impacted-files 250 2>&1
    pattern: "graph_probe_status: ok|graph_probe_status: skipped"
    hard_gate: false
    tier: normal
    description: "验证 graph-backed change impact probe 可以在当前仓库运行；依赖缺失时允许跳过"

  - name: graph_blast_radius_threshold
    command: python3 docs/fitness/scripts/graph_fitness.py --base HEAD --max-depth 2 --max-impacted-files 250 2>&1
    pattern: "graph_wide_blast_radius: no|graph_wide_blast_radius: skipped"
    hard_gate: false
    tier: normal
    description: "如果本次改动影响过多文件，则标记为宽 blast radius；依赖缺失时跳过"
---

# Change Impact 证据

> Spike 维度：验证 code-review-graph 是否可以作为 fitness 的变更影响证明器。

## 当前目标

- 能在 Routa 仓库上完成建图或增量更新
- 能针对本次代码改动给出 impacted files 数量
- 能输出适合 frontmatter runner 消费的纯文本指标

## 当前边界

- 这是本地 spike，不是正式门禁
- 当前命令优先尝试导入已安装的 `code_review_graph`
- 需要调试本地源码版时，可设置 `ROUTA_CODE_REVIEW_GRAPH_SOURCE=/abs/path/to/code-review-graph`
- 后续若正式接入，需要把运行时依赖和缓存路径收敛成仓库级约定
