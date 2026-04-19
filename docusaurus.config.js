/** @type {import("@docusaurus/types").Config} */
module.exports = {
  title: "Routa",
  tagline: "Workspace-first multi-agent coordination for real software delivery",
  url: "https://phodal.github.io",
  baseUrl: "/routa/",
  organizationName: "phodal",
  projectName: "routa",
  trailingSlash: false,
  favicon: "favicon.ico",
  staticDirectories: ["public"],
  onBrokenLinks: "warn",
  markdown: {
    format: "detect",
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },
  plugins: [
    [
      require.resolve("@easyops-cn/docusaurus-search-local"),
      {
        hashed: true,
        language: ["en"],
        docsRouteBasePath: "/",
        docsDir: "docs",
        blogDir: "docs/blog",
        blogRouteBasePath: "/blog",
        indexBlog: true,
        searchBarShortcutHint: false,
        searchResultLimits: 8,
      },
    ],
  ],
  presets: [
    [
      "@docusaurus/preset-classic",
      {
        docs: {
          path: "docs",
          routeBasePath: "/",
          sidebarPath: "./sidebars.js",
          exclude: [
            "**/issues/**",
            "**/blog/**",
            "**/fitness/**",
            "**/bdd/**",
            "**/exec-plans/**",
            "**/harness/**",
            "**/operational/**",
            "**/copilot-fs-base-agent/**",
            "**/references/**",
            "**/RELEASE_CHECKLIST.md",
            "**/RELEASE_SETUP.md",
            "**/ARCHITECTURE_QUALITY_GUIDE.md",
            "**/REFACTOR.md",
          ],
        },
        blog: {
          path: "./docs/blog",
          routeBasePath: "/blog",
          showReadingTime: false,
          postsPerPage: 5,
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      },
    ],
  ],

  themeConfig: {
    image: "logo-symbol.svg",
    colorMode: {
      respectPrefersColorScheme: true,
    },
    announcementBar: {
      id: "routa-docs",
      content:
        'Routa — workspace-first AI agent coordination across ACP, MCP, A2A &amp; AG-UI.',
      isCloseable: true,
    },
    navbar: {
      title: "Routa",
      logo: {
        alt: "Routa logo",
        src: "logo-symbol.svg",
        srcDark: "logo-symbol-dark.svg",
      },
      items: [
        {
          type: "doc",
          docId: "quick-start",
          label: "Quick Start",
          position: "left",
        },
        {
          type: "doc",
          docId: "use-routa/index",
          label: "Use Routa",
          position: "left",
        },
        {
          type: "dropdown",
          label: "Developer Guide",
          position: "left",
          items: [
            {
              type: "doc",
              docId: "developer-guide/index",
              label: "Overview",
            },
            {
              type: "doc",
              docId: "configuration/index",
              label: "Configuration",
            },
            {
              type: "doc",
              docId: "administration/index",
              label: "Administration",
            },
            {
              type: "doc",
              docId: "developer-guide/project-structure",
              label: "Project Structure",
            },
            {
              type: "doc",
              docId: "ARCHITECTURE",
              label: "Architecture",
            },
            {
              type: "doc",
              docId: "developer-guide/testing",
              label: "Testing",
            },
            {
              type: "doc",
              docId: "developer-guide/contributing",
              label: "Contributing",
            },
            {
              type: "doc",
              docId: "deployment/index",
              label: "Deployment",
            },
          ],
        },
        {
          type: "doc",
          docId: "design-docs/index",
          label: "Design Docs",
          position: "left",
        },
        {
          type: "doc",
          docId: "whats-new/index",
          label: "What's New",
          position: "left",
        },
        {
          to: "/blog",
          label: "Blog",
          position: "left",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Getting Started",
          items: [
            {
              label: "Overview",
              to: "/",
            },
            {
              label: "Quick Start",
              to: "/quick-start",
            },
            {
              label: "Desktop Releases",
              href: "https://github.com/phodal/routa/releases",
            },
            {
              label: "CLI Package",
              href: "https://www.npmjs.com/package/routa-cli",
            },
            {
              label: "Platforms",
              to: "/platforms",
            },
            {
              label: "Core Concepts",
              to: "/core-concepts",
            },
            {
              label: "Configuration",
              to: "/configuration",
            },
            {
              label: "What's New",
              to: "/whats-new",
            },
          ],
        },
        {
          title: "Use Routa",
          items: [
            {
              label: "Overview",
              to: "/use-routa",
            },
            {
              label: "Sessions",
              to: "/use-routa/sessions",
            },
            {
              label: "Kanban",
              to: "/use-routa/kanban",
            },
            {
              label: "Team",
              to: "/use-routa/team",
            },
            {
              label: "Common Workflows",
              to: "/use-routa/common-workflows",
            },
          ],
        },
        {
          title: "Build And Run",
          items: [
            {
              label: "Developer Guide",
              to: "/developer-guide",
            },
            {
              label: "Configuration",
              to: "/configuration",
            },
            {
              label: "Administration",
              to: "/administration",
            },
            {
              label: "Design Docs",
              to: "/design-docs",
            },
            {
              label: "Reference",
              to: "/reference",
            },
            {
              label: "Guides",
              to: "/guides/harness-trace-learning-guide",
            },
          ],
        },
        {
          title: "Project",
          items: [
            {
              label: "Blog",
              to: "/blog",
            },
            {
              label: "GitHub",
              href: "https://github.com/phodal/routa",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Routa`,
    },
  },
};
