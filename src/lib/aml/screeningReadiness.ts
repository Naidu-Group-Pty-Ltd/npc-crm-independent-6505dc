/**
 * Why screening cannot run — the whole answer, in one reading.
 *
 * ── What the operator hit ─────────────────────────────────────────────
 * "Run screening" failed with:
 *
 *   Provider "local_lists" is still in simulator mode, which production
 *   cannot execute. Finish configuring it as live in AML › Configuration ›
 *   Providers. No verification attempt was recorded.
 *
 * That refusal is CORRECT and must not be softened. Production running a
 * simulator would fabricate a screening outcome, and a fabricated "no match"
 * is the single most dangerous thing this system could produce.
 *
 * ── But it is only the first of two blockers ──────────────────────────
 * Measured on this deployment:
 *
 *   aml.provider_configs   pep_sanctions / local_lists / simulator / active
 *   aml.sanctions_entries  0 rows
 *   aml.sanctions_list_syncs  0 rows
 *
 * So an operator who follows that message and flips the provider to live is
 * met with a DIFFERENT refusal — `local_lists` fails closed on its freshness
 * gate with "dfat: never successfully loaded — screening cannot be
 * authoritative". Two correct refusals in a row, discovered one at a time,
 * with a configuration change in between that looked like progress.
 *
 * This module says both at once. It decides nothing and enables nothing: it
 * reads state that already exists and reports what is missing and who has to
 * act. Screening still runs, or refuses, entirely on the server.
 *
 * ── On the required list ──────────────────────────────────────────────
 * `DEFAULT_REQUIRED_SANCTIONS_LISTS = ["dfat"]` — the DFAT Consolidated
 * List, Australia's targeted financial sanctions instrument — with a 72-hour
 * freshness window (`DEFAULT_SANCTIONS_MAX_AGE_HOURS`). Those values are the
 * server's, quoted here rather than restated, so this reading cannot drift
 * from what the provider actually enforces.
 */

/** Provider row for the `pep_sanctions` capability. */
export interface AmlScreeningProviderFacts {
  providerKey: string | null;
  mode: "simulator" | "live" | string | null;
  active: boolean;
}

/** Sanctions-list load evidence, per required list. */
export interface AmlSanctionsListFacts {
  listCode: string;
  /** Last SUCCESSFUL sync that published a non-zero entry count. */
  lastSuccessAt: string | null;
  entryCount: number;
  /** Status of the most recent attempt, successful or not. */
  latestAttemptStatus: string | null;
}

export interface AmlScreeningReadinessFacts {
  provider: AmlScreeningProviderFacts | null;
  /** `null` = not read. Empty array = read, and nothing is loaded. */
  lists: AmlSanctionsListFacts[] | null;
  maxAgeHours?: number;
  /**
   * Which lists must be present. Defaults to the server's own
   * `DEFAULT_REQUIRED_SANCTIONS_LISTS` — `["dfat"]`.
   */
  requiredLists?: string[];
  /** Clock injection keeps this pure and testable. */
  now?: number;
}

export type AmlScreeningReadinessCode =
  | "unavailable"
  | "no_provider"
  | "provider_inactive"
  | "simulator_mode"
  | "lists_never_loaded"
  | "lists_stale"
  | "last_sync_failed"
  | "ready";

export interface AmlScreeningReadinessReading {
  code: AmlScreeningReadinessCode;
  label: string;
  detail: string;
  /** True when "Run screening" can be expected to produce a real result. */
  canRun: boolean;
  /**
   * Everything standing in the way, in the order it must be fixed. Stating
   * ALL of it is the point: fixing one and rediscovering the next is what
   * made this feel broken rather than unconfigured.
   */
  blockers: string[];
  /** Who has to act. Neither is something a case reviewer can do. */
  owner: "administrator" | "none";
}

export const SCREENING_MAX_AGE_HOURS_DEFAULT = 72;
/** Mirrors `DEFAULT_REQUIRED_SANCTIONS_LISTS` in the provider. */
export const SCREENING_REQUIRED_LISTS_DEFAULT = ["dfat"];

const reading = (r: AmlScreeningReadinessReading) => r;

export function deriveAmlScreeningReadiness(
  facts: AmlScreeningReadinessFacts | null | undefined,
): AmlScreeningReadinessReading {
  if (!facts || facts.provider === undefined) {
    return reading({
      code: "unavailable",
      label: "Not available",
      detail: "The screening configuration could not be read.",
      canRun: false, blockers: [], owner: "none",
    });
  }

  const blockers: string[] = [];
  const provider = facts.provider;

  if (!provider || !provider.providerKey) {
    blockers.push("No screening provider is configured for PEP and sanctions.");
  } else if (!provider.active) {
    blockers.push(`Provider "${provider.providerKey}" is configured but not active.`);
  } else if (provider.mode === "simulator") {
    // Deliberately quotes the server's own refusal, so the card and the
    // toast cannot tell the operator two different stories.
    blockers.push(
      `Provider "${provider.providerKey}" is in simulator mode. Production cannot run a ` +
      "simulated screening, so no result is produced and no attempt is recorded.",
    );
  }

  // The list check runs REGARDLESS of the provider's mode. That is the whole
  // reason this module exists: with the provider in simulator mode the list
  // problem is invisible until somebody fixes the mode and tries again.
  const maxAge = facts.maxAgeHours ?? SCREENING_MAX_AGE_HOURS_DEFAULT;
  if (facts.lists === null || facts.lists === undefined) {
    // Not read — say nothing rather than guess the lists are missing.
  } else {
    const now = facts.now ?? Date.now();
    const cutoff = now - maxAge * 3600 * 1000;
    const required = facts.requiredLists ?? SCREENING_REQUIRED_LISTS_DEFAULT;
    /*
     * Iterate the REQUIRED lists, not the rows that came back — exactly as
     * the provider does. A list that is absent from the evidence entirely is
     * the most important case and the one an empty array represents, and
     * looping over the rows would skip it silently.
     */
    for (const code of required) {
      const name = code.toUpperCase();
      const list = facts.lists.find(
        (l) => l.listCode.toLowerCase() === code.toLowerCase());
      if (!list) {
        blockers.push(`The ${name} sanctions list has never been successfully loaded.`);
        continue;
      }
      const usable = Boolean(list.lastSuccessAt) && list.entryCount > 0;
      if (!usable) {
        // A "success" that published nothing is not screening data.
        blockers.push(`The ${name} sanctions list has never been successfully loaded.`);
        continue;
      }
      if (new Date(list.lastSuccessAt!).getTime() < cutoff) {
        blockers.push(
          `The ${name} sanctions list was last loaded ${list.lastSuccessAt} — older than the ` +
          `${maxAge}-hour limit, so a result could not be authoritative.`,
        );
        continue;
      }
      if (list.latestAttemptStatus === "failed") {
        blockers.push(
          `The most recent ${name} sync attempt failed, so designations published since ` +
          "may be missing.",
        );
      }
    }
  }

  if (blockers.length === 0) {
    return reading({
      code: "ready",
      label: "Ready to screen",
      detail: "A live provider is active and the required sanctions lists are current.",
      canRun: true, blockers: [], owner: "none",
    });
  }

  // The code names the FIRST thing to fix, while `blockers` carries all of
  // them — so the label is actionable and the list is complete.
  const code: AmlScreeningReadinessCode =
    !provider || !provider.providerKey ? "no_provider"
      : !provider.active ? "provider_inactive"
        : provider.mode === "simulator" ? "simulator_mode"
          : blockers.some((b) => /never been successfully loaded/.test(b)) ? "lists_never_loaded"
            : blockers.some((b) => /older than the/.test(b)) ? "lists_stale"
              : "last_sync_failed";

  return reading({
    code,
    label: "Screening is not configured",
    detail:
      blockers.length === 1
        ? "One thing has to be put right before screening can run."
        : `${blockers.length} things have to be put right before screening can run.`,
    canRun: false,
    blockers,
    // Neither a provider mode nor a sanctions-list load is something a case
    // reviewer can do from this page, and pretending otherwise sends them
    // to a switch that will fail differently.
    owner: "administrator",
  });
}
