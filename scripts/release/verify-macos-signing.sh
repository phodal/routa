#!/usr/bin/env bash
set -euo pipefail

search_roots=()
artifacts=()
list_out=""
log_path=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --search-root)
      search_roots+=("$2")
      shift 2
      ;;
    --artifact)
      artifacts+=("$2")
      shift 2
      ;;
    --list-out)
      list_out="$2"
      shift 2
      ;;
    --log)
      log_path="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -n "$log_path" ]]; then
  mkdir -p "$(dirname "$log_path")"
  : > "$log_path"
fi

run_and_log() {
  if [[ -n "$log_path" ]]; then
    "$@" 2>&1 | tee -a "$log_path"
  else
    "$@"
  fi
}

append_line() {
  local line="$1"
  if [[ -n "$log_path" ]]; then
    printf '%s\n' "$line" | tee -a "$log_path"
  else
    printf '%s\n' "$line"
  fi
}

absolute_path() {
  local raw_path="$1"
  if [[ "$raw_path" = /* ]]; then
    printf '%s\n' "$raw_path"
  else
    printf '%s/%s\n' "$PWD" "$raw_path"
  fi
}

failures=0

check_command() {
  local description="$1"
  shift

  if ! run_and_log "$@"; then
    append_line "FAILED: $description"
    failures=$((failures + 1))
  fi
}

if [[ ${#artifacts[@]} -eq 0 ]]; then
  found_artifacts=()
  for root in "${search_roots[@]}"; do
    if [[ ! -d "$root" ]]; then
      continue
    fi

    while IFS= read -r path; do
      [[ -n "$path" ]] || continue
      found_artifacts+=("$(absolute_path "$path")")
    done < <(
      find "$root" \
        \( -path '*/release/bundle/macos/*.app' -o -path '*/release/bundle/dmg/*.dmg' \) \
        -print 2>/dev/null | sort -u
    )
  done
  artifacts=("${found_artifacts[@]}")
else
  normalized_artifacts=()
  for artifact in "${artifacts[@]}"; do
    normalized_artifacts+=("$(absolute_path "$artifact")")
  done
  artifacts=("${normalized_artifacts[@]}")
fi

if [[ ${#artifacts[@]} -eq 0 ]]; then
  echo "No macOS .app or .dmg artifacts found to verify" >&2
  exit 1
fi

if [[ -n "$list_out" ]]; then
  mkdir -p "$(dirname "$list_out")"
  : > "$list_out"
  for artifact in "${artifacts[@]}"; do
    printf '%s\n' "$artifact" >> "$list_out"
  done
fi

for artifact in "${artifacts[@]}"; do
  append_line "Verifying $artifact"
  case "$artifact" in
    *.app)
      check_command "codesign verify $artifact" codesign --verify --deep --strict --verbose=4 "$artifact"
      check_command "codesign display $artifact" codesign -dv --verbose=4 "$artifact"
      check_command "spctl exec $artifact" spctl -a -vv -t exec "$artifact"
      check_command "stapler validate $artifact" xcrun stapler validate "$artifact"
      ;;
    *.dmg)
      check_command "spctl open $artifact" spctl -a -vv -t open "$artifact"
      check_command "stapler validate $artifact" xcrun stapler validate "$artifact"
      ;;
    *)
      append_line "FAILED: unsupported macOS artifact $artifact"
      failures=$((failures + 1))
      ;;
  esac
done

if [[ $failures -gt 0 ]]; then
  append_line "Verification completed with $failures failure(s)."
  exit 1
fi

append_line "Verification completed successfully."
