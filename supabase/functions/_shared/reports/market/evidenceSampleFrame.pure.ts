/**
 * ME-6 — the controlled sample the first genuine extraction runs against.
 *
 * ## Selected on STRUCTURE, never on expected outcome
 *
 * The brief asks the sample to span strong, average and weak markets. It also
 * says, in as many words, not to cherry-pick historically strong examples — and
 * those two are in tension only if you try to satisfy the first one at
 * selection time.
 *
 * We have no growth data yet. That is the whole reason ME-6 exists. So any
 * "strong / average / weak" label applied now would be **our guess about a
 * market**, and selecting on it would guarantee the spread the extraction is
 * supposed to test for. The sample is therefore drawn on axes that are facts
 * about the corpus and are already measured:
 *
 *  - **state** — NSW, VIC, QLD, WA, SA
 *  - **remoteness** — the ABS RA class resolved in ME-5, not a suburb-name guess
 *  - **dwelling type** — house / attached, from `property_specs.property_type`
 *
 * The performance spread is then **verified after retrieval** (does the sample
 * in fact contain rising, flat and falling markets?) rather than engineered
 * before it. If it turns out not to, that is a finding about the corpus, and it
 * is a real one.
 *
 * ## Ordering is deterministic so the frame is reproducible
 *
 * Within each (state, remoteness, dwelling) cell, suburbs are ordered by the
 * number of trusted properties descending, then by name ascending, and the top
 * two are taken. Re-running the query on the same corpus gives the same frame,
 * which is what lets ME-7 cite it.
 *
 * ## The differentiation tests fall out of it
 *
 * The brief's item 15 asks for proof that two suburbs in one state can score
 * differently, and that a house series can differ from a unit series. The frame
 * contains those pairs by construction — {@link DIFFERENTIATION_PAIRS} names
 * them so the test is stated before the data arrives rather than found in it
 * afterwards.
 */

/** Bumped whenever the frame changes. Cited by any snapshot drawn from it. */
export const SAMPLE_FRAME_VERSION = 'me6.frame.1' as const;

/** Measured 2026-09-08 against the 867 trusted-geography reports. */
export const FRAME_MEASURED_AT = '2026-09-08' as const;

export type RemotenessClass =
  | 'metro' | 'inner_regional' | 'outer_regional' | 'remote';

export type SampleDwelling = 'house' | 'attached';

export interface SampleCell {
  state: string;
  remoteness: RemotenessClass;
  dwelling: SampleDwelling;
  suburb: string;
  postcode: string;
  /** Trusted properties in the corpus behind this cell, at FRAME_MEASURED_AT. */
  properties: number;
}

/**
 * The frame: 37 cells across five states, four remoteness classes and both
 * dwelling types, drawn by the rule above.
 */
export const SAMPLE_FRAME: ReadonlyArray<SampleCell> = [
  // NSW
  { state: 'NSW', remoteness: 'metro',          dwelling: 'house',    suburb: 'Elanora Heights', postcode: '2101', properties: 3 },
  { state: 'NSW', remoteness: 'metro',          dwelling: 'house',    suburb: 'Kellyville',      postcode: '2155', properties: 3 },
  { state: 'NSW', remoteness: 'metro',          dwelling: 'attached', suburb: 'Sydney',          postcode: '2000', properties: 3 },
  { state: 'NSW', remoteness: 'metro',          dwelling: 'attached', suburb: 'Palm Beach (NSW)', postcode: '2108', properties: 2 },
  { state: 'NSW', remoteness: 'inner_regional', dwelling: 'house',    suburb: 'Araluen (NSW)',   postcode: '2622', properties: 1 },
  // VIC
  { state: 'VIC', remoteness: 'metro',          dwelling: 'house',    suburb: 'Truganina',       postcode: '3029', properties: 17 },
  { state: 'VIC', remoteness: 'metro',          dwelling: 'house',    suburb: 'Cobblebank',      postcode: '3338', properties: 12 },
  { state: 'VIC', remoteness: 'metro',          dwelling: 'attached', suburb: 'Warrandyte',      postcode: '3113', properties: 5 },
  { state: 'VIC', remoteness: 'metro',          dwelling: 'attached', suburb: 'Truganina',       postcode: '3029', properties: 2 },
  { state: 'VIC', remoteness: 'inner_regional', dwelling: 'house',    suburb: 'Traralgon',       postcode: '3844', properties: 13 },
  { state: 'VIC', remoteness: 'inner_regional', dwelling: 'house',    suburb: 'Woodend (Vic.)',  postcode: '3442', properties: 4 },
  { state: 'VIC', remoteness: 'inner_regional', dwelling: 'attached', suburb: 'Wodonga',         postcode: '3690', properties: 1 },
  // QLD
  { state: 'QLD', remoteness: 'metro',          dwelling: 'house',    suburb: 'Caboolture',      postcode: '4510', properties: 17 },
  { state: 'QLD', remoteness: 'metro',          dwelling: 'house',    suburb: 'Buddina',         postcode: '4575', properties: 9 },
  { state: 'QLD', remoteness: 'metro',          dwelling: 'attached', suburb: 'Fortitude Valley', postcode: '4006', properties: 20 },
  { state: 'QLD', remoteness: 'metro',          dwelling: 'attached', suburb: 'Buddina',         postcode: '4575', properties: 9 },
  { state: 'QLD', remoteness: 'inner_regional', dwelling: 'house',    suburb: 'Gympie',          postcode: '4570', properties: 20 },
  { state: 'QLD', remoteness: 'inner_regional', dwelling: 'house',    suburb: 'Cooloola Cove',   postcode: '4580', properties: 16 },
  { state: 'QLD', remoteness: 'inner_regional', dwelling: 'attached', suburb: 'Drayton',         postcode: '4350', properties: 1 },
  { state: 'QLD', remoteness: 'inner_regional', dwelling: 'attached', suburb: 'Gatton',          postcode: '4343', properties: 1 },
  { state: 'QLD', remoteness: 'outer_regional', dwelling: 'house',    suburb: 'Bowen',           postcode: '4805', properties: 3 },
  { state: 'QLD', remoteness: 'outer_regional', dwelling: 'house',    suburb: 'Deeragun',        postcode: '4818', properties: 2 },
  { state: 'QLD', remoteness: 'outer_regional', dwelling: 'attached', suburb: 'Belgian Gardens', postcode: '4810', properties: 1 },
  { state: 'QLD', remoteness: 'outer_regional', dwelling: 'attached', suburb: 'Bowen',           postcode: '4805', properties: 1 },
  // WA
  { state: 'WA',  remoteness: 'metro',          dwelling: 'house',    suburb: 'Parmelia',        postcode: '6167', properties: 8 },
  { state: 'WA',  remoteness: 'metro',          dwelling: 'house',    suburb: 'Gosnells',        postcode: '6110', properties: 7 },
  { state: 'WA',  remoteness: 'metro',          dwelling: 'attached', suburb: 'East Perth',      postcode: '6004', properties: 7 },
  { state: 'WA',  remoteness: 'metro',          dwelling: 'attached', suburb: 'Cockburn Central', postcode: '6164', properties: 5 },
  { state: 'WA',  remoteness: 'inner_regional', dwelling: 'house',    suburb: 'Carey Park',      postcode: '6230', properties: 1 },
  { state: 'WA',  remoteness: 'inner_regional', dwelling: 'house',    suburb: 'Northam',         postcode: '6401', properties: 1 },
  { state: 'WA',  remoteness: 'outer_regional', dwelling: 'house',    suburb: 'South Kalgoorlie', postcode: '6430', properties: 2 },
  { state: 'WA',  remoteness: 'outer_regional', dwelling: 'house',    suburb: 'Northampton',     postcode: '6535', properties: 1 },
  { state: 'WA',  remoteness: 'remote',         dwelling: 'house',    suburb: 'Broome',          postcode: '6725', properties: 1 },
  { state: 'WA',  remoteness: 'remote',         dwelling: 'house',    suburb: 'Kalannie',        postcode: '6468', properties: 1 },
  // SA
  { state: 'SA',  remoteness: 'metro',          dwelling: 'house',    suburb: 'Seaford Meadows', postcode: '5169', properties: 3 },
  { state: 'SA',  remoteness: 'metro',          dwelling: 'house',    suburb: 'Adelaide',        postcode: '5000', properties: 1 },
  { state: 'SA',  remoteness: 'outer_regional', dwelling: 'house',    suburb: 'Whyalla Norrie',  postcode: '5608', properties: 1 },
];

/**
 * The differentiation tests, named BEFORE the data arrives.
 *
 * Stating them in advance is what stops the eventual result being a search for
 * whichever pair happened to differ.
 */
export const DIFFERENTIATION_PAIRS: ReadonlyArray<{
  id: string;
  question: string;
  a: { suburb: string; postcode: string; dwelling: SampleDwelling };
  b: { suburb: string; postcode: string; dwelling: SampleDwelling };
}> = [
  {
    id: 'wa_two_suburbs',
    question: 'Can two WA metro suburbs receive materially different Growth scores?',
    a: { suburb: 'Parmelia', postcode: '6167', dwelling: 'house' },
    b: { suburb: 'Gosnells', postcode: '6110', dwelling: 'house' },
  },
  {
    id: 'nsw_two_suburbs',
    question: 'Can two NSW metro suburbs receive materially different Growth scores?',
    a: { suburb: 'Elanora Heights', postcode: '2101', dwelling: 'house' },
    b: { suburb: 'Kellyville', postcode: '2155', dwelling: 'house' },
  },
  {
    id: 'house_vs_unit_same_suburb',
    question: 'Do house and unit series differ where the evidence differs, in ONE suburb?',
    a: { suburb: 'Buddina', postcode: '4575', dwelling: 'house' },
    b: { suburb: 'Buddina', postcode: '4575', dwelling: 'attached' },
  },
  {
    id: 'house_vs_unit_same_suburb_vic',
    question: 'The same test in a second state, so the first is not a QLD artefact.',
    a: { suburb: 'Truganina', postcode: '3029', dwelling: 'house' },
    b: { suburb: 'Truganina', postcode: '3029', dwelling: 'attached' },
  },
];

/** `${state}|${suburb}|${postcode}|${dwelling}` — the snapshot's subject key. */
export function subjectKeyOf(cell: Pick<SampleCell, 'state' | 'suburb' | 'postcode' | 'dwelling'>): string {
  return `${cell.state}|${cell.suburb}|${cell.postcode}|${cell.dwelling}`;
}

/** How many provider calls the frame costs. One per (suburb, postcode, dwelling). */
export function frameCallCount(): number {
  return new Set(SAMPLE_FRAME.map(subjectKeyOf)).size;
}
