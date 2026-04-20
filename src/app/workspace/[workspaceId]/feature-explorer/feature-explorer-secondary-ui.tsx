"use client";

import { type ComponentProps } from "react";

import { ChatPanel } from "@/client/components/chat-panel";
import type { RepoSelection } from "@/client/components/repo-picker";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { useTranslation } from "@/i18n";

import {
  AnalysisSessionDrawer,
  ContextPanel,
  SessionAnalysisDrawer,
} from "./feature-explorer-inspector-panels";
import { GenerateFeatureTreeDrawer } from "./generate-feature-tree-drawer";
import type {
  AggregatedSelectionSession,
  FeatureDetail,
} from "./types";
import type { ExplorerSurfaceItem } from "./surface-navigation";

type TranslationT = ReturnType<typeof useTranslation>["t"];

export function FeatureExplorerInspectorPane({
  featureDetail,
  selectedFileCount,
  selectedScopeSessions,
  selectedSurface,
  selectedSurfaceFeatureNames,
  onOpenSessionAnalysis,
  t,
}: {
  featureDetail: FeatureDetail | null;
  selectedFileCount: number;
  selectedScopeSessions: AggregatedSelectionSession[];
  selectedSurface: ExplorerSurfaceItem | null;
  selectedSurfaceFeatureNames: string[];
  onOpenSessionAnalysis: () => void;
  t: TranslationT;
}) {
  return (
    <aside className="flex min-h-0 flex-col bg-desktop-bg-secondary/10">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ContextPanel
          featureDetail={featureDetail}
          selectedFileCount={selectedFileCount}
          selectedScopeSessions={selectedScopeSessions}
          selectedSurface={selectedSurface}
          selectedSurfaceFeatureNames={selectedSurfaceFeatureNames}
          onOpenSessionAnalysis={onOpenSessionAnalysis}
          t={t}
        />
      </div>
    </aside>
  );
}

export function FeatureExplorerDrawers({
  workspaceId,
  repoPath,
  repoSelection,
  codebases,
  generateOpen,
  onCloseGenerate,
  onGenerated,
  sessionAnalysisDrawerKey,
  sessionAnalysisOpen,
  selectedFilePaths,
  selectedScopeSessions,
  providers,
  selectedProvider,
  onProviderChange,
  isStartingSessionAnalysis,
  sessionAnalysisError,
  onCloseSessionAnalysis,
  onStartSessionAnalysis,
  analysisSessionPaneOpen,
  analysisSessionId,
  analysisSessionName,
  analysisSessionProviderName,
  analysisSessionProviderId,
  fallbackSelectedProvider,
  onCloseAnalysisSessionPane,
  acp,
  onEnsureAnalysisSession,
  onSelectAnalysisSession,
  t,
}: {
  workspaceId: string;
  repoPath?: string;
  repoSelection: RepoSelection | null;
  codebases: CodebaseData[];
  generateOpen: boolean;
  onCloseGenerate: () => void;
  onGenerated: () => void;
  sessionAnalysisDrawerKey: string;
  sessionAnalysisOpen: boolean;
  selectedFilePaths: string[];
  selectedScopeSessions: AggregatedSelectionSession[];
  providers: ComponentProps<typeof SessionAnalysisDrawer>["providers"];
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
  isStartingSessionAnalysis: boolean;
  sessionAnalysisError: string | null;
  onCloseSessionAnalysis: () => void;
  onStartSessionAnalysis: (sessions?: AggregatedSelectionSession[]) => Promise<void>;
  analysisSessionPaneOpen: boolean;
  analysisSessionId: string | null;
  analysisSessionName: string;
  analysisSessionProviderName: string;
  analysisSessionProviderId: string;
  fallbackSelectedProvider: string;
  onCloseAnalysisSessionPane: () => void;
  acp: ComponentProps<typeof ChatPanel>["acp"];
  onEnsureAnalysisSession: () => Promise<string | null>;
  onSelectAnalysisSession: (sessionId: string) => Promise<void>;
  t: TranslationT;
}) {
  return (
    <>
      <GenerateFeatureTreeDrawer
        open={generateOpen}
        workspaceId={workspaceId}
        repoPath={repoPath}
        repoSelection={repoSelection}
        codebases={codebases}
        onClose={onCloseGenerate}
        onGenerated={onGenerated}
      />

      <SessionAnalysisDrawer
        key={sessionAnalysisDrawerKey}
        open={sessionAnalysisOpen}
        selectedFilePaths={selectedFilePaths}
        selectedScopeSessions={selectedScopeSessions}
        providers={providers}
        selectedProvider={selectedProvider}
        onProviderChange={onProviderChange}
        isStartingSessionAnalysis={isStartingSessionAnalysis}
        sessionAnalysisError={sessionAnalysisError}
        onClose={onCloseSessionAnalysis}
        onStartSessionAnalysis={onStartSessionAnalysis}
        t={t}
      />

      <AnalysisSessionDrawer
        open={analysisSessionPaneOpen && Boolean(analysisSessionId)}
        title={analysisSessionName || t.featureExplorer.sessionAnalysisTitle}
        subtitle={`${analysisSessionProviderName || analysisSessionProviderId || fallbackSelectedProvider} · ${analysisSessionId ?? ""}`}
        detailHref={analysisSessionId
          ? `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(analysisSessionId)}`
          : undefined}
        onClose={onCloseAnalysisSessionPane}
        t={t}
      >
        {analysisSessionId ? (
          <ChatPanel
            acp={acp}
            activeSessionId={analysisSessionId}
            onEnsureSession={onEnsureAnalysisSession}
            onSelectSession={onSelectAnalysisSession}
            repoSelection={repoSelection}
            onRepoChange={() => {}}
            codebases={codebases}
            activeWorkspaceId={workspaceId}
            agentRole="ROUTA"
          />
        ) : null}
      </AnalysisSessionDrawer>
    </>
  );
}
