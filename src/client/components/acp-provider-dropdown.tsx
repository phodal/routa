"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AcpProviderInfo } from "../acp-client";
import { SettingsPanel } from "./settings-panel";
import { useTranslation } from "@/i18n";
import {
  dedupeProviderIds,
  getOrderedVisibleProviderIds,
  PROVIDER_DISPLAY_PREFERENCES_CHANGED_EVENT,
  saveProviderDisplayPreferences,
} from "../utils/custom-acp-providers";
import { ChevronDown, GripVertical } from "lucide-react";


interface AcpProviderDropdownProps {
  providers: AcpProviderInfo[];
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
  disabled?: boolean;
  allowAuto?: boolean;
  autoLabel?: string;
  showStatusDot?: boolean;
  variant?: "compact" | "hero";
  ariaLabel?: string;
  buttonClassName?: string;
  labelClassName?: string;
  dataTestId?: string;
}

type DropdownPosition = { left: number; top?: number; bottom?: number; maxHeight: number };

function orderProviders(providerIds: string[], visibleProviderIds: string[]): string[] {
  const preferredOrder = new Map(
    dedupeProviderIds(visibleProviderIds).map((providerId, index) => [providerId, index])
  );

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

export function AcpProviderDropdown({
  providers,
  selectedProvider,
  onProviderChange,
  disabled = false,
  allowAuto = false,
  autoLabel = "Auto",
  showStatusDot = true,
  variant = "compact",
  ariaLabel,
  buttonClassName,
  labelClassName,
  dataTestId,
}: AcpProviderDropdownProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<DropdownPosition | null>(null);
  const [visibleProviderIds, setVisibleProviderIds] = useState<string[]>(() =>
    getOrderedVisibleProviderIds([])
  );
  const [draggingProviderId, setDraggingProviderId] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncPreferences = () => {
      setVisibleProviderIds(getOrderedVisibleProviderIds(providers.map((provider) => provider.id)));
    };

    syncPreferences();
    window.addEventListener(PROVIDER_DISPLAY_PREFERENCES_CHANGED_EVENT, syncPreferences);
    window.addEventListener("storage", syncPreferences);
    return () => {
      window.removeEventListener(PROVIDER_DISPLAY_PREFERENCES_CHANGED_EVENT, syncPreferences);
      window.removeEventListener("storage", syncPreferences);
    };
  }, [providers]);

  useEffect(() => {
    if (!isOpen) return;

    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const providerMap = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers]
  );

  const selectedProviderInfo = providerMap.get(selectedProvider);
  const visibleProviders = useMemo(() => {
    const orderedIds = dedupeProviderIds([
      ...visibleProviderIds,
      ...(selectedProvider && !visibleProviderIds.includes(selectedProvider) ? [selectedProvider] : []),
    ]);

    return orderedIds
      .map((providerId) => providerMap.get(providerId))
      .filter((provider): provider is AcpProviderInfo => Boolean(provider));
  }, [providerMap, selectedProvider, visibleProviderIds]);

  const settingsProviders = useMemo(() => {
    const sortedIds = orderProviders(providers.map((provider) => provider.id), visibleProviderIds);
    return sortedIds
      .map((providerId) => providerMap.get(providerId))
      .filter((provider): provider is AcpProviderInfo => Boolean(provider));
  }, [providerMap, providers, visibleProviderIds]);

  const defaultButtonClassName = variant === "hero"
    ? "flex items-center gap-2 rounded-lg border border-[#d6e5fb] px-3 py-1.5 text-sm transition-colors hover:bg-sky-50 dark:border-white/10 dark:hover:bg-white/5"
    : "flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-transparent transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const defaultLabelClassName = variant === "hero"
    ? "font-medium truncate max-w-[160px] text-slate-700 dark:text-slate-200"
    : "truncate max-w-30";
  const panelWidthClassName = variant === "hero" ? "w-80" : "w-72";
  const resolvedAriaLabel = ariaLabel ?? t.providerDropdown.selectProvider;

  const updateVisibleProviders = (nextVisibleIds: string[]) => {
    const normalizedVisibleIds = dedupeProviderIds(nextVisibleIds);
    setVisibleProviderIds(normalizedVisibleIds);
    saveProviderDisplayPreferences({ visibleProviderIds: normalizedVisibleIds });
  };

  const openDropdown = () => {
    if (!buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const preferredHeight = 420;
    const padding = 8;
    const spaceAbove = rect.top - padding;
    const spaceBelow = window.innerHeight - rect.bottom - padding;

    if (spaceBelow >= spaceAbove) {
      setDropdownPos({
        left: rect.left,
        top: rect.bottom + 4,
        maxHeight: Math.min(spaceBelow, preferredHeight),
      });
    } else {
      setDropdownPos({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 4,
        maxHeight: Math.min(spaceAbove, preferredHeight),
      });
    }
    setVisibleProviderIds(getOrderedVisibleProviderIds(providers.map((provider) => provider.id)));
    setIsOpen(true);
  };

  const toggleDropdown = () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    openDropdown();
    setSettingsOpen(false);
  };

  const handleSelect = (providerId: string) => {
    onProviderChange(providerId);
    setIsOpen(false);
  };

  const handleOpenSettingsPanel = () => {
    setIsOpen(false);
    setSettingsOpen(false);
    setShowSettingsPanel(true);
  };

  const handleVisibleToggle = (providerId: string, checked: boolean) => {
    if (checked) {
      updateVisibleProviders([...visibleProviderIds, providerId]);
      return;
    }

    updateVisibleProviders(visibleProviderIds.filter((id) => id !== providerId));
  };

  const moveVisibleProvider = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    if (!visibleProviderIds.includes(draggedId) || !visibleProviderIds.includes(targetId)) return;

    const reorderedIds = [...visibleProviderIds];
    const fromIndex = reorderedIds.indexOf(draggedId);
    const targetIndex = reorderedIds.indexOf(targetId);
    reorderedIds.splice(fromIndex, 1);
    reorderedIds.splice(targetIndex, 0, draggedId);
    updateVisibleProviders(reorderedIds);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleDropdown}
        disabled={disabled || providers.length === 0}
        className={buttonClassName ?? defaultButtonClassName}
        title={resolvedAriaLabel}
        aria-label={resolvedAriaLabel}
        data-testid={dataTestId}
      >
        {showStatusDot && (
          <span className={`w-1.5 h-1.5 rounded-full ${
            selectedProviderInfo?.status === "available"
              ? "bg-emerald-500"
              : selectedProviderInfo?.status === "checking"
                ? "bg-amber-400 animate-pulse"
                : "bg-slate-400"
          }`} />
        )}
        <span className={labelClassName ?? defaultLabelClassName}>
          {selectedProviderInfo?.name ?? (allowAuto ? autoLabel : t.providerDropdown.selectProvider)}
        </span>
        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      </button>

      {isOpen && dropdownPos && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          className={`fixed ${panelWidthClassName} rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2130] shadow-xl z-[9999] overflow-hidden`}
          style={{
            left: dropdownPos.left,
            top: dropdownPos.top,
            bottom: dropdownPos.bottom,
            maxHeight: `${dropdownPos.maxHeight}px`,
          }}
        >
          <div className="flex h-full max-h-[inherit] flex-col">
            <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                Providers
              </p>
            </div>

            <div className="overflow-y-auto">
              <div className="p-2">
                {allowAuto && (
                  <button
                    type="button"
                    onClick={() => handleSelect("")}
                    className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                      selectedProvider
                        ? "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
                        : "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                    <span className="font-medium">{autoLabel}</span>
                  </button>
                )}
                {visibleProviders.length > 0 ? (
                  <div className="space-y-1">
                    {visibleProviders.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => handleSelect(provider.id)}
                        title={provider.unavailableReason ?? provider.description}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                          provider.id === selectedProvider
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
                            : provider.status === "available"
                              ? "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
                              : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          provider.status === "available"
                            ? "bg-emerald-500"
                            : provider.status === "checking"
                              ? "bg-amber-400 animate-pulse"
                              : "bg-slate-300 dark:bg-slate-600"
                        }`} />
                        <span className="min-w-0 flex-1 truncate font-medium">{provider.name}</span>
                        <span className="max-w-[120px] truncate font-mono text-[10px] text-slate-400 dark:text-slate-500">
                          {provider.command}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    {t.providerDropdown.addQuickAccessHint}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setSettingsOpen((open) => !open)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                    {t.providerDropdown.quickAccess}
                  </p>
                  <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${settingsOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                </button>
              </div>

              {settingsOpen && (
                <div className="p-2 pt-1">
                  <p className="px-2 pb-2 text-[10px] text-slate-400 dark:text-slate-500">
                    {t.providerDropdown.quickAccessHint}
                  </p>
                  {settingsProviders.map((provider) => {
                    const checked = visibleProviderIds.includes(provider.id);
                    return (
                      <div
                        key={provider.id}
                        draggable={checked}
                        onDragStart={() => setDraggingProviderId(provider.id)}
                        onDragEnd={() => setDraggingProviderId(null)}
                        onDragOver={(event) => {
                          if (!draggingProviderId || !checked) return;
                          event.preventDefault();
                          moveVisibleProvider(draggingProviderId, provider.id);
                        }}
                        className={`flex items-center gap-2 rounded-lg px-2 py-2 text-xs ${
                          draggingProviderId === provider.id ? "bg-slate-50 dark:bg-slate-800/60" : ""
                        }`}
                      >
                        <button
                          type="button"
                          aria-label={`Drag ${provider.name}`}
                          className={`flex h-6 w-6 items-center justify-center rounded text-slate-400 ${
                            checked ? "cursor-grab hover:bg-slate-100 dark:hover:bg-slate-800" : "cursor-not-allowed opacity-40"
                          }`}
                        >
                          <GripVertical className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                        </button>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => handleVisibleToggle(provider.id, event.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 dark:border-slate-600"
                        />
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          provider.status === "available"
                            ? "bg-emerald-500"
                            : provider.status === "checking"
                              ? "bg-amber-400 animate-pulse"
                              : "bg-slate-300 dark:bg-slate-600"
                        }`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-900 dark:text-slate-100">{provider.name}</p>
                          <p className="truncate font-mono text-[10px] text-slate-400 dark:text-slate-500">{provider.id}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="border-t border-slate-100 p-2 dark:border-slate-800">
                <button
                  type="button"
                  onClick={handleOpenSettingsPanel}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/50"
                >
                  {t.providerDropdown.openProviderSettings}
                </button>
              </div>

              {providers.length > 0 && visibleProviders.length === 0 && (
                <NoProvidersMessage providers={providers} />
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      <SettingsPanel
        open={showSettingsPanel}
        onClose={() => setShowSettingsPanel(false)}
        providers={providers}
        initialTab="providers"
      />
    </div>
  );
}

function NoProvidersMessage({ providers }: { providers: AcpProviderInfo[] }) {
  const { t } = useTranslation();
  const hasOpenCodeSdk = providers.some((provider) => provider.id === "opencode-sdk");
  const hasUnavailable = providers.some((provider) => provider.status !== "available");

  return (
    <div className="px-3 py-3 text-center text-xs text-slate-500 dark:text-slate-400">
      {hasUnavailable ? (
        <>
          <p className="font-medium mb-1">{t.providerDropdown.noProvidersAvailable}</p>
          <p className="text-[10px] opacity-75">
            {hasOpenCodeSdk
              ? t.providerDropdown.configureOpenCode
              : t.providerDropdown.installProvider}
          </p>
        </>
      ) : (
        t.providerDropdown.loadingProviders
      )}
    </div>
  );
}
