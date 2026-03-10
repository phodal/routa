#!/usr/bin/env node

import {
  captureSnapshot,
  capturePlaywrightArtifactState,
  cleanupPlaywrightArtifacts,
  closeSession,
  getPlaywrightCliVersion,
  loadRegistry,
  openSession,
  parseCliArgs,
  resolveWorkspacePath,
  shouldUpdateTarget,
  startDevServer,
  waitForServer,
  isServerReachable,
} from "./page-snapshot-lib.mjs";

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const registry = loadRegistry().filter((target) => !options.page || target.id === options.page);

  if (registry.length === 0) {
    console.error(`No page snapshot target matched --page=${options.page}`);
    process.exit(1);
  }

  let devServer = null;
  const serverAlreadyRunning = await isServerReachable(options.baseUrl);
  if (!serverAlreadyRunning) {
    console.log(`Starting dev server at ${options.baseUrl}...`);
    devServer = startDevServer(options.baseUrl);
    await waitForServer(options.baseUrl, options.timeoutMs, devServer.getLogs);
  }

  const sessionName = `psg-${process.pid}`;
  const playwrightCliVersion = getPlaywrightCliVersion();
  const stats = { total: registry.length, generated: 0, skipped: 0, failed: 0, failures: [] };
  const artifactState = capturePlaywrightArtifactState();

  try {
    openSession(sessionName, options.headed);

    for (const target of registry) {
      if (options.update && !shouldUpdateTarget(target)) {
        console.log(`Skipping ${target.id} (snapshot is up to date)`);
        stats.skipped += 1;
        continue;
      }

      const outputPath = resolveWorkspacePath(target.snapshotFile);
      console.log(`Generating ${target.id} -> ${target.snapshotFile}`);

      try {
        captureSnapshot({
          sessionName,
          target,
          baseUrl: options.baseUrl,
          timeoutMs: options.timeoutMs,
          playwrightCliVersion,
          outputPath,
        });
        stats.generated += 1;
      } catch (error) {
        stats.failed += 1;
        stats.failures.push({
          target: target.id,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`Failed to generate ${target.id}:`, error instanceof Error ? error.message : error);
      }
    }
  } finally {
    closeSession(sessionName);
    cleanupPlaywrightArtifacts(artifactState);
    if (devServer) {
      devServer.child.kill("SIGTERM");
    }
  }

  console.log(`Generated ${stats.generated}/${stats.total} snapshots, skipped ${stats.skipped}, failed ${stats.failed}.`);
  if (stats.failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});