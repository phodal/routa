"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ModelDropdownProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
  onFetchModels: () => Promise<string[]>;
}

export function ModelDropdown({
  selectedModel,
  onModelChange,
  onFetchModels,
}: ModelDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [dropdownPos, setDropdownPos] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const handleToggle = async () => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({ left: rect.left, bottom: window.innerHeight - rect.top });
    }
    if (!isOpen && models.length === 0) {
      setLoading(true);
      const fetchedModels = await onFetchModels();
      setModels(fetchedModels);
      setLoading(false);
    }
    setIsOpen((v) => !v);
    setFilter("");
  };

  const handleSelect = (model: string) => {
    onModelChange(model);
    setIsOpen(false);
    setFilter("");
  };

  const filteredModels = models.filter(
    (m) => !filter || m.toLowerCase().includes(filter.toLowerCase())
  );

  const displayName = selectedModel ? selectedModel.split("/").pop() : "Default model";

  return (
    <div ref={dropdownRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-transparent transition-colors"
      >
        <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span className="truncate max-w-30">{displayName}</span>
        {loading ? (
          <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {isOpen && dropdownPos && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed w-72 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] shadow-xl z-9999 flex flex-col"
            style={{ left: dropdownPos.left, bottom: dropdownPos.bottom, maxHeight: "300px" }}
          >
            <div className="p-2 border-b border-gray-100 dark:border-gray-800">
              <input
                autoFocus
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter models..."
                className="w-full px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-transparent outline-none focus:ring-1 focus:ring-indigo-500 text-gray-800 dark:text-gray-200"
              />
            </div>
            <div className="overflow-y-auto flex-1">
              <button
                type="button"
                onClick={() => handleSelect("")}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                  !selectedModel
                    ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-300"
                }`}
              >
                <span className="font-medium">Default model</span>
              </button>
              {filteredModels.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleSelect(m)}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                    m === selectedModel
                      ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-300"
                  }`}
                >
                  <span className="text-gray-400 dark:text-gray-500 font-mono text-[10px] shrink-0">
                    {m.split("/")[0]}
                  </span>
                  <span className="font-medium truncate">{m.split("/").slice(1).join("/") || m}</span>
                </button>
              ))}
              {models.length === 0 && !loading && (
                <div className="px-3 py-3 text-xs text-gray-400 text-center">No models found</div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

