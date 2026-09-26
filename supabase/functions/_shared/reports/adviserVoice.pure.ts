/**
 * How a client document speaks: as the adviser issuing it, about the property.
 *
 * ## What the 60 Lawley Street Compass sounded like
 *
 * The owner read the regenerated Compass for 60 Lawley Street, Spalding WA
 * (25 Sep 2026) as a client would, and asked for every report to read like "a
 * property professional presenting the information". Measured on the text the
 * dashboard showed:
 *
 * | word or sentence | times |
 * | --- | ---: |
 * | "register" | 110 |
 * | "retrieved" / "retrieval" | 38 |
 * | "coordinate" | 17 |
 * | "this platform" | 11 |
 * | "Recorded attribute" (a column heading) | 6 |
 * | "Not searched." | 6 |
 * | "No infrastructure project or development instrument was retrieved …" | 5 |
 * | "… no operator stop file was available for this assessment" | 5 |
 * | "No population projection … has been loaded for this assessment" | 3 |
 *
 * Every one of those sentences was TRUE. None of them was about the property.
 * They describe how the report was made — which systems were asked, what a
 * deployment holds — and a client does not buy a house from a description of a
 * database. The honesty rules behind them stay (an absence is never rated, a
 * checked-and-empty map is not the same as an unchecked one, a limitation is
 * stated). What changes is who is speaking and how often.
 *
 * ## Why the same caveat was printed five times
 *
 * Not a model's habit — an instruction. `infrastructureRules` opened "RULES FOR
 * THE WHOLE REPORT … They apply in every section" and its first rule was "Say
 * in one sentence that no infrastructure project … was retrieved". The pinned
 * context is the same for every section call, so every section that touched
 * the subject said it. A rule that must be obeyed everywhere and a sentence
 * that must be written once are different kinds of instruction, and the second
 * needs a place. `DISCLOSURE_HOMES` is that place: each limitation belongs to
 * the section that owns its subject, is explained there once, and is at most
 * pointed to elsewhere. Prohibitions (never rate an absence, never name a
 * project nobody published) still bind every section — they cost no words.
 *
 * ## Three consumers, one list
 *
 * - `documentRules` hands the writer the vocabulary and the homes, in the
 *   untrimmed system message of every section call.
 * - The composed blocks this platform appends or pins (planning, infrastructure,
 *   transport, population, supply, climate) are held to it by a spec, because
 *   a sentence composed in code reaches the page verbatim and the writer copies
 *   its phrasing.
 * - `compassQAValidator` reports what reached a finished document
 *   (`platform-vocabulary`), as a warning: prose is never regex-scrubbed here,
 *   because deleting a phrase leaves a sentence that no longer says what it
 *   said.
 *
 * Pure: no imports, no I/O.
 */

/** A phrase that describes how the report was produced, and what an adviser says instead. */
export interface PlatformTerm {
  /** How it is recognised in finished prose. */
  pattern: RegExp;
  /** The words the writer is shown. */
  phrase: string;
  /** What an adviser writes in its place. */
  instead: string;
}

/**
 * The vocabulary of the machine room, never written in a client document.
 *
 * Each pattern is narrow on purpose: `coordinate` does not match Queensland's
 * statutory "coordinated project", `loaded` needs its auxiliary, and "the
 * model" does not match a display home's model name. A QA warning that fires
 * on ordinary English teaches an operator to ignore it.
 */
export const PLATFORM_VOCABULARY: readonly PlatformTerm[] = [
  {
    pattern: /\b(?:this|the) platform\b/i,
    phrase: 'this platform',
    instead: 'name the source ("the DFES Map of Bush Fire Prone Areas"), or say "our searches"',
  },
  {
    pattern: /\bthis deployment\b/i,
    phrase: 'this deployment',
    instead: 'say what the client should obtain or check, and from whom',
  },
  {
    // Not a relocatable home "loaded onto a truck": the physical sense takes a
    // preposition of motion, the machine room's does not.
    pattern: /\b(?:has|have|had|was|were|been|is|are|being) (?:not )?loaded\b(?! (?:onto|on to|into|on a|on the back))/i,
    phrase: 'loaded',
    instead: 'say the source was not part of this report, and name where the client can read it',
  },
  {
    pattern: /\bretriev(?:ed|al|als|ing|e)\b/i,
    phrase: 'retrieved',
    instead: '"identified", "found" or "confirmed" in prose; "accessed" in a citation',
  },
  {
    pattern: /\b(?:verified |property['’]s )?coordinates?\b/i,
    phrase: 'coordinate',
    instead: '"the property" or "the property\'s location"',
  },
  {
    pattern: /\baddress point\b/i,
    phrase: 'address point',
    instead: '"the property" or "the property\'s address"',
  },
  {
    pattern: /\boperator stop file\b|\bstop file\b/i,
    phrase: 'operator stop file',
    instead: '"the operator\'s published timetable"',
  },
  {
    pattern: /\bevidence pack\b|\bdata packet\b/i,
    phrase: 'evidence pack',
    instead: 'name the evidence itself',
  },
  {
    pattern: /\bthe (?:scoring |assessment )?model(?:'s|’s)?\b(?! (?:home|house|design|residence))/i,
    phrase: 'the model',
    instead: '"this assessment" or "our assessment"',
  },
  {
    pattern: /\brecorded attributes?\b/i,
    phrase: 'recorded attribute',
    instead: '"feature" or "detail"',
  },
  {
    pattern: /\bnot searched\b/i,
    phrase: 'not searched',
    instead: '"not covered by this report", with where the client can check it',
  },
  {
    // "No register answered these", "drawn from the registers read for this
    // report" — the same statement about our reading, found in the strategy
    // sections on 25 Sep 2026 after the first form was already listed.
    pattern: /\bregisters? (?:this|the) (?:report|platform|assessment) (?:reads|read|asks|asked)\b|\bregisters? read for (?:this|the) (?:report|assessment)\b|\bno register (?:answered|can answer)\b/i,
    phrase: 'the registers this report reads',
    instead: '"the government sources checked for this report"',
  },
  {
    pattern: /\boverride workflow\b|\bmanual data override\b/i,
    phrase: 'override workflow',
    instead: '"set as an assumption for this analysis"',
  },
  {
    pattern: /\bscoring (?:service|engine)\b/i,
    phrase: 'scoring service',
    instead: '"the scoring method"',
  },
];

/** Every platform phrase in `text`, in order of first appearance, each once. */
export function platformVocabularyIn(text: string): string[] {
  const found: { phrase: string; at: number }[] = [];
  for (const term of PLATFORM_VOCABULARY) {
    const m = term.pattern.exec(text);
    if (m) found.push({ phrase: term.phrase, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.phrase);
}

/** How many times any platform phrase occurs in `text`. */
export function platformVocabularyCount(text: string): number {
  let n = 0;
  for (const term of PLATFORM_VOCABULARY) {
    const global = new RegExp(term.pattern.source, term.pattern.flags.includes('g') ? term.pattern.flags : `${term.pattern.flags}g`);
    n += (text.match(global) ?? []).length;
  }
  return n;
}

/**
 * The two absences, as a reader is told them, wherever a source is listed.
 *
 * They used to read "Searched, nothing found." and "Not searched." — the right
 * distinction in the words of the machine that made it. The distinction is
 * the one the whole planning programme turns on: a source checked for this
 * property that records nothing here, against one this report never
 * consulted. Only the voice changed. They live here, not in any one register,
 * because the planning table, the infrastructure outlook and the supply block
 * all print them, and two spellings of one distinction on two pages of one
 * document is how a reader comes to think they mean different things.
 */
export const REGISTER_CHECKED_EMPTY = 'Checked — nothing recorded.';
export const REGISTER_NOT_COVERED = 'Not covered by this report.';

/** A kind of limitation, and the section that owns its explanation. */
export type DisclosureTopic =
  | 'planning'
  | 'infrastructure'
  | 'supply'
  | 'forwardDemand'
  | 'transport'
  | 'amenity'
  | 'environment'
  | 'market';

export interface DisclosureHome {
  /** The Compass registry id of the section that explains it. */
  sectionId: string;
  /** That section's name, as the reader sees it. */
  sectionName: string;
  /** The subject, in a reader's words. */
  subject: string;
}

/**
 * Where each limitation is explained — once.
 *
 * The ids and names are the Compass registry's (`compassSectionRegistry.ts`);
 * a spec holds the two together, because this module is pure and the registry
 * is not. Elsewhere in the document a limitation may be pointed to in a few
 * words, never explained again.
 */
export const DISCLOSURE_HOMES: Readonly<Record<DisclosureTopic, DisclosureHome>> = {
  planning: {
    sectionId: 'compass.planningConstraints',
    sectionName: 'Zoning, Planning and Development Considerations',
    subject: 'zoning, planning controls and overlays',
  },
  infrastructure: {
    sectionId: 'compass.infrastructure',
    sectionName: 'Infrastructure and Growth Context',
    subject: 'infrastructure projects and development activity',
  },
  supply: {
    sectionId: 'compass.supplyPipeline',
    sectionName: 'Competitive Landscape and Supply Pipeline',
    subject: 'new housing supply and building approvals',
  },
  forwardDemand: {
    sectionId: 'compass.demandDrivers',
    sectionName: 'Demand Drivers',
    subject: 'population and forward demand',
  },
  transport: {
    sectionId: 'compass.transportAccess',
    sectionName: 'Transport & Connectivity',
    subject: 'public transport and commuting',
  },
  amenity: {
    sectionId: 'compass.amenityAccess',
    sectionName: 'Amenity & Access',
    subject: 'schools, shops, health services and parks nearby',
  },
  environment: {
    sectionId: 'compass.environmentSafety',
    sectionName: 'Environment, Climate & Safety',
    subject: 'natural hazards, climate and crime',
  },
  market: {
    sectionId: 'compass.marketPositioning',
    sectionName: 'Market Positioning',
    subject: 'sale prices, rents and comparable sales',
  },
};

/**
 * The words a rule composer uses to confine a "say this" instruction to its
 * home: "In the Infrastructure and Growth Context section — and nowhere else —".
 */
export function inHomeSection(topic: DisclosureTopic): string {
  return `In the ${DISCLOSURE_HOMES[topic].sectionName} section — and in no other section —`;
}

/** The pointer every other section may use instead of repeating the explanation. */
export function elsewhereOnly(topic: DisclosureTopic): string {
  const home = DISCLOSURE_HOMES[topic];
  return `Every other section may refer to it in a few words (for example "see ${home.sectionName}") and does not explain it again.`;
}

/** The vocabulary as the writer is shown it: every phrase, quoted, in order. */
function vocabularyList(): string {
  return PLATFORM_VOCABULARY.map((t) => `"${t.phrase}"`).join(', ');
}

/** How a source is named — the one sentence every document's rules end the vocabulary with. */
const CITE_AS_AN_ADVISER = 'Name a source the way an adviser cites it — the publisher and the product ("DFES Map of Bush Fire Prone Areas", "ABS 2021 Census") — never the system that read it.';

/** How a limitation is said, and the worked pair every document's rules show. */
const LIMITATION_RULE = [
  '- Where something could not be confirmed, say so plainly, once, and say how the client confirms it: the certificate, search, inspection or enquiry that settles it, and who provides it.',
  '  Not: "No zone was retrieved for this coordinate, so the land-use table could not be asked for."',
  '  But: "The zoning has not been confirmed. A zoning certificate from the local council settles it, and should be obtained before exchange."',
  '  Not: "No operator stop file was available for this assessment."',
  '  But: "Bus routes and service frequency should be confirmed on the operator\'s published timetable."',
] as const;

const WRITE_AS_THE_ADVISER = '- Write as the adviser: "we", "our searches", "this report". Never "the model", "the platform", "the system".';

/** The ADVISER VOICE rules, as `documentRules` hands them to the writer. */
export function adviserVoiceRules(): string {
  const homes = (Object.keys(DISCLOSURE_HOMES) as DisclosureTopic[])
    .map((k) => `${DISCLOSURE_HOMES[k].subject} → ${DISCLOSURE_HOMES[k].sectionName}`)
    .join('; ');
  return [
    '## ADVISER VOICE — how this report speaks',
    'This report is written by a property adviser for a client deciding whether to buy. Every sentence is about the property, its location, or what the client should do next.',
    '- Say what was found and what it means for the purchase, then move on.',
    `- Never describe how this report was produced. These words do not appear in it: ${vocabularyList()}. ${CITE_AS_AN_ADVISER}`,
    ...LIMITATION_RULE,
    `- A limitation is explained ONCE, in the section that owns its subject: ${homes}. Every other section may point to it in a few words and does not explain it again. That includes the Executive Verdict, the Risk Dashboard and the Final Recommendation.`,
    '- Do not re-tabulate what another section already sets out (the property\'s features, the planning controls, the population figures). Refer to it.',
    WRITE_AS_THE_ADVISER,
  ].join('\n');
}

/**
 * The same voice for a document CONDENSED from a Compass — the Executive
 * Briefing and the Snapshot.
 *
 * `documentRules` returns nothing for any tier but the Compass, and the
 * condenser's prompt carried none of this: it pasted the whole parent in as
 * source material and asked for "the same professional tone as the original".
 * So a Briefing inherited whatever its parent said, in the parent's words — and
 * every Compass written before 25 Sep 2026 says "register", "retrieved" and
 * "Not searched". A condensation is a rewrite, which is exactly where the
 * words can change and the findings cannot.
 *
 * The homes are not handed over: `DISCLOSURE_HOMES` names Compass sections a
 * Briefing does not have, and a rule naming sections the document does not
 * contain is one a model satisfies by inventing them. The rule that travels is
 * the one the homes serve — say it once, where its subject is.
 */
export function condensedVoiceRules(): string {
  return [
    '## ADVISER VOICE — how this document speaks',
    'This document is written by a property adviser for a client deciding whether to buy. Every sentence is about the property, its location, or what the client should do next.',
    `- The source material may describe how its evidence was gathered; this document never does. These words do not appear in it: ${vocabularyList()}. Say what was found and what it means for the purchase. ${CITE_AS_AN_ADVISER}`,
    ...LIMITATION_RULE,
    `- Keep the source material's distinction between a source that was checked and records nothing at the property ("${REGISTER_CHECKED_EMPTY}") and one this report does not cover ("${REGISTER_NOT_COVERED}"), in those words. The first is a finding; the second is a limitation. Neither is a clearance.`,
    '- A limitation is stated ONCE, in the section closest to its subject. A risk section may name the check that is owed in a few words; it does not explain the limitation again.',
    WRITE_AS_THE_ADVISER,
  ].join('\n');
}
