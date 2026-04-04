/**
 * ACP Agent Installer
 *
 * Handles installation of ACP agents via:
 * 1. CLI-based installation (npm, npx, binary downloads)
 * 2. ACP Registry-based installation
 *
 * Supports distribution types: npx, uvx, binary
 */

import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  type RegistryAgent,
  fetchRegistry,
  getRegistryAgent,
  detectPlatformTarget,
} from "./acp-registry";
import { needsShell, which } from "./utils";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DistributionType = "npx" | "uvx" | "binary";

export interface InstallResult {
  success: boolean;
  agentId: string;
  distributionType: DistributionType;
  installedPath?: string;
  error?: string;
}

export interface InstalledAgent {
  agentId: string;
  name: string;
  version: string;
  distributionType: DistributionType;
  command: string;
  args: string[];
  env?: Record<string, string>;
  installedAt: Date;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default directory for installed binary agents */
const DEFAULT_INSTALL_DIR = path.join(os.homedir(), ".routa", "acp-agents");

export interface AgentStatus {
  available: boolean;
  installed: boolean;
  uninstallable: boolean;
  resolvedDistributionType: DistributionType | null;
}

// ─── CLI-Based Installation ─────────────────────────────────────────────────

/**
 * Check if npm/npx is available.
 */
export async function isNpxAvailable(): Promise<boolean> {
  const npxPath = await which("npx");
  return npxPath !== null;
}

/**
 * Check if uv/uvx is available.
 */
export async function isUvxAvailable(): Promise<boolean> {
  const uvPath = await which("uv");
  return uvPath !== null;
}

/**
 * Install an npm package globally.
 */
export async function installNpmPackage(packageName: string): Promise<InstallResult> {
  return new Promise((resolve) => {
    console.log(`[AcpInstaller] Installing npm package: ${packageName}`);

    execFile("npm", ["install", "-g", packageName], (error, stdout, stderr) => {
      if (error) {
        console.error(`[AcpInstaller] npm install failed:`, stderr);
        resolve({
          success: false,
          agentId: packageName,
          distributionType: "npx",
          error: error.message,
        });
      } else {
        console.log(`[AcpInstaller] npm install succeeded:`, stdout);
        resolve({
          success: true,
          agentId: packageName,
          distributionType: "npx",
        });
      }
    });
  });
}

/**
 * Download and extract a binary archive.
 */
export async function downloadBinary(
  url: string,
  agentId: string,
  installDir = DEFAULT_INSTALL_DIR
): Promise<InstallResult> {
  const agentDir = path.join(installDir, agentId);

  try {
    // Create install directory
    await fs.promises.mkdir(agentDir, { recursive: true });

    console.log(`[AcpInstaller] Downloading binary from: ${url}`);

    // Download the archive
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine archive type and extract
    const archivePath = path.join(agentDir, getArchiveFilename(url));
    await fs.promises.writeFile(archivePath, buffer);

    console.log(`[AcpInstaller] Extracting archive: ${archivePath}`);
    await extractArchive(archivePath, agentDir);

    // Clean up archive
    await fs.promises.unlink(archivePath);

    return {
      success: true,
      agentId,
      distributionType: "binary",
      installedPath: agentDir,
    };
  } catch (error) {
    console.error(`[AcpInstaller] Binary download failed:`, error);
    return {
      success: false,
      agentId,
      distributionType: "binary",
      error: (error as Error).message,
    };
  }
}

function getArchiveFilename(url: string): string {
  const urlPath = new URL(url).pathname;
  return path.basename(urlPath);
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  const ext = archivePath.toLowerCase();

  if (ext.endsWith(".tar.gz") || ext.endsWith(".tgz")) {
    await extractTarGz(archivePath, destDir);
  } else if (ext.endsWith(".tar.bz2") || ext.endsWith(".tbz2")) {
    await extractTarBz2(archivePath, destDir);
  } else if (ext.endsWith(".zip")) {
    await extractZip(archivePath, destDir);
  } else {
    // Assume it's a raw binary - make it executable
    const binaryPath = path.join(destDir, path.basename(archivePath));
    await fs.promises.chmod(binaryPath, 0o755);
  }
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tar", ["-xzf", archivePath, "-C", destDir]);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar extraction failed with code ${code}`));
    });
    proc.on("error", reject);
  });
}

async function extractTarBz2(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tar", ["-xjf", archivePath, "-C", destDir]);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar extraction failed with code ${code}`));
    });
    proc.on("error", reject);
  });
}

async function extractZip(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "powershell" : "unzip";
    const args = isWindows
      ? ["-Command", `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}'`]
      : ["-o", archivePath, "-d", destDir];

    const proc = spawn(cmd, args);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`zip extraction failed with code ${code}`));
    });
    proc.on("error", reject);
  });
}

// ─── Registry-Based Installation ────────────────────────────────────────────

/**
 * Install an agent from the ACP Registry.
 * Automatically selects the best distribution type based on availability.
 */
export async function installFromRegistry(
  agentId: string,
  preferredType?: DistributionType
): Promise<InstallResult> {
  const agent = await getRegistryAgent(agentId);
  if (!agent) {
    return {
      success: false,
      agentId,
      distributionType: preferredType || "npx",
      error: `Agent "${agentId}" not found in registry`,
    };
  }

  // Determine distribution type
  const distType = await selectDistributionType(agent, preferredType);
  if (!distType) {
    return {
      success: false,
      agentId,
      distributionType: preferredType || "npx",
      error: `No suitable distribution found for agent "${agentId}"`,
    };
  }

  console.log(`[AcpInstaller] Installing ${agentId} via ${distType}`);

  switch (distType) {
    case "npx":
      return installNpxAgent(agent);
    case "uvx":
      return installUvxAgent(agent);
    case "binary":
      return installBinaryAgent(agent);
    default:
      return {
        success: false,
        agentId,
        distributionType: distType,
        error: `Unknown distribution type: ${distType}`,
      };
  }
}

async function selectDistributionType(
  agent: RegistryAgent,
  preferred?: DistributionType
): Promise<DistributionType | null> {
  const dist = agent.distribution;

  // If preferred type is specified and available, use it
  if (preferred && dist[preferred]) {
    if (preferred === "npx" && (await isNpxAvailable())) return "npx";
    if (preferred === "uvx" && (await isUvxAvailable())) return "uvx";
    if (preferred === "binary") {
      const platform = detectPlatformTarget();
      if (platform && dist.binary?.[platform]) return "binary";
    }
  }

  // Auto-select: prefer npx > uvx > binary
  if (dist.npx && (await isNpxAvailable())) return "npx";
  if (dist.uvx && (await isUvxAvailable())) return "uvx";
  if (dist.binary) {
    const platform = detectPlatformTarget();
    if (platform && dist.binary[platform]) return "binary";
  }

  return null;
}

interface PreloadCommandOptions {
  agentId: string;
  binaryName: "npx" | "uvx";
  args: string[];
  distributionType: "npx" | "uvx";
  packageName: string;
  successSignal: string;
}

async function runPreloadCommand(options: PreloadCommandOptions): Promise<InstallResult> {
  const { agentId, binaryName, args, distributionType, packageName, successSignal } = options;
  const resolvedCommand = await which(binaryName);
  const command = resolvedCommand ?? binaryName;

  console.log(`[AcpInstaller] Running: ${binaryName} ${args.join(" ")}`);

  return new Promise((resolve) => {
    try {
      const proc = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120000,
        shell: needsShell(command),
      });

      let stderr = "";
      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0 || stderr.includes(successSignal)) {
          console.log(
            `[AcpInstaller] Agent ${agentId} pre-downloaded via ${distributionType}: ${packageName}`
          );
          resolve({
            success: true,
            agentId,
            distributionType,
          });
          return;
        }

        console.warn(
          `[AcpInstaller] ${distributionType} pre-download may have issues (code=${code}): ${stderr}`
        );
        resolve({
          success: true,
          agentId,
          distributionType,
        });
      });

      proc.on("error", (err) => {
        console.error(`[AcpInstaller] ${distributionType} pre-download failed:`, err);
        resolve({
          success: false,
          agentId,
          distributionType,
          error: `Failed to pre-download package: ${err.message}`,
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[AcpInstaller] ${distributionType} pre-download setup failed:`, err);
      resolve({
        success: false,
        agentId,
        distributionType,
        error: `Failed to pre-download package: ${message}`,
      });
    }
  });
}

async function installNpxAgent(agent: RegistryAgent): Promise<InstallResult> {
  const npxDist = agent.distribution.npx!;
  console.log(`[AcpInstaller] Pre-downloading npx package: ${npxDist.package}`);

  // Pre-download the package by running npx with --yes flag
  // This ensures the package is cached for faster startup later
  return runPreloadCommand({
    agentId: agent.id,
    binaryName: "npx",
    args: ["-y", npxDist.package, "--help"],
    distributionType: "npx",
    packageName: npxDist.package,
    successSignal: "npm warn exec",
  });
}

async function installUvxAgent(agent: RegistryAgent): Promise<InstallResult> {
  const uvxDist = agent.distribution.uvx!;
  console.log(`[AcpInstaller] Pre-downloading uvx package: ${uvxDist.package}`);

  // Pre-download the package by running uvx with --help flag
  return runPreloadCommand({
    agentId: agent.id,
    binaryName: "uvx",
    args: [uvxDist.package, "--help"],
    distributionType: "uvx",
    packageName: uvxDist.package,
    successSignal: "Resolved",
  });
}

async function installBinaryAgent(agent: RegistryAgent): Promise<InstallResult> {
  const platform = detectPlatformTarget();
  if (!platform) {
    return {
      success: false,
      agentId: agent.id,
      distributionType: "binary",
      error: "Unsupported platform",
    };
  }

  const binaryConfig = agent.distribution.binary![platform];
  if (!binaryConfig) {
    return {
      success: false,
      agentId: agent.id,
      distributionType: "binary",
      error: `No binary available for platform: ${platform}`,
    };
  }

  return downloadBinary(binaryConfig.archive, agent.id);
}

// ─── Agent Resolution ───────────────────────────────────────────────────────

/**
 * Build command and args for running an agent from the registry.
 */
export async function buildAgentCommand(agentId: string): Promise<{
  command: string;
  args: string[];
  env?: Record<string, string>;
} | null> {
  const agent = await getRegistryAgent(agentId);
  if (!agent) return null;

  const dist = agent.distribution;

  // Try npx first
  if (dist.npx && (await isNpxAvailable())) {
    return {
      command: "npx",
      args: [dist.npx.package, ...(dist.npx.args || [])],
      env: dist.npx.env,
    };
  }

  // Try uvx
  if (dist.uvx && (await isUvxAvailable())) {
    return {
      command: "uvx",
      args: [dist.uvx.package, ...(dist.uvx.args || [])],
      env: dist.uvx.env,
    };
  }

  // Try binary
  if (dist.binary) {
    const platform = detectPlatformTarget();
    if (platform && dist.binary[platform]) {
      const config = dist.binary[platform]!;
      const binaryDir = path.join(DEFAULT_INSTALL_DIR, agentId);
      const binaryPath = path.join(binaryDir, config.cmd.replace(/^\.\//, ""));

      // Check if installed
      try {
        await fs.promises.access(binaryPath, fs.constants.X_OK);
        return {
          command: binaryPath,
          args: config.args || [],
          env: config.env,
        };
      } catch {
        // Binary not installed
        return null;
      }
    }
  }

  return null;
}

export async function isBinaryAgentInstalled(agentId: string): Promise<boolean> {
  const agent = await getRegistryAgent(agentId);
  if (!agent?.distribution.binary) return false;

  const platform = detectPlatformTarget();
  if (!platform || !agent.distribution.binary[platform]) return false;

  const config = agent.distribution.binary[platform]!;
  const binaryDir = path.join(DEFAULT_INSTALL_DIR, agentId);
  const binaryPath = path.join(binaryDir, config.cmd.replace(/^\.\//, ""));

  try {
    await fs.promises.access(binaryPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function getAgentStatus(agentId: string): Promise<AgentStatus> {
  const agent = await getRegistryAgent(agentId);
  if (!agent) {
    return {
      available: false,
      installed: false,
      uninstallable: false,
      resolvedDistributionType: null,
    };
  }

  const binaryInstalled = await isBinaryAgentInstalled(agentId);
  if (binaryInstalled) {
    return {
      available: true,
      installed: true,
      uninstallable: true,
      resolvedDistributionType: "binary",
    };
  }

  if (agent.distribution.npx && (await isNpxAvailable())) {
    return {
      available: true,
      installed: false,
      uninstallable: false,
      resolvedDistributionType: "npx",
    };
  }

  if (agent.distribution.uvx && (await isUvxAvailable())) {
    return {
      available: true,
      installed: false,
      uninstallable: false,
      resolvedDistributionType: "uvx",
    };
  }

  return {
    available: false,
    installed: false,
    uninstallable: false,
    resolvedDistributionType: null,
  };
}

/**
 * List all agents from the registry with their installation status.
 */
export async function listAgentsWithStatus(): Promise<
  Array<{
    agent: RegistryAgent;
    available: boolean;
    installed: boolean;
    uninstallable: boolean;
    distributionTypes: DistributionType[];
  }>
> {
  const registry = await fetchRegistry();
  const results = [];

  for (const agent of registry.agents) {
    const status = await getAgentStatus(agent.id);
    const distTypes: DistributionType[] = [];

    if (agent.distribution.npx) distTypes.push("npx");
    if (agent.distribution.uvx) distTypes.push("uvx");
    if (agent.distribution.binary) distTypes.push("binary");

    results.push({
      agent,
      available: status.available,
      installed: status.installed,
      uninstallable: status.uninstallable,
      distributionTypes: distTypes,
    });
  }

  return results;
}

/**
 * Check if an agent is installed/available.
 */
export async function isAgentAvailable(agentId: string): Promise<boolean> {
  const cmd = await buildAgentCommand(agentId);
  return cmd !== null;
}

/**
 * Uninstall a binary agent.
 */
export async function uninstallBinaryAgent(
  agentId: string,
  installDir = DEFAULT_INSTALL_DIR
): Promise<boolean> {
  const agentDir = path.join(installDir, agentId);

  try {
    await fs.promises.rm(agentDir, { recursive: true, force: true });
    console.log(`[AcpInstaller] Uninstalled binary agent: ${agentId}`);
    return true;
  } catch (error) {
    console.error(`[AcpInstaller] Failed to uninstall agent:`, error);
    return false;
  }
}
