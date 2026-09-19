/**
 * `secure-storage` may only name columns the tables actually have.
 *
 * The upload binding for the `investment-reports` bucket selected
 * `id, client_id, created_by` from `investment_reports`. That table has never
 * had either of the last two — it names them `client_property_id` and
 * `generated_by` — so PostgREST answered 42703, the discarded `error` left
 * `data` null, the resolver read that as "no such report" and the gateway
 * refused the upload 403 "Invalid upload resource".
 *
 * Every human upload to that bucket failed, and the message an adviser saw was
 * "PDF generation failed. Please try again." on the Cash Flow Analysis
 * send-to-client — a report that had rendered perfectly and could not be
 * stored. The class is the one `_shared/aml/caseTenant.ts` documents for
 * `aml.cases`/`tenant_id`: a mistyped column is invisible, because a table
 * without it and a row without a value answer identically.
 *
 * The columns are checked against `src/integrations/supabase/types.ts`, which
 * is generated from the live database, so this fails when either side moves.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FUNCTION = path.join(REPO_ROOT, 'supabase/functions/secure-storage/index.ts');
const TYPES = path.join(REPO_ROOT, 'src/integrations/supabase/types.ts');

const source = readFileSync(FUNCTION, 'utf8');
const types = readFileSync(TYPES, 'utf8');

/** The `Row` keys the generated types publish for a public table. */
function rowColumns(table: string): string[] {
  const anchor = `\n      ${table}: {\n        Row: {`;
  const at = types.indexOf(anchor);
  if (at < 0) return [];
  const start = types.indexOf('Row: {', at) + 'Row: {'.length;
  const end = types.indexOf('\n        }', start);
  return types
    .slice(start, end)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(':')[0].trim());
}

/** Every `.from('table').select('a, b')` with a literal column list. */
function literalSelects(text: string): { table: string; columns: string[] }[] {
  const pattern = /\.from\(\s*'([a-z0-9_]+)'\s*\)\s*[\s\S]{0,80}?\.select\(\s*'([^']*)'/g;
  const found: { table: string; columns: string[] }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const [, table, selection] = match;
    // `*` and embedded resources are not a column list this can check.
    if (selection.includes('*') || selection.includes('(')) continue;
    found.push({
      table,
      columns: selection.split(',').map((column) => column.trim()).filter(Boolean),
    });
  }
  return found;
}

describe('secure-storage names only columns that exist', () => {
  const selects = literalSelects(source);

  it('reads at least the six tables the upload binding resolves through', () => {
    // A regex that silently stops matching would make every assertion below
    // vacuous, so the sweep asserts it found the work before judging it.
    const tables = new Set(selects.map((entry) => entry.table));
    for (const table of [
      'investment_reports',
      'client_properties',
      'clients',
      'report_qa_conversations',
      'report_templates',
      'agent_conversations',
    ]) {
      expect(tables, `expected secure-storage to read ${table}`).toContain(table);
    }
  });

  it('has the generated types to check against', () => {
    expect(rowColumns('investment_reports').length).toBeGreaterThan(10);
    expect(rowColumns('client_properties')).toContain('client_id');
  });

  it.each(['investment_reports', 'client_properties', 'clients', 'report_qa_conversations', 'report_templates', 'agent_conversations'])(
    'every column it selects from %s exists',
    (table) => {
      const known = rowColumns(table);
      expect(known.length, `${table} is missing from the generated types`).toBeGreaterThan(0);
      for (const entry of selects.filter((candidate) => candidate.table === table)) {
        for (const column of entry.columns) {
          expect(known, `secure-storage selects ${table}.${column}, which does not exist`).toContain(column);
        }
      }
    },
  );

  it('never selects the two columns that caused the refusal', () => {
    const investmentSelects = selects.filter((entry) => entry.table === 'investment_reports');
    expect(investmentSelects.length).toBeGreaterThan(0);
    for (const entry of investmentSelects) {
      expect(entry.columns).not.toContain('client_id');
      expect(entry.columns).not.toContain('created_by');
    }
  });
});

describe('a read that failed is not a resource that is absent', () => {
  // Comments are stripped before the negative assertions: this file's own
  // explanation of the bug names the discarded destructuring, and a scan that
  // reads its own documentation as the defect fails for the wrong reason.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_match, prefix) => prefix);

  it('destructures error from every read in the upload binding resolver', () => {
    const start = code.indexOf('async function resolveHumanUploadBinding');
    const end = code.indexOf('Deno.serve(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const resolver = code.slice(start, end);

    const destructures = resolver.match(/const \{[^}]*\} = await supabase/g) || [];
    expect(destructures.length).toBeGreaterThanOrEqual(5);
    for (const destructure of destructures) {
      expect(destructure, `a read in resolveHumanUploadBinding discards its error: ${destructure}`)
        .toMatch(/\berror\b/);
    }
  });

  it('answers a failed lookup with its own reason rather than "not found"', () => {
    expect(code).toContain("reason: 'resource_lookup_failed'");
    // 503, because a database fault is worth retrying and a 403 tells an
    // operator they may not do something they may in fact do.
    const responder = code.slice(code.indexOf("uploadBinding.reason === 'resource_lookup_failed'"));
    expect(responder.slice(0, 400)).toContain('503');
  });
});

describe('the binding records what the object is, not what authorised it', () => {
  it('persists objectClientId on the storage binding', () => {
    // `clientId` gates the upload and `objectClientId` is written to the
    // ledger. They are the same value everywhere the caller names the client;
    // on `investment-reports` the caller names a report, the `reports` module
    // has already authorised the write, and the report's client is recorded so
    // that client's staff can read the file back.
    expect(source).toMatch(/client_id: isInternal \?[^\n]*: uploadBinding\.objectClientId/);
  });

  it('gives every successful binding an objectClientId', () => {
    const successes = source.match(/ok: true as const,[\s\S]{0,400}?ownerUserId/g) || [];
    expect(successes.length).toBeGreaterThanOrEqual(6);
    for (const success of successes) {
      expect(success, `a binding omits objectClientId: ${success.slice(0, 120)}`).toMatch(/objectClientId/);
    }
  });
});
