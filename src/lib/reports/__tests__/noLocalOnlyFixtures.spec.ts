/**
 * No test may READ a path the repository does not carry.
 *
 * `s1Annabelle.spec.ts` read `reports/fixtures/annabelle-row.json` — a real
 * stored row held locally and gitignored, because it is a customer's record.
 * The file exists on the machine that wrote the test and can never exist on a
 * runner, so the suite passed locally and failed CI with `ENOENT`: a gate that
 * only ever ran where it could not fail. That is worse than no gate, because
 * it reads as one. A harness that needs real data is a script under
 * `scripts/reports/`, and it says so when the data is absent.
 *
 * **The rule is about reading, not naming.** `/reports/` is gitignored and
 * several specs deliberately WRITE a rendered document into `reports/html/`
 * so a person can look at it — `writeRenderArtifact` is that pattern, and
 * `scripts/reports/renderAll.mts` is what reads them back. A write creates
 * what it needs (every one of them calls `mkdirSync(…, { recursive: true })`)
 * and runs identically on a runner; a read requires something CI cannot have.
 * Forbidding the write would delete the only way anybody sees these documents.
 *
 * How it judges, stated plainly because a gate nobody can predict gets
 * worked around: comments are stripped, then every call to a filesystem READ
 * is taken with its first argument, and that argument is rejected if it names
 * a gitignored directory itself or names an identifier declared from one.
 * Constants are tracked within the one file — a path assembled across modules
 * is beyond this check, and that limit is deliberate rather than overlooked.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = resolve(process.cwd());

/** Every tracked spec and test file. `git ls-files` is the repository's view. */
const specs = execFileSync('git', ['ls-files', '*.spec.ts', '*.spec.tsx', '*.test.ts', '*.test.tsx'], {
  cwd: REPO, encoding: 'utf8',
}).trim().split('\n').filter(Boolean);

/**
 * Directories the repository deliberately does not carry. `/reports/` holds
 * exported production rows and rendered documents; both are real customer
 * data and both are ignored on purpose (`.gitignore`, anchored `/reports/`).
 */
const LOCAL_ONLY = /(?:^|['"`/\s(])reports\/(?:fixtures|pdf|html)\//;

/** Reads that need the file to already be there. Writes are not listed. */
const READS = [
  'readFileSync', 'readFile', 'existsSync', 'statSync', 'lstatSync', 'openSync',
  'createReadStream', 'readdirSync', 'readdir', 'accessSync', 'access', 'realpathSync',
];

/** Strip block and line comments, so prose describing the rule is not the rule. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The first argument of `fn(...)`, by balancing parentheses from the open. */
function firstArgument(code: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(openParen + 1, i);
    } else if (ch === ',' && depth === 1) return code.slice(openParen + 1, i);
  }
  return code.slice(openParen + 1);
}

/** Identifiers in this file whose declaration names a gitignored directory. */
function taintedNames(code: string): string[] {
  const names: string[] = [];
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*(?:\n\s+[^;\n]*)*)/g)) {
    if (LOCAL_ONLY.test(m[2])) names.push(m[1]);
  }
  return names;
}

describe('no spec reads a path the repository does not carry', () => {
  it('finds every spec', () => {
    expect(specs.length).toBeGreaterThan(100);
  });

  it('and none of them reads from a gitignored data directory', () => {
    const offenders: string[] = [];
    for (const spec of specs) {
      const code = stripComments(readFileSync(resolve(REPO, spec), 'utf8'));
      if (!LOCAL_ONLY.test(code)) continue;
      const tainted = taintedNames(code);
      for (const fn of READS) {
        for (const m of code.matchAll(new RegExp(`\\b${fn}\\s*\\(`, 'g'))) {
          const arg = firstArgument(code, m.index! + m[0].length - 1);
          const named = tainted.find((n) => new RegExp(`\\b${n}\\b`).test(arg));
          if (LOCAL_ONLY.test(arg)) offenders.push(`${spec} → ${fn}(${arg.trim()})`);
          else if (named) offenders.push(`${spec} → ${fn}(…${named}…)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('still sees a read it is meant to catch', () => {
    // The shape `s1Annabelle.spec.ts` had, judged by the same code path.
    const code = stripComments(
      "const ROW = resolve(REPO, 'reports/fixtures/annabelle-row.json');\n" +
      'const row = JSON.parse(readFileSync(ROW, "utf8"));\n',
    );
    const tainted = taintedNames(code);
    const at = code.indexOf('readFileSync(') + 'readFileSync'.length;
    const arg = firstArgument(code, at);
    expect(tainted).toContain('ROW');
    expect(tainted.some((n) => new RegExp(`\\b${n}\\b`).test(arg))).toBe(true);
  });
});
