/**
 * One token, three derivations — and the odd one out served a tenant's brand.
 *
 * `accentOnField` is the brand's type on the dark cover ground. It is derived
 * in three places:
 *
 * | path | floor |
 * | --- | --- |
 * | `templateColourways.pure.ts` — the 500 seeded masters | `PRINT_SMALL_TYPE_CONTRAST` = 7 |
 * | `designSystem.ts` — the 43 voice templates | `PRINT_SMALL_TYPE_CONTRAST` = 7 |
 * | `brandResolve.pure.ts` — a tenant's own brand hex | `CONTRAST_FLOOR.display` = **4.5** |
 *
 * Two agreed; the third did not, and `roles.pure.ts` declared `display` for
 * it — directly under a docstring reading *"the cover eyebrow and rule"*.
 * `REPORT_RULES.md` §2 puts an eyebrow in the `< 10pt` band at 7:1 and names
 * this exact case: *"It fails at the 8.5pt eyebrow that is the brand's own
 * signature."* `.eyebrow` is set at `type.caption`, which is 8.5.
 *
 * Measured over the catalogue's hundred approved accents before the fix:
 * **89 of 100** resolved between 4.5 and 4.7:1 on the field, while the same
 * element on paper sat at 7.83 through `accentOnPaper`.
 *
 * A correction recorded with it: the `#D5A220` this programme noted as a "raw
 * hex at 8pt" in the delivered document is **not raw and not a defect**. It is
 * exactly `ensureContrast('#AD831A', field, 7)` — the colourway path's own
 * correctly corrected value, at 7.00:1.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveReportPalette } from '../brandResolve.pure';
import { contrastRatio } from '../color.pure';
import { INK_LEGALITY } from '../roles.pure';
import { CONTRAST_FLOOR, PRINT_BRAND } from '../tokens.pure';
import { PRINT_SMALL_TYPE_CONTRAST } from '../../../../supabase/functions/_shared/templateColourways.pure';
import * as COLOURWAYS from '../../../../supabase/functions/_shared/templateColourways.generated';

const REPO = resolve(__dirname, '../../../..');

/** Every approved accent in the catalogue, as a brand hex a tenant could bring. */
const accents = Object.values(COLOURWAYS)
  .filter((v): v is ReadonlyArray<Record<string, unknown>> => Array.isArray(v))
  .flatMap((list) => list.map((c) => c.accent))
  .filter((a): a is string => typeof a === 'string');

describe('the field accent is judged at the size it is drawn', () => {
  it('is declared at the micro floor, like every other small-type role', () => {
    expect(INK_LEGALITY.accentOnField.floor).toBe('micro');
    // Its siblings, for the comparison that made it the odd one out.
    expect(INK_LEGALITY.accentOnPaper.floor).toBe('micro');
    expect(INK_LEGALITY.mutedInk.floor).toBe('micro');
  });

  it('the micro floor is the 7:1 REPORT_RULES §2 sets under 10pt', () => {
    expect(CONTRAST_FLOOR.micro).toBe(7);
  });

  it('agrees with the two template-library derivations of the same token', () => {
    // Two copies of a rule is how the two come to disagree; three was worse.
    expect(PRINT_SMALL_TYPE_CONTRAST).toBe(CONTRAST_FLOOR.micro);
    for (const file of [
      'supabase/functions/_shared/templateColourways.pure.ts',
      'scripts/template-library/designSystem.ts',
    ]) {
      const src = readFileSync(resolve(REPO, file), 'utf8');
      expect(src, file).toMatch(/accentOnField:\s*toPrintContrast\([^)]*PRINT_SMALL_TYPE_CONTRAST\)/);
    }
  });

  it('every approved accent clears 7:1 on the field once resolved', () => {
    const under = accents
      .map((brandHex) => {
        const p = resolveReportPalette({ brandHex });
        return { brandHex, ratio: contrastRatio(p.accentOnField, p.field) };
      })
      .filter((r) => r.ratio < CONTRAST_FLOOR.micro);
    expect(under.map((u) => `${u.brandHex} ${u.ratio.toFixed(2)}`)).toEqual([]);
  });

  it('measured 100 accents, so the sweep is over the real catalogue', () => {
    expect(accents).toHaveLength(100);
  });

  it('the default palette is byte-identical — it already cleared the floor', () => {
    const p = resolveReportPalette({});
    // Asserted as the PASS-THROUGH rather than as a literal: the default is
    // whatever `PRINT_BRAND.onField` says, uncorrected, and the point is that
    // the stricter floor does not move it.
    expect(p.accentOnField).toBe(PRINT_BRAND.onField);
    expect(contrastRatio(p.accentOnField, p.field)).toBeGreaterThanOrEqual(CONTRAST_FLOOR.micro);
  });

  it('the correction walks lightness only, so no accent changes hue', () => {
    const hue = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
      if (d === 0) return 0;
      const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return ((h * 60) + 360) % 360;
    };
    for (const brandHex of accents) {
      const out = resolveReportPalette({ brandHex }).accentOnField;
      const delta = Math.abs(hue(brandHex) - hue(out));
      expect(Math.min(delta, 360 - delta), `${brandHex} -> ${out}`).toBeLessThan(2.5);
    }
  });
});
