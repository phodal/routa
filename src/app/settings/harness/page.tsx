/**
 * Settings / Harness - /settings/harness
 * Settings entry for the harness console, including repository signals, design decisions, and governance diagnostics.
 */
import { Suspense } from "react";
import HarnessConsolePage from "./harness-console-page";

export default function HarnessSettingsPage() {
  return (
    <Suspense fallback={null}>
      <HarnessConsolePage />
    </Suspense>
  );
}
