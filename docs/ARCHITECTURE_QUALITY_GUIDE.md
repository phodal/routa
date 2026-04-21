# Architecture Quality - Quick Reference

## 📚 Documentation Locations

### Online (GitHub Pages) ⭐ Recommended

All documentation is published to GitHub Pages and automatically updated:

- **🚀 User Guide**: https://phodal.github.io/routa/features/architecture-quality
  - Quick start, CLI usage, UI features, examples

- **📖 DSL Specification**: https://phodal.github.io/routa/design-docs/architecture-rule-dsl
  - Complete DSL schema, syntax, design principles
  - TypeScript and Rust implementation strategies
  - LLM generation guidelines

- **🏠 Design Docs Index**: https://phodal.github.io/routa/design-docs
  - Browse all design documents including Architecture Rule DSL

### Local Development

View docs locally:
```bash
# Build and serve docs
npx docusaurus build --out-dir docs-site
npx docusaurus serve --dir docs-site --port 3001

# Then open:
# - http://localhost:3001/routa/features/architecture-quality (User Guide)
# - http://localhost:3001/routa/design-docs/architecture-rule-dsl (DSL Spec)
```

## 🎯 Quick Start

### 1. View in UI

1. Open Routa Desktop or Web
2. Go to **Settings → Harness**
3. Select a workspace and repository
4. Click the **Architecture** tab
5. Click **Run Architecture Scan**

### 2. Run from CLI

```bash
# Run all checks
npm run test:arch:backend-core

# Run specific suite
npm run test:arch:backend-core -- --suite boundaries
npm run test:arch:backend-core -- --suite cycles

# Get JSON output
npm run test:arch:backend-core -- --json
```

### 3. Check Results

- **UI**: View in the Architecture tab with multiple views (Summary, Boundaries, Cycles, Violations)
- **Snapshot**: Check `docs/fitness/reports/backend-architecture-latest.json`
- **API**: Call `GET /api/fitness/architecture`

## 📋 What It Checks

### Boundary Rules

- ✅ `src/core/**` must not depend on `src/app/**`
- ✅ `src/core/**` must not depend on `src/client/**`
- ✅ `src/app/api/**` must not depend on `src/client/**`

### Cycle Rules

- ✅ `src/core/**` should be cycle-free

## 🔧 Configuration

### Rules Definition

Edit `architecture/rules/backend-core.archdsl.yaml` to:
- Add new selectors
- Define new rules
- Change severity levels
- Add engine hints

### DSL Format

```yaml
schema: routa.archdsl/v1

selectors:
  my_module:
    kind: files
    language: typescript
    include: [src/my-module/**]

rules:
  - id: my_rule
    title: My custom rule
    kind: dependency
    suite: boundaries
    severity: advisory
    from: my_module
    relation: must_not_depend_on
    to: other_module
    engine_hints: [archunitts, graph]
```

## 🌐 Multi-Language Support

The UI is fully localized:
- **English**: Complete translations
- **中文**: 完整中文支持

Translations are in `src/i18n/locales/{en,zh}.ts` under `settings.harness.architectureQuality`.

## 📊 Integration Status

- ✅ **UI**: Fully integrated in Harness console
- ✅ **API**: `/api/fitness/architecture` endpoint
- ✅ **CLI**: TypeScript and Rust commands
- ✅ **Fitness**: Registered as `architecture_quality` dimension (weight: 0, advisory mode)
- ✅ **DSL**: Cross-language YAML format
- ✅ **Docs**: Published to GitHub Pages

## 🔗 Related Files

### Source Code
- `src/client/components/harness-architecture-quality-panel.tsx` - UI panel
- `src/app/api/fitness/architecture/route.ts` - API endpoint
- `scripts/fitness/check-backend-architecture.ts` - Compatibility wrapper for the Rust CLI
- `crates/routa-cli/src/commands/fitness/arch_dsl.rs` - Primary graph executor

### Configuration
- `architecture/rules/backend-core.archdsl.yaml` - Rule definitions
- `docs/fitness/backend-architecture.md` - Fitness dimension config

### Documentation
- `docs/features/architecture-quality.md` - User guide (Docusaurus)
- `docs/design-docs/architecture-rule-dsl.md` - DSL specification (Docusaurus)

## 📝 Contributing

To add new architecture rules:

1. Edit `architecture/rules/backend-core.archdsl.yaml`
2. Test with `npm run test:arch:dsl`
3. Run checks with `npm run test:arch:backend-core`
4. Verify in UI at Settings → Harness → Architecture

## ⚠️ Known Limitations

- **Advisory mode**: Currently weight: 0, not enforced in CI
- **TypeScript only**: Rust backend rules defined but not fully integrated

---

**For full documentation, visit: https://phodal.github.io/routa/features/architecture-quality**
