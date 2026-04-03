#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const nextEq = token.indexOf("=");
    if (nextEq > 0) {
      const key = token.slice(2, nextEq);
      args[key] = token.slice(nextEq + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = "true";
    }
  }

  return args;
}

function decodeTarString(buffer) {
  return buffer.toString("utf8").replace(/\0.*$/, "");
}

function parseTarEntries(gzipBuffer) {
  const buffer = zlib.gunzipSync(gzipBuffer);
  const entries = [];
  let offset = 0;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = decodeTarString(header.subarray(0, 100));
    const prefix = decodeTarString(header.subarray(345, 500));
    const fullPath = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(
      decodeTarString(header.subarray(124, 136)).trim() || "0",
      8,
    );
    const typeFlag = decodeTarString(header.subarray(156, 157));
    const isFile = typeFlag === "" || typeFlag === "0";
    if (fullPath && isFile) {
      entries.push({ path: fullPath, size_bytes: size });
    }

    const dataBlocks = Math.ceil(size / 512);
    offset += 512 + dataBlocks * 512;
  }

  return entries;
}

function topLargestEntries(entries, limit = 5) {
  return [...entries]
    .sort((left, right) => right.size_bytes - left.size_bytes)
    .slice(0, limit);
}

function summarizeEntries(entries) {
  const sourcemaps = entries.filter((entry) => entry.path.endsWith(".map"));
  return {
    total_size_bytes: entries.reduce((sum, entry) => sum + entry.size_bytes, 0),
    file_count: entries.length,
    sourcemap_count: sourcemaps.length,
    sourcemap_bytes: sourcemaps.reduce((sum, entry) => sum + entry.size_bytes, 0),
    largest_entries: topLargestEntries(entries),
  };
}

function parsePathListArg(rawValue) {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function summarizeDirectory(rootDir, relativeTo = rootDir) {
  const entries = [];

  async function walk(currentDir) {
    const dirEntries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of dirEntries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      const stat = await fsp.stat(fullPath);
      entries.push({
        path: path.relative(relativeTo, fullPath).split(path.sep).join("/"),
        size_bytes: stat.size,
      });
    }
  }

  await walk(rootDir);
  return {
    entries,
    ...summarizeEntries(entries),
  };
}

async function collectCliBinaryArtifacts(artifactRoot, channel) {
  if (!artifactRoot || !fs.existsSync(artifactRoot)) {
    return [];
  }

  const directories = await fsp.readdir(artifactRoot, { withFileTypes: true });
  const artifacts = [];

  for (const entry of directories) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dirPath = path.join(artifactRoot, entry.name);
    const files = await fsp.readdir(dirPath, { withFileTypes: true });
    for (const fileEntry of files) {
      if (!fileEntry.isFile()) {
        continue;
      }
      const fullPath = path.join(dirPath, fileEntry.name);
      const stat = await fsp.stat(fullPath);
      artifacts.push({
        kind: "cli_binary",
        target: entry.name,
        arch: entry.name.includes("arm64") ? "arm64" : "x64",
        channel,
        path: fullPath,
        size_bytes: stat.size,
        file_count: 1,
        sourcemap_count: 0,
        sourcemap_bytes: 0,
        entries: [{ path: fileEntry.name, size_bytes: stat.size }],
        largest_entries: [{ path: fileEntry.name, size_bytes: stat.size }],
      });
    }
  }

  return artifacts;
}

async function collectNpmTarballs(npmDir, channel) {
  if (!npmDir || !fs.existsSync(npmDir)) {
    return [];
  }

  const files = await fsp.readdir(npmDir, { withFileTypes: true });
  const artifacts = [];

  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith(".tgz")) {
      continue;
    }
    const fullPath = path.join(npmDir, entry.name);
    const stat = await fsp.stat(fullPath);
    const tarEntries = parseTarEntries(await fsp.readFile(fullPath));
    const summary = summarizeEntries(tarEntries);
    artifacts.push({
      kind: "npm_tarball",
      target: entry.name.includes("darwin-arm64")
        ? "darwin-arm64"
        : entry.name.includes("darwin-x64")
          ? "darwin-x64"
          : entry.name.includes("linux-x64")
            ? "linux-x64"
            : entry.name.includes("windows-x64") || entry.name.includes("win32-x64")
              ? "win32-x64"
              : "generic",
      arch: entry.name.includes("arm64") ? "arm64" : "x64",
      channel,
      path: fullPath,
      size_bytes: stat.size,
      unpacked_size_bytes: tarEntries.reduce((sum, item) => sum + item.size_bytes, 0),
      file_count: summary.file_count,
      sourcemap_count: summary.sourcemap_count,
      sourcemap_bytes: summary.sourcemap_bytes,
      entries: tarEntries,
      largest_entries: summary.largest_entries,
    });
  }

  return artifacts;
}

async function collectTauriBundles(bundleDirs, channel) {
  if (!bundleDirs || bundleDirs.length === 0) {
    return [];
  }

  const bundleRoots = [];
  const seenBundleRoots = new Set();

  function addBundleRoot(bundleRoot) {
    const normalized = path.resolve(bundleRoot);
    if (seenBundleRoots.has(normalized)) {
      return;
    }
    seenBundleRoots.add(normalized);
    bundleRoots.push(normalized);
  }

  async function findBundleRoots(currentDir) {
    const dirEntries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.name === "bundle") {
        addBundleRoot(fullPath);
        continue;
      }
      await findBundleRoots(fullPath);
    }
  }

  for (const bundleDir of bundleDirs) {
    if (!fs.existsSync(bundleDir)) {
      continue;
    }

    if (path.basename(bundleDir) === "bundle") {
      addBundleRoot(bundleDir);
      continue;
    }

    await findBundleRoots(bundleDir);
  }

  const artifacts = [];

  for (const bundleRoot of bundleRoots) {
    const bundleKinds = await fsp.readdir(bundleRoot, { withFileTypes: true });
    for (const entry of bundleKinds) {
      const fullPath = path.join(bundleRoot, entry.name);
      if (entry.isDirectory()) {
        const childEntries = await fsp.readdir(fullPath, { withFileTypes: true });
        for (const child of childEntries) {
          const childPath = path.join(fullPath, child.name);
          if (child.isDirectory()) {
            const summary = await summarizeDirectory(childPath, childPath);
            artifacts.push({
              kind: "tauri_bundle",
              target: entry.name,
              channel,
              path: childPath,
              size_bytes: summary.total_size_bytes,
              file_count: summary.file_count,
              sourcemap_count: summary.sourcemap_count,
              sourcemap_bytes: summary.sourcemap_bytes,
              entries: summary.entries,
              largest_entries: summary.largest_entries,
            });
          } else {
            const stat = await fsp.stat(childPath);
            artifacts.push({
              kind: "tauri_bundle",
              target: entry.name,
              channel,
              path: childPath,
              size_bytes: stat.size,
              file_count: 1,
              sourcemap_count: 0,
              sourcemap_bytes: 0,
              entries: [{ path: child.name, size_bytes: stat.size }],
              largest_entries: [{ path: child.name, size_bytes: stat.size }],
            });
          }
        }
      } else {
        const stat = await fsp.stat(fullPath);
        artifacts.push({
          kind: "tauri_bundle",
          target: entry.name,
          channel,
          path: fullPath,
          size_bytes: stat.size,
          file_count: 1,
          sourcemap_count: 0,
          sourcemap_bytes: 0,
          entries: [{ path: entry.name, size_bytes: stat.size }],
          largest_entries: [{ path: entry.name, size_bytes: stat.size }],
        });
      }
    }
  }

  return artifacts;
}

async function collectStaticAssets(staticDir, channel) {
  if (!staticDir || !fs.existsSync(staticDir)) {
    return [];
  }

  const summary = await summarizeDirectory(staticDir, staticDir);
  return [
    {
      kind: "static_release_assets",
      channel,
      path: staticDir,
      size_bytes: summary.total_size_bytes,
      file_count: summary.file_count,
      sourcemap_count: summary.sourcemap_count,
      sourcemap_bytes: summary.sourcemap_bytes,
      entries: summary.entries,
      largest_entries: summary.largest_entries,
    },
  ];
}

const args = parseArgs(process.argv.slice(2));
const outPath = path.resolve(args.out || "dist/release/manifest.json");
const channel = args.channel || "latest";
const tauriBundleDirs = parsePathListArg(args["tauri-bundle-dir"]).map((dir) => path.resolve(dir));

const artifacts = [
  ...(await collectCliBinaryArtifacts(
    args["cli-artifacts"] ? path.resolve(args["cli-artifacts"]) : null,
    channel,
  )),
  ...(await collectNpmTarballs(args["npm-dir"] ? path.resolve(args["npm-dir"]) : null, channel)),
  ...(await collectTauriBundles(tauriBundleDirs, channel)),
  ...(await collectStaticAssets(
    args["static-dir"] ? path.resolve(args["static-dir"]) : null,
    channel,
  )),
];

await fsp.mkdir(path.dirname(outPath), { recursive: true });
await fsp.writeFile(
  outPath,
  `${JSON.stringify({ manifest_path: outPath, generated_at: new Date().toISOString(), artifacts }, null, 2)}\n`,
  "utf8",
);
console.log(`Wrote release manifest to ${outPath}`);
