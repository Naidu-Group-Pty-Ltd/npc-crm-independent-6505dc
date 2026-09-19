/**
 * Whether a case still knows whose it is.
 *
 * ── The failure this makes visible ────────────────────────────────────
 * `aml.cases.client_id` was ON DELETE SET NULL, so deleting a client
 * detached the case instead of failing or cascading. The register kept
 * listing it, the timeline was unbroken, every stage still rendered — and
 * the case belonged to nobody. Measured in production: 1 of 6.
 *
 * The FK is RESTRICT now, so no new case can be detached this way. That
 * fixes the future and does nothing for the rows already in that state, and
 * an orphan that looks exactly like an ordinary case is the whole problem:
 * an analyst works it, requests documents, and there is no customer at the
 * other end.
 *
 * ── What this module will and will not claim ──────────────────────────
 * It reports attribution, never identity. The recovered id comes from the
 * case's own `case_created` event — the one place the link survived — and
 * naming it is evidence. Resolving it to a LIVE customer is not something
 * this can do and not something it guesses: a deleted client that shares a
 * name with a live one is the single most dangerous mis-repair available
 * here, because every subsequent request would go to the wrong person.
 *
 * So an orphan is reported as an orphan, with whatever the chain remembers
 * attached, and the decision about what to do with it stays a person's.
 */

export type CaseAttributionState = "attributed" | "detached" | "detached_unrecoverable";

export interface CaseAttributionFacts {
  clientId: string | null | undefined;
  /** `metadata.orphaned_client`, stamped by the recovery migration. */
  orphanedClient?: {
    client_id?: string | null;
    client_still_exists?: boolean | null;
    recovered_from?: string | null;
  } | null;
}

export interface CaseAttribution {
  state: CaseAttributionState;
  /** True when an analyst must not treat this as ordinary work. */
  blocking: boolean;
  label: string;
  detail: string;
  /** The client the audit chain says it belonged to, when it remembers. */
  recoveredClientId: string | null;
}

export function readCaseAttribution(facts: CaseAttributionFacts): CaseAttribution {
  if (facts.clientId) {
    return {
      state: "attributed", blocking: false,
      label: "Attributed",
      detail: "This case is linked to a client record.",
      recoveredClientId: null,
    };
  }

  const recovered = facts.orphanedClient?.client_id ?? null;
  if (!recovered) {
    /*
     * Detached with nothing in the chain to recover. This is the worst state
     * available and it must never be silent: the compliance record exists,
     * the obligation to retain it exists, and there is no way from here to
     * say whose it was.
     */
    return {
      state: "detached_unrecoverable", blocking: true,
      label: "Not linked to any client",
      detail: "This case is not linked to a client, and its audit chain does not record "
        + "which client it was opened for. It cannot be worked or progressed. Refer it to "
        + "the MLRO — the record must be retained, and the attribution established by hand.",
      recoveredClientId: null,
    };
  }

  const stillExists = facts.orphanedClient?.client_still_exists === true;
  if (stillExists) {
    /*
     * The client record came back — restored, or re-created under the same
     * id. Re-linking is a real repair rather than a guess, but it is still
     * an MLRO's call and not something a page does on a render.
     */
    return {
      state: "detached", blocking: true,
      label: "Detached from its client",
      detail: "This case lost its client link when the client record was deleted, and a "
        + "client with the recorded id exists again. The MLRO can re-link it — the id "
        + "comes from the case's own creation event, so this is a repair rather than a "
        + "guess.",
      recoveredClientId: recovered,
    };
  }

  return {
    state: "detached", blocking: true,
    label: "Detached — the client record was deleted",
    detail: "This case was opened for a client who has since been deleted, so it belongs to "
      + "nobody. The record is retained and the audit chain still names the client it was "
      + "opened for. It must not be re-pointed at another customer who happens to share a "
      + "name: every request would then go to the wrong person. Close it, or restore the "
      + "client, on an MLRO decision.",
    recoveredClientId: recovered,
  };
}
