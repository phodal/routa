function extractErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const message = typeof record.message === "string" && record.message.trim()
    ? record.message.trim()
    : null;
  const detail = extractErrorDetail(record.data);
  if (message && detail && detail !== message) {
    return `${message}: ${detail}`;
  }
  if (message) {
    return message;
  }

  const nestedError = record.error;
  if (nestedError && typeof nestedError === "object") {
    const nestedRecord = nestedError as Record<string, unknown>;
    if (typeof nestedRecord.message === "string" && nestedRecord.message.trim()) {
      return nestedRecord.message;
    }
  }

  return null;
}

function extractErrorDetail(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const parts = [
    typeof record.source === "string" && record.source.trim() ? record.source.trim() : null,
    typeof record.code === "number" ? String(record.code) : null,
    typeof record.data === "string" && record.data.trim() ? record.data.trim() : null,
    typeof record.errorMessage === "string" && record.errorMessage.trim()
      ? record.errorMessage.trim()
      : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(": ") : null;
}

function extractSsePromptError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const params = record.params && typeof record.params === "object"
    ? record.params as Record<string, unknown>
    : undefined;
  const update = params?.update && typeof params.update === "object"
    ? params.update as Record<string, unknown>
    : undefined;

  if (params?.type === "error") {
    return extractErrorMessage(params);
  }

  if (update?.sessionUpdate === "error") {
    return extractErrorMessage(update);
  }

  return null;
}

async function consumeSsePromptStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamError: string | null = null;

  const processBuffer = () => {
    while (true) {
      const boundaryIndex = buffer.indexOf("\n\n");
      if (boundaryIndex === -1) return;

      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);

      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();

      if (!data || data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        const errorMessage = extractSsePromptError(parsed);
        if (errorMessage && !streamError) {
          streamError = errorMessage;
        }
      } catch {
        // Ignore non-JSON SSE chunks; only explicit error envelopes matter here.
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      processBuffer();
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  if (streamError) {
    throw new Error(streamError);
  }
}

export async function consumeAcpPromptResponse(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(`session/prompt HTTP ${response.status}`);
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("text/event-stream")) {
    if (response.body) {
      await consumeSsePromptStream(response.body);
    }
    return;
  }

  const text = await response.text();
  if (!text.trim()) {
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === "object") {
      const message = extractErrorMessage(error) ?? "Prompt failed";
      throw new Error(message);
    }
  }
}

export function extractAcpPromptErrorForTest(payload: unknown): string | null {
  return extractSsePromptError(payload);
}
