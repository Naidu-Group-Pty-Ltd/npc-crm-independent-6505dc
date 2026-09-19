/**
 * The clause-amendment layer, on both real agreements.
 *
 * The whole feature rests on one invariant: the path the browser writes is the
 * path the server reads. Both come from the same traversal, so the risk is not
 * disagreement between them — it is a path that is not unique (two clauses
 * sharing one key would amend each other) or a template restructure silently
 * landing an old amendment on the wrong clause. These tests pin both, against
 * the real Strategic Property Referral and Finance Referral content rather than
 * a fixture, so a template edit that breaks uniqueness fails here.
 */
import { describe, expect, it } from 'vitest';
import {
  agreementTemplate,
  agreementContentForValues,
  applyAgreementContentOverrides,
  contentOverridesFromValues,
  listAgreementAmendments,
  listAgreementContentSlots,
  normaliseContentOverrides,
  CONTENT_OVERRIDES_VALUE_KEY,
  type AgreementTemplateKey,
} from '@/lib/agreements';

const KEYS: AgreementTemplateKey[] = ['strategic_property_referral', 'finance_referral_commission'];

describe.each(KEYS)('agreement content overrides — %s', (key) => {
  const content = agreementTemplate(key);
  const slots = listAgreementContentSlots(content);

  it('enumerates amendable text and every path is unique', () => {
    expect(slots.length).toBeGreaterThan(50);
    expect(new Set(slots.map((slot) => slot.path)).size).toBe(slots.length);
  });

  it('leaves the template untouched when there is nothing to apply', () => {
    expect(applyAgreementContentOverrides(content, {})).toBe(content);
    expect(applyAgreementContentOverrides(content, null)).toBe(content);
  });

  it('applies an amendment at exactly one path', () => {
    const target = slots.find((slot) => slot.multiline)!;
    const amended = applyAgreementContentOverrides(content, { [target.path]: 'AMENDED WORDING' });
    const after = listAgreementContentSlots(amended);
    expect(after.find((slot) => slot.path === target.path)!.text).toBe('AMENDED WORDING');
    expect(after.filter((slot) => slot.text === 'AMENDED WORDING')).toHaveLength(1);
    // Nothing else moved.
    expect(after.filter((slot, i) => slot.text !== slots[i].text)).toHaveLength(1);
    // And the supplied template is still the supplied template.
    expect(listAgreementContentSlots(agreementTemplate(key))).toEqual(slots);
  });

  it('drops stale paths and no-op restatements rather than guessing', () => {
    const target = slots[3];
    const cleaned = normaliseContentOverrides(content, {
      's:does-not-exist/b:0/body': 'orphaned by a restructure',
      [target.path]: target.text, // identical — not an amendment
      [slots[4].path]: '   ', // a clause cannot be blanked by accident
    });
    expect(cleaned).toEqual({});
  });

  it('reads amendments off field values, the way a version row freezes them', () => {
    const target = slots.find((slot) => slot.multiline)!;
    const values = { [CONTENT_OVERRIDES_VALUE_KEY]: { [target.path]: 'Negotiated wording.' } };
    expect(contentOverridesFromValues(values)).toEqual({ [target.path]: 'Negotiated wording.' });

    const rendered = agreementContentForValues(key, values);
    expect(listAgreementContentSlots(rendered).find((s) => s.path === target.path)!.text)
      .toBe('Negotiated wording.');

    const listed = listAgreementAmendments(content, contentOverridesFromValues(values));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      path: target.path,
      original: target.text,
      amended: 'Negotiated wording.',
      sectionId: target.sectionId,
    });
  });

  it('every amendable node belongs to a section that renders', () => {
    const sectionIds = new Set(content.sections.map((section) => section.id));
    for (const slot of slots) expect(sectionIds.has(slot.sectionId)).toBe(true);
  });
});
