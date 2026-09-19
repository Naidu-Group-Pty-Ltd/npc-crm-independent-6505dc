/**
 * Resetting a client journey, without destroying a compliance record.
 *
 * ── The problem, measured ─────────────────────────────────────────────
 * `aml.cases.client_id` is `ON DELETE SET NULL`, not `CASCADE`. So deleting
 * a client does not fail and does not cascade — it ORPHANS the AML case.
 * The customer disappears from the register while the case, its screening
 * subjects, its documents, its determinations and its event chain all remain,
 * attached to nobody and reachable by nothing.
 *
 * That is the worst of both outcomes: the operator believes the data is gone,
 * and the compliance record is now unattributable.
 *
 * ── Why "just cascade it" is the wrong fix ────────────────────────────
 * An AML/CTF case is a record the business is obliged to keep. Some of what
 * hangs off it is evidence that must survive regardless of what anybody wants
 * to tidy up: a submitted regulatory report, a recorded service-gate
 * decision, a confirmed sanctions match, an issued Passport, anything under
 * legal hold.
 *
 * So this module distinguishes two operations that are usually conflated:
 *
 *   RESTART  Close the current journey and begin a new one. The old case is
 *            retained and closed with a reason; the audit chain is unbroken.
 *            Always available, because it destroys nothing.
 *
 *   PURGE    Irreversibly remove the client and everything that hangs off
 *            them. Available ONLY when the case carries no evidence that must
 *            be retained — which is what makes it safe for the test data it
 *            exists for, and refuses on the production data it must not touch.
 *
 * The safeguard is not a confirmation dialog. It is that the system knows
 * what it is holding, and says no on its own.
 */

export type ClientResetMode = "restart" | "purge";

/** Evidence that must outlive any tidying-up. Each one refuses a purge. */
export interface CaseRetentionFacts {
  caseId: string;
  caseReference: string;
  /** A regulatory report (SMR/TTR) has been submitted from this case. */
  hasSubmittedReport: boolean;
  /** A service-gate decision has been recorded. */
  hasServiceGateDecision: boolean;
  /** A confirmed sanctions/screening match exists. */
  hasConfirmedMatch: boolean;
  /** A compliance passport has been issued. */
  hasIssuedPassport: boolean;
  /** An active legal hold covers this case. */
  underLegalHold: boolean;
  /** An MLRO decision has been recorded. */
  hasMlroDecision: boolean;
}

export interface ClientResetFacts {
  clientId: string;
  clientName: string;
  cases: CaseRetentionFacts[];
  /** What the operator typed to confirm. Compared to `clientName`. */
  typedConfirmation: string | null;
  /** Roles the caller holds. */
  roles: string[];
  requestedMode: ClientResetMode;
}

export interface ClientResetDecision {
  allowed: boolean;
  mode: ClientResetMode;
  /** Why a purge was refused, in an operator's words. Empty when allowed. */
  blockers: string[];
  /** What the operation will do, stated before it happens. */
  effects: string[];
  code:
    | "ok"
    | "role_required"
    | "confirmation_mismatch"
    | "retention_evidence"
    | "unknown_client";
  summary: string;
}

/** Only these roles may reset anything. A reset is a destructive act. */
const RESET_ROLES = ["mlro", "admin", "superadmin"];

/**
 * Names the evidence that makes a case un-purgeable.
 *
 * Deliberately one reason per line rather than a single "this case cannot be
 * deleted": an operator who is refused deserves to know which record is
 * holding it, because that is usually the thing they had forgotten existed.
 */
export function retentionBlockers(c: CaseRetentionFacts): string[] {
  const out: string[] = [];
  const at = `${c.caseReference}`;
  if (c.underLegalHold) out.push(`${at} is under an active legal hold.`);
  if (c.hasSubmittedReport) {
    out.push(`${at} has a submitted regulatory report, which must be retained.`);
  }
  if (c.hasConfirmedMatch) {
    out.push(`${at} carries a confirmed screening match — the evidence behind it must be retained.`);
  }
  if (c.hasServiceGateDecision) {
    out.push(`${at} has a recorded service-gate decision.`);
  }
  if (c.hasMlroDecision) out.push(`${at} has a recorded MLRO decision.`);
  if (c.hasIssuedPassport) {
    out.push(`${at} has an issued compliance passport held by a third party.`);
  }
  return out;
}

/** Case-insensitive, whitespace-tolerant. A name is not a password. */
function confirmationMatches(typed: string | null, name: string): boolean {
  if (!typed) return false;
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(typed) === norm(name) && norm(name).length > 0;
}

export function decideClientReset(facts: ClientResetFacts): ClientResetDecision {
  const mode = facts.requestedMode;
  const effectsRestart = [
    "Every open AML/CTF case is closed with a recorded reason.",
    "Client portal access is revoked, so the old invitation cannot be reused.",
    "All existing records are retained — nothing is deleted.",
    "The client can then be activated again for a fresh journey.",
  ];
  const effectsPurge = [
    "The client record and every dependent record are permanently deleted.",
    "AML/CTF cases, screening subjects, determinations, documents and events go with them.",
    "A purge receipt naming what was removed is written to the audit log and survives.",
    "This cannot be undone.",
  ];

  if (!facts.clientId || !facts.clientName) {
    return {
      allowed: false, mode, blockers: ["The client could not be resolved."],
      effects: [], code: "unknown_client",
      summary: "Nothing was reset — the client could not be resolved.",
    };
  }

  const roles = new Set(facts.roles.map((r) => r.toLowerCase()));
  if (!RESET_ROLES.some((r) => roles.has(r))) {
    return {
      allowed: false, mode, blockers: [
        "Resetting a client journey requires the MLRO or an administrator.",
      ],
      effects: [], code: "role_required",
      summary: "Not permitted for this role.",
    };
  }

  // Typed confirmation is required for BOTH modes. Restarting closes real
  // cases, which is not something to do by mis-click either.
  if (!confirmationMatches(facts.typedConfirmation, facts.clientName)) {
    return {
      allowed: false, mode, blockers: [
        `Type the client's name exactly — "${facts.clientName}" — to confirm.`,
      ],
      effects: mode === "purge" ? effectsPurge : effectsRestart,
      code: "confirmation_mismatch",
      summary: "Confirmation did not match.",
    };
  }

  if (mode === "purge") {
    const blockers = facts.cases.flatMap(retentionBlockers);
    if (blockers.length > 0) {
      return {
        allowed: false, mode, blockers,
        effects: effectsPurge, code: "retention_evidence",
        summary:
          "This client holds compliance evidence that must be retained, so it cannot " +
          "be deleted. Restart the journey instead — that closes the existing case " +
          "and lets a new one begin without destroying the record.",
      };
    }
    return {
      allowed: true, mode, blockers: [], effects: effectsPurge, code: "ok",
      summary: `${facts.clientName} and ${facts.cases.length} case(s) will be permanently deleted.`,
    };
  }

  return {
    allowed: true, mode: "restart", blockers: [], effects: effectsRestart, code: "ok",
    summary: `${facts.cases.length} case(s) will be closed and a fresh journey can begin.`,
  };
}

/**
 * The tables that do NOT go when the case goes.
 *
 * ── Why this is a list of ten and not a list of everything ────────────
 * The first version of this module enumerated what it believed were the
 * case's children, in dependency order, and deleted them by hand. That was
 * wrong in both directions, measured against the live FK graph:
 *
 *   47 of the 49 foreign keys to `aml.cases` are ON DELETE CASCADE. Twelve
 *   of the seventeen tables the hand-written list named were among them, so
 *   the list was doing work Postgres already does — and, worse, reading as
 *   though it were complete.
 *
 *   It was not complete. Fifty-odd `aml` tables carry a `case_id`, and the
 *   list named seventeen. Every table it missed that does not cascade is an
 *   orphan the purge would have left behind while reporting success.
 *
 * So this enumerates only what the cascade will NOT take, which is a
 * knowable, small and stable set:
 *
 *   NO FOREIGN KEY AT ALL   Eight tables carry a `case_id` column with no
 *                           constraint behind it. Postgres has no idea they
 *                           are related, so nothing cascades and nothing
 *                           complains. This is the majority of the risk.
 *
 *   ON DELETE SET NULL      `legal_holds` and `reports` deliberately survive
 *                           their case — a hold and a filed report outlive
 *                           the thing they were raised against. They are
 *                           listed so the purge can SEE them; a case holding
 *                           either is refused before it gets this far.
 *
 * ── The limit of this approach, stated rather than hidden ─────────────
 * This is a constant, and the schema is not. A migration that adds a ninth
 * unlinked `case_id` column would not appear here, and the purge would leave
 * its rows behind. That is why the caller VERIFIES rather than trusting this
 * list: it re-counts after deleting and refuses to remove the client while
 * anything it can see remains. Verification catches what enumeration cannot.
 *
 * Derived from the production FK graph on 2026-08-16. Re-derive with:
 *   select conrelid::regclass, confdeltype from pg_constraint
 *    where contype='f' and confrelid='aml.cases'::regclass;
 */
export const AML_UNLINKED_CASE_TABLES: readonly string[] = [
  // No foreign key to aml.cases — nothing cascades these.
  "party_screening_subjects",
  "pep_determinations",
  "party_verification_links",
  "party_field_provenance",
  "party_reconciliation_items",
  "idv_evidence_references",
  "reliance_access_log",
  "transaction_obligations",
  // ON DELETE SET NULL — these survive the case by design.
  "legal_holds",
  "reports",
] as const;

/**
 * The subset a purge may actually delete.
 *
 * `legal_holds` and `reports` are excluded deliberately. Their SET NULL is a
 * retention decision somebody made on purpose, and a case carrying either is
 * already refused by `retentionBlockers` — so if execution ever reaches the
 * delete step, there are none to remove. Deleting them here would quietly
 * overrule the retention rule the rest of this module exists to enforce.
 */
export const AML_PURGE_ORDER: readonly string[] = AML_UNLINKED_CASE_TABLES.filter(
  (t) => t !== "legal_holds" && t !== "reports",
);
