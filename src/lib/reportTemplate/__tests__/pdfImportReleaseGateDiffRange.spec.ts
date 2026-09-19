/**
 * The release gate must scan what the branch changed, not what the base did.
 *
 * ## The defect
 *
 * `pdf-import-release-gate.mjs` collected its candidate files with
 * `git diff --name-only <base> HEAD` — a **two-dot** diff, which reports every
 * difference between the two commits. That includes files the *base* gained
 * after the branch diverged, and the artifact scan classifies purely by path:
 * any `.png`/`.jpg`/`.webp` is a "generated image", any `.pdf` a private one.
 *
 * So when `public/brand/aurixa-emblem.png` — a legitimate brand asset — was
 * committed to main, every open pull request whose branch predated it failed
 * the gate `[critical] no_generated_images_staged`, naming a file its author
 * had never touched. Reproduced on the real commits: two-dot from that base
 * lists the emblem, the merge-base range lists nothing.
 *
 * ## The rule
 *
 * The range is `<merge-base> HEAD` — the three-dot range, the set of files the
 * pull request is actually proposing. The workflow checks out with
 * `fetch-depth: 0` so the merge base is computable, and this asserts that too:
 * a shallow checkout would silently degrade the range for every run.
 *
 * The fallback direction is the other half of the rule. When no merge base can
 * be found the script falls back to the base commit — the old, **over**-
 * inclusive behaviour — because a false alarm costs a re-run while a missed
 * artifact is a client PDF or a `.env` in the repository, which is the whole
 * point of the check.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const SCRIPT = readFileSync(join(ROOT, 'scripts/regression/pdf-import-release-gate.mjs'), 'utf8');
const WORKFLOW = readFileSync(
  join(ROOT, '.github/workflows/pdf-import-release-gate.yml'), 'utf8',
);

const code = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the candidate-file range', () => {
  it('is taken from the merge base', () => {
    expect(code).toMatch(/git merge-base \$\{baseCommit\} HEAD/);
  });

  it('never diffs the base commit against HEAD directly', () => {
    // The two-dot form is the defect. Written as a negative because the fix is
    // one token away from being undone by someone simplifying the expression.
    expect(
      code,
      'a two-dot diff reports files the base changed, which this branch never touched',
    ).not.toMatch(/git diff --name-only \$\{baseCommit\} HEAD/);
  });

  it('falls back to the base commit rather than to nothing', () => {
    // An empty range would scan no files and pass everything — the silent
    // direction, and the one this check exists to prevent.
    expect(code).toMatch(/git merge-base[^\n]*\n?[^\n]*\|\| baseCommit/);
  });

  it('is computable, because the workflow fetches the whole history', () => {
    expect(WORKFLOW).toMatch(/fetch-depth:\s*0/);
  });
});
