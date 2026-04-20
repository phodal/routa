---
title: Platforms Overview
hide_table_of_contents: true
---

# Platforms

Routa exposes the same product model across multiple runtime surfaces so you can choose the
developer experience that fits your workflow.

## Surface Comparison

| Surface | Best for | First action | Recommendation |
| --- | --- | --- | --- |
| [Desktop](/platforms/desktop) | most users, visual workflows, complete product surface | download from GitHub Releases | Recommended |
| [CLI](/platforms/cli) | terminal-first use, one-shot prompts, automation | install `routa-cli` from npm or Cargo | Recommended |
| [Web](/platforms/web) | browser-based access, internal deployment, self-hosting | run the app from source | Optional |

## How To Choose

- Choose `Desktop` if you want the most complete Routa experience with the least setup friction.
- Choose `CLI` if you already work from the terminal and want prompt or runtime control directly in a repository.
- Choose `Web` if you want to run Routa as a browser surface in your own environment.

## Shared Product Semantics

Across all three surfaces, the important product ideas stay the same:

- work is scoped to a workspace
- providers execute sessions
- repositories are attached to workspaces
- Session, Kanban, and Team remain the core working modes

## Read Next

- [Desktop](/platforms/desktop)
- [CLI](/platforms/cli)
- [Web](/platforms/web)
- [Configuration](/configuration) for providers and environment setup
