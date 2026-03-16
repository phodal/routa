---
dimension: evolvability
weight: 10
threshold:
  pass: 100
  warn: 95

metrics:
  - name: openapi_schema_valid
    command: node --import tsx scripts/validate-openapi-schema.ts 2>&1
    pattern: "schema is valid|validation passed|Summary: 0 error\\(s\\)"
    hard_gate: true

  - name: api_parity_check
    command: npm run api:check 2>&1
    pattern: "parity check passed|All endpoints match|All backends are in sync with the contract"
    hard_gate: true

  - name: no_breaking_changes
    command: npm run api:check 2>&1
    pattern: "no breaking changes|0 breaking|All backends are in sync with the contract"
    hard_gate: false
---

# API Contract 证据

> 本文件记录 API 契约的验证状态，作为 evolvability 维度的证据来源。
> 
> **契约文件**: `/api-contract.yaml` (Single Source of Truth)

## 契约原则

1. **双后端一致性**: Next.js 和 Rust 后端必须实现相同的 API
2. **契约优先**: 先修改 `api-contract.yaml`，再实现代码
3. **Breaking Changes 禁止**: 除非有迁移计划，否则不允许破坏性变更

## 验证命令

```bash
# 验证 OpenAPI schema 结构
npm run api:schema:validate

# 检查 Next.js vs Rust vs Contract 一致性
npm run api:check

# 生成覆盖率报告
npm run api:schema:report
```

## 端点覆盖状态

详见 [rust-api-test.md](rust-api-test.md) 中的端点矩阵。

## 变更规则

### 添加新端点

1. 在 `api-contract.yaml` 中定义端点
2. 在 Next.js 中实现 (`src/app/api/`)
3. 在 Rust 中实现 (`crates/routa-server/src/api/`)
4. 运行 `npm run api:check` 验证一致性
5. 更新 `rust-api-test.md` 添加测试条目

### 修改现有端点

1. 评估是否为 breaking change
2. 如果是 breaking change，需要：
   - 版本化或废弃旧端点
   - 提供迁移文档
   - 在 PR 中明确标注
3. 更新 `api-contract.yaml`
4. 同步更新双后端实现
5. 更新测试用例

## CI 集成

API 契约检查已集成到 `defense.yaml`:

```yaml
api-contract:
  name: 'Gate: API Contract'
  steps:
    - run: npm run api:schema:validate
    - run: npm run api:check
```

## 相关文件

| 文件 | 用途 |
|------|------|
| `/api-contract.yaml` | OpenAPI 契约定义 |
| `/scripts/check-api-parity.ts` | 一致性检查脚本 |
| `/scripts/validate-openapi-schema.ts` | Schema 验证脚本 |
| `/tests/api-contract/` | 契约测试用例 |
