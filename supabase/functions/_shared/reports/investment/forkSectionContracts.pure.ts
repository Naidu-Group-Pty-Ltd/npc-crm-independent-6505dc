/**
 * What a forked section is allowed to hold, decided from its body.
 *
 * The fork routes the composite's sections into the Financial and Due
 * Diligence variants by HEADING, and three of its contracts were promises
 * the routing could not keep (audit QA-291SM, 15 Sep 2026):
 *
 *  - QA-31: the risk-dashboard route targets both variants "verbatim" with a
 *    note that "FIN keeps financial rows, PLDD keeps property/location rows"
 *    — and nothing filtered a row. The Financial report's "Financial Risk
 *    Dashboard" opened with "this register summarises the main NON-financial
 *    risks" and listed crime, bushfire and planning checks.
 *  - QA-27: the socioeconomic route retitles the demographics section
 *    "Socioeconomic Profile & SEIFA Interpretation" whether or not a SEIFA
 *    index was ever supplied; the audited Strategic report carried the
 *    heading and no index, decile, year or geography.
 *  - QA-32: the Due Diligence "Property & Location Risk Dashboard" held a
 *    checklist of things to do, not a dashboard of assessed risks.
 *
 * Each rule here reads the BODY and answers with the heading and the lines a
 * variant may print. Nothing is invented: an entry nobody can classify goes
 * to both variants rather than to neither, a checklist is named as one, and
 * an absent index is stated as absent.
 *
 * Deno-compatible: no imports.
 */

export type RiskVariant = 'financial' | 'due_diligence';

/** Vocabulary that marks a risk entry as belonging to the money side. */
const FINANCIAL_RISK = /\b(interest|rate|cash ?flow|yield|rents?|rental|vacanc|servic|lvr|leverag|loan|repay|debt|borrow|liquidit|exit|resale|valuation|price|pricing|afford|tax|deprec|fund|capital|equity|holding|expense|cost|insurance premium|market)\w*/i;
/**
 * Vocabulary that marks a risk entry as belonging to the property and its
 * locality.
 *
 * The crime words are here because the register does not write "crime" when it
 * breaks crime down. Measured 19 Sep 2026 over every risk register in the
 * stored Compass corpus — 3 documents, 24 distinct entry names — exactly two
 * fell through to `both` for want of them: `Offence mix (theft, assault,
 * property damage)` and `Drug-related offences`. `both` sends an entry to both
 * variants, which is the right default for something nobody can classify and
 * the wrong answer for these: the Financial Analysis then opens its risk
 * register with a crime row, one page under a composed sentence saying
 * "Property and locality risks (crime, environmental, planning, condition) …
 * are not restated here". That is QA-31 surviving in the one shape the
 * classifier could not see.
 *
 * Only unambiguous offence nouns are added. None of them can appear in a
 * financial risk entry, and none collides with `FINANCIAL_RISK`, so the two
 * crime rows are the whole blast radius — re-measured after the change, the
 * fall-through set is `Supply and market concentration` (genuinely both),
 * `Data gaps …` (about the record, not the money or the place) and the
 * checklist handled below.
 */
const PROPERTY_RISK = /\b(crime|safety|offence|offense|theft|assault|burglar|break-?in|robber|vandal|stolen|violent|environment|bushfire|fire|flood|climate|planning|zoning|overlay|covenant|easement|title|strata|body corporate|building|pest|condition|structur|defect|transport|infrastructure|supply|pipeline|school|amenit|demograph|tenant demand|heritage|contaminat|noise|access|physical|estate|construction|developer)\w*/i;

export type RiskClass = 'financial' | 'property' | 'both';

/** Which variant an entry belongs to, read from its name. Unclassifiable → both. */
export function classifyRiskEntry(name: string): RiskClass {
  const fin = FINANCIAL_RISK.test(name);
  const prop = PROPERTY_RISK.test(name);
  if (fin && !prop) return 'financial';
  if (prop && !fin) return 'property';
  return 'both';
}

interface RiskEntry { name: string; lines: string[]; cls: RiskClass }

/** A line that opens an entry inside a block: a bold-led line or a "Name - Level: …" line. */
const INNER_ENTRY = /^(?:\*\*([^*]+)\*\*.*$|(.+?)\s+[-–—:]\s*Level\s*:.*$)/i;
const SUB_HEADING = /^#{3,5}\s+(.+?)\s*$/;

const innerEntryName = (line: string): string | null => {
  const m = INNER_ENTRY.exec(line.trim());
  return m ? (m[1] ?? m[2] ?? '').trim() : null;
};

interface RiskGroup {
  /** The `###` line, when the block had one. */
  heading: string | null;
  /** Prose between the heading and the first entry. */
  preamble: string[];
  entries: RiskEntry[];
}

/**
 * Blocks by `###`. A block whose body carries inner entries (bold-led or
 * "Level:" lines, table rows) is a GROUP and its heading is a label; a block
 * with none is one ENTRY named by its heading — both shapes are written.
 */
function parseRegister(body: string): { groups: RiskGroup[]; tableHead: string[] } {
  const lines = body.replace(/\r/g, '').split('\n');
  const tableHead: string[] = [];
  const blocks: Array<{ heading: string | null; lines: string[] }> = [{ heading: null, lines: [] }];
  for (const raw of lines) {
    const h = SUB_HEADING.exec(raw.trim());
    if (h) { blocks.push({ heading: raw, lines: [] }); continue; }
    blocks[blocks.length - 1].lines.push(raw);
  }

  const groups: RiskGroup[] = [];
  for (const block of blocks) {
    const preamble: string[] = [];
    const entries: RiskEntry[] = [];
    let current: RiskEntry | null = null;
    for (const raw of block.lines) {
      const t = raw.trim();
      if (t.startsWith('|')) {
        const cells = t.split('|').slice(1, -1).map((c) => c.trim());
        const isDelimiter = cells.every((c) => /^:?-{3,}:?$/.test(c));
        if (tableHead.length < 2 && (tableHead.length === 0 || isDelimiter)) { tableHead.push(raw); continue; }
        entries.push({ name: cells[0] ?? '', lines: [raw], cls: classifyRiskEntry(cells[0] ?? '') });
        current = null;
        continue;
      }
      const name = innerEntryName(raw);
      if (name) { current = { name, lines: [raw], cls: classifyRiskEntry(name) }; entries.push(current); continue; }
      if (current) current.lines.push(raw);
      else preamble.push(raw);
    }
    if (block.heading && !entries.length) {
      // The heading names the entry and the block is its body.
      const name = SUB_HEADING.exec(block.heading.trim())![1];
      if (preamble.join('').trim()) {
        groups.push({ heading: null, preamble: [], entries: [{ name, lines: [block.heading, ...preamble], cls: classifyRiskEntry(name) }] });
      } else {
        groups.push({ heading: block.heading, preamble: [], entries: [] });
      }
      continue;
    }
    groups.push({ heading: block.heading, preamble, entries });
  }
  return { groups, tableHead };
}

export interface RiskRegisterSplit {
  body: string;
  kept: string[];
  dropped: string[];
  /** Entries whose name matched neither vocabulary, so both variants print them. */
  unclassified: string[];
  /** Whether the body was recognisably a register (had at least one entry). */
  recognised: boolean;
}

/**
 * The lines of a risk register a variant may print.
 *
 * Entries are recognised in the shapes the corpus writes: sub-headed blocks,
 * bold-led blocks, "Name - Level: X - Confidence: Y" lines with their
 * bullets, and table rows (whose header and delimiter are kept for both). A
 * group's preamble — the prose between a label and its first entry, such as
 * "this register summarises the main non-financial risks" — stays with the
 * Due Diligence variant only; the Financial variant's lead is composed from
 * the record, and a sentence describing somebody else's list must not open
 * it.
 */
export function splitRiskRegister(body: string, variant: RiskVariant): RiskRegisterSplit {
  const { groups, tableHead } = parseRegister(body);
  const wanted: RiskClass = variant === 'financial' ? 'financial' : 'property';
  /*
   * An entry nobody can classify goes to BOTH variants rather than to
   * neither — except where its own body says what it is. A list of things to
   * do before contract is not an assessed risk at all, so "unclassifiable"
   * is the wrong reading of it: measured, `Due Diligence Actions` fell
   * through on that rule and put seven planning, flood, bushfire and title
   * actions into the Financial Analysis, one page under the composed
   * sentence saying property and locality risks are not restated there. A
   * checklist whose subject IS financial still carries financial vocabulary
   * in its name and is classified before this is reached, so only the
   * genuinely unclassifiable one is moved.
   */
  const admits = (e: RiskEntry) => {
    if (e.cls === wanted) return true;
    if (e.cls !== 'both') return false;
    return variant === 'due_diligence' || !readAsChecklist(e.lines.join('\n')).isChecklist;
  };
  const kept: string[] = [];
  const dropped: string[] = [];
  const unclassified: string[] = [];
  const out: string[] = [];
  let recognised = false;

  for (const g of groups) {
    recognised = recognised || g.entries.length > 0;
    const blocks = g.entries.filter((e) => !e.lines[0].trim().startsWith('|'));
    const rows = g.entries.filter((e) => e.lines[0].trim().startsWith('|'));
    const keptBlocks = blocks.filter(admits);
    const keptRows = rows.filter(admits);
    for (const e of g.entries) if (!admits(e)) dropped.push(e.name);
    if (!keptBlocks.length && !keptRows.length) {
      // The section's own lead — prose before any sub-heading or entry — is
      // the Due Diligence variant's to keep: it opens the register as the
      // analysis wrote it. The Financial variant's lead is composed.
      if (variant === 'due_diligence' && !g.heading && g.preamble.join('').trim()) out.push(...g.preamble);
      continue;
    }
    if (g.heading) { if (out.length) out.push(''); out.push(g.heading); }
    if (variant === 'due_diligence' && g.preamble.join('').trim()) out.push(...g.preamble);
    for (const e of keptBlocks) {
      kept.push(e.name);
      if (e.cls === 'both') unclassified.push(e.name);
      if (out.length && out[out.length - 1].trim() !== '' && !e.lines[0].trim().startsWith('#')) out.push('');
      out.push(...e.lines);
    }
    if (keptRows.length) {
      if (out.length && out[out.length - 1].trim() !== '') out.push('');
      out.push(...tableHead);
      for (const e of keptRows) {
        kept.push(e.name);
        if (e.cls === 'both') unclassified.push(e.name);
        out.push(...e.lines);
      }
    }
  }

  return {
    body: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + (out.length ? '\n' : ''),
    kept, dropped, unclassified, recognised,
  };
}

/** A SEIFA index with a figure beside it — a name alone is a mention, not evidence. */
const SEIFA_EVIDENCE = /\b(SEIFA|IRSAD|IRSD|IEO|IER)\b[^\n]{0,80}?\b\d{1,4}\b|\b\d{1,2}\s*\/\s*10\b|\bdecile\s+\d{1,2}\b/i;

export const SEIFA_UNAVAILABLE_LINE =
  '_SEIFA indexes (IRSAD, IRSD, IEO, IER) are not held for this report: the profile below is qualitative and states no index score, decile, reference year or geography. Treat any tenant-quality inference as a hypothesis, not a measured fact._';

/**
 * The heading the socioeconomic section may carry, and the line that must
 * precede its body when the index it is named for is absent (QA-27).
 */
export function socioeconomicContract(body: string, headingWithSeifa: string): { heading: string; lead: string | null } {
  if (SEIFA_EVIDENCE.test(body)) return { heading: headingWithSeifa, lead: null };
  return {
    heading: headingWithSeifa.replace(/\s*(?:&|and)\s*SEIFA Interpretation\s*$/i, '').trim() || headingWithSeifa,
    lead: SEIFA_UNAVAILABLE_LINE,
  };
}

/** A bullet that tells the reader to do something, rather than stating an assessed fact. */
const IMPERATIVE_BULLET = /^[-•*]\s+(?:obtain|request|review|ask|confirm|check|commission|verify|use|conduct|engage|arrange|inspect|compare|consult|order|read|seek|walk|visit|clarify|ensure|investigate|complete|apply|contact)\b/i;
const ASSESSED_ENTRY = /\bLevel\s*:|\bExposure\s*:|\bRating\s*:|\|\s*(?:Low|Moderate|Medium|High)\s*\|/i;

export interface DashboardContract {
  heading: string;
  /** A status line for a checklist; null for a dashboard of assessed risks. */
  status: string | null;
  isChecklist: boolean;
  checks: number;
}

/**
 * Whether a body is a list of work to do rather than a statement of assessed
 * risk: three or more bullets, most of them imperative, and nothing rated.
 *
 * One implementation, because two places ask it — the section contract that
 * renames a dashboard (QA-32) and the register split below, which must decide
 * whether an unclassifiable ENTRY is a checklist.
 */
function readAsChecklist(body: string): { isChecklist: boolean; imperative: number } {
  const bullets = body.split('\n').map((l) => l.trim()).filter((l) => /^[-•*]\s+/.test(l));
  const imperative = bullets.filter((l) => IMPERATIVE_BULLET.test(l)).length;
  const assessed = ASSESSED_ENTRY.test(body);
  return { isChecklist: !assessed && bullets.length >= 3 && imperative / bullets.length >= 0.6, imperative };
}

/**
 * A section is named for what it holds (QA-32): a body that lists work to do
 * is a checklist and says so, with its completion status, rather than a
 * dashboard of assessed risks. A body carrying rated entries keeps the
 * dashboard heading.
 */
export function riskDashboardContract(body: string, dashboardHeading: string, checklistHeading: string): DashboardContract {
  const { isChecklist, imperative } = readAsChecklist(body);
  if (!isChecklist) return { heading: dashboardHeading, status: null, isChecklist: false, checks: 0 };
  return {
    heading: checklistHeading,
    status: `_Status: ${imperative} check${imperative === 1 ? '' : 's'} outstanding before contract. Each is an action for the buyer and their advisers; the list records no outcome and is not an assessment of the risks themselves._`,
    isChecklist: true,
    checks: imperative,
  };
}
