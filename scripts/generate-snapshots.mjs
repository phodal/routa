#!/usr/bin/env node

import {
  captureSnapshot,
  createSnapshotRuntime,
  createBrowser,
  isServerReachable,
  loadRegistry,
  parseCliArgs,
  resolveWorkspacePath,
  selectSnapshotTargets,
  shouldUpdateTarget,
  startDevServer,
  waitForServer,
} from "./page-snapshot-lib.mjs";

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const registry = selectSnapshotTargets(loadRegistry(), options);

  if (registry.length === 0) {
    console.error(`No page snapshot target matched --page=${options.page}`);
    process.exit(1);
  }

  let devServer = null;
  const snapshotRuntime = await createSnapshotRuntime();
  const serverReachable = await isServerReachable(options.baseUrl);
  if (snapshotRuntime.requiresManagedServer && serverReachable) {
    throw new Error(
      `Snapshot fixtures require an isolated dev server, but ${options.baseUrl} is already in use. ` +
      "Stop the existing server or disable fixtures before generating snapshots."
    );
  }
  const serverAlreadyRunning = snapshotRuntime.requiresManagedServer
    ? false
    : serverReachable;
  if (!serverAlreadyRunning) {
    console.log(`Starting dev server at ${options.baseUrl}...`);
    devServer = startDevServer(options.baseUrl, snapshotRuntime.env);
    await waitForServer(options.baseUrl, options.timeoutMs, devServer.getLogs);
  }

  const browser = await createBrowser(options.headed);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  let generated = 0;
  let skipped = 0;

  try {
    for (const target of registry) {
      const snapshotPath = resolveWorkspacePath(target.snapshotFile);

      if (!options.update && !shouldUpdateTarget(target)) {
        console.log(`⏭️  ${target.id}: snapshot is up-to-date`);
        skipped += 1;
        continue;
      }

      console.log(`📸 ${target.id}: capturing snapshot...`);

      try {
        await captureSnapshot({
          page,
          target,
          baseUrl: options.baseUrl,
          timeoutMs: options.timeoutMs,
          outputPath: snapshotPath,
        });

        generated += 1;
        console.log(`✅ ${target.id}: snapshot saved to ${target.snapshotFile}`);
      } catch (error) {
        console.error(`❌ ${target.id}: failed to capture snapshot`);
        console.error(error instanceof Error ? error.message : error);
      }
    }
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    if (devServer) {
      devServer.child.kill("SIGTERM");
    }
    snapshotRuntime.cleanup();
  }

  console.log(`\nGenerated ${generated} snapshots, skipped ${skipped}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
