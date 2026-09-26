/**
 * Compass QA Validator — Phase 7
 * -------------------------------
 * Runs structural QA on a generated report's markdown. Used by:
 *   • generate-investment-report (recorded on the report row)
 *   • condense-investment-report (returns assertions in response)
 *   • Deno tests (compassPostProcessor_test.ts)
 *   • Frontend QA panel (mirror in src/lib/reports/)
 *
 * ## A tier it does not know is a tier it must not judge
 *
 * It took two tier values and `condense-investment-report` called it with
 * `'compass-40'` for a Briefing and for a Snapshot — neither of which is a
 * Compass. Every condensation therefore logged and returned a report that
 * could not pass: a page band for a 40-page document over a 12-page tier,
 * eleven `financial-exclusion` errors on the financial chapters the
 * condensation DELIBERATELY attaches, and four to six
 * `missing-protected-section` errors naming Compass sections a condensed tier
 * never declares. Sixteen errors on a correct Briefing, every run. It blocks
 * nothing, which is what made it the familiar fault: a check that always
 * fails can never report a true one.
 *
 * The rules divide more cleanly than that call implied. Most of them are
 * about a REPORT rather than about a tier — no unresolved placeholder, no
 * score the record does not hold, no editorial label, no duplicate heading,
 * no promise of a table with no table — and every one of those is exactly
 * what you want asserted on a condensed document. Only three are tier-bound,
 * and two were already guarded.
 *
 * So the condensed tiers are admitted and the three tier-bound rules answer
 * to what each tier actually declares. **A tier with no declared page band
 * gets no page-band finding**: a Briefing's length is governed by the
 * registry trim and the post-processor's word caps, and inventing a band for
 * it would be a threshold nobody measured. **A tier with no section registry
 * runs no per-section check**, for the same reason — the condensed tiers
 * declare their headings in `sectionRegistry.pure.ts` and no word caps in
 * this shape.
 *
 * Checks:
 *   1. Page band: Compass 20–26, Financial 18–22, condensed tiers none
 *   2. Financial content exclusion from Compass (no yield/LVR/cashflow tables)
 *   2b. No unresolved placeholders
 *   2c. No editorial commentary label survives, in any form
 *   3. Suburb-narrative exclusion from Financial Analysis
 *   4. Duplicate H2 heading detection
 *   6. Protected sections present
 *   7. Per-section word-cap compliance
 *   8. Sub-heading density per section
 *
 * A finding is a report of fact, never a reason to discard a document. The
 * generator records this and stores the report either way: a report that exists
 * and is over its band is more useful to everyone than no report at all.
 */

import {
  COMPASS_40_SECTIONS,
  FINANCIAL_ANALYSIS_SECTIONS,
  COMPASS_PAGE_BAND,
  PROTECTED_SECTION_IDS,
  compassSections,
  type CompassSectionDefinition,
} from './compassSectionRegistry.ts';
import { countWords, estimatePages, findEditorialLabels } from './compassPostProcessor.ts';
import { findScoreClaims } from './reports/investment/scoreClaims.pure.ts';
import {
  findPortalCitations,
  findPortalSourcedClearances,
  findUnpublishedHorizons,
  PORTAL_SOURCE_RE,
} from './reports/investment/evidenceClaims.pure.ts';
import { findDocumentContradictions } from './reports/investment/documentConsistency.pure.ts';
import { findFiguresWithoutABasis } from './reports/investment/evidenceClaims.pure.ts';
import { promotePipedPseudoTables } from './reports/investment/pseudoTables.pure.ts';
import { platformVocabularyCount, platformVocabularyIn } from './reports/adviserVoice.pure.ts';
import {
  SECTION_REGISTRY as CANONICAL_SECTIONS,
  sectionIdForHeading,
  type ReportTier,
} from './reports/investment/sectionRegistry.pure.ts';
import {
  RISK_REGISTER_CELL_MAX_WORDS,
  RISK_REGISTER_COLUMNS,
  findOverlongRegisterCells,
  hasRiskRegister,
} from './reports/investment/riskRegister.pure.ts';

/**
 * The prompt asks for at most 4 `###` a section; this flags at 6+.
 *
 * One of tolerance, deliberately: QA reports on a document that already exists
 * and a section that runs to a fifth sub-head is not a defect worth a finding.
 * v2.0 produced 68 `###` a report across 17 sections; 4 a section over 11 is ~44.
 */
const MAX_SUBHEADINGS_PER_SECTION = 5;

/** A sentence that introduces a table or matrix said to follow it. */
const TABLE_PROMISE = /\b(?:table|matrix|grid|schedule)\s+(?:below|that follows|following)\b|\bbelow\s+(?:table|matrix)\b|\b(?:summari[sz]ed|set out|shown|listed|presented)\s+(?:in\s+the\s+)?(?:table|matrix)\s+below\b/i;
/** A heading or bold label naming a pair of lists. */
const PAIR_HEADING = /^(?:#{2,4}\s+|\*\*)?strengths?\s*(?:and|&)\s*(?:limitations?|weaknesses|considerations|watch[- ]?points)\b/i;
/** The second half of that pair, as a sub-heading or a bold label. */
const PAIR_SECOND_LABEL = /^(?:#{3,5}\s+|\*\*)?(?:limitations?|weaknesses|considerations|watch[- ]?points)\b\*{0,2}:?\s*$/i;
/**
 * The same label as a RUN-IN lead, with its content on the same line —
 * `**Watch points:** single bathroom; 1979 construction`. It carries the
 * second list, and reading only a label on a line of its own reported that
 * list as missing on a section that had written it.
 */
const PAIR_SECOND_LEAD_IN = /^(?:[-*+]\s+)?(?:\*\*)?(?:limitations?|weaknesses|considerations|watch[- ]?points)\b\*{0,2}\s*:\s*\*{0,2}\s*\S/i;


/**
 * The tiers this may be asked about.
 *
 * `briefing` and `snapshot` are the condensed tiers. They are admitted so the
 * condense path can name what it is producing instead of borrowing a
 * Compass's rules; see the note at the head of this file.
 */
/**
 * The tiers this validator may judge.
 *
 * `strategic` joined them when `fork-investment-report` started validating its
 * composed children (18 Sep 2026) — and the fork first passed `'financial'`
 * and `'strategic'`, neither of which is a member: the financial tier is
 * spelled `financial-analysis`, and the Due Diligence document had no name
 * here at all. `deno check` caught both; the repository's `tsc` cannot see
 * `supabase/functions`, which is why that gate exists.
 *
 * `strategic` deliberately declares **no page band and no section registry**,
 * which is the treatment the condensed tiers already get and is this file's own
 * rule: *a tier it does not know is a tier it must not judge*. What still
 * applies to a Due Diligence document is every rule that is about a REPORT —
 * no unresolved placeholder, no score the record does not hold, no editorial
 * label, no duplicate heading, no promised table with no table, no hazard
 * clearance on a listing's authority, no delivery horizon nobody published —
 * and those are exactly the rules the fork needed, because it routes the
 * parent's prose into two documents and used to check neither.
 */
export type QATier = 'compass-40' | 'financial-analysis' | 'briefing' | 'snapshot' | 'strategic';

export type QASeverity = 'error' | 'warning' | 'info';

export interface QAFinding {
  rule: string;
  severity: QASeverity;
  message: string;
  sectionId?: string;
}

export interface QAReport {
  tier: QATier;
  estimatedPages: number;
  wordCount: number;
  passed: boolean;
  findings: QAFinding[];
}

/**
 * The ANALYSIS of a purchase, which the Compass does not carry.
 *
 * Not the price and not the rent. TIER_FRAMEWORK.md Decision E (17 Sep 2026):
 * "Withholding the modelling is not withholding the price … the asking price
 * and the indicative rent are facts about the asset in the way its land size
 * is. What leaves the Compass is the analysis of a PURCHASE — yield, LVR, loan
 * structure, cash flow, sensitivity, the ten-year series." `/weekly rent/` and
 * `/purchase price/` predated that decision and kept reporting the facts it
 * keeps as errors — 9 Hollow Street, 24 Sep 2026, two `financial-exclusion`
 * errors on a Compass stating its own price and rent. A check that fires on
 * what the tier is meant to say cannot report what it is meant not to.
 */
const FINANCIAL_KEYWORDS = [
  /\bgross yield\b/i,
  /\bnet yield\b/i,
  /\brental yield\b/i,
  /\bLVR\b/,
  /\bLMI\b/,
  /\bP&I\b/,
  /\bstamp duty\b/i,
  /\bloan amount\b/i,
  /\bmonthly repayment/i,
  /\bannual repayment/i,
  /\binterest rate sensitivity\b/i,
  /\b10[- ]year (cashflow|projection|cash contribution)/i,
  /\bsensitivity analysis\b/i,
  /\bafter[- ]tax cashflow\b/i,
  /\bnegative cashflow\b/i,
  /\bnegative gearing\b/i,
  /\bdepreciation schedule\b/i,
  /\bcumulative cashflow\b/i,
  /\bequity after\s+\d+\s+years?\b/i,
  /\bcapital growth (assumption|rate)\b/i,
];

/** Protected sections the generator writes — the ones a Compass must carry. */
export const REQUIRED_PROTECTED_SECTION_IDS: ReadonlySet<string> = new Set(
  compassSections().map((s) => s.id).filter((id) => PROTECTED_SECTION_IDS.has(id)),
);

const FORBIDDEN_PLACEHOLDERS = [
  /\[citation\]/i,
  /\[source\s+needed\]/i,
  /\[TBD\]/i,
  /\bcitation needed\b/i,
];

const SUBURB_KEYWORDS = [
  /\bSEIFA\b/,
  /\bschool catchment\b/i,
  /\bcrime statistics\b/i,
  /\bflood (zone|risk)\b/i,
  /\bbushfire\b/i,
  /\bdemograph/i,
  /\binfrastructure pipeline\b/i,
  /\bzoning overlay\b/i,
];

function parseH2(markdown: string): string[] {
  const matches = markdown.match(/^##\s+(.+?)\s*$/gm) ?? [];
  return matches.map((m) => m.replace(/^##\s+/, '').trim());
}

function normalize(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findDef(heading: string, registry: readonly CompassSectionDefinition[]) {
  const target = normalize(heading);
  return registry.find(
    (s) =>
      normalize(s.name) === target ||
      s.sourceHeadings.some((sh) => normalize(sh) === target),
  );
}

function splitBySections(markdown: string): { heading: string; body: string }[] {
  const lines = markdown.split('\n');
  const out: { heading: string; body: string }[] = [];
  let current: { heading: string; body: string } | null = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (current) out.push(current);
      current = { heading: m[1].trim(), body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * The QA tier vocabulary, mapped onto the section registry's.
 *
 * Two vocabularies exist because two registries do — `compassSectionRegistry`
 * names a Compass `compass-40`, `sectionRegistry.pure.ts` names it `compass`.
 * Partial on purpose: a tier with no entry runs no tier-ownership rule, which
 * is the same treatment `compassPostProcessor`'s own `SECTION_REGISTRY` and
 * `PAGE_BAND` maps give a tier they do not describe.
 */
const REGISTRY_TIER: Partial<Record<QATier, ReportTier>> = {
  'compass-40': 'compass',
  'financial-analysis': 'financial',
};

export interface QAContext {
  /**
   * The numbers `investment_score` actually holds (`recordedScoreValues`).
   * When given, a score-shaped claim in the prose that matches none of them
   * is reported (QA-18) — a document may print a score the record holds, and
   * no other.
   */
  recordedScores?: number[];
}

/**
 * The sections a tier declares WITH word caps. A tier absent here runs no
 * per-section check rather than being judged against another tier's list —
 * which is what `tier === 'compass-40' ? COMPASS : FINANCIAL` did, handing a
 * Briefing the Financial Analysis registry.
 */
const SECTION_REGISTRY: Partial<Record<QATier, readonly CompassSectionDefinition[]>> = {
  'compass-40': COMPASS_40_SECTIONS,
  'financial-analysis': FINANCIAL_ANALYSIS_SECTIONS,
};

/**
 * The page band a tier declares. `undefined` is a real answer and means no
 * finding, never a default band — see the head of this file.
 */
const PAGE_BAND: Partial<Record<QATier, { min: number; max: number }>> = {
  'compass-40': COMPASS_PAGE_BAND,
  'financial-analysis': { min: 18, max: 22 },
};

export function runQAValidation(
  markdown: string,
  tier: QATier,
  context: QAContext = {},
): QAReport {
  const findings: QAFinding[] = [];
  const registry = SECTION_REGISTRY[tier] ?? [];
  const wordCount = countWords(markdown);
  const estimatedPages = estimatePages(markdown);

  // Rule 1 — page band, for a tier that declares one
  const band = PAGE_BAND[tier];
  if (band && estimatedPages < band.min) {
    findings.push({
      rule: 'page-band',
      severity: 'warning',
      message: `Estimated ${estimatedPages} pages, below target min ${band.min}.`,
    });
  } else if (band && estimatedPages > band.max) {
    findings.push({
      rule: 'page-band',
      severity: 'error',
      message: `Estimated ${estimatedPages} pages, exceeds target max ${band.max}.`,
    });
  }

  // Rule 2 — financial exclusion (Compass only)
  if (tier === 'compass-40') {
    for (const pat of FINANCIAL_KEYWORDS) {
      if (pat.test(markdown)) {
        findings.push({
          rule: 'financial-exclusion',
          severity: 'error',
          message: `Compass contains financial content matching ${pat}. Move to Financial Analysis Report.`,
        });
      }
    }
  }

  // Rule 2b — forbidden placeholders / unresolved citations (both tiers)
  for (const pat of FORBIDDEN_PLACEHOLDERS) {
    if (pat.test(markdown)) {
      findings.push({
        rule: 'forbidden-placeholder',
        severity: 'error',
        message: `Report contains unresolved placeholder matching ${pat}. Replace with a real source reference or remove and consolidate into the source appendix.`,
      });
    }
  }

  // Rule 2d — no score the record does not hold (QA-18). Tables and chart
  // directives print recorded figures and are not read here; prose is.
  if (context.recordedScores) {
    const recorded = new Set(context.recordedScores.map((n) => Math.round(n)));
    const prose = markdown
      .split('\n')
      .filter((l) => { const t = l.trim(); return t && !t.startsWith('|') && !t.startsWith('{{') && !t.startsWith('#'); })
      .join('\n');
    const unrecorded = findScoreClaims(prose).filter((c) => !recorded.has(c.value));
    if (unrecorded.length) {
      findings.push({
        rule: 'unrecorded-score',
        severity: 'warning',
        message: `Prose asserts ${unrecorded.length} score(s) the record does not hold: `
          + unrecorded.slice(0, 5).map((c) => `"${c.text}"`).join(', ')
          + '. A document may print the recorded score and its scored dimensions, and no other.',
      });
    }
  }

  // Rule 2c — no editorial commentary label survives, in any of its three forms.
  //
  // This replaces the v2.0 pair of decision-box rules, which counted only
  // `^#{2,4} what this means` and so found 11 of the 5,043 labels in the
  // production corpus. It shares its matcher with the post-processor that does
  // the removing, so the check and the fix cannot disagree about what a label is.
  const survivingLabels = findEditorialLabels(markdown);
  if (survivingLabels.length > 0) {
    const sample = survivingLabels.slice(0, 5).join(' / ');
    findings.push({
      rule: 'editorial-label',
      severity: 'error',
      message:
        `Report contains ${survivingLabels.length} editorial commentary label(s) — e.g. ${sample}. ` +
        'State the finding in the sentence introducing the data instead.',
    });
  }

  // Rule 3 — suburb-narrative exclusion (Financial only)
  if (tier === 'financial-analysis') {
    for (const pat of SUBURB_KEYWORDS) {
      if (pat.test(markdown)) {
        findings.push({
          rule: 'suburb-exclusion',
          severity: 'warning',
          message: `Financial report contains suburb-narrative content matching ${pat}.`,
        });
      }
    }
  }

  // Rule 4 — duplicate H2 headings
  const h2s = parseH2(markdown);
  const seen = new Map<string, number>();
  for (const h of h2s) {
    const k = normalize(h);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const [k, count] of seen) {
    if (count > 1) {
      findings.push({
        rule: 'duplicate-h2',
        severity: 'error',
        message: `Heading "${k}" appears ${count} times.`,
      });
    }
  }

  // Rules 5–7 — per-section checks
  const sections = splitBySections(markdown);
  for (const sec of sections) {
    const def = findDef(sec.heading, registry);

    /*
     * …and a section that belongs to a DIFFERENT report.
     *
     * The 97 Poole Road Compass of 20 Sep 2026 carried `Suitability Profile`
     * and `Holding Strategy` as sections of its own on pages 19-20.
     * `sectionRegistry.pure.ts` declares both `financial:required` and for no
     * other tier: they are the Financial Analysis Report's, and a Compass
     * carrying them is `TIER_FRAMEWORK.md`'s defect — each report answering
     * the other's question.
     *
     * The cause was `strategySectionRules`, which named five composed
     * sections where the Compass composes three, so the model was told these
     * two existed, was shown neither, and wrote them. That is closed; this is
     * what says so if it happens again.
     *
     * Scoped by the tier map below: a tier with no entry does not run this
     * rule, because a rule that cannot name the tier cannot name what is
     * foreign to it.
     */
    const registryTier = REGISTRY_TIER[tier];
    if (registryTier) {
      const sectionId = sectionIdForHeading(sec.heading);
      const entry = sectionId
        ? CANONICAL_SECTIONS.find((e) => e.id === sectionId)
        : undefined;
      if (entry && !entry.tiers[registryTier]) {
        const homes = (Object.keys(entry.tiers) as ReportTier[])
          .filter((t) => entry.tiers[t]);
        const belongsTo = homes.length
          ? 'It belongs to the ' + homes.join(' and ') + ' report'
            + (homes.length > 1 ? 's' : '') + ', where it is composed from the record.'
          : 'No report tier declares it.';
        findings.push({
          rule: 'section-belongs-to-another-report',
          severity: 'error',
          message: `Section "${sec.heading}" is ${entry.canonicalLabel}, which this report does not `
            + `carry. ${belongsTo} Remove it: a report that answers another report's question is `
            + 'the defect the tier framework exists to stop.',
        });
      }
    }

    // Above the guard, deliberately: a section with no `def` is invisible to
    // every per-section rule below, and a section that belongs to another
    // report is exactly a section this tier's registry does not declare.
    if (!def) continue;

    // 7 — per-section word cap
    const w = countWords(sec.body);
    if (def.maxWordCount > 0 && w > def.maxWordCount * 1.1) {
      findings.push({
        rule: 'word-cap',
        severity: 'warning',
        sectionId: def.id,
        message: `Section "${sec.heading}" has ${w} words, over cap ${def.maxWordCount}.`,
      });
    }

    /*
     * A section that did not produce its declared SHAPE.
     *
     * Every rule above this one measures a section's length, its heading
     * density or what words it contains. None of them asks whether the
     * section is the thing its registry entry declares — so two of the three
     * Compass reports regenerated on 20 Sep 2026 shipped a Risk Dashboard
     * with no summary register in it, under nine other warnings each, and
     * nothing said so. The third produced one as two lines of prose carrying
     * pipe characters, which `promotePipedPseudoTables` now repairs on the
     * read path; this reports the case that cannot be repaired, because a
     * register nobody wrote cannot be composed without inventing an exposure
     * and an evidence reading for every row.
     *
     * Scoped by `def.id` rather than by heading text, and asked only of the
     * one section whose declared shape IS a register.
     */
    if (def.id === 'compass.riskDashboard' && !hasRiskRegister(sec.body)) {
      // Two different failures, and the three delivered documents had one
      // each way: 9 Hollow Street wrote the register as pipe-separated PROSE
      // (repairable, and repaired for the reader), 1 Crestview Avenue and
      // 97 Poole Road wrote none at all (not repairable — composing one would
      // mean inventing an exposure and an evidence reading for every row).
      // Reporting them as the same finding would send an operator to the
      // wrong remedy, which is the mistake `screeningConsumer` already paid
      // for over a simulator reported as no provider.
      const asMarkup = hasRiskRegister(promotePipedPseudoTables(sec.body).markdown);
      findings.push(asMarkup ? {
        rule: 'risk-register-not-marked-up',
        severity: 'warning',
        sectionId: def.id,
        message: `Section "${sec.heading}" wrote its summary register as pipe-separated text `
          + 'rather than as a markdown table. The reader\'s copy is repaired on the read path by '
          + '`promotePipedPseudoTables`, so the delivered document carries a table; the stored '
          + 'record carries prose. The instruction shows the markup — follow it.',
      } : {
        rule: 'risk-register-missing',
        severity: 'error',
        sectionId: def.id,
        message: `Section "${sec.heading}" carries no summary register. It must open with a `
          + `markdown table of ${RISK_REGISTER_COLUMNS.join(' | ')} — one row per risk — before `
          + 'the detail blocks. Without it a reader has to read the whole section to learn what '
          + 'the risks are, and no row states the exposure or the evidence held behind it.',
      });
    }

    // 8 — heading density. 68 H3s a report across 17 sections was the
    // structural half of the noise; the prompt asks for at most four.
    const h3 = (sec.body.match(/^###\s+/gm) ?? []).length;
    if (h3 > MAX_SUBHEADINGS_PER_SECTION) {
      findings.push({
        rule: 'subheading-density',
        severity: 'warning',
        sectionId: def.id,
        message: `Section "${sec.heading}" has ${h3} sub-headings (max ${MAX_SUBHEADINGS_PER_SECTION}).`,
      });
    }
  }

  // 6 — Protected sections must be present (Compass only)
  //
  // Only those the generator WRITES. `compass.cover` is Protected (nothing may
  // trim it) and `includeInCompass: false` (the template draws the cover; the
  // generator writes no cover section), so requiring every Protected id made
  // this an error on every Compass ever produced — five of five on 23–24 Sep
  // 2026 — and a check that always fails can never report a true one. The
  // required set is DERIVED from the list that is generated, never restated.
  if (tier === 'compass-40') {
    const presentDefs = new Set(
      sections.map((s) => findDef(s.heading, registry)?.id).filter(Boolean),
    );
    for (const protectedId of REQUIRED_PROTECTED_SECTION_IDS) {
      if (!presentDefs.has(protectedId)) {
        findings.push({
          rule: 'missing-protected-section',
          severity: 'error',
          sectionId: protectedId,
          message: `Required Protected section "${protectedId}" missing from Compass report.`,
        });
      }
    }
  }


  // Rule 9 — a promised table is a table that exists (QA-33).
  //
  // "The matrix below groups the main amenities by type" printed on two of
  // the audited documents with nothing below it: the figure was a chart
  // directive the standard presentation could not draw, so it was dropped,
  // and the sentence that introduced it stayed. A lead-in is a promise; a
  // section that makes one must carry a table or a directive after it.
  for (const s of splitBySections(markdown)) {
    const lines = s.body.split('\n');
    lines.forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('|') || t.startsWith('{{') || t.startsWith('#')) return;
      if (!TABLE_PROMISE.test(t)) return;
      const kept = lines.slice(i + 1).some((l) => { const u = l.trim(); return u.startsWith('|') || u.startsWith('{{'); });
      if (!kept) {
        findings.push({
          rule: 'promised-table',
          severity: 'error',
          sectionId: findDef(s.heading, registry)?.id,
          message: `"${s.heading}" promises a table or matrix below ("${t.slice(0, 80)}…") and none follows. Draw it or remove the promise.`,
        });
      }
    });
  }

  // Rule 10 — a paired heading carries both halves (QA-33).
  //
  // "Strengths and Limitations" on the audited Compass printed strengths and
  // no limitations at all — the second half had been cut by a word cap. A
  // heading that names two lists is a promise of two lists.
  for (const s of splitBySections(markdown)) {
    const lines = s.body.split('\n');
    const pairAt = lines.findIndex((l) => PAIR_HEADING.test(l.trim()));
    if (pairAt < 0) continue;
    const rest = lines.slice(pairAt + 1);
    const secondAt = rest.findIndex((l) => PAIR_SECOND_LABEL.test(l.trim()));
    const secondHasContent = (secondAt >= 0 && rest.slice(secondAt + 1).some((l) => {
      const t = l.trim();
      return t && !t.startsWith('#') && !PAIR_SECOND_LABEL.test(t);
    })) || rest.some((l) => PAIR_SECOND_LEAD_IN.test(l.trim()));
    if (!secondHasContent) {
      findings.push({
        rule: 'unbalanced-pair',
        severity: 'error',
        sectionId: findDef(s.heading, registry)?.id,
        message: `"${s.heading}" announces "${lines[pairAt].trim().replace(/^#+\s*/, '')}" but carries no ${secondAt >= 0 ? 'content under the second list' : 'second list'}. State the limitations or rename the heading.`,
      });
    }
  }

  // Rule 11 — confidence is evidence completeness, not reassurance (QA-20).
  //
  // "Environmental Risk — Level: Moderate — Confidence: High" sat beside the
  // instruction to obtain the flood and bushfire checks. A rating may be
  // called high-confidence only once the dated, parcel-level check is held;
  // while a required check is outstanding the honest word is "unverified".
  {
    const lines = markdown.split('\n');
    lines.forEach((line, i) => {
      if (!/confidence:\s*high\b/i.test(line)) return;
      const window = lines.slice(i + 1, i + 8).join(' ');
      if (/required (?:check|action|dd)|verification required|to be (?:verified|confirmed|assessed)|pending|obtain|confirm with|verify with/i.test(window)) {
        findings.push({
          rule: 'risk-confidence-overstated',
          severity: 'warning',
          message: `A risk is rated "Confidence: High" while its required check is still outstanding ("${line.trim().slice(0, 80)}"). Confidence describes evidence held, so rate it "Unverified" until the dated check exists.`,
        });
      }
    });
  }

  /*
   * Rule 12 — a timeline bucket is a delivery horizon, and no register here
   * publishes one.
   *
   * The Kellyville Compass drew
   * `{{timeline: 0-2y "Major mixed-use redevelopment Castle Hill ($181.9m)",
   * 0-2y "High-tech data centres Norwest (three approvals at $93.18m)",
   * 0-2y "Terrace housing project Gables ($29.75m)"}}`. Every date behind
   * those three is a DETERMINATION — a date a decision was recorded — and the
   * evidence table prints "Not published by this register" in its Delivery
   * timing column on every row, because neither the NSW DA register nor the
   * Queensland instrument layers publish a delivery date for anything. "0-2y"
   * is a completion this report has no source for.
   *
   * Judged on the prose, not on the evidence: the evidence table is appended
   * AFTER this validator runs (so a word cap can never trim a row of
   * evidence), which means the only thing here to read is what the model
   * wrote. That is the right thing to read anyway — the claim is the model's.
   *
   * Deliberately narrow. It matches a horizon bucket spelled as a duration or
   * as a relative term, and leaves alone a stop labelled by what a date IS
   * ("Determined Jul 2026"), by a calendar year, or by "Existing" — all three
   * of which a register can support.
   */
  //
  // The pattern and the walk live in `evidenceClaims.pure.ts`, which is also
  // what CORRECTS this finding on the generation path. A detector with its own
  // copy of the corrector's regex is two ends that drift, and the whole value
  // of the correction is that what is reported is what is removed.
  for (const found of findUnpublishedHorizons(markdown)) {
    findings.push({
      rule: 'unpublished-delivery-horizon',
      severity: 'error',
      message: `A {{timeline:}} places ${found.horizons.length} item${found.horizons.length === 1 ? '' : 's'} in a future `
        + `delivery horizon (${[...new Set(found.horizons)].join(', ')}). The planning and development registers this `
        + 'report reads publish no delivery date for anything — every date they carry is a decision or a '
        + 'declaration — so label each stop with what its date IS ("Determined Jul 2026", "Gazetted 2023") or '
        + 'draw no horizon timeline.',
    });
  }

  /*
   * 13. A listing is not a planning authority — refined 18 Sep 2026.
   *
   * Measured on 48 Redfern Street, read out of the rendered PDFs: four
   * bracketed inline citations per document, THREE naming `Property.com.au`,
   * and one of those three carrying
   *
   *   "...multiple NEARBY ADDRESSES on the street recording no bushfire, flood
   *    or heritage overlays on public mapping at the time they were last
   *    updated.[Property.com.au, 119, 120, 137 and 139 Redfern Street
   *    profiles, 2024-2026]"
   *
   * which is the sentence `planningFacts.pure.ts` forbids by name. The
   * prohibition reached the model and NOTHING read the document to see whether
   * it was obeyed — the gap section 10.3 of
   * `PLANNING_CONTROLS_IN_THE_REPORT.md` named for a different rule and closed
   * with rule 12. And because the fork routes the parent's prose, one bad
   * sentence becomes three documents.
   *
   * ## Two findings, because they are two different mistakes
   *
   * The first version made any portal citation an error, and that was too
   * broad. **A listing is the authoritative source for the thing it IS** — the
   * asking price, the advertised configuration, the marketing copy — and
   * rejecting it wholesale would strip a report of properly recorded evidence
   * for an identity fact. What a listing can never do is clear the SUBJECT
   * PROPERTY of a hazard or a planning control.
   *
   * So:
   *
   *   `portal-sourced-hazard-clearance` (ERROR) — a hazard or planning
   *   absence asserted about this property on the authority of a listing
   *   portal or of NEIGHBOURING listings. Two nouns make it worse than a bad
   *   citation: it is a claim about a different parcel, presented as a
   *   clearance for this one.
   *
   *   `listing-portal-as-source` (WARNING) — any other portal citation.
   *   Disclosed so a reviewer can see what the prose rests on, not blocking,
   *   because the legitimate case is real.
   *
   * It REPORTS and never scrubs: prose is never regex-scrubbed, on read or on
   * write. And it is narrow on purpose — a false caveat teaches people to
   * dismiss the warning.
   */
  // The patterns and both finders live in `evidenceClaims.pure.ts` for the
  // reason rule 12 gives: the error half of this rule is CORRECTED on the
  // generation path, and a detector holding its own copy of the corrector's
  // regex reports one thing while the corrector removes another.
  const portalCitations = findPortalCitations(markdown);
  const clearances = findPortalSourcedClearances(markdown);
  if (clearances.length) {
    findings.push({
      rule: 'portal-sourced-hazard-clearance',
      severity: 'error',
      message: `${clearances.length} sentence${clearances.length === 1 ? '' : 's'} state that a hazard or `
        + 'planning control does NOT apply, on the authority of a listing portal or of neighbouring '
        + 'listings. A listing is not a planning authority, and a neighbouring parcel is not this one. '
        + 'The only absence this report may repeat is a published map that was checked and shows nothing '
        + 'over the property, stated as the planning table states it ("Checked and not mapped at the '
        + 'property") and naming the map.',
    });
  }
  if (portalCitations.length) {
    const named = [...new Set(portalCitations.map((b) => (PORTAL_SOURCE_RE.exec(b) ?? [''])[0].toLowerCase()))];
    findings.push({
      rule: 'listing-portal-as-source',
      severity: 'warning',
      message: `${portalCitations.length} inline citation${portalCitations.length === 1 ? '' : 's'} name a property `
        + `listing portal (${named.join(', ')}). A listing is authoritative for what it IS — the asking `
        + 'price, the advertised configuration — and is not evidence for a market statistic, a planning '
        + 'control or a hazard. Check each one carries only what the listing itself states.',
    });
  }

  /*
   * ── 14. Does the document agree with ITSELF? ──────────────────────────
   *
   * Rules 1-13 ask whether the document is well formed and whether its claims
   * rest on anything. This one asks whether page 12 agrees with page 17, which
   * is the shape four of the defects read off the supplied PDFs actually took:
   * a $467 weekly shortfall beside a $450 one, an interest-only loan beside an
   * amortising repayment, B/62 beside 60/100, and a bedroom count both stated
   * and withheld.
   *
   * It lives in `documentConsistency.pure.ts` and is imported rather than
   * restated, for rule 12's reason. It compares figures the document already
   * printed and computes nothing — there is no second financial calculator
   * here, and a contradiction is never repaired by deleting one side of it,
   * because which side is right is a question about the producer.
   */
  for (const c of findDocumentContradictions(markdown)) {
    findings.push({ rule: c.rule, severity: c.severity, message: c.message });
  }

  /*
   * ── 15. A figure that names no basis ──────────────────────────────────
   *
   * The occupier mixes, property-fit gauges, evidence mixes, risk scores and
   * investor-readiness ratings read off the supplied PDFs. Some of those
   * numbers are sound — an occupier mix from the Census, an evidence mix from
   * the register — and the reader has no way to tell them from the ones a
   * model chose, because the figure names no dataset, no period and no model
   * basis anywhere near it.
   *
   * REPORTED, never removed. `suppressUnrecordedVerdictVisuals` removes a
   * rating the record does not hold, which is right because that number is
   * untrue; deleting a sound figure to silence a warning takes real data off
   * the page. The remedy is a caption.
   */
  const unbased = findFiguresWithoutABasis(markdown);
  if (unbased.length) {
    const named = [...new Set(unbased.map((f) => f.title || f.kind))].slice(0, 6);
    findings.push({
      rule: 'figure-without-a-stated-basis',
      severity: 'warning',
      message: `${unbased.length} figure${unbased.length === 1 ? '' : 's'} draw numbers with no dataset, `
        + `period or model basis stated near them (${named.join('; ')}). Every number a reader acts on `
        + 'needs a traceable dataset or an approved calculation, and a figure states it in a caption: '
        + 'the units, the period, the geography, and the source or the model basis. Where none can be '
        + 'given, say the finding in words rather than drawing it.',
    });
  }

  /*
   * ── 16. A register cell carrying a paragraph ──────────────────────────
   *
   * The risk section was declared as four columns, one of them an explanation
   * and another an instruction, over roughly eight risks inside a 550-word
   * cap. A grid is the wrong container for two paragraphs, so what printed was
   * the paragraph-heavy table read off the supplied documents: cells running
   * to four and five lines, and a reader who has to read across a column
   * boundary to follow one thought.
   *
   * The register is a scan and the detail blocks are the reading now, so a
   * cell carrying a paragraph is a cell in the wrong container. The cap is the
   * one `riskRegisterInstruction` states to the model, imported rather than
   * restated so what is asked for and what is judged cannot become two
   * standards.
   */
  for (const cell of findOverlongRegisterCells(markdown)) {
    findings.push({
      rule: 'risk-register-cell-overlong',
      severity: 'warning',
      message: `The risk register's "${cell.column}" cell for ${cell.risk || 'a risk'} runs to `
        + `${cell.words} words (the register's cells hold ${RISK_REGISTER_CELL_MAX_WORDS}). A register `
        + 'is scanned, not read: put the finding, the evidence, what it means for this purchase and '
        + 'the next check in a detail block under the table, and leave a phrase in the cell.',
    });
  }

  /*
   * ── 17. The document describes how it was made ────────────────────────
   *
   * The 60 Lawley Street Compass (25 Sep 2026) said "register" 110 times,
   * "retrieved" 38 times, "coordinate" 17 and "this platform" 11 — every
   * sentence true, none of them about the property. The writer is told the
   * adviser's voice (`adviserVoiceRules`) and the composed blocks are held to
   * it by a spec; this is the measurement of what reached the page.
   *
   * REPORTED, never removed: a phrase cut out of a sentence leaves a sentence
   * that no longer says what it said.
   */
  const machineRoom = platformVocabularyCount(markdown);
  if (machineRoom > 0) {
    findings.push({
      rule: 'platform-vocabulary',
      severity: 'warning',
      message: `The document describes how it was produced ${machineRoom} time${machineRoom === 1 ? '' : 's'} `
        + `(${platformVocabularyIn(markdown).map((p) => `"${p}"`).join(', ')}). A client document speaks as the `
        + 'adviser, about the property: name a source by its publisher and product, and say how the client confirms '
        + 'what could not be.',
    });
  }

  const passed = findings.every((f) => f.severity !== 'error');
  return { tier, estimatedPages, wordCount, passed, findings };
}
