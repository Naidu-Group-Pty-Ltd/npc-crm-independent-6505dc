/**
 * What columns a `public` table actually has.
 *
 * There are two sources in this repository and neither is sufficient alone:
 *
 *   - `src/integrations/supabase/types.ts` is generated from the live database,
 *     so it is authoritative for everything that existed when it was last
 *     regenerated — which is by hand, and it goes stale. It predates
 *     `builder_stock_items.image_work_stage`, a column production certainly
 *     has.
 *   - `supabase/migrations/*.sql` is complete for everything added since, but
 *     says nothing about a table created before the migration history.
 *
 * So the answer is their union, and a column is only reported as absent when
 * BOTH sources agree it is.
 *
 * Paths resolve from the process cwd rather than from `import.meta.url`: the
 * negative-test harness runs each gate against a symlinked mirror of the tree
 * with one file mutated, and a gate that resolves relative to its own location
 * would read the real file and pass.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());

/**
 * Blank out SQL comments, keeping every other character in place.
 *
 * A regex cannot do this: a lazy block-comment pattern pairs the first opening
 * marker with the first closing one wherever they fall — including inside a
 * string literal or a `$$ … $$` body — and in one migration that silently
 * deleted the `ALTER TABLE` line a following `ADD COLUMN` belonged to, so seven
 * real columns read as absent. Comments become spaces rather than being
 * removed, so every offset in the result still points at the same character of
 * the original.
 */
export function stripSqlComments(sql) {
  // Built from kept slices rather than a character array: the migration corpus
  // is ~158 MB, and `split('')` on that allocates 160 million single-character
  // strings. A comment span is replaced by the same span with every character
  // except a newline turned into a space, which keeps both the offsets and the
  // line numbering exact.
  const parts = [];
  let kept = 0;
  const blank = (from, to) => {
    parts.push(sql.slice(kept, from));
    parts.push(sql.slice(from, to).replace(/[^\n]/g, ' '));
    kept = to;
  };
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      // Postgres block comments nest.
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth += 1; j += 2; continue; }
        if (sql[j] === '*' && sql[j + 1] === '/') { depth -= 1; j += 2; continue; }
        j += 1;
      }
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch && sql[j + 1] === ch) { j += 2; continue; }
        if (sql[j] === ch) { j += 1; break; }
        j += 1;
      }
      i = j;
      continue;
    }
    if (ch === '$') {
      const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 40));
      if (dollar) {
        const tag = dollar[0];
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? sql.length : end + tag.length;
        continue;
      }
    }
    i += 1;
  }
  parts.push(sql.slice(kept));
  return parts.join('');
}

let typesSource = null;
function types() {
  if (typesSource === null) {
    typesSource = readFileSync(join(root, 'src/integrations/supabase/types.ts'), 'utf8');
  }
  return typesSource;
}

/** The `Row` keys the generated types publish for a public table, or null. */
export function typedColumns(table) {
  const source = types();
  const anchor = `\n      ${table}: {\n        Row: {`;
  const at = source.indexOf(anchor);
  if (at < 0) return null;
  const start = source.indexOf('Row: {', at) + 'Row: {'.length;
  const end = source.indexOf('\n        }', start);
  return source
    .slice(start, end)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(':')[0].replace(/\?$/, '').trim());
}

let migrationIndex = null;
function migrations() {
  if (migrationIndex !== null) return migrationIndex;
  migrationIndex = new Map();
  const clean = (value) => value.replace(/^public\./i, '').replace(/"/g, '').toLowerCase();
  const note = (table, column) => {
    const key = clean(table);
    if (!migrationIndex.has(key)) migrationIndex.set(key, new Set());
    migrationIndex.get(key).add(clean(column));
  };

  const dir = join(root, 'supabase/migrations');
  // One file at a time. Concatenating them first lets an unbalanced comment in
  // one migration swallow a statement in another.
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const raw = readFileSync(join(dir, file), 'utf8');
    // Nothing to learn from a migration that defines no table shape, and there
    // are ~985 of them.
    if (!/\b(alter|create)\s+table\b/i.test(raw)) continue;
    const sql = stripSqlComments(raw);

    // Every `add column` / `rename column … to` belongs to the nearest
    // preceding `alter table`, which survives multi-column statements.
    const anchors = [...sql.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?([\w."]+)/gi)]
      .map((m) => ({ at: m.index, table: m[1] }));
    const tableAt = (index) => {
      let found = null;
      for (const anchor of anchors) {
        if (anchor.at < index) found = anchor.table; else break;
      }
      return found;
    };
    for (const m of sql.matchAll(/\badd\s+column\s+(?:if\s+not\s+exists\s+)?([\w"]+)/gi)) {
      const table = tableAt(m.index);
      if (table) note(table, m[1]);
    }
    for (const m of sql.matchAll(/\brename\s+column\s+[\w"]+\s+to\s+([\w"]+)/gi)) {
      const table = tableAt(m.index);
      if (table) note(table, m[1]);
    }
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(([\s\S]*?)\n\s*\)/gi)) {
      const [, table, body] = m;
      for (const bodyLine of body.split('\n')) {
        const line = bodyLine.trim();
        if (!line || /^(primary|unique|foreign|check|constraint|key|like|exclude)\b/i.test(line)) continue;
        const column = /^"?([a-z_][a-z0-9_]*)"?\s+\S/i.exec(line);
        if (column) note(table, column[1]);
      }
    }
  }
  return migrationIndex;
}

/** Columns the migrations add to a table (possibly empty). */
export function migrationColumns(table) {
  return [...(migrations().get(table.toLowerCase()) ?? [])];
}

/**
 * Every column this table is known to have, or null when neither source has
 * heard of the table at all (a view, another schema, or a table this repo does
 * not define — none of which this can judge).
 */
export function knownColumns(table) {
  const typed = typedColumns(table);
  const migrated = migrationColumns(table);
  if (typed === null && migrated.length === 0) return null;
  return [...new Set([...(typed ?? []), ...migrated])];
}
