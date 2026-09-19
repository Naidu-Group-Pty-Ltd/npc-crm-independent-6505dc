/**
 * The organisation projection — the letterhead every generated document lacked.
 *
 * `disclaimerPage()` is the last page of all 293 seeded templates and the family
 * covers set `{{org.name}}` as their wordmark. Nothing published `org`: not one
 * adapter, not the edge mirror, not the render route. An unresolved binding
 * renders as the empty string, so the contact block printed its labels with
 * nothing beside them and the wordmark was blank — on every report this product
 * has ever generated.
 *
 * The preview never showed it, because `SAMPLE_REPORT_DATA.org` is fully
 * populated. That is the same trap `reportBindingProjection.pure.ts` was written
 * for: a fixture in the catalogue's vocabulary passes while production is empty.
 */
import { describe, it, expect } from 'vitest';
import {
  projectOrganisation,
  applyOrganisationProjection,
  ORGANISATION_COLUMNS,
} from '../../../../supabase/functions/_shared/organisationProjection.pure';

/** The live row, verbatim — trailing space on the name and all. */
const ROW = {
  company_name: 'Naidu Property Consulting Services ',
  email_signature_phone: '02 8609 3299',
  email_signature_email: 'admin@npcservices.com.au',
  email_signature_website: 'www.npcservices.com.au',
  email_signature_address: '',
};

describe('the projection', () => {
  it('publishes the four fields the settings row actually carries', () => {
    expect(projectOrganisation(ROW)).toEqual({
      name: 'Naidu Property Consulting Services',
      phone: '02 8609 3299',
      email: 'admin@npcservices.com.au',
      website: 'www.npcservices.com.au',
    });
  });

  it('trims the name, because a wordmark is typeset from it', () => {
    // The stored value ends in a space. A cover sets it at display size.
    expect(projectOrganisation(ROW).name).not.toMatch(/\s$/);
  });

  it('invents no ABN, and defaults no address', () => {
    // There is no ABN column on `whitelabel_settings` at all, and the address
    // is an empty string. An ABN is a legal identifier: a plausible-looking
    // wrong one on a client's financial report is worse than a missing line,
    // and the disclaimer block omits a row whose value is empty.
    const org = projectOrganisation(ROW);
    expect('abn' in org).toBe(false);
    expect('address' in org).toBe(false);
  });

  it('publishes an address where a deployment fills one in', () => {
    const org = projectOrganisation({
      ...ROW, email_signature_address: 'Level 2, 12 Help Street, Chatswood NSW 2067',
    });
    expect(org.address).toBe('Level 2, 12 Help Street, Chatswood NSW 2067');
  });

  it('reads nothing the email signature carries that a report must not', () => {
    // `REPORT_RULES.md`: most of this repo's "logo" files are email-signature
    // banners carrying the director's personal mobile. The banner is never
    // read, and neither is the signature's own disclaimer — templates carry
    // `STANDARD_DISCLAIMER`, which is written for print.
    const org = projectOrganisation({
      ...ROW,
      email_signature_banner: 'https://example.test/banner.png',
      email_signature_disclaimer: 'This email and any attachments…',
      email_signature_name: 'NPC Services',
      email_signature_title: 'Property Investment Specialist',
    } as Record<string, unknown>);
    expect(JSON.stringify(org)).not.toContain('banner');
    expect(JSON.stringify(org)).not.toContain('attachments');
    // And no author: "NPC Services" is the organisation and "Property
    // Investment Specialist" is a role, neither of which is the person who
    // prepared the report. There is no `profiles` table to ask.
    expect(JSON.stringify(org)).not.toContain('Specialist');
  });

  it('survives a missing settings row without throwing', () => {
    expect(projectOrganisation(null)).toEqual({});
    expect(projectOrganisation(undefined)).toEqual({});
    expect(projectOrganisation({})).toEqual({});
  });

  it('names the columns it reads, so a select pulls nothing else', () => {
    for (const c of ['company_name', 'email_signature_phone', 'email_signature_email']) {
      expect(ORGANISATION_COLUMNS).toContain(c);
    }
    expect(ORGANISATION_COLUMNS).not.toContain('email_signature_banner');
    expect(ORGANISATION_COLUMNS).not.toContain('theme_config');
  });
});

describe('merging', () => {
  it('adds the namespace where the caller has none', () => {
    const data = applyOrganisationProjection({}, ROW);
    expect(data.org.name).toBe('Naidu Property Consulting Services');
  });

  it('leaves a caller-supplied organisation alone', () => {
    // The converter and the Agreement Centre pass a stored brand snapshot, and
    // a snapshot is what an issued document was typeset under. The live
    // settings row may have moved since; re-typesetting under it would change
    // what an already-issued document says.
    const data = applyOrganisationProjection(
      { org: { name: 'Snapshot Pty Ltd', abn: '11 111 111 111' } },
      ROW,
    );
    expect(data.org.name).toBe('Snapshot Pty Ltd');
    expect(data.org.abn).toBe('11 111 111 111');
    // Fields the snapshot did not carry still fill from the live row.
    expect(data.org.phone).toBe('02 8609 3299');
  });

  it('changes nothing when there is no row to project', () => {
    const before = { org: { name: 'Kept' }, other: 1 };
    expect(applyOrganisationProjection(before, null)).toEqual(before);
  });
});
