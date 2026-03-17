module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Avoid circular dependencies to keep dependency graph maintainable.",
      severity: "error",
      from: {},
      to: {
        circular: true,
      },
    },
  ],
  options: {
    tsConfig: {
      fileName: "tsconfig.json",
    },
    doNotFollow: {
      path: "node_modules",
    },
    includeOnly: "^src|^apps|^crates",
  },
};
