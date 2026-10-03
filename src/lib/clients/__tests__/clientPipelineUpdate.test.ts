/**
 * What a Client Tracker save may write, and who may ask for it.
 *
 * The pure rules are exercised directly; the gate and the order of the
 * handler's steps are read from `manage-automation-settings`' source, because
 * they live in an edge function no unit test can call.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIENT_PIPELINE_COLUMNS,
  CLIENT_PIPELINE_WRITE_COLUMNS,
  isPipelineUuid,
  placedPipelineOf,
  planClientPipelineWrite,
  readPipelineUpdate,
  type ClientPlacement,
  type StageRow,
} from "../../../../supabase/functions/_shared/clientPipelineUpdate.pure";

const PIPE_A = "11111111-1111-4111-8111-111111111111";
const PIPE_B = "22222222-2222-4222-8222-222222222222";
const STAGE_A1 = "33333333-3333-4333-8333-333333333333";
const STAGE_B1 = "44444444-4444-4444-8444-444444444444";

const stageA1: StageRow = { id: STAGE_A1, name: "Qualified", pipeline_id: PIPE_A };
const nowhere: ClientPlacement = { current_stage_id: null, current_pipeline_id: null, current_stage_pipeline_id: null };
const inB: ClientPlacement = { current_stage_id: STAGE_B1, current_pipeline_id: PIPE_B, current_stage_pipeline_id: null };

function read(data: unknown) {
  const reading = readPipelineUpdate(data);
  if (!reading.ok) throw new Error(`expected a reading, got: ${reading.message}`);
  return reading;
}

describe("reading a save", () => {
  it("writes only the keys the request names, and null where it names null", () => {
    const reading = read({ pipeline_notes: "Called back", borrowing_capacity: null });
    expect(reading.fields).toEqual({ pipeline_notes: "Called back", borrowing_capacity: null });
    expect(reading.stage).toEqual({ kind: "unchanged" });
  });

  it("drops a key that is not a Client Tracker field", () => {
    const reading = read({ pipeline_notes: "x", owner_id: "someone", is_archived: true });
    expect(Object.keys(reading.fields)).toEqual(["pipeline_notes"]);
  });

  it("reads empty text as nothing written", () => {
    expect(read({ pipeline_status: "   " }).fields).toEqual({ pipeline_status: null });
  });

  it("refuses a money field that is not an amount of zero or more", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, "450000"]) {
      const reading = readPipelineUpdate({ borrowing_capacity: bad });
      expect(reading.ok).toBe(false);
      expect(reading.message).toBe("Borrowing capacity must be an amount of zero or more.");
    }
    expect(read({ equity_release: 0 }).fields).toEqual({ equity_release: 0 });
  });

  it("refuses a follow-up date that is not a date", () => {
    expect(readPipelineUpdate({ follow_up_date: "next Tuesday" }).ok).toBe(false);
    expect(read({ follow_up_date: "2026-10-14" }).fields).toEqual({ follow_up_date: "2026-10-14" });
    expect(read({ follow_up_date: "" }).fields).toEqual({ follow_up_date: null });
  });

  it("refuses text longer than the column's purpose", () => {
    expect(readPipelineUpdate({ pipeline_status: "x".repeat(201) }).ok).toBe(false);
    expect(readPipelineUpdate({ pipeline_notes: "x".repeat(10_001) }).ok).toBe(false);
  });

  it("reads a stage id as a move, and refuses one that is not an id", () => {
    expect(read({ current_stage_id: STAGE_A1 }).stage).toEqual({ kind: "set", stageId: STAGE_A1 });
    const bad = readPipelineUpdate({ current_stage_id: "Qualified" });
    expect(bad.ok).toBe(false);
    expect(bad.message).toBe("That stage is not one this board knows.");
  });

  it("reads an empty stage as leaving a pipeline, named or not", () => {
    expect(read({ current_stage_id: null }).stage).toEqual({ kind: "clear", pipelineId: null });
    expect(read({ current_stage_id: "", pipeline_id: PIPE_A }).stage).toEqual({ kind: "clear", pipelineId: PIPE_A });
    expect(readPipelineUpdate({ current_stage_id: null, pipeline_id: "all" }).ok).toBe(false);
  });

  it("treats a request with no data as nothing to write", () => {
    for (const data of [undefined, null, "x", 3]) {
      expect(readPipelineUpdate(data)).toEqual({ ok: true, fields: {}, stage: { kind: "unchanged" } });
    }
  });
});

describe("the patch a save writes", () => {
  it("takes the stage's pipeline and name from the stage, never from the request", () => {
    const reading = read({ current_stage_id: STAGE_A1, pipeline_status: "Settled" });
    expect(planClientPipelineWrite(reading, stageA1, nowhere)).toEqual({
      current_stage_id: STAGE_A1,
      current_pipeline_id: PIPE_A,
      pipeline_status: "Qualified",
    });
  });

  it("will not write a move without the stage it names", () => {
    const reading = read({ current_stage_id: STAGE_A1 });
    expect(() => planClientPipelineWrite(reading, null, nowhere)).toThrow();
    expect(() => planClientPipelineWrite(reading, { ...stageA1, id: STAGE_B1 }, nowhere)).toThrow();
  });

  it("keeps the older clear exactly as it was: the stage, and nothing else", () => {
    expect(planClientPipelineWrite(read({ current_stage_id: null }), null, inB)).toEqual({ current_stage_id: null });
  });

  it("takes a client off the pipeline they are placed in", () => {
    const reading = read({ current_stage_id: null, pipeline_id: PIPE_B });
    expect(planClientPipelineWrite(reading, null, inB)).toEqual({
      current_stage_id: null,
      current_pipeline_id: null,
    });
  });

  it("leaves the client's own placement alone when they leave a different pipeline", () => {
    const reading = read({ current_stage_id: null, pipeline_id: PIPE_A, pipeline_status: "Lost" });
    expect(planClientPipelineWrite(reading, null, inB)).toEqual({});
  });

  it("finds an older row's pipeline through its stage", () => {
    const older: ClientPlacement = { current_stage_id: STAGE_B1, current_pipeline_id: null, current_stage_pipeline_id: PIPE_B };
    expect(placedPipelineOf(older)).toBe(PIPE_B);
    const reading = read({ current_stage_id: null, pipeline_id: PIPE_A });
    expect(planClientPipelineWrite(reading, null, older)).toEqual({});
  });

  it("never puts a column outside the write set in a patch", () => {
    const plans = [
      planClientPipelineWrite(read({ current_stage_id: STAGE_A1, pipeline_notes: "n" }), stageA1, nowhere),
      planClientPipelineWrite(read({ current_stage_id: null, pipeline_id: PIPE_B }), null, inB),
      planClientPipelineWrite(read({ equity_release: 5 }), null, nowhere),
    ];
    for (const patch of plans) {
      for (const key of Object.keys(patch)) expect(CLIENT_PIPELINE_WRITE_COLUMNS.has(key)).toBe(true);
    }
    expect([...CLIENT_PIPELINE_COLUMNS].every((c) => CLIENT_PIPELINE_WRITE_COLUMNS.has(c))).toBe(true);
  });

  it("reads an id the way the database stores one", () => {
    expect(isPipelineUuid(PIPE_A)).toBe(true);
    expect(isPipelineUuid(` ${PIPE_A} `)).toBe(true);
    expect(isPipelineUuid("all")).toBe(false);
    expect(isPipelineUuid(null)).toBe(false);
  });
});

describe("manage-automation-settings answers the tracker's own permission", () => {
  const source = readFileSync(
    resolve(__dirname, "../../../../supabase/functions/manage-automation-settings/index.ts"),
    "utf8",
  );
  const handler = source.slice(source.indexOf("operation === 'updateClientPipeline'"));

  it("gates the board's reads on viewing and a move on editing", () => {
    expect(source).toMatch(/getPipelines:\s*'can_view'/);
    expect(source).toMatch(/getStages:\s*'can_view'/);
    expect(source).toMatch(/updateClientPipeline:\s*'can_edit'/);
    expect(source).toContain("requireModulePermission(supabase, actor, 'client_tracker', trackerPermission)");
  });

  it("asks whether the person may act for the client before reading or writing it", () => {
    const access = handler.indexOf("canAccessClient(");
    expect(access).toBeGreaterThan(-1);
    expect(access).toBeLessThan(handler.indexOf(".from('clients')"));
  });

  it("writes the client through the closed field set and the looked-up stage", () => {
    expect(handler).toContain("pickAllowed(patch, CLIENT_PIPELINE_WRITE_COLUMNS)");
    expect(handler).toContain("readPipelineUpdate(data)");
    expect(handler).toContain(".from('ghl_pipeline_stages')");
  });
});
