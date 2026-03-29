import { Suspense } from "react";

import { getCurrentRoutaRepoRoot } from "@/core/fitness/repo-root";

import { FitnessDashboardPageClient } from "./fitness-dashboard-page-client";

export default function FitnessDashboardPage() {
  const defaultRepoPath = getCurrentRoutaRepoRoot();

  return (
    <Suspense fallback={null}>
      <FitnessDashboardPageClient defaultRepoPath={defaultRepoPath} />
    </Suspense>
  );
}
