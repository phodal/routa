#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUTA_WATCH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(git -C "$ROUTA_WATCH_DIR" rev-parse --show-toplevel)"

TEMPLATE_DIR="$ROUTA_WATCH_DIR/templates"
CODEx_TEMPLATE="$TEMPLATE_DIR/codex-hooks.json"
GIT_TEMPLATE_DIR="$TEMPLATE_DIR/git-hooks"

mkdir -p "$HOME/.codex"
mkdir -p "$REPO_ROOT/.git/hooks"

echo "Installing Codex hook config to $HOME/.codex/hooks.json"
cp "$CODEx_TEMPLATE" "$HOME/.codex/hooks.json"

for hook in post-commit post-merge post-checkout; do
  cp "$GIT_TEMPLATE_DIR/$hook" "$REPO_ROOT/.git/hooks/$hook"
  chmod +x "$REPO_ROOT/.git/hooks/$hook"
  echo "Installed .git/hooks/$hook"
done

echo "Harness Monitor hook scripts installed."
