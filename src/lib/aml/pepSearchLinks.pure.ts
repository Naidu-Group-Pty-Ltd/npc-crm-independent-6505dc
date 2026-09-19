/**
 * The searches a PEP determination is actually made from.
 *
 * ── What this is, and what it is emphatically not ─────────────────────
 * It builds SEARCH URLS. It performs no request, reads no result, and
 * decides nothing. An operator opens a source, looks, and records what they
 * found; this only removes the two minutes of typing a name into four
 * different sites and the risk of searching a different spelling in each.
 *
 * That distinction is the compliance point, not a disclaimer. Nothing here
 * can return "no match", because nothing here matches anything — and a
 * partial index reporting "no match" is precisely the confident-clear-against-
 * nothing failure this platform has already had once, with an empty sanctions
 * table.
 *
 * ── Why these sources ─────────────────────────────────────────────────
 * AUSTRAC's own guidance names internet and government-source research as an
 * acceptable way to establish PEP status, and points at the Australian
 * Government Directory for domestic office holders. These are those sources,
 * plus the parliamentary registers, which are the elected limb the Directory
 * does not carry.
 *
 * All of them are public. None requires a licence to consult. The one
 * "specialist PEP database" row is deliberately left as a manual entry: this
 * product has no such subscription, and pretending otherwise in a dropdown
 * would invite an operator to tick a source they never used.
 */
import type { PepSourceKind } from "./pepEvidence";

export interface PepSearch {
  /** Stable id, used to pair a search with the row it fills in. */
  id: string;
  label: string;
  /** What the operator will be looking at. One line. */
  purpose: string;
  kind: PepSourceKind;
  /** The URL to open. Always a search page — never an assertion. */
  url: string;
  /** Exactly what is being searched, recorded verbatim in the evidence. */
  searchTerms: string;
  /** Australian domestic sources first; a foreign PEP is not found here. */
  coverage: "domestic" | "general";
  /**
   * An official REGISTER, or a general web search.
   *
   * The distinction is rendered, because they are not the same kind of
   * evidence. A register is published by the body that maintains the office;
   * a web search is a starting point whose result depends on the day, the
   * engine and the operator's wording. AUSTRAC accepts internet research —
   * it is not the same as saying a search engine is a source of record.
   */
  tier: "register" | "open_web";
}

/** Trimmed, de-duplicated, non-empty names to search on. */
export function searchNames(
  name: string | null | undefined,
  aliases: ReadonlyArray<string | null | undefined> = [],
): string[] {
  const all = [name, ...aliases]
    .map((n) => String(n ?? "").trim())
    .filter((n) => n.length > 1);
  return [...new Set(all)];
}

const enc = (s: string) => encodeURIComponent(s);

/**
 * The searches to offer for one subject.
 *
 * The primary name drives the URLs; aliases are carried in `searchTerms` so
 * the record shows every spelling the operator was asked to consider, even
 * where a site takes only one query at a time.
 */
export function buildPepSearches(args: {
  name: string | null | undefined;
  aliases?: ReadonlyArray<string | null | undefined>;
  /** The jurisdiction the customer declared, when they declared one. */
  jurisdiction?: string | null;
}): PepSearch[] {
  const names = searchNames(args.name, args.aliases ?? []);
  if (names.length === 0) return [];
  const primary = names[0];
  const terms = names.join(" · ");
  const jurisdiction = String(args.jurisdiction ?? "").trim();

  const searches: PepSearch[] = [
    {
      id: "directory_gov_au",
      label: "Australian Government Directory",
      purpose: "Commonwealth office holders, senior officials and government board "
        + "appointments.",
      kind: "government_directory",
      /*
       * `?keywords=…&op=Search`. This was `/search/node?keys=…`, a Drupal 7
       * path the site no longer serves — every operator who followed it got
       * "Page not found" from the most authoritative source on the list.
       * Confirmed against the live site's own search URLs.
       */
      url: `https://www.directory.gov.au/search?keywords=${enc(primary)}&op=Search`,
      searchTerms: terms,
      coverage: "domestic",
      tier: "register",
    },
    {
      id: "aph_members",
      label: "Parliament of Australia — senators and members",
      /*
       * This is also where a candidate from the office-holder index is
       * confirmed: the index is loaded from Parliament's own published
       * register, and every APH row's `confirm_url` points back here. It
       * stays on the manual list because the index holds only who sits
       * TODAY — a former member is not in it, and this search reaches
       * further than the file does.
       */
      purpose: "Senators and members currently sitting, and the place to confirm a "
        + "candidate the index returned.",
      kind: "parliamentary_register",
      url: "https://www.aph.gov.au/Senators_and_Members/Parliamentarian_Search_Results"
        + `?q=${enc(primary)}`,
      searchTerms: terms,
      coverage: "domestic",
      tier: "register",
    },
    {
      id: "abn_lookup",
      label: "ABN Lookup — business and office holders",
      purpose: "Entities the subject is associated with, which often name the office "
        + "they hold.",
      kind: "official_register",
      url: `https://abr.business.gov.au/Search/ResultsActive?SearchText=${enc(primary)}`,
      searchTerms: terms,
      coverage: "domestic",
      tier: "register",
    },
    {
      id: "parlinfo",
      label: "ParlInfo — the parliamentary record",
      purpose: "Hansard, committee papers and tabled documents naming the subject. The "
        + "official record rather than a report of it.",
      kind: "parliamentary_register",
      url: "https://parlinfo.aph.gov.au/parlInfo/search/summary/summary.w3p;query="
        + enc(primary),
      searchTerms: terms,
      coverage: "domestic",
      tier: "register",
    },
    /*
     * ── One general web search, and it is labelled as one ────────────────
     * AUSTRAC's guidance accepts internet research, and it is genuinely the
     * only route to a foreign office or a family connection no register
     * publishes. But it is not a register, and the list used to end with two
     * DuckDuckGo rows sitting beside DFAT and Parliament as though they were
     * peers — which is how a screening ends up resting on whatever a search
     * engine happened to return that morning.
     *
     * So: one row, `open_web`, rendered separately and after the registers.
     */
    {
      id: "open_source",
      label: "General web search",
      purpose: "A starting point for a public office, appointment or political role "
        + "that no register above publishes. Not a source of record.",
      kind: "open_source",
      url: "https://www.google.com/search?q="
        + enc(`"${primary}" (minister OR "member of parliament" OR judge OR ambassador `
          + `OR "chief executive" OR board OR government)${jurisdiction ? ` ${jurisdiction}` : ""}`),
      searchTerms: `${terms} + public office terms`
        + (jurisdiction ? ` (jurisdiction: ${jurisdiction})` : ""),
      coverage: "general",
      tier: "open_web",
    },
  ];

  return searches;
}

/**
 * What these searches do NOT reach.
 *
 * Rendered beside them, every time, deliberately. An operator who has run
 * five searches and found nothing needs to know which parts of the definition
 * those searches never covered — otherwise "nothing found" quietly becomes
 * "nobody is exposed", which is the failure mode this whole stage is built
 * to prevent.
 */
export const PEP_SEARCH_COVERAGE_GAPS = [
  "Foreign office holders are not comprehensively covered by these sources. "
    + "The customer's declaration is the primary evidence for overseas exposure.",
  "Immediate family members and close associates are not published anywhere. "
    + "They are reached by asking, not by searching.",
  "Somebody who has LEFT a position may not appear in a current directory.",
] as const;
