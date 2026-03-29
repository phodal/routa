---
dimension: code_quality
weight: 24
tier: normal
threshold:
  pass: 90
  warn: 80
groups:
  - key: structural_guardrails
    name: 结构护栏
    weight: 30
    description: 控制文件、函数和脚本入口的膨胀速度，优先约束 blast radius
  - key: duplication_and_complexity
    name: 重复与复杂度
    weight: 25
    description: 防止复制粘贴、结构性重复和复杂度失控
  - key: dependency_and_static_gates
    name: 依赖与静态门禁
    weight: 25
    description: 保持依赖关系、静态分析和跨语言编译质量稳定
  - key: implementation_hygiene
    name: 实现卫生
    weight: 20
    description: 清理调试残留、类型逃逸和日常实现噪音

metrics:
  # ══════════════════════════════════════════════════════════════
  # 结构护栏 - 优先约束 blast radius 和代码膨胀
  # ══════════════════════════════════════════════════════════════
  
  - name: legacy_hotspot_budget_guard
    group: structural_guardrails
    command: PYTHONPATH=tools/entrix python3 -m entrix.file_budgets --config tools/entrix/file_budgets.json --changed-only --base "${ROUTA_FITNESS_CHANGED_BASE:-HEAD}" --overrides-only
    pattern: "file_budget_violations: 0"
    hard_gate: true
    tier: fast
    description: "已登记的历史热点文件必须满足冻结预算，只允许缩小不允许继续膨胀"

  - name: file_line_limit
    group: structural_guardrails
    command: PYTHONPATH=tools/entrix python3 -m entrix.file_budgets --config tools/entrix/file_budgets.json --changed-only --base "${ROUTA_FITNESS_CHANGED_BASE:-HEAD}"
    pattern: "file_budget_violations: 0"
    hard_gate: false
    tier: fast
    description: "本次变更的代码文件必须满足行数预算；默认 ≤1000 行，Rust(.rs) ≤800 行，历史超标文件按 HEAD 基线冻结"

  - name: scripts_root_file_count_guard
    group: structural_guardrails
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
    group: structural_guardrails
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

  - name: function_line_limit
    group: structural_guardrails
    command: |
      # TypeScript: 检测超过 100 行的函数
      grep -rn "^[[:space:]]*\(export \)\?\(async \)\?function\|^[[:space:]]*\(export \)\?const.*= \(async \)\?(" \
        --include="*.ts" --include="*.tsx" src apps 2>/dev/null | wc -l | \
      awk '{print "function_check: scanned", $1, "definitions"}'
    pattern: "function_check: scanned"
    hard_gate: false
    tier: normal
    description: "函数行数限制 ≤100 行（需人工审查）"

  # ══════════════════════════════════════════════════════════════
  # 重复与复杂度 - 防止 AI 复制粘贴和实现失控
  # ══════════════════════════════════════════════════════════════

  - name: duplicate_code_ts
    group: duplication_and_complexity
    command: |
      changed_files=$(git diff --name-only --diff-filter=ACMR HEAD -- src apps 2>/dev/null | \
        grep -E '\.(ts|tsx|js|jsx)$' | \
        grep -vE '(^|/)(node_modules|target|\.next|_next|bundled)/' || true)
      if [ -z "$changed_files" ]; then
        echo "No changed TS/JS files"
      else
        printf '%s\n' "$changed_files" | \
          xargs npx jscpd --min-lines 20 --min-tokens 120 --reporters console --format typescript,javascript 2>&1 || \
          echo "jscpd changed-file check failed"
      fi
    pattern: "Found 0 clones|No duplicates found|No changed TS/JS files"
    hard_gate: false
    tier: deep
    description: "本次变更的 TypeScript/JavaScript 文件不应新增大块复制代码"

  - name: ast_grep_structural_smells
    group: duplication_and_complexity
    command: |
      if ! command -v ast-grep >/dev/null 2>&1 && ! command -v sg >/dev/null 2>&1; then
        echo "ast-grep not installed"
      else
        changed_files=$(git diff --name-only --diff-filter=ACMR HEAD -- src apps 2>/dev/null | \
          grep -E '\.(ts|tsx|js|jsx)$' | \
          grep -vE '(^|/)(node_modules|target|\.next|_next|bundled)/' || true)
        if [ -z "$changed_files" ]; then
          echo "No changed TS/JS files"
        else
          runner=$(command -v ast-grep >/dev/null 2>&1 && echo ast-grep || echo sg)
          cat <<'EOF' >/tmp/routa-ast-grep-rule.yml
          id: nested-response-wrapper
          language: TypeScript
          rule:
            any:
              - pattern: |
                  try {
                    $$$BODY
                  } catch ($ERR) {
                    return NextResponse.json($$$ARGS)
                  }
              - pattern: |
                  try {
                    $$$BODY
                  } catch ($ERR) {
                    console.error($$$LOG)
                    return NextResponse.json($$$ARGS)
                  }
          EOF
          printf '%s\n' "$changed_files" | xargs "$runner" scan \
            --rule /tmp/routa-ast-grep-rule.yml 2>&1 | \
          awk 'BEGIN {count=0} /^error\[nested-response-wrapper\]/ {count++} END {print "ast_grep_structural_matches:", count}'
          rm -f /tmp/routa-ast-grep-rule.yml
        fi
      fi
    pattern: "ast_grep_structural_matches: 0|No changed TS/JS files|ast-grep not installed"
    hard_gate: false
    tier: deep
    description: "用 ast-grep 检查本次变更中新增的可疑结构性包装代码"

  - name: duplicate_function_name
    group: duplication_and_complexity
    command: |
      git diff --unified=0 HEAD -- src apps 2>/dev/null | \
        grep -E '^\+[^+].*((export )?(async )?function [A-Za-z0-9_]+|const [A-Za-z0-9_]+ *= *(async )?\()' | \
        sed -E 's/.*function ([A-Za-z0-9_]+).*/\1/; s/.*const ([A-Za-z0-9_]+) *=.*/\1/' | \
        sort | uniq -d | wc -l | \
      awk '{print "duplicate_new_function_names:", $1}'
    pattern: "duplicate_new_function_names: 0"
    hard_gate: false
    tier: fast
    description: "本次变更中不应新增重复函数名"

  - name: duplicate_code_rust
    group: duplication_and_complexity
    command: |
      # Rust 重复检测（简化版，检查相似的 impl 块）
      grep -rh "^impl " crates --include="*.rs" 2>/dev/null | sort | uniq -c | \
      awk '$1 > 3 {dup++} END {print "rust_duplicate_impls:", dup+0}'
    pattern: "rust_duplicate_impls: 0"
    hard_gate: false
    tier: normal
    description: "Rust 重复 impl 块检测"

  - name: cyclomatic_complexity
    group: duplication_and_complexity
    command: |
      changed_files=$(git diff --name-only --diff-filter=ACMR "${ROUTA_FITNESS_CHANGED_BASE:-HEAD}" -- src apps 2>/dev/null | \
        grep -E '\.(ts|tsx|js|jsx)$' | \
        grep -vE '(^|/)(node_modules|target|\.next|_next|bundled)/' || true)
      if [ -z "$changed_files" ]; then
        echo "No changed TS/JS files"
      else
        count=$(printf '%s\n' "$changed_files" | \
          xargs npx eslint --rule "complexity: [error, 15]" --format compact 2>&1 | \
          grep -c "complexity" || true)
        echo "complexity_violations: ${count:-0}"
      fi
    pattern: "complexity_violations: 0|No changed TS/JS files"
    hard_gate: false
    tier: normal
    description: "本次变更的 TS/JS 文件中不得新增圈复杂度 >15 的函数"

  - name: cognitive_complexity
    group: duplication_and_complexity
    command: |
      base_ref="${ROUTA_FITNESS_CHANGED_BASE:-HEAD}"
      git diff --unified=0 "$base_ref" -- src apps 2>/dev/null | \
        grep -E '^\+[^+][[:space:]]{12,}(if|for|while)\b' | \
        wc -l | awk '{print "new_deep_nesting_count:", $1}'
    pattern: "new_deep_nesting_count: 0"
    hard_gate: false
    tier: normal
    description: "本次变更不得新增 >3 层缩进的 if/for/while 嵌套"

  # ══════════════════════════════════════════════════════════════
  # 依赖与静态门禁 - 保持依赖图和静态分析稳定
  # ══════════════════════════════════════════════════════════════

  - name: dependency_cruiser_dependency_health
    group: dependency_and_static_gates
    command: |
      changed_files=$(git diff --name-only --diff-filter=ACMR HEAD -- src apps crates 2>/dev/null | \
        grep -E '\.(ts|tsx|js|jsx)$' | \
        grep -vE '(^|/)(node_modules|target|\\.next|_next|bundled)/' || true)

      if [ -z "$changed_files" ]; then
        echo "No changed TS/JS files"
      else
        npx --yes dependency-cruiser --config .dependency-cruiser.cjs src --validate
      fi
    hard_gate: true
    tier: fast
    description: "基于 dependency-cruiser 检测变更范围内循环依赖与依赖规则违规"

  - name: eslint_pass
    group: dependency_and_static_gates
    command: npm run lint 2>&1
    hard_gate: true
    tier: fast
    description: "ESLint 必须通过"

  - name: ts_typecheck_pass
    group: dependency_and_static_gates
    command: node --import tsx tools/hook-runtime/src/typecheck-smart.ts 2>&1
    hard_gate: true
    tier: fast
    description: "TypeScript 类型检查必须通过；若检测到 stale .next types，会自动清理后重试一次"

  - name: markdown_external_links
    group: dependency_and_static_gates
    command: node --import tsx tools/hook-runtime/src/check-markdown-links.ts 2>&1
    hard_gate: true
    tier: normal
    execution_scope: ci
    description: "Markdown 中的外链必须可达；429 与需要鉴权的 4xx 记为告警不阻断"

  - name: clippy_pass
    group: dependency_and_static_gates
    command: cargo clippy --workspace -- -D warnings 2>&1
    hard_gate: true
    tier: fast
    description: "Clippy 必须通过（无警告）"

  # ══════════════════════════════════════════════════════════════
  # 实现卫生 - 收敛 AI 常见实现噪音
  # ══════════════════════════════════════════════════════════════

  - name: todo_fixme_count
    group: implementation_hygiene
    command: |
      grep -rn "TODO\|FIXME\|XXX\|HACK" --include="*.ts" --include="*.tsx" --include="*.rs" \
        src apps crates 2>/dev/null | wc -l | awk '{print "todo_count:", $1}'
    pattern: "todo_count: [0-9]$|todo_count: [1-9][0-9]$"
    hard_gate: false
    tier: normal
    description: "TODO/FIXME 数量监控（<100）"

  - name: console_log_check
    group: implementation_hygiene
    command: |
      base_ref="${ROUTA_FITNESS_CHANGED_BASE:-HEAD}"
      git diff --unified=0 "$base_ref" -- src apps 2>/dev/null | \
        grep -E '^\+[^+].*console\.(log|debug)' | \
        grep -vE 'test|spec|\.test\.' | wc -l | \
      awk '{print "new_console_log_count:", $1}'
    pattern: "new_console_log_count: 0"
    hard_gate: false
    tier: fast
    description: "本次变更不得新增生产代码中的 console.log/debug"

  - name: any_type_check
    group: implementation_hygiene
    command: |
      base_ref="${ROUTA_FITNESS_CHANGED_BASE:-HEAD}"
      git diff --unified=0 "$base_ref" -- src apps 2>/dev/null | \
        grep -E '^\+[^+].*(: any|as any)\b' | \
        wc -l | awk '{print "new_any_type_count:", $1}'
    pattern: "new_any_type_count: 0"
    hard_gate: false
    tier: normal
    description: "本次变更不得新增 `: any` 或 `as any` 类型逃逸"
---

# Code Quality 证据

> 本文件检测 AI 生成代码的常见质量问题，作为 maintainability 维度的补充证据。
>
> **核心理念**: 通过量化指标约束 AI 的"乱写空间"，防止代码膨胀和质量退化。

## 检测矩阵

### 分类视图（适配 Code Quality 适应度函数）

```mermaid
pie title Code Quality 分类权重
  "结构护栏" : 30
  "重复与复杂度" : 25
  "依赖与静态门禁" : 25
  "实现卫生" : 20
```

| 分类 | 子权重 | 关注点 | 代表指标 |
|------|--------|--------|----------|
| 结构护栏 | 30% | 文件/函数预算、脚本入口膨胀、blast radius | `legacy_hotspot_budget_guard`, `file_line_limit`, `graph_blast_radius_probe` |
| 重复与复杂度 | 25% | 复制粘贴、结构性重复、认知负担 | `duplicate_code_ts`, `ast_grep_structural_smells`, `cyclomatic_complexity` |
| 依赖与静态门禁 | 25% | 依赖图、Lint、TypeScript/Rust 静态门禁 | `dependency_cruiser_dependency_health`, `eslint_pass`, `clippy_pass` |
| 实现卫生 | 20% | 调试残留、类型逃逸、实现噪音 | `console_log_check`, `any_type_check`, `todo_fixme_count` |

> `code_quality` 仍然是总 Fitness 的一个维度（24%），但维度内部不再用“19 个平铺指标”沟通，而是先按 4 个分类看风险，再下钻到具体 metric。

### 指标清单

| 分类 | 检测项 | 阈值 | Hard Gate | 工具 |
|------|--------|------|-----------|------|
| 结构护栏 | 文件行数 | 新文件 ≤1000 行，历史超标文件按 HEAD 基线冻结 | ❌ | `python -m entrix.file_budgets` |
| 结构护栏 | 历史热点守护 | 已登记热点只允许缩小不允许继续膨胀 | ✅ | `python -m entrix.file_budgets --overrides-only` |
| 结构护栏 | scripts 根目录文件数 | 超标目录按基线冻结；当前目标上限 20，已超标时不得继续长大 | ❌ | `git ls-tree` + `find` |
| 结构护栏 | 函数行数 | ≤100 行 | ❌ | grep + 人工 |
| 结构护栏 | blast radius 探针 | 变更范围可解释、可视 | ❌ | `graph:impact` |
| 重复与复杂度 | 重复代码 | 变更文件不新增大块 clone | ❌ | jscpd |
| 重复与复杂度 | 结构坏味道 | 变更文件中结构型包装重复 = 0 | ❌ | ast-grep |
| 重复与复杂度 | 重复函数名 | 变更中新增重复名 = 0 | ❌ | git diff + grep |
| 重复与复杂度 | Rust 重复 impl | 可疑重复 impl = 0 | ❌ | grep |
| 重复与复杂度 | 圈复杂度 | 变更文件中新增 >15 复杂度函数 = 0 | ❌ | ESLint |
| 重复与复杂度 | 深层嵌套 | 新增 >3 层嵌套 = 0 | ❌ | git diff + grep |
| 依赖与静态门禁 | 依赖健康检查 | 循环依赖/依赖违规为 0 | ✅ | dependency-cruiser |
| 依赖与静态门禁 | ESLint | 0 errors | ✅ | ESLint |
| 依赖与静态门禁 | TypeScript 类型检查 | 0 errors | ✅ | smart typecheck |
| 依赖与静态门禁 | Markdown 外链 | 外链可达 | ✅ | markdown link checker |
| 依赖与静态门禁 | Clippy | 0 warnings | ✅ | Clippy |
| 实现卫生 | TODO/FIXME | <100 | ❌ | grep |
| 实现卫生 | console.log | 变更中新增数 = 0 | ❌ | git diff + grep |
| 实现卫生 | any 类型 | 新增 `any` = 0 | ❌ | git diff + grep |

## AI 特有问题

### 1. 代码膨胀
AI 倾向于生成冗长代码，缺乏抽象能力。

**约束**: 新文件 ≤1000 行；历史超标热点必须进入预算冻结，只能缩小不能继续长大；`scripts/` 根目录文件数采用冻结预算，目标收敛到 ≤20；函数 ≤100 行

### 2. 重复代码
AI 经常"复制粘贴"式生成，忽略已有实现。

**约束**: 仅检查本次变更文件，且只抓大块复制，避免为压全仓 clone 数做跨语义抽象

### 2.1 结构性重复
文本重复不一定等于坏设计，真正危险的是成批出现的结构性包装代码。

**约束**: 用 `ast-grep` 只检查本次变更中的高风险结构模式

### 3. 类型逃逸
AI 使用 `any` 绕过类型检查。

**约束**: 本次变更不得新增 `: any` 或 `as any`

### 4. 调试残留
AI 遗留 console.log 和 TODO。

**约束**: 本次变更新增 console.log/debug = 0，TODO <100

## 本地执行

```bash
# 安装 jscpd
npm install -g jscpd

# 运行 dependency-cruiser 依赖健康检查（未安装时自动临时拉取）
npx --yes dependency-cruiser --config .dependency-cruiser.cjs src --validate
# 依赖图符合规则时会输出: no dependency violations found

# 运行变更文件重复检测
git diff --name-only --diff-filter=ACMR HEAD -- src apps

# 运行结构性模式检查（需安装 ast-grep）
ast-grep scan --help

# 运行 fitness 检查
entrix run
```

## 相关文件

| 文件 | 用途 |
|------|------|
| `eslint.config.mjs` | ESLint 配置 |
| `.clippy.toml` | Clippy 配置（如有） |
| `.dependency-cruiser.cjs` | dependency-cruiser 配置 |
| `docs/fitness/README.md` | Fitness 规则手册 |

## 适应度函数映射

`code_quality` 维度内部采用“分类 -> 指标”的两层解释：

1. 先看 4 个分类的权重和覆盖范围，判断问题是结构性风险、复杂度风险、静态门禁风险还是实现卫生风险；
2. 再下钻到具体 metric，定位哪一条检查失败；
3. 最终仍由 `entrix` 执行具体 metrics，但报表和图表统一按分类汇总，避免面对一长串平铺指标时失去重点。
