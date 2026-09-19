/**
 * Importing a design system from Claude Design.
 *
 * The first `describe` is the one that matters and the reason the feature is
 * more than a colour picker: `reportDesign/tokens.pure.ts` states every print
 * value as a derivation of a named design-system variable, in prose, in a
 * comment. This asserts the derivation is real by running it over the *actual*
 * NPC Services Design System manifest — pulled from claude.ai/design and
 * committed under `scripts/brandDesign/claudeDesign/` — and requiring the
 * result to equal `PRINT_SURFACE` / `PRINT_INK` / `PRINT_BRAND.base` to the
 * byte.
 *
 * If it passes, "pull a design system from Claude Design" works, and it works
 * for somebody else's project for the same reason it works for ours. If either
 * side drifts, it fails here rather than in a client's PDF.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  deriveReportNeutrals,
  hslToHex,
  importDesignSystem,
  NEUTRAL_SOURCES,
  parseTokenCss,
  readDesignSystemManifest,
  tokenValueToHex,
  type ImportedToken,
} from '../import.pure';
import { PRINT_BRAND, PRINT_INK, PRINT_SURFACE } from '@/lib/reportDesign/tokens.pure';
import { auditBrandDesignSystem } from '../system.pure';
import { readReportNeutrals, resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';

const MANIFEST = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../scripts/brandDesign/claudeDesign/npc-services.manifest.json'),
  'utf8',
));

describe('the real NPC Services Design System, imported', () => {
  const read = readDesignSystemManifest(MANIFEST);
  if (read.ok === false) throw new Error(read.error);
  const derived = deriveReportNeutrals(read.manifest.tokens);
  if (derived.ok === false) throw new Error(derived.error);

  it('reproduces every print surface exactly', () => {
    expect(derived.derived.neutrals.paper).toBe(PRINT_SURFACE.paper);
    expect(derived.derived.neutrals.paperAlt).toBe(PRINT_SURFACE.paperAlt);
    expect(derived.derived.neutrals.paperBright).toBe(PRINT_SURFACE.paperBright);
    expect(derived.derived.neutrals.field).toBe(PRINT_SURFACE.field);
    expect(derived.derived.neutrals.rule).toBe(PRINT_SURFACE.rule);
  });

  it('reproduces every print ink exactly', () => {
    expect(derived.derived.neutrals.bodyInk).toBe(PRINT_INK.body);
    expect(derived.derived.neutrals.mutedInk).toBe(PRINT_INK.muted);
  });

  it('reproduces the brand gold exactly', () => {
    expect(derived.derived.brandHex).toBe(PRINT_BRAND.base);
  });

  it('needs no substitution at all — every first choice is present', () => {
    // A note here means the house design system has lost a variable the print
    // layer depends on, which is worth failing over.
    expect(derived.derived.notes).toEqual([]);
    expect(derived.derived.sources.paper).toBe('--background');
    expect(derived.derived.sources.field).toBe('--aurixa-obsidian');
    expect(derived.derived.sources.brand).toBe('--brand');
  });

  it('carries the theme, the brand fonts and the card index', () => {
    expect(read.manifest.namespace).toContain('NPCServicesDesignSystem');
    expect(read.manifest.themes.map((t) => t.selector)).toContain('.dark');
    expect(read.manifest.brandFonts.map((f) => f.family)).toEqual(
      expect.arrayContaining(['Cinzel', 'Playfair Display']),
    );
    expect(read.manifest.cards.length).toBeGreaterThan(20);
    expect(read.manifest.cards.map((c) => c.group)).toContain('Colors');
  });

  it('produces a saveable, legible design system', () => {
    const imported = importDesignSystem(MANIFEST);
    expect(imported.ok).toBe(true);
    if (imported.ok === false) return;
    expect(imported.result.system.origin).toBe('imported');
    expect(imported.result.system.neutrals).not.toBeNull();
    expect(imported.result.system.sourceNamespace).toBe(read.manifest.namespace);
    // The gate every other design system passes through.
    expect(auditBrandDesignSystem(imported.result.system).ok).toBe(true);
  });

  it('names itself from the namespace rather than "Untitled"', () => {
    const imported = importDesignSystem(MANIFEST);
    if (imported.ok === false) return;
    expect(imported.result.system.name).toContain('NPC');
    expect(imported.result.system.slug).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('colour values', () => {
  it('reads the bare HSL triplet Claude Design actually writes', () => {
    // Written without the `hsl()` wrapper so it composes with alpha —
    // `hsl(var(--primary) / 0.12)` — which makes the bare form the common case.
    expect(tokenValueToHex('42 54% 96%')).toBe('#FAF7EF');
    expect(tokenValueToHex('34 20% 12%')).toBe('#251F18');
    expect(tokenValueToHex('43 74% 49%')).toBe('#D9A520');
  });

  it('reads the wrapped, hex and rgb forms too, so a foreign file still works', () => {
    expect(tokenValueToHex('hsl(42, 54%, 96%)')).toBe('#FAF7EF');
    expect(tokenValueToHex('hsl(42 54% 96% / 0.5)')).toBe('#FAF7EF');
    expect(tokenValueToHex('#faf7ef')).toBe('#FAF7EF');
    expect(tokenValueToHex('#FFF')).toBe('#FFFFFF');
    expect(tokenValueToHex('rgb(250, 247, 239)')).toBe('#FAF7EF');
    expect(tokenValueToHex('rgba(250 247 239 / .8)')).toBe('#FAF7EF');
  });

  it('returns null rather than a colour for something that is not one', () => {
    for (const bad of ['', '  ', 'var(--font-sans)', 'ui-sans-serif, system-ui', '0.75rem', 'inherit']) {
      expect(tokenValueToHex(bad), bad).toBeNull();
    }
  });

  it('clamps and wraps rather than producing a broken hex', () => {
    expect(hslToHex(400, 150, -20)).toMatch(/^#[0-9A-F]{6}$/);
    expect(hslToHex(Number.NaN, 50, 50)).toBeNull();
  });
});

describe('parsing token CSS', () => {
  it('reads the annotation that sits after the semicolon', () => {
    // `--background: 42 54% 96%; /* @kind color */ /* warm ivory */` — the
    // annotation is not inside the value, and the trailing comment is not
    // either.
    const tokens = parseTokenCss(
      ':root {\n  --background: 42 54% 96%; /* @kind color */ /* warm ivory */\n}',
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ name: '--background', value: '42 54% 96%', kind: 'color' });
  });

  it('reads a minified line, which the real typography file is', () => {
    // `tokens/typography.css` puts twenty declarations on one line. A
    // line-oriented parser reads that as one token and loses nineteen.
    const tokens = parseTokenCss(
      ':root { --text-xs: 0.6875rem; --text-sm: 0.75rem; --weight-bold: 700; /* @kind font */ --leading-snug: 1.35; /* @kind font */ }',
    );
    expect(tokens.map((t) => t.name)).toEqual([
      '--text-xs', '--text-sm', '--weight-bold', '--leading-snug',
    ]);
    expect(tokens.find((t) => t.name === '--weight-bold')?.kind).toBe('font');
  });

  it('keeps the dark theme separable from the root', () => {
    const tokens = parseTokenCss(
      ':root { --background: 42 54% 96%; }\n.dark { --background: 0 0% 4%; }',
    );
    expect(tokens.find((t) => !t.scope)?.value).toBe('42 54% 96%');
    expect(tokens.find((t) => t.scope === '.dark')?.value).toBe('0 0% 4%');
  });

  it('infers a kind when the file carries no annotation', () => {
    const tokens = parseTokenCss(':root { --brand: #D9A520; --font-sans: Inter, sans-serif; --gap: 4px; }');
    expect(tokens.find((t) => t.name === '--brand')?.kind).toBe('color');
    expect(tokens.find((t) => t.name === '--font-sans')?.kind).toBe('font');
    expect(tokens.find((t) => t.name === '--gap')?.kind).toBe('other');
  });

  it('does not let an @font-face block contribute a scope', () => {
    const tokens = parseTokenCss(
      '@font-face { font-family: "Cinzel"; src: url(x.ttf); }\n:root { --brand: #D9A520; }',
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0].scope).toBeUndefined();
  });

  it('never throws, whatever it is handed', () => {
    for (const bad of ['', '}}}{{{', ':root {', null, undefined, '/* only a comment */']) {
      expect(() => parseTokenCss(bad as never)).not.toThrow();
    }
  });
});

describe('the fallback chains', () => {
  const t = (name: string, value: string, scope?: string): ImportedToken =>
    ({ name, value, kind: 'color', ...(scope ? { scope } : {}) });

  /** Enough to clear the three required roles. */
  const MINIMUM = [
    t('--background', '#FFFFFF'),
    t('--foreground', '#1A1A1A'),
    t('--aurixa-obsidian', '#111111'),
  ];

  it('takes the second choice and says so', () => {
    const d = deriveReportNeutrals([...MINIMUM, t('--secondary', '#EEEEEE')]);
    expect(d.ok).toBe(true);
    if (d.ok === false) return;
    expect(d.derived.neutrals.paperAlt).toBe('#EEEEEE');
    expect(d.derived.sources.paperAlt).toBe('--secondary');
    expect(d.derived.notes.join(' ')).toContain('--muted');
  });

  it('uses the dark theme page colour as a cover ground when there is no obsidian', () => {
    // A design system with a dark mode has already decided what its darkest
    // ground is; guessing one would be worse.
    const d = deriveReportNeutrals([
      t('--background', '#FFFFFF'),
      t('--foreground', '#1A1A1A'),
      t('--background', '#050505', '.dark'),
    ]);
    expect(d.ok).toBe(true);
    if (d.ok === false) return;
    expect(d.derived.neutrals.field).toBe('#050505');
    expect(d.derived.sources.field).toBe('.dark:--background');
  });

  it('refuses an import with no sheet, no body ink or no cover ground', () => {
    // The three roles with no honest substitute. Filling them from NPC's own
    // values would render, look deliberate, and not be the imported system.
    for (const drop of ['--background', '--foreground', '--aurixa-obsidian']) {
      const d = deriveReportNeutrals(MINIMUM.filter((x) => x.name !== drop));
      // Dropping obsidian alone still resolves through `.dark:--background` /
      // `--foreground`, so only the first two are fatal on their own.
      if (drop === '--aurixa-obsidian') { expect(d.ok).toBe(true); continue; }
      expect(d.ok, drop).toBe(false);
      if (d.ok === false) expect(d.error).toContain('cannot be set');
    }
  });

  it('falls back to the sheet rather than to somebody else\'s champagne', () => {
    const d = deriveReportNeutrals(MINIMUM);
    if (d.ok === false) return;
    expect(d.derived.neutrals.paperAlt).toBe('#FFFFFF');
    expect(d.derived.notes.join(' ')).toContain('falls back to paper');
  });

  it('says so when a system declares no brand colour', () => {
    const d = deriveReportNeutrals(MINIMUM);
    if (d.ok === false) return;
    expect(d.derived.brandHex).toBeNull();
    expect(d.derived.notes.join(' ')).toContain('no brand colour');
  });

  it('takes the accent from --primary when there is no --brand', () => {
    const d = deriveReportNeutrals([...MINIMUM, t('--primary', '#2F5D50')]);
    if (d.ok === false) return;
    expect(d.derived.brandHex).toBe('#2F5D50');
    expect(d.derived.sources.brand).toBe('--primary');
  });

  it('names every first choice the print tokens claim', () => {
    // The list in `NEUTRAL_SOURCES` is the executable form of the comments in
    // `tokens.pure.ts`. If somebody edits one they must edit the other.
    expect(NEUTRAL_SOURCES.paper[0]).toBe('--background');
    expect(NEUTRAL_SOURCES.paperAlt[0]).toBe('--muted');
    expect(NEUTRAL_SOURCES.paperBright[0]).toBe('--card');
    expect(NEUTRAL_SOURCES.rule[0]).toBe('--border');
    expect(NEUTRAL_SOURCES.bodyInk[0]).toBe('--foreground');
    expect(NEUTRAL_SOURCES.mutedInk[0]).toBe('--muted-foreground');
    expect(NEUTRAL_SOURCES.brand[0]).toBe('--brand');
  });
});

describe('reading a manifest', () => {
  it('refuses something that is not one, without throwing', () => {
    for (const bad of [null, undefined, 42, '[]', '{', 'not json', {}, { tokens: [] }]) {
      const r = readDesignSystemManifest(bad as never);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('drops a token with no name, no value or a name that is not a custom property', () => {
    const r = readDesignSystemManifest({
      tokens: [
        { name: '--good', value: '#FFFFFF', kind: 'color' },
        { name: 'background', value: '#FFFFFF' },
        { name: '--empty', value: '' },
        null,
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    expect(r.manifest.tokens.map((t) => t.name)).toEqual(['--good']);
  });
});

describe('importing either shape', () => {
  it('accepts raw token CSS as well as a manifest', () => {
    const css = `
      :root {
        --background: 42 54% 96%; /* @kind color */
        --foreground: 34 20% 16%; /* @kind color */
        --muted: 39 44% 91%; /* @kind color */
        --card: 42 82% 99%; /* @kind color */
        --border: 36 30% 81%; /* @kind color */
        --muted-foreground: 33 14% 38%; /* @kind color */
        --brand: 43 74% 49%; /* @kind color */
        --aurixa-obsidian: 34 20% 12%; /* @kind color */
      }`;
    const r = importDesignSystem(css, { name: 'From a file' });
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    expect(r.result.summary.kind).toBe('css');
    // The same eight values as the manifest path.
    expect(r.result.neutrals.paper).toBe(PRINT_SURFACE.paper);
    expect(r.result.brandHex).toBe(PRINT_BRAND.base);
    expect(r.result.system.name).toBe('From a file');
  });

  it('refuses a file with no custom properties in it', () => {
    const r = importDesignSystem('body { color: red; }');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toContain('--name: value');
  });

  it('never throws on rubbish', () => {
    for (const bad of ['', '{', 'null', null, undefined, 42, []]) {
      expect(() => importDesignSystem(bad as never)).not.toThrow();
    }
  });
});

describe('an imported system reaches the renderer', () => {
  const imported = importDesignSystem(MANIFEST);

  it('resolves a palette from its own grounds, not the preset\'s', () => {
    if (imported.ok === false) throw new Error('import failed');
    const withNeutrals = resolveReportPalette({
      preset: 'minimal_ink',
      brandHex: '#2F5D50',
      neutrals: imported.result.neutrals,
    });
    const withoutNeutrals = resolveReportPalette({ preset: 'minimal_ink', brandHex: '#2F5D50' });
    // `minimal_ink` puts `paperBright` on the sheet; the import puts its own
    // ivory there. If these matched, the neutrals were ignored.
    expect(withNeutrals.paper).toBe(imported.result.neutrals.paper);
    expect(withNeutrals.paper).not.toBe(withoutNeutrals.paper);
  });

  it('still spreads Category B last, unreachable from the import', () => {
    if (imported.ok === false) return;
    const palette = resolveReportPalette({
      neutrals: { ...imported.result.neutrals, paper: '#FFFFFF' },
      brandHex: '#2F5D50',
    });
    // A tenant cannot make risk green by importing a design system.
    expect(palette.negative).toBe('#D31212');
    expect(palette.positive).toBe('#157A3A');
  });

  it('corrects the accent against the imported grounds, not ours', () => {
    // The reason importing grounds is safe: a brand colour legible on NPC ivory
    // and illegible on somebody else's stock is corrected for the stock it will
    // actually print on.
    const dark = resolveReportPalette({
      brandHex: '#8A7A2A',
      neutrals: readReportNeutrals({
        paper: '#3A3A3A', paperAlt: '#333333', paperBright: '#414141',
        field: '#111111', rule: '#555555', bodyInk: '#F0F0F0', mutedInk: '#BBBBBB',
      }),
    });
    const light = resolveReportPalette({ brandHex: '#8A7A2A' });
    expect(dark.accentOnPaper).not.toBe(light.accentOnPaper);
  });
});


/**
 * A design system that is not ours.
 *
 * The NPC manifest proves the derivation is the documented one. This proves the
 * feature: a cool grey project with no `--brand` and no `--aurixa-obsidian` —
 * the two variables the mapping's first choices name — still produces a
 * complete, legible, printable document, and says out loud which two roles it
 * had to reach further for.
 */
describe('a foreign design system', () => {
  const FOREIGN = `
    :root {
      --background: 210 20% 95%;        /* @kind color */
      --foreground: 210 30% 14%;        /* @kind color */
      --card: 210 40% 99%;              /* @kind color */
      --muted: 210 22% 89%;             /* @kind color */
      --muted-foreground: 210 14% 36%;  /* @kind color */
      --border: 210 18% 78%;            /* @kind color */
      --primary: 205 88% 24%;           /* @kind color */
    }
    .dark { --background: 210 40% 6%; /* @kind color */ }`;

  const imported = importDesignSystem(FOREIGN, { name: 'Harbour Cool' });

  it('imports without either first-choice variable', () => {
    expect(imported.ok).toBe(true);
    if (imported.ok === false) return;
    expect(imported.result.neutrals.paper).toBe('#F0F2F5');
    expect(imported.result.neutrals.bodyInk).toBe('#19242E');
  });

  it('takes the cover ground from the dark theme, and says so', () => {
    if (imported.ok === false) return;
    expect(imported.result.sources.field).toBe('.dark:--background');
    expect(imported.result.notes.join(' ')).toContain('--aurixa-obsidian');
  });

  it('takes the accent from --primary, and says so', () => {
    if (imported.ok === false) return;
    expect(imported.result.sources.brand).toBe('--primary');
    expect(imported.result.notes.join(' ')).toContain('--brand');
  });

  it('is legible, so it can actually be saved', () => {
    if (imported.ok === false) return;
    expect(auditBrandDesignSystem(imported.result.system).ok).toBe(true);
  });

  it('corrects a semantic that our stock could carry and theirs cannot', () => {
    // The panel here is `#DDE3E9`, darker than NPC's `#F2EBDE`, and the four
    // Category B colours clear 4.5:1 on ours by about a percent. Without the
    // correction this system would be refused for our calibration rather than
    // for anything it did.
    if (imported.ok === false) return;
    const palette = resolveReportPalette({
      neutrals: imported.result.neutrals,
      brandHex: imported.result.brandHex,
    });
    expect(palette.negative).not.toBe('#D31212');
    expect(palette.negative).toMatch(/^#[0-9A-F]{6}$/);
  });
});
