/**
 * AML/CTF obligations that fall due, on the reminders the operator already
 * reads.
 *
 * ── The gap this closes ───────────────────────────────────────────────
 * A scheduled periodic review lived in `aml.existing_customer_reviews` and
 * on one card at the foot of Stage 10. The Command Centre's Reminders hub
 * aggregates `client_reminders`, client follow-ups and deal milestones —
 * and AML reviews appeared in **none** of them. So the one obligation with
 * a statutory character and a three-year horizon was the one obligation
 * nobody would see coming, on the one screen built for exactly that.
 *
 * ── Why `client_reminders` and not a new table ────────────────────────
 * Because a second reminder system is how two reminder systems disagree.
 * `client_reminders` already feeds the Reminders hub, the Calendar and the
 * client record; writing there means an AML review is reminded about
 * everywhere reminders are, with no new surface, no new query and no new
 * notion of "due".
 *
 * ── Three rules ───────────────────────────────────────────────────────
 *
 * **Idempotent by source.** `source_ref` carries the id of the thing the
 * reminder is about — a review, an attestation — and the partial unique
 * index on `(client_id, reminder_type, source_ref)` makes re-running an op
 * an update rather than a duplicate. A reminder somebody typed has a NULL
 * `source_ref` and can never collide with one of these.
 *
 * **A reminder is never the record.** It points at an obligation recorded
 * elsewhere and holds no compliance state of its own. Deleting every row
 * this module writes loses nothing but the prompt.
 *
 * **It never fails the act it accompanies.** Scheduling a review, issuing a
 * Passport and ending a relationship are the compliance acts; a reminder
 * that cannot be written must not roll one back. Every function here
 * reports its outcome and throws nothing.
 */

export const AML_REMINDER_TYPES = {
  periodic_review: "aml_periodic_review",
  trigger_review: "aml_trigger_review",
  passport_issued: "aml_passport_issued",
} as const;

export type AmlReminderType = typeof AML_REMINDER_TYPES[keyof typeof AML_REMINDER_TYPES];

/** Every reminder type this module owns — used to sweep a case's reminders. */
export const ALL_AML_REMINDER_TYPES: readonly string[] =
  Object.values(AML_REMINDER_TYPES);

export interface ComplianceReminderInput {
  clientId: string | null | undefined;
  type: AmlReminderType;
  /** The row this reminder is about. Absent = nothing to key on; skipped. */
  sourceRef: string | null | undefined;
  title: string;
  description: string;
  /** ISO timestamp the obligation falls due. */
  dueDate: string;
  priority: "high" | "medium" | "low";
  createdBy?: string | null;
}

export interface ReminderOutcome {
  written: boolean;
  /** Why not, when not — recorded rather than thrown. */
  skipped?: "no_client" | "no_source_ref" | "error";
  error?: string;
}

/**
 * Create or move the reminder for one obligation.
 *
 * A case with no `client_id` is a real state — an AML case can be opened
 * against a subject before a CRM client record exists — and it is skipped
 * rather than treated as a failure. There is nobody's file to remind on.
 */
export async function upsertComplianceReminder(
  admin: any,
  input: ComplianceReminderInput,
): Promise<ReminderOutcome> {
  if (!input.clientId) return { written: false, skipped: "no_client" };
  if (!input.sourceRef) return { written: false, skipped: "no_source_ref" };

  try {
    const { data: existing } = await admin.from("client_reminders")
      .select("id, status")
      .eq("client_id", input.clientId)
      .eq("reminder_type", input.type)
      .eq("source_ref", input.sourceRef)
      .limit(1).maybeSingle();

    const row = {
      client_id: input.clientId,
      title: input.title,
      description: input.description,
      due_date: input.dueDate,
      priority: input.priority,
      reminder_type: input.type,
      reminder_scope: "client",
      source_ref: input.sourceRef,
    };

    if (existing?.id) {
      /* `status` is deliberately untouched: an operator who completed this
         reminder has said something about it, and re-running the op that
         created it must not undo that. Only the date and wording move. */
      const { error } = await admin.from("client_reminders")
        .update(row).eq("id", existing.id);
      if (error) return { written: false, skipped: "error", error: error.message };
      return { written: true };
    }

    const { error } = await admin.from("client_reminders").insert({
      ...row,
      status: "pending",
      created_by: input.createdBy ?? null,
    });
    if (error) return { written: false, skipped: "error", error: error.message };
    return { written: true };
  } catch (e) {
    return { written: false, skipped: "error", error: String((e as Error)?.message ?? e) };
  }
}

/**
 * Mark the reminder for a discharged obligation complete.
 *
 * Completing a review or ending a relationship settles the obligation; the
 * prompt must not go on prompting. It is completed rather than deleted, so
 * the operator's Reminders hub shows what happened rather than a row that
 * silently vanished.
 */
export async function completeComplianceReminder(
  admin: any,
  args: { clientId: string | null | undefined; type: AmlReminderType; sourceRef: string | null | undefined },
): Promise<ReminderOutcome> {
  if (!args.clientId) return { written: false, skipped: "no_client" };
  if (!args.sourceRef) return { written: false, skipped: "no_source_ref" };
  try {
    const { error } = await admin.from("client_reminders")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("client_id", args.clientId)
      .eq("reminder_type", args.type)
      .eq("source_ref", args.sourceRef)
      .neq("status", "completed");
    if (error) return { written: false, skipped: "error", error: error.message };
    return { written: true };
  } catch (e) {
    return { written: false, skipped: "error", error: String((e as Error)?.message ?? e) };
  }
}

/* ── Wording ───────────────────────────────────────────────────────────
 * In one place, because a reminder is read months or years after it was
 * written, by somebody who was not there. It names the customer's case, the
 * obligation and where to go — and it says nothing about risk ratings,
 * screening outcomes or decisions, because a reminder row is not a
 * disclosure boundary and must not become one.                            */

/** Day/Month/Year, pinned — see `src/lib/aml/displayDate.ts` for why. */
function auDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-AU");
}

export function periodicReviewReminder(args: {
  caseReference: string | null;
  dueAt: string;
  intervalMonths: number;
}): { title: string; description: string } {
  return {
    title: `AML/CTF periodic review due — ${args.caseReference ?? "compliance case"}`,
    description:
      `Ongoing customer due diligence review falls due ${auDate(args.dueAt)} `
      + `(${args.intervalMonths}-month cycle). Open the case's Ongoing CDD stage to complete it.`,
  };
}

export function triggerReviewReminder(args: {
  caseReference: string | null;
  dueAt: string;
  triggerLabel: string;
}): { title: string; description: string } {
  return {
    title: `AML/CTF trigger review — ${args.caseReference ?? "compliance case"}`,
    description:
      `${args.triggerLabel}. An out-of-cycle review is due ${auDate(args.dueAt)}. `
      + `Open the case's Ongoing CDD stage to complete it.`,
  };
}

export function passportIssuedReminder(args: {
  caseReference: string | null;
  subjectLabel: string | null;
  version: number;
  nextReviewAt: string | null;
}): { title: string; description: string } {
  const who = args.subjectLabel ?? args.caseReference ?? "this customer";
  return {
    title: `Compliance Passport issued — ${who}`,
    description:
      `Version ${args.version} of the AML/CTF Compliance Passport has been issued and is in force. `
      + (args.nextReviewAt
        ? `Ongoing customer due diligence now runs on this case: the first periodic review falls due ${auDate(args.nextReviewAt)}. `
        : "Ongoing customer due diligence now runs on this case. ")
      + "Share it with the partners entitled to rely on it from the case's Passport & Partners stage.",
  };
}
