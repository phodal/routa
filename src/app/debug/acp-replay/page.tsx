/**
 * Debug / Acp Replay - /debug/acp-replay
 * Debug surface for replaying ACP transcripts and inspecting session event sequences in isolation.
 */
import { Suspense } from "react";

import { AcpReplayDebugPageClient } from "./page-client";

export default function AcpReplayDebugPage() {
  return (
    <Suspense fallback={<main style={{ padding: 24, fontFamily: "monospace" }}>Loading ACP replay debug page...</main>}>
      <AcpReplayDebugPageClient />
    </Suspense>
  );
}
