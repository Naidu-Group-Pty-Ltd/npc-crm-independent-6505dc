import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The Solicitor Portal's portfolio reads (the pipeline board, the portfolio
 * KPIs and the at-risk list) show only the matters this solicitor may VIEW.
 *
 * Until 28 Sep 2026 this gate asserted a per-client permission matrix ANDed
 * onto the matter list (WP-16 §2), because the list's legacy path returned
 * every matter of every assigned client with no permission check. The AND
 * answered for the wrong model: a practice on the per-matter grants, which is
 * every practice by default, needs no client assignment, so the board and the
 * KPIs were empty for every solicitor it governs. The permission check moved
 * to where the list is built, and this gate followed it. It now asserts the
 * two halves that together keep WP-16's hole closed:
 *
 *  1. the board reads through the shared list under `matters`, bounded by it
 *     and by the practice, before any matter row is read;
 *  2. the shared list applies the permission matrix on BOTH of its paths, the
 *     per-matter grants and the legacy assignments, for every key it is asked.
 *
 * Remove either and a solicitor denied `matters.view` reads the portfolio.
 * `supabase/functions/_shared/solicitorPortalAuth.test.ts` proves the stronger
 * property by execution: the list names exactly the matters the per-matter
 * check opens, over 400 generated practices.
 */

function between(text, start, end, label) {
  const from = text.indexOf(start);
  assert.ok(from > -1, `${label}: could not find ${JSON.stringify(start)}`);
  const to = text.indexOf(end, from + start.length);
  assert.ok(to > -1, `${label}: could not find the end marker ${JSON.stringify(end)}`);
  return text.slice(from, to);
}

// ── 1. The board ───────────────────────────────────────────────────────────
const source = readFileSync('supabase/functions/solicitor-portal-intelligence/index.ts', 'utf8');
const helper = between(
  source,
  'const loadVisibleMatters = async () =>',
  '// ───────────────────── PIPELINE BOARD',
  'intelligence',
);

const listCall = "listAccessibleMatterIds(supabase, me.id, me.firm_id, 'matters')";
assert.ok(
  helper.includes(listCall),
  "portfolio reads must be scoped by the shared matter list under 'matters' (the analyser's 'contract' key is not the board's)",
);
assert.match(
  helper,
  /if \(!visibleMatterIds\.length\) return \[\]/,
  'an empty matter list must end the read before any matter row is fetched',
);
assert.match(
  helper,
  /\.in\('id', visibleMatterIds\.slice\(/,
  'the matter query must be bounded by the matter list',
);
assert.match(
  helper,
  /\.eq\('firm_id', me\.firm_id\)/,
  "the matter query must keep the practice's own boundary",
);
const firstMatterRead = helper.indexOf(".from('legal_matters')");
assert.ok(firstMatterRead > -1, 'the helper no longer reads legal_matters; re-point this gate');
assert.ok(
  helper.indexOf(listCall) < firstMatterRead
    && helper.indexOf('if (!visibleMatterIds.length)') < firstMatterRead,
  'the matter list must be resolved, and an empty one honoured, before the matter query',
);

for (const operation of ['pipeline_board', 'portfolio_kpis', 'at_risk_matters']) {
  const at = source.indexOf(`operation === '${operation}'`);
  assert.ok(at > -1, `${operation} is not handled any more; re-point this gate`);
  assert.match(
    source.slice(at, at + 500),
    /loadVisibleMatters\(\)/,
    `${operation} must read through the permission-filtered portfolio helper`,
  );
}

// ── 2. The shared list ─────────────────────────────────────────────────────
const shared = readFileSync('supabase/functions/_shared/solicitorPortalAuth.ts', 'utf8');
const list = between(
  shared,
  'export async function readAccessibleMatterIds(',
  'export async function listAccessibleMatterIds(',
  'shared list',
);

assert.ok(
  list.includes("const allowsEvery = (matrix: PermissionMatrix) => keys.every((key) => can(matrix, key, 'view'));"),
  'the list must require VIEW on every key it is asked for',
);
assert.ok(
  list.includes('.filter((row: any) => allowsEvery(resolveTriStatePermissions(baseline, row.permissions ?? null)))'),
  'the per-matter grants must pass through the tri-state matrix before a matter is listed',
);
assert.ok(
  list.includes('row.client_id && allowsEvery(mergePermissions(baseline, row.permissions ?? null))'),
  'the legacy assignments must pass through the merged matrix before a client is listed (WP-16 §2)',
);
assert.ok(
  list.includes('await readMatterAccessMode(supabase, solicitorFirmId)'),
  "the list must follow the practice's own rollout mode, as the per-matter check does",
);
assert.ok(
  list.includes('if (modeRead.error) return { ok: false'),
  'a failed mode lookup must be reported, not read as a model',
);

const wrapper = between(shared, 'export async function listAccessibleMatterIds(', '\n}\n', 'list wrapper');
assert.ok(
  wrapper.includes('await readAccessibleMatterIds(supabase, solicitorUserId, solicitorFirmId, permissionKeys)'),
  'listAccessibleMatterIds must be the same decision as readAccessibleMatterIds',
);

console.log('Solicitor intelligence portfolio matter authorization check passed.');
