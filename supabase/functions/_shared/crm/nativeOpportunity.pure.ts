/**
 * The board placement a Client Tracker move writes on this line.
 *
 * The board places a card by its `ghl_client_opportunities` rows first and by
 * the client's own `current_stage_id` only where it has none. On a deployment
 * that synced from GoHighLevel the sync wrote those rows. Here nothing did, so
 * a move wrote the client's columns and left the board to its fallback, a
 * client could never be put on a second pipeline, and the marketing
 * distribution, which finds its recipients by opportunity, found nobody.
 *
 * Three rules.
 *
 *  - **One placement per client per pipeline.** A move updates every row the
 *    client already holds in that pipeline, whoever wrote it: the `ghl_*`
 *    tables are this CRM's own storage, and a second row beside a migrated one
 *    would draw the client twice. Only where there is none is a row written,
 *    keyed `native:<pipeline id>`, so a repeated move is the same row.
 *  - **Leaving a pipeline keeps the record.** The rows lose their stage and
 *    keep everything else (value, notes, status). Nothing here deletes.
 *  - **A clear that names no pipeline places nothing**, because there is no
 *    pipeline to say anything about.
 */
import type { StageIntent, StageRow } from "../clientPipelineUpdate.pure.ts";

/** The key a placement this line writes carries in `ghl_opportunity_id`. */
export function nativeOpportunityKey(pipelineId: string): string {
  return `native:${pipelineId}`;
}

export type ExistingOpportunity = { readonly id: string };

export type NativeOpportunityRow = {
  readonly client_id: string;
  readonly ghl_opportunity_id: string;
  readonly ghl_contact_id: string;
  readonly pipeline_id: string;
  readonly stage_id: string;
  readonly pipeline_name: string | null;
  readonly stage_name: string;
  readonly opportunity_status: "open";
  readonly opportunity_name: string | null;
  readonly synced_at: string;
};

export type OpportunityPlan =
  | { readonly kind: "none" }
  | {
    readonly kind: "update";
    readonly ids: readonly string[];
    readonly patch: {
      readonly stage_id: string | null;
      readonly stage_name: string | null;
      readonly pipeline_name?: string | null;
      readonly synced_at?: string;
    };
  }
  | { readonly kind: "insert"; readonly row: NativeOpportunityRow };

/** The pipeline whose rows a move reads before it plans, or null for none. */
export function pipelineOfIntent(intent: StageIntent, stage: StageRow | null): string | null {
  if (intent.kind === "set") return stage?.pipeline_id ?? null;
  if (intent.kind === "clear") return intent.pipelineId;
  return null;
}

export function planOpportunityPlacement(input: {
  readonly intent: StageIntent;
  readonly clientId: string;
  readonly contactId: string | null;
  readonly clientName: string | null;
  readonly stage: StageRow | null;
  readonly pipelineName: string | null;
  /** The client's rows in the pipeline `pipelineOfIntent` names. */
  readonly existing: readonly ExistingOpportunity[];
  readonly now: string;
}): OpportunityPlan {
  const { intent, existing } = input;

  if (intent.kind === "unchanged") return { kind: "none" };

  if (intent.kind === "clear") {
    if (intent.pipelineId === null || existing.length === 0) return { kind: "none" };
    return {
      kind: "update",
      ids: existing.map((row) => row.id),
      patch: { stage_id: null, stage_name: null },
    };
  }

  const stage = input.stage;
  if (!stage || stage.id !== intent.stageId) {
    throw new Error("planOpportunityPlacement: a stage move needs the stage it names");
  }

  if (existing.length > 0) {
    return {
      kind: "update",
      ids: existing.map((row) => row.id),
      patch: {
        stage_id: stage.id,
        stage_name: stage.name,
        pipeline_name: input.pipelineName,
        synced_at: input.now,
      },
    };
  }

  const contact = input.contactId?.trim();
  const name = input.clientName?.trim();
  return {
    kind: "insert",
    row: {
      client_id: input.clientId,
      ghl_opportunity_id: nativeOpportunityKey(stage.pipeline_id),
      // NOT NULL in the table. A client this line created has no vendor
      // contact, and a value that can never be one says where it came from.
      ghl_contact_id: contact ? contact : `native:${input.clientId}`,
      pipeline_id: stage.pipeline_id,
      stage_id: stage.id,
      pipeline_name: input.pipelineName,
      stage_name: stage.name,
      opportunity_status: "open",
      opportunity_name: name ? name : null,
      synced_at: input.now,
    },
  };
}
