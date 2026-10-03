/**
 * The board placement a Client Tracker move writes on this line, where no
 * vendor sync writes `ghl_client_opportunities` for it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { StageIntent, StageRow } from "../../../../supabase/functions/_shared/clientPipelineUpdate.pure";
import {
  nativeOpportunityKey,
  pipelineOfIntent,
  planOpportunityPlacement,
} from "../../../../supabase/functions/_shared/crm/nativeOpportunity.pure";

const CLIENT = "55555555-5555-4555-8555-555555555555";
const PIPE = "11111111-1111-4111-8111-111111111111";
const STAGE = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-10-03T00:00:00.000Z";
const stage: StageRow = { id: STAGE, name: "Qualified", pipeline_id: PIPE };
const set: StageIntent = { kind: "set", stageId: STAGE };

function plan(over: Partial<Parameters<typeof planOpportunityPlacement>[0]> = {}) {
  return planOpportunityPlacement({
    intent: set,
    clientId: CLIENT,
    contactId: null,
    clientName: "Ada Lovelace",
    stage,
    pipelineName: "Buyers",
    existing: [],
    now: NOW,
    ...over,
  });
}

describe("which pipeline a move is about", () => {
  it("is the stage's for a move, the named one for a clear, and none otherwise", () => {
    expect(pipelineOfIntent(set, stage)).toBe(PIPE);
    expect(pipelineOfIntent({ kind: "clear", pipelineId: PIPE }, null)).toBe(PIPE);
    expect(pipelineOfIntent({ kind: "clear", pipelineId: null }, null)).toBeNull();
    expect(pipelineOfIntent({ kind: "unchanged" }, null)).toBeNull();
  });
});

describe("placing a client on a pipeline", () => {
  it("writes one placement keyed to the pipeline where the client has none", () => {
    expect(plan()).toEqual({
      kind: "insert",
      row: {
        client_id: CLIENT,
        ghl_opportunity_id: nativeOpportunityKey(PIPE),
        ghl_contact_id: `native:${CLIENT}`,
        pipeline_id: PIPE,
        stage_id: STAGE,
        pipeline_name: "Buyers",
        stage_name: "Qualified",
        opportunity_status: "open",
        opportunity_name: "Ada Lovelace",
        synced_at: NOW,
      },
    });
  });

  it("keys a repeated move to the same row", () => {
    const first = plan();
    const second = plan({ now: "2026-10-04T00:00:00.000Z" });
    if (first.kind !== "insert" || second.kind !== "insert") throw new Error("expected inserts");
    expect(second.row.ghl_opportunity_id).toBe(first.row.ghl_opportunity_id);
  });

  it("carries a contact the client already holds", () => {
    const placed = plan({ contactId: " contact-9 " });
    if (placed.kind !== "insert") throw new Error("expected an insert");
    expect(placed.row.ghl_contact_id).toBe("contact-9");
  });

  it("moves every row the client already holds in the pipeline, whoever wrote it", () => {
    expect(plan({ existing: [{ id: "migrated" }, { id: "native" }] })).toEqual({
      kind: "update",
      ids: ["migrated", "native"],
      patch: { stage_id: STAGE, stage_name: "Qualified", pipeline_name: "Buyers", synced_at: NOW },
    });
  });

  it("will not place a move without the stage it names", () => {
    expect(() => plan({ stage: null })).toThrow();
  });
});

describe("taking a client off a pipeline", () => {
  it("empties the stage and keeps the record", () => {
    expect(plan({ intent: { kind: "clear", pipelineId: PIPE }, stage: null, existing: [{ id: "row" }] })).toEqual({
      kind: "update",
      ids: ["row"],
      patch: { stage_id: null, stage_name: null },
    });
  });

  it("does nothing where there is nothing to take off", () => {
    expect(plan({ intent: { kind: "clear", pipelineId: PIPE }, stage: null })).toEqual({ kind: "none" });
    expect(plan({ intent: { kind: "clear", pipelineId: null }, stage: null, existing: [{ id: "row" }] }))
      .toEqual({ kind: "none" });
  });

  it("does nothing for a save that does not move the client", () => {
    expect(plan({ intent: { kind: "unchanged" }, existing: [{ id: "row" }] })).toEqual({ kind: "none" });
  });
});

describe("the writer", () => {
  const writer = readFileSync(
    resolve(__dirname, "../../../../supabase/functions/_shared/crm/nativeOpportunityWriter.ts"),
    "utf8",
  );

  it("never deletes a placement", () => {
    expect(writer).not.toMatch(/\.delete\(/);
  });

  it("writes a new placement on the table's own unique key", () => {
    expect(writer).toContain('onConflict: "client_id,ghl_opportunity_id"');
  });

  it("reports a failed read as a failure, not as nothing to do", () => {
    expect(writer).toMatch(/if \(readError\) return \{ ok: false/);
  });
});
