#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
GITMODULES_FILE="$ROOT_DIR/.gitmodules"

normalize_url() {
  local url="$1"
  if [[ "$url" =~ ^git@github\.com:(.+)$ ]]; then
    printf 'https://github.com/%s\n' "${BASH_REMATCH[1]}"
    return
  fi
  printf '%s\n' "$url"
}

cleanup() {
  if [[ -n "${TMP_DIR:-}" && -d "${TMP_DIR:-}" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

trap cleanup EXIT

main() {
  if [[ ! -f "$GITMODULES_FILE" ]]; then
    echo "[submodule] No .gitmodules found, skipping submodule ref check."
    exit 0
  fi

  cd "$ROOT_DIR"
  TMP_DIR="$(mktemp -d)"

  local found_any=false
  local failures=0

  echo "[submodule] Verifying pinned submodule refs..."

  while IFS=$'\n' read -r entry; do
    [[ -z "$entry" ]] && continue
    found_any=true

    local key="${entry%% *}"
    local path="${entry#* }"
    local name="${key#submodule.}"
    name="${name%.path}"

    local url
    url="$(git config -f "$GITMODULES_FILE" --get "submodule.$name.url" || true)"
    if [[ -z "$url" ]]; then
      echo "[submodule] WARN $path is missing a configured URL; skipping."
      continue
    fi

    local sha
    sha="$(git ls-tree HEAD "$path" | awk '{print $3}')"
    if [[ -z "$sha" ]]; then
      echo "[submodule] WARN $path is not present in HEAD; skipping."
      continue
    fi

    local remote_url
    remote_url="$(normalize_url "$url")"

    echo "[submodule] Checking $path @ $sha"

    local probe_dir="$TMP_DIR/$name"
    git init --bare "$probe_dir" >/dev/null 2>&1

    if git -C "$probe_dir" fetch --depth=1 "$remote_url" "$sha" >/dev/null 2>&1; then
      echo "[submodule] OK $path commit is available on $remote_url"
      continue
    fi

    echo "[submodule] FAIL $path points to missing remote commit $sha"
    echo "[submodule]      Remote: $remote_url"
    echo "[submodule]      Push the submodule commit first or update the gitlink to a reachable commit."
    failures=$((failures + 1))
  done < <(git config -f "$GITMODULES_FILE" --get-regexp '^submodule\..*\.path$' || true)

  if [[ "$found_any" == false ]]; then
    echo "[submodule] No configured submodules found, skipping submodule ref check."
    exit 0
  fi

  if [[ $failures -gt 0 ]]; then
    echo "[submodule] Submodule ref check failed."
    exit 1
  fi

  echo "[submodule] All submodule refs are reachable."
}

main "$@"
