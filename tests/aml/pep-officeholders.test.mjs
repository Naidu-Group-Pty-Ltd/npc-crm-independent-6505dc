/**
 * The public office-holder index: the parser, and the loader's rules.
 *
 * These run under `node --test` before anything is written, exactly like the
 * sanctions parser tests, because the failure mode is the same shape: an
 * index that parses to nothing, or that normalises differently from the
 * query, looks precisely like an index that works.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  APH_REGISTERS, WIKIDATA_AU_OFFICES_QUERY, accumulateWikidataOfficeholders,
  buildWikidataOfficeholderQuery, officeholderEntries, parseAphRegister,
  parseWikidataOfficeholders, splitTitleCell, truncateWikidataDate,
  withNormalisedNames,
} from '../../scripts/aml/pepOfficeholderParsers.mjs';
import { summariseRuleCoverage } from '../../supabase/functions/_shared/aml/pepRuleCoverage.pure.ts';
import { normaliseName, parseCsv } from '../../scripts/aml/sanctionsParsers.mjs';
import { CANDIDATE_SOURCES } from '../../scripts/aml/pepSourceCatalogue.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const loader = readFileSync(join(root, 'scripts/aml/load-pep-officeholders.mjs'), 'utf8');
const migration = readFileSync(
  join(root, 'supabase/migrations/20260927000000_aml_pep_officeholder_index.sql'), 'utf8');

/*
 * The endpoint returns ONE ROW PER PERSON, with aliases and positions
 * collapsed by GROUP_CONCAT. That is not a preference: asking for both as
 * plain OPTIONALs returns their cross-product, and 60 offices produced
 * 8.5 MB — over the endpoint's own 60-second ceiling, which it answers with
 * HTTP 200 and a body cut off mid-value.
 */
const binding = (over = {}) => ({
  person: { value: 'http://www.wikidata.org/entity/Q42' },
  personLabel: { value: 'Pat Example' },
  positions: { value: 'member of the Australian House of Representatives~~' },
  ...over,
});
const results = (bindings) => ({ results: { bindings } });
const pos = (title, start = '', end = '') => `${title}~${start}~${end}`;

/* ── the parser ───────────────────────────────────────────────────────── */

test('one row per person, with every term carried rather than repeated', () => {
  const rows = parseWikidataOfficeholders(results([binding({
    positions: { value: [
      pos('member of the Australian House of Representatives', '2016-07-02T00:00:00Z', '2019-05-18T00:00:00Z'),
      pos('member of the Australian House of Representatives', '2019-05-18T00:00:00Z', '2022-05-21T00:00:00Z'),
    ].join('||') },
  })]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].external_id, 'Q42');
  assert.equal(rows[0].source_detail.position_count, 2);
});

test('a person is merged ACROSS batches, not overwritten by the last one', () => {
  // Offices are queried in chunks, and the Prime Minister is also a member
  // of the House. Upserting per chunk would keep whichever arrived last.
  const acc = accumulateWikidataOfficeholders(results([binding({
    positions: { value: pos('member of the Australian House of Representatives', '2013-09-07T00:00:00Z') },
  })]));
  accumulateWikidataOfficeholders(results([binding({
    positions: { value: pos('Prime Minister of Australia', '2018-08-24T00:00:00Z') },
    aliases: { value: 'Patricia Example' },
  })]), acc);
  const rows = officeholderEntries(acc);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_detail.position_count, 2);
  assert.deepEqual(rows[0].aliases, ['Patricia Example']);
});

test('the office SHOWN is the current one, else the most recent', () => {
  const rows = parseWikidataOfficeholders(results([binding({
    positions: { value: [
      pos('member of the Australian House of Representatives', '2010-01-01T00:00:00Z', '2013-01-01T00:00:00Z'),
      pos('Minister for Finance', '2020-01-01T00:00:00Z'),
    ].join('||') },
  })]));
  assert.equal(rows[0].position_title, 'Minister for Finance');
  assert.equal(rows[0].currently_held, true);
});

test('a former office holder is INDEXED, never filtered out', () => {
  // Leaving a position does not end the risk — the treatment is a risk
  // assessment, not an expiry date — so the index carries them and the
  // determination decides.
  const rows = parseWikidataOfficeholders(results([binding({
    positions: { value: pos('member of the Australian House of Representatives',
      '1934-09-15T00:00:00Z', '1966-02-17T00:00:00Z') },
  })]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currently_held, false);
  assert.equal(rows[0].position_end, '1966-02-17');
});

test('"no end date recorded" is not "still in office" when there is no start either', () => {
  const rows = parseWikidataOfficeholders(results([binding()]));
  assert.equal(rows[0].currently_held, null);
});

test('the index asserts no AUSTRAC category', () => {
  // Foreign / domestic / international-organisation belongs to the
  // determination. It is also unavailable here: "applies to jurisdiction:
  // Australia" correctly includes foreign ambassadors posted to Australia,
  // so stamping every row `domestic` was wrong on the face of the data.
  assert.equal(parseWikidataOfficeholders(results([binding()]))[0].pep_type, null);
  assert.equal(withNormalisedNames({
    external_id: 'Q1', full_name: 'Pat Example', position_title: 'Senator',
  }, 'wikidata_au_public_office', null).pep_type, null);
});

test('a Q-id label is not a name and not an office', () => {
  // Wikidata emits the raw entity id when it has no English label. Indexed
  // as a name it is unsearchable noise; shown as an office it is a machine
  // id where the position should be.
  assert.deepEqual(parseWikidataOfficeholders(results([
    binding({ personLabel: { value: 'Q23939864' } }),
  ])), []);
  assert.deepEqual(parseWikidataOfficeholders(results([
    binding({ positions: { value: pos('Q12345') } }),
  ])), []);
});

test('aliases are collected, de-duplicated, and never the primary name again', () => {
  const rows = parseWikidataOfficeholders(results([
    binding({ aliases: { value: 'Patricia Example||Patricia Example||Pat Example' } }),
  ]));
  assert.deepEqual(rows[0].aliases, ['Patricia Example']);
});

test('a malformed response is no rows, never a throw', () => {
  for (const bad of [null, {}, { results: {} }, { results: { bindings: 'x' } }]) {
    assert.deepEqual(parseWikidataOfficeholders(bad), []);
  }
});

test('every row can say where to CONFIRM it', () => {
  const rows = parseWikidataOfficeholders(results([binding()]));
  assert.ok(rows[0].confirm_url.startsWith('https://'));
});

/* ── normalisation ────────────────────────────────────────────────────── */

test('names are indexed with the SAME function the query uses', () => {
  // Not a stylistic preference. The search is a token overlap against
  // `normalised_names`; a second implementation that dropped one more
  // honorific would write rows no query can ever match.
  const row = withNormalisedNames({
    external_id: 'Q42', full_name: 'Sir Pat Example',
    aliases: ['Patricia Example'], position_title: 'Senator',
  }, 'wikidata_au_public_office', null);
  assert.deepEqual(row.normalised_names,
    [...new Set([...normaliseName('Sir Pat Example'), ...normaliseName('Patricia Example')])]);
  assert.ok(!row.normalised_names.includes('sir'));
});

test('a row with no searchable tokens is dropped by the loader and refused by the column', () => {
  const row = withNormalisedNames({
    external_id: 'Q1', full_name: 'Mr', aliases: [], position_title: 'Senator',
  }, 'wikidata_au_public_office', null);
  assert.deepEqual(row.normalised_names, []);
  assert.match(loader, /filter\(\(r\) => r\.normalised_names\.length > 0\)/);
  assert.match(migration, /cardinality\(normalised_names\) > 0/);
});

/* ── the loader's rules, each of which cost a production incident ─────── */

test('an index that parsed to zero entries is never published', () => {
  // An empty index is not "nobody holds public office"; it is a download
  // that failed, and it answers a search with the same zero rows.
  assert.match(loader, /refusing to publish an empty index/);
});

test('a shrink is a truncated response until a person says otherwise', () => {
  assert.match(loader, /PRUNE_SHRINK_FLOOR/);
  assert.match(loader, /--force-prune/);
});

test("the prune names sync_id in the RETURNING projection", () => {
  // On a MUTATION, PostgREST resolves the columns inside a logical or=(…)
  // against the RETURNING projection rather than the table, and answers
  // 42703 for a column the table plainly has. On the sanctions loader that
  // failed every load it was part of.
  const prune = loader.slice(loader.indexOf("from('pep_officeholders').delete()"));
  assert.match(prune, /\.select\('id, sync_id'\)/);
  assert.match(prune, /sync_id\.is\.null,sync_id\.neq\./);
});

test('a failed load is RECORDED as failed, so a search can refuse rather than return nothing', () => {
  assert.match(loader, /status: 'failed'/);
  assert.match(loader, /error_message/);
});

test('the query carries former holders and does not filter by date', () => {
  const q = buildWikidataOfficeholderQuery(['Q42']);
  assert.match(q, /pq:P582/);
  assert.doesNotMatch(q, /FILTER\s*\(\s*!\s*BOUND/i);
});

/*
 * The defect that made this rewrite necessary.
 *
 * The first query walked `wdt:P279*` up from `wd:Q18912794` and loaded 1,254
 * people across TWO offices — the House of Representatives and its Speaker.
 * That root is not a class of Australian public offices: it IS "member of
 * the Australian House of Representatives". No senators, no ministers, no
 * judges, nothing from any state — while the product stated on screen that
 * it covered all of them.
 */
test('offices are found by JURISDICTION, not by a subclass tree from one office', () => {
  assert.match(WIKIDATA_AU_OFFICES_QUERY, /wdt:P1001/);
  assert.match(WIKIDATA_AU_OFFICES_QUERY, /wd:Q408/);
  assert.doesNotMatch(WIKIDATA_AU_OFFICES_QUERY, /Q18912794/);
  // The states and territories are reached by their country, never by a
  // hand-written list of eight that goes stale in silence.
  assert.match(WIKIDATA_AU_OFFICES_QUERY, /wdt:P17\?/);
});

test('an office nobody has ever held is not coverage', () => {
  assert.match(WIKIDATA_AU_OFFICES_QUERY, /FILTER EXISTS/);
});

test('the holder query groups per person, so the payload is not a cross-product', () => {
  // 60 offices ungrouped produced 8.5 MB and blew the endpoint's own
  // 60-second ceiling; grouped, 20 offices is 198 KB in 2.5 seconds.
  const q = buildWikidataOfficeholderQuery(['Q42', 'Q43']);
  assert.match(q, /GROUP_CONCAT\(DISTINCT \?alias/);
  assert.match(q, /GROUP_CONCAT\(DISTINCT \?posline/);
  assert.match(q, /GROUP BY \?person/);
  assert.match(q, /VALUES \?position \{ wd:Q42 wd:Q43 \}/);
});

test('a 200 with a truncated body is treated as a truncated download, by name', () => {
  // This endpoint cuts the response at its own time limit and reports
  // nothing: HTTP 200, no error field, JSON ending mid-value. The parse is
  // the only signal there is, so the loader says what it actually means.
  assert.match(loader, /truncated body/);
  assert.match(loader, /without reporting an error/);
});

test('the loader backs off on throttling rather than recording a failed load', () => {
  assert.match(loader, /res\.status === 429/);
  assert.match(loader, /retry-after/i);
  assert.match(loader, /MAX_ATTEMPTS/);
});

test('offices are read in batches, and one person is merged across them', () => {
  assert.match(loader, /OFFICES_PER_QUERY/);
  assert.match(loader, /accumulateWikidataOfficeholders\(res\.json, acc\)/);
});

test('what the load actually reached is recorded beside it', () => {
  // A coverage sentence cannot be checked against a load. A number can.
  assert.match(loader, /office_count/);
  assert.match(loader, /distinct_offices/);
  assert.match(loader, /sample_offices/);
});

test('the office count counts EVERY office recorded, not just the one shown', () => {
  /*
   * `position_title` is the office a candidate LEADS with — the current one,
   * else the most recent. Counting those answers "how many offices do people
   * lead with", which is not a coverage number: the first corrected load
   * measured 371 while 676 offices were actually represented.
   */
  assert.match(loader, /source_detail\?\.positions/);
  assert.doesNotMatch(loader, /new Set\(rows\.map\(\(r\) => r\.position_title\)\)/);
});

/* ── what the table itself promises ───────────────────────────────────── */

test('the table says out loud that it cannot clear anybody', () => {
  assert.match(migration, /A HIT is a CANDIDATE/i);
  assert.match(migration, /not a clearance/i);
});

test('reads go through the service role only, so coverage travels with the result', () => {
  assert.match(migration, /pep_officeholders_service_only/);
  assert.match(migration, /FOR ALL TO service_role/);
});

/* ══════════════════════════════════════════════════════════════════════
 * TIER A — the Parliament of Australia registers
 * ══════════════════════════════════════════════════════════════════════
 *
 * The fixtures are VERBATIM BYTES from the two published files — header row
 * plus a few rows, cut on the line boundary and otherwise untouched. That
 * matters more here than anywhere else in this suite, because the defect
 * these tests exist to hold is a single byte: the members' file separates
 * multiple ministerial titles with a bare `\r` INSIDE a quoted cell, and its
 * rows with LF. A fixture retyped by hand would not have it, and the tests
 * would pass against data the source does not produce.
 */
const aphFixture = (name) =>
  readFileSync(join(root, 'tests/aml/fixtures', name), 'utf8');

const houseRegister = APH_REGISTERS.find((r) => r.key === 'house');
const senateRegister = APH_REGISTERS.find((r) => r.key === 'senate');

test('a carriage return inside a cell is a delimiter, not a typo', () => {
  // The fixture holds it; assert the fixture before asserting the parse, so
  // a fixture that loses the byte fails as a fixture rather than as a rule.
  const raw = aphFixture('aph-members.sample.csv');
  assert.ok(/[^\n]\r[^\n]/.test(raw), 'the members fixture must retain its bare CRs');

  const titles = splitTitleCell('Minister for Small Business\rMinister for '
    + 'International Development\rMinister for Multicultural Affairs');
  assert.deepEqual(titles, [
    'Minister for Small Business',
    'Minister for International Development',
    'Minister for Multicultural Affairs',
  ]);
});

test('the Senate spells the same thing with a semicolon', () => {
  assert.deepEqual(
    splitTitleCell('Minister for Industry and Innovation; Minister for Science'),
    ['Minister for Industry and Innovation', 'Minister for Science']);
});

test('a title with no delimiter survives whole', () => {
  // The failure mode of an unrecognised title must be an intact string. An
  // earlier draft of this split on a list of English phrases — "Minister
  // for", "Cabinet Secretary" — which is a rule that guesses where an office
  // name begins, and guesses right until the row nobody checked.
  assert.deepEqual(splitTitleCell('Deputy Leader of the National Party'),
    ['Deputy Leader of the National Party']);
  assert.deepEqual(splitTitleCell('Assistant Minister for Regional Development'),
    ['Assistant Minister for Regional Development']);
  assert.deepEqual(splitTitleCell(''), []);
  assert.deepEqual(splitTitleCell(null), []);
});

test('a ministerial office outranks the seat on the candidate card', () => {
  const entries = parseAphRegister(
    aphFixture('aph-members.sample.csv'), houseRegister, parseCsv);
  const pm = entries.find((e) => e.full_name.includes('Albanese'));
  // An operator scanning candidates needs the office that makes the person
  // worth a second look. "Member for Grayndler" is true and useless here.
  assert.equal(pm.position_title, 'Prime Minister');
  assert.deepEqual(pm.source_detail.positions.map((p) => p.title),
    ['Prime Minister', 'Member for Grayndler']);
});

test('the register carries no dates, and says so rather than inventing them', () => {
  const entries = parseAphRegister(
    aphFixture('aph-senators.sample.csv'), senateRegister, parseCsv);
  for (const e of entries) {
    assert.equal(e.position_start, null);
    assert.equal(e.position_end, null);
    // A snapshot of who sits today. `true` is the only honest reading, and
    // the absence of former members is a coverage statement, not a bug.
    assert.equal(e.currently_held, true);
    assert.match(e.position_title, /^(Senator for|Minister|Assistant|Leader|Deputy|Shadow|Cabinet|One Nation|Nationals|United|Manager)/);
  }
});

test('no address or telephone from an address-label file reaches the index', () => {
  /*
   * Two thirds of every row is an electorate office address, a postal
   * address and three phone numbers. A PEP index answers whether a name
   * holds public office; it has no business accumulating the contact
   * details of 225 people because they arrived in the same download.
   */
  const entries = [
    ...parseAphRegister(aphFixture('aph-members.sample.csv'), houseRegister, parseCsv),
    ...parseAphRegister(aphFixture('aph-senators.sample.csv'), senateRegister, parseCsv),
  ];
  const blob = JSON.stringify(entries);
  for (const forbidden of [
    /\b\(0[237]\)\s*\d{4}\s*\d{4}\b/,        // an Australian landline
    /\bPO Box\b/i, /\bStreet\b/, /\bRoad\b/, /\bSuite\b/i,
    /\b\d{4}\b(?![^"]*")/,                    // a bare postcode outside a string
  ]) assert.ok(!forbidden.test(blob), `an address-shaped value leaked: ${forbidden}`);
});

test('a derived key collision is refused, never resolved', () => {
  // The files carry no identifier of any kind — no MPID, no PHID — so the
  // key is derived. An index quietly holding 149 of 150 members is the
  // empty-register failure at one-row scale, and it reads as a clean load
  // for as long as nobody counts.
  const raw = aphFixture('aph-members.sample.csv');
  const lines = raw.split('\n').filter(Boolean);
  const doubled = [lines[0], lines[1], lines[1]].join('\n');
  assert.throws(() => parseAphRegister(doubled, houseRegister, parseCsv),
    /derive the same key/);
});

test('every parsed row is searchable by the query that will look for it', () => {
  const entries = [
    ...parseAphRegister(aphFixture('aph-members.sample.csv'), houseRegister, parseCsv),
    ...parseAphRegister(aphFixture('aph-senators.sample.csv'), senateRegister, parseCsv),
  ];
  assert.ok(entries.length > 0);
  for (const e of entries) {
    const row = withNormalisedNames(e, 'aph_commonwealth_parliament', null);
    assert.ok(row.normalised_names.length > 0, `${e.full_name} has no searchable token`);
    // The same `normaliseName` the server query uses — imported, not
    // reimplemented, for the reason the sanctions loader learned.
    assert.deepEqual(row.normalised_names,
      [...new Set([e.full_name, ...e.aliases].flatMap((n) => normaliseName(n)))]);
    // The index asserts no AUSTRAC category. That belongs to the
    // determination a person reaches.
    assert.equal(row.pep_type, null);
    assert.ok(row.confirm_url.startsWith('https://www.aph.gov.au/'));
  }
});

test('the loader refuses a short download rather than publishing a thin register', () => {
  // The failure this repository has had twice: a truncated response reads
  // exactly like a smaller source.
  assert.match(loader, /expectAtLeast/);
  assert.match(loader, /truncated download, not a smaller chamber/);
  // And it sniffs, because the link Parliament labels `Members_List.csv`
  // answers 200 with a PDF, and a CSV parser fed a PDF returns rows.
  assert.match(loader, /served a PDF, not a CSV/);
});

test('the refresh loads both registers by default', () => {
  const workflow = readFileSync(
    join(root, '.github/workflows/aml-pep-officeholders-refresh.yml'), 'utf8');
  // A source that exists and is never scheduled is a source that is empty,
  // which is the reading this whole index is built to avoid producing.
  for (const code of ['aph_commonwealth_parliament', 'wikidata_au_public_office']) {
    assert.ok(workflow.includes(code), `${code} is not in the refresh workflow`);
  }
});

test('a source is ingested from the URL the spike proved, not a second copy', () => {
  /*
   * The catalogue's own rule, now that something actually loads from it. The
   * whole value of a reachability measurement is that the thing measured is
   * the thing read; two copies of a URL drifting apart turns a green spike
   * into a statement about a file nobody fetches.
   */
  const ingested = CANDIDATE_SOURCES.filter((s) => s.ingestedAs);
  assert.ok(ingested.length >= 2, 'the APH registers should be marked as ingested');
  const loaderUrls = new Set(APH_REGISTERS.map((r) => r.url));
  for (const s of ingested) {
    assert.equal(s.ingestedAs, 'aph_commonwealth_parliament');
    assert.ok(loaderUrls.has(s.url),
      `${s.key} is catalogued at a URL the loader does not read: ${s.url}`);
  }
  assert.equal(loaderUrls.size, ingested.length);
});

/* ══════════════════════════════════════════════════════════════════════
 * DATE OF BIRTH — the field that tells a candidate apart from a namesake
 * ══════════════════════════════════════════════════════════════════════ */

test('a year-precision birth is stored as a year, not as 1 January', () => {
  /*
   * Wikidata records precision explicitly — 11 day, 10 month, 9 year — and
   * renders a full timestamp regardless. A year-precision birth in 1961 comes
   * back as `1961-01-01T00:00:00Z`.
   *
   * Storing that verbatim asserts a birthday nobody published, and the
   * comparison then reports a confident MISMATCH against a customer genuinely
   * born on 4 August 1961 — demoting a real lead with a reason that sounds
   * decisive. Measured against the live endpoint: 46 of 1,247 people in one
   * office batch are year-precision, so this is ~4% of the register.
   */
  assert.equal(truncateWikidataDate('1961-01-01T00:00:00Z', 11), '1961-01-01');
  assert.equal(truncateWikidataDate('1961-03-01T00:00:00Z', 10), '1961-03');
  assert.equal(truncateWikidataDate('1961-01-01T00:00:00Z', 9), '1961');
});

test('an unstated precision truncates to the year, and that direction is chosen', () => {
  /*
   * Over-truncating can only turn a `match` into a `year_match` — it keeps a
   * candidate in front of a reviewer and understates the agreement.
   * Under-truncating invents a birthday. The default leans away from the
   * mistake that demotes.
   */
  assert.equal(truncateWikidataDate('1961-08-04T00:00:00Z', undefined), '1961');
  assert.equal(truncateWikidataDate('1961-08-04T00:00:00Z', 'nonsense'), '1961');
});

test('anything coarser than a year is not a date of birth', () => {
  assert.equal(truncateWikidataDate('1960-01-01T00:00:00Z', 8), null);   // decade
  assert.equal(truncateWikidataDate('1900-01-01T00:00:00Z', 7), null);   // century
  // A BC date would parse into a plausible-looking year.
  assert.equal(truncateWikidataDate('-0500-01-01T00:00:00Z', 11), null);
  assert.equal(truncateWikidataDate('', 11), null);
  assert.equal(truncateWikidataDate(null, 11), null);
});

test('the query reads the statement node, not the truncated predicate', () => {
  // `wdt:P569` hands back a full timestamp with no way to tell how much of it
  // is known, which is the whole reason the two tests above exist.
  const q = buildWikidataOfficeholderQuery(['Q1']);
  assert.match(q, /psv:P569/);
  assert.match(q, /wikibase:timePrecision/);
  assert.match(q, /wikibase:timeValue/);
});

test('the Parliament register publishes none, and says null rather than guessing', () => {
  const entries = parseAphRegister(
    aphFixture('aph-members.sample.csv'), houseRegister, parseCsv);
  for (const e of entries) assert.equal(e.date_of_birth ?? null, null);
  const row = withNormalisedNames(entries[0], 'aph_commonwealth_parliament', null);
  assert.equal(row.date_of_birth, null);
});

test('the column accepts only the partial-date shapes the comparator reads', () => {
  const dob = readFileSync(
    join(root, 'supabase/migrations/20260929000000_aml_pep_officeholder_dob.sql'), 'utf8');
  // A timestamp, a `circa 1961` or an empty string would parse to a year by
  // accident or to nothing at all, and both readings are silent.
  assert.match(dob, /\^\[0-9\]\{4\}\(-\[0-9\]\{2\}\(-\[0-9\]\{2\}\)\?\)\?\$/);
  assert.match(dob, /date_of_birth text/);
});

/* ══════════════════════════════════════════════════════════════════════
 * RULE COVERAGE — measured by the load, rendered from the load
 * ══════════════════════════════════════════════════════════════════════ */

test('the load measures coverage against the Rules and stores it', () => {
  assert.match(loader, /summariseRuleCoverage/);
  assert.match(loader, /rule_categories: ruleCoverage\.categories/);
  // The categories with NOTHING are stored too. A gap that is not recorded is
  // a gap nobody can be told about.
  assert.match(loader, /unclassified_offices/);
  // One implementation, imported — not a second copy of the classifier in mjs.
  assert.match(loader, /pepRuleCoverage\.pure\.ts/);
});

test('the Parliament register evidences legislators and ministers, and nothing else', () => {
  // Measured from the real files: the two APH registers hold seats and
  // portfolios. Reporting judiciary or Defence coverage off them would be
  // false, and this is the assertion that keeps it false-negative rather than
  // false-positive.
  const entries = [
    ...parseAphRegister(aphFixture('aph-members.sample.csv'), houseRegister, parseCsv),
    ...parseAphRegister(aphFixture('aph-senators.sample.csv'), senateRegister, parseCsv),
  ];
  const offices = new Set();
  for (const e of entries) for (const p of e.source_detail.positions) offices.add(p.title);
  const summary = summariseRuleCoverage(offices);
  const evidenced = summary.categories.filter((c) => !c.notEvidenced).map((c) => c.code).sort();
  assert.deepEqual(evidenced, ['legislature', 'ministry']);
  for (const code of ['judiciary', 'defence', 'diplomatic', 'vice_regal']) {
    const cat = summary.categories.find((c) => c.code === code);
    assert.equal(cat.notEvidenced, true, `${code} must not be claimed from APH alone`);
  }
});
