/**
 * What the document must be, structurally, before anyone looks at a page.
 *
 * Almost every section of this format is conditional, so the failure most likely
 * to happen is a contents page listing something that was not built — and that
 * is invisible in the PDF bytes and visible here.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { writeRenderArtifact } from '../../__tests__/renderArtifact';
import { buildClientDetails } from '../normalise.pure';
import { DOCUMENT_NAME, renderClientDetailsFromBrand } from '../render.pure';
import {
  clientDetailsSections,
  clientDetailsSpine,
  validateClientDetailsSpine,
} from '../sections.pure';
import {
  clientDetailsFileName,
  clientDetailsReference,
  clientDetailsStoragePath,
  parseRenderRequest,
} from '../route.pure';
import { contentsEntriesFor, REPORT_ARCHETYPES, spinePageBudget } from '@/lib/reportDesign/structure.pure';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';

const NOW = '2026-08-02T00:00:00.000Z';
const ID = '11111111-1111-4111-8111-111111111111';

// A white-label tenant, so "the cover carries theirs and not ours" is falsifiable.
const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: 'Tenant Advisory', brandColour: '#B8873A', preset: 'signature' },
  contact: { company_name: 'Tenant Advisory Pty Ltd', abn: '11 222 333 444' },
  capturedAt: NOW,
});

const build = (over: Record<string, unknown> = {}) => buildClientDetails({
  client: { id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace' },
  now: NOW,
  ...over,
});

const render = (over: Record<string, unknown> = {}) =>
  renderClientDetailsFromBrand({ details: build(over), snapshot }).html;

const FULL = {
  client: {
    id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace',
    current_address: '12 Example Street', current_suburb: 'Suburbia',
    current_state: 'vic', current_postcode: '3000', marital_status: 'married',
    dependents_count: 2,
  },
  properties: [
    { property_type: 'owner_occupied', address: 'Home, Suburbia', value: 900_000, loan_remaining: 400_000 },
    { property_type: 'investment', address: 'Unit 7, 118 Mariners Quay, Newstead', value: 600_000, loan_remaining: 500_000, monthly_rental_income: 2_400 },
  ],
  employment: [{ contact_type: 'primary', employer_name: 'Analytical Engines', gross_annual_salary: 150_000 }],
  assets: [{ asset_type: 'savings', description: 'Offset', value: 40_000 }],
  liabilities: [{ liability_type: 'credit_card', provider_name: 'Meridian', credit_limit: 10_000, monthly_repayment: 0 }],
  expenses: [
    { expense_category: 'groceries', monthly_amount: 900, frequency: 'monthly' },
    { expense_category: 'utilities', monthly_amount: 300, frequency: 'monthly' },
    { expense_category: 'transport', monthly_amount: 400, frequency: 'monthly' },
  ],
};

describe('the contents page cannot claim something that was not printed', () => {
  it.each([
    ['a name-only record', {}],
    ['a full record', FULL],
  ])('lists exactly the sections built, in printed order — %s', (_label, over) => {
    const p = build(over as Record<string, unknown>);
    expect(contentsEntriesFor(clientDetailsSpine(p)).map((e) => e.title))
      .toEqual(clientDetailsSections(p).map((s) => s.title));
  });
});

/** The document, on disk, for the eye — the fullest fixture. See `renderArtifact.ts`. */
beforeAll(() => {
  writeRenderArtifact('client-details', render(FULL));
});

describe('the 97% case is a finished document', () => {
  /**
   * 745 of 771 clients have no property. If this collapses, the format cannot
   * serve most of the book — and the very first render of this document refused
   * exactly this record, five pages against a floor of six.
   */
  it('renders a client with nothing but a name', () => {
    const html = render();
    expect(html).toContain('Who this is about');
    expect(html).toContain('Where they stand');
    expect(html).toContain('No financial information is recorded for this client');
    expect(html).toContain('This document is complete');
  });

  it('has no property sections at all', () => {
    const html = render();
    for (const absent of ['Where they live', 'The property portfolio', 'Each property in turn']) {
      expect(html).not.toContain(absent);
    }
  });

  it('adds each section only when the record holds it', () => {
    const full = render(FULL);
    for (const title of [
      'Where they live', 'Work and income', 'What they own and owe',
      'What they spend', 'The property portfolio', 'Each property in turn',
    ]) {
      expect(render()).not.toContain(title);
      expect(full).toContain(title);
    }
  });
});

describe('nothing on the page is an emoji', () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

  /**
   * The legacy carries `🏠 📈 🏛️ 💸` in headings and `✓ ✗ ⏳ ▲ ▼ ●` in status
   * cells. Safe in a raster of the browser's own rendering; tofu in real text,
   * because the design system's faces have no emoji coverage.
   */
  it('sets every status and type as a word', () => {
    const html = render({
      ...FULL,
      properties: [
        ...FULL.properties,
        { property_type: 'smsf', address: 'Fund holding', smsf_compliance_status: 'pending_audit', smsf_trustee_type: 'corporate' },
      ],
    });
    expect(html).not.toMatch(EMOJI);
    expect(html).toContain('Pending audit');
    expect(html).toContain('Corporate trustee');
  });
});

describe('the tenant is on it and we are not', () => {
  it('carries the tenant on the cover', () => {
    expect(render()).toContain('Tenant Advisory');
  });

  /** The legacy hardcodes `/templates/npc-formara-cover.jpg` as the cover. */
  it('names no house brand and reaches for no house asset', () => {
    const html = render(FULL);
    for (const ours of ['NPC Services', 'npcservices', 'npc-formara-cover', 'Formara']) {
      expect(html).not.toContain(ours);
    }
  });

  it('titles the document by the client, not by a form standard', () => {
    expect(render()).toContain('Ada Lovelace');
    expect(render()).not.toContain('CLIENT PORTFOLIO FORM');
    expect(DOCUMENT_NAME).toBe(REPORT_ARCHETYPES['client-details'].documentName);
  });
});

describe('escaping', () => {
  it('escapes a script tag in a recorded field', () => {
    const html = render({
      client: {
        id: ID, primary_first_name: '<script>alert(1)</script>', primary_surname: 'Lovelace',
      },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a recorded address inside a table', () => {
    const html = render({
      ...FULL,
      properties: [{ property_type: 'investment', address: '<img src=x onerror=1>', value: 1 }],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('the spine holds', () => {
  it('is valid for every shape', () => {
    expect(validateClientDetailsSpine(build())).toEqual([]);
    expect(validateClientDetailsSpine(build(FULL))).toEqual([]);
  });

  /**
   * The band was pinned from five real WeasyPrint renders — 5, 7, 19, 19 and 26
   * pages — after the first estimate refused the name-only client outright.
   */
  it('budgets inside the archetype band, at both extremes', () => {
    const [min, max] = REPORT_ARCHETYPES['client-details'].pageBudget;
    for (const p of [build(), build(FULL)]) {
      const budget = spinePageBudget(clientDetailsSpine(p));
      expect(budget).toBeGreaterThanOrEqual(min);
      expect(budget).toBeLessThanOrEqual(max);
    }
  });

  it('refuses a record with no name to put on the cover', () => {
    const p = build();
    const nameless = { ...p, meta: { ...p.meta, clientName: '' } };
    expect(validateClientDetailsSpine(nameless))
      .toContainEqual(expect.stringContaining('no name'));
  });

  it('refuses a collection large enough to be a paste', () => {
    const p = build();
    const flooded = {
      ...p,
      expenses: Array.from({ length: 500 }, () => p.expenses[0] ?? { category: 'x', name: '', monthly: { value: 1, unit: 'aud/month' as const }, isEssential: false }),
    };
    expect(validateClientDetailsSpine(flooded))
      .toContainEqual(expect.stringContaining('expenses carries 500 rows'));
  });
});

describe('the request and where the file lands', () => {
  it('accepts one id and nothing else', () => {
    expect(parseRenderRequest({ clientId: ID }).ok).toBe(true);
    expect(parseRenderRequest({ clientId: 'not-a-uuid' }).ok).toBe(false);
    expect(parseRenderRequest(null).ok).toBe(false);
  });

  /** A deliberate divergence: "Formara" is a vendor's form standard, not this. */
  it('names the file after what it is', () => {
    expect(clientDetailsFileName('Ada Lovelace', NOW))
      .toBe('Client_Details_Ada_Lovelace_2026-08-02.pdf');
    expect(clientDetailsFileName('', NOW)).toContain('Client');
  });

  it('files it under the client and a random segment', () => {
    expect(clientDetailsStoragePath(ID, 'x.pdf', NOW, 'uuid-here'))
      .toBe(`client-details/${ID}/2026-08-02/uuid-here-x.pdf`);
    expect(clientDetailsReference(ID)).toBe('11111111');
  });
});
