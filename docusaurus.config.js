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
          docId: "quickstart",
          label: "Overview",
          position: "left",
        },
        {
          type: "doc",
          docId: "ARCHITECTURE",
          label: "Architecture",
          position: "left",
        },
        {
          type: "doc",
          docId: "design-docs/index",
          label: "Design Docs",
          position: "left",
        },
        {
          label: "Blog",
          to: "/blog",
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
          title: "Docs",
          items: [
            {
              label: "Overview",
              to: "/",
            },
            {
              label: "Quickstart",
              to: "/#quickstart",
            },
            {
              label: "Architecture",
              to: "/ARCHITECTURE",
            },
          ],
        },
        {
          title: "System",
          items: [
            {
              label: "Product Specs",
              to: "/product-specs/FEATURE_TREE",
            },
            {
              label: "Specialists",
              to: "/specialists",
            },
            {
              label: "Releases",
              to: "/releases/v0.2.5-release-notes",
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
