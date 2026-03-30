# Routa CLI - Multi-Platform Release Setup

This document summarizes the complete release setup for Routa CLI, supporting **Cargo**, **NPM**, and **GitHub Releases**.

## Overview

Routa CLI can now be published to multiple platforms simultaneously:

1. **crates.io** (Cargo) - For Rust users
2. **npm** - For Node.js users with prebuilt binaries
3. **GitHub Releases** - For direct binary downloads

## Quick Start

### Release a New Version

```bash
# Interactive mode
npm run release:publish

# Or specify version directly
./scripts/release/publish.sh 0.2.5

# Test first with dry run
./scripts/release/publish.sh 0.2.5 --dry-run
```

### What Happens?

1. **Version Sync** - Updates version in all packages (Cargo.toml, package.json, etc.)
2. **Commit & Tag** - Creates a release commit and git tag
3. **Push** - Triggers GitHub Actions
4. **Automated Publishing**:
   - Publishes all Rust crates to crates.io in dependency order
   - Builds binaries for Linux, macOS (Intel/ARM), Windows
   - Packages and publishes to npm
   - Creates GitHub Release with desktop binaries

## Installation Methods

After release, users can install via:

### Via Cargo
```bash
cargo install routa-cli
```

### Via NPM
```bash
npm install -g routa-cli
# or
npx -p routa-cli routa --help
```

### Via GitHub Release
Download prebuilt binaries from [Releases page](https://github.com/phodal/routa/releases).

## Project Structure

### Release Scripts
- `scripts/release/publish.sh` - Interactive release helper
- `scripts/release/sync-release-version.mjs` - Version sync across all packages
- `scripts/release/stage-routa-cli-npm.mjs` - NPM package staging

### GitHub Actions Workflows
- `.github/workflows/release.yml` - Main release orchestration
- `.github/workflows/cargo-release.yml` - Publishes to crates.io
- `.github/workflows/cli-release.yml` - Builds and publishes to npm
- `.github/workflows/tauri-release.yml` - Desktop app release

### NPM Package Structure
- `packages/routa-cli/` - Main npm package (platform detection wrapper)
- Platform-specific packages (auto-generated during build):
  - `routa-cli-linux-x64`
  - `routa-cli-darwin-x64`
  - `routa-cli-darwin-arm64`
  - `routa-cli-windows-x64`

### Rust Crates
Published in dependency order:
1. `routa-core` - Core domain logic
2. `routa-rpc` - RPC layer
3. `routa-scanner` - Repository scanner
4. `routa-server` - HTTP server
5. `routa-cli` - CLI binary

## GitHub Secrets Required

Configure these in repository settings:

- `CARGO_REGISTRY_TOKEN` - From [crates.io/me](https://crates.io/me)
- `NPM_TOKEN` - From [npmjs.com](https://www.npmjs.com/) (Automation token)
- `GITHUB_TOKEN` - Automatically provided

## Documentation

- [Release Guide](docs/release-guide.md) - Detailed release instructions
- [Release Checklist](docs/RELEASE_CHECKLIST.md) - Quick checklist
- [CLI README](crates/routa-cli/README.md) - CLI usage documentation
- [NPM README](packages/routa-cli/README.md) - NPM package documentation

## Version Management

All versions are kept in sync across:
- Root `package.json`
- `Cargo.toml` (workspace)
- All crate `Cargo.toml` files
- `packages/routa-cli/package.json`
- `apps/desktop/package.json`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/tauri.conf.json`

The `sync-release-version.mjs` script handles this automatically.

## Trigger Methods

### 1. Git Tag Push (Recommended)
```bash
git tag v0.2.5
git push origin main --tags
```

### 2. GitHub Actions Manual Trigger
Go to [Actions](https://github.com/phodal/routa/actions/workflows/release.yml) → Run workflow

### 3. Release Script
```bash
npm run release:publish
```

## Monitoring

Monitor release progress:
- GitHub Actions: https://github.com/phodal/routa/actions
- crates.io: https://crates.io/crates/routa-cli
- npm: https://www.npmjs.com/package/routa-cli
- GitHub Releases: https://github.com/phodal/routa/releases

## Troubleshooting

See [Release Guide](docs/release-guide.md) for common issues and solutions.

## Next Steps

After first release:
1. Update README badges with latest version
2. Announce release in community channels
3. Update documentation if needed
4. Monitor user feedback

---

For detailed instructions, see [docs/release-guide.md](docs/release-guide.md).

