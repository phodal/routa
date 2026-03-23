interface CompactStatProps {
  label: string;
  value: number;
  sub?: string;
  color: "blue" | "violet" | "emerald" | "amber";
}

const colorMap = {
  blue: "text-blue-400 border-blue-500/18 bg-blue-500/8",
  violet: "text-slate-400 border-slate-400/18 bg-slate-400/8",
  emerald: "text-emerald-400 border-emerald-500/18 bg-emerald-500/8",
  amber: "text-amber-400 border-amber-500/18 bg-amber-500/8",
} satisfies Record<CompactStatProps["color"], string>;

export function CompactStat({ label, value, sub, color }: CompactStatProps) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${colorMap[color]}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">{label}</div>
        <div className="text-lg font-semibold tabular-nums">{value}</div>
      </div>
      <div className="mt-1 text-[10px] leading-4 text-desktop-text-secondary">
        {sub ?? "Workspace aggregate"}
      </div>
    </div>
  );
}
