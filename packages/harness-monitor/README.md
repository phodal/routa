# Harness Monitor (NPM)

Command-line distribution of Harness Monitor through npm. The package provides
the `harness-monitor` command by resolving a prebuilt platform binary and
launching it through a thin Node.js wrapper.

## Installation

Install globally:

```bash
npm install -g harness-monitor
```

Run without installing:

```bash
npx -p harness-monitor harness-monitor --help
```

The installed command is `harness-monitor`.

## Package Layout

`harness-monitor` is a thin launcher package. At install time npm resolves one
of these optional platform packages and the wrapper executes the bundled binary:

- `harness-monitor-darwin-arm64`
- `harness-monitor-darwin-x64`
- `harness-monitor-linux-x64`
- `harness-monitor-windows-x64`

If the current platform does not receive a matching optional dependency,
reinstall the package so npm can fetch the correct binary package.

## Quick Start

Launch the TUI against the current repository:

```bash
harness-monitor --repo .
```

Run explicit subcommands:

```bash
harness-monitor tui --repo .
harness-monitor serve --repo .
harness-monitor hook codex SessionStart
harness-monitor git-hook post-commit
```

## Requirements

- Node.js 18+
- One of the supported prebuilt platform packages

## Architecture

```text
harness-monitor (NPM package)
  ├── bin/harness-monitor.js
  ├── optionalDependencies
  └── harness-monitor binary
```

The binary it launches is documented as a four-layer harness loop:

```text
Context  repo rules, templates, architecture docs
Run      task / run / workspace / policy semantics
Observe  hooks, process scan, git dirty attribution
Govern   Entrix gates, evidence, delivery readiness
```

For overview slides, the shorthand is `Observe -> Attribute -> Evaluate + Expand`.

The detailed model used by the binary is documented in [../../docs/harness/harness-monitor-run-centric-operator-model.md](../../docs/harness/harness-monitor-run-centric-operator-model.md).
