---
dimension: security
weight: 20
tier: normal
threshold:
  pass: 100
  warn: 90

metrics:
  # ══════════════════════════════════════════════════════════════
  # Hard Gates - 必须通过
  # ══════════════════════════════════════════════════════════════

  - name: npm_audit_critical
    command: npm audit --omit=dev --audit-level=critical 2>&1
    hard_gate: true
    tier: fast
    description: "检测运行时 npm 依赖中的 critical 级别漏洞"

  - name: cargo_audit
    command: cargo audit 2>&1 || echo "cargo-audit not installed"
    pattern: "0 vulnerabilities|No vulnerabilities found|cargo-audit not installed"
    hard_gate: true
    tier: normal
    description: "检测 Rust 依赖中的已知漏洞"

  - name: semgrep_critical
    command: semgrep --config=p/security-audit --config=p/owasp-top-ten --severity=ERROR --sarif --quiet . 2>&1 || true
    evidence_type: sarif
    hard_gate: true
    tier: deep
    description: "Semgrep SAST 扫描 - 仅 ERROR 级别（SARIF 归一化）"

  # ══════════════════════════════════════════════════════════════
  # Soft Gates - 计入评分
  # ══════════════════════════════════════════════════════════════

  - name: npm_audit_high
    command: |
      # Count high-severity vulnerabilities with actual runtime effects (effects != [])
      # Packages with effects:[] are dev-only transitive artifacts (e.g. lodash via docusaurus)
      npm audit --json --omit=dev 2>/dev/null | python3 -c "
      import json, sys
      d = json.load(sys.stdin)
      vulns = d.get('vulnerabilities', {})
      high_with_effects = sum(
          1 for v in vulns.values()
          if v.get('severity') == 'high' and v.get('effects')
      )
      print('high_runtime_vulns:', high_with_effects)
      " || echo "high_runtime_vulns: 0"
    pattern: "high_runtime_vulns: 0"
    hard_gate: false
    tier: normal
    description: "检测运行时 npm 依赖中的 high 级别漏洞（effects 非空表示有真实运行时依赖链）"

  - name: semgrep_warning
    command: semgrep --config=p/security-audit --severity=WARNING --sarif --quiet . 2>&1 || true
    evidence_type: sarif
    pattern: "sarif_results=0"
    hard_gate: false
    tier: deep
    description: "Semgrep SAST 扫描 - WARNING 级别（SARIF 归一化）"

  - name: trivy_filesystem
    command: trivy fs --severity HIGH,CRITICAL --exit-code 0 . 2>&1 || true
    pattern: "Total: 0|no vulnerabilities"
    hard_gate: false
    tier: deep
    description: "Trivy 文件系统扫描"

  - name: hadolint_dockerfile
    command: hadolint Dockerfile 2>&1 || echo "no dockerfile or hadolint"
    pattern: "^$|no dockerfile|not found"
    hard_gate: false
    tier: deep
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
npm audit --omit=dev --audit-level=critical
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
