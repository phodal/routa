"use client";

/**
 * useDashboardConfig - React hook for A2UI dashboard panel persistence.
 *
 * Loads and saves dashboard configuration (panel order, visibility, custom surfaces)
 * from the /api/a2ui/dashboard/config endpoint.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { desktopAwareFetch } from "../utils/diagnostics";
import type { A2UIMessage } from "../a2ui/types";

export interface DashboardConfig {
  surfaceOrder: string[] | null;
  hiddenSurfaces: string[] | null;
  customSurfaces: A2UIMessage[] | null;
}

export interface UseDashboardConfigReturn {
  config: DashboardConfig;
  loading: boolean;
  /** Update surface order (called after drag-and-drop) */
  setSurfaceOrder: (order: string[]) => void;
  /** Toggle visibility of a surface */
  toggleSurfaceVisibility: (surfaceId: string) => void;
  /** Show a hidden surface */
  showSurface: (surfaceId: string) => void;
  /** Hide a surface */
  hideSurface: (surfaceId: string) => void;
  /** Add custom surfaces */
  addCustomSurfaces: (messages: A2UIMessage[]) => void;
  /** Remove a custom surface by surfaceId */
  removeCustomSurface: (surfaceId: string) => void;
  /** Get list of hidden surface IDs */
  hiddenSurfaceIds: string[];
}

export function useDashboardConfig(workspaceId: string): UseDashboardConfigReturn {
  const [config, setConfig] = useState<DashboardConfig>({
    surfaceOrder: null,
    hiddenSurfaces: null,
    customSurfaces: null,
  });
  const [loading, setLoading] = useState(true);

  // Debounced save ref
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  // Fetch config on mount
  useEffect(() => {
    if (!workspaceId || workspaceId === "__placeholder__") return;

    (async () => {
      try {
        const res = await desktopAwareFetch(
          `/api/a2ui/dashboard/config?workspaceId=${encodeURIComponent(workspaceId)}`
        );
        if (res.ok) {
          const data = await res.json();
          const cfg = data.config;
          setConfig({
            surfaceOrder: cfg.surfaceOrder ?? null,
            hiddenSurfaces: cfg.hiddenSurfaces ?? null,
            customSurfaces: cfg.customSurfaces ?? null,
          });
        }
      } catch {
        // Silently fail - use defaults
      } finally {
        setLoading(false);
      }
    })();
  }, [workspaceId]);

  // Save config with debounce (300ms)
  const saveConfig = useCallback(
    (newConfig: DashboardConfig) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await desktopAwareFetch("/api/a2ui/dashboard/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId,
              surfaceOrder: newConfig.surfaceOrder,
              hiddenSurfaces: newConfig.hiddenSurfaces,
              customSurfaces: newConfig.customSurfaces,
            }),
          });
        } catch {
          // Silently fail - config will be retried on next change
        }
      }, 300);
    },
    [workspaceId]
  );

  const setSurfaceOrder = useCallback(
    (order: string[]) => {
      setConfig((prev) => {
        const next = { ...prev, surfaceOrder: order };
        saveConfig(next);
        return next;
      });
    },
    [saveConfig]
  );

  const hideSurface = useCallback(
    (surfaceId: string) => {
      setConfig((prev) => {
        const current = prev.hiddenSurfaces ?? [];
        if (current.includes(surfaceId)) return prev;
        const next = { ...prev, hiddenSurfaces: [...current, surfaceId] };
        saveConfig(next);
        return next;
      });
    },
    [saveConfig]
  );

  const showSurface = useCallback(
    (surfaceId: string) => {
      setConfig((prev) => {
        const current = prev.hiddenSurfaces ?? [];
        if (!current.includes(surfaceId)) return prev;
        const next = { ...prev, hiddenSurfaces: current.filter((id) => id !== surfaceId) };
        saveConfig(next);
        return next;
      });
    },
    [saveConfig]
  );

  const toggleSurfaceVisibility = useCallback(
    (surfaceId: string) => {
      const current = configRef.current.hiddenSurfaces ?? [];
      if (current.includes(surfaceId)) {
        showSurface(surfaceId);
      } else {
        hideSurface(surfaceId);
      }
    },
    [showSurface, hideSurface]
  );

  const addCustomSurfaces = useCallback(
    (messages: A2UIMessage[]) => {
      setConfig((prev) => {
        const current = prev.customSurfaces ?? [];
        const next = {
          ...prev,
          customSurfaces: [...current, ...messages],
        };
        saveConfig(next);
        return next;
      });
    },
    [saveConfig]
  );

  const removeCustomSurface = useCallback(
    (surfaceId: string) => {
      setConfig((prev) => {
        const current = prev.customSurfaces ?? [];
        // Remove all messages related to this surfaceId
        const filtered = current.filter((msg) => {
          const m = msg as unknown as Record<string, unknown>;
          if ("createSurface" in m) {
            const cs = m.createSurface as { surfaceId?: string };
            return cs?.surfaceId !== surfaceId;
          }
          if ("updateComponents" in m) {
            const uc = m.updateComponents as { surfaceId?: string };
            return uc?.surfaceId !== surfaceId;
          }
          if ("updateDataModel" in m) {
            const udm = m.updateDataModel as { surfaceId?: string };
            return udm?.surfaceId !== surfaceId;
          }
          if ("deleteSurface" in m) {
            const ds = m.deleteSurface as { surfaceId?: string };
            return ds?.surfaceId !== surfaceId;
          }
          return true;
        });
        const next = { ...prev, customSurfaces: filtered };
        saveConfig(next);
        return next;
      });
    },
    [saveConfig]
  );

  return {
    config,
    loading,
    setSurfaceOrder,
    toggleSurfaceVisibility,
    showSurface,
    hideSurface,
    addCustomSurfaces,
    removeCustomSurface,
    hiddenSurfaceIds: config.hiddenSurfaces ?? [],
  };
}
