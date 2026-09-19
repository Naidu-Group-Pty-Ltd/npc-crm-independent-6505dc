/**
 * What the loaded index covers, measured against the AML/CTF Rules.
 *
 * ── The question this answers ─────────────────────────────────────────
 * "10,783 people across 951 offices" is a number about a database. The
 * question an operator actually has is whether the thing that just returned
 * nothing had ever looked at judges, or ambassadors, or the Chief of Navy.
 *
 * A domestic PEP under the Rules is far broader than the federal Parliament:
 * Commonwealth, State and Territory legislators; the Governor-General,
 * Governors and Administrators; High Court, Federal Court and State/Territory
 * Supreme Court judges; accountable authorities of Commonwealth entities;
 * heads of State/Territory departments; heads of local government; specified
 * senior Defence positions; and specified Australian diplomatic positions.
 *
 * This maps the office titles the index actually holds onto that vocabulary,
 * so coverage is reported against the obligation rather than against a row
 * count.
 *
 * ── Why a classifier here is safe, when one was deleted next door ─────
 * A heuristic was removed from the APH parser last week for good reason: it
 * guessed where one office title ended and the next began, and a wrong guess
 * ALTERED the data.
 *
 * This one alters nothing. It reads titles and reports; every row is stored
 * exactly as the source published it whatever this says. And the two ways it
 * can be wrong are not symmetrical, which is what makes it usable:
 *
 *   - a title it does not recognise is counted as UNCLASSIFIED and disclosed,
 *     never as absent. So every count is a FLOOR — "at least N offices" — and
 *     the prose says so;
 *   - a category with nothing recognised reads as NOT EVIDENCED, which sends
 *     the operator to check by hand. That is the safe direction: the cost is
 *     a check somebody did not strictly need.
 *
 * The unsafe direction — claiming a category is covered when it is not — is
 * the one this file exists to prevent, and it is not hypothetical. See
 * `diplomatic` below.
 */

export type PepRuleCategory =
  | "legislature"
  | "ministry"
  | "vice_regal"
  | "judiciary"
  | "public_administration"
  | "defence"
  | "diplomatic"
  | "local_government"
  | "foreign_mission_in_australia";

interface CategorySpec {
  code: PepRuleCategory;
  label: string;
  /** What the Rules mean by it, in the Rules' terms. */
  meaning: string;
  /** Declared patterns. An unrecognised title falls through to unclassified. */
  match: RegExp;
  /** A title this category must never claim, however well `match` fits. */
  exclude?: RegExp;
}

const SPECS: CategorySpec[] = [
  {
    code: "legislature",
    label: "Legislators",
    meaning: "members of the Commonwealth, State and Territory parliaments",
    match: /\b(senator|member of the (house|legislative|australian)|member for|legislative assembly|legislative council|house of representatives|speaker|president of the senate|whip)\b/i,
  },
  {
    code: "ministry",
    label: "Ministers and the ministry",
    meaning: "ministers, assistant ministers, premiers, chief ministers and "
      + "equivalent office holders",
    match: /\b(prime minister|deputy prime minister|premier|chief minister|treasurer|attorney[- ]general|minister|cabinet secretary)\b/i,
  },
  {
    code: "vice_regal",
    label: "Vice-regal offices",
    meaning: "the Governor-General, State Governors and Territory Administrators",
    match: /\b(governor[- ]general|governor of|lieutenant[- ]governor|administrator of the)\b/i,
    /*
     * "Governor of the Reserve Bank of Australia" is not a vice-regal office
     * and is in the index. It is an accountable authority — a real PEP, in a
     * different category — and counting it here would put a central banker
     * under "Governors and Administrators" on the screen.
     */
    exclude: /\breserve bank\b/i,
  },
  {
    code: "judiciary",
    label: "Judicial officers",
    meaning: "High Court, Federal Court and State and Territory Supreme Court "
      + "judges, and equivalent judicial office",
    match: /\b(chief justice|justice of|judge|magistrate|coroner)\b/i,
    /*
     * A Justice of the Peace is not a judicial officer in the sense the Rules
     * mean, and South Australia's is in the index. Counting it would inflate
     * the one category where an inflated count is most consequential.
     */
    exclude: /\bjustice of the peace\b/i,
  },
  {
    code: "public_administration",
    label: "Heads of departments and agencies",
    meaning: "accountable authorities of Commonwealth entities and heads of "
      + "State and Territory departments",
    match: /\b(secretary of the department|director[- ]general|auditor[- ]general|ombudsman|commissioner of|chief executive of|public service commissioner|solicitor[- ]general)\b/i,
  },
  {
    code: "defence",
    label: "Senior Defence positions",
    meaning: "the specified senior Defence positions named in the Rules",
    match: /\b(chief of (the )?(defence force|navy|army|air force|joint operations)|vice chief of|chief of defence)\b/i,
  },
  {
    /*
     * ── THE ONE THAT WOULD HAVE BEEN WRONG ────────────────────────────
     * The Rules mean AUSTRALIAN diplomatic positions — an Australian
     * ambassador or high commissioner posted overseas.
     *
     * Measured against production: the index holds 16 offices whose title
     * contains "ambassador", "high commissioner" or "consul". FIFTEEN of them
     * are of the form `ambassador of Botswana to Australia` — foreign envoys
     * posted HERE, which is the opposite of the category. The sixteenth is a
     * bare "high commissioner" with no direction stated. Australian
     * diplomatic positions abroad: ZERO.
     *
     * A keyword classifier would have reported "diplomatic: 16 offices", and
     * an operator would reasonably have concluded that Australian ambassadors
     * were searched. They were not, and none of them is in the index at all.
     * That is the overstated-coverage failure this index already shipped once,
     * arriving through a different door.
     *
     * So the direction is part of the match, and the foreign envoys are their
     * own category below rather than being silently folded into this one or
     * silently dropped.
     */
    code: "diplomatic",
    label: "Australian diplomatic positions",
    meaning: "Australian ambassadors, high commissioners and consuls-general "
      + "posted overseas",
    match: /\baustralian (ambassador|high commissioner|consul)|(ambassador|high commissioner|consul[- ]general) (of|for) australia\b/i,
    exclude: /\bto australia\b/i,
  },
  {
    code: "foreign_mission_in_australia",
    label: "Foreign missions accredited to Australia",
    /*
     * Not a domestic category, and kept because it is a real PEP category
     * pointing the other way: a foreign ambassador in Canberra is a FOREIGN
     * PEP, which the Rules treat more strictly than a domestic one. Reporting
     * it under its own name is the only way it neither overstates Australian
     * diplomatic coverage nor disappears.
     */
    meaning: "ambassadors, high commissioners and consuls accredited TO "
      + "Australia — a foreign PEP category, not an Australian one",
    /*
     * `ambassadors?` — plural included. Wikidata's Australian office set
     * contains `list of ambassadors of China to Australia`, a list page
     * modelled as a position, and a singular-only pattern silently dropped
     * it into unclassified. Not consequential on its own; the point is that
     * a title in a real register is whatever the register happens to say.
     */
    match: /\b(ambassadors?|high commissioners?|consuls?)\b.*\bto australia\b/i,
  },
  {
    code: "local_government",
    label: "Heads of local government",
    meaning: "mayors, lord mayors and shire presidents",
    /*
     * HEADS of local government, which is what the Rules name. Aldermen,
     * councillors and "member of X City Council" are in the index in numbers
     * and are deliberately NOT counted here: a councillor is not a head, and
     * folding them in would turn a category the Rules define narrowly into a
     * count of everyone who ever sat on a council.
     */
    match: /\b(lord mayor|mayor of|mayor|shire president|council president)\b/i,
  },
];

/**
 * Which Rule category an office title falls in, or null.
 *
 * First declared match wins, and the order above is deliberate: a title like
 * "Minister for Defence" is ministry, not defence, and "Attorney-General" is
 * ministry rather than judiciary. An office genuinely spanning two is counted
 * once, under the first — these are coverage floors, not a census.
 */
export function classifyOffice(title: string): PepRuleCategory | null {
  const t = String(title ?? "").trim();
  if (!t) return null;
  for (const spec of SPECS) {
    if (spec.exclude?.test(t)) continue;
    if (spec.match.test(t)) return spec.code;
  }
  return null;
}

export interface PepRuleCoverage {
  code: PepRuleCategory;
  label: string;
  meaning: string;
  /** A FLOOR. Offices whose titles this recognised — never a total. */
  officeCount: number;
  sampleOffices: string[];
  /**
   * Nothing in the loaded index was recognised as this category.
   *
   * Reported as "not evidenced" rather than "not covered", because an
   * unrecognised title is indistinguishable from an absent one and the
   * honest reading is that this index cannot show it looked.
   */
  notEvidenced: boolean;
}

export interface PepRuleCoverageSummary {
  categories: PepRuleCoverage[];
  /** Offices no category recognised. Disclosed, never hidden. */
  unclassifiedCount: number;
  unclassifiedSamples: string[];
  totalOffices: number;
}

/** Summarise a set of office titles. Pure; the loader supplies the titles. */
export function summariseRuleCoverage(offices: Iterable<string>): PepRuleCoverageSummary {
  const buckets = new Map<PepRuleCategory, string[]>();
  const unclassified: string[] = [];
  let total = 0;

  for (const raw of offices) {
    const title = String(raw ?? "").trim();
    if (!title) continue;
    total += 1;
    const code = classifyOffice(title);
    if (!code) { unclassified.push(title); continue; }
    const list = buckets.get(code) ?? [];
    list.push(title);
    buckets.set(code, list);
  }

  const categories = SPECS.map((spec) => {
    const hits = (buckets.get(spec.code) ?? []).slice().sort();
    return {
      code: spec.code,
      label: spec.label,
      meaning: spec.meaning,
      officeCount: hits.length,
      sampleOffices: hits.slice(0, 6),
      notEvidenced: hits.length === 0,
    };
  });

  return {
    categories,
    unclassifiedCount: unclassified.length,
    unclassifiedSamples: unclassified.slice(0, 6),
    totalOffices: total,
  };
}

/**
 * The sentence that goes beside a count.
 *
 * Every one of them says "at least", and none of them can be paraphrased into
 * a statement about a person. A category with coverage is still only a
 * statement that the index held offices of that kind — not that the customer
 * was cleared against them.
 */
export function describeRuleCoverage(c: PepRuleCoverage): string {
  if (c.notEvidenced) {
    return `No office of this kind was recognised in the loaded index, so `
      + `this cannot be shown to have been searched. Check ${c.meaning} by hand.`;
  }
  return `At least ${c.officeCount.toLocaleString("en-AU")} office`
    + `${c.officeCount === 1 ? "" : "s"} of this kind are loaded. That is what `
    + "was searched, not a statement about anybody.";
}
