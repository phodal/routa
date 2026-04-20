"use client";

import { isTauriRuntime } from "./diagnostics";

type TauriInvoke = (command: string, payload?: Record<string, unknown>) => Promise<unknown>;

type TauriRuntimeWindow = Window & {
  __TAURI__?: {
    core?: {
      invoke?: TauriInvoke;
    };
  };
  __TAURI_INTERNALS__?: {
    invoke?: TauriInvoke;
  };
};

async function invokeTauriOpenUrl(url: string): Promise<boolean> {
  if (typeof window === "undefined" || !isTauriRuntime()) {
    return false;
  }

  const win = window as TauriRuntimeWindow;
  const invoke =
    (typeof win.__TAURI_INTERNALS__?.invoke === "function" && win.__TAURI_INTERNALS__.invoke)
    || (typeof win.__TAURI__?.core?.invoke === "function" && win.__TAURI__.core.invoke);

  if (!invoke) {
    return false;
  }

  await invoke("open_external_url", { url });
  return true;
}

export async function openExternalUrl(url: string): Promise<void> {
  try {
    const openedByTauri = await invokeTauriOpenUrl(url);
    if (openedByTauri) {
      return;
    }
  } catch (error) {
    console.warn("[external-links] Failed to delegate URL opening to Tauri", error);
  }

  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
