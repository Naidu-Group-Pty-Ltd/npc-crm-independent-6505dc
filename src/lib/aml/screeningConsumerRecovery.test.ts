import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Behavioural tests for the screening consumer's terminal-check recovery:
 * a provider execution whose downstream persistence crashed is FINISHED on
 * retry from the durable canonical record — the provider is not invoked
 * again and no second screening_check is created. Runs the real consumer
 * against a small stateful fake of the PostgREST surface it uses; provider
 * access is observable through the tables the provider path must touch
 * (provider_configs for resolution, screening_checks inserts for a new
 * attempt).
 */

const env: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, { AML_ENVIRONMENT: "test" });
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
});
afterEach(() => {
  delete (globalThis as any).Deno;
});

type Row = Record<string, any>;

/** Stateful fake of the query surface the consumer uses, with an access log. */
function fakeDb(initial: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(initial));
  const log: Array<{ table: string; op: string }> = [];
  const builder = (table: string) => {
    tables[table] ??= [];
    let op: "select" | "update" | "insert" = "select";
    let payload: any = null;
    const filters: Array<(r: Row) => boolean> = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let take: number | null = null;
    let wantSingle = false;
    let logged = false;
    const logOnce = () => { if (!logged) { log.push({ table, op }); logged = true; } };
    const api: any = {
      select: () => { logOnce(); return api; },
      update: (p: any) => { op = "update"; payload = p; logged = false; logOnce(); return api; },
      insert: (p: any) => { op = "insert"; payload = p; logged = false; logOnce(); return api; },
      eq: (col: string, v: any) => { filters.push((r) => String(r[col]) === String(v)); return api; },
      is: (col: string, v: any) => { filters.push((r) => r[col] === v); return api; },
      in: (col: string, vs: any[]) => { filters.push((r) => vs.map(String).includes(String(r[col]))); return api; },
      not: () => api,
      overlaps: () => api,
      lt: (col: string, v: any) =>
        { filters.push((r) => String(r[col] ?? "") < String(v)); return api; },
      /*
       * THERE IS DELIBERATELY NO `.or()` HERE ANY MORE.
       *
       * This fake used to implement it by pulling the cutoff out of the
       * filter string with a regex and rebuilding the predicate in JS. That
       * is what let the claim pass every test in this file while PostgREST
       * refused the very same string in production with
       * "column party_screening_subjects.state does not exist" — a fake that
       * parses a filter grammar more forgivingly than the server is not a
       * test of the server. The consumer now composes typed filters, and if
       * one is ever reintroduced as a string, these tests fail loudly on the
       * missing method rather than quietly emulating it.
       */
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderBy = { col, asc: opts?.ascending !== false }; return api;
      },
      limit: (n: number) => { take = n; return api; },
      maybeSingle: () => { wantSingle = true; return api; },
      single: () => { wantSingle = true; return api; },
      then: (resolve: any, reject?: any) => run().then(resolve, reject),
    };
    const run = async () => {
      let rows = tables[table].filter((r) =>
        filters.every((f) => f(r)));
      if (op === "select") {
        if (orderBy) {
          const { col, asc } = orderBy;
          rows = [...rows].sort((a, b) =>
            String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (asc ? 1 : -1));
        }
        if (take != null) rows = rows.slice(0, take);
        return wantSingle
          ? { data: rows[0] ?? null, error: null }
          : { data: rows, error: null };
      }
      if (op === "update") {
        rows.forEach((r) => Object.assign(r, payload));
        return wantSingle
          ? { data: rows[0] ? { ...rows[0] } : null, error: null }
          : { data: rows.map((r) => ({ ...r })), error: null };
      }
      const list = (Array.isArray(payload) ? payload : [payload])
        .map((p: any) => ({ id: p.id ?? crypto.randomUUID(), ...p }));
      tables[table].push(...list);
      return wantSingle
        ? { data: list[0] ?? null, error: null }
        : { data: list, error: null };
    };
    return api;
  };
  const db = { schema: () => ({ from: builder }) };
  const accessed = (table: string, op?: string) =>
    log.some((e) => e.table === table && (!op || e.op === op));
  return { db, tables, log, accessed };
}

const SUBJECT_ID = "55555555-5555-4555-8555-555555555555";
const CHECK_ID = "33333333-3333-4333-8333-333333333333";
const CASE_ID = "11111111-1111-4111-8111-111111111111";
const COMPLETED_AT = "2026-08-07T10:00:00.000Z";
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const subjectRow = (over: Row = {}): Row => ({
  id: SUBJECT_ID, tenant_id: "default", case_id: CASE_ID,
  party_type: "beneficial_owner", party_id: null,
  screened_name: "Pat Example", aliases: [], date_of_birth: null, country: null,
  required: true, state: "processing", screening_check_id: CHECK_ID,
  provider_key: null, list_version: null,
  last_screened_at: null, refresh_due_at: null,
  adjudicated_by: null, adjudicated_at: null, adjudication_note: null,
  error_category: null, updated_at: minutesAgo(20),
  ...over,
});

const terminalCheckRow = (over: Row = {}): Row => ({
  id: CHECK_ID, case_id: CASE_ID, subject_label: "Pat Example",
  provider: "local_lists", status: "review", completed_at: COMPLETED_AT,
  result_summary: {
    match_count: 1, scopes_covered: ["sanctions"],
    list_versions: { dfat: `${"a".repeat(12)}@${COMPLETED_AT}` },
  },
  metadata: { party_screening_subject_id: SUBJECT_ID },
  ...over,
});

const matchRow = (over: Row = {}): Row => ({
  id: "44444444-4444-4444-8444-444444444444",
  screening_check_id: CHECK_ID, case_id: CASE_ID,
  match_type: "sanctions", list_name: "DFAT Consolidated List (Australia)",
  matched_name: "Pat Exampel", score: 0.9, status: "open",
  details: { external_id: "DFAT-1" },
  ...over,
});

async function consumer() {
  return await import(
    "../../../supabase/functions/_shared/aml/screeningConsumer.ts");
}
const event = { payload: { party_screening_subject_id: SUBJECT_ID, case_id: CASE_ID } };

describe("terminal-check recovery — resume, never re-execute", () => {
  it("crash after terminal check + matches, before projection: retry finishes without the provider", async () => {
    const { db, tables, accessed } = fakeDb({
      party_screening_subjects: [subjectRow()],   // stale 'processing' from the dead worker
      screening_checks: [terminalCheckRow()],
      screening_matches: [matchRow()],
      monitoring_rules: [], case_events: [],
    });
    const { processScreeningEvent } = await consumer();
    await processScreeningEvent(db, event);

    // No provider resolution, no second screening attempt, no duplicate rows.
    expect(accessed("provider_configs")).toBe(false);
    expect(accessed("screening_checks", "insert")).toBe(false);
    expect(accessed("screening_matches", "insert")).toBe(false);
    expect(tables.screening_checks).toHaveLength(1);
    expect(tables.screening_matches).toHaveLength(1);

    // The interrupted persistence is completed: projection, evidence stamps,
    // audit — with last_screened_at equal to the check's completion time so
    // the round reads as done.
    const subject = tables.party_screening_subjects[0];
    expect(subject.state).toBe("possible_match");
    expect(subject.screening_check_id).toBe(CHECK_ID);
    expect(subject.last_screened_at).toBe(COMPLETED_AT);
    expect(subject.provider_key).toBe("local_lists");
    expect(subject.list_version).toContain("dfat:");
    expect(subject.error_category).toBeNull();
    expect(tables.case_events).toHaveLength(1);
    expect(tables.case_events[0].payload.recovered_from_interrupted_persistence).toBe(true);
  });

  it("F: recorded human adjudications are honoured, never overwritten, by recovery", async () => {
    const { db, tables } = fakeDb({
      party_screening_subjects: [subjectRow()],
      screening_checks: [terminalCheckRow()],
      screening_matches: [matchRow({ status: "dismissed" })],
      monitoring_rules: [], case_events: [],
    });
    const { processScreeningEvent } = await consumer();
    await processScreeningEvent(db, event);

    expect(tables.screening_matches[0].status).toBe("dismissed");
    expect(tables.party_screening_subjects[0].state).toBe("false_positive");
  });

  it("B: a fully completed round receiving a duplicate event succeeds silently — nothing written", async () => {
    const { db, log } = fakeDb({
      party_screening_subjects: [subjectRow({
        state: "completed", last_screened_at: COMPLETED_AT,
      })],
      screening_checks: [terminalCheckRow({ status: "clear", result_summary: { match_count: 0 } })],
      screening_matches: [], monitoring_rules: [], case_events: [],
    });
    const { processScreeningEvent } = await consumer();
    await processScreeningEvent(db, event);
    expect(log.filter((e) => e.op !== "select")).toHaveLength(0);
  });

  it("C: a fresh 'processing' subject still throws so the event retries", async () => {
    const { db, log } = fakeDb({
      party_screening_subjects: [subjectRow({ updated_at: minutesAgo(2) })],
      screening_checks: [terminalCheckRow()],
      screening_matches: [], monitoring_rules: [], case_events: [],
    });
    const { processScreeningEvent } = await consumer();
    await expect(processScreeningEvent(db, event)).rejects.toThrow(/screening_in_flight/);
    expect(log.filter((e) => e.op !== "select")).toHaveLength(0);
  });

  it("D: a stale 'processing' subject is still reclaimed under the 10-minute rule", async () => {
    const { db, tables, accessed } = fakeDb({
      party_screening_subjects: [subjectRow({ updated_at: minutesAgo(11) })],
      screening_checks: [terminalCheckRow()],
      screening_matches: [matchRow()],
      monitoring_rules: [], case_events: [],
    });
    const { processScreeningEvent } = await consumer();
    await processScreeningEvent(db, event);
    expect(accessed("party_screening_subjects", "update")).toBe(true);
    expect(tables.party_screening_subjects[0].state).toBe("possible_match");
  });

  it("a re-queued subject whose previous round completed gets a FRESH screening, not a replay", async () => {
    const { db, tables, accessed } = fakeDb({
      party_screening_subjects: [subjectRow({
        state: "queued", last_screened_at: COMPLETED_AT,
      })],
      screening_checks: [terminalCheckRow({ status: "clear", result_summary: { match_count: 0 } })],
      screening_matches: [], monitoring_rules: [],
      case_events: [], provider_configs: [], provider_metrics_daily: [],
    });
    const { processScreeningEvent } = await consumer();
    await processScreeningEvent(db, event);

    // The provider path ran (resolution consulted) and a new canonical check
    // was opened for the new round — the old terminal result was not replayed.
    expect(accessed("provider_configs")).toBe(true);
    expect(accessed("screening_checks", "insert")).toBe(true);
    expect(tables.screening_checks).toHaveLength(2);
    expect(tables.party_screening_subjects[0].state).toBe("completed");
  });

  it("a terminal check missing its candidate rows re-runs the SAME attempt — no second check", async () => {
    // Durable state from before the matches-before-terminal ordering: the
    // summary records a candidate that was never persisted. Not resumable —
    // but recovery reuses the same check row rather than opening another.
    const { db, tables, accessed } = fakeDb({
      party_screening_subjects: [subjectRow()],
      screening_checks: [terminalCheckRow()],   // match_count: 1, no rows
      screening_matches: [], monitoring_rules: [],
      case_events: [], provider_configs: [], provider_metrics_daily: [],
    });
    const { processScreeningEvent } = await consumer();
    await processScreeningEvent(db, event);

    expect(accessed("provider_configs")).toBe(true);          // provider ran
    expect(accessed("screening_checks", "insert")).toBe(false); // same attempt
    expect(tables.screening_checks).toHaveLength(1);
  });
});
