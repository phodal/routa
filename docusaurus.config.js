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
          exclude: ["**/issues/**", "**/blog/**", "**/fitness/**", "**/bdd/**"],
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
              docId: "platforms/index",
              label: "Platforms",
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
              docId: "coding-style",
              label: "Code Style",
            },
            {
              type: "doc",
              docId: "developer-guide/testing",
              label: "Testing",
            },
            {
              type: "doc",
              docId: "deployment/index",
              label: "Deployment",
            },
            {
              type: "doc",
              docId: "developer-guide/git-workflow",
              label: "Git Workflow",
            },
            {
              type: "doc",
              docId: "developer-guide/contributing",
              label: "Contributing",
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
              label: "Configuration",
              to: "/configuration",
            },
            {
              label: "Administration",
              to: "/administration",
            },
            {
              label: "Use Routa",
              to: "/use-routa",
            },
            {
              label: "What's New",
              to: "/whats-new",
            },
          ],
        },
        {
          title: "Developer Guide",
          items: [
            {
              label: "Overview",
              to: "/developer-guide",
            },
            {
              label: "Testing",
              to: "/developer-guide/testing",
            },
            {
              label: "Deployment",
              to: "/deployment",
            },
            {
              label: "Contributing",
              to: "/developer-guide/contributing",
            },
          ],
        },
        {
          title: "Learn",
          items: [
            {
              label: "Design Docs",
              to: "/design-docs",
            },
            {
              label: "Reference",
              to: "/reference",
            },
            {
              label: "Blog",
              to: "/blog",
            },
          ],
        },
        {
          title: "Project",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/phodal/routa",
            },
            {
              label: "Issues",
              href: "https://github.com/phodal/routa/issues",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Routa`,
    },
  },
};
