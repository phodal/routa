/** @type {import("@docusaurus/types").Config} */
module.exports = {
  title: "Routa Docs",
  tagline: "Routa.js documentation and team learning notes",
  url: "https://phodal.github.io",
  baseUrl: "/routa-js/",
  organizationName: "phodal",
  projectName: "routa-js",
  trailingSlash: false,
  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

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
      },
    ],
  ],

  themeConfig: {
    navbar: {
      title: "Routa",
      items: [
        {
          type: "doc",
          docId: "quickstart",
          label: "Quickstart",
          position: "left",
        },
        {
          type: "doc",
          docId: "ARCHITECTURE",
          label: "Architecture",
          position: "left",
        },
        {
          label: "Blog",
          to: "/blog",
          position: "left",
        },
      ],
    },
    footer: {
      style: "dark",
      copyright: `Copyright © ${new Date().getFullYear()} Routa`,
    },
  },
};
