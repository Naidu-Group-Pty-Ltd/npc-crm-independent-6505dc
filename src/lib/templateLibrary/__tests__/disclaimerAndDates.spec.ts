/**
 * The last page carries the disclaimer the firm wrote, not the one we shipped.
 *
 * ## What "the disclaimer section isn't rendering" turned out to be
 *
 * Every one of the ten families does put a `disclaimer` block on its last page,
 * and its text does render. The section was never missing — it was showing the
 * wrong text.
 *
 * `disclaimerPage()` baked `STANDARD_DISCLAIMER` into the schema: five lines of
 * generic boilerplate, frozen into all 543 seeded templates. The deployment has
 * `global_report_settings.professional_disclaimer` set — ~1,400 characters over
 * nine paragraphs, `is_enabled: true`, written for a Buyers Agent and naming the
 * risks that business carries. Every render route already reads that row; it
 * passed the value to the legacy composer and nothing else, so no design-system
 * document ever showed it.
 *
 * The same row carries `contact_details`, with the two `org` fields this
 * programme recorded as unfillable:
 *
 *     abn      50 684 555 771          "no column" — in whitelabel_settings
 *     address  Level 5 Nexus Norwest…   empty string — in whitelabel_settings
 *
 * Both are on the page now, which is most of the blank space the exported PDFs
 * showed between the contact block and the foot.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { CLIENT_DETAILS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/clientDetails';
import { CASH_FLOW_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlow';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';
import {
  projectReportSettings,
  applyOrganisationProjection,
} from '../../../../supabase/functions/_shared/organisationProjection.pure';

/** Shaped exactly as the production row, trimmed. */
const SETTINGS = {
  contact: {
    abn: '50 684 555 771',
    address: 'Level 5 Nexus Norwest, 4 Columbia Ct, Norwest NSW 2153',
    company_name: 'Naidu Property Consulting Services',
    phone: '02 8609 3299',
    email: 'admin@npcservices.com.au',
    website: 'www.npcservices.com.au',
  },
  disclaimer: {
    text: 'As a Professional Property Consultant & Buyers Agent, we provide information '
      + 'and advice based on our expertise and experience in the real estate market.',
    font_size: 'medium',
    is_enabled: true,
  },
};

/*
 * `SAMPLE` ships its own `org` for the fictional tenant, and
 * `applyOrganisationProjection` deliberately lets an existing `org` win — the
 * converter passes a stored brand snapshot, and that is what an issued document
 * was typeset under. So the sample's letterhead is dropped first here; this
 * suite is about what the live settings row produces.
 */
const withSettings = () => {
  const data = JSON.parse(JSON.stringify(SAMPLE));
  delete data.org;
  applyOrganisationProjection(data, { company_name: 'Naidu Property Consulting Services' } as never, null, SETTINGS);
  return data;
};

const SAMPLES = [...CLIENT_DETAILS_TEMPLATES.slice(0, 3), ...CASH_FLOW_COMPASS_TEMPLATES.slice(0, 3)];

describe('the report settings reach the org namespace', () => {
  it('publishes the ABN and address this programme recorded as unfillable', () => {
    const org = projectReportSettings(SETTINGS);
    expect(org.abn).toBe('50 684 555 771');
    expect(org.address).toContain('Nexus Norwest');
  });

  it('publishes the configured disclaimer and its size', () => {
    const org = projectReportSettings(SETTINGS);
    expect(org.disclaimer).toContain('Buyers Agent');
    expect(org.disclaimerFontSize).toBe('medium');
  });

  it('withholds the text when the setting is turned off', () => {
    // `is_enabled: false` has to mean something, and the block omits an empty
    // disclaimer — so turning it off falls back to the standard text rather
    // than printing the firm's.
    const org = projectReportSettings({ ...SETTINGS, disclaimer: { ...SETTINGS.disclaimer, is_enabled: false } });
    expect(org.disclaimer).toBeUndefined();
  });

  it('prefers contact_details over the email-signature columns', () => {
    const data: Record<string, any> = {};
    applyOrganisationProjection(
      data,
      { company_name: 'Old Name', email_signature_phone: '00 0000 0000' } as never,
      null,
      SETTINGS,
    );
    expect(data.org.phone).toBe('02 8609 3299');
    expect(data.org.name).toBe('Naidu Property Consulting Services');
  });
});

describe('the rendered last page', () => {
  it('carries the firm\'s disclaimer, not the shipped boilerplate', () => {
    for (const t of SAMPLES) {
      const { html } = renderTemplateToHtml(t.schema as any, { data: withSettings() });
      expect(html, t.name).toContain('Buyers Agent');
      expect(html, t.name).not.toContain('prepared for the named recipient only');
    }
  });

  it('falls back to the standard text when nothing is configured', () => {
    // A deployment that has set no disclaimer must not get a blank foot — an
    // unresolved binding renders as the empty string, which is why the block
    // carries a fallback rather than the template carrying a literal.
    for (const t of SAMPLES) {
      const bare = JSON.parse(JSON.stringify(SAMPLE));
      delete bare.org.disclaimer;
      delete bare.org.disclaimerFontSize;
      const { html } = renderTemplateToHtml(t.schema as any, { data: bare });
      expect(html, t.name).toContain('prepared for the named recipient only');
    }
  });

  it('prints the ABN and the postal address', () => {
    for (const t of SAMPLES) {
      const { html } = renderTemplateToHtml(t.schema as any, { data: withSettings() });
      expect(html, t.name).toContain('50 684 555 771');
      expect(html, t.name).toContain('Nexus Norwest');
    }
  });
});

/**
 * No raw timestamp reaches a page — including from a template that never got
 * the filter.
 *
 * The first case here passed for as long as it has existed and did not stop the
 * defect, because it renders the **catalogue source**, and the catalogue source
 * was corrected in `ad99bc228`. A document is drawn from `report_templates`,
 * and an activated template is a *copy*: seven of the thirteen live rows still
 * bind `{{report.generatedDate}}` with no filter, which is what printed
 * `Prepared 2026-08-16T08:58:56.946Z` on a client's Client Details cover and
 * again under `PREPARED` on page 3.
 *
 * So the second case strips the filters back out before rendering, reproducing
 * the stored row, and asserts the page is right anyway. That is the difference
 * between checking what we ship and checking what the renderer guarantees.
 */
describe('no raw timestamp reaches a page', () => {
  /** The dates a real export carries, in the forms the projections publish. */
  const withDates = () => {
    const data = withSettings();
    data.report = { ...(data.report ?? {}), generatedDate: '2026-08-16T08:58:56.946Z' };
    data.clientDetails = {
      ...(data.clientDetails ?? {}),
      preparedOn: '2026-08-16T08:58:56.946Z',
      // A Postgres `date`, so date-only — a machine date on the page just the
      // same, and the form the old assertion could not see.
      addressHistory: [{ address: 'Regalia KL', suburb: 'Sydney', startDate: '2016-02-14', endDate: '2019-11-03' }],
    };
    return data;
  };

  const NO_MACHINE_DATE = /\d{4}-\d{2}-\d{2}/;

  it('formats every date the masters bind', () => {
    for (const t of SAMPLES) {
      const { html } = renderTemplateToHtml(t.schema as any, { data: withDates() });
      expect(html, t.name).not.toMatch(NO_MACHINE_DATE);
      expect(html, t.name).toContain('16 Aug 2026');
    }
  });

  it('formats them from a template that binds them with no filter', () => {
    for (const t of SAMPLES) {
      // Exactly the stored rows' shape: `{{report.generatedDate | date}}`
      // written back as `{{report.generatedDate}}`.
      const stored = JSON.parse(
        JSON.stringify(t.schema).replace(/\s*\|\s*date(:\w+)?\s*\}\}/g, '}}'),
      );
      expect(JSON.stringify(stored), `${t.name}: nothing was stripped, so this proves nothing`)
        .toContain('{{report.generatedDate}}');

      const { html } = renderTemplateToHtml(stored, { data: withDates() });
      expect(html, t.name).not.toMatch(NO_MACHINE_DATE);
      expect(html, t.name).toContain('16 Aug 2026');
    }
  });
});
