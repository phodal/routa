import { queryTracesWithSessionFallback } from "@/core/trace";
import { loadSessionHistory } from "@/core/session-history";
import {
  buildPreferredTranscriptPayload,
  type SessionTranscriptPayload,
} from "@/core/session-transcript";

import {
  extractRepoSlideSessionResult,
  type RepoSlideSessionResult,
} from "./extract-reposlide-result";

export async function loadRepoSlideSessionResult(sessionId: string): Promise<{
  transcript: SessionTranscriptPayload;
  result: RepoSlideSessionResult;
}> {
  const [history, traces] = await Promise.all([
    loadSessionHistory(sessionId, { consolidated: true }),
    queryTracesWithSessionFallback({ sessionId }),
  ]);

  const transcript = buildPreferredTranscriptPayload({ sessionId, history, traces });
  return {
    transcript,
    result: extractRepoSlideSessionResult(transcript.messages),
  };
}
