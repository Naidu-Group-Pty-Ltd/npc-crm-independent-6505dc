/**
 * Files one lead magnet download in this deployment's own CRM.
 *
 * `nativeLeadCapture.pure.ts` decides; this does the reads and writes in the
 * order its rules need. The client is settled first, because the tag and the
 * placement both hang off it. A tag or a placement that fails is logged and
 * the lead stays filed, since the client record is what staff act on and the
 * other two can be added from the client's page.
 */
import {
  clientPlacementPatch,
  exactIlikePattern,
  keyColumn,
  leadMagnetTagName,
  type LeadMagnetTarget,
  matchClientByEmail,
  newLeadClientRow,
  type PipelineCandidate,
  resolveMagnetStage,
  SEVERAL_CLIENTS_SHARE_ADDRESS,
  type StageCandidate,
} from "./nativeLeadCapture.pure.ts";
import { placeNativeOpportunity } from "./nativeOpportunityWriter.ts";

export type FiledLead =
  | {
    readonly ok: true;
    readonly clientId: string;
    /** The key the download row records, as the opportunity writer spells it. */
    readonly contactKey: string;
    readonly created: boolean;
    readonly placed: boolean;
  }
  | { readonly ok: false; readonly reason: string };

const CLIENT_COLUMNS =
  "id, ghl_contact_id, primary_first_name, primary_surname, current_stage_id, current_pipeline_id";

const LOG = "[request-lead-magnet]";

// deno-lint-ignore no-explicit-any
type Client = any;

async function readMagnetStage(supabase: Client, magnet: LeadMagnetTarget) {
  const stageKey = (magnet.ghl_stage_id ?? "").trim();
  if (!stageKey || !(magnet.ghl_pipeline_id ?? "").trim()) {
    return resolveMagnetStage(magnet, null, null);
  }
  const { data: stage, error: stageError } = await supabase
    .from("ghl_pipeline_stages")
    .select("id, ghl_id, name, pipeline_id")
    .eq(keyColumn(stageKey), stageKey)
    .maybeSingle();
  if (stageError) {
    console.error(`${LOG} The magnet's stage could not be read:`, stageError.message);
    return { kind: "unknown" } as const;
  }
  let pipeline: PipelineCandidate | null = null;
  if (stage) {
    const { data, error } = await supabase
      .from("ghl_pipelines")
      .select("id, ghl_id")
      .eq("id", (stage as StageCandidate).pipeline_id)
      .maybeSingle();
    if (error) {
      console.error(`${LOG} The magnet's pipeline could not be read:`, error.message);
      return { kind: "unknown" } as const;
    }
    pipeline = (data as PipelineCandidate | null) ?? null;
  }
  return resolveMagnetStage(magnet, (stage as StageCandidate | null) ?? null, pipeline);
}

async function tagClient(supabase: Client, clientId: string, magnet: LeadMagnetTarget): Promise<void> {
  const name = leadMagnetTagName(magnet);
  const { data: found, error: findError } = await supabase
    .from("client_tags")
    .select("id")
    .ilike("name", exactIlikePattern(name))
    .order("created_at", { ascending: true })
    .limit(1);
  if (findError) {
    console.error(`${LOG} The lead's tag could not be read:`, findError.message);
    return;
  }
  let tagId: string | null = found?.[0]?.id ?? null;
  if (!tagId) {
    const { data: created, error: createError } = await supabase
      .from("client_tags")
      .insert({ name, description: `Added to people who downloaded "${magnet.title}".` })
      .select("id")
      .single();
    if (createError || !created) {
      console.error(`${LOG} The lead's tag could not be created:`, createError?.message);
      return;
    }
    tagId = created.id;
  }
  const { error: assignError } = await supabase
    .from("client_tag_assignments")
    .upsert({ client_id: clientId, tag_id: tagId }, { onConflict: "client_id,tag_id", ignoreDuplicates: true });
  if (assignError) console.error(`${LOG} The lead's tag could not be assigned:`, assignError.message);
}

export async function fileNativeLead(
  supabase: Client,
  input: {
    readonly fullName: string;
    /** As the visitor typed it, lowercased. Never the de-duplication key. */
    readonly email: string;
    readonly phone: string | null;
    readonly magnet: LeadMagnetTarget;
  },
): Promise<FiledLead> {
  const { data: candidates, error: matchError } = await supabase
    .from("clients")
    .select("id, primary_email")
    .ilike("primary_email", exactIlikePattern(input.email))
    .limit(10);
  if (matchError) {
    console.error(`${LOG} Clients could not be read:`, matchError.message);
    return { ok: false, reason: "The client records could not be read, so the lead was not filed." };
  }
  const match = matchClientByEmail(input.email, candidates ?? []);
  if (match.kind === "several") return { ok: false, reason: SEVERAL_CLIENTS_SHARE_ADDRESS };

  const resolution = await readMagnetStage(supabase, input.magnet);
  if (resolution.kind === "unknown") {
    console.warn(`${LOG} The magnet names a pipeline stage this CRM does not hold; the lead is filed unplaced.`);
  }
  const stage = resolution.kind === "stage" ? resolution.stage : null;

  let client: Record<string, string | null>;
  let created = false;
  if (match.kind === "none") {
    const row = {
      ...newLeadClientRow(input),
      ...(stage ? clientPlacementPatch({ current_stage_id: null, current_pipeline_id: null }, stage) : {}),
    };
    const { data, error } = await supabase.from("clients").insert(row).select(CLIENT_COLUMNS).single();
    if (error || !data) {
      console.error(`${LOG} The lead could not be added as a client:`, error?.message);
      return { ok: false, reason: "The lead could not be added as a client." };
    }
    client = data;
    created = true;
  } else {
    const { data, error } = await supabase.from("clients").select(CLIENT_COLUMNS).eq("id", match.clientId).maybeSingle();
    if (error || !data) {
      console.error(`${LOG} The matched client could not be read:`, error?.message);
      return { ok: false, reason: "The client records could not be read, so the lead was not filed." };
    }
    client = data;
  }

  const clientId = String(client.id);
  await tagClient(supabase, clientId, input.magnet);

  let placed = false;
  if (stage) {
    const { data: existing, error: existingError } = await supabase
      .from("ghl_client_opportunities")
      .select("id")
      .eq("client_id", clientId)
      .eq("pipeline_id", stage.pipeline_id)
      .limit(1);
    if (existingError) {
      console.error(`${LOG} The client's placements could not be read:`, existingError.message);
    } else if ((existing ?? []).length === 0) {
      const result = await placeNativeOpportunity(supabase, {
        intent: { kind: "set", stageId: stage.id },
        stage,
        client: {
          id: clientId,
          ghl_contact_id: client.ghl_contact_id ?? null,
          primary_first_name: client.primary_first_name ?? null,
          primary_surname: client.primary_surname ?? null,
        },
      });
      if (!result.ok) {
        console.error(`${LOG} The lead could not be placed on the pipeline.`);
      } else {
        placed = true;
        if (!created) {
          const patch = clientPlacementPatch(
            { current_stage_id: client.current_stage_id ?? null, current_pipeline_id: client.current_pipeline_id ?? null },
            stage,
          );
          if (patch) {
            const { error } = await supabase.from("clients").update(patch).eq("id", clientId);
            if (error) console.error(`${LOG} The client's own stage could not be recorded:`, error.message);
          }
        }
      }
    }
  }

  const contact = typeof client.ghl_contact_id === "string" ? client.ghl_contact_id.trim() : "";
  return { ok: true, clientId, contactKey: contact || `native:${clientId}`, created, placed };
}
