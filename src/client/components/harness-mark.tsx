"use client";

import React from "react";
import { Waypoints } from "lucide-react";
import { useTranslation } from "@/i18n";

interface HarnessMarkProps {
  className?: string;
  title?: string;
}

/**
 * Harness now uses a standard lucide icon so the settings/navigation surface
 * stays aligned with the rest of the icon system.
 */
export function HarnessMark({
  className = "h-5 w-5",
  title,
}: HarnessMarkProps) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t.harness.mark.defaultTitle;
  return (
    <Waypoints
      className={className}
      strokeWidth={1.8}
      aria-hidden={resolvedTitle ? undefined : true}
      aria-label={resolvedTitle}
    />
  );
}