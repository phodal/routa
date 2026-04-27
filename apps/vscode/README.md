# Routa VS Code Extension

This package hosts Routa inside VS Code by starting the existing local
`routa server` process and rendering the Routa web UI in a VS Code Webview.

## Development

From the repository root:

```bash
npm run vscode:compile
npm run vscode:build
```

The extension looks for a Routa CLI executable in this order:

1. `routa.server.executablePath`
2. `apps/vscode/bin/<platform>-<arch>/routa`
3. `target/release/routa`
4. `target/debug/routa`
5. `routa` on `PATH`

For local development, build the CLI first if needed:

```bash
cargo build -p routa-cli
```

The static frontend is resolved from `routa.server.staticDir`, then
`apps/vscode/dist/frontend`, then the repository `out` directory.
