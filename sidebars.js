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
          type: "doc",
          id: "platforms/index",
          label: "Platforms",
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
          id: "configuration/index",
          label: "Configuration",
        },
        {
          type: "doc",
          id: "administration/index",
          label: "Administration",
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
          id: "design-docs/execution-modes",
          label: "Execution Modes",
        },
        {
          type: "doc",
          id: "design-docs/core-beliefs",
          label: "Core Beliefs",
        },
        {
          type: "doc",
          id: "design-docs/workspace-centric-redesign",
          label: "Workspace-Centric Redesign",
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
          type: "link",
          label: "Specialists",
          href: "/specialists",
        },
        {
          type: "doc",
          id: "release-guide",
          label: "Release Guide",
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
          type: "doc",
          id: "releases/v0.14.0-release-notes",
          label: "Curated Release Notes",
        },
        {
          type: "doc",
          id: "releases/v0.14.0-changelog",
          label: "Technical Changelog",
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
