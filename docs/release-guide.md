# Routa CLI Release Guide

This guide covers the process for releasing new versions of Routa CLI to multiple distribution channels: **crates.io** (Cargo), **npm**, and **GitHub Releases**.

## Overview

The release process publishes to three channels simultaneously:

1. **crates.io** - Rust users can `cargo install routa-cli`
2. **npm** - Node.js users can `npm install -g routa-cli`
3. **GitHub Releases** - Desktop binaries and release notes

## Prerequisites

### Repository Secrets

Ensure these GitHub secrets are configured:

- `CARGO_REGISTRY_TOKEN` - Get from [crates.io/me](https://crates.io/me) → API Tokens
- `NPM_TOKEN` - Get from [npmjs.com](https://www.npmjs.com/) → Access Tokens → Generate New Token → Automation
- `GITHUB_TOKEN` - Automatically provided by GitHub Actions

### Local Setup

```bash
# Ensure you're on main branch with latest code
git checkout main
git pull origin main

# Verify no uncommitted changes
git status
```

## Release Methods

### Method 1: Automated Script (Recommended)

Use the release helper script:

```bash
# Interactive mode - prompts for version
./scripts/release/publish.sh

# Direct mode - specify version
./scripts/release/publish.sh 0.2.5

# Dry run - test without publishing
./scripts/release/publish.sh 0.2.5 --dry-run
```

The script will:
1. Sync version across all packages
2. Show you the changes
3. Create commit and tag
4. Push to trigger GitHub Actions

### Method 2: Manual Process

```bash
# 1. Update version in all packages
node scripts/release/sync-release-version.mjs --version 0.2.5

# 2. Review changes
git diff

# 3. Commit and tag
git commit -am "chore: release v0.2.5"
git tag v0.2.5

# 4. Push
git push origin main --tags
```

### Method 3: GitHub UI Dispatch

Manually trigger from GitHub:

1. Go to [Actions](https://github.com/phodal/routa/actions/workflows/release.yml)
2. Click "Run workflow"
3. Enter version (e.g., `0.2.5` or `v0.2.5`)
4. Configure publish options:
   - `publish_cargo`: Publish to crates.io
   - `publish_cli`: Publish npm packages
   - `publish_desktop`: Create GitHub Release with desktop binaries
   - `dry_run`: Test without publishing

## Release Workflow

Once you push a tag (e.g., `v0.2.5`), GitHub Actions automatically:

### 1. Cargo Publish (`.github/workflows/cargo-release.yml`)

Publishes these crates in order:
1. `routa-core` - Core domain logic
2. `routa-rpc` - RPC layer
3. `routa-scanner` - Repository scanner
4. `routa-server` - HTTP server
5. `routa-cli` - CLI binary

**Note**: Each crate waits for the previous one to be indexed on crates.io before publishing.

### 2. CLI Release (`.github/workflows/cli-release.yml`)

Builds platform-specific binaries:
- `linux-x64` - Linux x86_64
- `darwin-x64` - macOS Intel
- `darwin-arm64` - macOS Apple Silicon
- `win32-x64` - Windows x64

Then publishes to npm as:
- `routa-cli` - Main package with platform detection
- `routa-cli-linux-x64` - Linux binary
- `routa-cli-darwin-x64` - macOS Intel binary
- `routa-cli-darwin-arm64` - macOS ARM binary
- `routa-cli-windows-x64` - Windows binary

### 3. Desktop Release (`.github/workflows/tauri-release.yml`)

Creates GitHub Release with:
- Tauri desktop app installers
- Release notes with CLI install instructions

## Verification

After the release completes (~15-30 minutes), verify:

### Crates.io
```bash
cargo search routa-cli
cargo install routa-cli@0.2.5
routa --version
```

### NPM
```bash
npm view routa-cli versions
npm install -g routa-cli@0.2.5
routa --version
```

### GitHub Release
Check [Releases page](https://github.com/phodal/routa/releases) for the new version.

## Troubleshooting

### Version Already Published on crates.io

If a crate version already exists on crates.io, the workflow will skip it and continue. This is normal for patch re-releases.

### NPM Publish Fails

Check that `NPM_TOKEN` is valid:
- Token must have "Automation" access
- Token must not be expired
- You must be a maintainer of the `routa-cli` npm organization

### Cargo Publish Fails

Common issues:
- **Missing dependency version**: Ensure all workspace crates use the same version
- **API token expired**: Regenerate token at [crates.io/settings/tokens](https://crates.io/settings/tokens)
- **Network timeout**: Re-run the workflow

## Version Bump Types

Follow [Semantic Versioning](https://semver.org/):

- **Patch** (0.2.4 → 0.2.5): Bug fixes, no breaking changes
- **Minor** (0.2.5 → 0.3.0): New features, backward compatible
- **Major** (0.3.0 → 1.0.0): Breaking changes

## Rollback

If you need to rollback a release:

```bash
# Delete the tag locally and remotely
git tag -d v0.2.5
git push origin :refs/tags/v0.2.5
```

**Note**: You cannot unpublish from crates.io, but you can yank a version:

```bash
cargo yank routa-cli@0.2.5
```

## Related Documentation

- [Cargo.toml workspace config](../../Cargo.toml)
- [NPM package structure](../../packages/routa-cli/package.json)
- [CLI Release workflow](../../.github/workflows/cli-release.yml)
- [Cargo Release workflow](../../.github/workflows/cargo-release.yml)

