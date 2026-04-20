import type { NextConfig } from "next";

const isStaticBuild = process.env.ROUTA_BUILD_STATIC === "1";
const isDesktopServerBuild = process.env.ROUTA_DESKTOP_SERVER_BUILD === "1";
const isDesktopStandaloneBuild = process.env.ROUTA_DESKTOP_STANDALONE === "1";
const isPageSnapshotServerBuild = process.env.ROUTA_PAGE_SNAPSHOT_SERVER === "1";

// When set, proxy API requests to the Rust backend server (desktop mode without Node.js backend)
const rustBackendUrl = process.env.ROUTA_RUST_BACKEND_URL;

// Allow additional dev origins via ROUTA_ALLOWED_DEV_ORIGINS environment variable
// Format: comma-separated list of IP addresses or hostnames (e.g., "192.168.1.210,10.0.0.5")
const additionalDevOrigins = process.env.ROUTA_ALLOWED_DEV_ORIGINS
  ? process.env.ROUTA_ALLOWED_DEV_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : [];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", ...additionalDevOrigins],
  typescript: {
    tsconfigPath: isDesktopServerBuild ? "tsconfig.desktop.json" : "tsconfig.json",
  },
  serverExternalPackages: [
    "@modelcontextprotocol/sdk",
    "@agentclientprotocol/sdk",
    "@anthropic-ai/claude-agent-sdk",
    "ws",
    "bufferutil",
    "utf-8-validate",
    "better-sqlite3",
    "yjs",
    "lib0",
  ],
  experimental: {
    // Optimize Webpack memory usage by changing behavior to reduce max memory
    // at the cost of slightly increased compilation times
    // See: https://nextjs.org/docs/app/guides/memory-usage
    webpackMemoryOptimizations: true,
    // Disable preloading page modules on server start to reduce initial memory footprint
    // Modules are loaded on-demand instead, trading faster response times for lower memory usage
    preloadEntriesOnStart: false,
  },
  // Ensure cli.js (Claude Code agent binary) is included in Vercel's deployment
  // bundle. It's not statically imported so file-tracing won't pick it up
  // automatically; this forces Vercel to copy the whole SDK package.
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/@anthropic-ai/claude-agent-sdk/**/*",
      "./resources/specialists/**/*",
      // Include skill definitions so Claude Code SDK can discover them on Vercel
      "./.claude/skills/**/*",
      "./.agents/skills/**/*",
    ],
  },
  ...((isDesktopServerBuild || isPageSnapshotServerBuild)
    ? { distDir: isDesktopServerBuild ? ".next-desktop" : ".next-page-snapshots" }
    : {}),
  ...(isDesktopStandaloneBuild
    ? {
        output: "standalone",
        outputFileTracingIncludes: {
          "/api/**": [
            "./node_modules/@anthropic-ai/claude-agent-sdk/**/*",
            "./resources/specialists/**/*",
          ],
          "/*": ["./node_modules/better-sqlite3/**/*"],
        },
      }
    : {}),
  ...(isStaticBuild
    ? {
        output: "export",
        images: { unoptimized: true },
      }
    : {}),
  // Proxy /api/* to Rust backend when ROUTA_RUST_BACKEND_URL is set.
  // Uses beforeFiles to override local Next.js API routes.
  ...(rustBackendUrl
    ? {
        async rewrites() {
          return {
            beforeFiles: [
              {
                source: "/api/:path*",
                destination: `${rustBackendUrl}/api/:path*`,
              },
            ],
            afterFiles: [],
            fallback: [],
          };
        },
      }
    : {}),
};

export default nextConfig;
