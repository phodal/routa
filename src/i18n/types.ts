export type Locale = "en" | "zh";

export const SUPPORTED_LOCALES: Locale[] = ["en", "zh"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "routa.locale";

export interface TranslationDictionary {
  // Common
  common: {
    save: string;
    cancel: string;
    close: string;
    create: string;
    delete: string;
    edit: string;
    add: string;
    remove: string;
    refresh: string;
    loading: string;
    search: string;
    confirm: string;
    back: string;
    next: string;
    submit: string;
    retry: string;
    dismiss: string;
    upload: string;
    download: string;
    export: string;
    import: string;
    clone: string;
    send: string;
    auto: string;
    none: string;
    active: string;
    enter: string;
    unavailable: string;
    viewAll: string;
  };

  // Home page
  home: {
    subtitle: string;
    minimalHome: string;
    workspaceCount: string;
    runtimeReady: string;
    runtimeOffline: string;
    heroTitle: string;
    heroDescription: string;
    composer: string;
    currentWorkspace: string;
    switchWorkspace: string;
    workspaceOverview: string;
    openKanban: string;
    newWorkspace: string;
    loadingWorkspaces: string;
    inputPlaceholder: string;
    sendHint: string;
    multiAgent: string;
    direct: string;
    multiAgentDesc: string;
    directDesc: string;
    customSpecialist: string;
    specialistMode: string;
    repoPath: string;
  };

  // Navigation & Header
  nav: {
    kanban: string;
    settings: string;
    notifications: string;
    connected: string;
    offline: string;
    openSidebar: string;
    closeSidebar: string;
  };

  // Settings panel
  settings: {
    title: string;
    preferences: string;
    config: string;
    backToApp: string;
    workspaceTools: string;
    standaloneTool: string;
    focusedConfigDescription: string;
    theme: string;
    light: string;
    dark: string;
    system: string;
    providers: string;
    roles: string;
    specialists: string;
    models: string;
    mcpServers: string;
    webhooks: string;
    schedules: string;
    workflows: string;
    roleDefaults: string;
    roleDefaultsDesc: string;
    providersDesc: string;
    registryDesc: string;
    rolesDesc: string;
    modelsDesc: string;
    webhooksDesc: string;
    provider: string;
    modelOverride: string;
    builtIn: string;
    custom: string;
    registry: string;
    systemInfo: string;
    memory: string;
    sessions: string;
    refreshSystemInfo: string;
    language: string;
  };

  // Role descriptions
  roles: {
    routa: string;
    crafter: string;
    gate: string;
    developer: string;
  };

  // Workspace
  workspace: {
    selectWorkspace: string;
    select: string;
    noWorkspacesYet: string;
    newWorkspace: string;
    workspaceName: string;
    workspaces: string;
    currentLabel: string;
    recentActivity: string;
    noRecentSessions: string;
  };

  // Notifications
  notifications: {
    title: string;
    markAllRead: string;
    viewAll: string;
    empty: string;
  };

  // Story guide (home page sections)
  story: {
    productFlow: string;
    scrollSurfaces: string;
    intentCapture: string;
    intentCaptureTitle: string;
    intentCaptureBody: string;
    parallelRouting: string;
    parallelRoutingTitle: string;
    parallelRoutingBody: string;
    operationalView: string;
    operationalViewTitle: string;
    operationalViewBody: string;
    traceReview: string;
    traceReviewTitle: string;
    traceReviewBody: string;
    runtimeOnline: string;
    runtimeOffline: string;
    activeModules: string;
    skills: string;
    liveTasks: string;
    noActiveTasks: string;
  };

  // Onboarding
  onboarding: {
    title: string;
    createWorkspace: string;
    description: string;
    getStarted: string;
    checklistTitle: string;
    checklistDescription: string;
    workspaceNameLabel: string;
    workspaceNamePlaceholder: string;
    openProviders: string;
    nextSteps: string;
    providerTitle: string;
    providerDescription: string;
    providerAction: string;
    providerReady: string;
    codebaseTitle: string;
    codebaseDescription: string;
    codebaseAction: string;
    codebaseReady: string;
    modeTitle: string;
    modeDescription: string;
    modeReady: string;
    modeRoutaTitle: string;
    modeRoutaDescription: string;
    modeCrafterTitle: string;
    modeCrafterDescription: string;
    continueLater: string;
    completed: string;
    pending: string;
  };

  // Skills
  skills: {
    searchPlaceholder: string;
    catalog: string;
    cloneSkills: string;
    uploadSkill: string;
    reload: string;
    browseCatalog: string;
    cloneFromGithub: string;
    uploadZip: string;
    cloneFailed: string;
    uploadFailed: string;
  };

  // Agents
  agents: {
    loadingFromRegistry: string;
    failedToLoad: string;
    installFailed: string;
    uninstallFailed: string;
    failedToFetchRegistry: string;
  };

  // Tasks
  tasks: {
    objective: string;
    scope: string;
    definitionOfDone: string;
    title: string;
  };

  // Workflows
  workflows: {
    newWorkflow: string;
    editLabel: string;
    saving: string;
    executionFailed: string;
    selectWorkspaceFirst: string;
  };

  // Traces
  traces: {
    title: string;
    chat: string;
    eventBridge: string;
  };

  // Fitness / Fluency
  fitness: {
    panel: {
      genericReport: string;
      repoLabel: string;
      blockers: string;
      failed: string;
      fit: string;
      to: string;
      noData: string;
      refresh: string;
      genericProfile: string;
      orchestratorProfile: string;
      noReport: string;
      runFirstReport: string;
      rerunReport: string;
      runningReport: string;
      reportSourceLive: string;
      reportSourceSnapshot: string;
      reportSourceNone: string;
      noContext: string;
      noContextReport: string;
      notReady: string;
      capabilityMatrix: string;
      matrixNoPoint: string;
      statusIdle: string;
      statusLoading: string;
      statusReady: string;
      statusEmpty: string;
      statusError: string;
      fetchSnapshotFailed: string;
      analyzeFailedPrefix: string;
      noAnalyzeResponse: string;
      noWorkspaceSelected: string;
      noWorkspaceAction: string;
    };

    matrix: {
      collaboration: {
        title: string[];
        subtitle: string;
      };
      sdlc: {
        title: string[];
        subtitle: string;
      };
      harness: {
        title: string[];
        subtitle: string;
      };
      governance: {
        title: string[];
        subtitle: string;
      };
      context: {
        title: string[];
        subtitle: string;
      };
      awareness: {
        title: string[];
        subtitle: string;
      };
      assistedCoding: {
        title: string[];
        subtitle: string;
      };
      structuredAiCoding: {
        title: string[];
        subtitle: string;
      };
      agentCentric: {
        title: string[];
        subtitle: string;
      };
      agentFirst: {
        title: string[];
        subtitle: string;
      };
      noReport: string;
      noPointData: string;
    };

    overview: {
      noDimensionData: string;
      currentFindings: string;
      recommendedActions: string;
      withoutThis: string;
      noActiveBlockers: string;
      noActions: string;
      noProfileRecommendations: string;
      noComparisonHint: string;
      noDimensionChanges: string;
      noCriteriaChanges: string;
      dimensionChangesTitle: string;
      criteriaChangesTitle: string;
      levelLabel: string;
      scoreLabel: string;
      failsLabel: string;
      weightedChecks: string;
      examplesLabel: string;
      startFromLabel: string;
      noFailures: string;
      critical: string;
      fromLast: string;
      lastOverall: string;
      currentOverall: string;
      directionUp: string;
      directionDown: string;
      directionSame: string;
      cellsDivider: string;
      failingCriteriaLabel: string;
      criticalBlockersLabel: string;
      noReportTextLoading: string;
      noReportTextNotReady: string;
      noProfileErrorText: string;
      noReportForProfileText: string;
    };

    measures: {
      governance: {
        title: string;
        subtitle: string;
        body: string;
        without: string;
        examples: string[];
      };
      harness: {
        title: string;
        subtitle: string;
        body: string;
        without: string;
        examples: string[];
      };
      context: {
        title: string;
        subtitle: string;
        body: string;
        without: string;
        examples: string[];
      };
      sdlc: {
        title: string;
        subtitle: string;
        body: string;
        without: string;
        examples: string[];
      };
      collaboration: {
        title: string;
        subtitle: string;
        body: string;
        without: string;
        examples: string[];
      };
    };

    status: {
      noData: string;
      notReady: string;
      critical: string;
      priorityFix: string;
    };

    scoring: {
      title: string;
      sourceFromReport: string;
      sourceFromRun: string;
      sourceOffline: string;
      noReadinessInfo: string;
      levelUnlockPrefix: string;
      levelUnlockSuffix: string;
      noLevelUnlock: string;
      compareEnabled: string;
      compareDisabled: string;
      deterministicMode: string;
      nonDeterministicMode: string;
      fromUnknown: string;
    };

    action: {
      running: string;
      noAction: string;
      unknownProfile: string;
      noSnapshots: string;
      analyzeFailed: string;
    };

    levels: {
      awareness: string;
      assistedCoding: string;
      structuredCoding: string;
      agentCentric: string;
      agentFirst: string;
      waitingReport: string;
    };

    dashboard: {
      noReport: string;
      overallReadiness: string;
      nextUnlock: string;
      hardBlockers: string;
      passRate: string;
      currentLevelHint: string;
      targetLevelHint: string;
      hardBlockersHint: string;
      passRateHint: string;
      targetVsCurrent: string;
      targetVsCurrentHint: string;
      currentLegend: string;
      targetLegend: string;
      unlockRunway: string;
      unlockRunwayHint: string;
      currentLevelBar: string;
      nextLevelBar: string;
      noNextLevel: string;
      gateStatus: string;
      gateStatusHint: string;
      gatePass: string;
      gateWarn: string;
      gateFail: string;
      noBlockers: string;
      heatmap: string;
      heatmapHint: string;
      fromLastRun: string;
      changedDimensions: string;
      changedCriteria: string;
      noHistory: string;
      notAvailable: string;
    };
  };

  // Errors
  errors: {
    generic: string;
    saveFailed: string;
    loadFailed: string;
  };
}
