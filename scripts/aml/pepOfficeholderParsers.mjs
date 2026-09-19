/**
 * Parse public office-holder sources into index rows.
 *
 * Pure: takes parsed JSON, returns rows. Every I/O concern lives in
 * `load-pep-officeholders.mjs`, so this file can be unit-tested without a
 * network or a database.
 *
 * `normaliseName` is imported from `sanctionsParsers.mjs` rather than
 * re-implemented. Names in this table are searched by the SAME token overlap
 * the sanctions screening uses; a second implementation that drifted by one
 * honorific would write rows no query can ever match, which looks exactly
 * like an index that works.
 */
import { normaliseName } from './sanctionsParsers.mjs';

/**
 * Which offices count as Australian public offices.
 *
 * ── Why P1001 and not a subclass tree ─────────────────────────────────
 * The first version of this walked `wdt:P279*` up from a single root and
 * loaded 1,254 people across TWO offices — the House of Representatives and
 * its Speaker. No senators, no ministers, no judges, nothing from any state
 * or territory. The root it used, `Q18912794`, is not a class of Australian
 * public offices at all: it IS "member of the Australian House of
 * Representatives". The load succeeded, the count looked plausible, and the
 * coverage the product then stated on screen was false.
 *
 * `P1001` ("applies to jurisdiction") is the axis that actually holds. The
 * jurisdiction is Australia itself or anything whose country (`P17`) is
 * Australia, which reaches the states and territories without naming them —
 * a hand-written list of eight is a list that goes stale silently.
 *
 * Measured 2026-08-19: 724 offices, 10,569 people.
 *
 * `FILTER EXISTS` drops offices nobody has ever held. They are not coverage,
 * they are 400 extra chunks of nothing.
 */
export const WIKIDATA_AU_OFFICES_QUERY = `
SELECT DISTINCT ?pos WHERE {
  ?pos wdt:P1001 ?jur .
  ?jur wdt:P17? wd:Q408 .
  FILTER EXISTS { ?someone p:P39/ps:P39 ?pos }
}
`.trim();

/**
 * The holders of a batch of offices, ONE ROW PER PERSON.
 *
 * The grouping is not a nicety. Asking for aliases and positions as plain
 * OPTIONALs returns their cross-product: 60 offices produced 8.5 MB, the
 * endpoint hit its own 60-second ceiling, and it answered **HTTP 200 with
 * the JSON cut off mid-value and no error in the body**. Collapsing the two
 * multi-valued things with GROUP_CONCAT moves that work to the server: the
 * same shape at 20 offices is 198 KB in 2.5 seconds.
 *
 * Labels come from `rdfs:label` rather than the label service, because a
 * grouped query cannot reference the service's generated variables, and
 * because it is faster.
 *
 * Position dates are kept and never used to FILTER. A former office holder
 * is assessed on risk rather than written off by the passage of time, so the
 * index carries them and the determination decides.
 */
export function buildWikidataOfficeholderQuery(officeQids) {
  const values = officeQids.map((q) => `wd:${q}`).join(' ');
  return `
SELECT ?person ?personLabel ?article
       (SAMPLE(?dobValue) AS ?dob) (SAMPLE(?dobPrecision) AS ?dobPrec)
       (GROUP_CONCAT(DISTINCT ?alias; separator="||") AS ?aliases)
       (GROUP_CONCAT(DISTINCT ?posline; separator="||") AS ?positions)
WHERE {
  VALUES ?position { ${values} }
  ?person p:P39 ?st .
  ?st ps:P39 ?position .
  ?person rdfs:label ?personLabel . FILTER(LANG(?personLabel) = "en")
  ?position rdfs:label ?posLabel . FILTER(LANG(?posLabel) = "en")
  OPTIONAL { ?st pq:P580 ?s }
  OPTIONAL { ?st pq:P582 ?e }
  BIND(CONCAT(?posLabel, "~", COALESCE(STR(?s), ""), "~", COALESCE(STR(?e), "")) AS ?posline)
  OPTIONAL { ?article schema:about ?person ; schema:isPartOf <https://en.wikipedia.org/> . }
  OPTIONAL { ?person skos:altLabel ?alias . FILTER(LANG(?alias) = "en") }
  # Read through the STATEMENT NODE rather than the truncated wdt:P569,
  # which hands back a full timestamp with no way to tell how much of it is
  # known. wikibase:timePrecision is the only thing that distinguishes
  # "born in 1961" from "born on 1 January 1961", and storing the second
  # when the source said the first produces a confident mismatch against a
  # real birthday.
  OPTIONAL {
    ?person p:P569 ?dobSt .
    ?dobSt psv:P569 ?dobNode .
    ?dobNode wikibase:timeValue ?dobValue ; wikibase:timePrecision ?dobPrecision .
  }
}
GROUP BY ?person ?personLabel ?article
`.trim();
}

const text = (b, k) => {
  const v = b?.[k]?.value;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
};

/** `2016-07-02T00:00:00Z` → `2016-07-02`; anything else → null. */
const asDate = (v) => {
  if (!v) return null;
  const m = /^(-?\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/**
 * A Wikidata time value, truncated to the precision the source claims.
 *
 * Wikidata's precision codes: 11 = day, 10 = month, 9 = year. Anything
 * coarser (decade, century) is not a date of birth in any useful sense and
 * is dropped rather than rounded into one.
 *
 * ── Why an unknown precision truncates to the YEAR ────────────────────
 * Because of which way the mistake runs. Over-truncating can only turn a
 * `match` into a `year_match`, or a `mismatch` into a `year_match` — it
 * keeps a candidate in front of a reviewer and understates the agreement.
 * Under-truncating asserts a birthday nobody published, and produces a
 * confident MISMATCH that demotes a real lead with a reason that sounds
 * decisive.
 *
 * A discriminator that is wrong in the demoting direction is worse than no
 * discriminator, so the default leans the other way.
 */
export function truncateWikidataDate(value, precision) {
  const m = /^(-?)(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  // A BC date has no place in a register of current and recent office
  // holders, and `-0500-01-01` would parse into a plausible-looking year.
  if (!m || m[1] === '-') return null;
  const [, , year, month, day] = m;
  const p = Number(precision);
  if (Number.isFinite(p) && p <= 8) return null;      // decade or coarser
  if (p === 11) return `${year}-${month}-${day}`;
  if (p === 10) return `${year}-${month}`;
  return `${year}`;                                    // 9, or unstated
}

/**
 * A label that is really a Q-id ("Q23939864") means Wikidata has no English
 * label for the entity. Indexed as a NAME that is an unsearchable string;
 * shown as a POSITION it is a machine id where the office should be.
 */
const isQid = (s) => typeof s === 'string' && /^Q\d+$/.test(s);

/** `title~start~end` → `{ title, start, end }`, or null if unusable. */
function parsePositionLine(line) {
  const parts = String(line ?? '').split('~');
  const title = (parts[0] ?? '').trim();
  if (!title || isQid(title)) return null;
  return { title, start: asDate(parts[1]), end: asDate(parts[2]) };
}

/**
 * Merge one batch of grouped results into an accumulator keyed by person.
 *
 * The accumulator is threaded across batches because offices are queried in
 * chunks and one person holds offices in several of them — the Prime
 * Minister is also a member of the House. Merging at the end of every chunk
 * rather than upserting per chunk is what keeps a person's positions in one
 * row instead of whichever chunk wrote last.
 */
export function accumulateWikidataOfficeholders(json, into = new Map()) {
  const bindings = json?.results?.bindings;
  if (!Array.isArray(bindings)) return into;

  for (const b of bindings) {
    const uri = text(b, 'person');
    const name = text(b, 'personLabel');
    if (!uri || !name || isQid(name)) continue;

    const positions = String(b?.positions?.value ?? '')
      .split('||').map(parsePositionLine).filter(Boolean);
    if (positions.length === 0) continue;

    const qid = uri.split('/').pop();
    let row = into.get(qid);
    if (!row) {
      row = {
        external_id: qid, full_name: name, aliases: new Set(),
        positions: [], article: null, date_of_birth: null,
      };
      into.set(qid, row);
    }
    if (!row.article) row.article = text(b, 'article');
    /*
     * First one wins. A person appears in several office batches and every
     * one of them carries the same `P569`, so overwriting would churn the
     * value for no gain — and a later batch that happened to return nothing
     * for it would erase a date the index already had.
     */
    if (!row.date_of_birth) {
      row.date_of_birth = truncateWikidataDate(text(b, 'dob'), text(b, 'dobPrec'));
    }
    for (const alias of String(b?.aliases?.value ?? '').split('||')) {
      const a = alias.trim();
      if (a && a !== name && !isQid(a)) row.aliases.add(a);
    }
    for (const p of positions) {
      const key = `${p.title}|${p.start ?? ''}|${p.end ?? ''}`;
      if (!row.positions.some((x) => x.key === key)) row.positions.push({ key, ...p });
    }
  }
  return into;
}

/** Turn the accumulator into index entries. */
export function officeholderEntries(acc) {
  return [...acc.values()].map((row) => {
    // The office to SHOW is the one currently held, else the most recent —
    // an operator scanning candidates needs the position that makes this
    // person worth a second look, not whichever chunk arrived first.
    const sorted = row.positions.slice().sort((a, b) => {
      const aOpen = a.end === null, bOpen = b.end === null;
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      return String(b.end ?? b.start ?? '').localeCompare(String(a.end ?? a.start ?? ''));
    });
    const lead = sorted[0];
    /*
     * `currently_held` is null when the source does not say, NEVER false.
     * An open-ended statement means "no end date recorded", which is not the
     * same as "still in office" — but a start with no end is the only
     * positive signal the source has, so that reads as true and a statement
     * with no dates at all reads as unknown.
     */
    const currentlyHeld = lead.end !== null ? false : (lead.start !== null ? true : null);
    return {
      external_id: row.external_id,
      full_name: row.full_name,
      aliases: [...row.aliases].slice(0, 12),
      position_title: lead.title,
      /*
       * NOT asserted. The AUSTRAC category — foreign, domestic or
       * international organisation — is part of the DETERMINATION a person
       * reaches, and this index does not make determinations. It also
       * cannot: an "applies to jurisdiction: Australia" office includes
       * foreign ambassadors posted here, so stamping every row `domestic`
       * would be wrong on the face of the data as well as in principle.
       */
      pep_type: null,
      /*
       * The one field on this row that can tell an office holder apart from
       * somebody who merely shares their name. Null wherever the source did
       * not publish one — and an absent date is never a disagreement.
       */
      date_of_birth: row.date_of_birth ?? null,
      jurisdiction: 'Australia',
      position_start: lead.start,
      position_end: lead.end,
      currently_held: currentlyHeld,
      confirm_url: row.article ?? `https://www.wikidata.org/wiki/${row.external_id}`,
      source_detail: {
        positions: sorted.map(({ title, start, end }) => ({ title, start, end })),
        position_count: sorted.length,
      },
    };
  });
}

/** One batch, standalone — the shape the tests exercise. */
export function parseWikidataOfficeholders(json) {
  return officeholderEntries(accumulateWikidataOfficeholders(json));
}

/**
 * Attach the searchable tokens and the sync id.
 *
 * Identical in shape to `withNormalisedNames` in `sanctionsParsers.mjs`, and
 * deliberately using the same `normaliseName`.
 */
export function withNormalisedNames(entry, sourceCode, syncId) {
  const normalised = [...new Set(
    [entry.full_name, ...(entry.aliases ?? [])].flatMap((n) => normaliseName(n)),
  )];
  return {
    source_code: sourceCode,
    external_id: entry.external_id,
    full_name: entry.full_name,
    aliases: entry.aliases ?? [],
    normalised_names: normalised,
    position_title: entry.position_title,
    pep_type: entry.pep_type ?? null,
    date_of_birth: entry.date_of_birth ?? null,
    jurisdiction: entry.jurisdiction ?? null,
    position_start: entry.position_start ?? null,
    position_end: entry.position_end ?? null,
    currently_held: entry.currently_held ?? null,
    confirm_url: entry.confirm_url ?? null,
    source_detail: entry.source_detail ?? {},
    sync_id: syncId ?? null,
    updated_at: new Date().toISOString(),
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * TIER A — the Parliament of Australia registers
 * ══════════════════════════════════════════════════════════════════════
 *
 * The spike measured this. `www.aph.gov.au/Senators_and_Members/Members`
 * answers 403 to a scripted client from every environment tried, and the
 * link named `Members_List.csv` answers 200 with 184 KB of `%PDF-1.7`.
 * Both of those are why this source was written off as unreachable.
 *
 * The register files themselves are neither. Parliament publishes the
 * address-label CSVs on `static.aph.gov.au`, and they download cleanly from
 * the dev container AND from a GitHub runner: 150 members, 75 senators.
 *
 * That distinction is the whole finding, and it is worth stating plainly
 * because the product asserted the opposite on screen: **the website blocks
 * automated clients; the register it publishes does not.** A source is
 * reachable or not as a matter of which URL you ask for, and "aph.gov.au
 * blocks bots" was a true sentence about a page being used as a false
 * sentence about a dataset.
 *
 * ── What is taken, and what is deliberately left ──────────────────────
 * These are ADDRESS LABEL files. Two thirds of every row is an electorate
 * office street address, a postal address and three phone numbers.
 *
 * None of that is taken. A PEP index answers "is this name a public office
 * holder"; it does not need, and must not accumulate, the home-suburb
 * contact details of 225 people because they happened to be in the same
 * download. What is ingested is the name, the office, the jurisdiction and
 * the party — the facts that make a candidate worth looking at.
 *
 * ── What the source cannot tell us ────────────────────────────────────
 * There are no dates in these files at all. They are a snapshot of who
 * holds the office TODAY, so `position_start` and `position_end` are null
 * and `currently_held` is true — accurately, and narrowly.
 *
 * A former member of Parliament is NOT in here, and AUSTRAC is explicit
 * that leaving office does not end the risk. That is a real gap in a Tier A
 * source, it is the gap the collaboratively-edited source covers, and it is
 * why this register does not replace that one.
 */

/**
 * The two files, named once.
 *
 * `expect` and these URLs are the same strings the reachability spike
 * probes, for the reason the catalogue's header gives: a source must not be
 * validated under one URL and ingested from another.
 */
export const APH_REGISTERS = [
  {
    key: 'house',
    chamber: 'House of Representatives',
    label: 'Members of the House of Representatives',
    url: 'https://static.aph.gov.au/-/media/03_Senators_and_Members/Address_Labels_and_CSV_files/'
      + 'All_members_by_name/All_members_by_name.csv',
    /** The seat is the office. Every member holds exactly one. */
    seat: (row) => (row.Electorate ? `Member for ${row.Electorate}` : 'Member of the House of Representatives'),
    /** How the file spells the honorific column, and where extra offices live. */
    honorificColumn: 'Honorific',
    titleColumns: ['Ministerial Title', 'Parliamentary Title'],
    /** Roughly what a complete file holds; a big shortfall is a bad download. */
    expectAtLeast: 100,
  },
  {
    key: 'senate',
    chamber: 'Senate',
    label: 'Senators',
    url: 'https://static.aph.gov.au/-/media/03_Senators_and_Members/Address_Labels_and_CSV_files/'
      + 'Senators/allsenel.csv',
    seat: (row) => (row.State ? `Senator for ${row.State}` : 'Senator'),
    honorificColumn: 'Title',
    titleColumns: ['Parliamentary Titles'],
    expectAtLeast: 60,
  },
];

/**
 * One title cell → the offices in it.
 *
 * ── The mistake this function is a record of ──────────────────────────
 * The members' file appeared to run its ministerial titles together with no
 * separator at all:
 *
 *   Minister for Small BusinessMinister for International DevelopmentMinister
 *     for Multicultural Affairs
 *
 * That is not what the file says. Each of those boundaries is a bare
 * carriage return inside the quoted field, and a terminal prints `\r` by
 * returning the cursor to the start of the line and overwriting what is
 * already there. The delimiter was present the whole time; the terminal ate
 * it, and reading the rendering as the data produced a confident diagnosis
 * of a broken government export.
 *
 * What nearly shipped on the back of that diagnosis was a list of English
 * phrases — "Minister for", "Cabinet Secretary", "Assistant Minister" — and
 * a rule guessing where one office title ends and the next begins. It gave
 * the right answer on the four strings it was tested against, which is
 * exactly how a heuristic earns its place and then quietly gets something
 * wrong on the row nobody looked at.
 *
 * The bytes settle it instead: `od -c` on the file shows `\r` between the
 * titles, the members' file uses LF for its rows (151 of them, and 25 bare
 * CRs, all inside quoted cells), and the senators' file uses CRLF for rows
 * and `; ` between titles.
 *
 * So the delimiters are the ones the two files actually use, and nothing
 * here knows anything about what an Australian ministry is called.
 */
export function splitTitleCell(raw) {
  return [...new Set(
    String(raw ?? '')
      // `\r` and `\n` inside a quoted cell are content, and in these files
      // that content is "the next title". `;` is what the Senate uses.
      .split(/[\r\n;]+/)
      .map((t) => t.trim())
      .filter(Boolean),
  )];
}

/** Header row → objects, tolerating the two files' different column names. */
function rowsToObjects(rows) {
  const head = (rows[0] ?? []).map((h) => String(h ?? '').trim());
  return rows.slice(1)
    .filter((r) => r.some((c) => String(c ?? '').trim()))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, String(r[i] ?? '').trim()])));
}

/**
 * One register file → index entries.
 *
 * `external_id` is derived, because the address-label files carry no
 * identifier of any kind — no MPID, no PHID, nothing. A derived key is fine
 * so long as it cannot silently merge two people, which is why a collision
 * THROWS rather than resolving: an index quietly holding 149 of 150 members
 * is the empty-register failure at one-row scale, and it would read as a
 * clean load forever.
 */
export function parseAphRegister(text, register, parseCsvFn) {
  const objects = rowsToObjects(parseCsvFn(String(text)));
  const seen = new Map();
  const entries = [];

  for (const row of objects) {
    const surname = row.Surname ?? '';
    const first = row['First Name'] ?? '';
    const preferred = row['Preferred Name'] ?? '';
    const other = row['Other Name'] ?? '';
    if (!surname && !first && !preferred) continue;

    // The name to lead with is the one the person actually goes by.
    const fullName = [preferred || first, surname].filter(Boolean).join(' ').trim();
    const aliases = [...new Set([
      [first, surname].filter(Boolean).join(' '),
      [first, other, surname].filter(Boolean).join(' '),
      [preferred, other, surname].filter(Boolean).join(' '),
    ].map((n) => n.trim()).filter((n) => n && n !== fullName))];

    const seat = register.seat(row);
    /*
     * Ministerial and parliamentary titles are offices in their own right,
     * and they are the ones the AML/CTF Rules name most directly. A row
     * whose seat is "Member for Grayndler" and whose ministerial title is
     * "Prime Minister" must surface as the latter.
     */
    const extra = register.titleColumns.flatMap((col) => splitTitleCell(row[col]));
    const positions = [...new Set([...extra, seat])]
      .map((title) => ({ title, start: null, end: null }));

    const idParts = [
      register.key,
      ...normaliseName(surname),
      ...normaliseName(preferred || first),
      (row.Electorate || row.State || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    ].filter(Boolean);
    const externalId = `aph:${idParts.join(':')}`;
    if (seen.has(externalId)) {
      throw new Error(
        `two rows in the ${register.label} file derive the same key ${externalId} `
        + `(${seen.get(externalId)} and ${fullName}) — refusing to load an index that `
        + 'would silently hold one of them',
      );
    }
    seen.set(externalId, fullName);

    entries.push({
      external_id: externalId,
      full_name: fullName,
      aliases: aliases.slice(0, 12),
      // The most senior office, else the seat. `positions` is already in
      // that order — extra titles first, seat last.
      position_title: positions[0].title,
      /*
       * NOT asserted, for the same reason as every other source: the
       * AUSTRAC category is part of the determination, not of the index.
       */
      pep_type: null,
      jurisdiction: 'Australia (Commonwealth)',
      // The file has no dates whatsoever. It is a snapshot of who holds the
      // office now, which is exactly and only what these three say.
      position_start: null,
      position_end: null,
      currently_held: true,
      /*
       * The official register, searched by surname. The operator opens this
       * in a browser — the 403 the spike recorded is a fact about scripted
       * clients, and it does not touch a link a person clicks.
       */
      confirm_url: 'https://www.aph.gov.au/Senators_and_Members/Parliamentarian_Search_Results?q='
        + encodeURIComponent([preferred || first, surname].filter(Boolean).join(' ')),
      source_detail: {
        chamber: register.chamber,
        positions,
        position_count: positions.length,
        state: row.State || null,
        electorate: row.Electorate || null,
        party: row['Political Party'] || null,
        /*
         * The title columns verbatim, beside the split. What the file said
         * has to remain recoverable: the split is a repair of a broken
         * export, and a repair that destroys the original cannot be checked.
         */
        titles_as_published: Object.fromEntries(
          register.titleColumns.map((c) => [c, row[c] || null]).filter(([, v]) => v),
        ),
      },
    });
  }
  return entries;
}
