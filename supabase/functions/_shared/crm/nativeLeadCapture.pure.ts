// WHERE A LEAD MAGNET'S LEAD GOES ON A NATIVE DEPLOYMENT.
//
// ## The failure this exists to stop
//
// `request-lead-magnet` captured the download, answered the visitor, and then
// pushed the lead to GoHighLevel: a contact upsert, a tag, and an opportunity
// in the pipeline stage the magnet names. This line holds no vendor account, so
// the push logged "GHL skipped" and returned. The download row was kept, the
// visitor got the file, and the lead reached no client record, no tag and no
// pipeline. The captures dialog read "Pending" beside every one of them.
//
// ## Four rules
//
// **A client is matched only where exactly one holds the address.** The same
// rule `crm-inbound-message` applies to a phone number. Two clients sharing an
// address is a fact about the records, and filing the lead against either one
// would be a guess. A lead that matches several is left unfiled and says why.
//
// **The address is the one the visitor typed.** The capture de-duplicates on a
// normalised form (a Gmail address loses its dots and its `+tag`), which is the
// right key for counting downloads and the wrong value for a client's email.
//
// **A download never moves a client who is already on the pipeline.** The
// vendor path created an opportunity beside whatever the contact already had.
// Here a client already placed in that pipeline keeps their stage, because a
// signed client who downloads a guide is not a new lead.
//
// **An existing client's own record is not rewritten.** Their source, name and
// number stay as recorded. Only a new client gets the lead's details, and only
// a client with no placement at all takes the magnet's stage as their own.

export type LeadMagnetTarget = {
  readonly title: string;
  readonly ghl_tag: string | null;
  /** The pipeline, by the key the panel stores: a `ghl_id` or a row id. */
  readonly ghl_pipeline_id: string | null;
  readonly ghl_stage_id: string | null;
};

export type ClientEmailCandidate = {
  readonly id: string;
  readonly primary_email: string | null;
};

export type ClientMatch =
  | { readonly kind: "one"; readonly clientId: string }
  | { readonly kind: "none" }
  | { readonly kind: "several"; readonly count: number };

/** The `lead_source` a client created from a download carries. */
export const LEAD_MAGNET_SOURCE = "Lead magnet";

/** What the captures dialog records when a lead could not be filed. */
export const SEVERAL_CLIENTS_SHARE_ADDRESS =
  "Several clients share this email address, so the lead was not filed against any of them.";

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The tag the lead is filed under, as the vendor path named it. */
export function leadMagnetTagName(magnet: LeadMagnetTarget): string {
  return trimmed(magnet.ghl_tag) || `Lead Magnet: ${trimmed(magnet.title)}`;
}

/** First word and the rest, the split the vendor path made. */
export function splitFullName(fullName: string): { readonly first: string; readonly surname: string } {
  const words = trimmed(fullName).split(/\s+/).filter((word) => word.length > 0);
  return { first: words[0] ?? "", surname: words.slice(1).join(" ") };
}

/**
 * The pattern for an `ilike` that means "this exact text". `_` and `%` are
 * wildcards there, and `_` is common in addresses, so an unescaped `john_doe@`
 * would also find `johnXdoe@`. The match is confirmed exactly afterwards too.
 */
export function exactIlikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function matchClientByEmail(
  email: string,
  candidates: readonly ClientEmailCandidate[],
): ClientMatch {
  const wanted = trimmed(email).toLowerCase();
  if (!wanted) return { kind: "none" };
  const ids = new Set(
    candidates
      .filter((candidate) => trimmed(candidate.primary_email).toLowerCase() === wanted)
      .map((candidate) => candidate.id),
  );
  if (ids.size === 0) return { kind: "none" };
  if (ids.size > 1) return { kind: "several", count: ids.size };
  return { kind: "one", clientId: [...ids][0] };
}

/** The row a lead with no client record becomes. */
export function newLeadClientRow(input: {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
  readonly magnet: LeadMagnetTarget;
}): Record<string, string | null> {
  const { first, surname } = splitFullName(input.fullName);
  return {
    primary_first_name: first,
    primary_surname: surname,
    primary_email: trimmed(input.email).toLowerCase(),
    primary_mobile: trimmed(input.phone) || null,
    lead_source: LEAD_MAGNET_SOURCE,
    lead_source_detail: trimmed(input.magnet.title) || null,
  };
}

/** True where a value is a row id rather than a stored key. */
const ROW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StageCandidate = {
  readonly id: string;
  readonly ghl_id: string | null;
  readonly name: string;
  readonly pipeline_id: string;
};

export type PipelineCandidate = {
  readonly id: string;
  readonly ghl_id: string | null;
};

export type StageResolution =
  | { readonly kind: "none" }
  | { readonly kind: "stage"; readonly stage: { readonly id: string; readonly name: string; readonly pipeline_id: string } }
  /** The magnet names a stage that is not in the pipeline it names, or neither exists. */
  | { readonly kind: "unknown" };

/** The column a stored key is looked up by. */
export function keyColumn(key: string): "id" | "ghl_id" {
  return ROW_ID.test(key) ? "id" : "ghl_id";
}

/**
 * The stage the magnet names, confirmed to belong to the pipeline it names.
 * `stage` and `pipeline` are what the two lookups found, or null.
 */
export function resolveMagnetStage(
  magnet: LeadMagnetTarget,
  stage: StageCandidate | null,
  pipeline: PipelineCandidate | null,
): StageResolution {
  const pipelineKey = trimmed(magnet.ghl_pipeline_id);
  const stageKey = trimmed(magnet.ghl_stage_id);
  if (!pipelineKey || !stageKey) return { kind: "none" };
  if (!stage || !pipeline) return { kind: "unknown" };
  const stageNamed = stage.id === stageKey || stage.ghl_id === stageKey;
  const pipelineNamed = pipeline.id === pipelineKey || pipeline.ghl_id === pipelineKey;
  if (!stageNamed || !pipelineNamed || stage.pipeline_id !== pipeline.id) return { kind: "unknown" };
  return { kind: "stage", stage: { id: stage.id, name: stage.name, pipeline_id: stage.pipeline_id } };
}

/**
 * The client columns a placement writes. Only a client with no placement at
 * all takes the magnet's stage as their own; anyone else keeps theirs, and the
 * board draws the new pipeline from its opportunity row.
 */
export function clientPlacementPatch(
  client: { readonly current_stage_id: string | null; readonly current_pipeline_id: string | null },
  stage: { readonly id: string; readonly name: string; readonly pipeline_id: string },
): Record<string, string> | null {
  if (client.current_stage_id || client.current_pipeline_id) return null;
  return {
    current_stage_id: stage.id,
    current_pipeline_id: stage.pipeline_id,
    pipeline_status: stage.name,
  };
}
