---
name: fitness-function
description: Architecture fitness function for Routa.js. Measures code quality, security, performance, and other "-ilities" against defined thresholds.
version: "1.0"

thresholds:
  block: 80      # < 80 阻断合并
  warn: 90       # 80-90 强告警
  pass: 90       # >= 90 通过

hard_gates:
  - ts_test_pass
  - rust_test_pass
  - api_contract_parity
  - lint_pass
  - no_critical_vulnerabilities

evidence:
  - unit-test.md
  - rust-api-test.md
---

# Fitness Function Verification

## Quick Start

```bash
# 1. Run tests
npm run test:run -- --coverage
cargo test --workspace

# 2. Check API contract
npm run api:check

# 3. Lint
npm run lint && cargo clippy --workspace
```

## Score Formula

```
Fitness = Σ (Weight_i × Score_i) / 100
```

## Hard Gates

必须全部通过才能合并：

| Gate | Command | Threshold |
|------|---------|-----------|
| ts_test_pass | `npm run test:run` | 100% |
| rust_test_pass | `cargo test --workspace` | 100% |
| api_contract_parity | `npm run api:check` | pass |
| lint_pass | `npm run lint` | 0 errors |
| no_critical_vulnerabilities | `snyk test` | 0 critical |

## Dimensions

详见 [README.md](README.md) 中的维度定义。

| 维度 | 权重 | Evidence |
|------|------|----------|
| testability | 14% | [unit-test.md](unit-test.md) |
| performance | 10% | k6/wrk reports |
| security | 14% | snyk/trivy |
| maintainability | 14% | [rust-api-test.md](rust-api-test.md) |
| deployability | 10% | Dockerfile |
| evolvability | 10% | OpenAPI diff |
| observability | 10% | OTEL |
| compliance | 10% | OPA/Conftest |
| ai | 8% | promptfoo |

## Ratchet Strategy

> 只允许改善，不允许劣化

```bash
# archlint 棘轮检查
npx @archlinter/cli diff origin/main --fail-on medium
```

## Manual Checklist

### P0: Hard Gates
- [ ] `npm run test:run` 全部通过
- [ ] `cargo test --workspace` 全部通过
- [ ] `npm run api:check` 契约一致
- [ ] `npm run lint` 无错误

### P1: Core Metrics
- [ ] 新代码覆盖率 ≥ 80%
- [ ] 无新增 medium+ 架构异味
- [ ] 无 critical/high 安全漏洞

## Evidence Files

| File | Purpose |
|------|---------|
| [unit-test.md](unit-test.md) | 单元测试清单 |
| [rust-api-test.md](rust-api-test.md) | API 契约矩阵 |
| [README.md](README.md) | 规则手册 |

