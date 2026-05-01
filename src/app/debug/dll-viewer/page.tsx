import { Suspense } from "react";

import { DllViewerPageClient } from "./page-client";

export default function DllViewerPage() {
  return (
    <Suspense fallback={null}>
      <DllViewerPageClient />
    </Suspense>
  );
}
