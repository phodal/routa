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
        'Routa turns a Kanban board into an execution surface for AI specialists across ACP, MCP, A2A, and AG-UI.',
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
          docId: "getting-started/index",
          label: "Getting Started",
          position: "left",
        },
        {
          type: "doc",
          docId: "use-routa/index",
          label: "Use Routa",
          position: "left",
        },
        {
          type: "doc",
          docId: "platforms/index",
          label: "Platforms",
          position: "left",
        },
        {
          type: "doc",
          docId: "deployment/index",
          label: "Deployment",
          position: "left",
        },
        {
          type: "doc",
          docId: "configuration/index",
          label: "Configuration",
          position: "left",
        },
        {
          type: "doc",
          docId: "reference/index",
          label: "Reference",
          position: "left",
        },
        {
          href: "https://github.com/phodal/routa",
          label: "GitHub",
          position: "right",
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
              label: "Project Structure",
              href: "https://github.com/phodal/routa/blob/main/README.md#repository-map",
            },
            {
              label: "Architecture",
              to: "/ARCHITECTURE",
            },
            {
              label: "Code Style",
              to: "/coding-style",
            },
            {
              label: "Git Workflow",
              href: "https://github.com/phodal/routa/blob/main/AGENTS.md#git-discipline",
            },
            {
              label: "Testing",
              href: "https://github.com/phodal/routa/blob/main/docs/fitness/README.md",
            },
            {
              label: "Deployment",
              to: "/deployment",
            },
            {
              label: "Contributing",
              href: "https://github.com/phodal/routa/blob/main/CONTRIBUTING.md",
            },
          ],
        },
        {
          title: "Learn",
          items: [
            {
              label: "Use Routa",
              to: "/use-routa",
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
              label: "Deployment",
              to: "/deployment",
            },
            {
              label: "Reference",
              to: "/reference",
            },
            {
              label: "Design Docs",
              to: "/design-docs",
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
