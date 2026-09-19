/**
 * The brand snapshot.
 *
 * Two properties carry the whole idea and are asserted first:
 *
 *  1. **Reproducibility.** The same inputs produce the same snapshot, byte for
 *     byte, forever. If they do not, re-issuing a year-old report is a
 *     different document and the pinning was theatre.
 *  2. **The fingerprint covers everything.** It is the dedupe key, so a field
 *     it does not cover is a field that can change without a new row — and a
 *     thousand reports then share a snapshot that does not describe them.
 *
 * The second is tested exhaustively rather than by example: the test walks every
 * leaf of the snapshot, mutates it, and requires the fingerprint to move. Adding
 * a field without adding it to the canonical form fails automatically.
 */
/* eslint-disable no-restricted-syntax --
 * Fixture colours and expected values. These assert what the normaliser does to
 * a given input; they are not palette choices.
 */
import { describe, expect, it } from 'vitest';
import {
  REPORT_SNAPSHOT_VERSION,
  auditSnapshot,
  buildReportBrandSnapshot,
  companyContactFor,
  lockupFor,
  normalizeBrandColour,
  paletteInputFor,
  snapshotFingerprint,
  type ReportBrandSnapshot,
} from '../snapshot.pure';
import { resolveReportPalette } from '../brandResolve.pure';
import { mastheadFor, resolveCompanyBlock } from '../companyBlock.pure';

const PNG = `data:image/png;base64,${'A'.repeat(1024)}`;
const PNG_B = `data:image/png;base64,${'B'.repeat(1024)}`;
const CAPTURED = '2026-08-02T00:00:00.000Z';

const fullInput = () => ({
  whitelabel: {
    id: '11111111-1111-4111-8111-111111111111',
    themeVersion: 2,
    companyName: 'Meridian Property Partners',
    tradingName: 'Meridian',
    brandColour: '43 74% 49%',
    preset: 'editorial_navy',
    assets: { report: PNG, reportMono: PNG_B },
  },
  contact: {
    company_name: 'Legacy Name Pty Ltd',
    website: 'meridianpartners.example',
    email: 'advice@meridianpartners.example',
    phone: '+61 7 5555 0100',
    address: 'Level 8, 100 Example Street, Brisbane QLD 4000',
    abn: '11 222 333 444',
  },
  document: { confidentiality: 'Confidential', preparedBy: 'A. Advisor' },
  capturedAt: CAPTURED,
});

describe('normalizeBrandColour', () => {
  it.each([
    ['#D9A520', '#D9A520'],
    ['#d9a520', '#D9A520'],
    ['#ABC', '#AABBCC'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeBrandColour(input)).toBe(expected);
  });

  it('converts the bare HSL triplet the settings column also stores', () => {
    // `whitelabel_settings` accepts a triplet OR a hex — the validator trigger in
    // migration 20260423175929 permits both — so both arrive here.
    const hex = normalizeBrandColour('43 74% 49%');
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('drops anything else rather than guessing', () => {
    // A malformed brand colour must print the house brand, not a colour derived
    // from a typo.
    for (const bad of ['red', 'rgb(1,2,3)', '#GGGGGG', '', '   ', null, undefined, 42, {}]) {
      expect(normalizeBrandColour(bad)).toBeNull();
    }
  });
});

describe('buildReportBrandSnapshot', () => {
  it('is reproducible — the same inputs give a byte-identical snapshot', () => {
    const a = buildReportBrandSnapshot(fullInput()).snapshot;
    const b = buildReportBrandSnapshot(fullInput()).snapshot;
    expect(a).toEqual(b);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('takes capturedAt as an input — this module has no clock', () => {
    expect(buildReportBrandSnapshot(fullInput()).snapshot.source.capturedAt).toBe(CAPTURED);
  });

  it('prefers the white-label company name over the legacy contact field', () => {
    const { snapshot } = buildReportBrandSnapshot(fullInput());
    expect(snapshot.company.name).toBe('Meridian Property Partners');
  });

  it('falls back to the contact name when white-label has none', () => {
    const input = fullInput();
    input.whitelabel.companyName = '';
    expect(buildReportBrandSnapshot(input).snapshot.company.name).toBe('Legacy Name Pty Ltd');
  });

  it('takes the ABN from contact details — the only place that carries one', () => {
    expect(buildReportBrandSnapshot(fullInput()).snapshot.company.abn).toBe('11 222 333 444');
  });

  it('resolves both marks, and the mono slot falls back to the colour mark', () => {
    const input = fullInput();
    input.whitelabel.assets = { report: PNG, reportMono: '' };
    const { snapshot } = buildReportBrandSnapshot(input);
    expect(snapshot.logo.report).toBe(PNG);
    expect(snapshot.logo.mono).toBe(PNG);
  });

  it('reports an asset that failed policy instead of swallowing it', () => {
    const input = fullInput();
    input.whitelabel.assets = { report: 'https://cdn.example.com/logo.png', reportMono: '' };
    const { snapshot, skippedAssets } = buildReportBrandSnapshot(input);
    expect(snapshot.logo.report).toBeNull();
    expect(skippedAssets).toEqual([
      expect.objectContaining({ source: 'report', reason: 'not-a-data-uri' }),
    ]);
  });

  it('falls back to the house preset for an unknown one', () => {
    const input = fullInput();
    input.whitelabel.preset = 'chartreuse_disco';
    expect(buildReportBrandSnapshot(input).snapshot.preset).toBe('signature');
  });

  it('is total — an empty input produces a complete snapshot, not a throw', () => {
    const { snapshot } = buildReportBrandSnapshot({ capturedAt: CAPTURED });
    expect(snapshot.version).toBe(REPORT_SNAPSHOT_VERSION);
    expect(snapshot.company.name).toBe('');
    expect(snapshot.brandHex).toBeNull();
    expect(snapshot.preset).toBe('signature');
    expect(snapshot.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('stamps the fingerprint on the snapshot it returns', () => {
    const { snapshot } = buildReportBrandSnapshot(fullInput());
    expect(snapshot.fingerprint).toBe(snapshotFingerprint(snapshot));
  });
});

describe('snapshotFingerprint', () => {
  const base = () => buildReportBrandSnapshot(fullInput()).snapshot;

  it('matches the shape the migration CHECK constraint enforces', () => {
    expect(base().fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ignores the fingerprint field itself, so it is stable under re-stamping', () => {
    const s = base();
    const stamped: ReportBrandSnapshot = { ...s, fingerprint: 'deadbeefdeadbeef' };
    expect(snapshotFingerprint(stamped)).toBe(s.fingerprint);
  });

  /**
   * Every leaf of the snapshot, mutated. If a field can change without moving
   * the fingerprint, a thousand renders share a row that does not describe them.
   */
  const leaves: Array<[string, (s: ReportBrandSnapshot) => ReportBrandSnapshot]> = [
    ['company.name', (s) => ({ ...s, company: { ...s.company, name: 'Other' } })],
    ['company.tradingName', (s) => ({ ...s, company: { ...s.company, tradingName: 'Other' } })],
    ['company.abn', (s) => ({ ...s, company: { ...s.company, abn: '99 999 999 999' } })],
    ['company.website', (s) => ({ ...s, company: { ...s.company, website: 'other.example' } })],
    ['company.email', (s) => ({ ...s, company: { ...s.company, email: 'x@other.example' } })],
    ['company.phone', (s) => ({ ...s, company: { ...s.company, phone: '+61 2 0000 0000' } })],
    ['company.address', (s) => ({ ...s, company: { ...s.company, address: 'Elsewhere' } })],
    ['brandHex', (s) => ({ ...s, brandHex: '#00A3FF' })],
    ['preset', (s) => ({ ...s, preset: 'minimal_ink' as const })],
    ['logo.report', (s) => ({ ...s, logo: { ...s.logo, report: PNG_B } })],
    ['logo.mono', (s) => ({ ...s, logo: { ...s.logo, mono: PNG } })],
    ['document.confidentiality', (s) => ({ ...s, document: { ...s.document, confidentiality: 'Internal' } })],
    ['document.preparedBy', (s) => ({ ...s, document: { ...s.document, preparedBy: 'B. Advisor' } })],
    ['version', (s) => ({ ...s, version: s.version + 1 })],
    ['source.whitelabelSettingId', (s) => ({ ...s, source: { ...s.source, whitelabelSettingId: 'other' } })],
    ['source.themeVersion', (s) => ({ ...s, source: { ...s.source, themeVersion: 3 } })],
    ['source.capturedAt', (s) => ({ ...s, source: { ...s.source, capturedAt: '2027-01-01T00:00:00.000Z' } })],
  ];

  it.each(leaves)('changes when %s changes', (_label, mutate) => {
    expect(snapshotFingerprint(mutate(base()))).not.toBe(base().fingerprint);
  });

  it('covers every leaf the snapshot has — a new field cannot be forgotten', () => {
    // Guards the list above: if the shape grows a branch, this count moves and
    // the test that follows it must too.
    const countLeaves = (value: unknown): number => {
      if (value === null || typeof value !== 'object') return 1;
      return Object.entries(value as Record<string, unknown>)
        .filter(([k]) => k !== 'fingerprint')
        .reduce((n, [, v]) => n + countLeaves(v), 0);
    };
    expect(countLeaves(base())).toBe(leaves.length);
  });

  it('distinguishes non-ASCII names that differ only in a multibyte character', () => {
    const a = base();
    const b = { ...a, company: { ...a.company, name: 'Meridián Property Partners' } };
    expect(snapshotFingerprint(b)).not.toBe(snapshotFingerprint(a));
  });

  it('does not depend on key insertion order', () => {
    const s = base();
    const reordered = JSON.parse(JSON.stringify({
      source: s.source,
      logo: s.logo,
      version: s.version,
      document: s.document,
      preset: s.preset,
      brandHex: s.brandHex,
      company: s.company,
      fingerprint: s.fingerprint,
    })) as ReportBrandSnapshot;
    expect(snapshotFingerprint(reordered)).toBe(s.fingerprint);
  });
});

describe('adapters — a snapshot is the only input the render layer needs', () => {
  const { snapshot } = buildReportBrandSnapshot(fullInput());

  it('drives resolveReportPalette without a second notion of the brand', () => {
    const palette = resolveReportPalette(paletteInputFor(snapshot));
    expect(palette.accentFill).toBe(snapshot.brandHex);
  });

  it('drives the company block and the running foot', () => {
    const contact = companyContactFor(snapshot);
    expect(mastheadFor(contact)).toBe('Meridian Property Partners');
    const block = resolveCompanyBlock(contact, { is_enabled: false, text: '' });
    expect(block.rows.map((r) => r.label)).toEqual(['Website', 'Email', 'Phone', 'Address', 'ABN']);
  });

  it('gives the dark ground the mono mark and paper the colour mark', () => {
    expect(lockupFor(snapshot, 'field')?.markDataUri).toBe(PNG_B);
    expect(lockupFor(snapshot, 'paper')?.markDataUri).toBe(PNG);
    expect(lockupFor(snapshot, 'field')?.onField).toBe(true);
  });

  it('sets the wordmark only when there is no mark to repeat', () => {
    expect(lockupFor(snapshot, 'paper')?.wordmark).toBeNull();
    const noMark = buildReportBrandSnapshot({
      whitelabel: { companyName: 'Solo Advisory' },
      capturedAt: CAPTURED,
    }).snapshot;
    expect(lockupFor(noMark, 'paper')?.wordmark).toBe('Solo Advisory');
  });

  it('renders no lockup at all when there is neither mark nor name', () => {
    const empty = buildReportBrandSnapshot({ capturedAt: CAPTURED }).snapshot;
    expect(lockupFor(empty, 'paper')).toBeNull();
  });
});

describe('auditSnapshot', () => {
  it('is silent on a complete snapshot', () => {
    const { snapshot } = buildReportBrandSnapshot(fullInput());
    expect(auditSnapshot(snapshot, { is_enabled: true, text: 'x' })).toEqual([]);
  });

  it('names every gap on an empty one', () => {
    const { snapshot } = buildReportBrandSnapshot({ capturedAt: CAPTURED });
    const gaps = auditSnapshot(snapshot).join('\n');
    expect(gaps).toContain('no company name');
    expect(gaps).toContain('no brand mark');
    expect(gaps).toContain('no ABN');
    expect(gaps).toContain('no contact route');
  });

  it('flags a snapshot written by a different release', () => {
    const { snapshot } = buildReportBrandSnapshot(fullInput());
    const stale = { ...snapshot, version: REPORT_SNAPSHOT_VERSION + 1 };
    expect(auditSnapshot(stale).join('\n')).toContain('different release');
  });

  it('flags a disabled disclaimer', () => {
    const { snapshot } = buildReportBrandSnapshot(fullInput());
    expect(auditSnapshot(snapshot, { is_enabled: false, text: 'x' }).join('\n'))
      .toContain('disclaimer is disabled');
  });

  it('flags an absent disclaimer, not only a disabled one', () => {
    // This guarded on `disclaimer &&`, so the two ways it goes missing without
    // anybody choosing that — an unreadable `global_report_settings` query,
    // which the render routes warn about and swallow, and a settings row that
    // was never written — were the two it stayed silent about. Both arrive as
    // `null`, and both printed a closing page with no disclaimer and no gap.
    const { snapshot } = buildReportBrandSnapshot(fullInput());
    expect(auditSnapshot(snapshot, null).join('\n')).toContain('no professional disclaimer');
    expect(auditSnapshot(snapshot).join('\n')).toContain('no professional disclaimer');
  });

  it('flags a disclaimer that is enabled and empty', () => {
    const { snapshot } = buildReportBrandSnapshot(fullInput());
    expect(auditSnapshot(snapshot, { is_enabled: true, text: '   ' } as never).join('\n'))
      .toContain('enabled but empty');
  });

  it('says nothing about a disclaimer that is there', () => {
    const { snapshot } = buildReportBrandSnapshot(fullInput());
    expect(auditSnapshot(snapshot, { is_enabled: true, text: 'General advice only.' } as never)
      .join('\n')).not.toContain('disclaimer');
  });
});
