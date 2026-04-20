"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { OnboardingMode } from "@/client/utils/onboarding";
import { useTranslation } from "@/i18n";
import { ChevronDown, Columns2, Plus, SquareArrowOutUpRight, Folder, MessageSquareMore } from "lucide-react";

const ONBOARDING_GITHUB_PLACEHOLDER = "https://github.com/phodal/routa";

interface FeaturedSkill {
  name: string;
  description: string;
}

interface StoryGuideRailProps {
  activeKanbanHref: string;
  activeWorkspaceHref: string;
  activeWorkspaceTitle: string | null;
  connected: boolean;
  featuredSkills: FeaturedSkill[];
  skillCount: number;
  workspaceCounter: string;
}

const storySteps = [
  {
    id: "brief",
    index: "01",
    label: "Intent Capture",
    title: "Start with the requirement, not a dashboard.",
    body:
      "The composer stays first. Repo scope, workspace context, and agent selection stay attached to the prompt so the task begins where the thinking happens.",
    note: "This is the entry surface. Everything else should feel downstream of it.",
  },
  {
    id: "route",
    index: "02",
    label: "Parallel Routing",
    title: "Let orchestration fan out without changing surfaces.",
    body:
      "Routa can spin specialized agents, keep the execution graph visible, and turn a single brief into coordinated work without forcing the user into setup screens.",
    note: "The moment after send should feel like controlled expansion, not a context switch.",
  },
  {
    id: "operate",
    index: "03",
    label: "Operational View",
    title: "Boards become live operations, not the homepage.",
    body:
      "Once the run is moving, Kanban and workspace views act like telemetry layers. They show pressure, ownership, and throughput after launch instead of before it.",
    note: "This is where active tasks, priorities, and recent sessions come back into view.",
  },
  {
    id: "inspect",
    index: "04",
    label: "Trace Review",
    title: "End in evidence: logs, artifacts, and verification.",
    body:
      "The deepest layer is traceability. Session history, execution output, and artifacts should read like a clean audit trail rather than raw terminal noise.",
    note: "Users should always be able to answer what happened, who did it, and what changed.",
  },
] as const;

export function ConnectionDot({ connected }: { connected: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5" title={connected ? t.nav.connected : t.nav.offline}>
      <span className={`h-1.5 w-1.5 rounded-full ring-4 transition-colors ${connected ? "bg-emerald-500 ring-emerald-500/10" : "bg-amber-400 ring-amber-400/10"}`} />
      <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#577090] dark:text-slate-500">
        {connected ? t.nav.connected : t.nav.offline}
      </span>
    </div>
  );
}

export function StoryGuideRail({
  activeKanbanHref,
  activeWorkspaceHref,
  activeWorkspaceTitle,
  connected,
  featuredSkills,
  skillCount,
  workspaceCounter,
}: StoryGuideRailProps) {
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    const steps = stepRefs.current.filter((node): node is HTMLElement => node !== null);
    if (steps.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

        if (!visible) return;
        const index = Number(visible.target.getAttribute("data-step-index"));
        if (Number.isFinite(index)) {
          setActiveStep(index);
        }
      },
      {
        rootMargin: "-18% 0px -30% 0px",
        threshold: [0.3, 0.45, 0.6, 0.75],
      },
    );

    steps.forEach((step) => observer.observe(step));
    return () => observer.disconnect();
  }, []);

  const currentStep = storySteps[activeStep] ?? storySteps[0];

  return (
    <section className="relative overflow-hidden rounded-[34px] border border-sky-200/70 bg-[linear-gradient(180deg,rgba(250,253,255,0.96),rgba(233,241,252,0.94))] p-4 shadow-[0_52px_120px_-80px_rgba(8,34,78,0.28)] sm:p-6 dark:border-[#1b2b44] dark:bg-[linear-gradient(180deg,rgba(5,10,20,0.98),rgba(7,13,24,0.98))]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.14),_transparent_34%),radial-gradient(circle_at_85%_10%,_rgba(37,99,235,0.14),_transparent_32%)]" />
      </div>

      <div className="relative">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#3868aa] dark:text-sky-300/80">
              Product Flow
            </div>
            <h2 className="mt-3 font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-[2.25rem] font-semibold leading-[0.92] tracking-[-0.05em] text-[#081120] dark:text-white sm:text-[3rem]">
              Scroll the surfaces in order.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-[#4d6689] dark:text-slate-300">
              This section is the homepage narrative layer: sticky preview on the left, long-form explanation on the right. It borrows the rhythm from
              {" "}
              factory-style product sites without turning Routa into a marketing-only page.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em] text-[#54729b] dark:text-slate-400">
            <span className="rounded-full border border-sky-200/70 bg-white/65 px-3 py-1.5 dark:border-white/10 dark:bg-white/5">
              Sticky preview
            </span>
            <span className="rounded-full border border-sky-200/70 bg-white/65 px-3 py-1.5 dark:border-white/10 dark:bg-white/5">
              Step-by-step scroll
            </span>
            <span className="rounded-full border border-sky-200/70 bg-white/65 px-3 py-1.5 dark:border-white/10 dark:bg-white/5">
              Live product framing
            </span>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.98fr)_minmax(0,1fr)] lg:gap-10">
          <div className="lg:sticky lg:top-8 lg:self-start">
            <StoryPreview
              activeKanbanHref={activeKanbanHref}
              activeWorkspaceHref={activeWorkspaceHref}
              activeWorkspaceTitle={activeWorkspaceTitle}
              connected={connected}
              currentStep={currentStep}
              featuredSkills={featuredSkills}
              skillCount={skillCount}
              workspaceCounter={workspaceCounter}
            />
          </div>

          <div className="space-y-7">
            {storySteps.map((step, index) => {
              const isActive = index === activeStep;
              return (
                <article
                  key={step.id}
                  ref={(node) => {
                    stepRefs.current[index] = node;
                  }}
                  data-step-index={index}
                  className="flex min-h-[48vh] items-center lg:min-h-[58vh]"
                >
                  <div className={`max-w-2xl rounded-[30px] border px-5 py-6 transition-all duration-500 sm:px-7 sm:py-8 ${
                    isActive
                      ? "border-[#7cccf6]/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(239,247,255,0.92))] shadow-[0_44px_120px_-82px_rgba(14,64,151,0.42)] dark:border-sky-400/30 dark:bg-[linear-gradient(180deg,rgba(11,20,35,0.98),rgba(10,17,30,0.98))]"
                      : "border-sky-200/60 bg-white/56 dark:border-white/8 dark:bg-white/[0.025]"
                  }`}>
                    <div className="flex items-start gap-4">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border text-sm font-semibold ${
                        isActive
                          ? "border-sky-300/80 bg-sky-100/75 text-[#1d6fd6] dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200"
                          : "border-sky-200/70 bg-white/75 text-[#5f7ea8] dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
                      }`}>
                        {step.index}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#4f74a1] dark:text-slate-400">
                          {step.label}
                        </div>
                        <h3 className="mt-3 text-[1.7rem] font-semibold leading-[1.02] tracking-[-0.04em] text-[#081120] dark:text-white sm:text-[2.2rem]">
                          {step.title}
                        </h3>
                        <p className="mt-4 text-sm leading-8 text-[#4d6689] dark:text-slate-300 sm:text-[15px]">
                          {step.body}
                        </p>
                        <div className="mt-6 rounded-[24px] border border-dashed border-sky-200/80 bg-white/55 px-4 py-3 text-sm leading-6 text-[#5d79a1] dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                          {step.note}
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function StoryPreview({
  activeKanbanHref,
  activeWorkspaceHref,
  activeWorkspaceTitle,
  connected,
  currentStep,
  featuredSkills,
  skillCount,
  workspaceCounter,
}: StoryGuideRailProps & { currentStep: (typeof storySteps)[number] }) {
  return (
    <div className="relative overflow-hidden rounded-[32px] border border-[#1f3354] bg-[linear-gradient(180deg,#07111f,#0b1630)] p-4 text-white shadow-[0_50px_120px_-80px_rgba(2,8,23,0.9)] sm:p-5">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),_transparent_28%),radial-gradient(circle_at_85%_12%,_rgba(59,130,246,0.18),_transparent_34%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(125,211,252,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(125,211,252,0.08)_1px,transparent_1px)] bg-[size:56px_56px] opacity-25" />
        <div className="home-scan absolute left-[-30%] top-24 h-px w-[52%] bg-gradient-to-r from-transparent via-sky-200/75 to-transparent" />
      </div>

      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-200/70">
              Live Surface
            </div>
            <div className="mt-2 text-[1.35rem] font-semibold tracking-[-0.03em] text-white">
              {currentStep.index}. {currentStep.label}
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] ${
            connected ? "bg-emerald-500/12 text-emerald-200" : "bg-amber-500/12 text-amber-200"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-300"}`} />
            {connected ? "Runtime Online" : "Runtime Offline"}
          </span>
        </div>

        <div className="mt-5">
          {currentStep.id === "brief" && (
            <ComposerSurface
              activeWorkspaceTitle={activeWorkspaceTitle}
              skillCount={skillCount}
              workspaceCounter={workspaceCounter}
            />
          )}
          {currentStep.id === "route" && (
            <RoutingSurface activeWorkspaceTitle={activeWorkspaceTitle} />
          )}
          {currentStep.id === "operate" && (
            <BoardSurface activeWorkspaceTitle={activeWorkspaceTitle} />
          )}
          {currentStep.id === "inspect" && (
            <TraceSurface activeWorkspaceTitle={activeWorkspaceTitle} />
          )}
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Link
            href={activeWorkspaceHref}
            className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/[0.04] px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-200 transition-colors hover:bg-white/[0.08]"
          >
            Open Workspace
          </Link>
          <Link
            href={activeKanbanHref}
            className="inline-flex items-center justify-center rounded-full bg-[#5ee5ff] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#04111d] transition-colors hover:bg-[#87edff]"
          >
            Open Kanban
          </Link>
        </div>

        <div className="mt-5 rounded-[24px] border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              Active Modules
            </div>
            <div className="font-mono text-xs text-slate-500">
              {String(skillCount).padStart(2, "0")} skills
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {featuredSkills.length > 0 ? (
              featuredSkills.slice(0, 3).map((skill, index) => (
                <div key={skill.name} className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-sky-400/20 bg-sky-400/10 text-[10px] font-semibold text-sky-200">
                      0{index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-white">
                        /{skill.name}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-400">
                        {skill.description}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm leading-6 text-slate-400">
                Connect skills to make the routing layer context-aware.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ComposerSurface({
  activeWorkspaceTitle,
  skillCount,
  workspaceCounter,
}: {
  activeWorkspaceTitle: string | null;
  skillCount: number;
  workspaceCounter: string;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-[#071223]/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
        <span className="h-2 w-2 rounded-full bg-sky-300" />
        Mission composer
      </div>
      <div className="mt-4 rounded-[22px] border border-sky-400/16 bg-[linear-gradient(180deg,rgba(14,25,45,0.94),rgba(8,17,32,0.98))] p-4">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-sky-400/18 bg-sky-400/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-sky-200">
            Multi-agent
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-300">
            {activeWorkspaceTitle ?? "Workspace"} scoped
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-300">
            {String(skillCount).padStart(2, "0")} inline skills
          </span>
        </div>
        <div className="mt-4 space-y-2.5">
          <div className="h-2.5 w-[72%] rounded-full bg-slate-600/80" />
          <div className="h-2.5 w-full rounded-full bg-slate-700/80" />
          <div className="h-2.5 w-[84%] rounded-full bg-slate-700/70" />
          <div className="h-2.5 w-[48%] rounded-full bg-sky-300/55" />
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <SurfaceMetric label="Workspaces" value={workspaceCounter} />
          <SurfaceMetric label="Context" value="Repo bound" />
          <SurfaceMetric label="Launch" value="Ready" />
        </div>
      </div>
    </div>
  );
}

function RoutingSurface({ activeWorkspaceTitle }: { activeWorkspaceTitle: string | null }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-[#071223]/80 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
          Agent fan-out
        </div>
        <div className="rounded-full border border-emerald-400/16 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-200">
          3 lanes active
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          { title: "Planner", detail: "Breaks task graph", state: "Queued" },
          { title: "Crafter", detail: "Applies code changes", state: "Running" },
          { title: "Gate", detail: "Verifies outputs", state: "Ready" },
        ].map((lane, index) => (
          <div key={lane.title} className="rounded-[22px] border border-white/8 bg-white/[0.04] p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">0{index + 1}</span>
              <span className={`h-2 w-2 rounded-full ${lane.state === "Running" ? "bg-sky-300" : lane.state === "Queued" ? "bg-amber-300" : "bg-emerald-300"}`} />
            </div>
            <div className="mt-4 text-sm font-medium text-white">
              {lane.title}
            </div>
            <div className="mt-1 text-[11px] leading-5 text-slate-400">
              {lane.detail}
            </div>
            <div className="mt-5 h-1.5 rounded-full bg-white/6">
              <div className={`h-full rounded-full ${lane.state === "Running" ? "w-[68%] bg-sky-300" : lane.state === "Queued" ? "w-[34%] bg-amber-300" : "w-[88%] bg-emerald-300"}`} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-[20px] border border-dashed border-white/10 px-3 py-3 text-[11px] leading-6 text-slate-400">
        Routing remains anchored to
        {" "}
        <span className="text-sky-200">{activeWorkspaceTitle ?? "the selected workspace"}</span>
        {" "}
        so branching work still resolves back into one operating lane.
      </div>
    </div>
  );
}

function BoardSurface({ activeWorkspaceTitle }: { activeWorkspaceTitle: string | null }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-[#071223]/80 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
            Work in motion
          </div>
          <div className="mt-1 text-sm font-medium text-white">
            {activeWorkspaceTitle ?? "Current workspace"}
          </div>
        </div>
        <div className="rounded-full border border-sky-400/16 bg-sky-400/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-sky-200">
          Kanban telemetry
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          {
            title: "Backlog",
            cards: ["Issue drafting", "Spec handoff"],
          },
          {
            title: "Dev",
            cards: ["Home redesign", "Session UX pass"],
          },
          {
            title: "Review",
            cards: ["API contract check", "Visual QA"],
          },
        ].map((column) => (
          <div key={column.title} className="rounded-[22px] border border-white/8 bg-white/[0.04] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              {column.title}
            </div>
            <div className="mt-3 space-y-2">
              {column.cards.map((card) => (
                <div key={card} className="rounded-2xl border border-white/7 bg-white/[0.05] px-3 py-2.5">
                  <div className="text-[11px] leading-5 text-slate-200">
                    {card}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TraceSurface({ activeWorkspaceTitle }: { activeWorkspaceTitle: string | null }) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
      <div className="rounded-[28px] border border-white/10 bg-[#071223]/80 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
            Session trace
          </div>
          <div className="font-mono text-[11px] text-slate-500">
            {activeWorkspaceTitle ?? "workspace"} / latest
          </div>
        </div>
        <div className="mt-4 rounded-[22px] border border-white/8 bg-[#030814] px-3 py-3 font-mono text-[11px] leading-6 text-slate-300">
          <div className="text-sky-200">$ routa launch --verify</div>
          <div className="mt-2 text-slate-500">[planner] build task graph from homepage brief</div>
          <div className="text-slate-500">[crafter] apply UI composition changes</div>
          <div className="text-slate-500">[gate] lint, test, contract parity</div>
          <div className="mt-3 text-emerald-300">[done] evidence bundle attached to session timeline</div>
        </div>
      </div>
      <div className="rounded-[28px] border border-white/10 bg-[#071223]/80 p-4">
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
          Evidence
        </div>
        <div className="mt-4 space-y-2">
          {["Logs", "Artifacts", "Checks"].map((item) => (
            <div key={item} className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3 text-[11px] uppercase tracking-[0.16em] text-slate-200">
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SurfaceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-white/[0.04] px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-white">
        {value}
      </div>
    </div>
  );
}

export function HomeTodoPreview({
  workspaceId,
  workspaceTitle,
  refreshKey,
}: {
  workspaceId: string | null;
  workspaceTitle: string | null;
  refreshKey: number;
}) {
  const [tasks, setTasks] = useState<HomeTaskInfo[]>([]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    const controller = new AbortController();

    const fetchTasks = async () => {
      try {
        const res = await desktopAwareFetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        const nextTasks = Array.isArray(data?.tasks) ? (data.tasks as HomeTaskInfo[]) : [];
        setTasks(
          nextTasks
            .filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status))
            .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
            .slice(0, 4),
        );
      } catch {
        if (controller.signal.aborted) return;
        setTasks([]);
      }
    };

    void fetchTasks();
    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  if (!workspaceId) {
    return null;
  }

  return (
    <section className="rounded-[30px] border border-sky-200/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(240,247,255,0.74))] p-4 shadow-[0_38px_100px_-70px_rgba(15,40,90,0.24)] dark:border-[#1b2b44] dark:bg-[linear-gradient(180deg,rgba(7,12,21,0.96),rgba(9,15,26,0.98))] sm:p-6">
      <div className="mb-5 flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#45678f] dark:text-slate-400">
            <Columns2 className="h-4 w-4 text-[#1d6fd6] dark:text-sky-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            Live Tasks
          </div>
          <div className="mt-2 font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-[2.2rem] font-semibold tracking-[-0.05em] text-[#081120] dark:text-white">
            {workspaceTitle ?? "Current workspace"}
          </div>
          <div className="mt-1 max-w-xl text-sm leading-7 text-[#577090] dark:text-slate-300">
            Once the story above explains the product flow, this card brings you back to the real queue that is already moving.
          </div>
        </div>
        <Link
          href={`/workspace/${workspaceId}/kanban`}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#0f62d6] px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-[#2a77e4] sm:w-auto dark:bg-[#5ee5ff] dark:text-[#04111d] dark:hover:bg-[#87edff]"
        >
          Open Kanban
        </Link>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-sky-200/80 bg-white/52 p-6 dark:border-[#223049] dark:bg-white/[0.03]">
          <div className="max-w-md">
            <div className="text-sm font-medium text-[#081120] dark:text-white">
              No active tasks yet
            </div>
            <div className="mt-2 text-sm leading-6 text-[#577090] dark:text-slate-400">
              Start a new session from the composer above, or open the full board to inspect the current workflow.
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tasks.map((task) => (
            <Link
              key={task.id}
              href={`/workspace/${workspaceId}/kanban`}
              className="group rounded-[24px] border border-sky-200/70 bg-white/62 px-4 py-4 transition-all hover:-translate-y-0.5 hover:border-[#38bdf8] hover:bg-white hover:shadow-[0_20px_50px_-36px_rgba(37,99,235,0.28)] dark:border-[#1f2434] dark:bg-white/[0.03] dark:hover:border-sky-700/40 dark:hover:bg-[#111827]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[#081120] transition-colors group-hover:text-[#1d6fd6] dark:text-white dark:group-hover:text-sky-300">
                    {task.title}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-[#5b77a0] dark:text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#1d6fd6]" />
                      {(task.columnId ?? "backlog").toUpperCase()}
                    </span>
                    <span>·</span>
                    <span>{task.assignedProvider ?? "unassigned"}</span>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-sky-50 px-2.5 py-1 text-[10px] uppercase tracking-wide text-[#45678f] dark:bg-[#1c2233] dark:text-slate-300">
                  {task.priority ?? "medium"}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-sky-100 pt-3 text-[10px] uppercase tracking-[0.2em] text-[#6d87ad] dark:border-white/6 dark:text-slate-500">
                <span>Live task</span>
                <span>Open in board</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function OnboardingCard({
  hasWorkspace,
  workspaceTitle,
  hasProviderConfig,
  hasCodebase,
  availableProviderNames,
  preferredMode,
  onCreateWorkspace,
  onOpenProviders,
  onAddCodebase,
  onSelectMode,
  onDismiss,
}: {
  hasWorkspace: boolean;
  workspaceTitle?: string | null;
  hasProviderConfig: boolean;
  hasCodebase: boolean;
  availableProviderNames: string[];
  preferredMode: OnboardingMode | null;
  onCreateWorkspace: (title: string) => Promise<boolean>;
  onOpenProviders: () => void;
  onAddCodebase: (selection: RepoSelection) => Promise<boolean>;
  onSelectMode: (mode: OnboardingMode) => void;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const [workspaceName, setWorkspaceName] = useState("My Workspace");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [repoSelection, setRepoSelection] = useState<RepoSelection | null>(null);
  const [codebaseBusy, setCodebaseBusy] = useState(false);
  const [codebaseError, setCodebaseError] = useState<string | null>(null);

  const completeCount = Number(hasProviderConfig) + Number(hasCodebase) + Number(preferredMode !== null);
  const selectedModeLabel =
    preferredMode === "SESSION"
      ? t.onboarding.modeSessionTitle
      : preferredMode === "KANBAN"
        ? t.onboarding.modeKanbanTitle
        : preferredMode === "TEAM"
          ? t.onboarding.modeTeamTitle
          : null;

  const handleWorkspaceCreate = async () => {
    const title = workspaceName.trim();
    if (!title || workspaceBusy) {
      return;
    }

    setWorkspaceBusy(true);
    setWorkspaceError(null);
    const created = await onCreateWorkspace(title);
    if (!created) {
      setWorkspaceError(t.errors.saveFailed);
    }
    setWorkspaceBusy(false);
  };

  const handleAddCodebase = async () => {
    if (!repoSelection || codebaseBusy) {
      return;
    }

    setCodebaseBusy(true);
    setCodebaseError(null);
    const created = await onAddCodebase(repoSelection);
    if (!created) {
      setCodebaseError(t.errors.saveFailed);
    } else {
      setRepoSelection(null);
    }
    setCodebaseBusy(false);
  };

  if (!hasWorkspace) {
    return (
      <div className="w-full max-w-xl rounded-[32px] border border-sky-200/75 bg-[linear-gradient(180deg,rgba(250,253,255,0.96),rgba(237,244,255,0.92))] px-8 py-10 shadow-[0_36px_100px_-60px_rgba(37,99,235,0.28)] dark:border-[#223049] dark:bg-[linear-gradient(180deg,rgba(10,15,26,0.98),rgba(12,18,30,0.95))]">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-[#0f62d6] to-[#38bdf8] shadow-lg shadow-sky-500/20">
          <Folder className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        </div>
        <h2 className="mb-1.5 text-center font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-[2rem] font-semibold tracking-[-0.05em] text-slate-900 dark:text-white">
          {t.onboarding.title}
        </h2>
        <p className="mb-6 text-center text-sm leading-7 text-[#577090] dark:text-slate-400">
          {t.onboarding.description}
        </p>
        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#45678f] dark:text-slate-500">
          {t.onboarding.workspaceNameLabel}
        </label>
        <input
          type="text"
          value={workspaceName}
          onChange={(event) => setWorkspaceName(event.target.value)}
          placeholder={t.onboarding.workspaceNamePlaceholder}
          className="w-full rounded-2xl border border-sky-200/80 bg-white/90 px-4 py-3 text-sm text-slate-900 shadow-[0_18px_50px_-44px_rgba(37,99,235,0.4)] outline-none transition-colors focus:border-sky-400 dark:border-[#223049] dark:bg-[#0d1728] dark:text-white"
        />
        {workspaceError && (
          <p className="mt-2 text-sm text-rose-600 dark:text-rose-300">{workspaceError}</p>
        )}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => void handleWorkspaceCreate()}
            disabled={workspaceBusy || !workspaceName.trim()}
            className="rounded-full bg-[#0f62d6] px-6 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] text-white transition-all hover:bg-[#2a77e4] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#5ee5ff] dark:text-[#04111d] dark:hover:bg-[#87edff]"
          >
            {workspaceBusy ? t.common.loading : t.onboarding.getStarted}
          </button>
          <button
            type="button"
            onClick={onOpenProviders}
            className="rounded-full border border-sky-200/80 px-6 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] text-[#356fb0] transition-colors hover:border-sky-300 hover:text-[#0f62d6] dark:border-[#223049] dark:text-slate-300 dark:hover:border-[#314665] dark:hover:text-white"
          >
            {t.onboarding.openProviders}
          </button>
        </div>
        <div className="mt-6 rounded-[24px] border border-sky-100/90 bg-white/70 px-4 py-4 dark:border-white/8 dark:bg-white/[0.03]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#45678f] dark:text-slate-500">
            {t.onboarding.nextSteps}
          </div>
          <div className="mt-3 grid gap-2 text-sm text-[#577090] dark:text-slate-400">
            <p>01. {t.onboarding.providerDescription}</p>
            <p>02. {t.onboarding.codebaseDescription}</p>
            <p>03. {t.onboarding.modeDescription}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-[30px] border border-sky-200/75 bg-[linear-gradient(180deg,rgba(250,253,255,0.97),rgba(238,245,255,0.94))] p-5 shadow-[0_40px_100px_-72px_rgba(37,99,235,0.4)] dark:border-[#223049] dark:bg-[linear-gradient(180deg,rgba(9,14,24,0.98),rgba(11,18,31,0.96))] sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#356fb0] dark:text-slate-500">
            {t.onboarding.checklistTitle}
          </div>
          <h2 className="mt-2 font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-[2rem] font-semibold tracking-[-0.05em] text-slate-900 dark:text-white">
            {workspaceTitle ?? t.onboarding.createWorkspace}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[#577090] dark:text-slate-400">
            {t.onboarding.checklistDescription}
          </p>
        </div>
        <div className="rounded-full border border-sky-200/80 bg-white/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#45678f] dark:border-white/8 dark:bg-white/[0.04] dark:text-slate-400">
          {completeCount}/3 {t.onboarding.completed}
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-3">
        <div className="rounded-[24px] border border-sky-100/90 bg-white/82 p-4 dark:border-white/8 dark:bg-white/[0.03]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{t.onboarding.providerTitle}</div>
              <p className="mt-1 text-sm leading-6 text-[#577090] dark:text-slate-400">{t.onboarding.providerDescription}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${hasProviderConfig ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/12 dark:text-amber-300"}`}>
              {hasProviderConfig ? t.onboarding.completed : t.onboarding.pending}
            </span>
          </div>
          {hasProviderConfig ? (
            <div className="mt-4">
              {availableProviderNames.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {availableProviderNames.map((providerName) => (
                    <span
                      key={providerName}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/8 dark:text-emerald-300"
                    >
                      {providerName}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3 py-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/8 dark:text-emerald-300">
                  {t.onboarding.providerReady}
                </div>
              )}
              <button
                type="button"
                onClick={onOpenProviders}
                className="mt-3 text-xs font-medium text-[#356fb0] transition-colors hover:text-[#0f62d6] dark:text-slate-300 dark:hover:text-white"
              >
                {t.onboarding.openProviders}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenProviders}
              className="mt-4 rounded-full border border-sky-200/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#356fb0] transition-colors hover:border-sky-300 hover:text-[#0f62d6] dark:border-[#223049] dark:text-slate-300 dark:hover:border-[#314665] dark:hover:text-white"
            >
              {t.onboarding.providerAction}
            </button>
          )}
        </div>

        <div className="rounded-[24px] border border-sky-100/90 bg-white/82 p-4 dark:border-white/8 dark:bg-white/[0.03]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{t.onboarding.codebaseTitle}</div>
              <p className="mt-1 text-sm leading-6 text-[#577090] dark:text-slate-400">{t.onboarding.codebaseDescription}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${hasCodebase ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/12 dark:text-amber-300"}`}>
              {hasCodebase ? t.onboarding.completed : t.onboarding.pending}
            </span>
          </div>
          {hasCodebase ? (
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3 py-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/8 dark:text-emerald-300">
              {t.onboarding.codebaseReady}
            </div>
          ) : (
            <>
              <div className="mt-4">
                <RepoPicker
                  value={repoSelection}
                  onChange={setRepoSelection}
                  pathDisplay="below-muted"
                  clonePlaceholder={ONBOARDING_GITHUB_PLACEHOLDER}
                />
              </div>
              {codebaseError && (
                <p className="mt-2 text-sm text-rose-600 dark:text-rose-300">{codebaseError}</p>
              )}
              <button
                type="button"
                onClick={() => void handleAddCodebase()}
                disabled={!repoSelection?.path || codebaseBusy}
                className="mt-4 rounded-full bg-[#0f62d6] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-[#2a77e4] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#5ee5ff] dark:text-[#04111d] dark:hover:bg-[#87edff]"
              >
                {codebaseBusy ? t.common.loading : t.onboarding.codebaseAction}
              </button>
            </>
          )}
        </div>

        <div className="rounded-[24px] border border-sky-100/90 bg-white/82 p-4 dark:border-white/8 dark:bg-white/[0.03]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{t.onboarding.modeTitle}</div>
              <p className="mt-1 text-sm leading-6 text-[#577090] dark:text-slate-400">{t.onboarding.modeDescription}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${preferredMode ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/12 dark:text-amber-300"}`}>
              {preferredMode ? t.onboarding.completed : t.onboarding.pending}
            </span>
          </div>
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={() => onSelectMode("SESSION")}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors ${preferredMode === "SESSION" ? "border-blue-400 bg-blue-50 dark:border-blue-500/50 dark:bg-blue-500/10" : "border-sky-100 hover:border-sky-300 dark:border-white/8 dark:hover:border-[#314665]"}`}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{t.onboarding.modeSessionTitle}</div>
              <p className="mt-1 text-sm leading-6 text-[#577090] dark:text-slate-400">{t.onboarding.modeSessionDescription}</p>
            </button>
            <button
              type="button"
              onClick={() => onSelectMode("KANBAN")}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors ${preferredMode === "KANBAN" ? "border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10" : "border-sky-100 hover:border-sky-300 dark:border-white/8 dark:hover:border-[#314665]"}`}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{t.onboarding.modeKanbanTitle}</div>
              <p className="mt-1 text-sm leading-6 text-[#577090] dark:text-slate-400">{t.onboarding.modeKanbanDescription}</p>
            </button>
            <button
              type="button"
              onClick={() => onSelectMode("TEAM")}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors ${preferredMode === "TEAM" ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500/50 dark:bg-emerald-500/10" : "border-sky-100 hover:border-sky-300 dark:border-white/8 dark:hover:border-[#314665]"}`}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{t.onboarding.modeTeamTitle}</div>
              <p className="mt-1 text-sm leading-6 text-[#577090] dark:text-slate-400">{t.onboarding.modeTeamDescription}</p>
            </button>
          </div>
          {selectedModeLabel && (
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3 py-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/8 dark:text-emerald-300">
              {t.onboarding.modeReady}: {selectedModeLabel}
            </div>
          )}
        </div>
      </div>

      {onDismiss && (
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full border border-transparent px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b84aa] transition-colors hover:border-sky-200/80 hover:text-[#356fb0] dark:text-slate-500 dark:hover:border-white/8 dark:hover:text-slate-300"
          >
            {t.onboarding.continueLater}
          </button>
        </div>
      )}
    </section>
  );
}

interface SessionInfo {
  sessionId: string;
  name?: string;
  provider?: string;
  role?: string;
  createdAt: string;
}

interface WorkspaceCardSession {
  sessionId: string;
  displayName: string;
  createdAt: string;
}

interface HomeTaskInfo {
  id: string;
  title: string;
  status: string;
  priority?: string;
  columnId?: string;
  assignedProvider?: string;
  createdAt: string;
}

interface WorkspaceCardData {
  id: string;
  title: string;
  updatedAt: string;
  recentSessions: WorkspaceCardSession[] | [];
}

export function WorkspaceCards({
  workspaceId,
  refreshKey,
  onWorkspaceSelect,
  onWorkspaceCreate,
  onSessionClick,
  showWorkspacesMenu,
  setShowWorkspacesMenu,
  workspacesMenuRef,
}: {
  workspaceId: string | null;
  refreshKey: number;
  onWorkspaceSelect: (id: string) => void;
  onWorkspaceCreate: (title: string) => void;
  onSessionClick: (workspaceId: string, sessionId: string) => void;
  showWorkspacesMenu: boolean;
  setShowWorkspacesMenu: (v: boolean) => void;
  workspacesMenuRef: RefObject<HTMLDivElement | null>;
}) {
  const workspacesHook = useWorkspaces();
  const [cardData, setCardData] = useState<WorkspaceCardData[]>([]);
  const [renderTimestamp] = useState(() => Date.now());

  const formatTime = (dateStr: string) => {
    const diffMs = renderTimestamp - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const getDisplayName = (session: SessionInfo) => {
    if (session.name) return session.name;
    if (session.provider && session.role) return `${session.provider} · ${session.role.toLowerCase()}`;
    if (session.provider) return session.provider;
    return `Session ${session.sessionId.slice(0, 6)}`;
  };

  useEffect(() => {
    const fetchAll = async () => {
      const workspaces = workspacesHook.workspaces;
      if (workspaces.length === 0) return;

      const cards: WorkspaceCardData[] = await Promise.all(
        workspaces.slice(0, 9).map(async (workspace) => {
          try {
            const res = await desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(workspace.id)}&limit=3`, {
              cache: "no-store",
            });
            const data = await res.json();
            const sessions: SessionInfo[] = Array.isArray(data?.sessions) ? data.sessions : [];
            const recentSessions: WorkspaceCardSession[] = sessions.slice(0, 3).map((session) => ({
              sessionId: session.sessionId,
              displayName: getDisplayName(session),
              createdAt: session.createdAt,
            }));
            return {
              id: workspace.id,
              title: workspace.title,
              updatedAt: workspace.updatedAt,
              recentSessions,
            };
          } catch {
            return {
              id: workspace.id,
              title: workspace.title,
              updatedAt: workspace.updatedAt,
              recentSessions: [],
            };
          }
        }),
      );

      cards.sort((left, right) => {
        const leftDate = left.recentSessions[0]?.createdAt ?? left.updatedAt;
        const rightDate = right.recentSessions[0]?.createdAt ?? right.updatedAt;
        return new Date(rightDate).getTime() - new Date(leftDate).getTime();
      });

      setCardData(cards);
    };

    void fetchAll();
  }, [refreshKey, workspacesHook.workspaces]);

  if (workspacesHook.loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-[30px] border border-sky-200/75 bg-white/90 dark:border-[#223049] dark:bg-[#10131b]/95">
        <span className="text-sm text-slate-400 dark:text-slate-500">Loading…</span>
      </div>
    );
  }

  const sortedCards = [...cardData]
    .sort((left, right) => {
      if (left.id === workspaceId) return -1;
      if (right.id === workspaceId) return 1;
      return 0;
    })
    .slice(0, 5);

  return (
    <section className="rounded-[30px] border border-sky-200/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(240,247,255,0.74))] p-4 shadow-[0_38px_100px_-70px_rgba(15,40,90,0.22)] dark:border-[#1b2b44] dark:bg-[linear-gradient(180deg,rgba(7,12,21,0.96),rgba(9,15,26,0.98))] sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-[#45678f] dark:text-slate-400">
            Workspaces
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-7 text-[#577090] dark:text-slate-300">
            Keep each workspace close by, with overview access and recent session recovery visible but secondary to the main launcher flow.
          </p>
        </div>
        <div className="relative" ref={workspacesMenuRef}>
          <button
            onClick={() => setShowWorkspacesMenu(!showWorkspacesMenu)}
            className="inline-flex items-center gap-1 rounded-full border border-sky-200/70 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-[#45678f] transition-colors hover:border-sky-300 hover:text-[#081120] dark:border-[#2a3042] dark:text-slate-400 dark:hover:border-[#39415a] dark:hover:text-slate-200"
          >
            View all
            <ChevronDown className={`h-2.5 w-2.5 transition-transform ${showWorkspacesMenu ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
          {showWorkspacesMenu && (
            <div className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-2xl border border-sky-200/70 bg-white py-1 shadow-lg dark:border-[#1c1f2e] dark:bg-[#12141c]">
              <Link
                href="/"
                onClick={() => setShowWorkspacesMenu(false)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-[#1a1d2c]"
              >
                <Folder className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                All Workspaces
              </Link>
              <Link
                href="/traces"
                onClick={() => setShowWorkspacesMenu(false)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-[#1a1d2c]"
              >
                <MessageSquareMore className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                All Sessions
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {sortedCards.map((workspace) => {
          const isActive = workspace.id === workspaceId;
          return (
            <button
              key={workspace.id}
              onClick={() => onWorkspaceSelect(workspace.id)}
              className={`group rounded-[22px] border px-4 py-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_20px_50px_-36px_rgba(37,99,235,0.26)] ${
                isActive
                  ? "border-sky-300 bg-sky-50/90 dark:border-sky-700/50 dark:bg-sky-900/10"
                  : "border-sky-200/70 bg-white/52 dark:border-[#1c1f2e] dark:bg-white/[0.03] hover:border-sky-300 dark:hover:border-sky-700/40"
              }`}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full transition-colors ${isActive ? "bg-sky-500" : "bg-emerald-500 group-hover:bg-sky-400"}`} />
                    {isActive && (
                      <span className="inline-flex rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-sky-700 dark:bg-sky-950/70 dark:text-sky-200">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="mt-2 truncate text-sm font-medium leading-tight text-[#081120] dark:text-slate-200">
                    {workspace.title}
                  </div>
                  <div className="mt-1 text-[11px] text-[#577090] dark:text-slate-500">
                    {workspace.recentSessions.length > 0 ? "Recent session activity" : "No recent sessions yet"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    href={`/workspace/${workspace.id}/kanban`}
                    onClick={(event) => event.stopPropagation()}
                    className="rounded-full border border-transparent p-1 text-[#1d6fd6] opacity-0 transition-opacity hover:border-sky-100 hover:text-[#38bdf8] group-hover:opacity-100 dark:text-sky-500 dark:hover:border-sky-900/30 dark:hover:text-sky-300"
                    title="Open Kanban board"
                  >
                    <Columns2 className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                  </Link>
                  <Link
                    href={`/workspace/${workspace.id}/overview`}
                    onClick={(event) => event.stopPropagation()}
                    className="rounded-full border border-transparent p-1 text-slate-400 opacity-0 transition-opacity hover:border-slate-200 hover:text-slate-600 group-hover:opacity-100 dark:hover:border-[#2a3042] dark:hover:text-slate-300"
                    title="Open overview"
                  >
                    <SquareArrowOutUpRight className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                  </Link>
                </div>
              </div>

              {workspace.recentSessions.length > 0 ? (
                <div className="space-y-2">
                  {workspace.recentSessions.slice(0, 2).map((session) => (
                    <div
                      key={session.sessionId}
                      className="flex cursor-pointer items-center gap-2 rounded-xl bg-white/72 px-3 py-2 dark:bg-[#131722]"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSessionClick(workspace.id, session.sessionId);
                      }}
                    >
                      <MessageSquareMore className="h-3.5 w-3.5 shrink-0 text-[#1d6fd6] dark:text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                      <span className="flex-1 truncate text-[11px] text-[#577090] transition-colors hover:text-[#081120] dark:text-slate-400 dark:hover:text-slate-200">
                        {session.displayName}
                      </span>
                      <span className="shrink-0 text-[9px] font-mono text-[#89a0c4] dark:text-slate-600">
                        {formatTime(session.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-[11px] italic text-slate-300 dark:text-slate-600">No sessions yet</span>
              )}
            </button>
          );
        })}

        <button
          onClick={() => onWorkspaceCreate("New Workspace")}
          className="group rounded-[22px] border border-dashed border-sky-200/70 p-4 text-left transition-all hover:border-[#38bdf8] hover:bg-white/70 dark:border-[#1c1f2e] dark:hover:border-sky-700/50 dark:hover:bg-sky-900/5"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 transition-colors group-hover:bg-sky-100 dark:bg-[#1a1d2c] dark:group-hover:bg-sky-900/30">
              <Plus className="h-4 w-4 text-sky-500 transition-colors group-hover:text-sky-700 dark:text-slate-500 dark:group-hover:text-sky-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            </span>
            <div>
              <div className="text-sm font-medium text-[#081120] transition-colors group-hover:text-[#1d6fd6] dark:text-slate-300 dark:group-hover:text-sky-300">
                New workspace
              </div>
              <div className="mt-1 text-[11px] text-[#577090] dark:text-slate-500">
                Add another lane without leaving the homepage.
              </div>
            </div>
          </div>
        </button>
      </div>
    </section>
  );
}
