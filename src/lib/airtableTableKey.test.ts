import { describe, expect, it } from 'vitest';
import {
  allowlistAdmits,
  buildAllowlist,
  canonicalTableKey,
  looksLikeTableId,
  parseTableAliases,
  sameTable,
} from '../../supabase/functions/_shared/airtableTableKey.pure';

/** The real values from this deployment, so the tests describe the actual bug. */
const INTAKE_ID = 'tblWIg5cs85O30pcY';
const INTAKE_NAME = 'Property Intake Master';
const aliases = () => parseTableAliases(`${INTAKE_NAME}=${INTAKE_ID}`);

describe('looksLikeTableId', () => {
  it('recognises an Airtable table id and nothing else', () => {
    expect(looksLikeTableId(INTAKE_ID)).toBe(true);
    for (const value of [INTAKE_NAME, 'tbl', 'tblTOOSHORT', 'recWIg5cs85O30pcY', '', null, 42]) {
      expect(looksLikeTableId(value)).toBe(false);
    }
  });
});

describe('parseTableAliases', () => {
  it('reads name=id pairs', () => {
    const map = parseTableAliases(`${INTAKE_NAME}=${INTAKE_ID},Other Table=tblAAAAAAAAAAAAAA`);
    expect(map.get('property intake master')).toBe(INTAKE_ID);
    expect(map.get('other table')).toBe('tblAAAAAAAAAAAAAA');
  });

  it('ignores entries that could not be a mapping', () => {
    // A malformed override must not become a silent misdirection to a table the
    // caller never asked for.
    const map = parseTableAliases('no-equals,=tblAAAAAAAAAAAAAA,Name=not-an-id,Name2=');
    expect(map.size).toBe(0);
  });

  it('is empty for nothing', () => {
    expect(parseTableAliases(undefined).size).toBe(0);
    expect(parseTableAliases('').size).toBe(0);
  });
});

describe('canonicalTableKey', () => {
  it('resolves the display name to the id — the bug this exists for', () => {
    // Cron syncs with no table name, so rows are written under the configured
    // default, which is an id. The Listings page asked by display name, matched
    // nothing, and silently fell back to a fifteen-request Airtable walk.
    expect(canonicalTableKey({ requested: INTAKE_NAME, aliases: aliases() })).toBe(INTAKE_ID);
    expect(canonicalTableKey({ requested: '', fallback: INTAKE_ID })).toBe(INTAKE_ID);
    expect(canonicalTableKey({ requested: INTAKE_ID, aliases: aliases() })).toBe(INTAKE_ID);
  });

  it('matches a name regardless of case and inner spacing', () => {
    const map = aliases();
    expect(canonicalTableKey({ requested: '  property   intake master ', aliases: map })).toBe(INTAKE_ID);
    expect(canonicalTableKey({ requested: 'PROPERTY INTAKE MASTER', aliases: map })).toBe(INTAKE_ID);
  });

  it('hands back an unresolvable name unchanged rather than failing', () => {
    // Airtable accepts a display name in a URL, so the previous behaviour still
    // works; the allowlist downstream is what refuses an unknown table.
    expect(canonicalTableKey({ requested: 'Some Other Table', aliases: aliases() })).toBe('Some Other Table');
  });

  it('returns null when nothing was supplied', () => {
    expect(canonicalTableKey({ requested: '', fallback: '' })).toBeNull();
    expect(canonicalTableKey({})).toBeNull();
  });
});

describe('sameTable', () => {
  it('sees through the two spellings of one table', () => {
    expect(sameTable(INTAKE_NAME, INTAKE_ID, aliases())).toBe(true);
    expect(sameTable(INTAKE_ID, INTAKE_ID)).toBe(true);
    expect(sameTable(INTAKE_NAME, 'tblAAAAAAAAAAAAAA', aliases())).toBe(false);
    expect(sameTable(null, INTAKE_ID)).toBe(false);
  });
});

describe('buildAllowlist / allowlistAdmits', () => {
  it('admits either spelling whichever way the deployment is configured', () => {
    const byId = buildAllowlist(INTAKE_ID, '', aliases());
    expect(allowlistAdmits(byId, INTAKE_ID)).toBe(true);
    expect(allowlistAdmits(byId, canonicalTableKey({ requested: INTAKE_NAME, aliases: aliases() }))).toBe(true);

    const byName = buildAllowlist(INTAKE_NAME, '', aliases());
    expect(allowlistAdmits(byName, INTAKE_ID)).toBe(true);
  });

  it('still refuses a table nobody allowed', () => {
    const allowed = buildAllowlist(INTAKE_ID, '', aliases());
    expect(allowlistAdmits(allowed, 'tblAAAAAAAAAAAAAA')).toBe(false);
    expect(allowlistAdmits(allowed, 'Secret Table')).toBe(false);
    expect(allowlistAdmits(allowed, null)).toBe(false);
  });

  it('reads the comma-separated extra allowlist', () => {
    const allowed = buildAllowlist(INTAKE_ID, ' tblAAAAAAAAAAAAAA , tblBBBBBBBBBBBBBB ', aliases());
    expect(allowlistAdmits(allowed, 'tblAAAAAAAAAAAAAA')).toBe(true);
    expect(allowlistAdmits(allowed, 'tblBBBBBBBBBBBBBB')).toBe(true);
    expect(allowlistAdmits(allowed, 'tblCCCCCCCCCCCCCC')).toBe(false);
  });
});
