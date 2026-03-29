import { Suspense } from "react";
import { FluencySettingsPageClient } from "./fluency-settings-page-client";

export default function FluencySettingsPage() {
  return (
    <Suspense fallback={null}>
      <FluencySettingsPageClient />
    </Suspense>
  );
}
