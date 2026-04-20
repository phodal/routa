import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

const desktopShellColorGuardFiles = [
  "src/client/components/desktop-layout.tsx",
  "src/client/components/desktop-app-shell.tsx",
  "src/client/components/desktop-sidebar.tsx",
  "src/client/components/desktop-nav-rail.tsx",
];

const rawColorPattern =
  /#[\da-fA-F]{3,8}\b|rgba?\(|hsla?\(|(?:^|\s)(?:dark:)?(?:bg|text|border|ring|fill|stroke|from|via|to)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?(?:\/[0-9]{1,3})?)/;

const noHardcodedDesktopShellColorsRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require desktop shell components to use shared design-system tokens instead of hardcoded colors.",
    },
    schema: [],
    messages: {
      hardcodedColor:
        "Desktop shell components must use shared desktop tokens or theme utilities instead of hardcoded colors: {{snippet}}",
    },
  },
  create(context) {
    const reportIfNeeded = (node, value) => {
      if (!value || !rawColorPattern.test(value)) {
        return;
      }

      const snippet = value.trim().replace(/\s+/g, " ").slice(0, 120);
      context.report({
        node,
        messageId: "hardcodedColor",
        data: {
          snippet,
        },
      });
    };

    return {
      Literal(node) {
        if (typeof node.value !== "string") {
          return;
        }
        reportIfNeeded(node, node.value);
      },
      TemplateElement(node) {
        reportIfNeeded(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

const eslintConfig = [
  {
    ignores: [
      ".worktrees/**",
      ".next/**",
      ".next-desktop/**",
      ".next-page-snapshots/**",
      ".docusaurus/**",
      ".venv-security-review/**",
      "**/.next/**",
      "**/.next-desktop/**",
      "**/.next-page-snapshots/**",
      "**/.docusaurus/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "storybook-static/**",
      "target/**",
      "dist/**",
      "docs-site/**",
      ".vercel/**",
      ".routa/**",
      ".agents/**",
      "apps/desktop/src-tauri/target/**",
      "apps/desktop/src-tauri/bundled/**",
      "apps/desktop/src-tauri/frontend/**",
      "**/*.config.js",
      "**/*.config.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "@next/next": nextPlugin,
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // Keep only rules that must stay relaxed for current codebase compatibility.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-require-imports": "off", // Allow require() for dynamic imports
      "@typescript-eslint/triple-slash-reference": "error",
      "@typescript-eslint/no-unsafe-function-type": "error",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/no-unescaped-entities": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@next/next/no-html-link-for-pages": "error",
      "no-useless-escape": "error",
      "prefer-const": "error",
      "no-empty": "error",
      "no-prototype-builtins": "error",
      "no-regex-spaces": "error",
      "no-fallthrough": "error",
      "no-unused-private-class-members": "error",
      "preserve-caught-error": "error",
      "no-useless-assignment": "error",
      "no-unsafe-finally": "error",
      "@next/next/no-img-element": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/purity": "error",
      "react-hooks/refs": "error",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    files: desktopShellColorGuardFiles,
    plugins: {
      routa: {
        rules: {
          "no-hardcoded-desktop-shell-colors": noHardcodedDesktopShellColorsRule,
        },
      },
    },
    rules: {
      "routa/no-hardcoded-desktop-shell-colors": "error",
    },
  },
  // Relax rules for test files
  {
    files: ["**/*.test.{ts,tsx,js,jsx}", "**/*.spec.{ts,tsx,js,jsx}", "**/tests/**", "**/e2e/**", "vitest.setup.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": "off",
    },
  },
];

export default eslintConfig;
