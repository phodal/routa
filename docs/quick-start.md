---
title: Quick Start
sidebar_position: 2
---

# Quick Start

Routa currently has three product entry points:

- `Desktop`: best default for most users
- `CLI`: best for terminal-first workflows
- `Web`: best for contributors and self-hosting

If you only want the shortest path to “Routa is running and useful”, start with `Desktop` or
`CLI`.

## Which Path Should You Choose?

| Path | Best for | Install method | Recommendation |
|---|---|---|---|
| Desktop | Most users, visual workflows, Kanban/session/team UI | Download from [GitHub Releases](https://github.com/phodal/routa/releases) | Recommended |
| CLI | Terminal-first users, scripting, ACP/runtime commands | `npm install -g routa-cli` or `cargo install routa-cli` | Recommended |
| Web | Contributors, local dev, self-hosting | Run the web runtime from source | Optional |

## Desktop

Desktop is the best starting point if you want the full Routa experience:

- workspace creation
- provider management
- session and Kanban flows
- team coordination
- local-first storage and execution

### Install

1. Open [GitHub Releases](https://github.com/phodal/routa/releases).
2. Download the latest Desktop build for your platform.
3. Install and launch Routa Desktop.

### First Run

After launch:

1. Create a workspace.
2. Open `Providers` and make one provider available.
3. Attach a local repository or clone one from GitHub.
4. Start with `Session` for the shortest first success path.
5. Move to `Kanban` when you want decomposition and lane automation.

### Why Desktop First

Desktop is the cleanest onboarding path because it exposes the full product model without
asking users to assemble the runtime manually.

## CLI

CLI is the best path if you live in the terminal or want to script Routa workflows.

### Install From npm

This is the easiest CLI install for most users:

```bash
npm install -g routa-cli
```

Check the install:

```bash
routa --help
routa --version
```

### Install From Cargo

If you are Rust-first:

```bash
cargo install routa-cli
```

Check the install:

```bash
routa --help
routa --version
```

### Use Without Global Install

If you just want to try it:

```bash
npx -p routa-cli routa --help
```

### First Commands

The fastest smoke test is a one-off prompt:

```bash
routa -p "Implement a calculator CLI"
routa -p "Add OAuth login with Google and GitHub providers"
```

Useful next commands:

```bash
routa acp list
routa acp runtime-status
routa workspace list
routa team status --workspace-id default
```

### Why CLI First

CLI is the fastest path when:

- you already have your repo open in a terminal
- you want one-shot execution instead of UI navigation
- you want scripting, automation, or ACP/runtime inspection

## Web

Web is a first-class runtime surface in the architecture, but it is not the main “download and
go” path. Treat it as:

- the self-hosted browser surface
- the contributor/development runtime
- the web deployment target that shares domain semantics with Desktop

### Run Locally

```bash
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3000`.

If you want the web UI to point at the local desktop/backend server:

```bash
ROUTA_RUST_BACKEND_URL="http://127.0.0.1:3210" npm run dev
```

## Recommendation

Use these defaults:

- choose `Desktop` if you want the product experience
- choose `CLI` if you want the terminal experience
- choose `Web` if you are developing or self-hosting Routa

## Next Steps

After Quick Start:

- read [Use Routa](./use-routa)
- read [Architecture](./ARCHITECTURE)
- browse [Specialists](./specialists)
- inspect [Product Specs](./product-specs/FEATURE_TREE)
- read [Releases](./releases/v0.2.5-release-notes)
