"use client";

import type { ReactNode } from "react";

export type HarnessSectionStateTone = "neutral" | "warning" | "error" | "success";

const CARD_CLASS: Record<"compact" | "full", string> = {
  compact: "rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4",
  full: "rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-4 shadow-sm",
};

const STATE_TONE_CLASS: Record<HarnessSectionStateTone, string> = {
  neutral: "border-desktop-border bg-desktop-bg-primary/80 text-desktop-text-secondary",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  error: "border-red-200 bg-red-50 text-red-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

type HarnessSectionCardProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  variant?: "full" | "compact";
  dataTestId?: string;
  className?: string;
  children?: ReactNode;
};

type HarnessSectionStateFrameProps = {
  tone?: HarnessSectionStateTone;
  children: ReactNode;
};

export function HarnessSectionCard({
  title,
  eyebrow,
  description,
  actions,
  variant = "full",
  dataTestId,
  className,
  children,
}: HarnessSectionCardProps) {
  return (
    <section
      className={`${CARD_CLASS[variant]} ${className ?? ""}`}
      {...(dataTestId ? { "data-testid": dataTestId } : null)}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            {eyebrow ? (
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                {eyebrow}
              </div>
            ) : null}
            <h3 className="text-sm font-semibold text-desktop-text-primary">{title}</h3>
            {description ? (
              <p className="text-[11px] leading-5 text-desktop-text-secondary">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap justify-end gap-2">{actions}</div> : null}
        </div>
        {children ? <div className="space-y-0">{children}</div> : null}
      </div>
    </section>
  );
}

export function HarnessSectionStateFrame({ children, tone = "neutral" }: HarnessSectionStateFrameProps) {
  return (
    <div className={`mt-3 rounded-xl border px-4 py-4 text-[11px] ${STATE_TONE_CLASS[tone]}`}>
      {children}
    </div>
  );
}
