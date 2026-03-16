---
dimension: maintainability
weight: 14
threshold:
  pass: 90
  warn: 80

metrics:
  # ══════════════════════════════════════════════════════════════
  # 代码膨胀检测 - 防止 AI 生成过长代码
  # ══════════════════════════════════════════════════════════════
  
  - name: file_line_limit
    command: |
      find src apps crates -name '*.ts' -o -name '*.tsx' -o -name '*.rs' 2>/dev/null | \
      xargs wc -l 2>/dev/null | grep -v total | \
      awk '$1 > 1000 {count++} END {print "files_over_1000_lines:", count+0}'
    pattern: "files_over_1000_lines: 0"
    hard_gate: false
    description: "文件行数限制 ≤1000 行"

  - name: function_line_limit
    command: |
      # TypeScript: 检测超过 100 行的函数
      grep -rn "^[[:space:]]*\(export \)\?\(async \)\?function\|^[[:space:]]*\(export \)\?const.*= \(async \)\?(" \
        --include="*.ts" --include="*.tsx" src apps 2>/dev/null | wc -l | \
      awk '{print "function_check: scanned", $1, "definitions"}'
    pattern: "function_check: scanned"
    hard_gate: false
    description: "函数行数限制 ≤100 行（需人工审查）"

  # ══════════════════════════════════════════════════════════════
  # 重复代码检测 - 防止 AI 复制粘贴
  # ══════════════════════════════════════════════════════════════

  - name: duplicate_code_ts
    command: npx jscpd --min-lines 10 --min-tokens 50 --reporters console --format typescript,javascript src apps 2>&1 || echo "jscpd not configured"
    pattern: "Found 0 clones|No duplicates found|not configured|duplications found: 0"
    hard_gate: false
    description: "TypeScript/JavaScript 重复代码检测"

  - name: duplicate_code_rust
    command: |
      # Rust 重复检测（简化版，检查相似的 impl 块）
      grep -rh "^impl " crates --include="*.rs" 2>/dev/null | sort | uniq -c | \
      awk '$1 > 3 {dup++} END {print "rust_duplicate_impls:", dup+0}'
    pattern: "rust_duplicate_impls: 0"
    hard_gate: false
    description: "Rust 重复 impl 块检测"

  # ══════════════════════════════════════════════════════════════
  # 复杂度检测 - 防止过度工程
  # ══════════════════════════════════════════════════════════════

  - name: cyclomatic_complexity
    command: |
      npx eslint --no-error-on-unmatched-pattern --rule "complexity: [error, 15]" --format compact src apps 2>&1 | grep -c "complexity" || true
    pattern: "^0$|No files"
    hard_gate: false
    description: "圈复杂度限制 ≤15"

  - name: cognitive_complexity
    command: |
      # 检查是否有超过 3 层嵌套的代码
      grep -rn "^[[:space:]]\{12,\}if\|^[[:space:]]\{12,\}for\|^[[:space:]]\{12,\}while" \
        --include="*.ts" --include="*.tsx" src apps 2>/dev/null | wc -l | \
      awk '{print "deep_nesting_count:", $1}'
    pattern: "deep_nesting_count: [0-9]$"
    hard_gate: false
    description: "深层嵌套检测（>3层）"

  # ══════════════════════════════════════════════════════════════
  # Lint 检查 - Hard Gate
  # ══════════════════════════════════════════════════════════════

  - name: eslint_pass
    command: npm run lint 2>&1
    pattern: "no problems|0 errors|Done"
    hard_gate: true
    description: "ESLint 必须通过"

  - name: clippy_pass
    command: cargo clippy --workspace -- -D warnings 2>&1
    pattern: "Finished|warning: 0 warnings"
    hard_gate: true
    description: "Clippy 必须通过（无警告）"

  # ══════════════════════════════════════════════════════════════
  # AI 特有检测
  # ══════════════════════════════════════════════════════════════

  - name: todo_fixme_count
    command: |
      grep -rn "TODO\|FIXME\|XXX\|HACK" --include="*.ts" --include="*.tsx" --include="*.rs" \
        src apps crates 2>/dev/null | wc -l | awk '{print "todo_count:", $1}'
    pattern: "todo_count: [0-9]$|todo_count: [1-9][0-9]$"
    hard_gate: false
    description: "TODO/FIXME 数量监控（<100）"

  - name: console_log_check
    command: |
      grep -rn "console\.log\|console\.debug" --include="*.ts" --include="*.tsx" \
        src apps 2>/dev/null | grep -v "test\|spec\|\.test\." | wc -l | \
      awk '{print "console_log_count:", $1}'
    pattern: "console_log_count: [0-5]$"
    hard_gate: false
    description: "生产代码中的 console.log 检测"

  - name: any_type_check
    command: |
      grep -rn ": any\|as any" --include="*.ts" --include="*.tsx" \
        src apps 2>/dev/null | wc -l | awk '{print "any_type_count:", $1}'
    pattern: "any_type_count: [0-9]$|any_type_count: [1-4][0-9]$"
    hard_gate: false
    description: "TypeScript any 类型使用检测（<50）"
---

# Code Quality 证据

> 本文件检测 AI 生成代码的常见质量问题，作为 maintainability 维度的补充证据。
>
> **核心理念**: 通过量化指标约束 AI 的"乱写空间"，防止代码膨胀和质量退化。

## 检测矩阵

| 检测项 | 阈值 | Hard Gate | 工具 |
|--------|------|-----------|------|
| 文件行数 | ≤1000 行 | ❌ | wc -l |
| 函数行数 | ≤100 行 | ❌ | grep + 人工 |
| 重复代码 | 0 clones | ❌ | jscpd |
| 圈复杂度 | ≤15 | ❌ | ESLint |
| 深层嵌套 | ≤3 层 | ❌ | grep |
| ESLint | 0 errors | ✅ | ESLint |
| Clippy | 0 warnings | ✅ | Clippy |
| TODO/FIXME | <100 | ❌ | grep |
| console.log | ≤5 | ❌ | grep |
| any 类型 | <50 | ❌ | grep |

## AI 特有问题

### 1. 代码膨胀
AI 倾向于生成冗长代码，缺乏抽象能力。

**约束**: 文件 ≤1000 行，函数 ≤100 行

### 2. 重复代码
AI 经常"复制粘贴"式生成，忽略已有实现。

**约束**: jscpd 检测，0 clones

### 3. 类型逃逸
AI 使用 `any` 绕过类型检查。

**约束**: any 类型 <50 处

### 4. 调试残留
AI 遗留 console.log 和 TODO。

**约束**: console.log ≤5，TODO <100

## 本地执行

```bash
# 安装 jscpd
npm install -g jscpd

# 运行重复检测
npx jscpd --min-lines 10 --min-tokens 50 src apps

# 运行 fitness 检查
python3 docs/fitness/scripts/fitness.py
```

## 相关文件

| 文件 | 用途 |
|------|------|
| `eslint.config.mjs` | ESLint 配置 |
| `.clippy.toml` | Clippy 配置（如有） |
| `docs/fitness/README.md` | Fitness 规则手册 |
