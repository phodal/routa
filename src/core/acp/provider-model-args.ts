export function buildProviderModelArgs(provider: string, model: string | undefined): string[] | undefined {
  const trimmedModel = model?.trim();
  if (!trimmedModel) {
    return undefined;
  }

  if (provider === "codex" || provider === "codex-acp") {
    return ["-c", `model=${JSON.stringify(trimmedModel)}`];
  }

  return ["-m", trimmedModel];
}
