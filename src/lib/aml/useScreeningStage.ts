/**
 * Stage 5, read once, with the server as the authority.
 *
 * ── What changed, and why ─────────────────────────────────────────────
 * This used to assemble Stage 5 from four separate reads and decide the
 * scope in the browser. That was the wrong place for it twice over: the
 * browser cannot enrol anybody, and a compliance scope decided in a tab is
 * not a decision anyone can audit.
 *
 * `sync_screening_stage` now does all of it server-side and idempotently —
 * it enrols whoever is missing (the case subject was never enrolled by
 * anything, which is why Stage 5 had nothing to screen), decides which
 * scopes are proportionate, records that decision once with the client's own
 * answers attached, and returns the single next action a person has to take.
 *
 * The readiness read stays, because it is the only thing that says WHY the
 * provider cannot run — the server's `provider_ready` is one boolean and an
 * operator needs the blockers behind it.
 *
 * Nothing here decides anything. A read that fails resolves to `null`, and
 * `null` reads as "not available" all the way to the screen — never as a
 * reassuring default.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { amlCasesApi, type AmlScreeningStageSync } from "./amlCasesApi";
import { amlVerificationApi } from "./amlVerificationApi";
import {
  deriveAmlScreeningReadiness, type AmlScreeningReadinessReading,
} from "./screeningReadiness";
import {
  deriveAmlScreeningScope, describeScreeningStage, readCaseScreeningPosition,
  type AmlCaseScreeningPosition, type AmlScreeningScopeDecision,
} from "./screeningScope";
import {
  sanctionsListFactsFrom, screeningProviderFactsFrom, screeningSubjectFactsFrom,
} from "./screeningStageFacts";
import { resolveScreeningNextAction } from "./screeningNextAction";
import {
  readSanctionsSource, type SanctionsSourceReading,
} from "./screeningResolution.pure";
import {
  LIST_STALE_AFTER_DAYS,
} from "../../../supabase/functions/_shared/aml/sanctionsIngest.pure";

export interface AmlScreeningStageReading {
  /** The server's own answer. `null` while loading, or if the read failed. */
  sync: AmlScreeningStageSync | null;
  readiness: AmlScreeningReadinessReading;
  scope: AmlScreeningScopeDecision;
  position: AmlCaseScreeningPosition;
  stage: ReturnType<typeof describeScreeningStage>;
  /**
   * Which Australian sanctions source an automated check would use, and
   * whether it is usable. Derived from the same reads the readiness uses —
   * this only presents them.
   */
  source: SanctionsSourceReading;
  loading: boolean;
  /** True when the server read failed — the card says so rather than guessing. */
  unavailable: boolean;
  reload: () => void;
}

/**
 * A read that may fail, be forbidden, or not exist resolves to null — never
 * to a default. The thunk matters: a synchronous throw (an operation this
 * build does not have) must degrade this card, not take the page down.
 */
const tolerate = <T,>(read: () => Promise<T>): Promise<T | null> => {
  try { return read().catch(() => null); } catch { return Promise.resolve(null); }
};

export function useScreeningStage(
  caseId: string,
  caseFacts: { riskRating?: string | null; enhancedDueDiligence?: boolean },
): AmlScreeningStageReading {
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [raw, setRaw] = useState<{
    sync: AmlScreeningStageSync | null;
    provider: Awaited<ReturnType<typeof amlVerificationApi.providerReadiness>> | null;
    lists: Awaited<ReturnType<typeof amlVerificationApi.sanctionsListStatus>> | null;
  }>({ sync: null, provider: null, lists: null });

  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.all([
      tolerate(() => amlCasesApi.syncScreeningStage(caseId)),
      tolerate(() => amlVerificationApi.providerReadiness()),
      tolerate(() => amlVerificationApi.sanctionsListStatus()),
    ]).then(([sync, provider, lists]) => {
      if (!live) return;
      setRaw({ sync, provider, lists });
      setLoading(false);
    });
    return () => { live = false; };
  }, [caseId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return useMemo(() => {
    const readiness = deriveAmlScreeningReadiness(
      raw.provider || raw.lists
        ? {
          provider: screeningProviderFactsFrom(raw.provider),
          lists: sanctionsListFactsFrom(raw.lists?.syncs),
        }
        // Neither read answered: the configuration is unread, which is not
        // the same as unconfigured and must not be reported as a fault.
        : null,
    );

    const nowIso = new Date().toISOString();
    const position = readCaseScreeningPosition(
      screeningSubjectFactsFrom(raw.sync?.subjects), nowIso);

    /*
     * The scope reading stays for the determination list and the
     * execute/advance split. Its adverse-media inputs are taken from the
     * SERVER's decision rather than re-derived here, so the browser cannot
     * disagree with the recorded compliance position: a control the server
     * stood down is passed as answered-and-clear, and one it kept is passed
     * as a trigger the browser reproduces.
     */
    const serverStoodDownAdverse = Boolean(
      raw.sync?.policy?.notRequired?.some((n) => n.scope === "adverse_media"));

    /*
     * The server's per-scope decision, passed straight through. It is the
     * AUTHORITY on what is required; the derivation below still reads the
     * evidence, which is a different question. Older servers do not send it,
     * and `undefined` means the browser falls back to requiring everything —
     * the answer it always gave, and the safe one.
     */
    const scope = deriveAmlScreeningScope({
      answers: serverStoodDownAdverse
        ? { pep: "no", adverse: "no", thirdParty: "no", overseasFunding: "no" }
        : null,
      entityType: serverStoodDownAdverse ? "individual" : null,
      riskRating: caseFacts.riskRating ?? null,
      enhancedDueDiligence: Boolean(caseFacts.enhancedDueDiligence),
      adverseMediaState: "not_started",
      now: nowIso,
      ...position.facts,
    }, readiness, raw.sync?.scopes ?? null);

    /*
     * The one place the offered action is settled, so the card and the
     * workspace's handler cannot disagree about it. A `fix_provider` for a
     * case whose perimeter nobody has decided becomes `classify_perimeter`
     * here — see `screeningNextAction.ts` for why the browser holds this
     * line rather than trusting how old the response is.
     */
    const sync = raw.sync
      ? {
        ...raw.sync,
        next_action: resolveScreeningNextAction(
          raw.sync.next_action, raw.sync.perimeter,
          // Lifecycle first. A retained record has no next step in the
          // journey, only a decision about whether to resume one.
          raw.sync.case_closed === true) ?? raw.sync.next_action,
      }
      : null;

    return {
      sync,
      source: readSanctionsSource({
        // `null` propagates as unread all the way to the screen, which is why
        // the read is tolerated rather than defaulted.
        syncs: raw.lists?.syncs ?? null,
        entryCount: raw.lists?.entry_count ?? null,
        providerReady: raw.sync?.provider_ready === true,
        staleAfterDays: LIST_STALE_AFTER_DAYS,
        nowMs: Date.parse(nowIso),
      }),
      readiness, scope, position,
      // The server decides whether the provider bears on this case; the
      // browser must not reach a different conclusion from the same facts.
      stage: describeScreeningStage(scope, readiness, raw.sync?.provider_relevant),
      loading,
      unavailable: !loading && raw.sync === null,
      reload,
    };
  }, [raw, caseFacts.riskRating, caseFacts.enhancedDueDiligence, loading, reload]);
}
