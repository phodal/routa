export function sanitizeNodeOptions(raw: string | undefined): string | undefined {
  if (!raw) {
    return raw;
  }

  const sanitized = raw
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token !== "--localstorage-file" && !token.startsWith("--localstorage-file="))
    .join(" ");

  return sanitized || undefined;
}

export function sanitizedNodeEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    NODE_OPTIONS: sanitizeNodeOptions(baseEnv.NODE_OPTIONS),
  };
}

export function quietNodeEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...sanitizedNodeEnv(baseEnv),
    NODE_NO_WARNINGS: "1",
  };
}
