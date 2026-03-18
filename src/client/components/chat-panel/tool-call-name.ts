function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function looksLikeOpaqueCallId(value: string | undefined): boolean {
  if (!value) return false;
  return /^call[_-][A-Za-z0-9_-]{6,}$/.test(value)
    || /^[0-9a-f]{8,}$/i.test(value);
}

function summarizeCommand(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized) return undefined;
    return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
  }

  if (Array.isArray(value)) {
    const joined = value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .join(" ");
    return summarizeCommand(joined);
  }

  return undefined;
}

function extractCommandLabel(update: Record<string, unknown>): string | undefined {
  const directCommand = summarizeCommand(update.command);
  if (directCommand) return directCommand;

  const rawInput = update.rawInput;
  if (typeof rawInput === "object" && rawInput !== null) {
    const nestedCommand = summarizeCommand((rawInput as Record<string, unknown>).command);
    if (nestedCommand) return nestedCommand;
  }

  const parsedCmd = update.parsed_cmd;
  if (Array.isArray(parsedCmd)) {
    for (const entry of parsedCmd) {
      if (typeof entry === "object" && entry !== null) {
        const nested = summarizeCommand((entry as Record<string, unknown>).cmd);
        if (nested) return nested;
      }
    }
  }

  return undefined;
}

export function getToolEventName(update: Record<string, unknown>): string | undefined {
  const primaryName = asNonEmptyString(update.tool)
    ?? asNonEmptyString(update.toolName)
    ?? asNonEmptyString(update.title);

  if (primaryName && !looksLikeOpaqueCallId(primaryName)) {
    return primaryName;
  }

  return extractCommandLabel(update)
    ?? asNonEmptyString(update.kind)
    ?? primaryName;
}

export function getToolEventLabel(update: Record<string, unknown>): string {
  return getToolEventName(update) ?? "tool";
}
