/**
 * The generator's live code path may not name a binding that is not in scope.
 *
 * On 2026-09-19 this function answered HTTP 500 to **every** POST from 12:00
 * onward — 23 of 23 measured — and the two causes were both this one class:
 *
 *   - `{ propertySpecs, … }` and `{ dataSources, … }` at the Compass strategy
 *     record read two `const`s declared 2,200 lines below, inside the
 *     `if (reportId && supabaseClient)` block that writes the row. That block
 *     is a CHILD of the one doing the reading, so neither name existed. The
 *     handler threw the moment acquisition finished, before section 1 was ever
 *     attempted, which is why the report never reached section 2.
 *
 *   - `if (requestBody?.reportId)` is the first statement of the `catch`, and
 *     `let requestBody` was declared inside the `try`. A `catch` is a SIBLING
 *     of the block it guards. So the error path threw before it could return
 *     its own 500 — and the bare 500 the platform serves in place of a handler
 *     that throws carries none of this function's CORS headers, which is why
 *     every server error reached the browser as a CORS / network failure.
 *
 * Why a test and not just the CI gate: `deno check` now treats all four
 * spellings as fatal (see `scripts/security/check-edge-functions.mjs`), but
 * that gate needs Deno and does not run locally. This runs in the ordinary
 * suite, on the ordinary `npm test`, before anybody pushes.
 *
 * It asserts the PROPERTY — every read of a name is inside the scope of a
 * declaration that precedes it — rather than the presence of particular lines,
 * so moving the code around keeps the test meaningful.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const GENERATOR = resolve(
  __dirname,
  '../../../../supabase/functions/generate-investment-report/index.ts',
);
const source = readFileSync(GENERATOR, 'utf8');
const ast = ts.createSourceFile(GENERATOR, source, ts.ScriptTarget.ES2022, true);

/** The nearest enclosing thing that introduces a `let`/`const` scope. */
const scopeOf = (node: ts.Node): ts.Node => {
  let n: ts.Node | undefined = node.parent;
  while (n) {
    if (
      ts.isBlock(n) || ts.isSourceFile(n) || ts.isCaseBlock(n)
      || ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)
    ) return n;
    n = n.parent;
  }
  return ast;
};

const encloses = (outer: ts.Node, inner: ts.Node): boolean => {
  let n: ts.Node | undefined = inner;
  while (n) {
    if (n === outer) return true;
    n = n.parent;
  }
  return false;
};

interface Site { line: number; text: string }
const at = (node: ts.Node): Site => ({
  line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
  text: source.split('\n')[ast.getLineAndCharacterOfPosition(node.getStart(ast)).line].trim(),
});

/**
 * Every read of `name` that no preceding, enclosing declaration of `name`
 * covers. An empty array is the whole point.
 */
function unscopedReads(name: string): Site[] {
  const declarations: ts.VariableDeclaration[] = [];
  const reads: ts.Identifier[] = [];

  (function walk(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      declarations.push(node);
    }
    if (ts.isIdentifier(node) && node.text === name) {
      const p = node.parent;
      const isOwnDeclarationName = ts.isVariableDeclaration(p) && p.name === node;
      // `a.name` — the right-hand identifier is a property, not a binding.
      const isPropertyName = ts.isPropertyAccessExpression(p) && p.name === node;
      // `{ name: value }` — the key is not a read. `{ name }` IS one.
      const isPropertyKey = ts.isPropertyAssignment(p) && p.name === node;
      const isBindingName = ts.isBindingElement(p) && p.name === node;
      const isParameterName = ts.isParameter(p) && p.name === node;
      if (!isOwnDeclarationName && !isPropertyName && !isPropertyKey && !isBindingName && !isParameterName) {
        reads.push(node);
      }
    }
    ts.forEachChild(node, walk);
  })(ast);

  // No declaration at all is the strictest case, not an excuse: a bare
  // identifier the file never declares is either an import, a global, or a
  // guaranteed ReferenceError — and `queryType` was the third.
  return reads
    .filter((read) => !declarations.some((decl) => (
      decl.getEnd() < read.getStart(ast) && encloses(scopeOf(decl), read)
    )))
    .map(at);
}

describe('the generator names nothing it does not hold', () => {
  // The four identifiers the 19 Sep outage was made of. Each is listed by
  // name because each was a real, measured production 500 — not because the
  // check is limited to them.
  it.each([
    ['propertySpecs', 'the Compass strategy record — threw before section 1'],
    ['dataSources', 'the same object literal, three lines below'],
    ['requestBody', 'the catch block — turned every 500 into a CORS error'],
    ['queryType', 'area scoring — threw on every suburb/postcode/statewide report'],
  ])('%s is in scope everywhere it is read (%s)', (name) => {
    const bad = unscopedReads(name);
    expect(
      bad,
      `${name} is read where no preceding declaration covers it:\n`
      + bad.map((s) => `  L${s.line}: ${s.text}`).join('\n'),
    ).toEqual([]);
  });
});

describe('the error path cannot itself throw', () => {
  /*
   * An error handler that can throw turns every server error into a CORS
   * error, because the platform's own 500 carries none of this function's
   * headers. So the bookkeeping is optional and the response is not: the
   * `return` must sit OUTSIDE the try that guards the bookkeeping.
   */
  it('returns the CORS-bearing 500 outside the guard around its bookkeeping', () => {
    // The handler-level catch is the one guarding the widest try in the file.
    const catches: ts.CatchClause[] = [];
    (function walk(node: ts.Node) {
      if (ts.isCatchClause(node)) catches.push(node);
      ts.forEachChild(node, walk);
    })(ast);
    expect(catches.length, 'the file has catch clauses').toBeGreaterThan(0);
    const handler = catches.reduce((widest, c) => (
      (c.parent.end - c.parent.pos) > (widest.parent.end - widest.parent.pos) ? c : widest
    ));

    const statements = handler.block.statements;
    const last = statements[statements.length - 1];
    expect(ts.isReturnStatement(last), 'the handler ends by returning a response').toBe(true);
    expect(last.getText(ast)).toContain('corsHeaders');
    expect(last.getText(ast)).toContain('500');

    // Everything before that return must be logging, a local, or work inside
    // a guard of its own. An unguarded await here is what cost the CORS
    // headers: a throw at this point escapes the handler entirely.
    const isLogging = (s: ts.Statement) => ts.isExpressionStatement(s)
      && ts.isCallExpression(s.expression)
      && s.expression.expression.getText(ast).startsWith('console.');
    const unguarded = statements.slice(0, -1).filter((s) => !(
      ts.isTryStatement(s) || ts.isVariableStatement(s) || isLogging(s)
    ));
    expect(
      unguarded.map((s) => s.getText(ast).split('\n')[0]),
      'every statement before the return is logging, a local, or guarded',
    ).toEqual([]);
  });
});

describe('the CI gate that should have caught this', () => {
  const gate = readFileSync(
    resolve(__dirname, '../../../../scripts/security/check-edge-functions.mjs'),
    'utf8',
  );
  const frozen = readFileSync(
    resolve(__dirname, '../../../../supabase/functions-registry/edge-missing-names.txt'),
    'utf8',
  );

  it('treats every spelling of "this name does not exist" as fatal', () => {
    // TS2304/TS2552 were fatal and TS18004 was not, so the SHORTHAND form —
    // which is how this repository passes almost everything around — was
    // absorbed by the count baseline and shipped.
    //
    // Read from LIVE lines only. A commented-out entry still contains the
    // string, and the first version of this test passed while the gate had
    // been switched off — which is the same mistake in miniature.
    const live = gate
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return t.length > 0 && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    for (const code of ['TS2304', 'TS2552', 'TS18004', 'TS2448', 'TS2454']) {
      expect(live, `${code} is fatal on a live line`).toContain(`['${code}',`);
    }
  });

  it('can read the identifier out of each of those messages', () => {
    // A freeze entry is keyed by identifier. A code whose message the gate
    // cannot parse yields no key, is never matched against the freeze list and
    // is therefore always reported — but it must still be able to read the
    // ones it does know, or a real freeze silently stops applying.
    expect(gate).toContain("Cannot find name '([^']+)'");
    expect(gate).toContain("shorthand property '([^']+)'");
  });

  it('no longer freezes the two the outage was made of', () => {
    expect(frozen).not.toContain('generate-investment-report/index.ts::requestBody');
    expect(frozen).not.toContain('generate-investment-report/index.ts::queryType');
  });
});
