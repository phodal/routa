---
title: Quick Start
sidebar_position: 2
---

# Quick Start

Routa currently has three ways to start using the product:

- `Desktop`: best default for most users
- `CLI`: best for terminal-first workflows
- `Web`: best for browser-first access and self-hosting

If you only want the shortest path to “Routa is running and useful”, start with `Desktop` or
`CLI`.

## First Success Checklist

The right goal for your first 5 minutes is not “understand all of Routa”. It is:

1. choose one surface
2. make one provider available
3. point Routa at a real repository
4. get one useful answer or plan back

## Which Path Should You Choose?

| Path | Best for | Install method | Recommendation |
|---|---|---|---|
| Desktop | Most users, visual workflows, Kanban/session/team UI | Download from [GitHub Releases](https://github.com/phodal/routa/releases) | Recommended |
| CLI | Terminal-first users, scripting, ACP/runtime commands | `npm install -g routa-cli` or `cargo install routa-cli` | Recommended |
| Web | Self-hosting, browser-based access, internal deployment | Run the web runtime from source | Optional |

## Fastest Paths

If you want the shortest “it works” path, use one of these:

### Desktop In Practice

1. Download Routa Desktop from [GitHub Releases](https://github.com/phodal/routa/releases).
2. Create a workspace and enable one provider.
3. Attach a repository.
4. Open `Session` and ask: `Explain the architecture of this repository`.

### CLI In Practice

```bash
npm install -g routa-cli
routa -p "Explain the architecture of this repository"
```

If that returns a useful answer against a real repository, your CLI setup is already good enough
to keep going.

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
4. Start with `Session` and ask Routa to inspect or plan work in your repository.
5. Move to `Kanban` when you want decomposition and lane automation.

### Why Desktop First

Desktop is the cleanest onboarding path because it exposes the full product model without
asking users to assemble the runtime manually.

## CLI

CLI is the best path if you live in the terminal and want to use Routa directly inside an
existing repository.

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
routa -p "Explain the architecture of this repository"
routa -p "Plan the next refactor for this codebase"
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
- you want one-shot execution instead of switching to a UI
- you want scripting, automation, or ACP/runtime inspection

## Web

Web is a first-class Routa runtime surface, but it is not the main “download and go” path.
Treat it as:

- the self-hosted browser surface for teams
- the internal deployment target when you want browser access
- the runtime that shares domain semantics with Desktop

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
- choose `Web` if you want browser-based access or self-hosted deployment

## What To Read Next

Pick the next page based on what you are trying to do:

- [Use Routa](./use-routa) if setup is done and you want workflows
- [Configuration](./configuration) if models or providers are not ready yet
- [Platforms](./platforms) if you are still choosing between Desktop, CLI, and Web
- [Use Routa](./use-routa/common-workflows) if you want examples rather than concepts
- [What's New](./whats-new) if you are evaluating recent changes

## Next Steps

After Quick Start:

- read [Use Routa](./use-routa)
- read [Configuration](./configuration)
- compare [Platforms](./platforms) if you are still choosing a surface
- read [Use Routa](./use-routa/common-workflows)
- read [What's New](./whats-new)
