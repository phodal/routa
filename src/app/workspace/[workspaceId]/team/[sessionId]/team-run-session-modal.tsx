"use client";

import Link from "next/link";
import { ChatPanel } from "@/client/components/chat-panel";
import { OverlayModal } from "../../ui-components";
import type { SessionStreamSummary } from "./team-run-page-model";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";

interface TeamRunSessionModalProps {
  workspaceId: string;
  selectedSessionForModal: string;
  selectedSessionStream: SessionStreamSummary;
  sessionStreams: SessionStreamSummary[];
  modalAcp: UseAcpState & UseAcpActions;
  openLabel: string;
  noTranscriptLabel: string;
  sessionStreamsLabel: string;
  title: string;
  onClose: () => void;
  onSelectSession: (nextSessionId: string) => void;
}

export function TeamRunSessionModal({
  workspaceId,
  selectedSessionForModal,
  selectedSessionStream,
  sessionStreams,
  modalAcp,
  openLabel,
  noTranscriptLabel,
  sessionStreamsLabel,
  title,
  onClose,
  onSelectSession,
}: TeamRunSessionModalProps) {
  return (
    <OverlayModal onClose={onClose} title={title}>
      <div className="flex h-full min-h-0 bg-desktop-bg-primary">
        <div className="flex w-80 shrink-0 flex-col border-r border-desktop-border bg-desktop-bg-secondary">
          <div className="border-b border-desktop-border px-4 py-3">
            <div className="text-sm font-semibold text-desktop-text-primary">{sessionStreamsLabel}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-2">
              {sessionStreams.map((stream) => {
                const active = stream.session.sessionId === selectedSessionForModal;
                return (
                  <button
                    key={stream.session.sessionId}
                    type="button"
                    onClick={() => onSelectSession(stream.session.sessionId)}
                    className={`w-full rounded-2xl border p-3 text-left transition ${
                      active
                        ? "border-cyan-300 bg-cyan-50/80 dark:border-cyan-800 dark:bg-cyan-950/20"
                        : "border-desktop-border bg-desktop-bg-primary hover:border-cyan-300 hover:bg-desktop-bg-active/80"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-desktop-text-primary">{stream.actor}</div>
                        <div className="mt-1 truncate text-[11px] text-desktop-text-secondary">
                          {stream.session.name ?? stream.session.sessionId}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full border border-desktop-border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-desktop-text-secondary">
                        {stream.badge}
                      </span>
                    </div>
                    <div className="mt-3 line-clamp-3 text-xs leading-5 text-desktop-text-secondary">
                      {stream.preview ?? noTranscriptLabel}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <div className="border-b border-desktop-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-desktop-text-secondary">
              <span>{selectedSessionStream.session.name ?? selectedSessionStream.session.sessionId}</span>
              <span className="opacity-40">/</span>
              <span>{selectedSessionStream.badge}</span>
              <span className="opacity-40">/</span>
              <span>{selectedSessionStream.lastUpdatedLabel}</span>
              <span className="opacity-40">/</span>
              <Link
                href={`/workspace/${workspaceId}/sessions/${selectedSessionStream.session.sessionId}`}
                className="text-cyan-600 transition hover:text-cyan-500"
              >
                {openLabel}
              </Link>
            </div>
          </div>
          <div className="h-[calc(80vh-89px)]">
            <ChatPanel
              acp={modalAcp}
              activeSessionId={selectedSessionForModal}
              onEnsureSession={async () => selectedSessionForModal}
              onSelectSession={async (nextSessionId) => {
                onSelectSession(nextSessionId);
              }}
              repoSelection={null}
              onRepoChange={() => {}}
              activeWorkspaceId={workspaceId}
              agentRole={selectedSessionStream.session.role}
            />
          </div>
        </div>
      </div>
    </OverlayModal>
  );
}
