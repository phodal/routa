---
title: Developer Guide Overview
hide_table_of_contents: true
---

# Developer Guide

This section is for developers who are evaluating Routa more deeply, configuring it beyond the
first-run path, or running it in their own environment.

## Start Here

<div className="routa-doc-map">
  <a href="/routa/configuration">
    <strong>Configuration</strong>
    Set up providers, models, and environment variables so Routa can actually run useful work.
  </a>
  <a href="/routa/administration">
    <strong>Administration</strong>
    Use self-hosting, deployment, and release-oriented docs when you are operating Routa for a
    team or internal environment.
  </a>
  <a href="/routa/developer-guide/project-structure">
    <strong>Project Structure</strong>
    Learn how the desktop app, CLI, web runtime, and server pieces fit together.
  </a>
  <a href="/routa/ARCHITECTURE">
    <strong>Architecture</strong>
    Read the canonical system boundaries, runtime topology, and dual-backend invariants.
  </a>
  <a href="/routa/developer-guide/testing">
    <strong>Testing</strong>
    Understand the validation flow and fitness tiers when changing or running Routa yourself.
  </a>
  <a href="/routa/developer-guide/local-overlay-sync">
    <strong>Local Overlay Sync</strong>
    Keep a self-hosted Routa checkout upgradeable when you also carry local-only patches and
    upstream PR branches.
  </a>
  <a href="/routa/deployment">
    <strong>Deployment</strong>
    Use this when you are taking the web surface or supporting services into a real environment.
  </a>
</div>

## What This Section Is For

Use this section when you need more than the normal end-user path:

- configuring providers and deployment environments
- understanding how the product surfaces fit together technically
- running Routa in a team or self-hosted environment
- extending Routa after the user-facing path is already clear

## Recommended Reading Order

1. Read [Configuration](/configuration) to get one provider and one working model path.
2. Read [Administration](/administration) if you are operating Routa for a team or internal environment.
3. Read [Project Structure](/developer-guide/project-structure) and [Architecture](/ARCHITECTURE) for deeper technical context.
4. Read [Testing](/developer-guide/testing) and [Deployment](/deployment) when you need validation or rollout guidance.
5. Read [Local Overlay And Upstream Sync](/developer-guide/local-overlay-sync) if you run Routa locally with long-lived local patches and still need clean upstream updates.

## Maintainer-Only Material

Most readers do not need these on day one:

- [Code Style](/coding-style): implementation and testing conventions for repository changes
- [Git Workflow](/developer-guide/git-workflow): commit and branch discipline
- [Contributing](/developer-guide/contributing): contribution flow for Routa itself
