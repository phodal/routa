export type AcpExecutionMode = "embedded" | "runner";

export interface AcpExecutionBinding {
  executionMode?: AcpExecutionMode;
  ownerInstanceId?: string;
  leaseExpiresAt?: string;
}

const DEFAULT_LEASE_SECONDS = 300;

export function getAcpRunnerUrl(): string | undefined {
  const raw = process.env.ROUTA_ACP_RUNNER_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

export function getAcpInstanceId(): string {
  return process.env.ROUTA_INSTANCE_ID?.trim() || `next-${process.pid}`;
}

export function getAcpLeaseDurationMs(): number {
  const raw = Number.parseInt(process.env.ROUTA_ACP_SESSION_LEASE_SECONDS ?? "", 10);
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LEASE_SECONDS;
  return seconds * 1000;
}

export function buildAcpLeaseExpiresAt(now: Date = new Date()): string {
  return new Date(now.getTime() + getAcpLeaseDurationMs()).toISOString();
}

export function isWorkspaceExecutionProvider(provider?: string): boolean {
  const normalized = provider?.toLowerCase();
  return normalized === "workspace" || normalized === "workspace-agent" || normalized === "routa-native";
}

export function isCliBackedProvider(provider?: string): boolean {
  const normalized = provider?.toLowerCase();
  if (!normalized) return true;
  return !(
    normalized === "claude-code-sdk"
    || normalized === "opencode-sdk"
    || normalized === "docker-opencode"
    || isWorkspaceExecutionProvider(normalized)
  );
}

export function shouldUseRunnerForProvider(provider?: string): boolean {
  return !!getAcpRunnerUrl() && isCliBackedProvider(provider);
}

export function buildExecutionBinding(mode?: AcpExecutionMode): AcpExecutionBinding {
  if (!mode) return {};
  return {
    executionMode: mode,
    ownerInstanceId: mode === "embedded" ? getAcpInstanceId() : "runner",
    leaseExpiresAt: buildAcpLeaseExpiresAt(),
  };
}

export function refreshExecutionBinding<T extends AcpExecutionBinding>(record: T): T {
  return {
    ...record,
    leaseExpiresAt: buildAcpLeaseExpiresAt(),
  };
}

export function requiresRunnerProxy(mode?: AcpExecutionMode): boolean {
  return mode === "runner";
}
