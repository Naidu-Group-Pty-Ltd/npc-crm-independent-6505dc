# design-sync notes — npc-property-dashbord

Repo-specific gotchas for future syncs. Read this before re-running.

## Shape

- **This repo is an application, not a component library.** `package.json` has no
  `main`/`module`/`exports`, and `npm run build` is `vite build` (an app bundle).
  There is no `dist/` for the converter to consume.
- We therefore assemble a synthetic package at `.design-sync/.cache/ds-pkg/` via
  **`node .design-sync/build-ds-pkg.mjs`** (this is `cfg.buildCmd`). It contains a
  compiled stylesheet, a real `.d.ts` tree, `entry.mjs`/`index.d.ts` barrels, a
  `src` symlink, and the design guidelines. Everything is regenerated from repo
  source; nothing in it is hand-maintained.
- The synthetic package lives under the gitignored `.design-sync/.cache/` **on
  purpose**. Generated files at the repo root get picked up by `eslint .`
  (`eslint.config.js` only ignores `dist`), and CLAUDE.md gates on a clean lint.
  Do not "simplify" this by emitting `index.d.ts` or `types/` into the repo root.
- No Storybook anywhere in the repo (`shape: "package"`, pinned in config).

## Install

- `node_modules` is absent on a fresh clone — run `npm ci` first (~1100 packages).
- `bun.lock` exists but is vestigial: `packageManager` is `npm@10.8.1` and
  `scripts/ensure-npm.cjs` is an explicit no-op left from removing a bun check.
  **Use npm.** design-sync's lockfile heuristic checks bun before npm — don't let
  it pick bun here.

## Styling

- Components are Tailwind-utility styled against semantic tokens in
  `src/styles/tokens.css`. `src/index.css` is only a manifest of `@import`s, so
  pointing `cssEntry` at it directly ships **unstyled** previews.
- `build-ds-pkg.mjs` compiles the real stylesheet with the Tailwind CLI
  (~1.4 MB, content-scanned across all of `src/`). Tailwind emits a few
  ambiguity warnings (`duration-[var(--motion-base)]`, `ease-[…]`) and one
  invalid-theme-value warning for a `repeating-conic-gradient` utility. All
  pre-existing in the repo, all harmless here.

## Declarations

- `tsc -p .design-sync/tsconfig.dts.json` **exits non-zero** on two pre-existing
  `TS7056` errors ("inferred type exceeds maximum length") in
  `src/hooks/useAuthenticatedSupabase.ts` and `src/integrations/supabase/client.ts`.
  They are reached transitively from `ClientSearchSelect`/`VoiceToTextButton`.
  Declarations still emit, so `build-ds-pkg.mjs` deliberately swallows the exit
  code. If declarations ever stop appearing, that swallow is the first thing to
  check.
- Without this declaration tree every emitted props body degrades to
  `[key: string]: unknown` — the design agent then has no prop contract at all.
  Confirm `ds-bundle/components/*/Button/Button.d.ts` shows the real variant
  union before uploading.

## Component set

- `src/components/ui/` is 56 source files but ~250 exported components — the
  shadcn files each export several parts (`Card`/`CardHeader`/`CardTitle`/…).
  Component counts in the hundreds are expected, not a discovery bug.
- **`Toaster` is exported by both `sonner.tsx` and `toaster.tsx`.** An ambiguous
  `export *` name resolves to nothing, so `build-ds-pkg.mjs` excludes `sonner.tsx`
  from both barrels and keeps the shadcn `toaster.tsx` as canonical.

## Guidelines

- The default `guidelinesGlob` (`docs/*.md`) sweeps **73 unrelated operational
  documents** (security remediation, PDF extraction architecture, GHL migration
  investigations) into `guidelines/`, all of which would reach the design agent.
  `cfg.guidelinesGlob` is pinned to `guidelines/*.md` inside ds-pkg, and
  `build-ds-pkg.mjs` copies only the three design-relevant docs.

## Render check

- **Chromium is pre-installed in this environment** at `/opt/pw-browsers`
  (`PLAYWRIGHT_BROWSERS_PATH` is already set) — do **not** run
  `playwright install`, and don't check `~/.cache/ms-playwright/`, which is empty
  and misleading.
- The cached build is `chromium-1194`, which is pinned by **playwright 1.56.0**.
  The repo's own `@playwright/test` is `1.61.1`, which pins `chromium-1228` and
  fails with `Executable doesn't exist`. `playwright@1.56.0` is installed into
  `.ds-sync/` (isolated from the repo lockfile) for the render check only.

## Known render warns

These are triaged and legitimate. A warn **not** in this list is new — look at it.

- **`[TOKENS_MISSING]`** for `--brand-rgb`, `--brand-border`,
  `--manual-override-sidebar-width`, `--conversation-panel-width`, `--tw`.
  The first four are set at runtime as inline styles (`src/pages/Integrations.tsx`,
  `src/pages/Conversations.tsx`, `ManualDataOverrideModal`) — exactly the
  "expected absent" case. `--tw` is a Tailwind internal. No action.
- **`[RENDER_BLANK]` on floor-card components.** ~235 components ship the
  typographic floor card; small ones fall under the 5 KB PNG threshold. Not a
  failure. Eight were flagged on the first pass (Avatar, Progress, Slider,
  InputOTPSeparator, BreadcrumbEllipsis, PaginationEllipsis, SidebarMenuSkeleton,
  SidebarTrigger) and were resolved by authoring previews for them.

## Component limitations found while authoring previews

Real findings about the components themselves, not about the sync:

- **`Slider` renders a single `<SliderPrimitive.Thumb/>`** (`slider.tsx:21`), so
  a two-value range only ever draws one handle. Radix needs one Thumb per value.
  The Slider preview deliberately has no range story. Worth fixing in the repo.
- **`SidebarMenuSkeleton` picks its bar width with `Math.random()`**
  (`sidebar.tsx:663`). Its rendered output is therefore not byte-stable, so its
  render hash — and its grade — can clear on a re-sync that changed nothing.
  If you see exactly this one component re-grading, that is why.
- **`SidebarProvider`'s wrapper is `min-h-svh` and does not forward `className`**
  to that element, so wrapping a small composition in it stretches a preview card
  to full viewport height. The Sidebar previews omit the provider;
  `useSidebar()` outside a provider warns and returns defaults, so the components
  still render truthfully.
- **`Toaster` is exported by both `sonner.tsx` and `toaster.tsx`** — see the
  Component set section above.

## Re-sync risks — what can silently go stale

- **The compiled stylesheet is content-scanned across all of `src/`.** If a
  utility class is only ever produced dynamically (string-built class names),
  Tailwind will not emit it and previews using it will render unstyled.
- **The declaration tree depends on `tsc` continuing to emit despite errors.**
  Two pre-existing `TS7056` errors are tolerated today. If new type errors appear
  in the `src/components/ui` import graph, emit may stop for those files and
  their props will silently degrade to `[key: string]: unknown`. Always spot-check
  `ds-bundle/components/actions/Button/Button.d.ts` for the real variant union
  after a re-sync.
- **`.design-sync/conventions.md` names concrete classes, tokens and props.** If
  `tailwind.config.ts` or `src/styles/tokens.css` change, re-validate every name
  in it against the fresh build — an agent will trust it and emit vocabulary that
  no longer resolves. `bg-sidebar-accent` was cut for exactly this reason: it is
  configured but never emitted into the compiled CSS.
- **Preview content is invented, not ported.** There are no `examples/`, stories,
  or docs-site usages in this repo to curate from, so the authored previews use
  realistic-but-fictional NPC matter data. Nothing in them is a customer record.
- **Chromium version coupling.** The playwright-1.56.0-to-chromium-1194 pairing is
  a property of this container image, not the repo. A different image needs the
  pairing re-derived (see Render check above).
