"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AcpProviderInfo } from "../../../acp-client";

interface ProviderDropdownProps {
  providers: AcpProviderInfo[];
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
  disabled?: boolean;
}

export function ProviderDropdown({
  providers,
  selectedProvider,
  onProviderChange,
  disabled = false,
}: ProviderDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const providerInfo = providers.find((p) => p.id === selectedProvider);
  const availableCount = providers.filter((p) => p.status === "available").length;

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const handleToggle = () => {
    if (isOpen) {
      setIsOpen(false);
    } else {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        setDropdownPos({ left: rect.left, bottom: window.innerHeight - rect.top });
      }
      setIsOpen(true);
    }
  };

  const handleSelect = (providerId: string) => {
    onProviderChange(providerId);
    setIsOpen(false);
  };

  // Group providers by availability and source
  const availableProviders = providers.filter((p) => p.status === "available");
  const unavailableProviders = providers.filter((p) => p.status !== "available");
  const builtinAvailable = availableProviders.filter((p) => p.source === "static");
  const registryAvailable = availableProviders.filter((p) => p.source === "registry");
  const builtinUnavailable = unavailableProviders.filter((p) => p.source === "static");
  const registryUnavailable = unavailableProviders.filter((p) => p.source === "registry");

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled || availableCount === 0}
        className="flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-transparent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${providerInfo?.status === "available" ? "bg-green-500" : "bg-gray-400"}`} />
        <span className="truncate max-w-30">{providerInfo?.name ?? "Select..."}</span>
        <svg className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && dropdownPos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed w-64 max-h-80 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] shadow-xl z-9999"
            style={{ left: dropdownPos.left, bottom: dropdownPos.bottom }}
          >
            <ProviderGroup
              title="Built-in"
              providers={builtinAvailable}
              selectedProvider={selectedProvider}
              onSelect={handleSelect}
              available
            />
            <ProviderGroup
              title="ACP Registry"
              providers={registryAvailable}
              selectedProvider={selectedProvider}
              onSelect={handleSelect}
              available
              showBorder={builtinAvailable.length > 0}
            />
            <ProviderGroup
              title="Built-in - Not Installed"
              providers={builtinUnavailable}
              selectedProvider={selectedProvider}
              onSelect={handleSelect}
              showBorder={builtinAvailable.length > 0 || registryAvailable.length > 0}
            />
            <ProviderGroup
              title="ACP Registry - Not Installed"
              providers={registryUnavailable}
              selectedProvider={selectedProvider}
              onSelect={handleSelect}
              showBorder
            />
            {providers.length > 0 && builtinAvailable.length === 0 && registryAvailable.length === 0 && (
              <NoProvidersMessage providers={providers} />
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

interface ProviderGroupProps {
  title: string;
  providers: AcpProviderInfo[];
  selectedProvider: string;
  onSelect: (id: string) => void;
  available?: boolean;
  showBorder?: boolean;
}

function ProviderGroup({ title, providers, selectedProvider, onSelect, available = false, showBorder = false }: ProviderGroupProps) {
  if (providers.length === 0) return null;

  return (
    <div className={`py-1 ${showBorder ? "border-t border-gray-100 dark:border-gray-800" : ""}`}>
      <div className="px-3 py-1 text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
        {title} ({providers.length})
      </div>
      {providers.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p.id)}
          className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs transition-colors ${!available ? "opacity-60" : ""} ${
            p.id === selectedProvider
              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
              : available
                ? "hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-300"
                : "hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-500 dark:text-gray-400"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${available ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`} />
          <span className="font-medium truncate flex-1">{p.name}</span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-35">{p.command}</span>
        </button>
      ))}
    </div>
  );
}

function NoProvidersMessage({ providers }: { providers: AcpProviderInfo[] }) {
  const hasOpenCodeSdk = providers.some(p => p.id === "opencode-sdk");
  const hasUnavailable = providers.some(p => p.status !== "available");

  return (
    <div className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400 text-center">
      {hasUnavailable ? (
        <>
          <p className="font-medium mb-1">No providers available</p>
          <p className="text-[10px] opacity-75">
            {hasOpenCodeSdk
              ? "Configure OPENCODE_SERVER_URL environment variable to use OpenCode SDK"
              : "Install a provider to get started"}
          </p>
        </>
      ) : (
        "Loading providers..."
      )}
    </div>
  );
}

