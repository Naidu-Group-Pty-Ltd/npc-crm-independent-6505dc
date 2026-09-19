import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-misleading-character-class": "off",
      "prefer-const": "off",
      "no-case-declarations": "off",
      "no-empty": "off",
      "no-prototype-builtins": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
      // React Compiler rules, new in eslint-plugin-react-hooks 7 (the version
      // ESLint 10 requires — v5 peers at eslint ^9 and is what blocked the
      // upgrade). Its `recommended` turns on fifteen rules that did not exist
      // in v5, and they fire 871 times on this tree: 573 "setState
      // synchronously within an effect", 192 "cannot access refs during
      // render", and the rest across purity, memoisation and immutability.
      //
      // These are real findings, not noise, so they are NOT switched off —
      // they warn. Same treatment, and for the same reason, as the
      // style-token guardrail below: a large standing backlog that must not
      // block the build, kept visible so new code can be held to it. Turning
      // any of these to "error" is a deliberate act once its backlog is paid
      // down.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/set-state-in-render": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/void-use-memo": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/error-boundaries": "warn",
      "react-hooks/config": "warn",
      "react-hooks/gating": "warn",
      // New in ESLint 10's recommended set, with their own standing backlog
      // (108 and 10 occurrences). Same rule: visible, not blocking.
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
      // Style-token guardrail. Warns (not errors) because thousands of legacy
      // violations still exist; the hard gate is the ratchet in
      // scripts/audit-style-tokens.cjs. New code should use semantic tokens.
      // See docs/STYLE_CONSISTENCY_AND_THEMING_PLAN.md.
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "Literal[value=/(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|decoration|placeholder|caret|accent)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}/]",
          message:
            "Use a semantic colour token (bg-primary, text-warning, border-destructive, bg-brand, …) instead of a raw Tailwind palette class.",
        },
        {
          selector: "Literal[value=/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b/]",
          message:
            "Avoid hardcoded HEX colours. Use a semantic token via hsl(var(--token)) or a Tailwind token class.",
        },
        {
          selector: "Property[key.name='fontFamily']",
          message:
            "Do not set fontFamily per component. Fonts come from the --font-* tokens (branding page).",
        },
      ],
    },
  }
);
