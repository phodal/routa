# Release Checklist

Quick checklist for releasing Routa CLI.

## Prerequisites

- [ ] All tests passing
- [ ] No uncommitted changes
- [ ] On `main` branch with latest code
- [ ] GitHub secrets configured:
  - `CARGO_REGISTRY_TOKEN` (from crates.io)
  - `NPM_TOKEN` (from npmjs.com)

## Release Steps

### Option 1: Automated Script (Recommended)

```bash
# Interactive
npm run release:publish

# Or direct
./scripts/release/publish.sh 0.2.5

# Dry run first
./scripts/release/publish.sh 0.2.5 --dry-run
```

### Option 2: Manual

```bash
# 1. Sync version
npm run release:sync-version -- --version 0.2.5

# 2. Review changes
git diff

# 3. Commit and tag
git commit -am "chore: release v0.2.5"
git tag v0.2.5

# 4. Push
git push origin main --tags
```

## Post-Release

- [ ] Monitor [GitHub Actions](https://github.com/phodal/routa/actions)
- [ ] Verify [crates.io publish](https://crates.io/crates/routa-cli)
- [ ] Verify [npm publish](https://www.npmjs.com/package/routa-cli)
- [ ] Verify [GitHub Release](https://github.com/phodal/routa/releases)
- [ ] Test installation:
  ```bash
  cargo install routa-cli@0.2.5
  npm install -g routa-cli@0.2.5
  ```

## Rollback

If needed:

```bash
# Delete tag
git tag -d v0.2.5
git push origin :refs/tags/v0.2.5

# Yank from crates.io (cannot unpublish)
cargo yank routa-cli@0.2.5
```

## Full Documentation

See [docs/release-guide.md](./release-guide.md) for detailed instructions.

