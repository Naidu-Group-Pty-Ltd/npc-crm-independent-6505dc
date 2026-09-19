# Frontend AI Tooling — Cross-Tool Reference

**This is the single source of truth for AI-assisted frontend work in this repo.**
It applies to **every** AI coding tool — Codex, Claude Code, Lovable, Cursor,
GitHub Copilot, or any other — not just one. If you are an assistant making a
**UI / frontend change**, read this first and use the packages below.

> Backend, security, and AML rules live in [`AGENTS.md`](./AGENTS.md) and
> [`AGENTS_NPC_Property_Dashboard.md`](./AGENTS_NPC_Property_Dashboard.md). Those
> still apply — this file is additive and scoped to the UI layer.

---

## 1. Installed frontend packages — use them

The repo ships a shared toolchain in [`.mcp.json`](./.mcp.json) (MCP servers) and
[`.claude/skills/`](./.claude/skills/) (agent skills). Setup and API-key steps are
in [`MCP_SETUP.md`](./MCP_SETUP.md). When your tool supports MCP and/or skills,
these are the preferred way to do frontend work:

### MCP servers (`.mcp.json`)

| Server | Package | Use it to… |
| --- | --- | --- |
| **shadcn** | `shadcn@latest mcp` | Discover and add UI from the shadcn registry. This app is **already built on shadcn/ui** (`components.json`) — reach for a registry component before hand-rolling one. |
| **chrome-devtools** | `chrome-devtools-mcp@latest` | Actually run the change in a browser — inspect the DOM, console, and network, and take screenshots to verify the result before claiming it works. |
| **@21st-dev/magic** | `@21st-dev/magic@latest` | Generate or refine net-new UI components from a natural-language description, then adapt the output to this repo's tokens and conventions. Needs `MAGIC_API_KEY` (see `MCP_SETUP.md`). |

### Agent skills (`.claude/skills/`)

| Skill | Source | Use it to… |
| --- | --- | --- |
| **npc-services-design** | The NPC Services Design System (claude.ai/design) | **The brand itself** — colour categories, the type scale and eyebrow signature, spacing, the logo marks, voice, and the print rules for generated reports. Invoke for any NPC surface, and always for a PDF/report. |
| **frontend-design** | Anthropic `anthropics/skills` | Set the aesthetic direction for new or reshaped UI — palette, typography, layout — so it looks intentional, not templated. Invoke before building a new surface. |
| **web-design-guidelines** | Vercel `vercel-labs/agent-skills` | Review UI code for accessibility, UX, and Web Interface Guidelines compliance. Invoke after building, before finishing. |

### Claude Design — the published design system

The canonical design system is a **Claude Design** project called
**NPC Services Design System**, at [claude.ai/design](https://claude.ai/design). It
holds the token files (`tokens/colors.css`, `tokens/typography.css`, …), the
guideline cards, and the UI kits. Claude Code reaches it with the built-in
**DesignSync** tool (`list_projects` → `get_file` → `finalize_plan` → `write_files`).

Treat it as the **source of the brand**, and this repo as the source of the code:

- **Reading:** derive colours, type and spacing from the project's token files
  rather than inventing values. `tokens/colors.css` is the authority, and it is a
  verbatim copy of `src/styles/tokens.css` — if the two disagree, the repo wins
  and the project needs re-syncing.
- **Writing:** push a card back when you add a durable, reusable pattern. Sync
  **incrementally, one component at a time** — never wholesale-replace the project.
- Colours there are HSL triplets without the `hsl()` wrapper, so they compose with
  alpha: `background: hsl(var(--primary) / 0.12)`.

A **local working copy** is installed at
[`.claude/skills/npc-services-design/`](./.claude/skills/npc-services-design/) so the
brand is readable offline and by any tool. It carries the type/spacing/surface
tokens, the voice, the asset inventory and the print rules — but **not** a copy of
the colour palette, because `src/styles/tokens.css` is authoritative and a second
copy would drift. Where the skill and the repo disagree, the repo wins.

The **report-template** layer of the system — the five voices the PDF catalogue is
built from — is generated from code so it cannot drift:
`npm run templates:library:cards`, then push `.design-system/report-templates/`.
See [`docs/template-library/06-design-system.md`](./docs/template-library/06-design-system.md).

Traffic also runs the **other way**, and that is newer. `npm run brand:sync`
reads the committed subset of the project's `_ds_manifest.json` at
`scripts/brandDesign/claudeDesign/npc-services.manifest.json` and asserts that
the print tokens in `reportDesign/tokens.pure.ts` are still derivable from it —
`--background` → paper, `--aurixa-obsidian` → the cover field, and so on. A
failure means the two have diverged and somebody has to decide which is right;
the rule above says the repo wins and the project needs re-syncing.

To refresh the committed manifest, ask Claude Code in a session with
design-system authorization: `list_projects`, then `get_file` on
`_ds_manifest.json`, keep `namespace / globalCssPaths / themes / fonts /
brandFonts / tokens / cards`, and run `npm run brand:sync`. The same file is
what `/admin/template-builder/brand-systems` seeds the house design system
from, so a person can import any other Claude Design project by dropping its
manifest onto that page.

For **generated PDFs**, read
[`.claude/skills/npc-services-design/reports/REPORT_RULES.md`](./.claude/skills/npc-services-design/reports/REPORT_RULES.md)
and [`docs/reports/DESIGN_SYSTEM.md`](./docs/reports/DESIGN_SYSTEM.md).

If your tool does **not** support MCP/skills, still follow the same intent: prefer
shadcn components, design deliberately, verify in a browser, and review for
accessibility.

---

## 2. The frontend loop (apply to every UI change)

1. **Design** — for a new or significantly reshaped surface, use **frontend-design**
   to choose palette, type, and layout deliberately. Derive colors from this repo's
   semantic tokens (§3), not arbitrary hexes.
2. **Build** — prefer a **shadcn** registry component; use **@21st-dev/magic** for
   net-new components, then adapt the output to our tokens, aliases, and patterns.
   Never paste generated code that hardcodes colors or fonts.
3. **Review** — run **web-design-guidelines** over the changed files (a11y, focus
   states, semantics, reduced-motion, responsive down to mobile).
4. **Verify** — use **chrome-devtools** to load the app, exercise the change, check
   the console for errors, and screenshot the result. Do not report success on an
   unverified UI change.

---

## 3. Non-negotiable frontend rules (repo-specific)

These are enforced by tooling and CI — respect them regardless of which AI tool
generated the code:

- **Semantic design tokens only.** Never emit raw Tailwind palette classes
  (`bg-blue-500`, `text-red-600`, …) or hardcoded hex/font values in shared UI.
  Consume the white-label CSS tokens. See
  [`docs/WHITE_LABEL_TOKEN_CONTRACT.md`](./docs/WHITE_LABEL_TOKEN_CONTRACT.md) and
  [`docs/STYLE_CONSISTENCY_AND_THEMING_PLAN.md`](./docs/STYLE_CONSISTENCY_AND_THEMING_PLAN.md).
  The ratchet `npm run audit:style` fails the build if hardcoded-color/font counts
  rise above the committed baseline — new violations must be **zero**.
- **Theming is dynamic.** Branding (colors, logos, light/dark) comes from
  `whitelabel_settings` via `BrandProvider` → CSS vars on `:root` / `.dark`. Build
  UI that reads tokens so it re-themes automatically; never assume a fixed brand.
- **Surfaces are glass, and the recipe lives in one file.** Every pane in the
  product — card, panel, dialog, dropdown, sidebar, toolbar, table — is frosted
  glass over a single ambient field. Use a `.glass-*` class from
  [`src/styles/glass.css`](./src/styles/glass.css); never hand-roll
  `bg-card/60 backdrop-blur-md border shadow-lg`. Two rules that file explains in
  full and that are easy to get wrong:
  - **Never put `backdrop-filter` on a repeated element** — a table row, a list
    item, a card in a grid. Blur is per-layer work: measured on this app, sixty
    blurring cards took a scroll frame from 17ms to 80ms. Containers blur;
    repeated panes get the fill and the lit edge only, and read as glass because
    the container behind them is already refracting.
  - **Don't add a `bg-*` or `shadow-*` utility to a glass surface.** Tailwind
    emits utilities after the components layer, so the utility paints an opaque
    background straight back over the glass. That is why the shadcn primitives
    carry no background utility.
  Transparency degrades to opaque in one place — the fallback branches at the
  bottom of `src/styles/tokens.css` cover `prefers-reduced-transparency`,
  `prefers-contrast`, forced colours, no-`backdrop-filter` browsers and print.
- **Use the shadcn setup as-is.** Respect `components.json` aliases (`@/components`,
  `@/components/ui`, `@/lib`, `@/hooks`) and the existing Tailwind config
  (`tailwind.config.ts`, `src/index.css`). Add primitives via the shadcn registry
  rather than duplicating them.
- **Accessibility floor.** Visible keyboard focus, correct semantics/labels,
  respects `prefers-reduced-motion`, responsive to mobile. This is what
  web-design-guidelines checks — clear it before finishing.
- **Feature flags / module gates stay intact.** UI behind `ModuleGuard` and feature
  flags must remain gated; don't expose flagged surfaces by default.

---

## 4. Stack map (where frontend lives)

- **Framework:** Vite + React + TypeScript. Dev: `npm run dev`, build: `npm run build`.
- **UI kit:** shadcn/ui + Tailwind (`components.json`, `tailwind.config.ts`, `src/index.css`).
- **App code:** `src/` — pages in `src/pages/*`, components in `src/components/*`,
  shared UI primitives in `src/components/ui/*`, hooks in `src/hooks/*`, utils in `src/lib/*`.
- **Design system docs:** `docs/WHITE_LABEL_TOKEN_CONTRACT.md`,
  `docs/STYLE_CONSISTENCY_AND_THEMING_PLAN.md`, `docs/dashboard-theme-foundation.md`.
- **Style enforcement:** `npm run audit:style` (ratchet) and `npm run lint`.

Before finishing any UI change, run at minimum: `npm run lint`, `npm run audit:style`,
and `npm run build`.

---

## 5. How each tool picks this file up

The same guidance is wired into every tool's native entry point so it applies no
matter what is driving the change. Keep this file as the source of truth; the others
are thin pointers back here.

| Tool | Entry point that points here |
| --- | --- |
| **Codex / generic** | [`AGENTS.md`](./AGENTS.md) |
| **Claude Code** | [`CLAUDE.md`](./CLAUDE.md) + `.claude/skills/`, `.mcp.json` |
| **GitHub Copilot** | [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) |
| **Cursor** | [`.cursor/rules/frontend-tooling.mdc`](./.cursor/rules/frontend-tooling.mdc) |
| **Lovable** | Reads repo docs; add this file to project knowledge if prompted UI work isn't honoring it. |

If you add another AI tool, point its rules file back to this document rather than
copying the content, so there is one source of truth.
