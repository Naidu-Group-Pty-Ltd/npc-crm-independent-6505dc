/**
 * A section the model wrote twice is presented once.
 *
 * ## What the reader got
 *
 * Measured on the regenerated 262 Pallas Street Compass (17 Sep 2026, recorded
 * in `PLANNING_CONTROLS_IN_THE_REPORT.md` §7 as a named residual): the **Due
 * Diligence Checklist** ran on pages 24–25 and again on 25–26, and the
 * **Final Recommendation** on page 25 and again on page 26. One checklist item
 * was cut mid-sentence in the second copy.
 *
 * The registry is not the cause. `compass.riskDashboard` (ordinal 9),
 * `compass.dueDiligenceChecklist` (10) and `compass.finalRecommendation` (11)
 * are three distinct entries with no shared `sourceHeadings`. The model wrote
 * the latter two *inside* the Risk Dashboard's own chunk — as sub-headings —
 * and then wrote them again as their own sections. `partitionByRegistry` is
 * right to keep an unrecognised sub-heading with the section above it; what it
 * cannot know on its own is that this particular sub-heading is a section the
 * document goes on to write properly further down.
 *
 * ## The rule
 *
 * **A heading nested inside one section's body that names a section the
 * document ALSO writes at its own level is that section starting early.** It is
 * cut from where it does not belong and carried forward to where it does.
 *
 * Two things follow from that wording, and both are deliberate.
 *
 * It is **carried, never dropped.** The complete copy was the nested one on the
 * document that prompted this — the standalone copy is where the truncated
 * checklist item was — so a rule that kept the structurally-correct copy and
 * discarded the other would have deleted the better text. The two are merged
 * instead, in the order the model wrote them, and a block that repeats one
 * already kept is dropped as the repeat it is. Where one copy says everything
 * the other does, the merge is exactly the fuller copy; where they genuinely
 * diverge, neither half is lost. That is the same answer `captureObjectsFor`
 * gives to the same question: **merge rather than choose**, because a rule that
 * cannot say which copy is sound is not entitled to destroy one.
 *
 * And it acts **only where the document names the section properly somewhere
 * else.** A nested heading with no section-level counterpart is a section
 * buried as a sub-heading, which is a different defect with a different fix
 * (promoting it would re-level a heading, move it in the contents and change
 * documents that carry no duplication at all). This module is a
 * de-duplication and nothing else, so on a document that repeats nothing it is
 * a no-op — which is what makes it safe on the read path, where it repairs
 * every document already stored rather than only the next one.
 */
import { STRATEGY_SECTION_IDS } from './strategyPositions.pure.ts';
import {
  SECTION_REGISTRY,
  detectSectionLevel,
  isSubHeadingByNumbering,
  sectionIdForHeading,
  type SectionHeadingLevel,
  type SectionId,
} from './sectionRegistry.pure.ts';

export interface FoldedSection {
  /** The registry section that was written twice. */
  id: SectionId;
  /** The section whose body the early copy was nested inside. */
  from: SectionId;
  /** The nested heading, as the document spelled it. */
  heading: string;
  /** Blocks carried forward from the nested copy. */
  carried: number;
  /** Blocks dropped because the other copy already said them. */
  repeated: number;
}

export interface SectionFoldResult {
  markdown: string;
  folded: FoldedSection[];
}

/**
 * How a block is compared with another for repetition.
 *
 * Narrow on purpose, and for the reason `directiveKey` is narrow: case,
 * whitespace, dash variants, thousands separators, emphasis markers and the
 * list marker a line opens with. The last one earns its place — the same
 * checklist item reaches the page as `- Ask a local property manager` in one
 * copy and `8. Ask a local property manager` in the other, and a reader
 * meeting both does not see two obligations.
 *
 * Nothing here touches a WORD. Two blocks that differ in any of them are two
 * blocks and both survive.
 */
export function blockKey(block: string): string {
  return (block || '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''))
    .join(' ')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[*_`]/g, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Short units are kept whatever they repeat.
 *
 * A rule, a bold lead-in, a one-word table cell and a `:::` close are structure
 * rather than content, and collapsing them would take apart a table or a fenced
 * figure that legitimately looks like its neighbour. Measured against nothing —
 * this is a floor chosen to be obviously below a sentence.
 */
const MIN_REPEATABLE = 16;

/**
 * A checklist is ONE block, which is why the comparison is not blocks.
 *
 * Executing the first version against the shape this module was written for
 * showed it immediately: the nested copy is `1.` / `2.` / `3.` with no blank
 * line between them and the standalone copy is `-` / `-` / `-`, so each is a
 * single block, the two blocks differ in their third item, and nothing
 * collapsed. A reader still met every obligation twice.
 *
 * So a list is compared ITEM by item. A unit is a whole block, or one item of
 * a list block — and an item carries its own continuation lines, because a
 * wrapped item is one obligation rather than two.
 */
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/;

function isListBlock(block: string): boolean {
  const lines = block.split('\n').filter((l) => l.trim() !== '');
  return lines.length > 0 && LIST_ITEM.test(lines[0]) && lines.some((l) => LIST_ITEM.test(l));
}

/** A list block as its items; anything else as itself. */
export function toUnits(block: string): string[] {
  if (!isListBlock(block)) return [block];
  const items: string[] = [];
  for (const line of block.split('\n')) {
    if (LIST_ITEM.test(line) || items.length === 0) items.push(line);
    else items[items.length - 1] += `\n${line}`;
  }
  return items.filter((i) => i.trim() !== '');
}

/**
 * Is `shorter` the beginning of `longer`, at a word boundary?
 *
 * A cut-off item is not new information. The document that prompted this
 * carried *"8. Ask a local property manager"* where the other copy said
 * *"Ask a local property manager to confirm the achievable weekly rent"* — the
 * same obligation, truncated, and printing both puts a sentence fragment in a
 * client's checklist. The boundary test is what stops `Ask a local` matching
 * `Ask a locality survey`.
 */
export function isTruncationOf(shorter: string, longer: string): boolean {
  if (shorter.length < MIN_REPEATABLE || shorter.length >= longer.length) return false;
  if (!longer.startsWith(shorter)) return false;
  return longer[shorter.length] === ' ';
}

/** Split into blank-line-separated blocks, keeping a fenced region whole. */
function toBlocks(body: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (buf.join('\n').trim() !== '') out.push(buf.join('\n'));
    buf = [];
  };
  for (const line of (body || '').split('\n')) {
    const open = /^\s*(```|:::)/.exec(line);
    if (fence) {
      buf.push(line);
      if (new RegExp(`^\\s*${fence}\\s*$`).test(line)) { fence = null; flush(); }
      continue;
    }
    if (open) { flush(); fence = open[1]; buf.push(line); continue; }
    if (line.trim() === '') { flush(); continue; }
    buf.push(line);
  }
  if (fence) flush(); else flush();
  return out;
}

const headingDepth = (line: string): number => {
  const m = /^(#{1,6})[ \t]+\S/.exec(line);
  return m ? m[1].length : 0;
};

interface Region {
  /** 0 for the preamble, otherwise the section's own id (null when unresolved). */
  id: SectionId | null;
  heading: string | null;
  depth: number;
  lines: string[];
}

/** Split the document at its section level, keeping each heading with its body. */
function toRegions(markdown: string, level: SectionHeadingLevel): Region[] {
  const regions: Region[] = [{ id: null, heading: null, depth: 0, lines: [] }];
  let fence: string | null = null;
  for (const line of (markdown || '').split('\n')) {
    const open = /^\s*(```|:::)/.exec(line);
    if (fence) {
      if (new RegExp(`^\\s*${fence}\\s*$`).test(line)) fence = null;
      regions[regions.length - 1].lines.push(line);
      continue;
    }
    if (open) { fence = open[1]; regions[regions.length - 1].lines.push(line); continue; }
    const depth = headingDepth(line);
    const text = depth ? line.replace(/^#{1,6}[ \t]+/, '').trim() : '';
    if (depth === level && text && !isSubHeadingByNumbering(text)) {
      regions.push({ id: sectionIdForHeading(text), heading: line, depth, lines: [] });
      continue;
    }
    regions[regions.length - 1].lines.push(line);
  }
  return regions;
}

/**
 * The nested runs inside one region that name a section written elsewhere.
 *
 * A run starts at its heading and ends at the next heading of the same depth or
 * shallower, which is where that sub-section's own content stops.
 */
function straysIn(
  region: Region,
  level: SectionHeadingLevel,
  writtenElsewhere: ReadonlySet<SectionId>,
): Array<{ id: SectionId; heading: string; from: number; to: number }> {
  const out: Array<{ id: SectionId; heading: string; from: number; to: number }> = [];
  let fence: string | null = null;
  let open: { id: SectionId; heading: string; from: number; depth: number } | null = null;
  const close = (at: number) => {
    if (open) out.push({ id: open.id, heading: open.heading, from: open.from, to: at });
    open = null;
  };
  region.lines.forEach((line, i) => {
    const fenceAt = /^\s*(```|:::)/.exec(line);
    if (fence) { if (new RegExp(`^\\s*${fence}\\s*$`).test(line)) fence = null; return; }
    if (fenceAt) { fence = fenceAt[1]; return; }
    const depth = headingDepth(line);
    if (!depth) return;
    if (open && depth <= open.depth) close(i);
    if (depth <= level) return;
    const text = line.replace(/^#{1,6}[ \t]+/, '').trim();
    // Depth already says a numbered sub-heading is sub-structure; the registry
    // does not get a vote on that, for the reason `isSubHeadingByNumbering`
    // gives.
    if (isSubHeadingByNumbering(text)) return;
    const id = sectionIdForHeading(text);
    if (!id || id === region.id || !writtenElsewhere.has(id)) return;
    open = { id, heading: text, from: i, depth };
  });
  close(region.lines.length);
  return out;
}

export function foldStraySections(markdown: string): SectionFoldResult {
  if (!markdown || !markdown.includes('#')) return { markdown: markdown ?? '', folded: [] };
  const level = detectSectionLevel(markdown).level;
  const regions = toRegions(markdown, level);

  const atSectionLevel = new Set<SectionId>();
  for (const r of regions) if (r.id) atSectionLevel.add(r.id);
  if (atSectionLevel.size === 0) return { markdown, folded: [] };

  // What each region gives up, and what each region is handed.
  const carriedTo = new Map<SectionId, string[]>();
  const folded: FoldedSection[] = [];
  let changed = false;

  for (const region of regions) {
    const strays = straysIn(region, level, atSectionLevel);
    if (!strays.length) continue;
    // Later first, so an earlier splice never moves a later one's indices.
    for (const stray of [...strays].sort((a, b) => b.from - a.from)) {
      // A region that IS the target keeps its own sub-heading: a section
      // cannot be a stray copy of itself.
      if (stray.id === region.id) continue;
      const taken = region.lines.splice(stray.from, stray.to - stray.from);
      // The heading line goes with it and is then dropped — the section it
      // names already has a heading where it belongs, and carrying a second
      // one forward would print the title twice inside one section.
      const body = taken.slice(1).join('\n');
      const held = carriedTo.get(stray.id) ?? [];
      held.push(body);
      carriedTo.set(stray.id, held);
      folded.push({
        id: stray.id,
        from: region.id ?? stray.id,
        heading: stray.heading,
        carried: toBlocks(body).length,
        repeated: 0,
      });
      changed = true;
    }
  }

  if (!changed) return { markdown, folded: [] };

  const out: string[] = [];
  const used = new Set<SectionId>();
  for (const region of regions) {
    if (region.heading) out.push(region.heading);
    const carried = region.id && !used.has(region.id) ? carriedTo.get(region.id) : undefined;
    if (region.id && carried) {
      used.add(region.id);
      const keep: Array<{ text: string; key: string; list: boolean }> = [];
      let repeated = 0;
      /*
       * The carried copy was written FIRST in the document, so it leads; what
       * the section already said follows, minus whatever it repeats.
       *
       * Three outcomes per unit, and the third is the one that earns its
       * keep: an exact repeat goes, a truncation of something already kept
       * goes, and a unit that something already kept is a truncation OF
       * REPLACES it. That last case is what makes the order of the two copies
       * stop mattering — whichever said it in full is what the reader gets.
       */
      const units = [...carried, region.lines.join('\n')]
        .flatMap(toBlocks)
        .flatMap((block) => toUnits(block).map((text) => ({ text, list: isListBlock(block) })));
      for (const unit of units) {
        const key = blockKey(unit.text);
        if (key.length < MIN_REPEATABLE) { keep.push({ ...unit, key }); continue; }
        if (keep.some((k) => k.key === key || isTruncationOf(key, k.key))) { repeated += 1; continue; }
        const fuller = keep.findIndex((k) => isTruncationOf(k.key, key));
        if (fuller >= 0) { keep[fuller] = { ...unit, key }; repeated += 1; continue; }
        keep.push({ ...unit, key });
      }
      for (const f of folded) if (f.id === region.id) f.repeated = repeated;
      // Consecutive list items are one list again; everything else is a block.
      const rebuilt: string[] = [];
      keep.forEach((k, i) => {
        const joiner = i > 0 && k.list && keep[i - 1].list ? '\n' : '\n\n';
        rebuilt.push(i === 0 ? k.text : joiner + k.text);
      });
      out.push('', rebuilt.join(''), '');
      continue;
    }
    out.push(...region.lines);
  }

  return { markdown: out.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd(), folded };
}

/* ─── A composed section, written again by the model ──────────────────────── */

/**
 * The composed copy is the one that stands.
 *
 * ## What the reader got
 *
 * Measured on the 97 Poole Road Compass of 20 Sep 2026, read as a delivered
 * PDF. The document carries `Exit Outlook` on page 20 and `Resale Liquidity &
 * Exit Outlook` on page 34; `Monitoring Plan` on page 20 and `Monitoring &
 * Review Plan` on page 38. Two subjects, each covered twice, fourteen and
 * eighteen pages apart — and **the copies contradict each other.** The
 * composed Resale Liquidity opens:
 *
 * > Neither answers *how easily this sells*. Days on market, time to sell and
 * > buyer depth are not measured anywhere in this report, and no figure below
 * > should be read as standing in for them.
 *
 * The model's Exit Outlook, fourteen pages earlier, says "the cleanest exit
 * path is to sell into the owner-occupier market … the strongest exit result
 * usually comes from a well-presented, well-timed launch into a buyer pool
 * that already understands the locality." That is the claim the composed
 * section exists to refuse.
 *
 * ## The rule
 *
 * **Where a document carries two sections that resolve to one `computed`
 * registry entry, the copy under the entry's CANONICAL LABEL is the composed
 * one, and the other is a reproduction.** The reproduction goes.
 *
 * It is the rule `dedupeRegisterTables` already states for a table — *the
 * register's copy is the one that stands; it is the retrieval, every other
 * copy is a reproduction* — applied to a section, and it is stated the same
 * way for the same reason: the two disagreed, so keeping the longer or the
 * first would keep a model's expansion over the record.
 *
 * ## Why it could not fire before
 *
 * `Exit Outlook` and `Monitoring Plan` resolved to NOTHING —
 * `sectionIdForHeading` returned null, because neither was an alias. So the
 * document had one section the registry knew and one it did not, and no rule
 * anywhere could see they were the same subject. They are aliases now, which
 * is what an alias list is for, and that also stops `fork-investment-report`
 * dropping those headings from both children without saying so.
 *
 * ## Four bounds
 *
 * **Only a section `composeStrategySections` builds WHOLE** — the five in
 * `STRATEGY_SECTION_IDS`, read from that module rather than restated. Every
 * `computed` section in the registry would be too wide: `tenYear` is computed
 * too, and its aliases carry sub-heading names (`Property Value Projections`,
 * `Cumulative Cashflow Projections`) that a Financial report legitimately
 * writes as sections of their own beside the canonical one, so a wider rule
 * would delete real content. A `measured` or `authored` section has no
 * composed copy to prefer at all, so two of them is a plain repeat and
 * belongs to `foldStraySections` or to QA's `duplicate-h2`.
 *
 * **Exactly one of the copies must carry the canonical label.** If neither
 * does, or both do, nothing here can say which is the retrieval, and a rule
 * that cannot say that is not entitled to destroy a copy.
 *
 * **The canonical copy is kept wherever it sits**, first or last. Position is
 * what `dedupeChartDirectives` keys on and it is the wrong key here: the
 * composed section is appended after the model's prose, so "keep the first"
 * would keep the reproduction every time.
 *
 * **It is a no-op on a document that carries each section once**, which is
 * every document that was already right — byte for byte.
 */
const COMPOSED_WHOLE = new Set<string>(STRATEGY_SECTION_IDS);

const COMPUTED_SECTIONS = new Map<SectionId, string>(
  SECTION_REGISTRY
    .filter((e) => e.provenance === 'computed' && COMPOSED_WHOLE.has(e.id))
    .map((e) => [e.id, e.canonicalLabel]),
);

export interface DroppedReproduction {
  /** The registry section the document wrote twice. */
  readonly id: SectionId;
  /** The heading the reproduction carried. */
  readonly heading: string;
  /** The canonical heading that stands. */
  readonly kept: string;
  /** How many blocks went with it. */
  readonly blocks: number;
}

export interface ReproductionFoldResult {
  readonly markdown: string;
  readonly dropped: readonly DroppedReproduction[];
}

const headingTextOf = (line: string | null): string =>
  (line ?? '').replace(/^#{1,6}[ \t]+/, '').trim();

/** Drop every model-written copy of a section the platform composes. */
export function dropComposedSectionReproductions(markdown: string): ReproductionFoldResult {
  if (!markdown || !markdown.includes('#')) return { markdown: markdown ?? '', dropped: [] };
  const level = detectSectionLevel(markdown).level;
  const regions = toRegions(markdown, level);

  const byId = new Map<SectionId, number[]>();
  regions.forEach((r, i) => {
    if (!r.id || !COMPUTED_SECTIONS.has(r.id)) return;
    const at = byId.get(r.id) ?? [];
    at.push(i);
    byId.set(r.id, at);
  });

  const drop = new Set<number>();
  const dropped: DroppedReproduction[] = [];
  for (const [id, at] of byId) {
    if (at.length < 2) continue;
    const canonical = COMPUTED_SECTIONS.get(id)!;
    const isCanonical = (i: number) =>
      headingTextOf(regions[i].heading).toLowerCase() === canonical.toLowerCase();
    const keep = at.filter(isCanonical);
    // Neither copy is the composed one, or both claim to be: nothing here can
    // say which is the retrieval.
    if (keep.length !== 1) continue;
    for (const i of at) {
      if (i === keep[0]) continue;
      drop.add(i);
      dropped.push({
        id,
        heading: headingTextOf(regions[i].heading),
        kept: canonical,
        blocks: toBlocks(regions[i].lines.join('\n')).length,
      });
    }
  }

  if (!dropped.length) return { markdown, dropped: [] };

  const out: string[] = [];
  regions.forEach((r, i) => {
    if (drop.has(i)) return;
    if (r.heading) out.push(r.heading);
    out.push(...r.lines);
  });
  return {
    markdown: out.join('\n').replace(/[ \t]*\n(?:[ \t]*\n){2,}/g, '\n\n'),
    dropped,
  };
}

/**
 * A heading written twice around its own content is one heading.
 *
 * ## What pages 24 to 27 of the 9 Hollow Street Compass printed
 *
 * ```
 *   Planning controls & zoning
 *   The key planning finding is that the property sits in the General
 *   Residential Zone (GRZ) in the City of Greater Bendigo, with overlays
 *   checked and none mapped at this exact coordinate …
 *
 *   Planning controls & zoning
 *   • Finding: The property is in GRZ – General Residential Zone, as recorded
 *     by Vicmap Planning's plan_zone layer for Greater Bendigo …
 * ```
 *
 * The same sub-heading, twice, five lines apart, with nothing but its own
 * summary paragraph in between. Measured over the whole 39-page document:
 * **five sub-headings printed twice** — *Planning controls & zoning*,
 * *Environmental overlays (flood, bushfire, contamination)*, *Crime & personal
 * safety*, *Local supply & future development pressure* and *Transport
 * reliance* — which is every risk in the register, each one announced, summed
 * up, and then announced again before its detail.
 *
 * A reader meeting the heading a second time has to decide whether they have
 * lost their place or whether a new section has started with the same name.
 * Neither is true: it is one topic, written in two passes.
 *
 * ## The rule
 *
 * **Where the same heading is written twice with no other heading between
 * them, the second is a reproduction and the content merges under the
 * first.** That is `dedupeRegisterTables`' rule applied to a heading, and it
 * MERGES rather than choosing, because the two bodies are different — a
 * summary and its evidence — and keeping either alone would delete half the
 * section. Only the duplicate heading line goes; every word under both stays,
 * in the order it was written.
 *
 * ## Three bounds
 *
 * **Another heading between them ends it.** `lastHeading` is the most recent
 * heading of ANY depth, so a deeper sub-heading intervening means the repeat
 * opens something structurally new and it is left alone. This is the
 * conservative side: a heading that should have gone stays, and nothing that
 * organises a document is ever removed.
 *
 * **A distant repeat is not a reproduction.** The measured gap is one
 * paragraph; the bound is six blocks, which admits every occurrence in the
 * document that found this and refuses a `## Notes` recurring much later,
 * where dropping the heading would take away a landmark the reader wanted.
 *
 * **A heading inside a fence is not a heading.** The `:::` and ``` regions are
 * carried whole, for the same reason `toBlocks` carries them whole.
 *
 * Byte-identical on a document that announces each section once.
 */
export interface MergedHeadingResult {
  readonly markdown: string;
  /** The duplicate heading lines that were removed, as written. */
  readonly merged: readonly string[];
}

/** The measured gap is one block; six is generous and still local. */
const MAX_BLOCKS_BETWEEN_TWINS = 6;

const headingTextKey = (line: string): string =>
  line.replace(/^#{1,6}[ \t]+/, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A heading written twice in a row, at two depths, is one heading.
 *
 * The rule above requires the same depth, and on the 60 Lawley Street Compass
 * (25 Sep 2026) the risk register grouped its risks under a heading and then
 * opened each risk with a heading of its own — so where a group held one risk
 * of the same name the page printed "Crime and personal safety" twice, one line
 * above the other, and again "Infrastructure timing". At the foot of page 18
 * the pair was stranded together, because the second was set as a bold line
 * rather than a heading and the packer keeps only headings with what follows.
 *
 * So: where two heading-like lines carry the same words with NOTHING between
 * them but blank lines, one goes. A real heading outranks a bold line standing
 * in for one, whichever came first, so the document keeps its structure; of
 * two real headings the first stays. Nothing else is touched — a single line of
 * content between them means the second opens something, and it is left.
 */
const BOLD_LINE = /^\s*(\*\*|__)([^*_\n]{2,160}?)\1:?\s*$/;

function foldAdjacentTwinHeadings(src: string): { markdown: string; merged: string[] } {
  const lines = src.split('\n');
  const drop = new Set<number>();
  const merged: string[] = [];
  let fence: string | null = null;
  // The last heading-like line with only blank lines after it, or null.
  let prev: { index: number; key: string; heading: boolean } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = /^\s*(```|:::)/.exec(line);
    if (fence) {
      if (new RegExp(`^\\s*${fence}\\s*$`).test(line)) fence = null;
      continue;
    }
    if (open) { fence = open[1]; prev = null; continue; }
    if (line.trim() === '') continue;

    const depth = headingDepth(line);
    const bold = depth ? null : BOLD_LINE.exec(line);
    if (!depth && !bold) { prev = null; continue; }

    const key = depth ? headingTextKey(line) : bold![2].replace(/\s+/g, ' ').trim().toLowerCase();
    const isHeading = depth > 0;
    if (prev && prev.key === key && key !== '') {
      // One of the two goes: the bold stand-in if there is one, else the second.
      const loser = !prev.heading && isHeading ? prev.index : i;
      drop.add(loser);
      merged.push(lines[loser].trim());
      if (loser === prev.index) prev = { index: i, key, heading: isHeading };
      continue;
    }
    prev = { index: i, key, heading: isHeading };
  }

  if (!drop.size) return { markdown: src, merged: [] };
  const out = lines.filter((_, i) => !drop.has(i)).join('\n');
  return { markdown: out.replace(/[ \t]*\n(?:[ \t]*\n){2,}/g, '\n\n'), merged };
}

export function mergeAdjacentDuplicateHeadings(markdown: string): MergedHeadingResult {
  const raw = String(markdown ?? '');
  if (!raw.includes('#') && !raw.includes('**') && !raw.includes('__')) return { markdown: raw, merged: [] };
  const twins = foldAdjacentTwinHeadings(raw);
  const src = twins.markdown;
  if (!src.includes('#')) return { markdown: src, merged: twins.merged };

  const lines = src.split('\n');
  const merged: string[] = [...twins.merged];
  const drop = new Set<number>();
  let fence: string | null = null;
  let last: { depth: number; key: string } | null = null;
  let blocksSince = 0;
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = /^\s*(```|:::)/.exec(line);
    if (fence) {
      if (new RegExp(`^\\s*${fence}\\s*$`).test(line)) fence = null;
      continue;
    }
    if (open) { fence = open[1]; if (!inBlock) { inBlock = true; blocksSince++; } continue; }

    if (line.trim() === '') { inBlock = false; continue; }

    const depth = headingDepth(line);
    if (!depth) {
      if (!inBlock) { inBlock = true; blocksSince++; }
      continue;
    }

    inBlock = false;
    const key = headingTextKey(line);
    if (last && last.depth === depth && last.key === key && blocksSince <= MAX_BLOCKS_BETWEEN_TWINS) {
      drop.add(i);
      merged.push(line.trim());
      blocksSince = 0;
      // `last` is deliberately not advanced: a heading written three times
      // folds onto the first, not onto its own second copy.
      continue;
    }
    last = { depth, key };
    blocksSince = 0;
  }

  if (!drop.size) return { markdown: src, merged };
  const out = lines.filter((_, i) => !drop.has(i)).join('\n');
  return { markdown: out.replace(/[ \t]*\n(?:[ \t]*\n){2,}/g, '\n\n'), merged };
}
