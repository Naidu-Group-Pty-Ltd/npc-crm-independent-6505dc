/**
 * Every colour a report can print must be legible where it is allowed to print.
 *
 * The table in `roles.pure.ts` declares which grounds each ink role is legal on
 * and what floor it must clear. This iterates it, so **a new role cannot be
 * added without declaring its legibility** — the check comes for free.
 *
 * Why this exists: the brand gold is 2.1:1 on ivory. Every previous attempt to
 * fix that by eye produced another hardcoded hex, and the codebase now carries
 * eight golds. A test is the only thing that makes the floor real.
 */
/* eslint-disable no-restricted-syntax --
 * Fixture colours. These are deliberately hostile tenant brands chosen to break
 * the resolver, and expected-value assertions — not palette choices.
 */
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../color.pure';
import {
  auditPaletteContrast,
  NEUTRAL_ROLES,
  readReportNeutrals,
  type ReportNeutrals,
  resolveReportPalette,
  type ReportPreset,
} from '../brandResolve.pure';
import { INK_LEGALITY, type ResolvedReportPalette } from '../roles.pure';
import { CONTRAST_FLOOR, PRINT_SEMANTIC } from '../tokens.pure';

const PRESETS: ReportPreset[] = ['signature', 'editorial_navy', 'minimal_ink', 'high_contrast'];

/** Brands chosen to stress the resolver, not to flatter it. */
const TENANT_BRANDS: Array<[string, string | null]> = [
  ['NPC default', null],
  ['bright cyan', '#00A3FF'],
  ['near-black', '#111111'],
  ['near-white', '#FFFDF5'],
  ['saturated red', '#FF0000'],
  ['mid grey', '#808080'],
];

/**
 * Hue in degrees, for asserting that a correction moved lightness only.
 *
 * At module scope because two describes need it: `brought neutrals`, which has
 * always used it, and `Category B is fixed`, which asserts the frozen hue now
 * that the semantics are corrected for the stock they print on.
 */
const HUE_TOLERANCE_DEGREES = 2;

/**
 * "Lightness only" as an assertion.
 *
 * A stated tolerance rather than `toBeCloseTo(..., 0)`, which admits 0.5°:
 * stepping lightness re-quantises to 8 bits per channel, so a hue that did not
 * move can still read 0.7° away. Two degrees is invisible and still fails any
 * real hue change — the nearest semantic hues here are 145° apart.
 */
const expectSameHue = (a: string, b: string, what: string): void => {
  expect(Math.abs(hueOf(a) - hueOf(b)), `${what}: hue moved`).toBeLessThan(HUE_TOLERANCE_DEGREES);
};

const hueOf = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
};

describe('print contrast floors', () => {
  describe.each(PRESETS)('preset %s', (preset) => {
    describe.each(TENANT_BRANDS)('tenant brand %s', (_label, brandHex) => {
      const palette = resolveReportPalette({ preset, brandHex });

      it('has no role failing its declared floor', () => {
        const problems = auditPaletteContrast(palette);
        const readable = problems.map(
          (p) => `${p.role} on ${p.ground}: ${p.ratio.toFixed(2)}:1 < ${p.floor}:1`,
        );
        expect(readable).toEqual([]);
      });

      it.each(Object.entries(INK_LEGALITY))(
        '%s clears its floor on every legal ground',
        (role, rule) => {
          const fg = palette[role as keyof ResolvedReportPalette];
          const floor = CONTRAST_FLOOR[rule.floor];
          for (const ground of rule.grounds) {
            const bg = palette[ground as keyof ResolvedReportPalette];
            expect(
              contrastRatio(fg, bg),
              `${role} (${fg}) on ${ground} (${bg})`,
            ).toBeGreaterThanOrEqual(floor);
          }
        },
      );
    });
  });

  it('every ink role is present in the resolved palette', () => {
    const palette = resolveReportPalette();
    for (const role of Object.keys(INK_LEGALITY)) {
      expect(palette[role as keyof ResolvedReportPalette], role).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe('Category B is fixed', () => {
  /*
   * Renegotiated when `CONTRAST_FLOOR.body` was corrected from 4.5 to the 7
   * `REPORT_RULES.md` §2 has always specified.
   *
   * This asserted byte-identity with `PRINT_SEMANTIC`, and that held only
   * because the correction was a no-op at 4.5 — the constants are documented
   * as "darkened to clear 4.5:1 on the darkest stock", so at 7 they move
   * (`#157A3A` → `#0F5729`). The floors are SIZE BANDS: a semantic used at
   * 10-13pt must meet the 10-13pt floor or it is not readable, and §2 says so
   * outright — "keep hue and saturation, clamp lightness into the 30-36%
   * band".
   *
   * What "Category B is FIXED" protects is that a TENANT cannot move them.
   * That is the property, and it is what is asserted now: for any stock, every
   * tenant brand resolves the same four semantics, and each keeps the frozen
   * constant's hue. The bytes were incidental.
   */
  it('does not vary with the tenant brand, and keeps the frozen hue', () => {
    for (const preset of PRESETS) {
      const [, firstBrand] = TENANT_BRANDS[0];
      const reference = resolveReportPalette({ preset, brandHex: firstBrand });
      for (const [, brandHex] of TENANT_BRANDS) {
        const p = resolveReportPalette({ preset, brandHex });
        for (const role of ['positive', 'caution', 'negative', 'informative'] as const) {
          expect(p[role], `${role} moved with the tenant brand on ${preset}`).toBe(reference[role]);
          expectSameHue(p[role], PRINT_SEMANTIC[role], role);
        }
      }
    }
  });

  it('clears the floor its own role declares, on every legal ground', () => {
    // The reason it moves at all. Before the floor was corrected these sat at
    // 4.5 while their declared band asks for 7.
    for (const preset of PRESETS) {
      const p = resolveReportPalette({ preset });
      expect(auditPaletteContrast(p).filter((x) => x.role in PRINT_SEMANTIC)).toEqual([]);
    }
  });

  it('cannot be reached through the resolver input', () => {
    // Deliberately hostile: a caller trying to smuggle semantics through.
    const smuggled = resolveReportPalette({
      brandHex: '#00FF00',
      // @ts-expect-error — there is no such input, and that is the point.
      negative: '#00FF00',
      positive: '#FF0000',
    });
    // The guarantee is that the INPUT made no difference — not that the result
    // is the raw constant, which stopped being true when the semantics started
    // being corrected for the stock they print on.
    const clean = resolveReportPalette({ brandHex: '#00FF00' });
    expect(smuggled.negative).toBe(clean.negative);
    expect(smuggled.positive).toBe(clean.positive);
    expectSameHue(smuggled.negative, PRINT_SEMANTIC.negative, 'negative');
    expectSameHue(smuggled.positive, PRINT_SEMANTIC.positive, 'positive');
  });

  it('is frozen at runtime', () => {
    expect(Object.isFrozen(PRINT_SEMANTIC)).toBe(true);
  });
});


/**
 * Paper and ink a caller brought, rather than a preset name.
 *
 * The parameter exists for design systems imported from a Claude Design
 * project, whose token file carries a real stock the four presets cannot
 * express. Two things have to stay true: the nine live render routes, none of
 * which passes it, must behave exactly as before; and an unreadable set must
 * fall back to the preset whole rather than half.
 */
describe('brought neutrals', () => {

  /** A dark stock, so a failure to apply it is visible rather than subtle. */
  const SLATE: ReportNeutrals = {
    paper: '#2E3338',
    paperAlt: '#272B30',
    paperBright: '#353B41',
    field: '#0E1113',
    rule: '#4A5157',
    bodyInk: '#F1F3F5',
    mutedInk: '#B8C0C7',
  };

  it('leaves every existing caller byte-identical', () => {
    // The nine render routes all call `{ preset, brandHex }` and none passes
    // neutrals. This is the assertion that they are provably untouched rather
    // than presumed to be.
    for (const preset of PRESETS) {
      for (const [label, brandHex] of TENANT_BRANDS) {
        expect(
          resolveReportPalette({ preset, brandHex }),
          `${preset} / ${label}`,
        ).toEqual(resolveReportPalette({ preset, brandHex, neutrals: null }));
      }
    }
  });

  /*
   * Renegotiated with `CONTRAST_FLOOR.micro`'s correction from 4.5 to §2's 7.
   *
   * This asserted that every one of `NEUTRAL_ROLES` comes through byte-
   * identical, and `mutedInk` is in that list. It is an INK, not a ground, and
   * the test directly below has always established that inks are corrected for
   * the brought stock rather than passed through — that is the whole reason
   * importing grounds is safe. `mutedInk` was simply the one ink that was not
   * corrected, which is what made its byte-identity true.
   *
   * So the grounds still come through untouched, and the inks are now judged
   * the way the accent already was.
   */
  const BROUGHT_GROUNDS = ['paper', 'paperAlt', 'paperBright', 'field', 'rule'] as const;

  it('replaces the preset\'s grounds when it is given', () => {
    const brought = resolveReportPalette({ preset: 'minimal_ink', neutrals: SLATE });
    const preset = resolveReportPalette({ preset: 'minimal_ink' });
    for (const role of BROUGHT_GROUNDS) {
      expect(brought[role], role).toBe(SLATE[role]);
      expect(brought[role], role).not.toBe(preset[role]);
    }
  });

  it('corrects the brought stock\'s inks against it, as it does the accent', () => {
    const brought = resolveReportPalette({ preset: 'minimal_ink', neutrals: SLATE });
    // The body ink already clears its floor on slate, so it is untouched.
    expect(brought.bodyInk).toBe(SLATE.bodyInk);
    // The muted ink does not: `#B8C0C7` measures below 7:1 on that stock, and
    // is lightened for it — lightness only, and only far enough to be read.
    expect(brought.mutedInk).not.toBe(SLATE.mutedInk);
    expectSameHue(brought.mutedInk, SLATE.mutedInk, 'mutedInk');
    for (const ground of ['paper', 'paperAlt', 'paperBright'] as const) {
      expect(contrastRatio(brought.mutedInk, SLATE[ground]), ground)
        .toBeGreaterThanOrEqual(CONTRAST_FLOOR.micro);
    }
  });

  it('corrects the accent against the brought grounds, not the preset\'s', () => {
    // The reason importing grounds is safe at all: a tenant colour legible on
    // ivory and illegible on slate is corrected for the stock it will print on.
    const onSlate = resolveReportPalette({ brandHex: '#6B4A16', neutrals: SLATE });
    const onIvory = resolveReportPalette({ brandHex: '#6B4A16' });
    expect(onSlate.accentOnPaper).not.toBe(onIvory.accentOnPaper);
    expect(contrastRatio(onSlate.accentOnPaper, SLATE.paperAlt))
      .toBeGreaterThanOrEqual(CONTRAST_FLOOR.micro);
  });

  it('keeps the semantic hue while making it legible on a brought stock', () => {
    // Not byte-identity — that was the contract while the grounds were four
    // permutations of three constants we chose. On a dark stock the four
    // semantics have to lighten or they are unreadable, so what is frozen is
    // the *hue*: risk stays red, it just stops being a red nobody can see.
    const onSlate = resolveReportPalette({ neutrals: SLATE });
    expect(onSlate.negative).not.toBe(PRINT_SEMANTIC.negative);
    expect(hueOf(onSlate.negative)).toBeCloseTo(hueOf(PRINT_SEMANTIC.negative), 0);
    expect(hueOf(onSlate.positive)).toBeCloseTo(hueOf(PRINT_SEMANTIC.positive), 0);
    expect(contrastRatio(onSlate.negative, SLATE.paper))
      .toBeGreaterThanOrEqual(CONTRAST_FLOOR.body);
  });

  it('is still unreachable from any input', () => {
    const p = resolveReportPalette({
      // @ts-expect-error — smuggling a semantic through the one new input.
      neutrals: { ...SLATE, negative: '#00FF00' },
      brandHex: '#00FF00',
    });
    // Green is 120°. If the smuggle had worked this would be 120, not 0.
    expect(hueOf(p.negative)).toBeCloseTo(hueOf(PRINT_SEMANTIC.negative), 0);
  });

  it('audits brought grounds with the machinery that already exists', () => {
    // No new gate: an imported stock that cannot carry its own ink is caught by
    // the same table-driven audit every preset goes through.
    expect(auditPaletteContrast(resolveReportPalette({ neutrals: SLATE }))).toEqual([]);

    const illegible = resolveReportPalette({
      neutrals: { ...SLATE, bodyInk: '#31353A' },
    });
    expect(auditPaletteContrast(illegible).length).toBeGreaterThan(0);
  });

  describe('readReportNeutrals is all seven or none', () => {
    it('reads a complete set and upper-cases it', () => {
      const lower = Object.fromEntries(
        NEUTRAL_ROLES.map((r) => [r, SLATE[r].toLowerCase()]),
      );
      expect(readReportNeutrals(lower)).toEqual(SLATE);
    });

    it('refuses the whole set when any single role is broken', () => {
      // Verified by breaking each role in turn, because "all seven or none" is
      // the rule and a loop is the only way to know it holds for all seven. A
      // half-read set prints somebody else's obsidian on our ivory, which looks
      // like a choice and is a parse error.
      for (const role of NEUTRAL_ROLES) {
        for (const broken of [undefined, null, '', 'slate', '#FFF', '#GGGGGG', 42, {}]) {
          expect(
            readReportNeutrals({ ...SLATE, [role]: broken }),
            `${role} = ${String(broken)}`,
          ).toBeNull();
        }
        const { [role]: _dropped, ...withoutRole } = SLATE;
        expect(readReportNeutrals(withoutRole), `missing ${role}`).toBeNull();
      }
    });

    it('never throws, whatever it is handed', () => {
      for (const bad of [null, undefined, 0, '', 'x', [], () => {}]) {
        expect(() => readReportNeutrals(bad as never)).not.toThrow();
        expect(readReportNeutrals(bad as never)).toBeNull();
      }
    });

    it('sends an unreadable set back to the preset, whole', () => {
      const broken = resolveReportPalette({
        preset: 'high_contrast',
        // @ts-expect-error — exactly the shape a hand-edited jsonb column has.
        neutrals: { paper: '#FFFFFF' },
      });
      expect(broken).toEqual(resolveReportPalette({ preset: 'high_contrast' }));
    });
  });
});
