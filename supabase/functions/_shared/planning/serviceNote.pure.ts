/**
 * A service note in a reader's words.
 *
 * `planning-data-service` writes a note on every register it could not answer
 * from, and the notes are written for the people who maintain it: "the only
 * such register this report reads is Queensland's", "a bot-protection
 * challenge stood in front of the Northern Territory's land-information
 * service", "the Planning and Design Code's zone layer could not be read
 * (HTTP 503 …)". Each is a true, measured statement about this platform's
 * build, and each reached a client's page verbatim — the 60 Lawley Street,
 * Spalding Compass of 25 Sep 2026 printed one of them four times.
 *
 * The LIMITATION is real and the reader needs it: nothing about a property
 * follows from a register nobody asked. What the reader does not need is the
 * machine room. So every note a client document prints passes through here
 * and comes out as an adviser would say it: what is not covered, and what
 * confirms it (`adviserVoice.pure.ts`). The service keeps its diagnostic
 * words — they are the engineering record, and `planningNotesAreMeasured`
 * holds them to measurement — and answers cached before any change carry the
 * same words, so translating on the way to the page reaches both.
 *
 * Two kinds of note are not translated but REPLACED, by returning null so the
 * caller's own sentence for that subject stands:
 *   - a note carrying a failure's own detail ("could not be read (…)"), which
 *     is a diagnostic about our request rather than a fact about the property;
 *   - a note the table does not recognise is returned as the service wrote
 *     it, as before — a spec holds every note the service can write to a
 *     translation, so an unrecognised one is a new note, not a silent leak.
 */

export const JURISDICTION_NAME: Readonly<Record<string, string>> = {
  NSW: 'New South Wales',
  VIC: 'Victoria',
  QLD: 'Queensland',
  WA: 'Western Australia',
  SA: 'South Australia',
  TAS: 'Tasmania',
  ACT: 'the Australian Capital Territory',
  NT: 'the Northern Territory',
};

/** How a note is recognised, and what the reader is told instead. */
interface ReaderSentence {
  match: RegExp;
  /** `where` is the jurisdiction's name; `m` the match, for a figure the note carries. */
  say: (where: string, m: RegExpExecArray) => string;
}

const READER_SENTENCES: readonly ReaderSentence[] = [
  // ── the zone ───────────────────────────────────────────────────────────────
  {
    match: /^Queensland sets zoning in each council planning scheme/i,
    say: () => 'In Queensland the zone is set by the council’s own planning scheme, and no state-wide zoning map '
      + 'exists. The council’s planning and development certificate confirms it.',
  },
  {
    match: /^WA planning scheme data \(SLIP\)/i,
    say: () => 'Western Australia publishes its planning scheme mapping for personal use only, so it is not '
      + 'reproduced in this report. The local government confirms it — a zoning certificate or a written planning '
      + 'enquiry — and it can be viewed on PlanWA.',
  },
  {
    match: /zone layer holds no zone in force at this point/i,
    say: () => 'The Planning and Design Code shows no zone in force at the property. Confirm the zone on the PlanSA '
      + 'portal before relying on this.',
  },
  {
    match: /^No integrated planning layer covers this point/i,
    say: () => 'This item is not covered by this report for this location. The local planning authority confirms it.',
  },
  {
    match: /^A bot-protection challenge/i,
    say: () => 'The Northern Territory’s planning maps could not be consulted for this report. The NT planning portal '
      + 'and a zoning certificate from the Northern Territory Planning Commission confirm it.',
  },
  // ── the land use table ─────────────────────────────────────────────────────
  // `renderLandUseTable` prints the table's note as the block's first line
  // wherever no table was read, and the 60 Lawley Street Compass printed the
  // first of these under "What may be built on this land". The block's own
  // closing sentence names what settles it, so each says only what is not
  // covered.
  {
    match: /^No zone was retrieved for this coordinate/i,
    say: () => 'The zone has not been confirmed for this property, so what may be built here is not covered by this '
      + 'report.',
  },
  {
    match: /^The zone was retrieved without the instrument that names it/i,
    say: () => 'The zone was identified but the planning instrument that sets it was not, so what the zone permits '
      + 'is not covered by this report.',
  },
  {
    match: /^[A-Z]{2,3} publishes no structured land use table/,
    say: (where) => `${where.charAt(0).toUpperCase()}${where.slice(1)} does not publish its land use tables in a `
      + 'form this report can include; what a zone permits is set out in the planning scheme itself.',
  },
  {
    match: /^The instrument[’']s land use table carries no zone (\S+?)\.?$/i,
    say: (_where, m) => `The planning instrument's land use table does not list zone ${m[1]}, so what the zone `
      + 'permits is not covered by this report.',
  },
  {
    match: /^The service answered for zone (\S+) and returned no land uses/i,
    say: (_where, m) => `No land uses are published for zone ${m[1]} in the planning instrument's table, so what the `
      + 'zone permits is not covered by this report.',
  },
  // ── the parcel ─────────────────────────────────────────────────────────────
  {
    match: /^South Australia[’']s planning layers are published by a state spatial service/i,
    say: () => 'Lot details are not covered by this report for South Australian properties. The certificate of '
      + 'title and the PlanSA portal confirm them.',
  },
  {
    match: /^No parcel attributes are integrated/i,
    say: () => 'Lot details are not covered by this report for this location. The certificate of title confirms them.',
  },
  // ── state development designations ────────────────────────────────────────
  {
    match: /^The property lies inside no declared priority development area/i,
    say: () => 'The property is not within a declared priority development area, state development area, '
      + 'coordinated project or infrastructure designation (Queensland State Planning mapping).',
  },
  {
    // The current service wording, and the build note it replaced (still in
    // answers cached before 25 Sep 2026).
    match: /^No state development-instrument register was searched|integrated for Queensland only so far/i,
    say: (where) => `State-level development designations are not covered by this report for ${where}. Any that `
      + 'affect the property will appear on the local government’s planning certificate.',
  },
  // ── development applications ──────────────────────────────────────────────
  {
    match: /^The NSW Online DA register returned no applications for this council in the last (\d+) days/i,
    say: (_where, m) => `No development applications were found on the NSW Planning Portal for this council in the `
      + `last ${m[1]} days. That can reflect how the council is named on the portal, so the council’s own `
      + 'application tracker should be checked for activity near the property.',
  },
  {
    match: /^No state-wide development-application feed exists/i,
    say: (where) => `Development applications in ${where} are published council by council, so none are summarised `
      + 'here. The council’s own application tracker shows activity near the property.',
  },
  // ── the forward investment programme ─────────────────────────────────────
  {
    match: /^(.+?) \(([^)]+)\) was read for (\d+(?:\.\d+)?) km around this property and names no investment inside it/i,
    say: (_where, m) => `${m[1]} (${m[2]}) was checked for investments within ${m[3]} km of the property and names `
      + 'none.',
  },
  {
    match: /^(.+?) is published by (.+?) under (.+?) and is read here\.?$/i,
    say: (_where, m) => `${m[1]} is published by ${m[2]} (${m[3]}).`,
  },
  {
    match: /^No forward investment programme was read for this jurisdiction/i,
    say: () => 'The state’s forward infrastructure programme is not covered by this report. That is a limit of this '
      + 'report, not a finding about the area.',
  },
  {
    match: /^(.+?) publishes (.+?)\. It is an official, current programme.*can be read at (\S+?)\.?$/is,
    say: (_where, m) => `${m[1]} publishes ${m[2]} as budget papers and agency publications. It is not summarised in `
      + `this report, so nothing about the area follows from its absence here; projects near the property can be `
      + `checked at ${m[3]}.`,
  },
];

/**
 * Notes that describe a failed request rather than the property. The caller's
 * own sentence for the subject stands in their place.
 */
const DIAGNOSTIC = /could not be read\b|\bwas not reached\b|needs the council from the zoning answer|refusing rather than reporting|\(HTTP \d{3}|^HTTP \d{3}\b|\bstatus \d{3}\b|unparseable JSON body|answered a body this could not read/i;

export function readerNote(note: string | null, jurisdiction: string | null): string | null {
  if (!note) return note;
  const where = (jurisdiction && JURISDICTION_NAME[jurisdiction]) || 'this state';
  for (const s of READER_SENTENCES) {
    const m = s.match.exec(note.trim());
    if (m) return s.say(where, m);
  }
  if (DIAGNOSTIC.test(note)) return null;
  return note;
}

/**
 * What a reader is told where a check could not be made at all — a failed
 * request, a missing answer — for one subject, and what confirms it.
 */
export function uncheckedSentence(subject: string, confirmedBy: string): string {
  return `${subject} could not be checked when this report was prepared. ${confirmedBy}`;
}
