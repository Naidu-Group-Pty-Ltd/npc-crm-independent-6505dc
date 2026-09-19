/**
 * Every colour that sets TYPE is a contrast-derived role.
 *
 * REPORT_RULES §2 puts the floor at 7:1 below 14pt, and this library sets
 * almost everything below 14pt: eyebrows at 5.8–6.8pt, running heads and folios
 * at 5.9–6.2pt, KPI labels and column heads at 5.8–6.2pt, table cells at
 * 7.8–8.6pt, body at 8.2–9.6pt. Measured against that floor, the approved
 * `muted` clears it in 0 of the 100 colourways and the approved `accent` in 40.
 *
 * The approved values are not the thing to change — the transcription check in
 * `templateColourways.spec.ts` exists to fail when an engineer "improves" one.
 * So four roles are DERIVED, two per ground:
 *
 *   on paper       mutedInk       accentInk
 *   on the field   mutedOnField   accentOnField
 *
 * This test is the coverage half of that. It walks every block of every
 * template in the library and asserts that no colour which lands on TYPE is
 * still one of the raw roles. When it was written, 11,621 sites were — 5,032
 * callout eyebrows, 4,350 markdown headings, 2,107 two-column labels and the
 * rest — all produced by eight helper call sites, which is why a spot check of
 * one template could never have found them.
 *
 * Rules are deliberately exempt. `divider` is a rule; an accent hairline is a
 * design element, not type, and has no contrast floor to meet.
 */
import { describe, expect, it } from 'vitest';
import { SEED_TEMPLATES } from '../../../../scripts/template-library/templates';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/borrowingCapacity';
import { PORTFOLIO_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/portfolio';
import { COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/comparison';
import { CASH_FLOW_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlow';
import { CLIENT_DETAILS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/clientDetails';
import { CASH_FLOW_COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlowComparison';
import { REPORT_QA_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/reportQa';
import { COMMERCIAL_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/commercialCapacity';
import { MARKET_INTELLIGENCE_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/marketIntelligence';

const GROUPS: ReadonlyArray<readonly [string, ReadonlyArray<any>]> = [
  ['voice', SEED_TEMPLATES],
  ['investment-compass', INVESTMENT_COMPASS_TEMPLATES],
  ['borrowing-capacity', BORROWING_CAPACITY_TEMPLATES],
  ['portfolio', PORTFOLIO_TEMPLATES],
  ['comparison', COMPARISON_TEMPLATES],
  ['cash-flow', CASH_FLOW_COMPASS_TEMPLATES],
  ['client-details', CLIENT_DETAILS_TEMPLATES],
  ['cash-flow-comparison', CASH_FLOW_COMPARISON_TEMPLATES],
  ['report-qa', REPORT_QA_TEMPLATES],
  ['commercial-capacity', COMMERCIAL_CAPACITY_TEMPLATES],
  ['market-intelligence', MARKET_INTELLIGENCE_TEMPLATES],
];

/** Props whose value colours TYPE. Fills, rules and grounds are not here. */
const TYPE_COLOUR_PROPS = new Set([
  'color', 'eyebrowColor', 'headingColor', 'bodyColor', 'labelColor',
  'captionColor', 'valueColor', 'cellFg', 'headerFg', 'sectionFg', 'titleFg',
  'titleColor', 'mutedColor', 'noteColor', 'textColor',
]);

/** The approved roles, which are chosen for the sizes they were designed at. */
const RAW_ROLES = new Set(['token:muted', 'token:primary', 'token:line']);

/** A rule is not type. `color` on a divider is the rule's own colour. */
const RULE_BLOCKS = new Set(['divider', 'rule', 'hairline']);

interface Site {
  label: string;
  block: string;
  prop: string;
  role: string;
}

function offendingSites(): Site[] {
  const out: Site[] = [];
  for (const [format, templates] of GROUPS) {
    for (const t of templates) {
      const schema = (t as any).schema ?? t;
      for (const page of schema.pages ?? []) {
        for (const b of page.blocks ?? []) {
          if (RULE_BLOCKS.has(b.type)) continue;
          for (const [prop, value] of Object.entries(b.props ?? {})) {
            if (!TYPE_COLOUR_PROPS.has(prop)) continue;
            if (typeof value !== 'string' || !RAW_ROLES.has(value)) continue;
            out.push({
              label: `${format} / ${(t as any).name ?? (t as any).slug} / ${page.name}`,
              block: b.type,
              prop,
              role: value,
            });
          }
        }
      }
    }
  }
  return out;
}

describe('print inks reach every template', () => {
  it('covers all eleven template groups', () => {
    const total = GROUPS.reduce((n, [, set]) => n + set.length, 0);
    expect(GROUPS).toHaveLength(11);
    expect(total).toBe(543);
  });

  it('sets no type in a role that was never derived for its size', () => {
    const sites = offendingSites();
    // Named, not counted: a failure should say which helper to look at rather
    // than that a number moved.
    const summary = [...new Set(sites.map((s) => `${s.role} via ${s.prop} on ${s.block}`))];
    expect(summary, `${sites.length} site(s) still on a raw role`).toEqual([]);
  });

  it('still lets a rule be drawn in the approved accent', () => {
    // The exemption is real and load-bearing: 8,187 dividers carry
    // `token:line` or `token:primary`, and they should. If this ever reads 0,
    // the exemption has been removed and every hairline in the library has
    // silently become a derived ink.
    let rules = 0;
    for (const [, templates] of GROUPS) {
      for (const t of templates) {
        for (const page of ((t as any).schema ?? t).pages ?? []) {
          for (const b of page.blocks ?? []) {
            if (!RULE_BLOCKS.has(b.type)) continue;
            if (RAW_ROLES.has(String((b.props ?? {}).color))) rules += 1;
          }
        }
      }
    }
    expect(rules).toBeGreaterThan(1000);
  });
});
