/**
 * A live web search is not a retrieval, said once for every register.
 *
 * ## The two contradictions this closes
 *
 * Both read off the Investment Compass delivered for 9 Hollow Street, Golden
 * Square on 21 Sep 2026 — the PDF, 39 pages.
 *
 * **Crime.** Page 20 tells the reader that "the latest violent-crime rate per
 * 100,000 residents is lower than the Greater Bendigo benchmark", that
 * "property-crime rates … also sit below the broader LGA averages using Crime
 * Statistics Agency Victoria data", that another tool "summarises Golden
 * Square's crime exposure as *moderate*", and that the suburb "recorded 522
 * crimes in a recent year". Pages 24, 25 and 26 say four times that **no
 * recorded-crime register is integrated for this location** and that "no crime
 * counts, rates or safety scores are held for the Golden Square area in this
 * report".
 *
 * The document's own register section says the figures on page 20 do not
 * exist. One of them is attributed to a state agency this platform never
 * asked.
 *
 * **Climate.** Page 8 and page 28 both state annual rainfall of **511.3 mm**,
 * from the SILO grid cell, with its 1991–2020 window named. Page 19 states
 * that "annual rainfall for Golden Square is reported at about **420–430 mm**"
 * and names no source at all. Two rainfall figures for one property in one
 * document, twenty per cent apart.
 *
 * ## Why the existing instructions did not stop it
 *
 * They are scoped to the TABLE and to the OUTPUT. `crimeStatBlocks`' absent
 * branch says "do NOT print a crime table, a safety score, a rating or an
 * estimated rate"; `climateStatBlocks` says "discuss only the measured figures
 * above". A model that searches obeys both and still writes the paragraph,
 * because neither says where a figure may come FROM.
 *
 * `planningFactBlocks` already learned this and fixed it in one clause — its
 * rules "override any example elsewhere in this prompt AND anything a live web
 * search returns. A portal, a listing site or a news page is not a retrieval."
 * That clause is the reason the planning section of the same document is
 * sound while the crime and climate sections are not.
 *
 * So the sentence is stated ONCE here and imported by both, because two copies
 * of one rule is how the two come to disagree — the reason `AU_LOCALE`,
 * `PLANNING_REGISTER_SECTION` and `ASSUMED_INTEREST_ONLY_YEARS` each live in
 * one module.
 *
 * ## What it is careful not to do
 *
 * It **forbids no subject**. A section may still discuss crime or climate
 * qualitatively, and must still say plainly where a register holds nothing —
 * `rentalEvidence`'s rule, which permits qualitative discussion precisely
 * because "a prohibition with no permitted action is one a model routes
 * around". What it refuses is a FIGURE, a RATE, a RATING or an ATTRIBUTION
 * that no register here produced.
 */

/**
 * The clause, parameterised by what the register in question holds.
 *
 * `subject` names the thing in the reader's words ("crime", "climate or
 * hazard"), and `register` names what would have answered, so the sentence
 * reads as a statement about this report's evidence rather than a general
 * prohibition.
 */
export function webSearchIsNotARetrieval(subject: string, register: string): string {
  return `This holds against anything a live web search returns. A ${subject}-profile site, a community `
    + `report, a news page, a listing portal or a government media release is not ${register}: a figure, a `
    + `rate, a ranking or a "low / moderate / average" reading from one of them may not be reported here, `
    + `quoted, attributed to an agency this report did not ask, or used to compare this area with another. `
    + `Discussing ${subject} qualitatively is fine; naming a figure this report did not retrieve is not, and `
    + `naming none is the correct answer.`;
}

/**
 * Every caller, so a new one cannot invent its own wording.
 *
 * `marketFactBlocks` is deliberately not here: it already carries the clause,
 * in both its branches and in its own voice — "not from a live web search, a
 * listing portal, a news article or your own knowledge" — and rewriting a rule
 * that works, to make it look like its neighbours, is a change with no reader
 * behind it. `planningFactBlocks` likewise states its own, as part of the
 * sentence that gives its rules precedence over the rest of the prompt.
 *
 * The five below are the blocks that had NONE. Two of them said "from memory",
 * which is the tell: the author was thinking about the model's own knowledge
 * and not about a model that searches.
 */
export const CRIME_WEB_SEARCH_RULE = webSearchIsNotARetrieval('crime', 'the recorded-crime register');
export const CLIMATE_WEB_SEARCH_RULE = webSearchIsNotARetrieval('climate', 'a measured reading at this property');
export const CENSUS_WEB_SEARCH_RULE = webSearchIsNotARetrieval('demographic', 'the Census tables above');
export const REGIONAL_WEB_SEARCH_RULE = webSearchIsNotARetrieval('population', 'the measured trend for this area');
export const MACRO_WEB_SEARCH_RULE = webSearchIsNotARetrieval('economic', 'the measured indicator table above');
