import { useCallback, useEffect, useRef, useState } from "react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { CapabilityGroup, FeatureDetail, FeatureListResponse, FeatureSummary } from "./types";

interface UseFeatureExplorerDataOptions {
  workspaceId: string;
}

interface UseFeatureExplorerDataResult {
  loading: boolean;
  error: string | null;
  capabilityGroups: CapabilityGroup[];
  features: FeatureSummary[];
  featureDetail: FeatureDetail | null;
  featureDetailLoading: boolean;
  /** ID of the feature whose detail was auto-selected on initial load */
  initialFeatureId: string;
  fetchFeatureDetail: (featureId: string) => Promise<FeatureDetail | null>;
}

function buildQuery(options: UseFeatureExplorerDataOptions): string {
  const params = new URLSearchParams();
  params.set("workspaceId", options.workspaceId);
  return params.toString();
}

async function loadFeatureDetail(
  featureId: string,
  options: UseFeatureExplorerDataOptions,
): Promise<FeatureDetail | null> {
  const query = buildQuery(options);
  const response = await desktopAwareFetch(
    `/feature-explorer/${encodeURIComponent(featureId)}?${query}`,
  );
  if (!response.ok) return null;
  return response.json();
}

export function useFeatureExplorerData(
  options: UseFeatureExplorerDataOptions,
): UseFeatureExplorerDataResult {
  const { workspaceId } = options;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capabilityGroups, setCapabilityGroups] = useState<CapabilityGroup[]>([]);
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [featureDetail, setFeatureDetail] = useState<FeatureDetail | null>(null);
  const [featureDetailLoading, setFeatureDetailLoading] = useState(false);
  const [initialFeatureId, setInitialFeatureId] = useState("");
  const initialFetchDone = useRef(false);

  useEffect(() => {
    let cancelled = false;
    initialFetchDone.current = false;

    async function fetchFeatures() {
      setLoading(true);
      setError(null);

      try {
        const opts = { workspaceId };
        const query = buildQuery(opts);
        const response = await desktopAwareFetch(`/feature-explorer?${query}`);
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.details ?? body.error ?? `HTTP ${response.status}`);
        }
        const data: FeatureListResponse = await response.json();
        if (!cancelled) {
          setCapabilityGroups(data.capabilityGroups ?? []);
          setFeatures(data.features ?? []);

          // Auto-fetch first feature detail
          const firstId = data.features?.[0]?.id;
          if (firstId && !initialFetchDone.current) {
            initialFetchDone.current = true;
            setInitialFeatureId(firstId);
            setFeatureDetailLoading(true);
            const detail = await loadFeatureDetail(firstId, opts);
            if (!cancelled && detail) {
              setFeatureDetail(detail);
            }
            if (!cancelled) setFeatureDetailLoading(false);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchFeatures();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const fetchFeatureDetail = useCallback(
    async (featureId: string): Promise<FeatureDetail | null> => {
      setFeatureDetailLoading(true);
      try {
        const detail = await loadFeatureDetail(featureId, { workspaceId });
        if (detail) {
          setFeatureDetail(detail);
        }
        return detail;
      } catch {
        return null;
      } finally {
        setFeatureDetailLoading(false);
      }
    },
    [workspaceId],
  );

  return {
    loading,
    error,
    capabilityGroups,
    features,
    featureDetail,
    featureDetailLoading,
    initialFeatureId,
    fetchFeatureDetail,
  };
}
