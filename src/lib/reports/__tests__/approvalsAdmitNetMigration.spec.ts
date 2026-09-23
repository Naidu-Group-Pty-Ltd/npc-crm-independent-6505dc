/**
 * The migration that lets the supply register hold the publisher's negatives.
 *
 * Read as a file rather than applied, because nothing here can run Postgres —
 * so these assert the properties that make it safe to apply by hand through
 * `apply-migration.yml`, and the one production read-back after it is the
 * `@effect` probe `migration-drift.yml` runs.
 *
 * Every assertion is about a way this exact change can fail while reporting
 * success. None is about wording.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { ABS_BA_PLAUSIBILITY } from '../../../../supabase/functions/_shared/reports/market/openData/absBuildingApprovals.pure.ts';

const DIR = 'supabase/migrations';
const FILE = '20261217000000_approvals_admit_net_amendments.sql';
const sql = readFileSync(`${DIR}/${FILE}`, 'utf8');
/** The executable part, with the comment lines taken out. */
const code = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

describe('the sign checks are found by what they say', () => {
  it('never drops a constraint by a guessed name', () => {
    // Both were declared inline, so their names are Postgres's own. A wrong
    // guess under `if exists` does nothing and leaves the refusal in place
    // while the file reports success.
    expect(code).not.toMatch(/drop constraint if exists/i);
    expect(code).not.toMatch(/drop constraint\s+market_building_approvals_(dwelling_units|value_aud)_check/i);
    expect(code).toContain('pg_get_constraintdef(oid)');
    expect(code).toMatch(/execute format\('alter table public\.market_building_approvals drop constraint %I'/);
  });

  it('matches the definitions Postgres actually prints for both columns', () => {
    // Read back from PostgreSQL 16.13 with the table built by
    // `20261213000000`, not assumed: the integer check prints as
    // `(dwelling_units >= 0)` and the numeric one as `(value_aud >= (0)::numeric)`.
    // A pattern that misses either leaves that refusal standing.
    const patterns = [...code.matchAll(/~ '([^']+)'/g)].map((m) => new RegExp(m[1]));
    const printed = [
      'CHECK (((dwelling_units IS NULL) OR (dwelling_units >= 0)))',
      'CHECK (((value_aud IS NULL) OR (value_aud >= (0)::numeric)))',
    ];
    for (const def of printed) {
      expect(patterns.some((p) => p.test(def)), def).toBe(true);
    }
    // …and matches neither replacement as the same engine prints it, or a
    // re-apply would drop the migration's own work.
    const replacements = [
      'CHECK (((dwelling_units IS NULL) OR (abs(dwelling_units) <= 2000000)))',
      "CHECK (((value_aud IS NULL) OR (abs(value_aud) <= ('250000000000'::bigint)::numeric)))",
    ];
    for (const def of replacements) {
      expect(patterns.some((p) => p.test(def)), def).toBe(false);
    }
  });
});

describe('the swap is proved by what the table does, not by re-reading the catalogue', () => {
  // A re-count by the pattern that found the checks passes exactly when that
  // pattern missed one. Measured on PostgreSQL 16.13: against a sign check
  // spelled `not (dwelling_units < 0)`, a pattern-only version of this file
  // exited 0 and the table still refused the -5.
  const body = code.slice(code.indexOf('do $$'), code.indexOf('end $$;'));
  const probeAt = body.indexOf('insert into public.market_building_approvals');

  it('inserts a row carrying a negative on BOTH measures', () => {
    expect(probeAt).toBeGreaterThan(-1);
    const insert = body.slice(probeAt, body.indexOf(';', probeAt));
    expect(insert).toMatch(/dwelling_units,\s*value_aud/);
    expect(insert).toMatch(/'total_residential',\s*-1,\s*-1,/);
  });

  it('always rolls the probe row back, and raises — undoing the swap — when the table refuses it', () => {
    const block = body.slice(probeAt);
    // The sentinel that rolls a SUCCESSFUL probe back…
    expect(block).toMatch(/raise exception 'APPROVALS_ADMIT_NET_PROBE_ROLLED_BACK';/);
    // …a refusal re-raised out of the handler, which fails the one statement…
    expect(block).toMatch(/when check_violation then\s+raise exception 'APPROVALS_ADMIT_NET: the table still refuses/);
    // …and nothing else swallowed: only the sentinel itself is caught.
    expect(block).toMatch(
      /when raise_exception then\s+if sqlerrm is distinct from 'APPROVALS_ADMIT_NET_PROBE_ROLLED_BACK' then\s+raise;/,
    );
    expect(block).not.toMatch(/when others/i);
  });

  it('runs on a re-apply too, before the already-applied return', () => {
    expect(probeAt).toBeLessThan(body.indexOf("if dropped = '' and has_units_bound and has_value_bound then"));
  });

  it('can meet no refusal except a sign check: the probe row satisfies every other rule on the table', () => {
    // If the table's other checks change, a probe that breaks one would fail
    // for the wrong reason and refuse a correct migration. So the row is
    // judged against the table's own declaration rather than trusted.
    const table = readFileSync(`${DIR}/20261213000000_market_building_approvals.sql`, 'utf8');
    const listOf = (column: string): string[] => {
      const m = table.match(new RegExp(`${column}\\s+text[^\\n]*check \\(${column} in\\s*\\(([^)]*)\\)`, 's'))
        ?? table.match(new RegExp(`${column} in\\s*\\(([^)]*)\\)`, 's'));
      expect(m, `the table's ${column} check`).not.toBeNull();
      return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    };
    const periodRule = table.match(/check \(period ~ '([^']+)'\)/);
    expect(periodRule).not.toBeNull();

    const values = body.slice(body.indexOf('values', probeAt), body.indexOf(';', probeAt));
    const literals = [...values.matchAll(/'([^']*)'|(-?\d+)|\bnull\b/g)].map((x) => x[1] ?? x[2] ?? null);
    const [areaKind, areaCode, area, areaToken, state, period, buildingType, units, value] = literals;

    expect(listOf('area_kind')).toContain(areaKind);
    expect(listOf('building_type')).toContain(buildingType);
    expect(new RegExp(periodRule![1]).test(period as string)).toBe(true);
    expect(state).toBeNull();
    for (const notNull of [areaCode, area, areaToken]) expect(notNull).toBeTruthy();
    expect([units, value]).toEqual(['-1', '-1']);
    // A key the loader can never write, so the probe cannot collide with a
    // real row: no ABS series reaches back to 1900.
    expect(period).toBe('1900-01');
    expect(areaCode).not.toMatch(/^\d+$/);
  });
});

describe('it lands whole or not at all, and twice is harmless', () => {
  it('is ONE statement for the swap, because the workflow applies without a transaction', () => {
    // `apply-migration.yml` runs psql with ON_ERROR_STOP and no
    // --single-transaction, so separate statements would commit one by one
    // and a failure half-way would leave the table with no bound at all.
    const blocks = code.match(/\bdo \$\$/g) ?? [];
    expect(blocks).toHaveLength(1);
    const body = code.slice(code.indexOf('do $$'), code.indexOf('end $$;'));
    expect(body).toContain('drop constraint');
    expect(body).toContain('add constraint market_building_approvals_dwelling_units_magnitude');
    expect(body).toContain('add constraint market_building_approvals_value_aud_magnitude');
    // Nothing that alters the table sits outside the block.
    const outside = code.slice(code.indexOf('end $$;'));
    expect(outside).not.toMatch(/alter table/i);
  });

  it('says so and changes nothing when it has already been applied', () => {
    expect(code).toMatch(/if dropped = '' and has_units_bound and has_value_bound then[\s\S]*?return;/);
    expect(code).toMatch(/if not has_units_bound then/);
    expect(code).toMatch(/if not has_value_bound then/);
  });
});

describe('the database backstop is the parser\'s own loosest ceiling', () => {
  it('bounds magnitude at the national ceilings, symmetric in sign', () => {
    // One rule, stated at both ends from the same numbers: a backstop looser
    // than the parser would admit what no grain publishes, and a tighter one
    // would refuse the national rollups the SA2 download carries.
    expect(code).toContain(`abs(dwelling_units) <= ${ABS_BA_PLAUSIBILITY.maxUnitsPerAreaMonth.national}`);
    expect(code).toContain(`abs(value_aud) <= ${ABS_BA_PLAUSIBILITY.maxValuePerAreaMonth.national}`);
  });
});

describe('it is proved by effect and sits where the tree will run it', () => {
  it('declares an @effect probe naming what it creates', () => {
    const effect = sql.split('\n').find((l) => l.startsWith('-- @effect:'));
    expect(effect).toBeDefined();
    expect(effect).toContain("conname = 'market_building_approvals_dwelling_units_magnitude'");
  });

  it('sorts after the migration that creates the table, and after the sequence it joined', () => {
    // Versions in this tree are a sequence wearing a date's clothes
    // (MIGRATION_DEPENDENCY_ORDER.json), so a version is the order a file
    // runs in. It must follow the table's creation, and it was written to
    // follow everything that existed when it was written.
    const versions = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
    expect(versions).toContain(FILE);
    expect(FILE > '20261213000000_market_building_approvals.sql').toBe(true);
    expect(FILE > '20261216000000_approvals_refresh_hourly.sql').toBe(true);
  });
});
