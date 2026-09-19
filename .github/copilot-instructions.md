# GitHub Copilot instructions

## Frontend / UI work
For any UI or frontend change, follow **[`FRONTEND_TOOLING.md`](../FRONTEND_TOOLING.md)**
at the repo root — the cross-tool source of truth. Key points:

- This app is built on **shadcn/ui + Tailwind** (`components.json`). Prefer an existing
  shadcn/registry component or a `src/components/ui/*` primitive before writing a new one.
- **Semantic design tokens only.** Never emit raw Tailwind palette classes
  (`bg-blue-500`, `text-red-600`) or hardcoded hex/font values in shared UI — consume the
  white-label CSS tokens (`docs/WHITE_LABEL_TOKEN_CONTRACT.md`). The `npm run audit:style`
  ratchet fails the build on new hardcoded-color/font violations.
- Respect `components.json` aliases (`@/components`, `@/components/ui`, `@/lib`, `@/hooks`)
  and the existing `tailwind.config.ts` / `src/index.css`.
- **Accessibility floor:** visible keyboard focus, correct semantics/labels, respects
  `prefers-reduced-motion`, responsive to mobile.
- Before finishing a UI change, run `npm run lint`, `npm run audit:style`, and `npm run build`.

The repo also ships MCP servers (`shadcn`, `chrome-devtools`, `@21st-dev/magic` in
`.mcp.json`) and design skills (`.claude/skills/`) for tools that support them — see
`FRONTEND_TOOLING.md` and `MCP_SETUP.md`.

## Backend / security
Backend, Supabase Edge Function, and AML rules live in `AGENTS.md` and
`AGENTS_NPC_Property_Dashboard.md`. Those constraints still apply.
