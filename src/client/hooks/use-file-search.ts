"use client";

/**
 * useFileSearch - Hook for real-time file search with debouncing
 *
 * Features:
 * - Debounced search to avoid excessive API calls
 * - Request cancellation when query changes
 * - Loading and error states
 * - Caches results for the same query
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────

export interface FileMatch {
  path: string;
  fullPath: string;
  name: string;
  score: number;
}

export interface FileSearchResult {
  files: FileMatch[];
  total: number;
  query: string;
  scanned: number;
}

interface UseFileSearchOptions {
  repoPath: string | null;
  debounceMs?: number;
  limit?: number;
}

interface UseFileSearchReturn {
  search: (query: string) => void;
  results: FileMatch[];
  loading: boolean;
  error: string | null;
  query: string;
}

// ─── Hook ───────────────────────────────────────────────────────────────

export function useFileSearch({
  repoPath,
  debounceMs = 150,
  limit = 20,
}: UseFileSearchOptions): UseFileSearchReturn {
  const [results, setResults] = useState<FileMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Refs for cleanup and debouncing
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastQueryRef = useRef<string>("");

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Reset when repo changes
  useEffect(() => {
    setResults([]);
    setError(null);
    setQuery("");
    lastQueryRef.current = "";
  }, [repoPath]);

  const performSearch = useCallback(
    async (searchQuery: string) => {
      // Skip if no repo selected
      if (!repoPath) {
        setResults([]);
        setLoading(false);
        return;
      }

      // Skip if same query
      if (searchQuery === lastQueryRef.current && results.length > 0) {
        setLoading(false);
        return;
      }

      lastQueryRef.current = searchQuery;

      // Cancel previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          q: searchQuery,
          repoPath,
          limit: String(limit),
        });

        const response = await fetch(`/api/files/search?${params}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Search failed");
        }

        const data: FileSearchResult = await response.json();
        setResults(data.files);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Request was cancelled, ignore
          return;
        }
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [repoPath, limit, results.length]
  );

  const search = useCallback(
    (newQuery: string) => {
      setQuery(newQuery);

      // Clear previous debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Debounce the search
      debounceTimerRef.current = setTimeout(() => {
        performSearch(newQuery);
      }, debounceMs);
    },
    [performSearch, debounceMs]
  );

  return {
    search,
    results,
    loading,
    error,
    query,
  };
}

