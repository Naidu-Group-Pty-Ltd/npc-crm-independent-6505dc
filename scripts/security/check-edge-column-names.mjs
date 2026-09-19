#!/usr/bin/env node
/**
 * An Edge Function may not name a column its table does not have.
 *
 * ## Why this exists
 *
 * PostgREST answers `42703` for a column that does not exist. Almost every call
 * site in this repository destructures `{ data }` and throws the `error` away,
 * so a mistyped column does not read as an error — it reads as **no rows**. A
 * table without the column and a row without a value answer identically, which
 * is why this class survives review, survives testing against an empty
 * database, and is only ever found by reading the schema.
 *
 * `CLAUDE.md` already records what one instance cost: eighteen call sites named
 * `aml.cases.tenant_id`, a column that table has never had, and twelve handlers
 * then reported "Case not found" about a case the operator had open.
 *
 * A sweep for the same shape across `supabase/functions/` found **fifty-eight
 * more**, in eighteen functions. Among them:
 *
 *   - `secure-storage` selected `investment_reports.client_id, created_by`
 *     (they are `client_property_id` and `generated_by`), so every human upload
 *     to that bucket was refused 403 — which reached an adviser as
 *     "PDF generation failed. Please try again.";
 *   - `dispatch-marketing-reports` selected a contact name and email off
 *     `ghl_client_opportunities`, which has neither, so the scheduled dispatch
 *     resolved no recipients at all;
 *   - `market-updates-embed-backfill` selected `market_updates.summary`
 *     (it is `ai_summary`), so it had never embedded a single update;
 *   - `agent-insights-runner` filtered `client_deals.assigned_user_id`, which
 *     does not exist, so no stale-deal or settlement insight was ever raised;
 *   - three authorisation fallbacks read `custom_users.role_display` (it is
 *     `role`) and therefore could never grant.
 *
 * Every one of those reported as normal, empty operation.
 *
 * ## What this checks
 *
 * Literal column lists only — `.select('a, b')`, and `.insert(…)` /
 * `.update(…)` / `.upsert(…)` whose payload is an object LITERAL. An
 * interpolated select or an embedded resource (`a, b(c)`) is not a set of
 * names this can read, and is skipped rather than guessed at.
 *
 * ## Two shapes it used to miss, and what they cost
 *
 * Both were found on 13 Sep 2026, in the CRM's outbound message path, and both
 * were FATAL rather than silent — `ghl_conversation_messages` has no
 * `message_type` column in the table, in any migration, or in the generated
 * types, and PostgREST answers a write naming one with PGRST204.
 *
 *   A LITERAL WITH AN INTERPOLATION IN IT. The write body was matched with
 *   `[^{}]*`, so a payload containing a template literal — `\`failed-${key}\`` —
 *   or any nested object failed to match at all and was never judged. The
 *   object is now brace-matched and only TOP-LEVEL keys are taken, which is
 *   what makes a nested `metadata: { … }` safe to skip rather than fatal to
 *   parse.
 *
 *   A LITERAL BOUND TO A CONST. `const messageRecord = { … }` passed to
 *   `.upsert(messageRecord)` was skipped under the old rule that "a payload
 *   assembled in a variable is not a set of names anything can read". A `const`
 *   whose initialiser is an object literal IS readable, and that is the shape
 *   that returned HTTP 500 on every outbound SMS the product ever sent — after
 *   GoHighLevel had already delivered the message. The rule is sharpened
 *   rather than dropped: a literal is judged wherever it is written, and
 *   anything genuinely dynamic (a spread, a computed key, an identifier with
 *   no literal initialiser, one assigned more than once) is still skipped.
 *
 * ## What it still cannot see
 *
 * The columns are the generated types UNION the migrations, which
 * over-approximates on purpose so a column added since the types were last
 * regenerated is not reported as missing. That union is why this check passed
 * over `available_channels` for two months: a committed migration declared it
 * and **that migration had never been applied to any database in the fleet**
 * (Mission Control's `schema_migration_queue` was built on 28 Aug 2026 and its
 * oldest entry is `20260828020000`, so nothing committed before that date was
 * ever enqueued). A column named by a migration is not a column the database
 * has.
 *
 * That class deliberately has NO gate here, and the reason is measured rather
 * than assumed: reporting every column the migrations declare and the
 * generated types do not finds 95 across 47 tables, and almost all of them are
 * columns production really has and `types.ts` is simply stale about — the
 * lib's own header names `builder_stock_items.image_work_stage` as exactly
 * that. The two cases are indistinguishable without asking a database, so a
 * gate here would be noise. Compare the repo's migrations against
 * `supabase_migrations.schema_migrations` on the project itself; that is a
 * deploy-time question, not a source-tree one.
 *
 * Columns are resolved by `lib/supabaseSchema.mjs` as the UNION of the
 * generated types and the migrations, so a column added since the types were
 * last regenerated is not reported as missing.
 *
 * A table neither source has heard of is skipped: it may be a view, another
 * schema, or a table this repository does not define.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { knownColumns } from './lib/supabaseSchema.mjs';

const root = resolve(process.cwd());
const FUNCTIONS = join(root, 'supabase/functions');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Identifiers bound to a non-public schema.
 *
 * `const aml = admin.schema("aml")` makes `aml.from(…)` a different schema
 * entirely, and the generated public types describe none of its tables — so
 * judging those against `public` would report every column of every aml table
 * as missing.
 */
function schemaHandles(source) {
  const handles = new Set();
  for (const m of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*\.schema\(/g)) {
    handles.add(m[1]);
  }
  return handles;
}

/**
 * `.from('table')…​.select('a, b')` where the select belongs to the SAME chain.
 *
 * The gap may contain neither a `;` (a new statement) nor another `.from(` — a
 * sibling query inside a `Promise.all([…])` array is separated by a comma, not
 * a semicolon, and attributing its select to the previous table reports
 * nonsense.
 */
const SELECT = /([A-Za-z_$][\w$]*)\s*\.from\(\s*(['"`])([a-z0-9_]+)\2\s*\)((?:(?!\.from\()[^;]){0,200}?)\.select\(\s*(['"`])([^'"`]*)\5/g;
/**
 * Blank every comment to spaces, keeping offsets and line numbering exact.
 *
 * The structural scans below track quotes so a brace inside a string does not
 * fool them — and a comment is full of unpaired quotes. One apostrophe in a
 * prose comment ("the vendor's own cursor") opened a string that never closed,
 * so `objectLiteralAt` ran to the end of the file and `topLevelKeys` read a
 * colon inside a comment as a key boundary. Both failure modes are SILENT: the
 * payload is skipped or mis-parsed and nothing is reported, which is the one
 * outcome a gate must never have.
 *
 * Comments become spaces rather than being removed, so every index into the
 * result still points at the same character of the original and the reported
 * line number stays right.
 */
function blankComments(source) {
  let out = '';
  let quote = null;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      out += ch;
      if (ch === '\\') { out += source[i + 1] ?? ''; i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; i++; continue; }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * `.from('table')` and the chain that follows it, so every FILTER in that chain
 * can be judged the same way its select is.
 *
 * This gate's own header records `agent-insights-runner` filtering
 * `client_deals.assigned_user_id`, a column that does not exist — and the gate
 * could not see it, because a filter names its column in `.eq('col', …)`
 * rather than in a select list. The same blind spot let
 * `ai-dashboard-agent`'s email stats filter `email_copilot_emails.is_read`,
 * which that table has never had: PostgREST answers 42703, the discarded error
 * leaves `count` null, and `unread.count || 0` reported ZERO unread on a
 * mailbox holding 6,330 of them.
 *
 * The chain segment stops at the first `;` or the next `.from(`, so a sibling
 * query inside a `Promise.all([…])` — separated by a comma, not a semicolon —
 * cannot have its filters attributed to the previous table.
 */
const FROM_HEAD = /([A-Za-z_$][\w$]*)\s*\.from\(\s*(['"`])([a-z0-9_]+)\2\s*\)/g;

/**
 * Filter sites frozen at their first sighting, keyed by file + table + column
 * so an edit elsewhere in the file cannot shift them.
 *
 * These are NOT false positives — every column here is genuinely absent, and
 * every one of these five reads therefore returns nothing. They are frozen
 * because the correct column is not a rename this check can make:
 * `agent-insights-runner` asks "which clients / deals / reminders belong to
 * this team member", and measured on the prime 13 Sep 2026 the columns that
 * would answer it are unpopulated — `clients.assigned_team_user_id` is set on
 * 1 of 40+ rows and `client_deals.created_by` on 0 of all of them. Repairing
 * the names would produce code that looks fixed and still raises no insight,
 * which is worse than a gate entry that says what is actually wrong. How a
 * client or deal is attributed to a team member is the product's question to
 * answer, not this script's.
 *
 * Removing an entry is the goal. Adding one needs a reason of this shape.
 */
const FROZEN_FILTERS = new Set([
  'agent-insights-runner/index.ts|client_reminders|user_id',
  'agent-insights-runner/index.ts|clients|assigned_user_id',
  'agent-insights-runner/index.ts|clients|status',
  'agent-insights-runner/index.ts|client_deals|assigned_user_id',
]);

/** A single-column filter or ordering inside that chain. */
const CHAIN_FILTER =
  /\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|order)\(\s*(['"`])([^'"`]*)\2/g;

/** `.from('table').insert(` — the payload is read from the source after it. */
const WRITE_HEAD = /([A-Za-z_$][\w$]*)\s*\.from\(\s*(['"`])([a-z0-9_]+)\2\s*\)\s*\.(insert|update|upsert)\(\s*/g;

/**
 * The object literal starting at `open`, or null if there is not one there.
 *
 * Brace-matched rather than regex-matched, and string-aware, so a payload
 * carrying a template literal or a nested object is READ rather than skipped —
 * the old `[^{}]*` skipped exactly those.
 */
function objectLiteralAt(source, open) {
  if (source[open] !== '{') return null;
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * The TOP-LEVEL keys of an object literal body.
 *
 * Depth-aware, so a nested `metadata: { a: 1 }` contributes `metadata` and not
 * `a`; string-aware, so a key-like sequence inside a value is not a key.
 * Returns null when the literal is not a readable key set — a spread carries
 * names from somewhere else, and a computed key is not a name at all.
 */
function topLevelKeys(body) {
  if (/\.\.\./.test(body)) return null;
  const keys = [];
  let depth = 0;
  let quote = null;
  let atKeyPosition = true;
  let token = '';
  let sawBracket = false;

  /*
    `{ user_id }` names the column `user_id` exactly as `{ user_id: user_id }`
    does, and recording a key only at a `:` dropped every shorthand property
    silently. A gate that cannot see half the syntax its language admits is
    worse than no gate, because the green result is believed.
  */
  const flushShorthand = () => {
    const name = token.trim();
    if (atKeyPosition && !sawBracket && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) keys.push(name);
    token = '';
    sawBracket = false;
  };

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    // A quoted key is still a key: `{ "user_id": 1 }` writes the same column as
    // `{ user_id: 1 }`. In key position the string's CONTENT becomes the token
    // so the `:` branch below sees the name; anywhere else it is a value and is
    // skipped as before.
    if (ch === '"' || ch === "'" || ch === '`') {
      // `depth === 0 && !sawBracket` is load-bearing: this branch runs before
      // the depth guard below, so without it a string INSIDE a computed key —
      // `{ [mode === 'morning' ? 'a' : 'b']: v }` — was captured as the key
      // name, and `finance-portal-briefing-runner` was reported as writing a
      // column called `morning`. A gate's false positive is worse than its
      // silence, because it teaches a reader to stop believing it.
      if (atKeyPosition && depth === 0 && !sawBracket && token.trim() === '') {
        const close = body.indexOf(ch, i + 1);
        if (close !== -1) {
          token = body.slice(i + 1, close);
          i = close;
          continue;
        }
      }
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') {
      if (depth === 0 && ch === '[') sawBracket = true;
      depth++;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; continue; }
    if (depth > 0) continue;
    if (ch === ',') { flushShorthand(); atKeyPosition = true; continue; }
    if (ch === ':' && atKeyPosition) {
      // A computed key is checked FIRST and refuses the whole literal. Asking
      // "does the token look like an identifier?" first lets a computed key
      // whose branches happen to be identifiers slip through as a column name.
      if (sawBracket) return null;
      const name = token.trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) keys.push(name);
      atKeyPosition = false;
      token = '';
      continue;
    }
    token += ch;
  }
  flushShorthand();
  return keys;
}

/**
 * How far back an identifier's declaration may sit and still be believed.
 *
 * There is no parser here, so scope is approximated by proximity plus the
 * no-intervening-binding rule below. A first version searched the WHOLE file
 * for `const <name> = {`, and in a 9,000-line function file that is
 * confidently wrong: `ai-dashboard-agent` binds `const updates: any = {
 * is_enabled: … }` for scheduled tasks at line 4865, and four `game_plan*`
 * handlers two thousand lines further down do `const { plan_id, ...updates } =
 * args` and then `.update(updates)`. The lookup attributed the first shape to
 * all four and reported four columns that call site never sends. Being wrong
 * in this direction is worse than being silent: it teaches a reader that the
 * gate cannot be trusted.
 */
const MAX_DECL_LOOKBACK = 3000;

/**
 * The object literal an identifier holds AT a call site, if that is knowable.
 *
 * Three conditions, all of them about not guessing:
 *   the declaration is an object LITERAL (`const x = { … }`), because that is
 *   the only form whose keys can be read;
 *   it is the LAST binding of that name before the call — a rest pattern
 *   (`const { a, ...x } = args`), a reassignment or a second declaration all
 *   count as bindings and all disqualify the earlier literal;
 *   and it is near enough to be plausibly the same scope.
 *
 * `const messageRecord = { … }` sixteen lines above `.upsert(messageRecord)`
 * satisfies all three, and that is the shape that made every outbound CRM
 * message report as failed.
 */
function literalForIdentifier(source, name, callIndex) {
  const from = Math.max(0, callIndex - MAX_DECL_LOOKBACK);
  const region = source.slice(from, callIndex);

  // Any binding of the name: a declaration (including a destructuring or rest
  // pattern, hence the permissive middle) or a plain assignment.
  const binding = new RegExp(
    `(?:(?:const|let|var)\\s+[^;\\n]{0,200}?(?<![\\w$])${name}(?![\\w$]))|(?:(?<![.\\w$])${name}\\s*=(?!=))`,
    'g',
  );
  const bindings = [...region.matchAll(binding)];
  if (bindings.length === 0) return null;

  const last = bindings[bindings.length - 1];
  // The last binding must itself be `<name> = {`, or the value at the call
  // site came from somewhere this cannot read.
  const tail = region.slice(last.index, last.index + last[0].length + 240);
  const opener = new RegExp(`(?<![\\w$])${name}(?![\\w$])\\s*(?::[^=;\\n]{0,120})?=\\s*\\{`);
  const openerHit = opener.exec(tail);
  if (!openerHit || openerHit.index !== last[0].length - name.length) return null;

  const braceAt = from + last.index + openerHit.index + openerHit[0].length - 1;

  /*
    Proximity cannot tell two adjacent functions apart, and a payload that is a
    PARAMETER has no binding this scan can see — so the nearest preceding
    `const x = { … }` in the file above it belongs to somebody else. Refusing
    across a function boundary is the cheap approximation of scope that keeps
    the gate from reporting columns the call site never sends; a false positive
    teaches a reader the gate cannot be trusted, which is worse than silence.
  */
  if (/\b(?:function\s|=>\s*\{)/.test(source.slice(braceAt, callIndex))) return null;
  return objectLiteralAt(source, braceAt);
}

const findings = [];

for (const file of walk(FUNCTIONS)) {
  const raw = readFileSync(file, 'utf8');
  // Every structural scan below runs on the comment-blanked text; offsets and
  // line numbers are identical, so `where()` still reports the real line.
  const source = blankComments(raw);
  const handles = schemaHandles(source);
  const where = (index) => `${relative(root, file)}:${source.slice(0, index).split('\n').length}`;

  for (const m of source.matchAll(SELECT)) {
    const [, receiver, , table, , , selection] = m;
    if (handles.has(receiver)) continue;
    // `*`, an embedded resource and any interpolated list are not literal names.
    if (selection.includes('*') || selection.includes('(') || selection.includes('${')) continue;
    const columns = knownColumns(table);
    if (!columns) continue;
    const named = selection.split(',').map((c) => c.trim()).filter(Boolean);
    const missing = named.filter((c) => !columns.includes(c));
    if (missing.length) findings.push(`${where(m.index)} select ${table} → ${missing.join(', ')}`);
  }

  for (const m of source.matchAll(FROM_HEAD)) {
    const [, receiver, , table] = m;
    if (handles.has(receiver)) continue;
    const columns = knownColumns(table);
    if (!columns) continue;

    // The chain this `.from` owns: up to the first statement end or the next
    // `.from(`, whichever comes first, and bounded so a runaway match cannot
    // swallow the rest of a file.
    const rest = source.slice(m.index + m[0].length, m.index + m[0].length + 600);
    const stop = Math.min(
      ...[rest.indexOf(';'), rest.indexOf('.from(')].filter((i) => i !== -1),
      rest.length,
    );
    const chain = rest.slice(0, stop);

    for (const f of chain.matchAll(CHAIN_FILTER)) {
      const [, op, , name] = f;
      // Not a plain column of THIS table, and not something this can read:
      //   `a.b`   — an embedded resource's column, or a foreign table's
      //   `${…}`  — interpolated, so not a name at all
      //   `a->>b` — a JSONB path; PostgREST resolves it INSIDE the column, so
      //             the thing to judge is the part before the arrow and the
      //             rest is data. Five real call sites filter this way.
      //   ''      — `.order()` with no column, or an empty filter
      if (!name || name.includes('.') || name.includes('${') || name.includes('->')) continue;
      // `.order('col', { … })` and `.in('col', [ … ])` name a column first,
      // exactly like `.eq`; nothing here reads the second argument.
      if (columns.includes(name)) continue;
      const relPath = relative(root, file).replace(/^supabase\/functions\//, '');
      if (FROZEN_FILTERS.has(`${relPath}|${table}|${name}`)) continue;
      findings.push(`${where(m.index + m[0].length + f.index)} ${op} ${table} → ${name}`);
    }
  }

  for (const m of source.matchAll(WRITE_HEAD)) {
    const [, receiver, , table, op] = m;
    if (handles.has(receiver)) continue;
    const columns = knownColumns(table);
    if (!columns) continue;

    const payloadAt = m.index + m[0].length;
    let body = objectLiteralAt(source, payloadAt);
    if (body === null) {
      // Not an inline literal. An array of literals (`upsert([{ … }])`) and a
      // bare identifier are both still readable; anything else is not.
      const arrayOpen = source[payloadAt] === '[' ? source.indexOf('{', payloadAt) : -1;
      if (arrayOpen !== -1 && source.slice(payloadAt, arrayOpen).trim() === '[') {
        body = objectLiteralAt(source, arrayOpen);
      } else {
        const ident = /^([A-Za-z_$][\w$]*)\s*[,)]/.exec(source.slice(payloadAt, payloadAt + 80));
        body = ident ? literalForIdentifier(source, ident[1], payloadAt) : null;
      }
    }
    if (body === null) continue;

    const keys = topLevelKeys(body);
    if (keys === null) continue; // a spread or a computed key is not a key set
    const missing = keys.filter((k) => !columns.includes(k));
    if (missing.length) findings.push(`${where(m.index)} ${op} ${table} → ${missing.join(', ')}`);
  }
}

if (findings.length) {
  console.error(
    'Edge Function column names FAILED — these name columns their table does not have.\n' +
    'PostgREST answers 42703 and the discarded error reads as "no rows", so this is invisible at runtime.\n' +
    'Check the column against src/integrations/supabase/types.ts and supabase/migrations/.\n- ' +
    findings.join('\n- '),
  );
  process.exit(1);
}
console.log('Edge Function column-name check passed (no select or write names a column its table lacks).');
