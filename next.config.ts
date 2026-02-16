import type { NextConfig } from "next";

const isStaticBuild = process.env.ROUTA_BUILD_STATIC === "1";
const isDesktopServerBuild = process.env.ROUTA_DESKTOP_SERVER_BUILD === "1";
const isDesktopStandaloneBuild = process.env.ROUTA_DESKTOP_STANDALONE === "1";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: isDesktopServerBuild ? "tsconfig.desktop.json" : "tsconfig.json",
  },
  serverExternalPackages: [
    "@modelcontextprotocol/sdk",
    "@agentclientprotocol/sdk",
    "ws",
    "bufferutil",
    "utf-8-validate",
    "better-sqlite3",
  ],
  ...(isDesktopServerBuild ? { distDir: ".next-desktop" } : {}),
  ...(isDesktopStandaloneBuild ? { output: "standalone" } : {}),
  ...(isStaticBuild
    ? {
        output: "export",
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
