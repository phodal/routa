# Release Checklist

Quick checklist for releasing Routa.

## Prerequisites

- [ ] All tests passing
- [ ] No uncommitted changes
- [ ] On `main` branch with latest code
- [ ] GitHub secrets configured:
  - `CRATE_TOKEN` (from crates.io - note: NOT `CARGO_REGISTRY_TOKEN`)
  - `NPM_TOKEN` (from npmjs.com)
  - `ROUTA_GITHUB_TOKEN` (preferred for release baseline fetches)

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
- [ ] Verify crates.io publish (all 7 crates):
  - [ ] [routa-core](https://crates.io/crates/routa-core)
  - [ ] [routa-rpc](https://crates.io/crates/routa-rpc)
  - [ ] [routa-scanner](https://crates.io/crates/routa-scanner)
  - [ ] [routa-server](https://crates.io/crates/routa-server)
  - [ ] [routa-cli](https://crates.io/crates/routa-cli)
  - [ ] [entrix](https://crates.io/crates/entrix)
  - [ ] [harness-monitor](https://crates.io/crates/harness-monitor)
- [ ] Verify npm publish (all 15 packages):
  - [ ] [routa-cli](https://www.npmjs.com/package/routa-cli) (main package)
  - [ ] [routa-cli-linux-x64](https://www.npmjs.com/package/routa-cli-linux-x64)
  - [ ] [routa-cli-darwin-arm64](https://www.npmjs.com/package/routa-cli-darwin-arm64)
  - [ ] [routa-cli-darwin-x64](https://www.npmjs.com/package/routa-cli-darwin-x64)
  - [ ] [routa-cli-windows-x64](https://www.npmjs.com/package/routa-cli-windows-x64)
  - [ ] [harness-monitor](https://www.npmjs.com/package/harness-monitor) (main package)
  - [ ] [harness-monitor-linux-x64](https://www.npmjs.com/package/harness-monitor-linux-x64)
  - [ ] [harness-monitor-darwin-arm64](https://www.npmjs.com/package/harness-monitor-darwin-arm64)
  - [ ] [harness-monitor-darwin-x64](https://www.npmjs.com/package/harness-monitor-darwin-x64)
  - [ ] [harness-monitor-windows-x64](https://www.npmjs.com/package/harness-monitor-windows-x64)
  - [ ] [entrix](https://www.npmjs.com/package/entrix) (main package)
  - [ ] [entrix-linux-x64](https://www.npmjs.com/package/entrix-linux-x64)
  - [ ] [entrix-darwin-arm64](https://www.npmjs.com/package/entrix-darwin-arm64)
  - [ ] [entrix-darwin-x64](https://www.npmjs.com/package/entrix-darwin-x64)
  - [ ] [entrix-windows-x64](https://www.npmjs.com/package/entrix-windows-x64)
- [ ] Verify [GitHub Release](https://github.com/phodal/routa/releases) (Desktop installers)
- [ ] Test installation:
  ```bash
  cargo install routa-cli@0.2.9
  cargo install harness-monitor@0.2.9
  cargo install entrix@0.2.9
  npm install -g routa-cli@0.2.9
  npm install -g harness-monitor@0.2.9
  npm install -g entrix@0.2.9
  routa --version  # Should show the new version
  harness-monitor --version
  entrix --version
  ```

## Rollback

If needed:

```bash
# Delete tag
git tag -d v0.2.5
git push origin :refs/tags/v0.2.5

# Yank from crates.io (cannot unpublish)
cargo yank routa-cli@0.2.5
cargo yank harness-monitor@0.2.5
```

## Full Documentation

See [docs/release-guide.md](./release-guide.md) for detailed instructions.
