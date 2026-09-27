/**
 * "How this grade was reached" is drawn from the record, on every read.
 *
 * ## What was wrong
 *
 * The 37 Bolin Street Compass and the Financial Analysis forked from it
 * (27 Sep 2026) both printed the grade appendix and stopped after its third
 * bullet — Capital growth, Location, Rental yield — with Demand, Property risk,
 * "How the grade follows", the coverage statement and the closing line gone,
 * and nothing on the page saying so. An earlier render of the same property
 * stopped after the second bullet. The Financial printed the same cut from its
 * own copy, which is taken from the stored Compass on the server, so the loss
 * travels WITH the stored document rather than arising in one renderer: every
 * render path, the fork and the read-path hygiene were each driven over the
 * complete block and each kept it whole (20,500 template renders among them).
 *
 * ## The rule
 *
 * The section is COMPOSED — `composeGradeMethodology` reads nothing but the
 * row's `investment_score` — so a stored copy of it is never the authority.
 * Wherever a document carries the heading, the section under it is replaced
 * with the one the record composes now: complete, in today's wording, and
 * identical on the Compass and on every document derived from it. The same
 * rule `healFinanceIdentity` follows for the finance block: healed on READ,
 * never migrated, so every stored report is repaired for every reader with no
 * stored byte overwritten.
 *
 * Three bounds.
 *
 *  - **It never adds the section.** A document that does not carry the
 *    heading (the Snapshot, the Due Diligence report, scoring switched off)
 *    is returned unchanged: where the method belongs is the tier's decision,
 *    not this module's.
 *  - **It never invents one.** Where the record composes nothing (no score,
 *    or no dimension scored) the stored section stands as written.
 *  - **It keeps what is not the method.** Footnote definitions and a closing
 *    rule that happen to sit inside the stored section are carried over, so
 *    a note the body cites is never lost with the section it trailed.
 *
 * Pure: markdown and the stored score in, markdown out.
 */
import { composeGradeMethodology, readStrategyRecord } from './strategyPositions.pure.ts';

export const GRADE_METHODOLOGY_HEADING = 'How this grade was reached';

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FOOTNOTE_DEFINITION = /^\[\^[^\]]+\]:/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

const isMethodHeading = (title: string) =>
  title.replace(/\*\*/g, '').replace(/^\s*\d+[.)]\s*/, '').trim().toLowerCase()
    === GRADE_METHODOLOGY_HEADING.toLowerCase();

/** The method the record composes, at the heading level the document uses. */
function composedAt(level: number, investmentScore: unknown): string | null {
  const record = readStrategyRecord(
    { investmentScore },
    {
      market: { rows: [], withheld: [], unavailable: [], consulted: [], anyStated: false, evidenceMissing: true },
      price: { basis: 'not_recorded', value: null, label: 'Purchase price', provenance: null },
      carriesModelling: false,
    },
  );
  const composed = composeGradeMethodology(record);
  if (!composed || !composed.trim()) return null;
  const lines = composed.trim().split('\n');
  const first = HEADING.exec(lines[0]);
  if (!first || !isMethodHeading(first[2])) return null;
  lines[0] = `${'#'.repeat(level)} ${first[2]}`;
  return lines.join('\n');
}

export interface GradeMethodologyRestoration {
  markdown: string;
  /** True where a stored section was replaced by the composed one. */
  restored: boolean;
}

export function restoreGradeMethodology(markdown: string, investmentScore: unknown): GradeMethodologyRestoration {
  const source = typeof markdown === 'string' ? markdown : '';
  if (!source || !source.toLowerCase().includes(GRADE_METHODOLOGY_HEADING.toLowerCase())) {
    return { markdown: source, restored: false };
  }
  const lines = source.split('\n');
  const at = lines.findIndex((line) => {
    const m = HEADING.exec(line.trim());
    return !!m && isMethodHeading(m[2]);
  });
  if (at === -1) return { markdown: source, restored: false };
  const level = HEADING.exec(lines[at].trim())![1].length;

  const composed = composedAt(level, investmentScore);
  if (!composed) return { markdown: source, restored: false };

  // The section runs to the next heading at the same or a shallower level.
  let end = at + 1;
  while (end < lines.length) {
    const m = HEADING.exec(lines[end].trim());
    if (m && m[1].length <= level) break;
    end += 1;
  }
  const kept = lines.slice(at + 1, end).filter((l) => FOOTNOTE_DEFINITION.test(l.trim()));
  // A closing rule that separated this section from the next one stays.
  const tail = lines.slice(at + 1, end).map((l) => l.trim()).filter(Boolean);
  const closingRule = tail.length > 0 && RULE.test(tail[tail.length - 1]);

  const replacement = [
    composed,
    ...(kept.length ? ['', ...kept] : []),
    ...(closingRule ? ['', '---'] : []),
    '',
  ];
  const out = [...lines.slice(0, at), ...replacement, ...lines.slice(end)];
  const next = out.join('\n');
  return { markdown: next, restored: next !== source };
}
