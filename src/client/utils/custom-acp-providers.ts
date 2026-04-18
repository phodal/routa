/**
 * Custom ACP Provider storage utilities.
 *
 * Allows users to define their own ACP-compliant agent CLIs with custom
 * command and args. Stored in localStorage so they persist across sessions.
 */

const STORAGE_KEY = "routa.customAcpProviders";

/** A user-defined ACP provider. */
export interface CustomAcpProvider {
  /** Unique identifier (auto-generated or user-defined). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** CLI command to execute (e.g. "my-agent"). */
  command: string;
  /** Command-line arguments for ACP mode (e.g. ["--acp"]). */
  args: string[];
  /** Optional description. */
  description?: string;
}

export const DEFAULT_VISIBLE_PROVIDER_IDS = ["codex", "claude", "opencode", "kimi"] as const;

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  const storage = window.localStorage;
  if (
    storage == null ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function" ||
    typeof storage.removeItem !== "function"
  ) {
    return null;
  }
  return storage;
}

/** Load all custom ACP providers from localStorage. */
export function loadCustomAcpProviders(): CustomAcpProvider[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Security: Validate parsed data is an array and has correct shape
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is CustomAcpProvider =>
      typeof p === "object" &&
      p !== null &&
      typeof p.id === "string" &&
      typeof p.name === "string" &&
      typeof p.command === "string" &&
      Array.isArray(p.args) &&
      p.args.every((arg: unknown) => typeof arg === "string")
    );
  } catch {
    return [];
  }
}

/** Save custom ACP providers to localStorage. */
export function saveCustomAcpProviders(providers: CustomAcpProvider[]): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(providers));
  } catch (err) {
    // Security: Gracefully handle localStorage errors (quota exceeded, disabled, privacy mode)
    console.warn("[custom-acp-providers] Failed to save providers to localStorage:", err);
  }
}

/** Get a custom ACP provider by ID. */
export function getCustomAcpProviderById(id: string): CustomAcpProvider | undefined {
  return loadCustomAcpProviders().find((p) => p.id === id);
}

// ─── Hidden Providers Management ─────────────────────────────────────────────

const HIDDEN_PROVIDERS_KEY = "routa.hiddenProviders";
const LEGACY_DISABLED_PROVIDERS_KEY = "routa.disabledProviders";
const PROVIDER_DISPLAY_PREFERENCES_KEY = "routa.providerDisplayPreferences";
export const PROVIDER_DISPLAY_PREFERENCES_CHANGED_EVENT = "routa:provider-display-preferences-changed";

export interface ProviderDisplayPreferences {
  visibleProviderIds: string[];
}

function parseStoredProviderIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** Load the list of hidden provider IDs from localStorage, with legacy fallback. */
export function loadHiddenProviders(): string[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  const hiddenProviderIds = parseStoredProviderIds(storage.getItem(HIDDEN_PROVIDERS_KEY));
  if (hiddenProviderIds.length > 0) {
    return hiddenProviderIds;
  }
  return parseStoredProviderIds(storage.getItem(LEGACY_DISABLED_PROVIDERS_KEY));
}

/** Save the list of hidden provider IDs to localStorage and keep the legacy key in sync. */
export function saveHiddenProviders(providerIds: string[]): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    const normalizedProviderIds = dedupeProviderIds(providerIds);
    const serializedProviderIds = JSON.stringify(normalizedProviderIds);
    storage.setItem(HIDDEN_PROVIDERS_KEY, serializedProviderIds);
    storage.setItem(LEGACY_DISABLED_PROVIDERS_KEY, serializedProviderIds);
  } catch (err) {
    console.warn("[custom-acp-providers] Failed to save hidden providers to localStorage:", err);
  }
}

/** Check if a provider is hidden. */
export function isProviderHidden(providerId: string): boolean {
  return loadHiddenProviders().includes(providerId);
}

/** Hide a provider by adding it to the hidden list. */
export function hideProvider(providerId: string): void {
  const hiddenProviderIds = loadHiddenProviders();
  if (!hiddenProviderIds.includes(providerId)) {
    saveHiddenProviders([...hiddenProviderIds, providerId]);
  }
}

/** Show a provider by removing it from the hidden list. */
export function showProvider(providerId: string): void {
  const hiddenProviderIds = loadHiddenProviders();
  saveHiddenProviders(hiddenProviderIds.filter((id) => id !== providerId));
}

/** Toggle a provider's hidden state. Returns true when the provider is now shown. */
export function toggleProviderHidden(providerId: string): boolean {
  const hiddenProviderIds = loadHiddenProviders();
  const isHidden = hiddenProviderIds.includes(providerId);
  if (isHidden) {
    saveHiddenProviders(hiddenProviderIds.filter((id) => id !== providerId));
  } else {
    saveHiddenProviders([...hiddenProviderIds, providerId]);
  }
  return isHidden;
}

/** @deprecated Use loadHiddenProviders instead. */
export function loadDisabledProviders(): string[] {
  return loadHiddenProviders();
}

/** @deprecated Use saveHiddenProviders instead. */
export function saveDisabledProviders(providerIds: string[]): void {
  saveHiddenProviders(providerIds);
}

/** @deprecated Use isProviderHidden instead. */
export function isProviderDisabled(providerId: string): boolean {
  return isProviderHidden(providerId);
}

/** @deprecated Use hideProvider instead. */
export function disableProvider(providerId: string): void {
  hideProvider(providerId);
}

/** @deprecated Use showProvider instead. */
export function enableProvider(providerId: string): void {
  showProvider(providerId);
}

/** @deprecated Use toggleProviderHidden instead. */
export function toggleProviderDisabled(providerId: string): boolean {
  return toggleProviderHidden(providerId);
}

/** Load provider display preferences from localStorage. */
export function loadProviderDisplayPreferences(): ProviderDisplayPreferences {
  const storage = getLocalStorage();
  if (!storage) {
    return { visibleProviderIds: [...DEFAULT_VISIBLE_PROVIDER_IDS] };
  }

  try {
    const raw = storage.getItem(PROVIDER_DISPLAY_PREFERENCES_KEY);
    if (!raw) {
      return { visibleProviderIds: [...DEFAULT_VISIBLE_PROVIDER_IDS] };
    }

    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as { visibleProviderIds?: unknown }).visibleProviderIds)
    ) {
      return { visibleProviderIds: [...DEFAULT_VISIBLE_PROVIDER_IDS] };
    }

    return {
      visibleProviderIds: (parsed as { visibleProviderIds: unknown[] }).visibleProviderIds.filter(
        (id): id is string => typeof id === "string"
      ),
    };
  } catch {
    return { visibleProviderIds: [...DEFAULT_VISIBLE_PROVIDER_IDS] };
  }
}

/** Save provider display preferences and notify listeners in the current window. */
export function saveProviderDisplayPreferences(preferences: ProviderDisplayPreferences): void {
  const storage = getLocalStorage();
  if (!storage || typeof window === "undefined") return;

  const normalizedPreferences = {
    visibleProviderIds: dedupeProviderIds(preferences.visibleProviderIds),
  };

  try {
    storage.setItem(PROVIDER_DISPLAY_PREFERENCES_KEY, JSON.stringify(normalizedPreferences));
    window.dispatchEvent(new CustomEvent(PROVIDER_DISPLAY_PREFERENCES_CHANGED_EVENT));
  } catch (err) {
    console.warn("[custom-acp-providers] Failed to save provider display preferences:", err);
  }
}

export function dedupeProviderIds(providerIds: string[]): string[] {
  return Array.from(new Set(providerIds));
}

export function getOrderedVisibleProviderIds(providerIds: string[]): string[] {
  const preferences = loadProviderDisplayPreferences();
  const providerSet = new Set(providerIds);
  const preferredVisibleIds = dedupeProviderIds(preferences.visibleProviderIds).filter((id) => providerSet.has(id));

  if (preferredVisibleIds.length > 0) {
    return preferredVisibleIds;
  }

  return DEFAULT_VISIBLE_PROVIDER_IDS.filter((id) => providerSet.has(id));
}

export function sortProviderIdsByPreference(providerIds: string[]): string[] {
  const preferredVisibleIds = getOrderedVisibleProviderIds(providerIds);
  const preferredOrder = new Map(preferredVisibleIds.map((id, index) => [id, index]));

  return [...providerIds].sort((left, right) => {
    const leftOrder = preferredOrder.get(left);
    const rightOrder = preferredOrder.get(right);

    if (leftOrder !== undefined && rightOrder !== undefined) {
      return leftOrder - rightOrder;
    }
    if (leftOrder !== undefined) return -1;
    if (rightOrder !== undefined) return 1;
    return 0;
  });
}
