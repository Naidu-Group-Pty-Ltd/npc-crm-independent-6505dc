#!/usr/bin/env node
/**
 * Status ink must match the fill it sits on.
 *
 * ## The rule
 *
 * `--warning-foreground`, `--info-foreground`, `--success-foreground` and
 * `--destructive-foreground` are the ink for a **solid** fill of that colour.
 * In dark mode they are close to black, because that is what reads on a solid
 * amber or green block.
 *
 * Put that ink on a 10% TINT of the same colour and it is near-black on a
 * near-black panel. The text is present, correctly sized, and unreadable.
 * On a tint the right ink is the tone itself — `text-warning` on
 * `bg-warning/10` — which is what `pipelineBadgeStyles.ts` has always used.
 *
 * ## Why a gate
 *
 * This is not a subtle mistake, it is an easy one: `bg-success/10` and
 * `text-success-foreground` look like a matching pair. It was reported in
 * **three consecutive audits** — twice against the deal pipeline and the
 * agreements capsule, then against a recipient warning in the email composer
 * ("there is some kind of warning but I can't read it"). Each time one
 * instance was fixed. A sweep then found **112 more**, across 40 files.
 *
 * So the class is closed here rather than the instance: the sweep took the
 * count to zero and this keeps it there.
 *
 * ## What counts
 *
 * A line carrying `text-<tone>-foreground` where the same line sets a
 * background of the SAME tone at **30% or less** and sets no solid fill of
 * it. The opacity threshold is the whole judgement:
 *
 * - `bg-success/10 text-success-foreground` — unreadable, a violation.
 * - `bg-success/90 text-success-foreground` — 90% is effectively solid and
 *   the `-foreground` ink is CORRECT. Not a violation.
 * - `bg-destructive text-destructive-foreground hover:bg-destructive/90` —
 *   a solid fill with a hover tint. Correct, and left alone.
 *
 * Between 31% and 59% nothing is judged: it is genuinely a design call, and
 * a gate that guesses there would be argued with rather than obeyed. The
 * sweep found zero cases in that band.
 *
 * A background inherited from a parent element is not judged either — this
 * reads one line at a time and cannot see the cascade. That is a deliberate
 * limit: it means the gate never fails a line it cannot prove wrong.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

/** Tones whose `-foreground` is ink for a solid fill. */
const TONES = ['warning', 'info', 'success', 'destructive'];
/** At or below this, the background is a tint and the solid ink is wrong. */
const TINT_MAX = 30;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  if (!TONES.some((t) => src.includes(`text-${t}-foreground`))) continue;
  const lines = src.split('\n');
  lines.forEach((line, index) => {
    for (const tone of TONES) {
      if (!new RegExp(String.raw`\btext-${tone}-foreground`).test(line)) continue;
      // A solid fill of the same tone anywhere on the line makes it correct.
      if (new RegExp(String.raw`\bbg-${tone}(?![-/\w])`).test(line)) continue;
      // Both spellings of a tint: `bg-success/10` and the arbitrary
      // `bg-success/[0.08]`, normalised to the same percentage scale.
      const opacities = [
        ...[...line.matchAll(new RegExp(String.raw`bg-${tone}/(\d+)(?![\d/.])`, 'g'))]
          .map((m) => Number(m[1])),
        ...[...line.matchAll(new RegExp(String.raw`bg-${tone}/\[(0?\.\d+)\]`, 'g'))]
          .map((m) => Number(m[1]) * 100),
      ];
      if (opacities.length === 0) continue;      // no background here to judge against
      if (Math.max(...opacities) > TINT_MAX) continue;
      violations.push({ file: file.slice(ROOT.length), line: index + 1, tone });
    }
  });
}

if (violations.length > 0) {
  console.error(`\nStatus ink on a tint of its own colour: ${violations.length}\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  text-${v.tone}-foreground on a bg-${v.tone}/<=30 tint`);
  }
  console.error(`
\`text-<tone>-foreground\` is the ink for a SOLID fill and is near-black in
dark mode. On a 10% tint it is invisible. Use the tone itself:

  -  <div className="border-warning/40 bg-warning/10 text-warning-foreground">
  +  <div className="border-warning/40 bg-warning/10 text-warning">

Keep \`-foreground\` where the fill really is solid (\`bg-warning\`, or an
opacity above ${TINT_MAX}%) — that is what it is for.
`);
  process.exit(1);
}

console.log('Status-ink contrast check passed (no solid-fill ink on a tinted background).');
