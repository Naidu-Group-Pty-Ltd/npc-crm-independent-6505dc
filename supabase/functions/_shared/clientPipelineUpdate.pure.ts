/**
 * What a Client Tracker save writes to the client: the fields a person may
 * set, and the placement a stage implies.
 *
 * `updateClientPipeline` used to write whatever eight fields the request named
 * and to trust the request's own `pipeline_status` beside its
 * `current_stage_id`, so a stage could be stored under another stage's name.
 * It never set `current_pipeline_id` at all, and the board filters a pipeline
 * by that column, so a client given a stage from the edit form vanished from
 * that pipeline's own view while still showing under "All pipelines".
 *
 * Three rules hold it now.
 *
 *  - **A stage is looked up, never described.** Its pipeline and its name come
 *    from `ghl_pipeline_stages`; the request names only the stage's id, and an
 *    id the table does not hold is refused.
 *  - **Taking a client off a pipeline touches only that pipeline.** Where the
 *    request names the pipeline and the client's recorded placement is in a
 *    different one, the client's own columns are left alone, status included.
 *    A clear that names no pipeline is the older call and does what it always
 *    did: it empties `current_stage_id` and nothing else.
 *  - **The writable fields are a closed set** (`CLIENT_PIPELINE_COLUMNS`), and a
 *    value of the wrong shape is refused in a sentence rather than coerced.
 *
 * Pure, so the edge function and the tests read the same rules.
 */

/** The fields a person may write through a Client Tracker save. */
export const CLIENT_PIPELINE_COLUMNS: Set<string> = new Set([
  "pipeline_status",
  "follow_up_date",
  "borrowing_capacity",
  "proposed_rental_income",
  "equity_release",
  "pipeline_notes",
]);

/** Every column `planClientPipelineWrite` may put in a patch: the fields
 *  above, and the placement only a looked-up stage decides. */
export const CLIENT_PIPELINE_WRITE_COLUMNS: Set<string> = new Set([
  ...CLIENT_PIPELINE_COLUMNS,
  "current_stage_id",
  "current_pipeline_id",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPipelineUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value.trim());
}

/** What the save asks of the client's placement on the board. */
export type StageIntent =
  | { readonly kind: "unchanged" }
  | { readonly kind: "set"; readonly stageId: string }
  | { readonly kind: "clear"; readonly pipelineId: string | null };

export type PipelineUpdateReading =
  | {
    readonly ok: true;
    readonly fields: Record<string, unknown>;
    readonly stage: StageIntent;
    readonly message?: undefined;
  }
  | { readonly ok: false; readonly message: string };

const MONEY_LABELS: Record<string, string> = {
  borrowing_capacity: "Borrowing capacity",
  proposed_rental_income: "Rental income",
  equity_release: "Equity release",
};

const MAX_STATUS = 200;
const MAX_NOTES = 10_000;

function readText(value: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length > max) return { ok: false };
  return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

function readDate(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed) || Number.isNaN(Date.parse(trimmed))) return { ok: false };
  return { ok: true, value: trimmed };
}

/**
 * The request's `data` as the fields to write and what it asks of the
 * placement. A key the request leaves out is not written; `null` is.
 */
export function readPipelineUpdate(data: unknown): PipelineUpdateReading {
  const input = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};

  if (input.pipeline_status !== undefined) {
    const status = readText(input.pipeline_status, MAX_STATUS);
    if (!status.ok) return { ok: false, message: `A status is text of up to ${MAX_STATUS} characters.` };
    fields.pipeline_status = status.value;
  }

  if (input.pipeline_notes !== undefined) {
    const notes = readText(input.pipeline_notes, MAX_NOTES);
    if (!notes.ok) return { ok: false, message: `Notes are text of up to ${MAX_NOTES.toLocaleString("en-AU")} characters.` };
    fields.pipeline_notes = notes.value;
  }

  if (input.follow_up_date !== undefined) {
    const date = readDate(input.follow_up_date);
    if (!date.ok) return { ok: false, message: "A follow-up date must be a date." };
    fields.follow_up_date = date.value;
  }

  for (const [column, label] of Object.entries(MONEY_LABELS)) {
    const value = input[column];
    if (value === undefined) continue;
    if (value === null) {
      fields[column] = null;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { ok: false, message: `${label} must be an amount of zero or more.` };
    }
    fields[column] = value;
  }

  let stage: StageIntent = { kind: "unchanged" };
  if (input.current_stage_id !== undefined) {
    const raw = input.current_stage_id;
    if (raw === null || raw === "") {
      const pipeline = input.pipeline_id;
      if (pipeline !== undefined && pipeline !== null && !isPipelineUuid(pipeline)) {
        return { ok: false, message: "That pipeline is not one this board knows." };
      }
      stage = { kind: "clear", pipelineId: isPipelineUuid(pipeline) ? pipeline.trim() : null };
    } else if (isPipelineUuid(raw)) {
      stage = { kind: "set", stageId: raw.trim() };
    } else {
      return { ok: false, message: "That stage is not one this board knows." };
    }
  }

  return { ok: true, fields, stage };
}

/** A stage as `ghl_pipeline_stages` holds it. */
export type StageRow = {
  readonly id: string;
  readonly name: string;
  readonly pipeline_id: string;
};

/** Where the client's own columns place them now. */
export type ClientPlacement = {
  readonly current_stage_id: string | null;
  readonly current_pipeline_id: string | null;
  /** The pipeline `current_stage_id` belongs to, for a row saved before
   *  `current_pipeline_id` was written. Null when unknown. */
  readonly current_stage_pipeline_id: string | null;
};

/** The pipeline the client's own columns place them in, if any. */
export function placedPipelineOf(client: ClientPlacement): string | null {
  return client.current_pipeline_id ?? client.current_stage_pipeline_id ?? null;
}

/**
 * The patch for the `clients` row. `stage` is the looked-up row for a `set`
 * intent and is ignored otherwise; a `set` with no row is the caller's bug and
 * throws rather than writing a stage nobody found.
 */
export function planClientPipelineWrite(
  reading: { readonly fields: Record<string, unknown>; readonly stage: StageIntent },
  stage: StageRow | null,
  client: ClientPlacement,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(reading.fields)) {
    if (CLIENT_PIPELINE_COLUMNS.has(key)) patch[key] = value;
  }

  const intent = reading.stage;
  if (intent.kind === "set") {
    if (!stage || stage.id !== intent.stageId) {
      throw new Error("planClientPipelineWrite: a stage move needs the stage it names");
    }
    patch.current_stage_id = stage.id;
    patch.current_pipeline_id = stage.pipeline_id;
    patch.pipeline_status = stage.name;
    return patch;
  }

  if (intent.kind === "clear") {
    if (intent.pipelineId === null) {
      patch.current_stage_id = null;
      return patch;
    }
    const placed = placedPipelineOf(client);
    if (placed === null || placed === intent.pipelineId) {
      patch.current_stage_id = null;
      patch.current_pipeline_id = null;
    } else {
      // The client's recorded placement is in another pipeline. Its status
      // describes that placement, and leaving this one must not overwrite it.
      delete patch.pipeline_status;
    }
  }

  return patch;
}
