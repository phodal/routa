/**
 * Clone Progress API Route - /api/clone/progress
 *
 * POST /api/clone/progress - Clone a GitHub repo with SSE progress streaming
 *   Body: { url: string }
 *   Returns: SSE stream with progress events, then final result
 *
 * Event format:
 *   data: { "phase": "counting", "percent": 45, "message": "Counting objects: 45% (9/20)" }
 *   data: { "phase": "done", "success": true, "path": "...", "name": "...", "branch": "...", "branches": [...] }
 *   data: { "phase": "error", "error": "..." }
 */

import { NextRequest } from "next/server";
import { spawn } from "child_process";
import * as fs from "fs";
import {
  parseGitHubUrl,
  getCloneBaseDir,
  repoToDirName,
  getBranchInfo,
} from "@/core/git";
import { getGitErrorMessage, isGitAuthError, getGitAuthErrorMessage } from "@/core/git";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { url } = body as { url?: string };

  if (!url || typeof url !== "string") {
    return new Response(
      JSON.stringify({ error: "Missing 'url' field" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    return new Response(
      JSON.stringify({ error: "Invalid GitHub URL" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { owner, repo } = parsed;
  const repoName = repoToDirName(owner, repo);
  const baseDir = getCloneBaseDir();
  fs.mkdirSync(baseDir, { recursive: true });
  const targetDir = `${baseDir}/${repoName}`;

  // If already exists, just return success
  if (fs.existsSync(targetDir)) {
    const branchInfo = getBranchInfo(targetDir);
    const result = JSON.stringify({
      phase: "done",
      success: true,
      path: targetDir,
      name: `${owner}/${repo}`,
      branch: branchInfo.current,
      branches: branchInfo.branches,
      existed: true,
    });
    return new Response(
      `data: ${result}\n\n`,
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }
    );
  }

  // Stream clone progress via SSE
  const encoder = new TextEncoder();
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // stream closed
        }
      };

      sendEvent({ phase: "starting", percent: 0, message: "Starting clone..." });

      const child = spawn("git", ["clone", "--progress", cloneUrl, targetDir], {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 180000, // 3 minutes
      });

      let stderrBuf = "";

      // git clone writes progress to stderr
      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        stderrBuf += text;

        // Parse progress output
        const progressMatch = text.match(
          /(Counting objects|Compressing objects|Receiving objects|Resolving deltas):\s+(\d+)%/
        );
        if (progressMatch) {
          const phaseMap: Record<string, string> = {
            "Counting objects": "counting",
            "Compressing objects": "compressing",
            "Receiving objects": "receiving",
            "Resolving deltas": "resolving",
          };
          sendEvent({
            phase: phaseMap[progressMatch[1]] || "progress",
            percent: parseInt(progressMatch[2], 10),
            message: text.trim().split("\r").pop()?.trim() || text.trim(),
          });
        }
      });

      child.on("error", (err) => {
        const errorMsg = isGitAuthError(err.message)
          ? getGitAuthErrorMessage(err.message, "clone")
          : getGitErrorMessage(err.message);
        sendEvent({ phase: "error", error: errorMsg });
        controller.close();
      });

      child.on("close", (code) => {
        if (code === 0) {
          // Fetch all branches after clone
          try {
            const { execSync } = require("child_process");
            execSync("git fetch --all", {
              cwd: targetDir,
              stdio: "pipe",
              timeout: 60000,
            });
          } catch {
            // ok
          }

          const branchInfo = getBranchInfo(targetDir);
          sendEvent({
            phase: "done",
            success: true,
            path: targetDir,
            name: `${owner}/${repo}`,
            branch: branchInfo.current,
            branches: branchInfo.branches,
            existed: false,
          });
        } else {
          const errorMsg = isGitAuthError(stderrBuf)
            ? getGitAuthErrorMessage(stderrBuf, "clone")
            : getGitErrorMessage(stderrBuf || `Clone exited with code ${code}`);
          sendEvent({ phase: "error", error: errorMsg });
        }
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
