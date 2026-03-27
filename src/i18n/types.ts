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

  // Errors
  errors: {
    generic: string;
    saveFailed: string;
    loadFailed: string;
  };
}
