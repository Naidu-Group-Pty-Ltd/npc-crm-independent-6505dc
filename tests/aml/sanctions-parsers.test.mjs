/**
 * Unit tests for the sanctions list parsers.
 *
 * Run: npm run test:aml-sanctions
 *
 * These cover the two ways a screening list goes quietly wrong: names that
 * parse into the wrong shape, and normalisation drifting away from the
 * matcher that queries it. Both fail open — they produce a list that looks
 * loaded and screens against nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import XLSX from 'xlsx';

import {
  normaliseName, parseCsv, parseOfac, parseUn,
  parseDfatCsv, parseDfatWorkbook, rowsToDfatEntries, dfatListingKey,
  findSpreadsheetLink, withNormalisedNames,
  HONORIFICS, ENTITY_SUFFIXES, PARTICLES,
} from '../../scripts/aml/sanctionsParsers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/* ── normalisation parity with the TypeScript matcher ───────────────────── */

test('normalisation word lists match _shared/aml/matching.ts exactly', () => {
  const ts = readFileSync(
    path.join(repoRoot, 'supabase/functions/_shared/aml/matching.ts'), 'utf8');

  const extract = (name) => {
    const m = ts.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
    assert.ok(m, `${name} not found in matching.ts`);
    return new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  };

  for (const [name, jsSet] of [
    ['HONORIFICS', HONORIFICS],
    ['ENTITY_SUFFIXES', ENTITY_SUFFIXES],
    ['PARTICLES', PARTICLES],
  ]) {
    const tsSet = extract(name);
    const onlyTs = [...tsSet].filter((t) => !jsSet.has(t));
    const onlyJs = [...jsSet].filter((t) => !tsSet.has(t));
    assert.deepEqual(onlyTs, [], `${name}: in matching.ts but not the loader`);
    assert.deepEqual(onlyJs, [], `${name}: in the loader but not matching.ts`);
  }
});

test('normaliseName strips honorifics, suffixes, particles and diacritics', () => {
  assert.deepEqual(normaliseName('Mr John Smith'), ['john', 'smith']);
  assert.deepEqual(normaliseName('Acme Holdings Pty Ltd'), ['acme']);
  assert.deepEqual(normaliseName('Ali bin Hassan'), ['ali', 'hassan']);
  assert.deepEqual(normaliseName('Jose Ángel Núñez'), ['jose', 'angel', 'nunez']);
  assert.deepEqual(normaliseName(''), []);
  assert.deepEqual(normaliseName(null), []);
});

/* ── DFAT: one row per name variant, grouped by reference ───────────────── */

const DFAT_HEADER = [
  'Reference', 'Name of Individual or Entity', 'Name Type', 'Type',
  'Date of Birth', 'Place of Birth', 'Citizenship', 'Address',
  'Additional Information', 'Committees',
];

const DFAT_ROWS = [
  ['The Consolidated List', '', '', '', '', '', '', '', '', ''], // title row above the header
  DFAT_HEADER,
  ['AF001', 'Mohammed Omar', 'Primary Name', 'Individual', '1960', 'Kandahar', 'Afghan', 'Kabul', 'Taliban leader', 'Al-Qaida'],
  ['AF001', 'Mullah Omar', 'aka', 'Individual', '', '', '', '', '', ''],
  ['AF001', 'Mohammad Umar', 'aka', 'Individual', '', '', '', '', '', ''],
  ['EN002', 'Acme Trading Pty Ltd', 'Primary Name', 'Entity', '', '', '', 'Sydney', '', 'Autonomous'],
];

test('DFAT rows group by reference: aliases collapse into one listing', () => {
  const entries = rowsToDfatEntries(DFAT_ROWS);
  assert.equal(entries.length, 2, 'three name rows for AF001 must produce one listing');

  const omar = entries.find((e) => e.external_id === 'DFAT-AF001');
  assert.equal(omar.primary_name, 'Mohammed Omar');
  assert.deepEqual(omar.aliases.sort(), ['Mohammad Umar', 'Mullah Omar']);
  assert.equal(omar.entry_type, 'individual');
  assert.equal(omar.date_of_birth, '1960');
  assert.equal(omar.place_of_birth, 'Kandahar');
  assert.equal(omar.listing_detail.name_variants, 3);

  const acme = entries.find((e) => e.external_id === 'DFAT-EN002');
  assert.equal(acme.entry_type, 'entity');
  assert.deepEqual(acme.aliases, []);
});

test('DFAT aliases are searchable — every variant lands in normalised_names', () => {
  const [omar] = rowsToDfatEntries(DFAT_ROWS).filter((e) => e.external_id === 'DFAT-AF001');
  const row = withNormalisedNames(omar, 'dfat', null);
  for (const token of ['mohammed', 'omar', 'mullah', 'mohammad', 'umar']) {
    assert.ok(row.normalised_names.includes(token), `expected token ${token}`);
  }
});

test('DFAT header is found even when it is not the first row', () => {
  assert.equal(rowsToDfatEntries(DFAT_ROWS).length, 2);
});

/* ── DFAT: the format published since November 2025 ─────────────────────── */

/**
 * The shape DFAT actually publishes now: one row per name variant, but each
 * additional name carries the listing's reference with a LETTER APPENDED
 * rather than repeated verbatim. Grouping on the raw cell stopped grouping
 * anything — against the list published 21 July 2026 it turned 3,846 listings
 * into 10,581, each a single name with no aliases and, for two rows in three,
 * an alias standing in as the sanctioned party's primary name.
 */
const DFAT_2025_HEADER = [
  'Reference', 'Name of Individual or Entity', 'Type', 'Name Type',
  'Alias Strength', 'Date of Birth', 'Place of Birth', 'Citizenship',
  'Address', 'Additional Information', 'Listing Information', 'IMO Number',
  'Committees', 'Control Date', 'Instrument of Designation',
  'Targeted Financial Sanction', 'Travel Ban', 'Arms Embargo',
  'Maritime Restriction',
];

const DFAT_2025_ROWS = [
  DFAT_2025_HEADER,
  ['2', 'MOHAMMAD HASSAN AKHUND', 'Individual', 'Primary Name', '', '1945',
   'Kandahar', 'Afghanistan', 'Kabul', 'Taliban', '', '', '1988 (Taliban)',
   '3/26/26', 'Taliban Regulation 2013', 'TRUE', 'TRUE', 'FALSE', 'FALSE'],
  ['2a', 'محمد حسن أخوند', 'Individual', 'Original Script', '', '', '', '', '',
   '', '', '', '', '3/26/26', '', 'TRUE', 'TRUE', 'FALSE', 'FALSE'],
  ['2b', 'Haji Mudir', 'Individual', 'Alias', 'Weak', '', '', '', '', '', '',
   '', '', '3/26/26', '', 'TRUE', 'TRUE', 'FALSE', 'FALSE'],
  ['417', 'ANDAMAN SKIES', 'Vessel', 'Primary Name', '', '', '', '', '', '',
   '', '9288693', '', '5/8/26', 'Russia Instrument 2025', 'FALSE', 'FALSE',
   'FALSE', 'TRUE'],
];

test('DFAT suffixed references group back onto one listing', () => {
  const entries = rowsToDfatEntries(DFAT_2025_ROWS);
  assert.equal(entries.length, 2, 'references 2 / 2a / 2b are ONE listing');

  const akhund = entries.find((e) => e.external_id === 'DFAT-2');
  assert.equal(akhund.primary_name, 'MOHAMMAD HASSAN AKHUND');
  assert.deepEqual(akhund.aliases.sort(), ['Haji Mudir', 'محمد حسن أخوند'].sort());
  assert.equal(akhund.entry_type, 'individual');
});

test('a reference that is entirely alphabetic is not collapsed to nothing', () => {
  // Stripping the suffix must never empty the key — that would merge every
  // such listing into one.
  assert.equal(dfatListingKey('ABC'), 'ABC');
  assert.equal(dfatListingKey('2a'), '2');
  assert.equal(dfatListingKey('AF001'), 'AF001');
  assert.equal(dfatListingKey('AF001b'), 'AF001');
});

test('DFAT weak aliases stay searchable and are recorded as weak', () => {
  const [akhund] = rowsToDfatEntries(DFAT_2025_ROWS)
    .filter((e) => e.external_id === 'DFAT-2');
  // Dropping a weak alias would lose real hits, so it is still an alias...
  assert.ok(akhund.aliases.includes('Haji Mudir'));
  // ...but the adjudicating analyst is told which kind of name matched.
  assert.deepEqual(akhund.listing_detail.weak_aliases, ['Haji Mudir']);
});

test('DFAT vessels are typed as vessels and keep their IMO and measures', () => {
  const vessel = rowsToDfatEntries(DFAT_2025_ROWS)
    .find((e) => e.external_id === 'DFAT-417');
  assert.equal(vessel.entry_type, 'vessel');
  assert.equal(vessel.listing_detail.imo_number, '9288693');
  assert.equal(vessel.listing_detail.measures.maritime_restriction, true);
  assert.equal(vessel.listing_detail.measures.targeted_financial_sanction, false);
});

test('DFAT parsing refuses to guess when no name column resolves', () => {
  assert.throws(
    () => rowsToDfatEntries([['Col A', 'Col B'], ['x', 'y']]),
    /could not find a DFAT header row/,
  );
});

test('DFAT CSV and XLSX produce identical entries', () => {
  const csv = DFAT_ROWS.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const fromCsv = parseDfatCsv(csv);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(DFAT_ROWS), 'List');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fromXlsx = parseDfatWorkbook(buf);

  assert.deepEqual(fromXlsx, fromCsv);
  assert.equal(fromXlsx.length, 2);
});

/* ── download link discovery ────────────────────────────────────────────── */

test('findSpreadsheetLink prefers the consolidated xlsx and absolutises it', () => {
  const html = `
    <a href="/sites/default/files/other-doc.csv">other</a>
    <a href="/sites/default/files/regulation8_consolidated.xlsx">Consolidated List (XLSX)</a>
    <a href="/sites/default/files/guidance.xls">guidance</a>`;
  assert.equal(
    findSpreadsheetLink(html, 'https://www.dfat.gov.au/international-relations/security/sanctions/consolidated-list'),
    'https://www.dfat.gov.au/sites/default/files/regulation8_consolidated.xlsx',
  );
});

test('findSpreadsheetLink returns null rather than a wrong guess', () => {
  assert.equal(findSpreadsheetLink('<a href="/page.html">nothing here</a>', 'https://x.test/'), null);
});

/* ── OFAC / UN regression cover ─────────────────────────────────────────── */

test('parseOfac reads uid, name, type and DOB out of remarks', () => {
  const line = ['12345', 'SMITH, John', 'individual', '-0-', '-0-', '-0-', '-0-', '-0-', '-0-', '-0-', '-0-',
    'DOB 01 Jan 1970; nationality Australia'].map((f) => `"${f}"`).join(',');
  const [e] = parseOfac(line);
  assert.equal(e.external_id, 'OFAC-12345');
  assert.equal(e.primary_name, 'SMITH, John');
  assert.equal(e.entry_type, 'individual');
  assert.equal(e.date_of_birth, '01 Jan 1970');
});

test('parseUn reads names, aliases and entry type', () => {
  const xml = `<CONSOLIDATED_LIST><INDIVIDUALS><INDIVIDUAL>
      <DATAID>6908</DATAID><FIRST_NAME>Ibrahim</FIRST_NAME><SECOND_NAME>Awwad</SECOND_NAME>
      <REFERENCE_NUMBER>QDi.299</REFERENCE_NUMBER><COMMENTS1>Listed 2011</COMMENTS1>
      <INDIVIDUAL_ALIAS><ALIAS_NAME>Abu Duaa</ALIAS_NAME></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_DATE_OF_BIRTH><YEAR>1971</YEAR></INDIVIDUAL_DATE_OF_BIRTH>
    </INDIVIDUAL></INDIVIDUALS></CONSOLIDATED_LIST>`;
  const [e] = parseUn(xml);
  assert.equal(e.external_id, 'UN-6908');
  assert.equal(e.primary_name, 'Ibrahim Awwad');
  assert.deepEqual(e.aliases, ['Abu Duaa']);
  assert.equal(e.entry_type, 'individual');
  assert.equal(e.date_of_birth, '1971');
  assert.equal(e.listing_reference, 'QDi.299');
});

test('parseCsv handles quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('a,"b,c","d""e"\n1,2,3'), [['a', 'b,c', 'd"e'], ['1', '2', '3']]);
});

/* ── the row shape the database actually receives ───────────────────────── */

test('withNormalisedNames emits every column sanctions_entries requires', () => {
  const row = withNormalisedNames({
    external_id: 'DFAT-1', primary_name: 'Acme Pty Ltd', aliases: ['Acme Trading'],
    entry_type: 'entity', listing_reference: 'Autonomous', listing_detail: {},
  }, 'dfat', 'sync-1');
  for (const col of ['list_code', 'external_id', 'entry_type', 'primary_name', 'aliases',
    'normalised_names', 'date_of_birth', 'place_of_birth', 'nationalities',
    'listing_reference', 'listing_detail', 'sync_id', 'updated_at']) {
    assert.ok(col in row, `missing column ${col}`);
  }
  assert.equal(row.sync_id, 'sync-1');
  assert.deepEqual(row.normalised_names, ['acme', 'trading']);
});
