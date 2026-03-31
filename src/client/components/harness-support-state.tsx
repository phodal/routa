"use client";

type MaybeMessage = string | null | undefined;

type HarnessUnsupportedStateProps = {
  className?: string;
};

const UNSUPPORTED_REPO_MARKERS = [
  "不存在或不是目录",
] as const;

export function getHarnessUnsupportedRepoMessage(...messages: MaybeMessage[]): string | null {
  const matched = messages.find((message) => (
    typeof message === "string"
    && UNSUPPORTED_REPO_MARKERS.some((marker) => message.includes(marker))
  ));

  if (!matched) {
    return null;
  }

  return "当前仓库路径无效或不可访问，当前页面无法渲染该视图。";
}

export function HarnessUnsupportedState({
  className,
}: HarnessUnsupportedStateProps) {
  return (
    <div className={className ?? "mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-[11px] text-amber-800"}>
      <div className="leading-5">
        当前仓库路径无效或不可访问，无法渲染该视图。
      </div>
    </div>
  );
}
