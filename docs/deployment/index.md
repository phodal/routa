---
title: Deployment Overview
---

# Deployment

Deployment in Routa currently spans two related concerns:

- shipping downloadable artifacts such as Desktop and CLI binaries
- running or publishing the web/runtime surfaces in your own environment

## Deployment Paths

| Path | What it means today |
| --- | --- |
| Desktop distribution | packaged app builds published through GitHub Releases |
| CLI distribution | package publishing through npm and crates.io |
| Web runtime | local development or self-hosted deployment from source |

## Current Canonical Docs

- [Release Guide](/release-guide)
- [Changelog](/getting-started/changelog)
- [GitHub Releases](https://github.com/phodal/routa/releases)

## What This Covers Today

- Desktop distribution through GitHub Releases
- CLI publishing through npm and crates.io
- release and versioning workflows for maintainers

This section is intentionally thin for now because the repository has stronger release docs than
public self-hosting docs at the moment.
