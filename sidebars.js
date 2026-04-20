/** @type {import("@docusaurus/plugin-content-docs").SidebarsConfig} */
module.exports = {
  docsSidebar: [
    {
      type: "category",
      label: "Getting Started",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "getting-started/index",
          label: "Overview",
        },
        {
          type: "doc",
          id: "quick-start",
          label: "Quick Start",
        },
        {
          type: "category",
          label: "Platforms",
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "platforms/index",
              label: "Overview",
            },
            {
              type: "doc",
              id: "platforms/desktop",
              label: "Desktop",
            },
            {
              type: "doc",
              id: "platforms/cli",
              label: "CLI",
            },
            {
              type: "doc",
              id: "platforms/web",
              label: "Web",
            },
          ],
        },
        {
          type: "doc",
          id: "core-concepts/index",
          label: "Core Concepts",
        },
        {
          type: "doc",
          id: "core-concepts/how-routa-works",
          label: "How Routa Works",
        },
        {
          type: "doc",
          id: "getting-started/changelog",
          label: "Changelog",
        },
      ],
    },
    {
      type: "category",
      label: "Use Routa",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "use-routa/index",
          label: "Overview",
        },
        {
          type: "doc",
          id: "use-routa/sessions",
          label: "Sessions",
        },
        {
          type: "doc",
          id: "use-routa/kanban",
          label: "Kanban",
        },
        {
          type: "doc",
          id: "use-routa/team",
          label: "Team",
        },
        {
          type: "doc",
          id: "use-routa/common-workflows",
          label: "Common Workflows",
        },
        {
          type: "doc",
          id: "use-routa/best-practices",
          label: "Best Practices",
        },
      ],
    },
    {
      type: "category",
      label: "Configuration",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "configuration/index",
          label: "Overview",
        },
        {
          type: "doc",
          id: "configuration/providers-and-models",
          label: "Providers & Models",
        },
        {
          type: "doc",
          id: "configuration/environment-variables",
          label: "Environment Variables",
        },
      ],
    },
    {
      type: "category",
      label: "Features",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "features/architecture-quality",
          label: "Architecture Quality",
        },
        {
          type: "doc",
          id: "features/harness-trace-learning",
          label: "Harness Trace Learning",
        },
        {
          type: "doc",
          id: "features/disabled-providers",
          label: "Disabled Providers",
        },
        {
          type: "doc",
          id: "features/i18n-implementation",
          label: "i18n Implementation",
        },
        {
          type: "doc",
          id: "features/i18n-quick-reference",
          label: "i18n Quick Reference",
        },
      ],
    },
    {
      type: "category",
      label: "Developer Guide",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "developer-guide/index",
          label: "Overview",
        },
        {
          type: "doc",
          id: "developer-guide/project-structure",
          label: "Project Structure",
        },
        {
          type: "doc",
          id: "ARCHITECTURE",
          label: "Architecture",
        },
        {
          type: "doc",
          id: "developer-guide/testing",
          label: "Testing",
        },
        {
          type: "doc",
          id: "developer-guide/contributing",
          label: "Contributing",
        },
        {
          type: "doc",
          id: "developer-guide/git-workflow",
          label: "Git Workflow",
        },
        {
          type: "doc",
          id: "developer-guide/local-overlay-sync",
          label: "Local Overlay Sync",
        },
        {
          type: "doc",
          id: "coding-style",
          label: "Coding Style",
        },
      ],
    },
    {
      type: "category",
      label: "Administration",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "administration/index",
          label: "Overview",
        },
        {
          type: "doc",
          id: "administration/self-hosting",
          label: "Self-Hosting",
        },
        {
          type: "doc",
          id: "deployment/index",
          label: "Deployment",
        },
      ],
    },
    {
      type: "category",
      label: "Design Docs",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "design-docs/index",
          label: "Overview",
        },
        {
          type: "doc",
          id: "design-docs/core-beliefs",
          label: "Core Beliefs",
        },
        {
          type: "doc",
          id: "design-docs/golden-rules",
          label: "Golden Rules",
        },
        {
          type: "doc",
          id: "design-docs/execution-modes",
          label: "Execution Modes",
        },
        {
          type: "doc",
          id: "design-docs/workspace-centric-redesign",
          label: "Workspace-Centric Redesign",
        },
        {
          type: "doc",
          id: "design-docs/agentwatch-tui",
          label: "AgentWatch TUI",
        },
        {
          type: "doc",
          id: "design-docs/architecture-rule-dsl",
          label: "Architecture Rule DSL",
        },
        {
          type: "doc",
          id: "design-docs/product-ia-visualization",
          label: "Product IA Visualization",
        },
        {
          type: "category",
          label: "Safety Mechanisms",
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "design-docs/file-deletion-safety-mechanism",
              label: "File Deletion Safety",
            },
            {
              type: "doc",
              id: "design-docs/git-commit-safety-mechanism",
              label: "Git Commit Safety",
            },
          ],
        },
        {
          type: "doc",
          id: "design-docs/harness-trace-learning-phase2",
          label: "Harness Trace Learning Phase 2",
        },
        {
          type: "doc",
          id: "adr/README",
          label: "Architecture Decision Records",
        },
      ],
    },
    {
      type: "category",
      label: "Guides",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "guides/harness-trace-learning-guide",
          label: "Harness Trace Learning",
        },
        {
          type: "doc",
          id: "quick-reference/harness-trace-learning-cheatsheet",
          label: "Trace Learning Cheatsheet",
        },
      ],
    },
    {
      type: "category",
      label: "Reference",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "reference/index",
          label: "Overview",
        },
        {
          type: "doc",
          id: "product-specs/FEATURE_TREE",
          label: "Product Specs",
        },
        {
          type: "doc",
          id: "release-guide",
          label: "Release Guide (Maintainer)",
        },
        {
          type: "doc",
          id: "reference/resources",
          label: "Resources",
        },
      ],
    },
    {
      type: "category",
      label: "What's New",
      collapsible: false,
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "whats-new/index",
          label: "Overview",
        },
        {
          type: "category",
          label: "v0.17.0",
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "releases/v0.17.0-release-notes",
              label: "Release Notes",
            },
            {
              type: "doc",
              id: "releases/v0.17.0-changelog",
              label: "Technical Changelog",
            },
          ],
        },
        {
          type: "category",
          label: "v0.14.0",
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "releases/v0.14.0-release-notes",
              label: "Release Notes",
            },
            {
              type: "doc",
              id: "releases/v0.14.0-changelog",
              label: "Technical Changelog",
            },
          ],
        },
        {
          type: "category",
          label: "Earlier Releases",
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "releases/v0.2.7-release-notes",
              label: "v0.2.7 Release Notes",
            },
            {
              type: "doc",
              id: "releases/v0.2.5-release-notes",
              label: "v0.2.5 Release Notes",
            },
          ],
        },
        {
          type: "link",
          label: "Blog",
          href: "/blog",
        },
      ],
    },
  ],
};
