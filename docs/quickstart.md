---
slug: /
title: Routa Docs
---

<div className="routa-home">
  <section className="routa-hero">
    <div className="routa-hero__eyebrow">Workspace-first agent coordination</div>
    <img
      className="routa-hero__media"
      src="/routa/logo-animated.svg"
      alt="Routa orchestration logo"
    />
    <h1 className="routa-hero__title">Turn a Kanban board into an execution surface for AI teams.</h1>
    <p className="routa-hero__lead">
      Routa is a multi-agent coordination platform for software delivery. It combines a
      workspace-first UI, Kanban automation, and protocol bridges across ACP, MCP, A2A, and
      AG-UI so you can route real implementation work through specialized agents instead of a
      single monolithic assistant.
    </p>
    <div className="routa-pills">
      <div className="routa-pill">Next.js web runtime</div>
      <div className="routa-pill">Tauri desktop shell</div>
      <div className="routa-pill">Rust Axum backend</div>
      <div className="routa-pill">Kanban-first automation</div>
    </div>
  </section>
</div>

## What Routa Is For

Routa is built for teams that want agent workflows to stay inspectable, testable, and operable.
Instead of letting one long-running chat own everything, Routa makes work explicit:

- a workspace holds codebases, memory, sessions, and automation state
- a Kanban board becomes the control surface for decomposition and handoff
- specialists are attached to stages like backlog refinement, implementation, review, and reporting
- protocol adapters let external agent runtimes join the flow without changing the product model

## Documentation Map

<div className="routa-doc-map">
  <a href="./ARCHITECTURE">
    <strong>Architecture</strong>
    System boundaries, runtime surfaces, domain model, and cross-backend invariants.
  </a>
  <a href="./design-docs">
    <strong>Design Docs</strong>
    Durable design intent, migration rules, and repository-level constraints.
  </a>
  <a href="./product-specs/FEATURE_TREE">
    <strong>Product Specs</strong>
    Generated route and API surface index for the current product.
  </a>
  <a href="./specialists">
    <strong>Specialists</strong>
    Built-in agent roles, responsibilities, and generated specialist reference pages.
  </a>
  <a href="./exec-plans">
    <strong>Execution Plans</strong>
    Active implementation plans, completed work, and cross-cutting tech debt tracking.
  </a>
  <a href="./releases/v0.2.5-release-notes">
    <strong>Releases</strong>
    Version notes for shipped milestones and notable platform changes.
  </a>
</div>

## Platform Surface

<div className="routa-grid">
  <div className="routa-card routa-card--blue">
    <h3>Coordinator</h3>
    <p>
      Routa plans, routes, and observes work. The coordinator owns intent decomposition and
      keeps the board, sessions, and tooling aligned.
    </p>
  </div>
  <div className="routa-card routa-card--orange">
    <h3>Execution Lanes</h3>
    <p>
      Backlog, Todo, Dev, Review, and Done can each bind to a specialist so lane transitions
      become operational triggers rather than passive status changes.
    </p>
  </div>
  <div className="routa-card routa-card--green">
    <h3>Protocol Bridges</h3>
    <p>
      ACP manages agent processes, MCP exposes coordination tools, A2A covers federation, and
      AG-UI supports richer agent-generated interface patterns.
    </p>
  </div>
</div>

## Quickstart

```bash
npm install --legacy-peer-deps
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To run the desktop shell as well:

```bash
npm --prefix apps/desktop install
npm run tauri:dev
```

To run the Rust backend directly:

```bash
cargo run -p routa-server
```

If you are running against a custom backend endpoint, set:

```bash
ROUTA_RUST_BACKEND_URL="http://127.0.0.1:3210"
npm run dev
```

## Validation Basics

```bash
npm run lint
npm run test:run
```

## Core Usage

### Web

Use the home page to create or enter a workspace, connect a repository, and route a new
requirement into the board-driven workflow.

### CLI

The desktop package provides a Rust CLI binary in distribution:

```bash
routa --help
routa -p "Build user auth system"
```

## Recommended Reading Order

- Architecture: [ARCHITECTURE](./ARCHITECTURE)
- Design docs: [Design Docs Index](./design-docs)
- Product spec: [Feature tree](./product-specs/FEATURE_TREE)
- Specialists: [Specialist reference](./specialists)
- Release notes: [v0.2.5 notes](./releases/v0.2.5-release-notes)

## FAQ

- If a provider command is missing, install provider CLI first (`opencode`, `claude`, etc.).
- If Tauri dependencies are missing, install desktop dependencies with `npm --prefix apps/desktop install`.
- If static build fails, check Node version and run from repo root.

## Demo

- Video walkthrough: https://www.bilibili.com/video/BV16CwyzUED5/
