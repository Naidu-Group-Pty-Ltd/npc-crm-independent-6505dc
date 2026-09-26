/**
 * NPC's identity belongs to the prime.
 *
 * The owner's rule (26 Sep 2026): NPC's artwork, and "the Disclaimer that might
 * be hardcoded as NPC Services or Naidu property consulting services", are
 * available on the prime and hidden on every clone. A clone's rows can still
 * carry the house's values — a seeded copy, a restored backup, a disclaimer
 * pasted across — so the rule is keyed on the deployment, never on a name a row
 * can hold, and these tests hold both halves: a clone never issues under the
 * house's name or wording, and the prime reads every name and every word
 * exactly as it did before the rule existed.
 */
import { describe, expect, it } from 'vitest';
import {
  PLATFORM_DISCLAIMER,
  PLATFORM_ISSUER_NAME,
  WORKSPACE_DEFAULT_DISCLAIMER,
  houseWordingWithheld,
  isHouseContactRow,
  isHouseName,
  issuerContactDetails,
  namesTheHouse,
  resolveReportDisclaimer,
  resolveReportIssuer,
} from '@/lib/reports/issuerIdentity.pure';

const PRIME = { prime: true } as const;
const CLONE = { prime: false } as const;
const workspace = (name: string) => ({ name, kind: 'workspace' as const });
const platform = { name: PLATFORM_ISSUER_NAME, kind: 'platform' as const };

describe("the house's names", () => {
  it('reads a name by its words, not its punctuation, case or legal form', () => {
    for (const name of [
      'Naidu Property Consulting Services',
      'NAIDU PROPERTY CONSULTING SERVICES PTY LTD',
      '  naidu   property consulting services. ',
      'Naidu Property Consulting',
      'NPC Services',
      'NPC Services Pty Limited',
    ]) expect(isHouseName(name)).toBe(true);
    for (const name of ['Naidu Property Consulting Services Group', 'Coastline Realty', '', null, 42]) {
      expect(isHouseName(name)).toBe(false);
    }
  });

  it('finds the house in running text by its names, its domain and its initials — not by a surname', () => {
    for (const text of [
      'Naidu Property Consulting Services provides this report as general information only.',
      'Prepared by NPC Services for the named client.',
      'Visit npcservices.com.au for our terms.',
      'Questions to admin@npcservices.com.au.',
      'This is NPC advice and nobody else’s.',
    ]) expect(namesTheHouse(text)).toBe(true);
    for (const text of [
      'This report is provided for general informational purposes only.',
      'Prepared by Jane Naidu, Coastline Realty.',
      'an npc in a game is not the house',
      '',
      null,
    ]) expect(namesTheHouse(text)).toBe(false);
  });
});

describe('who a document is issued by', () => {
  it("passes over the house's name on a clone, like a placeholder, and takes the next name or the platform", () => {
    expect(resolveReportIssuer({ companyName: 'Naidu Property Consulting Services', brandName: 'Coastline Realty' }, CLONE))
      .toEqual(workspace('Coastline Realty'));
    expect(resolveReportIssuer({ companyName: 'NPC Services', brandName: 'Naidu Property Consulting' }, CLONE))
      .toEqual(platform);
    expect(resolveReportIssuer({ companyName: 'Harbour & Vine' }, CLONE)).toEqual(workspace('Harbour & Vine'));
  });

  it('passes over the house trading under a variation of its name, but not a stranger who shares its initials', () => {
    for (const companyName of ['NPC Services Melbourne', 'Naidu Property Consulting Services Group', 'www.npcservices.com.au']) {
      expect(resolveReportIssuer({ companyName }, CLONE)).toEqual(platform);
    }
    expect(resolveReportIssuer({ companyName: 'NPC Realty' }, CLONE)).toEqual(workspace('NPC Realty'));
    // The prime reads a variation exactly as it always did.
    expect(resolveReportIssuer({ companyName: 'NPC Services Melbourne' }, PRIME)).toEqual(workspace('NPC Services Melbourne'));
  });

  it('reads every name exactly as it always did on the prime, and wherever no deployment is given', () => {
    const inputs = [
      { companyName: 'Naidu Property Consulting Services' },
      { companyName: '', brandName: 'NPC Services' },
      { companyName: 'Harbour & Vine' },
      { companyName: 'NPC Property' },
      {},
    ];
    for (const input of inputs) {
      expect(resolveReportIssuer(input, PRIME)).toEqual(resolveReportIssuer(input));
    }
  });
});

describe('what a document says about who issued it', () => {
  const houseText = 'Naidu Property Consulting Services is not responsible for any decision made on this report.';
  const ownText = 'Coastline Realty provides this report for general information only.';

  it("withholds the house's wording under anybody else's name on a clone, in favour of the issuer's default", () => {
    const resolved = resolveReportDisclaimer(workspace('Coastline Realty'), { text: houseText, is_enabled: true }, CLONE);
    expect(resolved).toEqual({ text: WORKSPACE_DEFAULT_DISCLAIMER, source: 'house_withheld' });
    expect(namesTheHouse(resolved.text)).toBe(false);
  });

  it("keeps a clone's own wording, and its choice to print none", () => {
    expect(resolveReportDisclaimer(workspace('Coastline Realty'), { text: ownText, is_enabled: true }, CLONE))
      .toEqual({ text: ownText, source: 'stored' });
    expect(resolveReportDisclaimer(workspace('Coastline Realty'), { text: houseText, is_enabled: false }, CLONE))
      .toEqual({ text: '', source: 'disabled' });
  });

  it("prints the platform's statement for a platform document, whatever a row holds", () => {
    expect(resolveReportDisclaimer(platform, { text: houseText, is_enabled: true }, CLONE))
      .toEqual({ text: PLATFORM_DISCLAIMER, source: 'platform' });
  });

  it("keeps the house's wording on the house's own document on the prime — byte for byte", () => {
    for (const stored of [
      { text: houseText, is_enabled: true },
      { text: ownText, is_enabled: true },
      { text: '', is_enabled: true },
      { text: houseText, is_enabled: false },
    ]) {
      const house = workspace('Naidu Property Consulting Services');
      expect(resolveReportDisclaimer(house, stored, PRIME)).toEqual(resolveReportDisclaimer(house, stored));
    }
  });

  it('withholds nothing on the prime, whoever the prime is issuing as — its settings are its own', () => {
    for (const issuer of [workspace('Harbour & Vine'), workspace('Naidu Property Consulting Services'), platform]) {
      expect(houseWordingWithheld(houseText, issuer, PRIME)).toBe(false);
    }
    expect(resolveReportDisclaimer(workspace('Harbour & Vine'), { text: houseText, is_enabled: true }, PRIME))
      .toEqual({ text: houseText, source: 'stored' });
    expect(houseWordingWithheld(houseText, workspace('Naidu Property Consulting Services'), CLONE)).toBe(true);
    expect(houseWordingWithheld(ownText, workspace('Coastline Realty'), CLONE)).toBe(false);
  });

  it('reads stored text as it always did where no deployment is given', () => {
    expect(resolveReportDisclaimer(workspace('Coastline Realty'), { text: houseText, is_enabled: true }))
      .toEqual({ text: houseText, source: 'stored' });
  });
});

describe('how a document says to reach its issuer', () => {
  const seeded = {
    company_name: 'Naidu Property Consulting Services',
    website: 'www.npcservices.com.au',
    email: 'admin@npcservices.com.au',
    phone: '02 9000 0000',
    address: '1 Example Street, Sydney NSW 2000',
    abn: '12 345 678 901',
  };

  it("prints the issuer's name, and gives a clone nothing from a row that is the house's own", () => {
    // Its line, its office and its ABN name nobody, so they cannot be told from
    // the clone's own by reading them; the row's company says whose they are.
    const issuer = workspace('Coastline Realty');
    expect(issuerContactDetails(seeded, issuer, CLONE)).toEqual({
      company_name: 'Coastline Realty',
      website: '',
      email: '',
      phone: '',
      address: '',
      abn: '',
    });
    expect(isHouseContactRow(seeded)).toBe(true);
    expect(isHouseContactRow({ company_name: 'NPC Services Melbourne' })).toBe(true);
    expect(isHouseContactRow({ company_name: 'NPC Realty' })).toBe(false);
    expect(isHouseContactRow(null)).toBe(false);
  });

  it("leaves out only the field that names the house from a clone's own row", () => {
    const own = { company_name: 'Coastline Realty', website: 'www.npcservices.com.au', email: 'hello@coastline.example', phone: '07 5555 0000' };
    expect(issuerContactDetails(own, workspace('Coastline Realty'), CLONE)).toEqual({ ...own, website: '' });
  });

  it("keeps a clone's own details as it stored them", () => {
    const own = { company_name: 'Coastline Realty', website: 'coastline.example', email: 'hello@coastline.example', phone: '07 5555 0000' };
    expect(issuerContactDetails(own, workspace('Coastline Realty'), CLONE)).toEqual(own);
  });

  it('reads every field as stored on the prime, and wherever no deployment is given', () => {
    const house = workspace('Naidu Property Consulting Services');
    expect(issuerContactDetails(seeded, house, PRIME)).toEqual(seeded);
    expect(issuerContactDetails(seeded, workspace('Harbour & Vine'), PRIME)).toEqual({ ...seeded, company_name: 'Harbour & Vine' });
    expect(issuerContactDetails(seeded, house)).toEqual(seeded);
  });

  it('never changes the row it was handed', () => {
    const row = { ...seeded };
    issuerContactDetails(row, workspace('Coastline Realty'), CLONE);
    expect(row).toEqual(seeded);
    expect(issuerContactDetails(null, platform, CLONE)).toEqual({ company_name: PLATFORM_ISSUER_NAME });
  });
});
