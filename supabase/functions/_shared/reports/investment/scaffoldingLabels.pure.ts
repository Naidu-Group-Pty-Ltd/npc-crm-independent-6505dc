/**
 * Words from OUR prompt, printed on a client's page as if they were the report's.
 *
 * Two, both measured on the Compass for 60 Lawley Street, Spalding delivered on
 * 25 Sep 2026:
 *
 *  - page 10 closed the planning chapter with
 *    `ConfidenceChip: Desktop retrieval — parcel-level planning confirmation
 *    required`. `confidenceChip` is a registry identifier the section guide
 *    listed as a "required component"; the model wrote it as a label.
 *  - page 7 headed a table column **"Date something happened"** — a phrase from
 *    the infrastructure section's own purpose, which told the model to give
 *    "the date something HAPPENED (a gazettal, a determination, a funding
 *    decision)".
 *
 * Both instructions are reworded at the source (`compassSectionContract` and
 * the registry purpose), and that is a request. This is the guarantee for the
 * documents already stored and for a model that routes around the rewording —
 * the rule `stripEditorialBlocks` and `rewriteScaffoldingPointers` answer to.
 *
 * ## What it touches, and nothing else
 *
 * **A component identifier used as a LABEL** — at the start of a line or a list
 * item, optionally bold, followed by a colon. The words after the colon are the
 * model's statement and are kept; only the identifier is replaced, by the word
 * a reader would use ("Confidence") or by nothing where there is no such word.
 * An identifier elsewhere in a sentence is not a label and is left alone.
 *
 * **A table header cell that is our phrase verbatim**, replaced with the
 * column's name. A body cell is never touched: a header is structure, a cell
 * is a finding.
 *
 * Byte-identical on a document that carries neither.
 */

/** Registry component ids → the label a reader would use, or '' for none. */
const COMPONENT_LABEL: Readonly<Record<string, string>> = {
  confidenceChip: 'Confidence',
  attributeTable: '',
  amenityMatrix: '',
  planningActionTable: '',
  infrastructureTimeline: '',
  strengthsWatchPoints: '',
  riskRegister: '',
  dueDiligenceChecklist: '',
  kpiTiles: '',
  trendTable: '',
};

/**
 * `confidenceChip` also matches `ConfidenceChip` and `confidence_chip` — the
 * identifier's own spellings. Never the words with a SPACE between them:
 * "Risk register:" is an ordinary lead-in a writer may use, and only the
 * joined-up form is unmistakably ours.
 */
const idPattern = (id: string): string =>
  id.replace(/([a-z])([A-Z])/g, '$1_?$2');

const LABEL_RE = new RegExp(
  String.raw`^(\s*(?:[-*+]\s+)?)(\*\*|__)?(`
  + Object.keys(COMPONENT_LABEL).map(idPattern).join('|')
  + String.raw`)(\*\*|__)?\s*:\s*(\*\*|__)?\s*`,
  'i',
);

const labelFor = (matched: string): string => {
  const key = matched.replace(/_/g, '').toLowerCase();
  const id = Object.keys(COMPONENT_LABEL).find((k) => k.toLowerCase() === key);
  return id ? COMPONENT_LABEL[id] : '';
};

/** Our phrases, as a model has set them in a table header, → the column's name. */
const HEADER_PHRASES: ReadonlyArray<[RegExp, string]> = [
  [/^date something happened$/i, 'Recorded milestone date'],
];

export interface ScaffoldingLabelResult {
  readonly markdown: string;
  /** What was replaced, in document order. */
  readonly replaced: readonly string[];
}

const isRow = (l: string) => /^\s*\|/.test(l);
const isRule = (l: string) => /^\s*\|[\s:|-]+\|?\s*$/.test(l) && /-/.test(l);

export function stripScaffoldingLabels(markdown: string): ScaffoldingLabelResult {
  const src = String(markdown ?? '');
  if (!src) return { markdown: '', replaced: [] };
  const lines = src.split('\n');
  const replaced: string[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (open) { fence = open[1]; continue; }

    const m = LABEL_RE.exec(line);
    if (m) {
      const word = labelFor(m[3]);
      const rest = line.slice(m[0].length).replace(/^(\*\*|__)\s*/, '');
      if (rest.trim()) {
        lines[i] = `${m[1]}${word ? `${word}: ` : ''}${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
        replaced.push(m[3]);
        continue;
      }
    }

    // A header row is the row directly above a rule row.
    if (isRow(line) && i + 1 < lines.length && isRule(lines[i + 1])) {
      const cells = line.split('|');
      let changed = false;
      for (let c = 0; c < cells.length; c++) {
        const bare = cells[c].replace(/\*\*|__/g, '').trim();
        for (const [re, name] of HEADER_PHRASES) {
          if (re.test(bare)) {
            cells[c] = cells[c].replace(cells[c].trim(), name);
            replaced.push(bare);
            changed = true;
          }
        }
      }
      if (changed) lines[i] = cells.join('|');
    }
  }

  if (!replaced.length) return { markdown: src, replaced: [] };
  return { markdown: lines.join('\n'), replaced };
}
