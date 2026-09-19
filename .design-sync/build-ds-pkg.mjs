#!/usr/bin/env node
// Builds a synthetic "library package" for design-sync to consume.
//
// This repo is an application, not a published component library: package.json
// has no main/module/exports and `npm run build` is `vite build` (an app
// bundle). The design-sync converter expects a package with a dist entry and a
// .d.ts tree. Rather than pollute the app root with generated files — `eslint .`
// lints anything there, and CLAUDE.md gates on a clean lint — we assemble that
// package under .design-sync/.cache/ds-pkg/, which is already gitignored.
//
// Everything here is regenerated from the repo's own source. Nothing is
// hand-maintained, and nothing is a reimplementation of a component.
//
// Run: node .design-sync/build-ds-pkg.mjs

import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const PKG = resolve(HERE, '.cache/ds-pkg');
const UI = resolve(REPO, 'src/components/ui');

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: REPO, stdio: 'inherit', ...opts });

// ── 1. compiled Tailwind stylesheet ──────────────────────────────────────
// The components are styled with Tailwind utilities against semantic tokens in
// src/styles/tokens.css. src/index.css is only a manifest of @imports, so
// shipping it raw would render every preview unstyled. Compile the real thing.
mkdirSync(PKG, { recursive: true });
console.error('» compiling Tailwind → ds-pkg/styles.css');
run('npx', [
  'tailwindcss',
  '-c', 'tailwind.config.ts',
  '-i', 'src/index.css',
  '-o', join(PKG, 'styles.css'),
]);

// ── 2. declaration tree ──────────────────────────────────────────────────
// Real .d.ts is what gives the design agent prop contracts (variant unions,
// asChild, HTML attribute inheritance). Without it every props body degrades to
// `[key: string]: unknown`. tsc exits non-zero on two pre-existing TS7056
// errors in transitively-imported Supabase modules; declarations still emit, so
// the exit code is deliberately not fatal here.
console.error('» emitting declarations → ds-pkg/types/');
try {
  run('npx', ['tsc', '-p', join(HERE, 'tsconfig.dts.json')]);
} catch {
  console.error('  (tsc reported errors — declarations still emitted; see NOTES.md)');
}

const typesUi = join(PKG, 'types/components/ui');
if (!existsSync(typesUi)) {
  console.error('✗ no declarations emitted at ds-pkg/types/components/ui — aborting');
  process.exit(1);
}

// ── 3. barrels ───────────────────────────────────────────────────────────
// Source files, in a stable order. Later `export *` wins on a name collision in
// esbuild, so order is pinned rather than filesystem-dependent.
const srcFiles = readdirSync(UI)
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
  .sort();

// toaster.tsx and sonner.tsx both export `Toaster`. Keep the shadcn toaster as
// the canonical one and drop sonner's from the barrels so the re-export isn't
// ambiguous (an ambiguous `export *` name resolves to nothing).
const EXCLUDE = new Set(['sonner.tsx']);
const included = srcFiles.filter((f) => !EXCLUDE.has(f));

writeFileSync(
  join(PKG, 'entry.mjs'),
  included.map((f) => `export * from ${JSON.stringify(join(UI, f))};`).join('\n') + '\n',
);

const dtsFiles = readdirSync(typesUi).filter((f) => f.endsWith('.d.ts')).sort();
const dtsIncluded = dtsFiles.filter((f) => !EXCLUDE.has(f.replace(/\.d\.ts$/, '.tsx')));
writeFileSync(
  join(PKG, 'index.d.ts'),
  dtsIncluded
    .map((f) => `export * from ${JSON.stringify('./types/components/ui/' + f.replace(/\.d\.ts$/, ''))};`)
    .join('\n') + '\n',
);

// ── 3b. category stubs (grouping) ────────────────────────────────────────
// Every ui file sits directly in src/components/ui/, so the converter's
// path-segment heuristic has nothing to group on and drops all ~250 components
// into "general" — one undifferentiated wall of cards in the Design System
// pane. Frontmatter `category` on a per-component doc is the supported override,
// so emit a stub doc per component. The converter still appends the synthesized
// ## Props section, so a stub costs nothing but the grouping it buys.
const CATEGORY = {
  // Actions
  'button.tsx': 'Actions', 'toggle.tsx': 'Actions', 'toggle-group.tsx': 'Actions',
  // Forms
  'input.tsx': 'Forms', 'textarea.tsx': 'Forms', 'select.tsx': 'Forms',
  'checkbox.tsx': 'Forms', 'radio-group.tsx': 'Forms', 'switch.tsx': 'Forms',
  'slider.tsx': 'Forms', 'label.tsx': 'Forms', 'form.tsx': 'Forms',
  'input-otp.tsx': 'Forms', 'search-field.tsx': 'Forms', 'calendar.tsx': 'Forms',
  'password-strength-meter.tsx': 'Forms', 'ClientSearchSelect.tsx': 'Forms',
  'TeamUserSelect.tsx': 'Forms', 'MultiTeamUserSelect.tsx': 'Forms',
  'VoiceToTextButton.tsx': 'Forms',
  // Overlays
  'dialog.tsx': 'Overlays', 'alert-dialog.tsx': 'Overlays', 'sheet.tsx': 'Overlays',
  'drawer.tsx': 'Overlays', 'popover.tsx': 'Overlays', 'hover-card.tsx': 'Overlays',
  'tooltip.tsx': 'Overlays', 'context-menu.tsx': 'Overlays',
  'dropdown-menu.tsx': 'Overlays', 'command.tsx': 'Overlays',
  // Navigation
  'tabs.tsx': 'Navigation', 'navigation-menu.tsx': 'Navigation',
  'breadcrumb.tsx': 'Navigation', 'pagination.tsx': 'Navigation',
  'sidebar.tsx': 'Navigation', 'accordion.tsx': 'Navigation',
  'collapsible.tsx': 'Navigation', 'menubar.tsx': 'Navigation',
  // Data display
  'table.tsx': 'Data', 'responsive-table.tsx': 'Data', 'chart.tsx': 'Data',
  'avatar.tsx': 'Data', 'badge.tsx': 'Data', 'status-badge.tsx': 'Data',
  'carousel.tsx': 'Data',
  // Feedback
  'alert.tsx': 'Feedback', 'toast.tsx': 'Feedback', 'toaster.tsx': 'Feedback',
  'skeleton.tsx': 'Feedback', 'progress.tsx': 'Feedback',
  // Layout
  'card.tsx': 'Layout', 'separator.tsx': 'Layout', 'aspect-ratio.tsx': 'Layout',
  'scroll-area.tsx': 'Layout', 'resizable.tsx': 'Layout',
};

// Exported value names per declaration file. tsc normalizes to a trailing
// `export { A, B, … }`; a few files use `export declare const X` instead.
function exportedFrom(dtsText) {
  const names = new Set();
  for (const m of dtsText.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (n && /^[A-Z][A-Za-z0-9]*$/.test(n)) names.add(n);
    }
  }
  for (const m of dtsText.matchAll(/export\s+declare\s+(?:const|function|class)\s+([A-Z][A-Za-z0-9]*)/g)) {
    names.add(m[1]);
  }
  return names;
}

const docsOut = join(PKG, 'docs');
rmSync(docsOut, { force: true, recursive: true });
mkdirSync(docsOut, { recursive: true });
let stubs = 0;
const uncategorised = new Set();
for (const f of dtsIncluded) {
  const srcName = f.replace(/\.d\.ts$/, '');
  const tsxName = `${srcName}.tsx`;
  const category = CATEGORY[tsxName] ?? CATEGORY[`${srcName}.ts`] ?? 'Components';
  if (!CATEGORY[tsxName] && !CATEGORY[`${srcName}.ts`]) uncategorised.add(srcName);
  for (const name of exportedFrom(readFileSync(join(typesUi, f), 'utf8'))) {
    writeFileSync(join(docsOut, `${name}.md`), `---\ncategory: ${category}\n---\n`);
    stubs += 1;
  }
}
if (uncategorised.size) {
  console.error(`  ! uncategorised → "Components": ${[...uncategorised].sort().join(', ')}`);
}
console.error(`  category stubs: ${stubs}`);

// ── 4. package manifest + tsconfig ───────────────────────────────────────
// `types` makes findTypesRoot resolve to this dir; the converter walks up from
// --entry to the nearest package.json with a name, which is this one.
writeFileSync(
  join(PKG, 'package.json'),
  JSON.stringify(
    {
      name: 'npc-property-dashboard-ui',
      version: '0.0.0',
      private: true,
      type: 'module',
      types: 'index.d.ts',
    },
    null,
    2,
  ) + '\n',
);

// esbuild reads compilerOptions.paths to resolve the `@/…` imports the
// components use. baseUrl is absolute so it resolves from ds-pkg.
writeFileSync(
  join(PKG, 'tsconfig.json'),
  JSON.stringify(
    { compilerOptions: { baseUrl: REPO, paths: { '@/*': ['src/*'] }, jsx: 'react-jsx' } },
    null,
    2,
  ) + '\n',
);

// ── 5. src symlink ───────────────────────────────────────────────────────
// cfg.srcDir is resolved against the package dir, and the converter uses it for
// JSDoc, grouping and component/source matching. Link rather than copy so it
// never goes stale.
const srcLink = join(PKG, 'src');
rmSync(srcLink, { force: true, recursive: false });
symlinkSync(resolve(REPO, 'src'), srcLink, 'dir');

// ── 6. design guidelines ─────────────────────────────────────────────────
// guidelinesGlob is package-relative and the default (`docs/*.md`) would sweep
// in 73 unrelated ops/security documents. Copy only the design-relevant ones.
const GUIDELINES = [
  'FRONTEND_TOOLING.md',
  'docs/STYLE_CONSISTENCY_AND_THEMING_PLAN.md',
  'docs/dashboard-theme-foundation.md',
];
const guidesOut = join(PKG, 'guidelines');
rmSync(guidesOut, { force: true, recursive: true });
mkdirSync(guidesOut, { recursive: true });
let copied = 0;
for (const g of GUIDELINES) {
  const from = resolve(REPO, g);
  if (!existsSync(from)) {
    console.error(`  ! guideline missing, skipped: ${g}`);
    continue;
  }
  cpSync(from, join(guidesOut, g.split('/').pop()));
  copied += 1;
}

console.error(
  `✓ ds-pkg ready: ${included.length} source files, ${dtsIncluded.length} declarations, ` +
    `${copied} guideline(s) → ${relative(REPO, PKG)}`,
);
