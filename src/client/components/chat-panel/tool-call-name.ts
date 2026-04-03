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

export function normalizeToolKind(kind?: string): string | undefined {
  if (!kind) return undefined;
  const normalized = kind.toLowerCase();

  if (
    normalized === "shell"
    || normalized === "bash"
    || normalized.includes("run_command")
    || normalized.includes("execute_command")
    || normalized.includes("run_terminal")
  ) {
    return "shell";
  }

  if (
    normalized === "read-file"
    || normalized === "read_file"
    || normalized === "ls"
    || normalized === "list_directory"
  ) {
    return "read-file";
  }

  if (
    normalized === "write-file"
    || normalized === "write_file"
    || normalized === "create_file"
  ) {
    return "write-file";
  }

  if (
    normalized === "edit-file"
    || normalized === "edit_file"
    || normalized === "patch_file"
    || normalized === "str_replace"
  ) {
    return "edit-file";
  }

  if (
    normalized === "glob"
    || normalized === "find_files"
    || normalized === "search_files"
    || normalized === "list_files"
  ) {
    return "glob";
  }

  if (
    normalized === "grep"
    || normalized === "search_code"
    || normalized === "search_text"
    || normalized === "ripgrep"
  ) {
    return "grep";
  }

  if (
    normalized === "web-search"
    || normalized === "web_search"
    || normalized === "search_web"
  ) {
    return "web-search";
  }

  if (
    normalized === "web-fetch"
    || normalized === "web_fetch"
    || normalized === "fetch_url"
    || normalized === "http_get"
  ) {
    return "web-fetch";
  }

  if (
    normalized === "task"
    || normalized.includes("delegate_task")
    || normalized.includes("spawn_agent")
  ) {
    return "task";
  }

  return kind;
}
