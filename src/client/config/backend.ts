const BACKEND_KEY = "routa.backendBaseUrl";
const API_PREFIX = "/api";

function normalizeBaseUrl(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "";

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function readFromQuery(): string {
  if (typeof window === "undefined") return "";
  try {
    const backend = new URLSearchParams(window.location.search).get("backend");
    return normalizeBaseUrl(backend);
  } catch {
    return "";
  }
}

function readFromStorage(): string {
  if (typeof window === "undefined") return "";
  try {
    return normalizeBaseUrl(localStorage.getItem(BACKEND_KEY));
  } catch {
    return "";
  }
}

function readFromEnv(): string {
  return normalizeBaseUrl(process.env.NEXT_PUBLIC_ROUTA_BACKEND_BASE_URL);
}

export function getConfiguredBackendBaseUrl(): string {
  const queryValue = readFromQuery();
  if (queryValue) {
    setConfiguredBackendBaseUrl(queryValue);
    return queryValue;
  }
  return readFromStorage() || readFromEnv();
}

export function hasConfiguredBackendBaseUrl(): boolean {
  return !!getConfiguredBackendBaseUrl();
}

export function setConfiguredBackendBaseUrl(baseUrl: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) {
      localStorage.removeItem(BACKEND_KEY);
      return;
    }
    localStorage.setItem(BACKEND_KEY, normalized);
  } catch {
    // Ignore storage errors.
  }
}

export function resolveApiPath(path: string, explicitBaseUrl?: string): string {
  const value = path.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  const normalizedPath = value.startsWith("/") ? value : `/${value}`;
  const apiPath = normalizedPath.startsWith(`${API_PREFIX}/`) || normalizedPath === API_PREFIX
    ? normalizedPath
    : `${API_PREFIX}${normalizedPath}`;
  const baseUrl = normalizeBaseUrl(explicitBaseUrl) || getConfiguredBackendBaseUrl();
  if (!baseUrl) return apiPath;
  return `${baseUrl}${apiPath}`;
}
