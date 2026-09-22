/**
 * Ask the ABS for the part of the cube this register reads, and nothing else.
 *
 * ## The measurement this exists for
 *
 * Measured from a CI runner on 21 Sep 2026, against the Bureau's own bytes:
 *
 *     SA2, 12 months   200    476.5 MB   60.2 s   DID NOT FINISH
 *     SA2, 36 months   200   5045.4 MB   60.1 s   DID NOT FINISH
 *     LGA, 12 months   200     61.8 MB    1.6 s   complete
 *
 * An edge function has a ~150 s wall clock, so the finest grain the scorer
 * prices is not loadable at all with `/all`, and the LGA download is 61.8 MB
 * for **one month** of data. The window is not the lever: the two LGA windows
 * came back byte-identical because that edition holds one month, and shrinking
 * a period cannot shrink a cube that is wide rather than long.
 *
 * What is actually in those bytes is the whole cube — every building type
 * including hotels, factories, offices and health, every measure, and all
 * three series estimates — of which `parseAbsBuildingApprovals` keeps Original
 * estimates of three residential types on two measures and discards the rest.
 * We are paying to transfer what we then throw away.
 *
 * ## An SDMX key is POSITIONAL, so it is read and never typed
 *
 * `/rest/data/{flow}/{key}` selects by position: `M..1+2.....` means whatever
 * the publisher's dimension order says it means. Typing one from memory is the
 * mistyped Airtable column with an HTTP 200 in front of it — a narrowed key
 * against the wrong positions returns a plausible, wrong slice rather than an
 * error. So the order comes from the publisher's own data structure, exactly
 * as the dataflow identifier comes from the publisher's own catalogue.
 *
 * ## Four rules
 *
 * **The codes are chosen by NAME, with the rules the parser reads by.**
 * `BUILDING_TYPE_PATTERNS`, `UNITS_MEASURE`, `VALUE_MEASURE`,
 * `ORIGINAL_SERIES` and `MONTHLY_FREQ` are imported rather than restated, so
 * asking for what we keep and keeping what we asked for are one declaration.
 * Two copies of "which building types are residential" is how a narrowed
 * download comes back missing a row the parser still expects.
 *
 * **The area dimension is never narrowed, and that is enforced rather than
 * intended.** Narrowing the region is the one change that would silently make
 * the register a reading about somewhere else, so `composeApprovalsKey`
 * refuses outright if a rule ever matches a region dimension.
 *
 * **A rule that matches no code narrows nothing.** If the ABS renames
 * `Original`, the rule matches nothing, that position is left open, the whole
 * dimension comes back, and the parse filters it exactly as it does today.
 * The failure mode is a download that is bigger than it needed to be, never
 * one that is missing rows — and the caller is told which dimensions went
 * unnarrowed so a silent widening is visible in the sync row.
 *
 * **A structure that cannot be read costs nothing.** The caller falls back to
 * `/all`, which is what shipped, so this can only improve a load or leave it
 * alone. A narrowing is an optimisation and must never be a dependency.
 *
 * ## Why a mis-composed key cannot produce a wrong FIGURE
 *
 * The danger with a positional key is not an error, it is an HTTP 200 over a
 * slice nobody asked for. What bounds that here is that the first rule above
 * makes the parse an INDEPENDENT check on the query: both ends match the same
 * labels, so a key that selected the wrong codes returns rows whose labels
 * the parse then discards. A wrong key can therefore only make a download
 * SMALLER — and a download that lost its rows is refused by
 * `ABS_BA_PLAUSIBILITY`'s area and period floors, which is a loud failure.
 *
 * It cannot smuggle in a row the parse would accept and should not: to do
 * that, a code would have to carry a name the parse matches while being the
 * wrong series — which is a publisher relabelling its own cube, and no
 * arrangement of a key defends against that. `UNITS_MEASURE` admitting
 * `Number of buildings` was exactly that shape, and it was fixed in the rule
 * both ends read rather than in either end.
 */
import {
  BUILDING_TYPE_PATTERNS,
  MONTHLY_FREQ,
  ORIGINAL_SERIES,
  UNITS_MEASURE,
  VALUE_MEASURE,
  type DataflowEntry,
} from './absBuildingApprovals.pure.ts';

/**
 * The `Accept` the ABS's structure endpoints actually serve.
 *
 * Named once because it was typed twice and then a third time wrong. The
 * projection probe sent `application/vnd.sdmx.structure+xml;version=1.0` —
 * XML instead of JSON, and with no wildcard fallback — and every structure
 * request answered **HTTP 406 Not Acceptable**. The probe then printed
 * *"THE PREMISE DOES NOT HOLD"* over `flows read 0`, which is the
 * urban-centre register's rule paid again: an instrument that can fail the
 * way its subject fails is not an instrument.
 *
 * The JSON variant leads because it is what the Bureau serves; the XML and
 * wildcard entries follow because a publisher may change a default and a reader
 * that can read only the shape somebody assumed reports an outage when the
 * content type moved.
 */
export const ABS_SDMX_STRUCTURE_ACCEPT =
  'application/vnd.sdmx.structure+json;version=1.0,application/xml,*/*';

/** The `Accept` for a data query. Same rule, same reason. */
export const ABS_SDMX_CSV_ACCEPT = 'text/csv,*/*';

/**
 * A non-200 that is a statement about OUR REQUEST rather than the publisher.
 *
 * 406 is the server saying it cannot serve what we asked for and 415 that it
 * cannot read what we sent — both are content negotiation, both are ours, and
 * laundering either as "the ABS did not answer" is a green build standing over
 * a check that reached the publisher and asked it wrong. Every other non-200
 * stays theirs.
 */
export function isOurRequestFault(status: number): boolean {
  return status === 406 || status === 415;
}

/** The structure request for one flow: the DSD and its codelists. */
export function absDataStructureUrl(flow: DataflowEntry): string {
  return `https://data.api.abs.gov.au/rest/dataflow/${flow.agency}/${flow.id}/${flow.version}`
    + '?references=all';
}

export interface StructureCode {
  id: string;
  name: string;
}

export interface StructureDimension {
  id: string;
  /** The publisher's own 1-based position. The key is composed in this order. */
  position: number;
  codes: StructureCode[];
  /**
   * The time dimension. Read so the order is the publisher's own, and then
   * EXCLUDED from the key: under SDMX REST the key covers the dimensions
   * other than time, and the period is `startPeriod`/`endPeriod`. A slot for
   * `TIME_PERIOD` shifts nothing visibly and makes every position after it
   * mean a different dimension — an HTTP 200 over a plausible, wrong slice,
   * which is the one failure this whole module is arranged to avoid.
   */
  isTime: boolean;
}

export interface DataStructure {
  dimensions: StructureDimension[];
}

/**
 * The dimensions this register narrows, and what it keeps of each.
 *
 * `dimension` is matched against the dimension's own ID and `keep` against
 * each code's NAME — an id is a publisher's shorthand (`TYPE_BUILD` code `1`)
 * and carries no meaning a rule can be written against, while a name is the
 * same string the CSV's label column carries and the same one the parse
 * matches. Adding a dimension here is a declaration beside the rule that
 * reads it, never a change to the composer.
 */
export const ABS_BA_KEY_RULES: ReadonlyArray<{
  dimension: RegExp;
  keep: RegExp[];
  why: string;
}> = [
  {
    dimension: /^(TYPE_BUILD|BUILDING_TYPE|TYPE_OF_BUILDING|DWELLING_TYPE|TYPEBUILD)$/i,
    keep: BUILDING_TYPE_PATTERNS.map(([, pattern]) => pattern),
    why: 'three residential types; the cube also carries hotels, factories, offices and health',
  },
  {
    dimension: /^(MEASURE|MSR|MEASURES)$/i,
    keep: [UNITS_MEASURE, VALUE_MEASURE],
    why: 'dwelling units and value of building approved',
  },
  {
    dimension: /^(TSEST|SERIES_TYPE|SERIESTYPE|ADJUSTMENT|ADJUSTMENT_TYPE)$/i,
    keep: [ORIGINAL_SERIES],
    why: 'Original only — summing across the three estimates triples every figure',
  },
  {
    dimension: /^(FREQ|FREQUENCY)$/i,
    keep: [MONTHLY_FREQ],
    why: 'monthly; every other period is discarded by `monthPeriod` anyway',
  },
  /*
   * The two that produced a wrong figure on live data.
   *
   * Measured 21 Sep 2026, the Bureau's LGA download gave **two different
   * values of building approved for Greater Bendigo 2026-07 total
   * residential — $14,857,000 then $45,670,000**, because three sectors and
   * nine work types all land on one (area, period, building type) key. Left
   * unfiltered, the register stores whichever arrived last and presents it
   * as the total: a figure three times wrong and indistinguishable from a
   * correct one by looking at it.
   *
   * Both keep the PUBLISHER'S OWN TOTAL rather than a total reconstructed
   * from parts. `Total Work` is the ABS's own headline dwelling-units
   * figure; summing `New` with the conversion and alteration categories
   * would invent a measure the Bureau does not publish and would double
   * count `Alterations and additions including conversions` against its own
   * two children. The register's rule is that the grain is the publisher's
   * and is never renamed — this is the same rule applied to a measure.
   */
  {
    dimension: /^(SECTOR|SECTORS)$/i,
    keep: [/^total sectors?$/i],
    why: 'the publisher\'s own total; private and public land on the same row key',
  },
  {
    dimension: /^(WORK_TYPE|WORKTYPE|TYPE_OF_WORK)$/i,
    keep: [/^total work$/i],
    why: 'the publisher\'s own total; new, conversions and alterations share one key',
  },
  /*
   * `REGION_TYPE` is deliberately NOT narrowed, and the reason is the rule
   * this module opens with.
   *
   * It was, for one commit, on the sound-looking argument that the SA2 flow
   * offers forty-three ASGS levels and this register stores four. Measured
   * 21 Sep 2026, keeping `AUS+STE+SA2+LGA` turned the LGA flow's working
   * 8.0 MB download into **9,818 bytes carrying eight states, one national
   * row and not a single council** — refused by the area floor, correctly.
   * `AUS` and `STE` answered; `LGA` did not, because a code that names a
   * level in a codelist is not necessarily the code the DATA is tagged with.
   *
   * Every other rule here is a CORRECTNESS narrowing: without it rows
   * collide on (area, period, building type) and the register stores an
   * arbitrary slice as a total. This one was purely a SIZE narrowing, and
   * size is already solved — `narrowedApprovalsUrl` takes an `endPeriod`,
   * and SA2 loads in eight requests of six months at 10.4 MB each.
   *
   * So it fails the module's own standard: *a narrowing is an optimisation
   * and must never be a dependency.* A narrowing that can silently exclude
   * the data you came for is not an optimisation; it is a bet that a code
   * matches, and it loses quietly. Left open, every level comes back, the
   * parse files each row by its own area code (`grainOfAreaCode`) and one
   * download fills every grain the register stores.
   */
];

/**
 * The dimensions that name an AREA. Never narrowed, and a rule that reaches
 * one is a bug this refuses to ship rather than a slice to serve.
 */
export const AREA_DIMENSION = /^(REGION|ASGS_2016|ASGS_2021|ASGS_2026|LGA|SA2|STATE|GCCSA)$/i;

export interface ComposedKey {
  /** The positional key, or `all` where nothing narrowed. */
  key: string;
  /** Per narrowed dimension: what was kept, and out of how many. */
  narrowed: Array<{ dimension: string; kept: string[]; of: number; why: string }>;
  /** Dimensions a rule named but could not narrow, with why. Never silent. */
  unnarrowed: Array<{ dimension: string; reason: string }>;
}

/**
 * The key for one structure. `all` where nothing could be narrowed, which is
 * byte-for-byte the request that shipped.
 */
export function composeApprovalsKey(structure: DataStructure): ComposedKey {
  const ordered = structure.dimensions
    .filter((d) => !d.isTime)
    .sort((a, b) => a.position - b.position);
  if (ordered.length === 0) {
    return { key: 'all', narrowed: [], unnarrowed: [{ dimension: '(none)', reason: 'the structure named no dimension' }] };
  }

  const narrowed: ComposedKey['narrowed'] = [];
  const unnarrowed: ComposedKey['unnarrowed'] = [];
  const positions: string[] = [];

  for (const dim of ordered) {
    const rule = ABS_BA_KEY_RULES.find((r) => r.dimension.test(dim.id));
    if (!rule) { positions.push(''); continue; }
    if (AREA_DIMENSION.test(dim.id)) {
      // Not a degradation. A register narrowed by area is a register about
      // somewhere else, and the whole point of the read ladder is that the
      // AREA is chosen at read time from a trusted geography.
      throw new Error(
        `a key rule matched the area dimension "${dim.id}" — refused, because narrowing the `
        + 'area is what would make this register a reading about somewhere else',
      );
    }
    if (dim.codes.length === 0) {
      unnarrowed.push({ dimension: dim.id, reason: 'the structure published no codelist for it' });
      positions.push('');
      continue;
    }
    const kept = dim.codes.filter((c) => rule.keep.some((k) => k.test(c.name.trim()))).map((c) => c.id);
    if (kept.length === 0) {
      // The publisher renamed something. Leaving the position OPEN returns the
      // whole dimension and the parse filters it as it always has — bigger
      // than it needed to be, never missing a row.
      unnarrowed.push({
        dimension: dim.id,
        reason: `no code name matched (${dim.codes.length} published, e.g. ${dim.codes.slice(0, 3).map((c) => c.name).join(', ')})`,
      });
      positions.push('');
      continue;
    }
    if (kept.length === dim.codes.length) {
      // Asking for everything is asking for nothing; keep the position open so
      // the URL stays the shorter, cacheable one.
      positions.push('');
      continue;
    }
    narrowed.push({ dimension: dim.id, kept, of: dim.codes.length, why: rule.why });
    positions.push(kept.join('+'));
  }

  const key = positions.every((p) => p === '') ? 'all' : positions.join('.');
  return { key, narrowed, unnarrowed };
}

/** The data query for a flow, narrowed to what this register reads. */
/**
 * The data query for a flow, narrowed to what this register reads.
 *
 * `endPeriod` bounds the window at the far end, which is what makes a
 * register too wide for one invocation loadable in several. It is the only
 * paging lever the SDMX key does NOT give: a key selects exact codes, so
 * asking for one state's SA2s would mean enumerating three hundred of them
 * in the URL, while a period is two parameters whatever the geography.
 */
export function narrowedApprovalsUrl(
  flow: DataflowEntry,
  startPeriod: string,
  key: string,
  endPeriod?: string,
): string {
  for (const [name, value] of [['startPeriod', startPeriod], ['endPeriod', endPeriod]] as const) {
    if (value !== undefined && !/^\d{4}-\d{2}$/.test(value)) {
      throw new Error(`${name} must be YYYY-MM, not "${value}"`);
    }
  }
  if (endPeriod !== undefined && endPeriod < startPeriod) {
    throw new Error(`endPeriod ${endPeriod} is before startPeriod ${startPeriod} — refused`);
  }
  return `https://data.api.abs.gov.au/rest/data/${flow.agency},${flow.id},${flow.version}/${key}`
    + `?startPeriod=${startPeriod}`
    + (endPeriod ? `&endPeriod=${endPeriod}` : '')
    + '&format=csvfilewithlabels';
}

// ─── Reading the structure ──────────────────────────────────────────────────

/**
 * The data structure, in both shapes the standard admits.
 *
 * Same reason `parseDataflowCatalogue` reads both: which one answers depends
 * on the `Accept` header and on the publisher's defaults, and a reader that
 * understands only the shape somebody assumed reports a publisher outage when
 * the publisher changed a content type.
 */
export function parseDataStructure(text: string): DataStructure {
  const body = text.trim();
  if (body === '') throw new Error('the ABS data structure is empty — refused');
  const parsed = body.startsWith('{') ? parseJsonStructure(body) : parseXmlStructure(body);
  if (parsed.dimensions.length === 0) {
    /*
     * Say what was handed over. The first version refused 3,193,984 bytes of
     * the Bureau's own structure with "names no dimension", which is true and
     * useless: it does not say whether the body was JSON or XML, what its
     * root element was, or whether it was an error page. A refusal that
     * cannot be acted on costs a whole build cycle to diagnose, and the
     * fallback means nothing else reports it at all.
     */
    const shape = body.startsWith('{') ? 'JSON' : 'XML';
    throw new Error(
      `the ABS data structure (${body.length.toLocaleString('en-AU')} bytes, read as ${shape}) `
      + `names no dimension — refused. It opens: ${JSON.stringify(body.slice(0, 220))}`,
    );
  }
  return parsed;
}

/** `urn:…Codelist=ABS:CL_TYPE_BUILD(1.0.0)` → `CL_TYPE_BUILD`. */
function codelistIdOf(urn: string): string | null {
  const m = /Codelist=[^:]*:([A-Za-z0-9_@\-]+)\(/.exec(urn) ?? /Codelist=[^:]*:([A-Za-z0-9_@\-]+)/.exec(urn);
  return m ? m[1] : null;
}

const localeName = (value: unknown, names: unknown): string => {
  if (typeof value === 'string') return value;
  const map = (names ?? {}) as Record<string, unknown>;
  if (typeof map.en === 'string') return map.en;
  return Object.values(map).find((v): v is string => typeof v === 'string') ?? '';
};

function parseJsonStructure(body: string): DataStructure {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    throw new Error('the ABS data structure is not parseable JSON — refused');
  }
  const root = doc as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;

  // Codelists first, by id, so a dimension can resolve its own.
  const byCodelist = new Map<string, StructureCode[]>();
  const lists = Array.isArray(data.codelists) ? data.codelists : [];
  for (const raw of lists) {
    if (!raw || typeof raw !== 'object') continue;
    const cl = raw as Record<string, unknown>;
    const id = typeof cl.id === 'string' ? cl.id : null;
    if (!id) continue;
    const codes = Array.isArray(cl.codes) ? cl.codes : [];
    byCodelist.set(id, codes.flatMap((c) => {
      if (!c || typeof c !== 'object') return [];
      const code = c as Record<string, unknown>;
      return typeof code.id === 'string'
        ? [{ id: code.id, name: localeName(code.name, code.names) }]
        : [];
    }));
  }

  const structures = Array.isArray(data.dataStructures) ? data.dataStructures : [];
  const dimensions: StructureDimension[] = [];
  for (const raw of structures) {
    if (!raw || typeof raw !== 'object') continue;
    const dsd = raw as Record<string, unknown>;
    const components = (dsd.dataStructureComponents ?? {}) as Record<string, unknown>;
    const dimList = (components.dimensionList ?? {}) as Record<string, unknown>;
    const dims = Array.isArray(dimList.dimensions) ? dimList.dimensions : [];
    // SDMX-JSON publishes the time dimension in its own array, so it is
    // already out of the key's order; it is read only to be named.
    const timeDims = Array.isArray(dimList.timeDimensions) ? dimList.timeDimensions : [];
    for (const t of timeDims) {
      if (!t || typeof t !== 'object') continue;
      const tid = (t as Record<string, unknown>).id;
      if (typeof tid === 'string') dimensions.push({ id: tid, position: 9_999, codes: [], isTime: true });
    }
    dims.forEach((d, index) => {
      if (!d || typeof d !== 'object') return;
      const dim = d as Record<string, unknown>;
      const id = typeof dim.id === 'string' ? dim.id : null;
      if (!id) return;
      const rep = (dim.localRepresentation ?? {}) as Record<string, unknown>;
      const enumeration = typeof rep.enumeration === 'string' ? rep.enumeration : '';
      const clId = codelistIdOf(enumeration);
      dimensions.push({
        id,
        // The publisher's own position where it states one; else the order it
        // published them in, which SDMX-JSON guarantees is the key's order.
        position: typeof dim.position === 'number' ? dim.position : index + 1,
        codes: (clId && byCodelist.get(clId)) || [],
        isTime: false,
      });
    });
  }
  return { dimensions };
}

/**
 * SDMX-ML, with no assumption about the namespace PREFIX.
 *
 * The first version matched `<str:Dimension>` literally, and on 21 Sep 2026
 * the Bureau answered 3,193,984 bytes of real structure from which it read
 * **no dimension at all**. A prefix is a document's own choice — `str:`,
 * `structure:`, or none — and binding to one is the same mistake as binding
 * to a dataflow identifier: it fails silently, on a 200, and the fallback
 * hides it. Every element here is matched prefix-agnostically, and both the
 * container and self-closing spellings are accepted.
 */
function parseXmlStructure(body: string): DataStructure {
  const attr = (tag: string, name: string): string | null => {
    const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
    return m ? m[1] : null;
  };
  /** `<ns:Thing …>…</ns:Thing>` and `<Thing …>…</Thing>` alike. */
  const blocks = (name: string, text: string) =>
    text.matchAll(new RegExp(`<(?:[A-Za-z0-9_]+:)?${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${name}>)`, 'g'));

  // Codelists, by id.
  const byCodelist = new Map<string, StructureCode[]>();
  for (const block of blocks('Codelist', body)) {
    const id = attr(block[1], 'id');
    if (!id) continue;
    const codes: StructureCode[] = [];
    for (const code of blocks('Code', block[2] ?? '')) {
      const codeId = attr(code[1], 'id');
      if (!codeId) continue;
      const name = /<(?:[A-Za-z0-9_]+:)?Name\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?Name>/.exec(code[2] ?? '');
      codes.push({ id: codeId, name: (name?.[1] ?? '').trim() });
    }
    byCodelist.set(id, codes);
  }

  const dimensions: StructureDimension[] = [];
  let fallbackPosition = 0;
  for (const kind of ['Dimension', 'TimeDimension'] as const) {
    for (const block of blocks(kind, body)) {
      const isTime = kind === 'TimeDimension';
      const id = attr(block[1], 'id');
      if (!id) continue;
      // `<DimensionList>` wraps `<Dimension>`, and a prefix-agnostic match for
      // `Dimension` would also match nothing else — but a `MeasureDimension`
      // or `AttributeList` entry must not arrive here, so the id is the guard
      // and a duplicate is dropped.
      if (dimensions.some((d) => d.id === id)) continue;
      if (!isTime) fallbackPosition += 1;
      const declared = attr(block[1], 'position');
      const inner = block[2] ?? '';
      const ref = /<(?:[A-Za-z0-9_]+:)?Ref\b([^>]*)\/?>/g;
      let clId: string | null = null;
      for (const m of inner.matchAll(ref)) {
        const pkg = attr(m[1], 'package');
        const cls = attr(m[1], 'class');
        if (pkg === 'codelist' || cls === 'Codelist') { clId = attr(m[1], 'id'); break; }
      }
      dimensions.push({
        id,
        position: declared && /^\d+$/.test(declared) ? Number(declared) : fallbackPosition,
        codes: (clId && byCodelist.get(clId)) || [],
        isTime,
      });
    }
  }
  return { dimensions };
}
