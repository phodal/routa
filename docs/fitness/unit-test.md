# Rust Unit Test Fitness Plan

> Workflow entry: read `docs/fitness/README.md` before updating this tracker.

## Baseline (2026-03-13)

- Scope: `crates/routa-core/src` + `crates/routa-server/src`
- Rust source files: 120
- Files with test markers (`#[test]` / `#[tokio::test]` at baseline): 13
- Gap at baseline: 107 files without direct test markers

## Coverage Targets

- Focus: test coverage is the primary fitness signal (not only task checklist progress).
- Tooling target: `cargo llvm-cov` (line/function/region coverage).
- Interim proxy (until `cargo llvm-cov` available): file-level test-marker ratio.
- Current proxy: `15 / 120 = 12.5%` files with test markers.
- Target gates:
  - `routa-core` line coverage >= 55% (short-term), >= 70% (mid-term).
  - changed Rust files in PR should not reduce crate-level coverage.
  - new store/api modules should include direct unit tests in same PR.

## Plan

1. Phase 1: Add high-signal unit tests for pure logic in `routa-core` (no network, no external services).
2. Phase 2: Add store-layer behavior tests using in-memory DB and deterministic fixtures.
3. Phase 3: Add focused API handler tests in `routa-server` for request/response edge cases.
4. Phase 4: Track module-level coverage trend and tighten regression gates.

## Progress

- [x] Phase 1 started
- [x] Added `git.rs` unit tests for:
  - GitHub URL parsing
  - Repo dir-name conversion helpers
  - YAML frontmatter extraction + fallback parsing
  - Skill discovery directory scanning
  - Branch name sanitization
  - Recursive copy skip rules (`.git`, `node_modules`)
- [x] Phase 2 started
- [x] Added store-layer unit tests for:
  - `workspace_store.rs` (`save/get/list`, `update_title`, `update_status`, `list_by_status`, `ensure_default`, `delete`)
  - `codebase_store.rs` (`save/get/find_by_repo_path`, `update`, `set_default`, `list_by_workspace`, `delete`)
- [x] Phase 3 started
- [x] Added API-layer unit tests in `routa-server` for pure helper logic:
  - `files.rs` (`fuzzy_match`, `should_ignore`, `walk_directory`)
  - `clone.rs` (`parse_git_clone_error` mapping/fallback behavior)
- [ ] Phase 4 started

## Validation Log

- Coverage tooling:
  - `cargo llvm-cov --version` -> unavailable in current environment (`no such command: llvm-cov`).
  - Action: install `cargo-llvm-cov` in dev/CI and start recording line coverage trend.
- `npm run rust:cov`:
  - Result: failed with actionable setup output (`cargo-llvm-cov is not installed`), expected in current environment.
- `cargo test -p routa-core --offline`:
  - Result: failed due existing permission-sensitive tests in `storage::local_session_provider::*` (`Operation not permitted` in sandbox).
  - Note: all newly added tests under `git::tests::*` passed.
- `cargo test -p routa-core --offline git::tests`:
  - Result: passed (7/7).
- `cargo clippy -p routa-core --offline --all-targets -- -D warnings`:
  - Result: passed.
- `cargo test -p routa-core --offline workspace_store::tests`:
  - Result: passed (4/4).
- `cargo test -p routa-core --offline codebase_store::tests`:
  - Result: passed (4/4).
- `cargo test -p routa-server --offline files::tests`:
  - Result: passed (3/3).
- `cargo test -p routa-server --offline clone::tests`:
  - Result: passed (2/2).
- `cargo clippy -p routa-server --offline --all-targets -- -D warnings`:
  - Result: passed.
