/**
 * A2UI React Renderer
 *
 * A lightweight, framework-native renderer for A2UI v0.10 protocol.
 * Renders A2UI component trees as React elements using Tailwind CSS.
 *
 * Unlike the official @copilotkit/a2ui-renderer (which wraps Lit web components),
 * this renders pure React components for seamless integration with the existing UI.
 */

"use client";

import React, { useState } from "react";
import Image from "next/image";
import type {
  A2UIComponent,
  A2UIMessage,
  A2UISurface,
  ChildList,
  DynamicString,
  DynamicNumber,
  DynamicBoolean,
  TextVariant,
  TextAccent,
  ButtonVariant,
  JustifyContent,
  AlignItems,
  DataBinding,
  FunctionCall,
} from "./types";

// ─── Data binding resolution ──────────────────────────────────────

function isDataBinding(val: unknown): val is DataBinding {
  return typeof val === "object" && val !== null && "path" in val && typeof (val as DataBinding).path === "string" && !("call" in val);
}

function isFunctionCall(val: unknown): val is FunctionCall {
  return typeof val === "object" && val !== null && "call" in val;
}

/** Resolve a JSON Pointer path against a data model, with optional relative scope */
function resolvePath(data: Record<string, unknown>, path: string, scope = ""): unknown {
  // Absolute path
  const fullPath = path.startsWith("/") ? path : (scope ? `${scope}/${path}` : `/${path}`);
  const segments = fullPath.split("/").filter(Boolean);
  let current: unknown = data;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[seg];
    } else if (Array.isArray(current)) {
      const idx = parseInt(seg, 10);
      current = isNaN(idx) ? undefined : current[idx];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Resolve a DynamicString to a concrete string */
function resolveString(val: DynamicString | undefined, data: Record<string, unknown>, scope = ""): string {
  if (val === undefined || val === null) return "";
  if (typeof val === "string") return val;
  if (isDataBinding(val)) {
    const resolved = resolvePath(data, val.path, scope);
    return resolved !== undefined && resolved !== null ? String(resolved) : "";
  }
  if (isFunctionCall(val)) {
    // Basic function call support
    if (val.call === "formatString" && typeof val.args?.value === "string") {
      return val.args.value.replace(/\$\{([^}]+)\}/g, (_match, path: string) => {
        const v = resolvePath(data, path, scope);
        return v !== undefined ? String(v) : "";
      });
    }
    return `[fn:${val.call}]`;
  }
  return String(val);
}

/** Resolve a DynamicNumber to a concrete number */
function resolveNumber(val: DynamicNumber | undefined, data: Record<string, unknown>, scope = ""): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === "number") return val;
  if (isDataBinding(val)) {
    const resolved = resolvePath(data, val.path, scope);
    return typeof resolved === "number" ? resolved : Number(resolved) || 0;
  }
  return 0;
}

/** Resolve a DynamicBoolean to a concrete boolean */
function resolveBoolean(val: DynamicBoolean | undefined, data: Record<string, unknown>, scope = ""): boolean {
  if (val === undefined || val === null) return false;
  if (typeof val === "boolean") return val;
  if (isDataBinding(val)) {
    const resolved = resolvePath(data, val.path, scope);
    return Boolean(resolved);
  }
  return false;
}

// ─── Style mapping ────────────────────────────────────────────────

const TEXT_VARIANT_CLASSES: Record<TextVariant, string> = {
  h1: "text-2xl font-bold text-gray-900 dark:text-gray-100",
  h2: "text-xl font-semibold text-gray-800 dark:text-gray-200",
  h3: "text-base font-semibold text-gray-800 dark:text-gray-200",
  h4: "text-sm font-semibold text-gray-700 dark:text-gray-300",
  h5: "text-xs font-semibold text-gray-700 dark:text-gray-300",
  body: "text-sm text-gray-600 dark:text-gray-400",
  caption: "text-xs text-gray-500 dark:text-gray-500",
};

const TEXT_ACCENT_CLASSES: Record<TextAccent, string> = {
  success:  "text-emerald-600 dark:text-emerald-400",
  warning:  "text-amber-600 dark:text-amber-500",
  error:    "text-red-600 dark:text-red-400",
  info:     "text-blue-600 dark:text-blue-400",
  muted:    "text-gray-400 dark:text-gray-500",
  primary:  "text-amber-600 dark:text-amber-500",
  route:    "text-slate-600 dark:text-slate-300",
};

const TEXT_ACCENT_PILL_CLASSES: Record<TextAccent, string> = {
  success:  "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
  warning:  "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
  error:    "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
  info:     "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
  muted:    "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
  primary:  "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
  route:    "bg-slate-100 dark:bg-slate-900/30 text-slate-700 dark:text-slate-300",
};

const JUSTIFY_CLASSES: Record<JustifyContent, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  spaceBetween: "justify-between",
  spaceAround: "justify-around",
  spaceEvenly: "justify-evenly",
  stretch: "justify-stretch",
};

const ALIGN_CLASSES: Record<AlignItems, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

const GAP_ROW_CLASSES: Record<string, string> = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-3",
  lg: "gap-6",
};

const GAP_COL_CLASSES: Record<string, string> = {
  none: "gap-0",
  xs: "gap-0.5",
  sm: "gap-1.5",
  md: "gap-3",
  lg: "gap-5",
};

const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default: "px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#252838] text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#191c28] transition-colors",
  primary: "px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 transition-colors shadow-sm",
  borderless: "px-2 py-1 text-sm font-medium text-amber-600 dark:text-amber-500 hover:text-amber-700 dark:hover:text-amber-400 transition-colors",
};

// ─── Material icon → SVG mapping (subset for dashboard use) ───────

const ICON_SVG_MAP: Record<string, React.ReactNode> = {
  chat: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
    </svg>
  ),
  people: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
  check_circle: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  schedule: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  code: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
    </svg>
  ),
  trending_up: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
    </svg>
  ),
  priority_high: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  ),
  settings: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  description: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  ),
  bolt: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  ),
  open_in_new: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  ),
};

// ─── Component renderer ───────────────────────────────────────────

interface RendererCtx {
  componentMap: Map<string, A2UIComponent>;
  data: Record<string, unknown>;
  scope: string;
  onAction?: (action: { name: string; surfaceId: string; context?: Record<string, unknown> }) => void;
  surfaceId: string;
  theme?: { primaryColor?: string };
}

function renderChildList(childList: ChildList, ctx: RendererCtx): React.ReactNode[] {
  if (Array.isArray(childList)) {
    return childList.map((childId) => (
      <A2UIComponentRenderer key={childId} componentId={childId} ctx={ctx} />
    ));
  }
  // Template-based children (iterate over data array)
  const items = resolvePath(ctx.data, childList.path, ctx.scope);
  if (!Array.isArray(items)) return [];
  return items.map((_item, idx) => {
    const childCtx: RendererCtx = {
      ...ctx,
      scope: `${childList.path}/${idx}`,
    };
    return <A2UIComponentRenderer key={`${childList.componentId}-${idx}`} componentId={childList.componentId} ctx={childCtx} />;
  });
}

function A2UIComponentRenderer({ componentId, ctx }: { componentId: string; ctx: RendererCtx }): React.ReactNode {
  const comp = ctx.componentMap.get(componentId);
  if (!comp) return null;

  const flex = comp.weight ? { flex: comp.weight } : undefined;

  switch (comp.component) {
    case "Text": {
      const text = resolveString(comp.text, ctx.data, ctx.scope);
      const accentCls = comp.accent
        ? (comp.pill ? TEXT_ACCENT_PILL_CLASSES[comp.accent] : TEXT_ACCENT_CLASSES[comp.accent])
        : undefined;
      if (comp.pill) {
        return (
          <span key={comp.id} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider shrink-0 ${accentCls ?? "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"}`} style={flex}>
            {text}
          </span>
        );
      }
      const variantCls = TEXT_VARIANT_CLASSES[comp.variant ?? "body"];
      return <span key={comp.id} className={`${variantCls} ${accentCls ?? ""}`.trim()} style={flex}>{text}</span>;
    }

    case "Image": {
      const url = resolveString(comp.url, ctx.data, ctx.scope);
      const fitCls = comp.fit === "cover" ? "object-cover" : comp.fit === "contain" ? "object-contain" : "object-cover";
      const variantCls =
        comp.variant === "avatar" ? "w-10 h-10 rounded-full" :
        comp.variant === "icon" ? "w-6 h-6" :
        comp.variant === "smallFeature" ? "w-16 h-16 rounded-lg" :
        comp.variant === "mediumFeature" ? "w-32 h-32 rounded-lg" :
        comp.variant === "largeFeature" ? "w-full max-h-48 rounded-lg" :
        comp.variant === "header" ? "w-full max-h-64 rounded-lg" :
        "w-full max-h-48 rounded-lg";
      return <Image key={comp.id} src={url} className={`${variantCls} ${fitCls}`} style={flex} alt="" />;
    }

    case "Icon": {
      const name = resolveString(comp.name, ctx.data, ctx.scope);
      const icon = ICON_SVG_MAP[name];
      if (icon) return <span key={comp.id} className="shrink-0 text-gray-500 dark:text-gray-400" style={flex}>{icon}</span>;
      // Fallback: render name as text
      return <span key={comp.id} className="text-xs text-gray-400 shrink-0" style={flex}>{name}</span>;
    }

    case "Row": {
      const justify = JUSTIFY_CLASSES[comp.justify ?? "start"];
      const align = ALIGN_CLASSES[comp.align ?? "center"];
      const gap = GAP_ROW_CLASSES[comp.gap ?? "sm"];
      return (
        <div key={comp.id} className={`flex flex-row ${gap} ${justify} ${align}`} style={flex}>
          {renderChildList(comp.children, ctx)}
        </div>
      );
    }

    case "Column": {
      const justify = JUSTIFY_CLASSES[comp.justify ?? "start"];
      const align = ALIGN_CLASSES[comp.align ?? "stretch"];
      const gap = GAP_COL_CLASSES[comp.gap ?? "sm"];
      return (
        <div key={comp.id} className={`flex flex-col ${gap} ${justify} ${align}`} style={flex}>
          {renderChildList(comp.children, ctx)}
        </div>
      );
    }

    case "Card": {
      const accentBorderMap: Record<string, string> = {
        success: "border-t-2 border-t-emerald-500",
        warning: "border-t-2 border-t-amber-500",
        error:   "border-t-2 border-t-red-500",
        info:    "border-t-2 border-t-blue-500",
        route:   "border-t-2 border-t-slate-500",
        primary: "border-t-2 border-t-amber-500",
        muted:   "",
      };
      const headerLabel = comp.label ? resolveString(comp.label, ctx.data, ctx.scope) : undefined;
      const cardAccentCls = comp.accent ? (accentBorderMap[comp.accent] ?? "") : "";
      return (
        <div key={comp.id} className={`bg-white dark:bg-[#12141c] rounded-xl border border-gray-200/60 dark:border-[#1c1f2e] overflow-hidden ${cardAccentCls}`} style={flex}>
          {headerLabel && (
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-[#191c28] flex items-center justify-between">
              <span className="text-[12px] font-semibold text-gray-700 dark:text-gray-300">{headerLabel}</span>
            </div>
          )}
          <div className="p-4">
            <A2UIComponentRenderer componentId={comp.child} ctx={ctx} />
          </div>
        </div>
      );
    }

    case "List": {
      const dirCls = comp.direction === "horizontal" ? "flex flex-row gap-2 flex-wrap" : "flex flex-col gap-1.5";
      return (
        <div key={comp.id} className={dirCls} style={flex}>
          {renderChildList(comp.children, ctx)}
        </div>
      );
    }

    case "Divider": {
      return comp.axis === "vertical"
        ? <div key={comp.id} className="w-px bg-gray-200 dark:bg-[#1c1f2e] self-stretch mx-1" />
        : <hr key={comp.id} className="border-gray-200 dark:border-[#191c28] my-2" />;
    }

    case "Button": {
      const variantCls = BUTTON_VARIANT_CLASSES[comp.variant ?? "default"];
      const handleClick = () => {
        if (!comp.action || !ctx.onAction) return;
        if ("event" in comp.action) {
          const resolvedCtx: Record<string, unknown> = {};
          if (comp.action.event.context) {
            for (const [k, v] of Object.entries(comp.action.event.context)) {
              if (isDataBinding(v)) {
                resolvedCtx[k] = resolvePath(ctx.data, v.path, ctx.scope);
              } else {
                resolvedCtx[k] = v;
              }
            }
          }
          ctx.onAction({
            name: comp.action.event.name,
            surfaceId: ctx.surfaceId,
            context: resolvedCtx,
          });
        }
      };
      return (
        <button key={comp.id} className={variantCls} style={flex} onClick={handleClick}>
          <A2UIComponentRenderer componentId={comp.child} ctx={ctx} />
        </button>
      );
    }

    case "TextField": {
      const label = resolveString(comp.label, ctx.data, ctx.scope);
      const value = resolveString(comp.value, ctx.data, ctx.scope);
      const isLong = comp.variant === "longText";
      return (
        <div key={comp.id} className="flex flex-col gap-1" style={flex}>
          {label && <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</label>}
          {isLong ? (
            <textarea
              defaultValue={value}
              rows={3}
              className="px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#0e1019] text-sm text-gray-800 dark:text-gray-200 outline-none focus:ring-2 focus:ring-amber-500/30 resize-none"
            />
          ) : (
            <input
              type={comp.variant === "number" ? "number" : comp.variant === "obscured" ? "password" : "text"}
              defaultValue={value}
              className="px-3 py-2 rounded-lg border border-gray-200 dark:border-[#252838] bg-gray-50 dark:bg-[#0e1019] text-sm text-gray-800 dark:text-gray-200 outline-none focus:ring-2 focus:ring-amber-500/30"
            />
          )}
        </div>
      );
    }

    case "CheckBox": {
      const label = resolveString(comp.label, ctx.data, ctx.scope);
      const checked = resolveBoolean(comp.value, ctx.data, ctx.scope);
      return (
        <label key={comp.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer" style={flex}>
          <input type="checkbox" defaultChecked={checked} className="rounded border-gray-300 dark:border-gray-600" />
          {label}
        </label>
      );
    }

    case "Slider": {
      const label = resolveString(comp.label, ctx.data, ctx.scope);
      const value = resolveNumber(comp.value, ctx.data, ctx.scope);
      return (
        <div key={comp.id} className="flex flex-col gap-1" style={flex}>
          {label && <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</label>}
          <input
            type="range"
            defaultValue={value}
            min={comp.min ?? 0}
            max={comp.max ?? 100}
            className="w-full accent-amber-500"
          />
        </div>
      );
    }

    case "Tabs": {
      return <A2UITabsRenderer key={comp.id} comp={comp} ctx={ctx} />;
    }

    case "Modal":
    case "Video":
    case "AudioPlayer":
    case "ChoicePicker":
    case "DateTimeInput":
      // Placeholder for less common types
      return (
        <div key={comp.id} className="text-xs text-gray-400 italic p-2" style={flex}>
          [{comp.component}]
        </div>
      );

    default:
      return null;
  }
}

/** Tabs require internal state, so they're a separate React component */
function A2UITabsRenderer({ comp, ctx }: { comp: Extract<A2UIComponent, { component: "Tabs" }>; ctx: RendererCtx }) {
  const [activeIdx, setActiveIdx] = useState(0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 border-b border-gray-200/60 dark:border-[#191c28]">
        {comp.tabs.map((tab, idx) => {
          const title = resolveString(tab.title, ctx.data, ctx.scope);
          const isActive = idx === activeIdx;
          return (
            <button
              key={idx}
              onClick={() => setActiveIdx(idx)}
              className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
                isActive
                  ? "border-amber-500 text-amber-600 dark:text-amber-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {title}
            </button>
          );
        })}
      </div>
      <div>
        {comp.tabs[activeIdx] && (
          <A2UIComponentRenderer componentId={comp.tabs[activeIdx].child} ctx={ctx} />
        )}
      </div>
    </div>
  );
}

// ─── Surface renderer ─────────────────────────────────────────────

export interface A2UISurfaceRendererProps {
  surface: A2UISurface;
  onAction?: (action: { name: string; surfaceId: string; context?: Record<string, unknown> }) => void;
  className?: string;
}

export function A2UISurfaceRenderer({ surface, onAction, className }: A2UISurfaceRendererProps) {
  // Find root component (id === "root" or first component)
  const rootId = surface.rootId ?? "root";

  const ctx: RendererCtx = {
    componentMap: surface.components,
    data: surface.dataModel,
    scope: "",
    onAction,
    surfaceId: surface.surfaceId,
    theme: surface.theme,
  };

  return (
    <div className={className}>
      {surface.theme?.agentDisplayName && (
        <div className="flex items-center gap-2 mb-3">
          {surface.theme.iconUrl && (
            <Image src={surface.theme.iconUrl} className="w-5 h-5 rounded" alt="" />
          )}
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {surface.theme.agentDisplayName}
          </span>
        </div>
      )}
      <A2UIComponentRenderer componentId={rootId} ctx={ctx} />
    </div>
  );
}

// ─── Message processor ────────────────────────────────────────────

/**
 * Process an array of A2UI messages and produce surfaces.
 * This is the main entry point for consuming A2UI protocol output.
 */
export function processA2UIMessages(messages: A2UIMessage[]): Map<string, A2UISurface> {
  const surfaces = new Map<string, A2UISurface>();

  for (const msg of messages) {
    if ("createSurface" in msg) {
      const cs = msg.createSurface;
      surfaces.set(cs.surfaceId, {
        surfaceId: cs.surfaceId,
        catalogId: cs.catalogId,
        theme: cs.theme,
        components: new Map(),
        dataModel: {},
      });
    } else if ("updateComponents" in msg) {
      const uc = msg.updateComponents;
      const surface = surfaces.get(uc.surfaceId);
      if (surface) {
        for (const comp of uc.components) {
          surface.components.set(comp.id, comp);
          if (comp.id === "root") {
            surface.rootId = "root";
          }
        }
      }
    } else if ("updateDataModel" in msg) {
      const udm = msg.updateDataModel;
      const surface = surfaces.get(udm.surfaceId);
      if (surface) {
        if (!udm.path || udm.path === "/") {
          surface.dataModel = (udm.value as Record<string, unknown>) ?? {};
        } else {
          // Set value at path
          const segments = udm.path.split("/").filter(Boolean);
          let current: Record<string, unknown> = surface.dataModel;
          for (let i = 0; i < segments.length - 1; i++) {
            const seg = segments[i];
            if (!(seg in current) || typeof current[seg] !== "object") {
              current[seg] = {};
            }
            current = current[seg] as Record<string, unknown>;
          }
          const lastSeg = segments[segments.length - 1];
          if (udm.value === undefined) {
            delete current[lastSeg];
          } else {
            current[lastSeg] = udm.value;
          }
        }
      }
    } else if ("deleteSurface" in msg) {
      surfaces.delete(msg.deleteSurface.surfaceId);
    }
  }

  return surfaces;
}

// ─── Multi-surface viewer ─────────────────────────────────────────

export interface A2UIViewerProps {
  /** Raw A2UI protocol messages */
  messages: A2UIMessage[];
  /** Called when user triggers an action (button click, form submit, etc.) */
  onAction?: (action: { name: string; surfaceId: string; context?: Record<string, unknown> }) => void;
  className?: string;
}

/**
 * A2UIViewer — renders one or more A2UI surfaces from protocol messages.
 * Drop-in replacement for @copilotkit/a2ui-renderer in React contexts.
 */
export function A2UIViewer({ messages, onAction, className }: A2UIViewerProps) {
  const surfaces = React.useMemo(() => processA2UIMessages(messages), [messages]);
  const surfaceList = Array.from(surfaces.values());

  if (surfaceList.length === 0) return null;

  return (
    <div className={`space-y-4 ${className ?? ""}`}>
      {surfaceList.map((surface) => (
        <A2UISurfaceRenderer
          key={surface.surfaceId}
          surface={surface}
          onAction={onAction}
        />
      ))}
    </div>
  );
}
