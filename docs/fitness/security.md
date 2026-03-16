---
dimension: security
weight: 14
threshold:
  pass: 100
  warn: 90

metrics:
  # ══════════════════════════════════════════════════════════════
  # Hard Gates - 必须通过
  # ══════════════════════════════════════════════════════════════
  
  - name: npm_audit_critical
    command: npm audit --audit-level=critical 2>&1 || true
    pattern: "found 0 vulnerabilities|0 critical|no vulnerabilities"
    blocked_pattern: "ENOTFOUND registry\\.npmjs\\.org|audit endpoint returned an error"
    hard_gate: true
    description: "检测 npm 依赖中的 critical 级别漏洞"

  - name: cargo_audit
    command: cargo audit 2>&1 || true
    pattern: "0 vulnerabilities|No vulnerabilities found"
    blocked_pattern: "not installed|no such command: `audit`"
    hard_gate: true
    description: "检测 Rust 依赖中的已知漏洞"

  - name: semgrep_critical
    command: semgrep --config=p/security-audit --config=p/owasp-top-ten --severity=ERROR --error --quiet . 2>&1 || true
    pattern: "no matches found|Ran .* rules|0 findings"
    blocked_pattern: "empty trust anchors|Failed to create system store X509 authenticator"
    hard_gate: true
    description: "Semgrep SAST 扫描 - 仅 ERROR 级别"

  # ══════════════════════════════════════════════════════════════
  # Soft Gates - 计入评分
  # ══════════════════════════════════════════════════════════════

  - name: npm_audit_high
    command: npm audit --audit-level=high 2>&1 || true
    pattern: "found 0 vulnerabilities|0 high|no vulnerabilities"
    blocked_pattern: "ENOTFOUND registry\\.npmjs\\.org|audit endpoint returned an error"
    hard_gate: false
    description: "检测 npm 依赖中的 high 级别漏洞"

  - name: semgrep_warning
    command: semgrep --config=p/security-audit --severity=WARNING --quiet . 2>&1 || true
    pattern: "no matches found|Ran .* rules"
    blocked_pattern: "empty trust anchors|Failed to create system store X509 authenticator"
    hard_gate: false
    description: "Semgrep SAST 扫描 - WARNING 级别"

  - name: trivy_filesystem
    command: trivy fs --severity HIGH,CRITICAL --exit-code 0 . 2>&1 || true
    pattern: "Total: 0|no vulnerabilities"
    blocked_pattern: "command not found: trivy|trivy: command not found"
    hard_gate: false
    description: "Trivy 文件系统扫描"

  - name: hadolint_dockerfile
    command: hadolint Dockerfile 2>&1 || echo "no dockerfile or hadolint"
    pattern: "^$|no dockerfile|not found"
    hard_gate: false
    description: "Dockerfile 最佳实践检查"
---

# Security 证据

> 本文件记录安全扫描的验证状态，作为 Defense 下 security 子维度的证据来源。
>
> **防御理念**: 通过多层扫描工具实现深度防御，封锁 AI 的乱写空间。

## 工具矩阵

| 工具 | 类型 | 检测范围 | Hard Gate |
|------|------|----------|-----------|
| npm audit | 依赖扫描 | npm 包 CVE | ✅ critical |
| cargo audit | 依赖扫描 | Rust crate CVE | ✅ |
| Semgrep | SAST | 代码漏洞模式 | ✅ ERROR |
| Trivy | 全能扫描 | 文件系统/容器 | ❌ |
| Hadolint | Dockerfile | CIS Benchmark | ❌ |

## Semgrep 规则集

使用 [semgrep-rules](https://github.com/semgrep/semgrep-rules) 社区规则：

```bash
# 安全审计 + OWASP Top 10
semgrep --config=p/security-audit --config=p/owasp-top-ten .

# 仅 TypeScript/JavaScript
semgrep --config=p/typescript --config=p/javascript .

# 仅 Rust
semgrep --config=p/rust .
```

### 核心规则集

| 规则集 | 用途 |
|--------|------|
| `p/security-audit` | 通用安全审计 |
| `p/owasp-top-ten` | OWASP Top 10 漏洞 |
| `p/typescript` | TypeScript 特定规则 |
| `p/javascript` | JavaScript 特定规则 |
| `p/rust` | Rust 特定规则 |
| `p/docker` | Docker 安全规则 |

## 本地执行

```bash
# 安装工具
npm install -g semgrep
cargo install cargo-audit
brew install trivy hadolint  # macOS

# 运行检查
npm audit --audit-level=critical
cargo audit
semgrep --config=p/security-audit --config=p/owasp-top-ten .
trivy fs --severity HIGH,CRITICAL .
hadolint Dockerfile
```

## CI 集成

安全扫描已集成到 `.github/workflows/defense.yaml`，不再使用独立的 `Security` workflow。

## AI Agent 特有规则

基于 Issue #132，需要关注的 AI 特有漏洞模式：

| 漏洞类型 | 检测模式 | 严重性 |
|----------|----------|--------|
| 权限绕过 | `bypassPermissions`, `--dangerously-skip-permissions` | ERROR |
| 命令注入 | `exec(\`...\${var}...\`)`, `child_process.exec` | ERROR |
| SSRF | `fetch(userInput)` 无验证 | WARNING |
| XSS | `dangerouslySetInnerHTML` 无消毒 | WARNING |
| 未授权端点 | API route 缺少 auth 检查 | WARNING |

## 相关文件

| 文件 | 用途 |
|------|------|
| `.github/workflows/defense.yaml` | Defense CI（含 security 维度） |
| `.semgrep/` | 自定义 Semgrep 规则（可选） |
| `docs/fitness/README.md` | Fitness 规则手册 |
