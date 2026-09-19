/**
 * The executed copy, as a document.
 *
 * Two things this covers that the source-contract tests in
 * `tests/cross-portal-contracts/` cannot. It builds the whole document from
 * production-shaped inputs, so a composition mistake — a block emitted twice, a
 * party rendered into the wrong panel, a colour literal creeping back in — is
 * caught here rather than in a partner's hands. And it writes the HTML to
 * `reports/html/partner-agreement.html`, which is what lets
 * `scripts/reports/renderAll.mts` render, measure and judge it beside the ten
 * report formats. Before this file the agreement was the only client-facing
 * document in the repo that nobody could look at without a database.
 *
 * The second case is the one that matters most for this format: **a record with
 * nothing in it**. Almost every field on this document is optional — a partner
 * organisation with no trading name, an acceptance taken before acknowledgments
 * were stored, a tenant who has not filled in their branding — and a document
 * whose shape changes with how complete the record happens to be is a different
 * document each time.
 */
import { describe, expect, it } from 'vitest';

import { writeRenderArtifact } from '../../__tests__/renderArtifact';
import {
  AGREEMENT_DOCUMENT_REVISION,
  agreementRevisionForPath,
  agreementServiceState,
  agreementStoragePath,
  buildPartnerAgreementDocument,
  hasCurrentAgreementCopy,
  NOT_RECORDED,
  PORTAL_LABELS,
} from '../render.pure';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';

const NOW = '2026-08-07T06:15:00.000Z';
const ACCEPTED = '2026-08-07T06:11:00.000Z';
const ACCEPTANCE = 'e58af62c-6158-403b-a6c5-bde898462bed';

/** A white-label tenant, so "it carries theirs and not ours" is falsifiable. */
const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: 'Tenant Advisory', brandColour: '#B8873A', preset: 'signature' },
  contact: {
    company_name: 'Tenant Advisory Pty Ltd',
    abn: '11 222 333 444',
    email: 'hello@tenantadvisory.example',
    phone: '02 5550 1234',
    website: 'www.tenantadvisory.example',
    address: '1 Example Street, Sydney NSW 2000',
  },
  capturedAt: NOW,
});

/** A tenant who has filled in nothing at all. */
const { snapshot: bareSnapshot } = buildReportBrandSnapshot({
  whitelabel: null,
  contact: null,
  capturedAt: NOW,
});

const ACKNOWLEDGEMENTS = [
  {
    key: 'confidentiality',
    heading: 'Global confidentiality and privacy',
    statement: 'I acknowledge that all information made available through the Portal is confidential.',
  },
  {
    key: 'authority',
    heading: 'Authority and binding acceptance',
    statement: 'I confirm that I am authorised to accept this Agreement.',
  },
];

/** Enough of the real body to exercise every construct the agreement uses. */
const AGREEMENT_HTML = [
  '<h2 id="agreement-1-global">Global Confidentiality and Privacy Acknowledgment</h2>',
  '<p>Before accessing the Portal, the Partner Organisation acknowledges and agrees.</p>',
  '<h2 id="agreement-2-binding">1. Binding acceptance and authority</h2>',
  '<ol><li>they are authorised to act for and bind the Partner Organisation;</li></ol>',
  '<h2 id="agreement-3-general">17. General provisions</h2>',
  '<p>A failure or delay in enforcing a right does not waive that right.</p>',
].join('');

const SECTIONS = [
  { id: 'agreement-1-global', text: 'Global Confidentiality and Privacy Acknowledgment' },
  { id: 'agreement-2-binding', text: '1. Binding acceptance and authority' },
  { id: 'agreement-3-general', text: '17. General provisions' },
];

const execution = (over: Record<string, unknown> = {}) => ({
  portal: 'builder' as const,
  portalLabel: PORTAL_LABELS.builder,
  acceptanceId: ACCEPTANCE,
  version: '2026-08-07',
  title: 'Portal Access, Confidentiality, Privacy and AML/CTF Compliance Passport Agreement',
  documentHash: 'f5612fc2daef61ef645b43465005f411cd85979c8687cfb023f358c615e00af5',
  acceptedAt: ACCEPTED,
  acknowledgements: ACKNOWLEDGEMENTS,
  hasIpFingerprint: true,
  hasUserAgentFingerprint: true,
  generatedAt: NOW,
  ...over,
});

const build = (over: Record<string, unknown> = {}) => buildPartnerAgreementDocument({
  snapshot,
  party: {
    organisationName: 'Kopi Jantan Builders',
    organisationTradingName: null,
    acceptedByName: 'Mithruban',
    acceptedByEmail: 'mithruban@example.com',
  },
  execution: execution(),
  agreementHtml: AGREEMENT_HTML,
  sections: SECTIONS,
  ...over,
});

describe('partner agreement — the executed copy', () => {
  const { html } = build();

  it('writes the artefact somebody can look at', () => {
    writeRenderArtifact('partner-agreement', html);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('is built from the design system rather than its own stylesheet', () => {
    // The classes below are the kit's. If this document ever grows a private
    // copy of them, these stop being true.
    for (const marker of ['report-cover', 'page-contents', 'chapter-header', 'company-page', 'table.data']) {
      expect(html).toContain(marker.startsWith('table') ? 'class="data record' : marker);
    }
    // Set in the container's faces, not the engine's fallback serif.
    expect(html).toContain('Playfair Display');
    expect(html).toContain('IBM Plex Mono');
  });

  it('carries the tenant\'s identity and never ours', () => {
    expect(html).toContain('Tenant Advisory');
    expect(html).not.toMatch(/\bNPC\b/);
    // And never the renderer's name on a page a client reads. Asserted against
    // the body rather than the file: the shared stylesheet carries explanatory
    // CSS comments that name the engine, which no reader ever sees.
    const body = html.slice(html.indexOf('<body>'));
    expect(body).not.toMatch(/WeasyPrint/i);
  });

  it('contains the agreement, both parties and the execution record', () => {
    expect(html).toContain('Global Confidentiality and Privacy Acknowledgment');
    expect(html).toContain('Kopi Jantan Builders');
    // The operator's name is the snapshot's, which is the white-label name with
    // `contact_details.company_name` behind it — the same precedence every
    // other document in the programme prints.
    expect(html).toContain('Tenant Advisory');
    expect(html).toContain('f5612fc2daef61ef645b43465005f411cd85979c8687cfb023f358c615e00af5');
    expect(html).toContain('11 222 333 444');
  });

  it('numbers its contents from the anchors rather than from a count', () => {
    // The page number is resolved by the engine against the heading the entry
    // points at, so a section that moves takes its number with it.
    expect(html).toContain('target-counter(attr(href), page)');
    for (const section of SECTIONS) expect(html).toContain(`href="#${section.id}"`);
    // The ordinal comes off the heading text, so the index and the clause agree.
    expect(html).toContain('>17<');
  });

  it('prints only the acknowledgments this acceptance asserted', () => {
    expect(html).toContain('Global confidentiality and privacy');
    expect(html).toContain('Authority and binding acceptance');
    expect(html).not.toContain('Binding AML/CTF arrangement');
  });

  it('says so when an acceptance recorded no acknowledgments', () => {
    const bare = build({ execution: execution({ acknowledgements: [] }) });
    expect(bare.html).toContain('recorded before the individual acknowledgments were stored');
    // And does not print four statements nobody made.
    expect(bare.html).not.toContain('Authority and binding acceptance');
  });

  it('keeps its shape when the record carries almost nothing', () => {
    const { html: sparse } = build({
      snapshot: bareSnapshot,
      party: {
        organisationName: null,
        organisationTradingName: null,
        acceptedByName: null,
        acceptedByEmail: null,
      },
      execution: execution({ documentHash: null, hasIpFingerprint: false, hasUserAgentFingerprint: false }),
    });
    writeRenderArtifact('partner-agreement-sparse', sparse);

    // Every row is still there, stating what is missing rather than collapsing.
    for (const label of ['Legal name', 'ABN', 'Accepted by', 'Document hash (SHA-256)']) {
      expect(sparse).toContain(label);
    }
    expect(sparse).toContain(NOT_RECORDED);
    // Same blocks, same order — the shape does not depend on the data.
    const blocks = (source: string) =>
      (source.match(/class="(?:report-cover|page-contents|chapter)[^"]*"/g) ?? []).length;
    expect(blocks(sparse)).toBe(blocks(html));
  });

  it('omits the closing page rather than printing an empty one', () => {
    // The one place the shape is allowed to differ, and it is a deliberate
    // trade: for a tenant with no contact routes and no disclaimer that page is
    // a full-bleed dark sheet carrying two lines of ink, which reads as a
    // printing fault. The attestation ends the document instead.
    // The markup, not the stylesheet — which defines `.company-page` either way.
    const section = /<section class="company-page/;
    expect(html).toMatch(section);
    const { html: bare, gaps } = build({ snapshot: bareSnapshot });
    expect(bare).not.toMatch(section);
    // And the operator is told what is missing rather than left to notice.
    expect(gaps.join(' ')).toMatch(/contact route/i);
  });

  it('names no colour of its own', () => {
    // Every colour in the document comes from the palette the snapshot resolved.
    // A literal here is the ninth brand gold; see `reportSourceHygiene.spec.ts`.
    const module = String(buildPartnerAgreementDocument);
    expect(module).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });

  it('reports what the brand snapshot was missing rather than refusing to render', () => {
    const { gaps, html: stillRendered } = build({ snapshot: bareSnapshot });
    expect(gaps.length).toBeGreaterThan(0);
    expect(stillRendered).toContain('<!DOCTYPE html>');
  });
});

describe('partner agreement — stored copies carry their revision', () => {
  it('writes a new object for a new revision instead of replacing one', () => {
    const current = agreementStoragePath('builder', ACCEPTANCE, ACCEPTED);
    const first = agreementStoragePath('builder', ACCEPTANCE, ACCEPTED, 1);
    expect(first).toBe(`builder/2026/${ACCEPTANCE}.pdf`);
    expect(current).not.toBe(first);
    expect(current).toContain(`-r${AGREEMENT_DOCUMENT_REVISION}`);
  });

  it('reads the revision back off a path, so no column is needed to track it', () => {
    expect(agreementRevisionForPath(`builder/2026/${ACCEPTANCE}.pdf`)).toBe(1);
    expect(agreementRevisionForPath(agreementStoragePath('builder', ACCEPTANCE, ACCEPTED))).toBe(
      AGREEMENT_DOCUMENT_REVISION,
    );
    expect(agreementRevisionForPath(null)).toBe(0);
  });

  it('treats a copy from an earlier revision as one to re-issue', () => {
    expect(hasCurrentAgreementCopy(null)).toBe(false);
    expect(hasCurrentAgreementCopy(`builder/2026/${ACCEPTANCE}.pdf`)).toBe(false);
    expect(hasCurrentAgreementCopy(agreementStoragePath('builder', ACCEPTANCE, ACCEPTED))).toBe(true);
  });
});

describe('partner agreement — the service reports which document it renders', () => {
  it('reads "no revision reported" as revision 1, not as "assume fine"', () => {
    // A function that reports nothing is a function deployed before revisions
    // existed — so it renders the previous document. Treating the absent field
    // as "unknown, carry on" would hide the one state this exists to surface.
    expect(agreementServiceState(undefined, 2)).toBe('behind');
    expect(agreementServiceState(null, 2)).toBe('behind');
    expect(agreementServiceState(1, 2)).toBe('behind');
  });

  it('is quiet when the service matches, and when it is ahead', () => {
    expect(agreementServiceState(2, 2)).toBe('current');
    // A function ahead of the app is the ordinary order of a staged deploy: the
    // copies it writes are newer than the app can describe, not older than the
    // ones it promises.
    expect(agreementServiceState(3, 2)).toBe('ahead');
  });

  it('defaults to the revision this build produces', () => {
    expect(agreementServiceState(AGREEMENT_DOCUMENT_REVISION)).toBe('current');
    expect(agreementServiceState(AGREEMENT_DOCUMENT_REVISION - 1)).toBe('behind');
  });
});
