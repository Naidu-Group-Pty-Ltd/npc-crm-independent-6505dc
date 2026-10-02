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
import {
  MEMO_CHAPTER_CLASS,
  RUN_ON_CHAPTER_CLASS,
  SECTION_SUBHEAD_CLASS,
} from '@/lib/reportDesign/primitives.pure';

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
  /**
   * Written for the person who reads it first, as every other typeset format's
   * is (`readableFileName.pure.ts`): it was `Client_Details_Ada_Lovelace_…`,
   * with the "&" between two people's names an underscore.
   */
  it('names the file after what it is, whom it is about and the day', () => {
    expect(clientDetailsFileName('Ada Lovelace', NOW))
      .toBe('Client Details - Ada Lovelace - 02 Aug 2026.pdf');
    expect(clientDetailsFileName('Ada Lovelace & Charles Babbage', NOW))
      .toBe('Client Details - Ada Lovelace and Charles Babbage - 02 Aug 2026.pdf');
    expect(clientDetailsFileName('', NOW)).toBe('Client Details - Client - 02 Aug 2026.pdf');
  });

  it('files it under the client and a random segment, under a URL-safe key', () => {
    expect(clientDetailsStoragePath(ID, 'x.pdf', NOW, 'uuid-here'))
      .toBe(`client-details/${ID}/2026-08-02/uuid-here-x.pdf`);
    const key = clientDetailsStoragePath(ID, clientDetailsFileName('Ada Lovelace', NOW), NOW, 'u');
    expect(key).not.toMatch(/\s/);
    expect(key).toMatch(/Client.Details.*Ada.Lovelace/);
    expect(clientDetailsReference(ID)).toBe('11111111');
  });
});

/**
 * The audit (CLIENT_DETAILS.md §12), pinned on the document's markup. The page
 * measurements behind it were taken on the pinned engine across the five
 * record shapes in all fifty designs and the standard layout; what a unit test
 * can hold is the structure those measurements depend on.
 */
describe('the audit — one continuous record', () => {
  const chaptersOf = (html: string) =>
    [...html.matchAll(/<section class="chapter([^"]*)"[^>]*data-chapter-title="([^"]+)"/g)]
      .map((m) => ({ classes: m[1].trim().split(/\s+/), title: m[2] }));

  it('runs every section on after the first, as a memo', () => {
    const chapters = chaptersOf(render(FULL));
    expect(chapters.length).toBeGreaterThan(4);
    expect(chapters[0].classes).toContain(MEMO_CHAPTER_CLASS);
    expect(chapters[0].classes).not.toContain(RUN_ON_CHAPTER_CLASS);
    for (const c of chapters.slice(1)) {
      expect(c.classes, c.title).toContain(RUN_ON_CHAPTER_CLASS);
      expect(c.classes, c.title).toContain(MEMO_CHAPTER_CLASS);
    }
  });

  it('sets its subheads one step below the section title', () => {
    const html = render(FULL);
    expect(html).toContain(`<h2 class="${SECTION_SUBHEAD_CLASS}">Primary contact</h2>`);
    expect(html).not.toMatch(/<h2>/);
  });

  it('puts the summary under the contents, not above the contact details', () => {
    const html = render(FULL);
    const summary = html.indexOf('About this record');
    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeLessThan(html.indexOf('<section class="chapter'));
    // Said once.
    expect(html.split(build(FULL).narrative).length - 1).toBe(1);
  });

  it('says that a record is empty once, in the closing section', () => {
    const html = render();
    expect(html).not.toContain('About this record');
    expect(html.split('No financial information is recorded for this client').length - 1).toBe(1);
    expect(html).not.toContain('No income');
    expect(html).not.toContain('No property is recorded');
  });
});

describe('the audit — no figure about something the record does not hold', () => {
  const NO_PROPERTY = {
    employment: [{ contact_type: 'primary', employer_name: 'Analytical Engines', gross_annual_salary: 150_000 }],
    assets: [{ asset_type: 'savings', description: 'Offset', value: 40_000 }],
    liabilities: [{ liability_type: 'personal_loan', provider_name: 'NAB', current_balance: 9_000, monthly_repayment: 300 }],
  };

  it('prints no rental or other income line for a client with neither', () => {
    const html = render(NO_PROPERTY);
    expect(html).not.toContain('Rental income');
    expect(html).not.toContain('Other income');
    expect(html).toContain('Total per month');
  });

  it('prints no property rows and no property figure for a client with no property', () => {
    const html = render(NO_PROPERTY);
    for (const absent of ['Property value', 'Property debt', 'Property equity', 'held</']) {
      expect(html, absent).not.toContain(absent);
    }
    expect(html).toContain('>Assets<');
    expect(html).toContain('>Liabilities<');
  });

  it('keeps the property rows where property is held', () => {
    const html = render(FULL);
    expect(html).toContain('Property equity');
    expect(html).toContain('Other assets');
  });
});

describe('the audit — the tables foot', () => {
  it('totals the assets and the liabilities it lists', () => {
    const html = render({
      assets: [
        { asset_type: 'savings', description: 'Offset', value: 40_000 },
        { asset_type: 'shares', description: 'ETF', value: 10_000 },
      ],
      liabilities: [
        { liability_type: 'personal_loan', provider_name: 'NAB', current_balance: 9_000, monthly_repayment: 300 },
        { liability_type: 'vehicle_loan', provider_name: 'Toyota Finance', current_balance: 21_000, monthly_repayment: 500 },
      ],
    });
    expect(html).toMatch(/>Total<[\s\S]*?\$50,000/);
    expect(html).toMatch(/>Total<[\s\S]*?\$30,000[\s\S]*?\$800/);
  });
});

describe('the audit — the portfolio is set where its section is', () => {
  it('draws up to five holdings as a portrait matrix headed by street, kept whole', () => {
    const html = render(FULL);
    expect(html).toContain('holdings-matrix');
    expect(html).toMatch(/<div class="table-block keep-together"><table class="data holdings-matrix"><colgroup>/);
    expect(html).toContain('Unit 7, 118 Mariners Quay');
    const portfolio = clientDetailsSections(build(FULL)).find((x) => x.id === 'portfolio')!;
    expect(portfolio.wide).toBe(false);
  });

  it('heads each column with the whole street, and says once what the lines are', () => {
    const html = render({
      properties: [
        { property_type: 'investment', address: 'Unit 14, 238-242 Great Western Highway, Katoomba NSW 2780', value: 585_000, loan_remaining: 468_000 },
        { property_type: 'investment', address: '9 Coral Sea Drive, Mission Beach QLD 4852', value: 915_000 },
      ],
    });
    const matrix = html.slice(html.indexOf('<table class="data holdings-matrix"'));
    const head = matrix.slice(0, matrix.indexOf('</thead>'));
    // The heads wrap here, so nothing is clipped: "Unit 14, 238-242 Great…"
    // named a street the reader then had to find in the next section.
    expect(head).toContain('Unit 14, 238-242 Great Western Highway');
    expect(head).not.toContain('…');
    // The standfirst says "side by side"; the caption no longer repeats it, nor
    // vouches for the software ("cannot disagree with the two rows above it").
    expect(matrix).toContain('Rent, outgoings and the net between them are per month.');
    expect(html).not.toContain('cannot disagree');
  });

  it('keeps the landscape sheet past five', () => {
    const six = {
      properties: Array.from({ length: 6 }, (_, i) => ({
        property_type: 'investment', address: `${i + 1} Example Street, Suburbia`, value: 500_000,
      })),
    };
    const portfolio = clientDetailsSections(build(six)).find((x) => x.id === 'portfolio')!;
    expect(portfolio.wide).toBe(true);
    // The class is in the stylesheet either way; the table is what changes.
    expect(render(six)).not.toContain('<table class="data holdings-matrix"');
  });
});

describe('the audit — whose a row is, by name', () => {
  const TWO = {
    client: {
      id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace',
      secondary_first_name: 'Charles', secondary_surname: 'Babbage',
    },
    employment: [
      { contact_type: 'primary', employer_name: 'Analytical Engines', gross_annual_salary: 150_000 },
      { contact_type: 'secondary', employer_name: 'Difference Engines', gross_annual_salary: 90_000 },
    ],
  };

  it('names the person, where it said "Primary" and "Second"', () => {
    const html = render(TWO);
    expect(html).toContain('Employment (Ada)');
    expect(html).toContain('Employment (Charles)');
    expect(html).not.toMatch(/>Primary</);
  });

  it('draws no contact column for a record of one person', () => {
    expect(render(FULL)).not.toContain('>Contact<');
  });
});

describe('the audit — the home', () => {
  it('explains the portfolio only where there is one, and sets its emphasis', () => {
    const homeOnly = render({
      properties: [{ property_type: 'owner_occupied', address: 'Home', value: 900_000, loan_remaining: 400_000 }],
    });
    expect(homeOnly).not.toContain('Why the home is not in the portfolio');
    const both = render(FULL);
    expect(both).toContain('Why the home is not in the portfolio');
    expect(both).toContain('<em>invests</em>');
    expect(both).not.toContain('*invests*');
  });
});

describe('the audit — every expense line, by category', () => {
  it('groups the lines in the order of the category summary', () => {
    const html = render({
      expenses: [
        { expense_category: 'utilities', expense_name: 'Gas', monthly_amount: 50, frequency: 'monthly' },
        { expense_category: 'groceries', expense_name: 'Butcher', monthly_amount: 200, frequency: 'monthly' },
        { expense_category: 'utilities', expense_name: 'Power', monthly_amount: 120, frequency: 'monthly' },
        { expense_category: 'groceries', expense_name: 'Market', monthly_amount: 600, frequency: 'monthly' },
      ],
    });
    const lines = html.slice(html.indexOf('Every line'));
    const order = ['Market', 'Butcher', 'Power', 'Gas'].map((n) => lines.indexOf(`>${n}<`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
