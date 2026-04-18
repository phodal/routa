/**
 * POST /api/webhooks/gitlab
 *
 * This is the inbound endpoint that GitLab calls when events occur on
 * configured projects. It:
 * 1. Reads the raw body (needed for token verification)
 * 2. Delegates to handleGitLabWebhook() in the core handler
 * 3. Returns a quick 200 OK so GitLab doesn't retry
 *
 * Configure the webhook URL in your GitLab project as:
 *   https://<your-domain>/api/webhooks/gitlab
 */

import { NextRequest, NextResponse } from "next/server";
import { handleGitLabWebhook } from "@/core/webhooks/gitlab-webhook-handler";
import { getGitLabWebhookStore } from "@/core/webhooks/gitlab-webhook-store-factory";
import { getRoutaSystem } from "@/core/routa-system";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const eventType = request.headers.get("x-gitlab-event");
    const token = request.headers.get("x-gitlab-token") ?? undefined;

    if (!eventType) {
      return NextResponse.json({ error: "Missing X-GitLab-Event header" }, { status: 400 });
    }

    // Read raw body as text (needed for token verification)
    const rawBody = await request.text();

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    console.log(`[Webhook] Received GitLab event: ${eventType}`);

    const webhookStore = getGitLabWebhookStore();
    const system = getRoutaSystem();

    const result = await handleGitLabWebhook({
      eventType,
      token,
      rawBody,
      payload: payload as any,
      webhookStore,
      backgroundTaskStore: system.backgroundTaskStore,
      eventBus: system.eventBus,
    });

    console.log(
      `[Webhook] Event ${eventType} processed: ${result.processed} triggered, ${result.skipped} skipped`
    );

    return NextResponse.json({
      ok: true,
      processed: result.processed,
      skipped: result.skipped,
    });
  } catch (err) {
    console.error("[Webhook] Error handling GitLab event:", err);
    // Always return 200 to prevent GitLab from retrying on server errors
    return NextResponse.json({ ok: false, error: String(err) });
  }
}

/**
 * GET /api/webhooks/gitlab — health check / info endpoint.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "GitLab Webhook Receiver",
    info: "Configure this URL as a GitLab project webhook to receive events.",
  });
}
