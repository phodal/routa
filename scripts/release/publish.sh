#!/usr/bin/env bash
# Routa Release Helper
# Usage: ./scripts/release/publish.sh [version] [--dry-run]
#
# Examples:
#   ./scripts/release/publish.sh 0.2.5           # Full release
#   ./scripts/release/publish.sh 0.2.5 --dry-run # Test release flow
#   ./scripts/release/publish.sh                 # Interactive mode

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
VERSION="${1:-}"
DRY_RUN=false

if [[ "${2:-}" == "--dry-run" ]] || [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  if [[ "${1:-}" == "--dry-run" ]]; then
    VERSION=""
  fi
fi

# Interactive version prompt if not provided
if [[ -z "$VERSION" ]]; then
  echo -e "${YELLOW}Enter version to release (e.g., 0.2.5):${NC}"
  read -r VERSION
fi

# Normalize version (remove v prefix if present)
VERSION="${VERSION#v}"

if [[ -z "$VERSION" ]]; then
  echo -e "${RED}Error: Version is required${NC}" >&2
  exit 1
fi

echo -e "${GREEN}=== Routa Release Script ===${NC}"
echo "Version: v$VERSION"
if [[ "$DRY_RUN" == true ]]; then
  echo -e "${YELLOW}Mode: DRY RUN (no publishing)${NC}"
else
  echo -e "${YELLOW}Mode: PUBLISH${NC}"
fi
echo ""

# Check for uncommitted changes
if [[ -n "$(git status --porcelain)" ]]; then
  echo -e "${RED}Error: You have uncommitted changes. Commit or stash them first.${NC}" >&2
  exit 1
fi

# Verify we're on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo -e "${YELLOW}Warning: You're on branch '$CURRENT_BRANCH', not 'main'${NC}"
  echo "Continue? (y/N)"
  read -r CONFIRM
  if [[ "$CONFIRM" != "y" ]] && [[ "$CONFIRM" != "Y" ]]; then
    exit 1
  fi
fi

# Sync release version
echo -e "${GREEN}Step 1: Syncing version across all packages...${NC}"
node scripts/release/sync-release-version.mjs --version "$VERSION"

# Show what changed
echo ""
echo -e "${GREEN}Files updated:${NC}"
git diff --name-only

echo ""
echo -e "${GREEN}Generating release notes preview...${NC}"
mkdir -p dist/release
node scripts/release/generate-changelog.mjs \
  --version "$VERSION" \
  --to HEAD \
  --out dist/release/release-notes.md \
  --changelog-out dist/release/CHANGELOG.generated.md \
  --prompt-out dist/release/changelog-summary-prompt.json
echo "Release notes preview: dist/release/release-notes.md"
echo "Changelog preview: dist/release/CHANGELOG.generated.md"
echo "AI summary prompt package: dist/release/changelog-summary-prompt.json"

echo ""
echo -e "${YELLOW}Review the changes above. Continue? (y/N)${NC}"
read -r CONFIRM
if [[ "$CONFIRM" != "y" ]] && [[ "$CONFIRM" != "Y" ]]; then
  git restore .
  exit 1
fi

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo -e "${YELLOW}DRY RUN: Skipping commit and tag${NC}"
  echo "To complete the release, run:"
  echo "  git commit -am 'chore: release v$VERSION'"
  echo "  git tag v$VERSION"
  echo "  git push origin main --tags"
  exit 0
fi

# Commit and tag
echo ""
echo -e "${GREEN}Step 2: Creating commit and tag...${NC}"
git add -A
git commit -m "chore: release v$VERSION"
git tag "v$VERSION"

echo ""
echo -e "${GREEN}Step 3: Pushing to GitHub...${NC}"
echo "This will trigger GitHub Actions to:"
echo "  - Publish Rust crates to crates.io"
echo "  - Build and publish CLI to npm"
echo "  - Build and publish desktop binaries to GitHub Releases"
echo ""
echo -e "${YELLOW}Push now? (y/N)${NC}"
read -r CONFIRM
if [[ "$CONFIRM" != "y" ]] && [[ "$CONFIRM" != "Y" ]]; then
  echo ""
  echo -e "${YELLOW}Push cancelled. To push manually:${NC}"
  echo "  git push origin main --tags"
  exit 0
fi

git push origin main --tags

echo ""
echo -e "${GREEN}=== Release started! ===${NC}"
echo "Monitor the release at:"
echo "  https://github.com/phodal/routa/actions"
echo ""
echo "Once complete, the release artifacts will be available via:"
echo "  - cargo install routa-cli@$VERSION"
echo "  - cargo install harness-monitor@$VERSION"
echo "  - npm install -g routa-cli@$VERSION"
echo "  - GitHub Release: https://github.com/phodal/routa/releases/tag/v$VERSION"
