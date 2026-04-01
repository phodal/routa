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
    stop: string;
    saveAndClose: string;
    auto: string;
    none: string;
    active: string;
    enter: string;
    unavailable: string;
    viewAll: string;
    new: string;
    update: string;
    execute: string;
    running: string;
    completed: string;
    pending: string;
    enabled: string;
    disabled: string;
    workspace: string;
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
    crafter: string;
    multiAgentDesc: string;
    directDesc: string;
    customSpecialist: string;
    specialistMode: string;
    repoPath: string;
  };

  // Navigation & Header
  nav: {
    home: string;
    overview: string;
    kanban: string;
    team: string;
    traces: string;
    settings: string;
    notifications: string;
    connected: string;
    offline: string;
    openSidebar: string;
    closeSidebar: string;
    mcpServers: string;
    schedules: string;
    harness: string;
    fluency: string;
    workflows: string;
    specialists: string;
    debug: string;
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
    onboardingSection: {
      title: string;
      description: string;
      completed: string;
      available: string;
      showAgain: string;
    };
    harness: {
      title: string;
      shellDescription: string;
      summaryOrderLabel: string;
      summaryOrderValue: string;
      summaryFocusLabel: string;
      summaryFocusValue: string;
      pageDescription: string;
      repositoryLabel: string;
      governanceLoop: string;
      specSources: string;
      agentInstructions: string;
      repositorySignals: string;
      hookSystems: string;
      reviewTriggers: string;
      codeowners: string;
      entrixFitness: string;
      ciCd: string;
      quickNavigation: string;
      expandNavigation: string;
      collapseNavigation: string;
    };
  };

  repoPicker: {
    clearSelection: string;
  };

  providerDropdown: {
    selectProvider: string;
    openProviderSettings: string;
    quickAccess: string;
    quickAccessHint: string;
    addQuickAccessHint: string;
    noProvidersAvailable: string;
    configureOpenCode: string;
    installProvider: string;
    loadingProviders: string;
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
    // Workspace page header
    workspaceLabel: string;
    activeAgents: string;
    standby: string;
    inFlight: string;
    noPendingTasks: string;
    // Workspace page client / overview
    loadingWorkspace: string;
    defaultWorkspace: string;
    noBoard: string;
    activeBoard: string;
    noRecentSession: string;
    primarySurface: string;
    kanbanDescription: string;
    boards: string;
    activeTasks: string;
    backgroundRuns: string;
    goToBoard: string;
    latestRecoveryPoint: string;
    recoverSession: string;
    createFromLauncher: string;
    recentSessions: string;
    openLatestSession: string;
    backToLauncher: string;
    recoverContext: string;
    overview: string;
    recoveryRoutingContext: string;
    activity: string;
    activityDescription: string;
    notes: string;
    notesDescription: string;
    workspaceNotes: string;
    taskNotes: string;
    installAgents: string;
    // Workspace page header stats
    sessions: string;
    agents: string;
    tasks: string;
    bgTasks: string;
    active: string;
    pending: string;
    running: string;
    // Workspace settings tab
    linkedRepositories: string;
    linkedReposDescription: string;
    noReposLinked: string;
    addLabel: string;
    worktreeRootOverride: string;
    worktreeRootDescription: string;
    effectivePath: string;
    editRepository: string;
    selectOrCloneRepo: string;
    updatingRepository: string;
    defaultLabel: string;
    saving: string;
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
    noSkillsFound: string;
    skillCatalog: string;
    installedLabel: string;
    searchSkills: string;
    typeToSearch: string;
    installSkills: string;
    installingSkills: string;
    cloneTitle: string;
    cloneDescription: string;
    cloneAction: string;
    results: string;
    selected: string;
    load: string;
    noResults: string;
    selectRepoOrLoad: string;
    uploadTitle: string;
    uploadDescription: string;
    selectFile: string;
    uploadAction: string;
    uploading: string;
  };

  // Agents
  agents: {
    title: string;
    agentName: string;
    noAgents: string;
    loadingFromRegistry: string;
    failedToLoad: string;
    installFailed: string;
    uninstallFailed: string;
    failedToFetchRegistry: string;
    searchAgents: string;
    noMatchingAgents: string;
    noAgentsAvailable: string;
    installed: string;
    available: string;
    install: string;
    uninstall: string;
    installing: string;
    uninstalling: string;
  };

  // Tasks
  tasks: {
    title: string;
    objective: string;
    scope: string;
    definitionOfDone: string;
    subTasks: string;
    crafters: string;
    confirmAll: string;
    executeAll: string;
    executing: string;
    concurrency: string;
    thinking: string;
    agentWorking: string;
    loadingHistory: string;
    agentFailedToStart: string;
    noMessagesYet: string;
    noCraftersYet: string;
    collaborativeTasks: string;
    selectAll: string;
    deselectAll: string;
    executeSelected: string;
    noContent: string;
    execute: string;
    completed: string;
  };

  // Workflows
  workflows: {
    newWorkflow: string;
    editLabel: string;
    saving: string;
    executionFailed: string;
    selectWorkspaceFirst: string;
    workflowId: string;
    yamlContent: string;
    workflowIdHint: string;
    noWorkflows: string;
    noWorkflowsHint: string;
    loadingWorkflows: string;
    workflowGraph: string;
    noSteps: string;
    run: string;
    triggerPayload: string;
    noActiveWorkspace: string;
    workspace: string;
  };

  // Traces
  traces: {
    title: string;
    chat: string;
    eventBridge: string;
    agentTraceViewer: string;
    browseTraces: string;
    session: string;
    copyLink: string;
    hideSessions: string;
    showSessions: string;
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
    deleteFailed: string;
  };

  // Kanban
  kanban: {
    // Board header
    kanbanBoard: string;
    tasksCount: string;
    limit: string;
    runningLabel: string;
    queuedLabel: string;
    kanbanHealth: string;
    missing: string;
    sessionMismatch: string;
    backendAgents: string;
    boardSettings: string;
    // Card status
    queued: string;
    starting: string;
    live: string;
    failed: string;
    idle: string;
    syncIssue: string;
    synced: string;
    notSynced: string;
    // Card labels
    deleteTask: string;
    openCard: string;
    dragCard: string;
    liveSession: string;
    repoMissing: string;
    worktreeLoading: string;
    noObjective: string;
    automation: string;
    cardOverride: string;
    laneDefault: string;
    done: string;
    rerun: string;
    run: string;
    providerLabel: string;
    useLaneDefault: string;
    selectProviderHint: string;
    role: string;
    specialist: string;
    noArtifactsAttached: string;
    artifacts: string;
    nextReady: string;
    needs: string;
    readyFor: string;
    before: string;
    present: string;
    // Settings modal
    stageMap: string;
    stages: string;
    addStage: string;
    visible: string;
    queue: string;
    runtime: string;
    hideRuntime: string;
    sessionQueue: string;
    maxLabel: string;
    extraCardsWait: string;
    devSupervision: string;
    mode: string;
    off: string;
    watchdogRetry: string;
    ralphLoop: string;
    idleMin: string;
    retries: string;
    completion: string;
    turnComplete: string;
    completionSummary: string;
    verificationReport: string;
    manualLaneOnly: string;
    manualLane: string;
    clearAllCards: string;
    clearAllConfirm: string;
    autoFollowsGlobal: string;
    exportKanban: string;
    importKanban: string;
    exportFailed: string;
    importFailed: string;
    // Description editor
    descriptionPlaceholder: string;
    editingMarkdown: string;
    renderedMarkdown: string;
    noDescriptionYet: string;
    // Repo sync status
    syncingRepos: string;
    syncingProgress: string;
    reposUpdated: string;
    repoUpdated: string;
    // Card artifacts
    artifactsTitle: string;
    artifactsDescription: string;
    totalLabel: string;
    screenshotsLabel: string;
    readyLabel: string;
    missingLabel: string;
    nextLaneSatisfied: string;
    missingForNextMove: string;
    artifactManageHint: string;
    loadingArtifacts: string;
    noArtifactsYet: string;
    attachedScreenshot: string;
    timeUnavailable: string;
    screenshotType: string;
    testResultsType: string;
    codeDiffType: string;
    logsType: string;
    byAgent: string;
    failedToLoadArtifacts: string;
    // Card activity (residual hardcoded strings)
    acpSession: string;
    unknownProvider: string;
    unknownRole: string;
    workingDirUnavailable: string;
    currentLane: string;
    laneHandoffs: string;
    noLaneHandoffsYet: string;
    laneHandoffsDescription: string;
    requested: string;
    responded: string;
    syncedAt: string;
    linkedLabel: string;
    workspaceDefault: string;
    runLabel: string;
    openLabel: string;
    inspectLabel: string;
    backlog: string;
    baseLabel: string;
    // Settings modal extras
    saveBoardSettings: string;
    clearingAll: string;
    exportingYaml: string;
    exportYaml: string;
    importingYaml: string;
    importYaml: string;
    manualLabel: string;
    automationOn: string;
    onEntry: string;
    onExit: string;
    entryAndExit: string;
    // Kanban-tab error messages
    failedToUpdateTask: string;
    failedToDeleteTask: string;
    failedToMoveTask: string;
    failedToSaveSettings: string;
    failedToClearTasks: string;
    failedToUpdateRepo: string;
    failedToRecloneRepo: string;
    failedToRemoveRepo: string;
    failedToReplaceRepos: string;
    failedToDeleteWorktree: string;
    failedToCreateIssue: string;
    failedToRemoveWorktree: string;
    boardName: string;
    worktreeCleanupPrompt: string;
  };

  // Kanban card detail
  kanbanDetail: {
    priority: string;
    low: string;
    medium: string;
    high: string;
    urgent: string;
    column: string;
    runs: string;
    description: string;
    descriptionHint: string;
    progressNotes: string;
    progressNotesHint: string;
    testCases: string;
    testCasesHint: string;
    testCasesPlaceholder: string;
    execution: string;
    executionHint: string;
    inheritedFromLane: string;
    laneMetadataUnavailable: string;
    noLaneAutomation: string;
    lanePipeline: string;
    currentRun: string;
    nextMove: string;
    editOverride: string;
    overrideCard: string;
    repositories: string;
    repositoriesHint: string;
    noRepoLinked: string;
    sessionMismatch: string;
    sessionAligned: string;
    sessionMismatchLabel: string;
    alignedLabel: string;
    failedToSwitchRepo: string;
    failedToUpdateRepos: string;
    resetOverride: string;
  };

  // Kanban modal dialogs
  kanbanModals: {
    removeRepo: string;
    selectOrCloneRepo: string;
    updatingRepo: string;
    replaceAllHint: string;
    replaceAllRepos: string;
    path: string;
    branch: string;
    stored: string;
    sourceType: string;
    sourceUrl: string;
    worktrees: string;
    worktreeHint: string;
    noWorktrees: string;
    linkedTasks: string;
    removing: string;
    recloneRepo: string;
    recloneHint: string;
    cloning: string;
    reclone: string;
    removeRepoTitle: string;
    removeRepoConfirm: string;
    removeRepoHint: string;
    deleting: string;
    replaceAllTitle: string;
    replaceAllDesc: string;
    replaceAllUseful: string;
    replacing: string;
    replaceAll: string;
    deleteTaskTitle: string;
    deleteTaskConfirm: string;
    deleteTaskGithubNote: string;
    more: string;
  };

  // Notes tabs
  notesTab: {
    workspaceNotes: string;
    clearAll: string;
    clearing: string;
    noteTitle: string;
    writePlaceholder: string;
    creating: string;
    createNote: string;
    loadingNotes: string;
    noNotesYet: string;
    noNotesDescription: string;
    saving: string;
    // Note Tasks
    noteTasks: string;
    sourceSpecs: string;
    taskNotes: string;
    clearTaskNotes: string;
    noteId: string;
    taskRecord: string;
    parentSpec: string;
    taskSpecContent: string;
    noTaskNotesYet: string;
    noFilteredTasks: string;
    all: string;
    freeformContext: string;
    newNote: string;
    bindToSession: string;
    optional: string;
    workspaceWide: string;
    noteLabel: string;
  };

  // Background Tasks
  bgTasks: {
    title: string;
    autoRefreshOn: string;
    autoRefreshOff: string;
    live: string;
    refreshNow: string;
    clearHistory: string;
    clearAll: string;
    clearing: string;
    noTasksYet: string;
    noFilteredTasks: string;
    collapse: string;
    expand: string;
    editTask: string;
    reDispatch: string;
    retry: string;
    killRunning: string;
    triggerManually: string;
    editTitle: string;
    editPrompt: string;
    priority: string;
    agent: string;
    saveChanges: string;
    dispatchNow: string;
    dispatching: string;
    dispatchTitle: string;
    dispatchPrompt: string;
    all: string;
    manual: string;
    scheduled: string;
    webhook: string;
    polling: string;
    workflow: string;
    fleet: string;
  };

  // A2UI Overview
  a2ui: {
    agents: string;
    noAgentsSpawned: string;
    skills: string;
    surfaceTemplates: string;
    addSurfaceDescription: string;
    importCustomSurface: string;
    taskBoard: string;
    taskBoardDesc: string;
    agentMonitor: string;
    agentMonitorDesc: string;
    timeline: string;
    timelineDesc: string;
    workspaceSummary: string;
    workspaceSummaryDesc: string;
    invalidJson: string;
  };

  // Team module
  team: {
    loadingTeamRun: string;
    loadingWorkspace: string;
    runSessions: string;
    runSessionsDesc: string;
    sessionTimeline: string;
    teamMembers: string;
    noTranscriptYet: string;
    leadDecomposition: string;
    launchTeamLead: string;
    teamRuns: string;
    teamRunsHero: string;
    newRun: string;
    reusesInput: string;
    teamBench: string;
    benchDesc: string;
    runs: string;
    active: string;
    members: string;
    specialists: string;
    topLevelOnly: string;
    inspectRunDesc: string;
    noTeamRunsYet: string;
    launchAbove: string;
    directDelegates: string;
    totalSubSessions: string;
  };

  // Kanban create modal
  kanbanCreate: {
    manualTask: string;
    taskTitle: string;
    description: string;
    testCases: string;
    testCasesPlaceholder: string;
    testCasesHint: string;
    createLinkedGithubIssue: string;
    noGithubLinked: string;
    linkRepositories: string;
    noSelectionHint: string;
    create: string;
  };

  // Kanban background agents
  kanbanBgAgent: {
    backgroundAgents: string;
    bgAgentDesc: string;
    addBgAgent: string;
    workspaceAgents: string;
    activeAgents: string;
    queueRoutes: string;
    pendingTasks: string;
    noAgentsYet: string;
    noAgentsHint: string;
    observedTargets: string;
    routesCount: string;
    observedTargetsDesc: string;
    noQueueActivity: string;
    scheduleTriggers: string;
    linked: string;
    external: string;
    all: string;
    pending: string;
    running: string;
    finished: string;
    latestTask: string;
    noRecentTask: string;
    workspaceBgAgents: string;
    activeHotRoutes: string;
    noTaskRouted: string;
    addBgAgentTitle: string;
    addBgAgentDesc: string;
    agentName: string;
    agentNamePlaceholder: string;
    role: string;
    modelTier: string;
    creating: string;
    createAgent: string;
  };

  // Kanban board surface
  kanbanBoard: {
    repos: string;
    noReposLinked: string;
    cards: string;
    manualLane: string;
    manualLaneOnly: string;
  };

  // Sessions
  sessions: {
    title: string;
    noSessions: string;
    rename: string;
    hierarchy: string;
    parent: string;
    sibling: string;
    child: string;
    focus: string;
    kanbanStory: string;
    previousLane: string;
    previousRunInLane: string;
    currentLaneSession: string;
    openSession: string;
    open: string;
  };

  // MCP Servers
  mcp: {
    title: string;
    description: string;
    newServer: string;
    editServer: string;
    noServers: string;
    addFirst: string;
    serverType: string;
    command: string;
    arguments: string;
    url: string;
    headers: string;
    envVars: string;
    builtInDesc: string;
    requiresPostgres: string;
    deleteFailed: string;
    toggleFailed: string;
    deleteConfirm: string;
  };

  // Models
  models: {
    title: string;
    addModel: string;
    alias: string;
    modelName: string;
    baseUrl: string;
    apiKey: string;
    savedModels: string;
    pressEnterToAdd: string;
    aliasAlreadyExists: string;
    deleteConfirm: string;
    aliasDescription: string;
  };

  // Schedules
  schedules: {
    title: string;
    noSchedules: string;
    addFirst: string;
    newSchedule: string;
    editSchedule: string;
    scheduleName: string;
    cronExpression: string;
    customCron: string;
    taskPrompt: string;
    agent: string;
    lastRun: string;
    nextRun: string;
    runNow: string;
    deleteConfirm: string;
    selectWorkspace: string;
    requiredFields: string;
    created: string;
    updated: string;
    deleted: string;
    triggered: string;
    configured: string;
    noSchedulesTitle: string;
    noSchedulesDesc: string;
    createFirst: string;
    schedule: string;
    selectAgent: string;
    promptTip: string;
    promptTemplateOverride: string;
    promptTemplateHint: string;
    last: string;
    next: string;
  };

  // Trace
  trace: {
    agentTrace: string;
    refresh: string;
    export: string;
    noTracesForSession: string;
    selectSessionToView: string;
    sessionStarted: string;
    sessionEnded: string;
    totalRecords: string;
    sessions: string;
    days: string;
    currentLaneSession: string;
    previousLaneSession: string;
    previousLaneRun: string;
    eventBridgeView: string;
    events: string;
    noMatchingEvents: string;
    noTracesSession: string;
    protocolView: string;
    rawEvents: string;
    noAGUIEvents: string;
    selectSessionAGUI: string;
    selectSessionEventBridge: string;
  };
}
