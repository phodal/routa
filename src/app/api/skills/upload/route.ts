/**
 * Skill Upload API Route - /api/skills/upload
 *
 * Accepts a .zip file upload and extracts it to .agents/skills/
 * The zip should contain a directory with SKILL.md inside.
 *
 * POST /api/skills/upload - Upload and extract a skill zip
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const SKILLS_DIR = ".agents/skills";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!file.name.endsWith(".zip")) {
      return NextResponse.json(
        { error: "Only .zip files are supported" },
        { status: 400 }
      );
    }

    // Ensure skills directory exists
    const skillsDir = path.join(process.cwd(), SKILLS_DIR);
    fs.mkdirSync(skillsDir, { recursive: true });

    // Write the zip file to a temporary location
    const zipBuffer = Buffer.from(await file.arrayBuffer());
    const tempZipPath = path.join(skillsDir, `_upload_${Date.now()}.zip`);
    fs.writeFileSync(tempZipPath, zipBuffer);

    try {
      // Extract the zip file using the unzip command
      execSync(`unzip -o "${tempZipPath}" -d "${skillsDir}"`, {
        stdio: "pipe",
      });

      return NextResponse.json({
        success: true,
        message: `Extracted ${file.name} to ${SKILLS_DIR}/`,
      });
    } finally {
      // Clean up temp zip
      try {
        fs.unlinkSync(tempZipPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (err) {
    console.error("[skills/upload] Failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to upload skill package",
      },
      { status: 500 }
    );
  }
}
