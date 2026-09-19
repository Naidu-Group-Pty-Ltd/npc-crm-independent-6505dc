import { describe, expect, it } from 'vitest';
import {
  ORG_DISCLAIMER_BINDING,
  ORG_DISCLAIMER_SIZE_BINDING,
  bindOrganisationDisclaimer,
  hasUnboundDisclaimer,
} from '../../../../supabase/functions/_shared/reports/disclaimerBinding.pure';

/**
 * The disclaimer belongs to the deployment, and a template is a copy.
 *
 * v7 bound all 543 `template_library_entries` to `{{org.disclaimer}}`. The
 * twelve rows in `report_templates` were copied from the catalogue the day
 * before, kept the literal, and `disclaimer.html.ts` honours a literal for
 * ever — it only reaches its fallback when the binding resolves empty. So
 * editing Report Settings moved nothing on the formats people had chosen.
 *
 * The shapes below are production's, not invented: the 415-character standard
 * text the activation copied, and the numeric `8` those masters passed for a
 * size prop whose vocabulary is `small | medium | large`.
 */
const BAKED = 'This report has been prepared for the named recipient only and is general in nature.';

const schemaWith = (props: Record<string, unknown>) => ({
  pages: [
    { name: 'Cover', blocks: [{ type: 'hero', props: { title: 'x' } }] },
    { name: 'Important information', blocks: [{ type: 'disclaimer', props }] },
  ],
});

describe('binding a template disclaimer to the deployment', () => {
  it('binds a baked literal and keeps it as the fallback', () => {
    const bound: any = bindOrganisationDisclaimer(
      schemaWith({ companyName: '{{org.name}}', disclaimerText: BAKED, fontSize: 8 }),
    );
    const props = bound.pages[1].blocks[0].props;

    expect(props.disclaimerText).toBe(ORG_DISCLAIMER_BINDING);
    expect(props.fontSize).toBe(ORG_DISCLAIMER_SIZE_BINDING);
    // Nothing is thrown away — a deployment that sets no disclaimer, or turns
    // it off, still prints exactly what it printed before.
    expect(props.disclaimerFallback).toBe(BAKED);
    // `8` matches none of the three size tokens and fell through to 8.5pt, which
    // is what `small` renders at, so the size on the page does not move.
    expect(props.fontSizeFallback).toBe('small');
    // Every other org field is left exactly as it was.
    expect(props.companyName).toBe('{{org.name}}');
  });

  it('is idempotent, and returns the same object when nothing needs changing', () => {
    const already = schemaWith({
      disclaimerText: ORG_DISCLAIMER_BINDING,
      disclaimerFallback: BAKED,
      fontSize: ORG_DISCLAIMER_SIZE_BINDING,
      fontSizeFallback: 'small',
    });
    // Identity, so a caller can apply it unconditionally without rewriting rows
    // that are already correct — which is what keeps `updated_at` honest.
    expect(bindOrganisationDisclaimer(already)).toBe(already);
    expect(hasUnboundDisclaimer(already)).toBe(false);

    const fixed = bindOrganisationDisclaimer(
      schemaWith({ disclaimerText: BAKED, fontSize: 8 }),
    );
    expect(bindOrganisationDisclaimer(fixed)).toBe(fixed);
  });

  it('never overwrites a fallback somebody authored', () => {
    const bound: any = bindOrganisationDisclaimer(
      schemaWith({ disclaimerText: BAKED, disclaimerFallback: 'Authored wording', fontSize: 'large' }),
    );
    const props = bound.pages[1].blocks[0].props;
    expect(props.disclaimerFallback).toBe('Authored wording');
    expect(props.fontSizeFallback).toBe('large');
    expect(props.disclaimerText).toBe(ORG_DISCLAIMER_BINDING);
  });

  it('binds a block that carries no text at all', () => {
    // An empty `disclaimerText` would resolve to the empty string and print a
    // blank foot; binding it means the deployment's text reaches the page.
    const bound: any = bindOrganisationDisclaimer(schemaWith({}));
    const props = bound.pages[1].blocks[0].props;
    expect(props.disclaimerText).toBe(ORG_DISCLAIMER_BINDING);
    expect(props.fontSizeFallback).toBe('small');
    // There was no literal, so nothing is invented as a fallback.
    expect(props.disclaimerFallback).toBeUndefined();
  });

  it('leaves every other block, and malformed schemas, alone', () => {
    const untouched = { pages: [{ name: 'x', blocks: [{ type: 'hero', props: { title: 'a' } }] }] };
    expect(bindOrganisationDisclaimer(untouched)).toBe(untouched);

    // Nine rows in `report_templates` carry a page whose `blocks` array is
    // empty; a rewrite that cannot survive one is how a schema gets nulled out.
    const empties: any = { pages: [{ name: 'blank', blocks: [] }, { name: 'no blocks key' }] };
    expect(bindOrganisationDisclaimer(empties)).toBe(empties);

    expect(bindOrganisationDisclaimer(null)).toBeNull();
    expect(bindOrganisationDisclaimer({ pages: 'not-an-array' } as never))
      .toEqual({ pages: 'not-an-array' });
  });
});
