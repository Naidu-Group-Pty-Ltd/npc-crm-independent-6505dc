/**
 * Writes the board placement `nativeOpportunity.pure.ts` plans.
 *
 * Called by `manage-automation-settings` after the client's own row is saved.
 * It reads the client's rows in the one pipeline the move is about, and either
 * moves them or writes the placement this line keeps for a client with none.
 * A read or write that fails is reported as a failure, never as "nothing to
 * do", because the board would then go on drawing the client where they were.
 */
import type { StageIntent, StageRow } from "../clientPipelineUpdate.pure.ts";
import { pipelineOfIntent, planOpportunityPlacement } from "./nativeOpportunity.pure.ts";

export type PlacementClient = {
  readonly id: string;
  readonly ghl_contact_id: string | null;
  readonly primary_first_name: string | null;
  readonly primary_surname: string | null;
};

export type PlacementResult =
  | { readonly ok: true; readonly message?: undefined }
  | { readonly ok: false; readonly message: string };

const NOT_PLACED =
  "The client's stage was saved, but the board could not record the move. Refresh the board and move the card again.";

export async function placeNativeOpportunity(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  input: { readonly intent: StageIntent; readonly stage: StageRow | null; readonly client: PlacementClient },
): Promise<PlacementResult> {
  const pipelineId = pipelineOfIntent(input.intent, input.stage);
  if (!pipelineId) return { ok: true };

  const { data: existing, error: readError } = await supabase
    .from("ghl_client_opportunities")
    .select("id")
    .eq("client_id", input.client.id)
    .eq("pipeline_id", pipelineId);
  if (readError) return { ok: false, message: NOT_PLACED };

  let pipelineName: string | null = null;
  if (input.intent.kind === "set") {
    const { data: pipeline, error: pipelineError } = await supabase
      .from("ghl_pipelines")
      .select("name")
      .eq("id", pipelineId)
      .maybeSingle();
    if (pipelineError) return { ok: false, message: NOT_PLACED };
    pipelineName = typeof pipeline?.name === "string" ? pipeline.name : null;
  }

  const name = [input.client.primary_first_name, input.client.primary_surname]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0)
    .join(" ");

  const plan = planOpportunityPlacement({
    intent: input.intent,
    clientId: input.client.id,
    contactId: input.client.ghl_contact_id,
    clientName: name.length > 0 ? name : null,
    stage: input.stage,
    pipelineName,
    existing: (existing ?? []) as { id: string }[],
    now: new Date().toISOString(),
  });

  if (plan.kind === "none") return { ok: true };

  if (plan.kind === "update") {
    const { error } = await supabase
      .from("ghl_client_opportunities")
      .update(plan.patch)
      .in("id", [...plan.ids]);
    return error ? { ok: false, message: NOT_PLACED } : { ok: true };
  }

  // An upsert on the table's own unique key, so two quick moves of a client
  // with no placement write one row rather than refusing the second.
  const { error } = await supabase
    .from("ghl_client_opportunities")
    .upsert(plan.row, { onConflict: "client_id,ghl_opportunity_id" });
  return error ? { ok: false, message: NOT_PLACED } : { ok: true };
}
