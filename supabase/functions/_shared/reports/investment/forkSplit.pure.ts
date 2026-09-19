/**
 * The fork's composition — the deterministic half of `fork-investment-report`.
 *
 * ## Why it moved
 *
 * The Financial and Due Diligence reports are produced by SLICING the
 * composite's own sections through the split registry and merging the
 * record-composed financial chapters into them. None of that touches the
 * network or the database, and all of it lived inside the edge function's
 * `index.ts` — so it could only ever run inside a deployed Deno runtime.
 *
 * The consequence is measurable: `subReportEngines.spec.ts` reaches the fork
 * by reading its SOURCE as text (`expect(fork).toContain(…)`), because there
 * was no other way in, and neither of the two documents it produces has ever
 * been drawn and read end to end. They are the two of the five reports that
 * need no model call at all.
 *
 * Nothing here is new. Every function below is moved verbatim from
 * `fork-investment-report/index.ts`, with two changes and no third:
 * `composeForkDocuments` is the orchestrator the function's handler used to
 * inline, and the document's "Generated" date is an INPUT rather than
 * `new Date()` read at the bottom of the call stack — a document that cannot
 * be produced twice with the same bytes cannot be diffed, and the handler
 * passes `new Date()` so its output is unchanged.
 *
 * The registry is the caller's. `loadSplitRegistry` reads
 * `report_engine_config` and falls back to the constants in
 * `reportSplitRegistry.ts`; production holds no overlay for any of the four
 * keys (measured 17 Sep 2026), so the defaults ARE production's registry.
 */
import {
  normaliseStructuralHeading,
  type LoadedSplitRegistry,
  type ForkVariant,
  type SplitRoute,
} from '../../reportSplitRegistry.ts';
import {
  composeFinancialChapters,
  type ComposedChapter,
} from './financialChapters.pure.ts';
import {
  composeStrategySections,
  type StrategyRecord,
  type StrategySection,
} from './strategyPositions.pure.ts';
import { dropEmptySections, stripPlaceholderRows } from './derivedHygiene.pure.ts';
import { scrubBlocks } from './blockHygiene.pure.ts';
import { stripEditorialLabelsFromMarkdown } from '../../compassPostProcessor.ts';
import { formatReportDate } from '../reportDate.pure.ts';
import {
  riskDashboardContract,
  socioeconomicContract,
  splitRiskRegister,
} from './forkSectionContracts.pure.ts';


interface ParsedSection {
  rawHeading: string;
  normalisedHeading: string;
  body: string;
}

/** Split markdown into H2-anchored sections, preserving anything before the first H2 as a preamble. */
function splitIntoSections(markdown: string): { preamble: string; sections: ParsedSection[] } {
  const lines = (markdown || '').split('\n');
  const sections: ParsedSection[] = [];
  let preambleLines: string[] = [];
  let current: ParsedSection | null = null;

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      if (current) sections.push(current);
      current = {
        rawHeading: h2[1],
        normalisedHeading: normaliseStructuralHeading(h2[1]),
        body: '',
      };
    } else if (current) {
      current.body += line + '\n';
    } else {
      preambleLines.push(line);
    }
  }
  if (current) sections.push(current);
  return { preamble: preambleLines.join('\n').trim(), sections };
}

function buildLensIntro(registry: LoadedSplitRegistry, variant: ForkVariant, rule: SplitRoute['rule']): string {
  if (rule === 'verbatim') return '';
  if (variant === 'financial' && rule === 'financial_lens') return registry.finLensPreamble + '\n\n';
  if (variant === 'due_diligence' && rule === 'property_lens') return registry.plddLensPreamble + '\n\n';
  return '';
}

function summariseBody(body: string, maxWords = 200): string {
  const words = body.trim().split(/\s+/);
  if (words.length <= maxWords) return body;
  return words.slice(0, maxWords).join(' ') + '\n\n_…full detail in the companion report._';
}

interface AssembledSection {
  ordinal: number;
  heading: string;
  body: string;
}

/** The heading a Due Diligence risk section takes when its body is a list of checks rather than assessed risks. */
const PLDD_CHECKLIST_HEADING = 'Property & Location Due Diligence Checklist';

/**
 * The route that sends the composite's risk register to both variants. Read
 * from the route's own headings and match list rather than a rule name, so a
 * `split_routes` overlay in `report_engine_config` that still says
 * `verbatim` (every stored copy does) gets the split too.
 */
function isRiskDashboardRoute(route: SplitRoute): boolean {
  return route.target === 'both' && (
    route.match.some((m) => /risk dashboard|risk summary|key risks/i.test(m))
    || /risk dashboard/i.test(route.newHeadingFinancial ?? '')
  );
}

function assembleForVariant(
  registry: LoadedSplitRegistry,
  variant: ForkVariant,
  parsed: ParsedSection[],
): AssembledSection[] {
  const buckets: AssembledSection[] = [];
  const usedOrdinals = new Set<number>();
  let fallbackOrdinal = 100;

  for (const section of parsed) {
    const { route } = registry.routeCompositeSection(section.normalisedHeading);
    if (!route) continue;

    const isTargeted =
      route.target === 'both' ||
      route.target === variant;
    if (!isTargeted) continue;
    if (route.rule === 'drop') continue;

    let newHeading =
      variant === 'financial'
        ? route.newHeadingFinancial || section.normalisedHeading
        : route.newHeadingDueDiligence || section.normalisedHeading;

    let ordinal =
      variant === 'financial'
        ? route.ordinalFinancial
        : route.ordinalDueDiligence;
    if (!ordinal || usedOrdinals.has(ordinal)) {
      ordinal = ordinal && !usedOrdinals.has(ordinal) ? ordinal : fallbackOrdinal++;
    }
    usedOrdinals.add(ordinal);

    const lensIntro = buildLensIntro(registry, variant, route.rule);
    let body = route.rule === 'summarise_only'
      ? summariseBody(section.body)
      : section.body;

    // What a section may HOLD is decided from its body, not its heading —
    // three contracts the audit of 291 Stone Mason Drive found the routing
    // promising and not keeping (`forkSectionContracts.pure.ts`).
    //
    // The risk register goes to both variants, and the route's note has
    // always said "FIN keeps financial rows, PLDD keeps property/location
    // rows"; nothing filtered a row, so the Financial report's dashboard
    // opened with "the main non-financial risks" (QA-31). Each entry is now
    // classified by what it is about; one nobody can classify goes to both.
    if (isRiskDashboardRoute(route)) {
      const split = splitRiskRegister(body, variant);
      if (split.recognised) body = split.body;
      if (variant === 'due_diligence') {
        // A body of things to do is a checklist and is named as one, with
        // its status, rather than a dashboard of assessed risks (QA-32).
        const contract = riskDashboardContract(body, newHeading, PLDD_CHECKLIST_HEADING);
        newHeading = contract.heading;
        if (contract.status) body = `${contract.status}\n\n${body.trim()}\n`;
      }
      // A variant left with nothing to print has no section to print.
      if (!body.trim()) continue;
    }
    // A SEIFA heading needs a SEIFA index; where none is held the heading
    // stops promising one and the body says so (QA-27).
    if (variant === 'due_diligence' && /seifa/i.test(newHeading)) {
      const contract = socioeconomicContract(body, newHeading);
      newHeading = contract.heading;
      if (contract.lead) body = `${contract.lead}\n\n${body.trim()}\n`;
    }

    buckets.push({ ordinal, heading: newHeading, body: lensIntro + body.trim() + '\n' });
  }

  // De-duplicate consecutive identical headings, keeping the richer body
  const dedupedMap = new Map<string, AssembledSection>();
  for (const s of buckets) {
    const existing = dedupedMap.get(s.heading);
    if (!existing) dedupedMap.set(s.heading, s);
    else if (s.body.length > existing.body.length) dedupedMap.set(s.heading, s);
  }
  return Array.from(dedupedMap.values()).sort((a, b) => a.ordinal - b.ordinal);
}

const normHeading = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** FIN ordinal of the risk dashboard — the split registry's, restated for the merge below. */
const FIN_RISK_DASHBOARD_ORDINAL = 11;

/**
 * Fold the record-composed FIN chapters into the routed prose. A composed
 * chapter REPLACES a routed section holding its ordinal or its heading: the
 * routed version is the parent's prose about the same money, and where the two
 * could disagree the recorded calculation wins — that is framework law I
 * (every figure is typed from the record). From a Compass-40 parent nothing
 * collides, because the parent has no financial sections to route; from a
 * legacy parent the stale prose tables give way to the record's own.
 */
function mergeComposedChapters(
  routed: AssembledSection[],
  composed: ComposedChapter[],
): { sections: AssembledSection[]; replaced: string[] } {
  const composedHeadings = new Set(composed.map((c) => normHeading(c.heading)));
  const composedOrdinals = new Set(composed.map((c) => c.ordinal));
  const replaced: string[] = [];
  // The one composed chapter that is not "the same money": the Financial
  // Risk Dashboard (11) is typed from the record, while the routed section
  // at that ordinal holds the analysis's own financial risk ENTRIES (the
  // register, split to its money rows). Those are not prose about figures
  // the record states better — they are the risks the analysis named — so
  // they are kept under the composed dashboard rather than replaced by it.
  const carriedUnder = new Map<number, AssembledSection>();
  const kept = routed.filter((s) => {
    if (composedHeadings.has(normHeading(s.heading)) || composedOrdinals.has(s.ordinal)) {
      if (s.ordinal === FIN_RISK_DASHBOARD_ORDINAL && s.body.trim()) carriedUnder.set(s.ordinal, s);
      replaced.push(s.heading);
      return false;
    }
    return true;
  });
  const composedAsSections: AssembledSection[] = composed.map((c) => {
    const carried = carriedUnder.get(c.ordinal);
    // The chapter's markdown carries its own `## heading` line; the renderer
    // writes headings itself, so the body starts after it.
    const body = c.markdown.replace(/^##[^\n]*\n/, '').trim();
    // The register's own group heading ("### Consolidated Risk Register")
    // survives the split when an entry under it is kept, so a body that
    // opens with one is nested as it is — a second H3 over it would be a
    // heading with nothing of its own, which the renderer drops.
    const carriedBody = carried?.body.trim() ?? '';
    const tail = carried
      ? (carriedBody.startsWith('###') ? `\n\n${carriedBody}` : `\n\n### Risks noted in the analysis\n\n${carriedBody}`)
      : '';
    return { ordinal: c.ordinal, heading: c.heading, body: `${body}${tail}\n` };
  });
  return {
    sections: [...kept, ...composedAsSections].sort((a, b) => a.ordinal - b.ordinal),
    replaced,
  };
}

/**
 * Hygiene every fork document goes through before it is stored: editorial
 * labels stripped (a legacy parent carries "What This Means" blocks by the
 * dozen and slicing preserves them), then placeholder table rows dropped —
 * a labelled row is a promise that a figure follows it.
 */
function finaliseVariantMarkdown(md: string): {
  markdown: string;
  editorialBlocksRemoved: number;
  placeholderRowsRemoved: number;
  emptyStatCardsRemoved: number;
  duplicateDirectivesRemoved: number;
} {
  const stripped = stripEditorialLabelsFromMarkdown(md);
  const scrubbed = stripPlaceholderRows(stripped.markdown);
  // A heading the scrub leaves over nothing goes with its table.
  const sections = dropEmptySections(scrubbed.markdown);
  // The two block types the row scrubber cannot see. A fork routes the
  // parent's own prose, so a card the parent left empty and a chart the parent
  // drew twice both arrive here intact.
  const blocks = scrubBlocks(sections.markdown);
  return {
    markdown: blocks.markdown,
    editorialBlocksRemoved: stripped.removedBlocks,
    placeholderRowsRemoved: scrubbed.removedRows,
    emptyStatCardsRemoved: blocks.emptyStatCards,
    duplicateDirectivesRemoved: blocks.duplicateDirectives,
  };
}

function renderVariantMarkdown(
  registry: LoadedSplitRegistry,
  variant: ForkVariant,
  propertyAddress: string,
  sections: AssembledSection[],
  generatedOn: string,
): string {
  const title = variant === 'financial' ? registry.finTitle : registry.plddTitle;
  const subtitle = variant === 'financial' ? registry.finSubtitle : registry.plddSubtitle;
  const footer = variant === 'financial' ? registry.finFooter : registry.plddFooter;

  const cover = `# ${title}\n\n_${subtitle}_\n\n**Property:** ${propertyAddress}\n\n**Generated:** ${formatReportDate(generatedOn)}\n\n---\n\n`;

  const body = sections
    .map((s) => `## ${s.heading}\n\n${s.body.trim()}\n`)
    .join('\n');

  const disclaimer = `\n\n---\n\n## Disclaimer\n\n${footer}\n`;

  return cover + body + disclaimer;
}


/**
 * The loaded registry's own wording for a FIN section, found by prefix.
 *
 * By prefix because the registry is overridable from `report_engine_config`
 * and an operator may have reworded a heading; a lookup on the in-code literal
 * would then silently drop the section. The prefix is the part the two
 * spellings share.
 */
function finHeading(registry: LoadedSplitRegistry, prefix: string): string {
  return registry.finSectionOrder.find((e) => e.heading.startsWith(prefix))?.heading ?? prefix;
}

/** What one fork variant came out as, with what the hygiene pass removed. */
export interface ForkVariantOutput {
  markdown: string;
  sections: number;
  editorialBlocksRemoved: number;
  placeholderRowsRemoved: number;
  emptyStatCardsRemoved: number;
  duplicateDirectivesRemoved: number;
}

export interface ForkDocuments {
  financial: ForkVariantOutput;
  dueDiligence: ForkVariantOutput;
  /** Routed sections whose prose a composed chapter replaced. */
  replacedByComposedChapters: string[];
  /** The headings of the chapters typed from the recorded calculation. */
  composedChapters: string[];
  /** H2 sections the composite offered the router. */
  compositeSections: number;
}

/**
 * Both fork documents from one composite, exactly as the handler produces them.
 *
 * `composeFinancial` mirrors the handler's `variants.includes('financial')`:
 * the recorded chapters are composed only when the Financial report is being
 * produced, because they are what replaces routed prose about the same money.
 */
export function composeForkDocuments(input: {
  registry: LoadedSplitRegistry;
  parentContent: string;
  propertyAddress: string;
  financialCalculations: unknown;
  financialScore: unknown;
  composeFinancial: boolean;
  /**
   * The record the strategy sections are composed from, or null where the
   * caller could not build one (a parent with no market evidence recorded, or
   * a Due-Diligence-only fork).
   *
   * Composed here rather than routed, for the reason the financial chapters
   * are: a Compass parent carries no suitability, holding or exit prose to
   * slice, so routing them produced three empty headings for as long as they
   * were declared `optional` and nothing noticed.
   */
  strategy?: StrategyRecord | null;
  /**
   * The date the document prints as its own.
   *
   * Required rather than defaulted: a module here may not read the clock
   * (`investmentSourceOfTruth.spec.ts`), and the rule is the right one — a
   * document that cannot be produced twice with the same bytes cannot be
   * diffed, which is why neither fork document had ever been compared with
   * anything. The handler passes today's.
   *
   * An ISO date rather than a `Date`, and printed by `formatReportDate` rather
   * than `toLocaleDateString` — `oneDateFormatter.spec.ts` forbids a report
   * module reaching for the platform formatter, and it is right: that is how
   * an Australian reporting entity's document came to print `8/29/2029`. The
   * printed words are identical (`17 September 2026`).
   */
  generatedOn: string;
}): ForkDocuments {
  const generatedOn = input.generatedOn;
  const { sections } = splitIntoSections(input.parentContent || '');
  const routedFinancialSections = assembleForVariant(input.registry, 'financial', sections);
  const dueDiligenceSections = assembleForVariant(input.registry, 'due_diligence', sections);

  const composedChapters = input.composeFinancial
    ? composeFinancialChapters(
      { financialCalculations: input.financialCalculations, investmentScore: input.financialScore },
      { scenarios: 'all' },
    )
    : [];
  /*
   * The three strategy sections the Financial report owns, at the FIN ordinals
   * the split registry gives them. `composeStrategySections` takes the heading
   * from here rather than deciding it, because the label belongs to the
   * registry — the Compass calls the exit section "Resale Liquidity & Exit
   * Outlook" and this document calls it "Resale Liquidity & Exit Strategy".
   */
  const strategySections: ComposedChapter[] = input.composeFinancial && input.strategy
    ? composeStrategySections(input.strategy, [
      { id: 'exitStrategy', heading: finHeading(input.registry, 'Resale Liquidity') },
      { id: 'suitability', heading: finHeading(input.registry, 'Investor Suitability Profile') },
      { id: 'holdingStrategy', heading: finHeading(input.registry, 'Holding Strategy') },
    ]).flatMap((section: StrategySection) => {
      const entry = input.registry.finSectionOrder.find((e) => e.heading === section.heading);
      // A heading the loaded order does not carry has no place to sort to, so
      // it is left out rather than appended at an ordinal nothing agreed.
      return entry ? [{ ordinal: entry.ordinal, heading: section.heading, markdown: section.markdown }] : [];
    })
    : [];

  const mergedFinancial = mergeComposedChapters(
    routedFinancialSections,
    [...composedChapters, ...strategySections],
  );

  const financial = finaliseVariantMarkdown(
    renderVariantMarkdown(input.registry, 'financial', input.propertyAddress, mergedFinancial.sections, generatedOn),
  );
  const dueDiligence = finaliseVariantMarkdown(
    renderVariantMarkdown(input.registry, 'due_diligence', input.propertyAddress, dueDiligenceSections, generatedOn),
  );

  return {
    financial: { ...financial, sections: mergedFinancial.sections.length },
    dueDiligence: { ...dueDiligence, sections: dueDiligenceSections.length },
    replacedByComposedChapters: mergedFinancial.replaced,
    composedChapters: [...composedChapters, ...strategySections].map((c) => c.heading),
    compositeSections: sections.length,
  };
}

/**
 * How many H2 sections the composite offers the router.
 *
 * The handler refuses a composite with none before it loads a registry or
 * writes anything, so the count is exposed on its own rather than the
 * splitter.
 */
export function countCompositeSections(markdown: string): number {
  return splitIntoSections(markdown || '').sections.length;
}
