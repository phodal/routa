import type { NextConfig } from "next";

const isStaticBuild = process.env.ROUTA_BUILD_STATIC === "1";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@modelcontextprotocol/sdk",
    "@agentclientprotocol/sdk",
    "ws",
    "bufferutil",
    "utf-8-validate",
    "better-sqlite3",
  ],
  ...(isStaticBuild
    ? {
        output: "export",
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
