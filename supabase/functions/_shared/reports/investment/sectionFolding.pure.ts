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
import {
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
