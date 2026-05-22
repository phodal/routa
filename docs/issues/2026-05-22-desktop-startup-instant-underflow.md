---
title: "desktop backend panics on fresh Windows boot due to Instant underflow"
date: "2026-05-22"
kind: issue
status: open
severity: high
area: "desktop"
tags: ["desktop", "windows", "rust", "docker", "startup"]
reported_by: "github"
related_issues: ["https://github.com/phodal/routa/issues/554"]
github_issue: 554
github_state: open
github_url: "https://github.com/phodal/routa/issues/554"
---

# desktop backend panics on fresh Windows boot due to Instant underflow

## What Happened

The Windows desktop app can panic shortly after the embedded Rust backend binds to `127.0.0.1:3210`:

```text
overflow when subtracting duration from instant
```

The report notes that the crash reproduces on machines with low uptime, which points to startup code subtracting a fixed duration from `Instant::now()`.

## Why It Matters

The app can exit before the WebView appears. Users on freshly booted Windows systems cannot start the desktop app reliably.

## Root Cause

`DockerDetector::new()` initialized its cache timestamp with:

```rust
Instant::now() - Duration::from_secs(3600)
```

On Windows, subtracting a duration greater than system uptime from `Instant` can underflow and panic.

## Remediation

- Replace direct `Instant - Duration` arithmetic with `checked_sub`.
- Fall back to `now` on underflow while keeping the initial cache state stale through `cached_status: None`.
- Add a regression test for the saturating helper.

## Verification Plan

- `cargo test -p routa-core acp::docker::detector::tests`
- `cargo test -p routa-core`
- `entrix run --tier fast`

## Verification

- `cargo test -p routa-core acp::docker::detector::tests` passed.
- `cargo build -p routa-server` passed.
- `entrix run --tier fast` passed.
