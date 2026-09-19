/**
 * Parsers for the official sanctions lists (DFAT / UN / OFAC).
 *
 * Extracted from the loader so they can be unit-tested without a network or a
 * database. The loader is I/O; everything that can get a name wrong lives here.
 *
 * `normaliseName` MUST stay identical to the one in
 * `supabase/functions/_shared/aml/matching.ts`. Names are normalised at write
 * time and again at query time; if the two drift, entries stop being findable
 * by the very query that indexed them. `tests/aml/sanctions-parsers.test.mjs`
 * asserts the word lists match the TypeScript source character for character.
 */
import XLSX from 'xlsx';

/* ── normalisation: mirrors _shared/aml/matching.ts ─────────────────────── */

export const HONORIFICS = new Set(['mr','mrs','ms','miss','mx','dr','prof','professor','sir','dame','lord','lady','rev','reverend','hon','honourable','honorable','sheikh','sheik','shaikh','haji','hajji','sayyid','sayed','general','gen','col','colonel','maj','major','capt','captain','lt','lieutenant','sgt','sergeant','adm','admiral','brig','brigadier','president','minister','senator','governor','ambassador']);
export const ENTITY_SUFFIXES = new Set(['pty','ltd','limited','llc','lp','llp','inc','incorporated','corp','corporation','co','company','plc','gmbh','ag','sa','nv','bv','srl','spa','oyj','ab','as','aps','kk','pte','sdn','bhd','trust','trustee','trustees','holdings','group','international']);
export const PARTICLES = new Set(['al','el','bin','ibn','bint','van','von','de','del','della','di','da','dos','das','du','la','le','les','ter','ten','op','af','av','san','santa','st']);
export const TRANSLIT = { 'æ':'ae','Æ':'ae','ø':'o','Ø':'o','å':'a','Å':'a','ß':'ss','þ':'th','Þ':'th','ð':'d','Ð':'d','đ':'d','Đ':'d','ł':'l','Ł':'l','ŧ':'t','ħ':'h','ı':'i','ő':'o','ű':'u','œ':'oe','Œ':'oe' };

export function normaliseName(input) {
  if (!input) return [];
  let s = String(input).toLowerCase();
  s = s.replace(/[æÆøØåÅßþÞðÐđĐłŁŧħıőűœŒ]/g, (c) => TRANSLIT[c] ?? c);
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[''`´]/g, '').replace(/[^a-z0-9]+/g, ' ');
  return s.split(' ').map((t) => t.trim()).filter(Boolean)
    .filter((t) => !HONORIFICS.has(t))
    .filter((t) => !ENTITY_SUFFIXES.has(t))
    .filter((t) => !PARTICLES.has(t))
    .filter((t) => t.length > 1);
}

/* ── generic CSV ────────────────────────────────────────────────────────── */

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ── OFAC SDN ───────────────────────────────────────────────────────────── */

/** OFAC SDN: fixed positional CSV, no header. */
export function parseOfac(text) {
  const out = [];
  for (const r of parseCsv(text)) {
    if (r.length < 12) continue;
    const [uid, name, type, , , , , , , , , remarks] = r;
    if (!uid || !name || name === '-0- ') continue;
    const aliases = [];
    // DOB and aka data live in the free-text remarks column.
    const dobMatch = String(remarks ?? '').match(/DOB\s+([^;]+)/i);
    out.push({
      external_id: `OFAC-${uid.trim()}`,
      primary_name: name.trim(),
      aliases,
      entry_type: /individual/i.test(type ?? '') ? 'individual'
        : /vessel/i.test(type ?? '') ? 'vessel'
        : /aircraft/i.test(type ?? '') ? 'aircraft' : 'entity',
      date_of_birth: dobMatch ? dobMatch[1].trim() : null,
      listing_reference: 'OFAC SDN',
      listing_detail: { remarks: (remarks ?? '').slice(0, 2000) },
    });
  }
  return out;
}

/* ── UN consolidated ────────────────────────────────────────────────────── */

/** UN consolidated XML — regex-scanned rather than DOM-parsed (no deps). */
export function parseUn(xml) {
  const out = [];
  const blocks = xml.split(/<\/(?:INDIVIDUAL|ENTITY)>/i);
  for (const block of blocks) {
    const isIndividual = /<INDIVIDUAL[\s>]/i.test(block);
    const isEntity = /<ENTITY[\s>]/i.test(block);
    if (!isIndividual && !isEntity) continue;

    const pick = (tag) => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i')) ?? [])[1]?.trim() ?? '';
    const id = pick('DATAID');
    if (!id) continue;

    const nameParts = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME']
      .map(pick).filter(Boolean);
    const primary = nameParts.join(' ').trim();
    if (!primary) continue;

    const aliases = [...block.matchAll(/<ALIAS_NAME>([^<]*)<\/ALIAS_NAME>/gi)]
      .map((m) => m[1].trim()).filter(Boolean);
    const year = (block.match(/<YEAR>([^<]*)<\/YEAR>/i) ?? [])[1]?.trim();
    const dateStr = (block.match(/<DATE>([^<]*)<\/DATE>/i) ?? [])[1]?.trim();

    out.push({
      external_id: `UN-${id}`,
      primary_name: primary,
      aliases,
      entry_type: isIndividual ? 'individual' : 'entity',
      date_of_birth: dateStr || year || null,
      listing_reference: pick('REFERENCE_NUMBER') || 'UN Consolidated List',
      listing_detail: { comments: pick('COMMENTS1').slice(0, 2000) },
    });
  }
  return out;
}

/* ── DFAT consolidated list ─────────────────────────────────────────────── */

/**
 * Column aliases, lowercased. DFAT has renamed these between publications, so
 * every name we have seen is listed rather than assuming the current one.
 */
const DFAT_COLUMNS = {
  reference: ['reference', 'ref', 'listing reference'],
  name: ['name of individual or entity', 'name', 'name of individual/entity', 'individual/entity'],
  nameType: ['name type', 'type of name', 'nametype'],
  type: ['type', 'individual/entity', 'entity type'],
  dob: ['date of birth', 'dob', 'birth date'],
  pob: ['place of birth', 'pob'],
  citizenship: ['citizenship', 'nationality', 'nationalities'],
  address: ['address'],
  additional: ['additional information', 'aka', 'also known as', 'other information'],
  committee: ['committees', 'committee', 'listing information', 'sanctions regime'],
  // Added by DFAT in the November 2025 revision of the published list.
  aliasStrength: ['alias strength'],
  imo: ['imo number', 'imo'],
  instrument: ['instrument of designation'],
};

/**
 * The measures DFAT now publishes per listing, as `TRUE`/`FALSE` columns.
 * Recorded on the entry so an analyst can see WHICH sanction applies rather
 * than only that the person is listed.
 */
const DFAT_MEASURES = {
  targeted_financial_sanction: 'targeted financial sanction',
  travel_ban: 'travel ban',
  arms_embargo: 'arms embargo',
  maritime_restriction: 'maritime restriction',
};

/**
 * The listing a name row belongs to.
 *
 * DFAT used to repeat the listing's reference verbatim on every name row.
 * It no longer does: the current publication suffixes each additional name
 * with a letter, so Mohammad Hassan Akhund is reference `2` and his original
 * script and aliases are `2a`, `2b`, `2c`. Grouping on the raw cell therefore
 * stopped grouping anything — measured against the list published 21 July
 * 2026, it produced 10,581 "listings" from 3,846, every one of them a single
 * name with no aliases and, for two rows in three, an ALIAS standing in as
 * the sanctioned party's primary name.
 *
 * That is not a near miss. A screening hit is an accusation about a named
 * person, and naming them by an alias with no link to the listing is the kind
 * of reference-data defect nobody reads a stack trace for.
 *
 * Stripping a trailing alpha suffix restores it, and is safe in both
 * directions: the old repeated-reference format has no suffix to strip, and a
 * reference that is ENTIRELY alphabetic is left alone rather than collapsed
 * to nothing. Verified against the published file — 3,846 groups, each with
 * exactly one `Primary Name` row, and no group whose rows disagree on Type.
 */
export function dfatListingKey(reference) {
  const raw = String(reference ?? '').trim();
  const stripped = raw.replace(/[A-Za-z]+$/, '');
  return stripped || raw;
}

/**
 * Find the header row. DFAT sometimes ships a title/blurb row above the table,
 * so the first row is not reliably the header — locate it by looking for a
 * recognisable name column instead.
 */
function locateHeader(rows, maxScan = 15) {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const cells = (rows[i] ?? []).map((c) => String(c ?? '').trim().toLowerCase());
    if (cells.some((c) => DFAT_COLUMNS.name.includes(c))) return i;
  }
  return -1;
}

/**
 * Convert a header-mapped table into sanctions entries.
 *
 * DFAT publishes ONE ROW PER NAME VARIANT, with alias rows repeating the
 * listing's reference. Rows are therefore grouped by reference: the primary
 * name is the row marked as such, every other row for that reference becomes
 * an alias. Treating each row as its own listing would collide on
 * (list_code, external_id) and leave whichever alias sorted last standing in
 * as the person's primary name.
 */
export function rowsToDfatEntries(rows) {
  const headerIdx = locateHeader(rows);
  if (headerIdx < 0) {
    throw new Error(
      'could not find a DFAT header row containing a recognisable name column ' +
      `(looked for one of: ${DFAT_COLUMNS.name.join(', ')}). ` +
      'Refusing to guess at column positions.',
    );
  }
  const header = (rows[headerIdx] ?? []).map((h) => String(h ?? '').trim().toLowerCase());
  const col = (key) => {
    for (const n of DFAT_COLUMNS[key]) { const i = header.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const idx = Object.fromEntries(Object.keys(DFAT_COLUMNS).map((k) => [k, col(k)]));
  const headerIndexOf = (name) => header.indexOf(name);
  if (idx.name < 0) throw new Error('DFAT header located but the name column resolved to -1');

  const cell = (row, i) => (i >= 0 ? String(row[i] ?? '').trim() : '');
  const grouped = new Map();

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const name = cell(row, idx.name);
    if (!name) continue;
    // Rows without their own reference belong to the listing above them.
    const ref = dfatListingKey(cell(row, idx.reference)) || `ROW${r}`;

    if (!grouped.has(ref)) {
      grouped.set(ref, {
        reference: ref, primaryName: null, names: [], dobs: [], pobs: [],
        citizenships: [], addresses: [], additional: [], committees: [], type: '',
        weakAliases: [], imo: '', instruments: [], measures: {},
      });
    }
    const g = grouped.get(ref);
    const nameType = cell(row, idx.nameType);

    // "Primary name" wins; otherwise the first name seen for the reference.
    if (!g.primaryName && (!nameType || /primary|main/i.test(nameType))) g.primaryName = name;
    g.names.push(name);

    // A weak alias is one DFAT itself flags as a loose spelling. It stays
    // fully searchable — dropping it would lose real hits — but an analyst
    // adjudicating a match needs to know which kind of name matched.
    if (/weak/i.test(cell(row, idx.aliasStrength)) && !g.weakAliases.includes(name)) {
      g.weakAliases.push(name);
    }
    if (!g.imo) g.imo = cell(row, idx.imo);
    for (const [key, header] of Object.entries(DFAT_MEASURES)) {
      const i = header ? headerIndexOf(header) : -1;
      if (i < 0) continue;
      if (/true|yes/i.test(cell(row, i))) g.measures[key] = true;
      else if (g.measures[key] === undefined) g.measures[key] = false;
    }
    const instrument = cell(row, idx.instrument);
    if (instrument && !g.instruments.includes(instrument)) g.instruments.push(instrument);

    const push = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };
    push(g.dobs, cell(row, idx.dob));
    push(g.pobs, cell(row, idx.pob));
    push(g.citizenships, cell(row, idx.citizenship));
    push(g.addresses, cell(row, idx.address));
    push(g.additional, cell(row, idx.additional));
    push(g.committees, cell(row, idx.committee));
    if (!g.type) g.type = cell(row, idx.type);
  }

  const out = [];
  for (const g of grouped.values()) {
    const primary = g.primaryName || g.names[0];
    if (!primary) continue;
    const aliases = [...new Set(g.names.filter((n) => n !== primary))].slice(0, 50);
    out.push({
      external_id: `DFAT-${g.reference}`,
      primary_name: primary,
      aliases,
      // DFAT's Type column carries "Individual" / "Entity" / "Vessel".
      // Vessels arrived with the maritime restrictions and were previously
      // recorded as 'unknown'; `sanctions_entries` has accepted 'vessel' and
      // 'aircraft' all along.
      entry_type: /individual/i.test(g.type) ? 'individual'
        : /entity|organisation|organization/i.test(g.type) ? 'entity'
        : /vessel|ship/i.test(g.type) ? 'vessel'
        : /aircraft/i.test(g.type) ? 'aircraft'
        : 'unknown',
      date_of_birth: g.dobs[0] ?? null,
      place_of_birth: g.pobs[0] ?? null,
      nationalities: g.citizenships.slice(0, 10),
      listing_reference: g.committees[0] || 'Autonomous Sanctions Regulations 2011',
      listing_detail: {
        all_dates_of_birth: g.dobs.slice(0, 10),
        addresses: g.addresses.slice(0, 5),
        additional_information: g.additional.join(' | ').slice(0, 2000),
        committees: g.committees.slice(0, 10),
        name_variants: g.names.length,
        weak_aliases: g.weakAliases.slice(0, 50),
        imo_number: g.imo || null,
        instruments: g.instruments.slice(0, 10),
        measures: g.measures,
      },
    });
  }
  return out;
}

/** DFAT CSV export — same mapping as the XLSX, different container. */
export function parseDfatCsv(text) {
  return rowsToDfatEntries(parseCsv(text));
}

/**
 * DFAT XLSX, read directly. This is what DFAT actually publishes, so reading it
 * removes the manual "export to CSV" step that made the Australian list — the
 * legally operative one — the least likely to be kept current.
 */
export function parseDfatWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('workbook contains no sheets');
  const sheet = wb.Sheets[sheetName];
  // raw:false so dates arrive as displayed strings rather than serial numbers;
  // defval:'' so short rows keep their column alignment.
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  return rowsToDfatEntries(rows);
}

/**
 * Locate the consolidated-list download on the DFAT page.
 *
 * DFAT changes the filename when it republishes, so the link is discovered
 * rather than hardcoded. XLSX is preferred; CSV is accepted as a fallback.
 */
export function findSpreadsheetLink(html, baseUrl) {
  const hrefs = [...String(html).matchAll(/(?:href|src)\s*=\s*["']([^"']+\.(?:xlsx|xls|csv))(?:\?[^"']*)?["']/gi)]
    .map((m) => m[1]);
  if (hrefs.length === 0) return null;
  const score = (h) => {
    const l = h.toLowerCase();
    let s = 0;
    if (l.endsWith('.xlsx')) s += 3; else if (l.endsWith('.xls')) s += 2; else s += 1;
    if (/consolidated/.test(l)) s += 4;
    if (/regulation\s*8|regulation8/.test(l)) s += 2;
    return s;
  };
  const best = hrefs.sort((a, b) => score(b) - score(a))[0];
  try { return new URL(best, baseUrl).toString(); } catch { return null; }
}

/** Attach the normalised name tokens the screening query matches on. */
export function withNormalisedNames(entry, listCode, syncId) {
  const normalised = [...new Set(
    [entry.primary_name, ...(entry.aliases ?? [])].flatMap((n) => normaliseName(n)),
  )];
  return {
    list_code: listCode,
    external_id: entry.external_id,
    entry_type: entry.entry_type ?? 'unknown',
    primary_name: entry.primary_name,
    aliases: entry.aliases ?? [],
    normalised_names: normalised,
    date_of_birth: entry.date_of_birth ?? null,
    place_of_birth: entry.place_of_birth ?? null,
    nationalities: entry.nationalities ?? [],
    listing_reference: entry.listing_reference ?? null,
    listing_detail: entry.listing_detail ?? {},
    sync_id: syncId ?? null,
    updated_at: new Date().toISOString(),
  };
}
