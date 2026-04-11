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

## Start Here

Routa currently has three ways to use the product:

### Desktop

Best default for most users.

- install by downloading the latest app from [GitHub Releases](https://github.com/phodal/routa/releases)
- use the full workspace, session, kanban, and team UI
- local-first runtime with bundled desktop shell and local storage

### CLI

Best if you already work from the terminal.

- install from npm with `npm install -g routa-cli`
- or install from Cargo with `cargo install routa-cli`
- good for one-shot prompts, ACP runtime commands, and scripted workflows

### Web

Best for contributors and self-hosting.

- run the Next.js web surface locally or deploy it yourself
- shares the same domain semantics as Desktop
- more of a runtime surface than the fastest first-install path

If you want the shortest install path, read [Quick Start](./quick-start).

## Documentation Map

<div className="routa-doc-map">
  <a href="./getting-started">
    <strong>Getting Started</strong>
    The start path: overview, quick start, and changelog entry points.
  </a>
  <a href="./core-concepts">
    <strong>Core Concepts</strong>
    Workspace, sessions, Kanban, Team, providers, and the product model.
  </a>
  <a href="./use-routa">
    <strong>Use Routa</strong>
    Sessions, Kanban, Team, and the practical mode choices after setup.
  </a>
  <a href="./platforms">
    <strong>Platforms</strong>
    Desktop, CLI, and Web as separate runtime surfaces and onboarding paths.
  </a>
  <a href="./configuration">
    <strong>Configuration</strong>
    Providers, models, role defaults, and environment variables.
  </a>
  <a href="./deployment">
    <strong>Deployment</strong>
    Release artifacts, downloadable builds, and maintainer publishing guidance.
  </a>
  <a href="./reference">
    <strong>Reference</strong>
    Product specs, specialists, release process, and coding conventions.
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
