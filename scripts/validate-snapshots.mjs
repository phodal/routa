#!/usr/bin/env node

import fs from "node:fs";

import {
  captureSnapshot,
  createBrowser,
  isServerReachable,
  loadRegistry,
  normalizeComparableSnapshot,
  parseCliArgs,
  resolveWorkspacePath,
  selectSnapshotTargets,
  startDevServer,
  summarizeDiff,
  waitForServer,
  writeReport,
} from "./page-snapshot-lib.mjs";

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const registry = selectSnapshotTargets(loadRegistry(), options);

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

  const browser = await createBrowser(options.headed);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    validated: 0,
    matched: 0,
    mismatched: 0,
    updated: 0,
    missing: 0,
    diffs: [],
  };

  try {
    for (const target of registry) {
      report.validated += 1;
      const snapshotPath = resolveWorkspacePath(target.snapshotFile);

      if (!fs.existsSync(snapshotPath)) {
        report.missing += 1;
        report.diffs.push({ target: target.id, reason: "missing snapshot" });
        console.log(`❌ ${target.id}: missing snapshot`);
        continue;
      }

      const tempPath = `${snapshotPath}.tmp`;

      try {
        await captureSnapshot({
          page,
          target,
          baseUrl: options.baseUrl,
          timeoutMs: options.timeoutMs,
          outputPath: tempPath,
        });

        const expected = normalizeComparableSnapshot(fs.readFileSync(snapshotPath, "utf-8"));
        const actual = normalizeComparableSnapshot(fs.readFileSync(tempPath, "utf-8"));

        if (expected === actual) {
          report.matched += 1;
          console.log(`✅ ${target.id}: snapshot matches`);
        } else {
          report.mismatched += 1;
          const diff = summarizeDiff(expected, actual);
          report.diffs.push({ target: target.id, reason: "content mismatch", diff });
          console.log(`❌ ${target.id}: snapshot mismatch`);

          if (options.update) {
            fs.renameSync(tempPath, snapshotPath);
            report.updated += 1;
            console.log(`📝 ${target.id}: snapshot updated`);
            continue;
          }
        }
      } finally {
        if (fs.existsSync(tempPath)) {
          fs.rmSync(tempPath, { force: true });
        }
      }
    }
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    if (devServer) {
      devServer.child.kill("SIGTERM");
    }
    writeReport(report);
  }

  console.log(`\nValidated ${report.validated} snapshots, matched ${report.matched}, mismatched ${report.mismatched}, updated ${report.updated}, missing ${report.missing}.`);
  if (report.mismatched > 0 || report.missing > 0) {
    process.exit(options.update ? 0 : 1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
