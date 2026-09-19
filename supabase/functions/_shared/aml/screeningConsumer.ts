/**
 * aml_screening consumer — processes `aml.screening.requested` events.
 *
 * The worker owns the provider call so the browser never does, and party
 * screening state is a PROJECTION of canonical evidence: every execution
 * writes an aml.screening_checks row, candidates become aml.screening_matches
 * rows, and the subject's state is derived from those — never invented here.
 * Technical conditions (provider unresolvable, stale list data, transport
 * failure) land in state='error' + error_category and are retried /
 * dead-lettered by the platform outbox machinery. A technical failure can
 * NEVER project to 'completed': stale lists and outages are our problem, not
 * a cleared customer.
 *
 * ## Why it lives in `_shared/aml/` rather than beside the worker
 *
 * TWO functions import it — `cross-portal-outbox-worker` runs it from the
 * queue, and `aml-cases` runs it inline — which is what makes it shared. It
 * used to sit in the worker's own directory, and a function bundle carries
 * its own directory plus `_shared`, never another function's: so `aml-cases`
 * imported a file its bundle did not contain. Nothing could prune that graph,
 * the bundle went out carrying the whole 6.4 MB shared tree, and the deploy
 * API refused it — `aml-cases` could not be deployed to a clone at all.
 *
 * Anything a second function imports belongs here for that reason, not as a
 * matter of taste.
 */
import {
  getScreeningProvider,
  resolveTenantProvider,
  runWithMetrics,
  ProviderResolutionError,
  technicalCategoryForRefusal,
  type ScreeningScope,
} from './providers/index.ts';
import {
  checkReuseDecision,
  computeRefreshDueAt,
  matchDedupKey,
  projectPartyScreeningState,
  resumableFromDurableState,
  screeningClaimDecision,
} from './partyScreening.pure.ts';

/** Party screening asks the local lists exactly what they can answer. */
const PARTY_SCREENING_SCOPE: ScreeningScope[] = ['sanctions'];

/**
 * A worker that died mid-run leaves 'processing'; reclaim after this. Must be
 * shorter than the outbox's cumulative retry backoff before dead-lettering
 * (attempts cap at 10, backoff 2^n capped at 1h) so an in-flight retry can
 * still reclaim a dead worker's subject before the event dead-letters.
 */
const STUCK_PROCESSING_MINUTES = 10;

async function sha256Hex(input: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Same hash-chained case-event append the AML edge functions use. */
async function appendCaseEvent(
  db: any, caseId: string, category: string, summary: string, payload: any,
): Promise<void> {
  const { data: prev } = await db.schema('aml').from('case_events')
    .select('row_hash').eq('case_id', caseId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({
    case_id: caseId, category, summary, payload,
    actor_id: null, actor_label: 'outbox-worker', prev_hash: prevHash, created_at: now,
  }));
  await db.schema('aml').from('case_events').insert({
    case_id: caseId, category, summary, payload,
    actor_id: null, actor_label: 'outbox-worker',
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
}

/** Rescreen cadence from the existing monitoring rule (365-day default). */
async function rescreenIntervalDays(db: any): Promise<number> {
  const { data } = await db.schema('aml').from('monitoring_rules')
    .select('criteria').eq('trigger_kind', 'rescreen_due').eq('is_enabled', true)
    .limit(1).maybeSingle();
  const days = Number((data?.criteria as any)?.interval_days ?? 365);
  return Number.isFinite(days) && days > 0 ? days : 365;
}

/**
 * Record a technical failure against a subject, in one place.
 *
 * Every path that cannot produce a screening RESULT must still produce a
 * screening STATE. The alternative — returning, throwing, or leaving the row
 * as it was — is what let a request sit `queued` for days: `error_category`
 * null, no check, no case event, and a stage reporting "nothing has picked it
 * up" while something had in fact tried and failed.
 *
 * `state: 'error'` is deliberate and is never a customer outcome: the scope
 * stays outstanding, the stage stays blocked, and nothing reads as clear.
 * `last_screened_at` is untouched, because no screening was performed.
 */
export async function recordTechnicalFailure(
  db: any,
  subject: { id: string; case_id?: string | null; screened_name?: string | null },
  category: string,
  message: string,
): Promise<void> {
  try {
    await db.schema('aml').from('party_screening_subjects').update({
      state: 'error',
      error_category: category,
      updated_at: new Date().toISOString(),
    }).eq('id', subject.id);
  } catch (e) {
    console.error('[screeningConsumer] could not record failure state', {
      subject_id: subject.id, category, error: String(e).slice(0, 200),
    });
  }
  if (!subject.case_id) return;
  try {
    await appendCaseEvent(db, String(subject.case_id), 'system',
      `Party screening failed technically for ${subject.screened_name ?? 'subject'} (${category}) — screening remains outstanding`,
      { party_screening_subject_id: subject.id, error_category: category, error: message.slice(0, 300) });
  } catch (e) {
    // The state is the control; the narrative is the courtesy. Never let the
    // audit append failure hide the failure it was describing.
    console.error('[screeningConsumer] could not append failure event', {
      subject_id: subject.id, category, error: String(e).slice(0, 200),
    });
  }
}

export async function processScreeningEvent(db: any, event: any): Promise<void> {
  const subjectId = String(event?.payload?.party_screening_subject_id ?? '');
  // A malformed event names no subject, so there is nothing to fail against
  // and nothing to retry. Logged rather than silent: an event type that
  // stopped carrying its id would otherwise vanish without trace.
  if (!subjectId) {
    console.error('[screeningConsumer] event carries no party_screening_subject_id', {
      event_id: event?.id ?? null,
    });
    return;
  }

  const { data: subject, error: loadErr } = await db.schema('aml')
    .from('party_screening_subjects').select('*').eq('id', subjectId).maybeSingle();
  if (loadErr) throw loadErr;
  /*
   * The subject named by the event no longer exists. This used to return
   * silently, which marked the event processed and left nothing behind. It
   * cannot be failed against a row that is gone, so it is logged loudly and
   * the event is allowed to settle — a retry would never find it either.
   */
  if (!subject) {
    console.error('[screeningConsumer] event names a subject that does not exist', {
      party_screening_subject_id: subjectId, error_category: 'invalid_subject',
    });
    return;
  }

  // Eligibility (single shared rule — screeningClaimDecision):
  //   queued/error            → claim and run;
  //   terminal states         → duplicate/stale event, succeed silently;
  //   fresh 'processing'      → someone else holds it: RETRY the event.
  // Retrying the in-flight case matters: succeeding would mark the event
  // processed, and if the holder had died the subject would sit in
  // 'processing' forever with no event left to wake it. A retried delivery
  // either finds the terminal state (holder finished) or reclaims once the
  // staleness window passes (holder died).
  const decision = screeningClaimDecision(subject, Date.now(), STUCK_PROCESSING_MINUTES);
  if (decision === 'obsolete') return;
  if (decision === 'in_flight_retry') {
    throw new Error(`screening_in_flight: subject ${subjectId} is being processed by another worker — retry`);
  }

  // Optimistic claim — a concurrent worker loses the conditional update, so
  // the provider runs at most once per delivery. The conditional predicate is
  // authoritative; the JS decision above is only routing.
  const stuckCutoff = new Date(Date.now() - STUCK_PROCESSING_MINUTES * 60_000).toISOString();

  /*
   * THE CLAIM PREDICATE, EXPRESSED AS FILTERS RATHER THAN A STRING.
   *
   * This was a single `.or()` built by interpolating an ISO timestamp:
   *
   *   .or(`state.in.(queued,error),and(state.eq.processing,updated_at.lt.${cutoff})`)
   *
   * PostgREST could not parse it. The timestamp carries the `.` and `:` that
   * its grammar treats as structural, so the embedded `and(...)` group broke
   * and the whole filter was read as a column reference. Production returned:
   *
   *   column party_screening_subjects.state does not exist
   *
   * So the claim has NEVER succeeded — not once, for any subject. Combined
   * with the discarded `error` (fixed above), that failure was reported as
   * "another worker has it, retry" and the subject was left exactly as found.
   * That is the whole reason a screening request could sit `queued` for hours
   * with no check, no category and no case event.
   *
   * The two branches are now separate, simple filters. Each is unambiguous,
   * neither interpolates a value into a filter grammar, and the predicate is
   * still evaluated by Postgres inside the UPDATE — so this remains one
   * atomic conditional claim and the provider still runs at most once. The
   * routing decision above chooses the branch; Postgres remains the authority.
   */
  const claimBase = db.schema('aml').from('party_screening_subjects')
    .update({ state: 'processing', updated_at: new Date().toISOString() })
    .eq('id', subjectId);
  const claimQuery = String(subject.state) === 'processing'
    // Reclaiming a holder that died: only if it is still stale at write time.
    ? claimBase.eq('state', 'processing').lt('updated_at', stuckCutoff)
    // Fresh work: claimable only while it is still unclaimed.
    : claimBase.in('state', ['queued', 'error']);
  const { data: claimed, error: claimError } = await claimQuery.select('id').maybeSingle();

  /*
   * A DATABASE FAILURE IS NOT A RACE.
   *
   * This statement used to destructure `data` only. PostgREST returns
   * `{ data: null, error }` on any failure — a malformed filter, a transport
   * fault, a permission problem — and `data: null` is exactly what losing the
   * race also looks like. So every database failure here was reported as
   * "another worker has it, retry", which is the one outcome that converges
   * nowhere: the inline caller swallows it, the worker retries it for ever,
   * and the subject stays `queued` with no error_category, no screening check
   * and no case event.
   *
   * That is precisely the silent stall this consumer exists to prevent, and
   * it was hiding inside the safety mechanism itself. The two cases are now
   * separated: a genuine race still retries, a database failure is recorded
   * against the subject and named.
   */
  if (claimError) {
    const message = String((claimError as { message?: string })?.message ?? claimError);
    await recordTechnicalFailure(db, subject, 'screening_claim_failed', message);
    throw new Error(`screening_claim_failed: ${message}`);
  }
  if (!claimed) {
    // Genuinely lost the race to a live worker an instant ago — same as
    // in-flight. The holder converges this subject; this delivery retries.
    throw new Error(`screening_in_flight: subject ${subjectId} was claimed concurrently — retry`);
  }

  const technical = (category: string, message: string) =>
    recordTechnicalFailure(db, subject, category, message);

  try {
    await runScreeningForSubject(db, subject);
  } catch (err: any) {
    const message = String(err?.message ?? 'screening_failure');
    if (err instanceof ProviderResolutionError) {
      await technical(technicalCategoryForRefusal(err.code), message);
    } else if (/sanctions_list_unavailable/.test(message)) {
      await technical('list_data_unavailable', message);
    } else if (/timeout|timed out/i.test(message)) {
      await technical('timeout', message);
    } else {
      await technical('provider_unavailable', message);
    }
    // Re-throw so the platform outbox machinery applies backoff and
    // dead-lettering. The subject stays 'error' — outstanding, never clear.
    throw err;
  }
}

/**
 * The real processing body: resolve the provider server-side, execute against
 * the canonical screening tables, then project the subject from the result.
 */
export async function runScreeningForSubject(db: any, subject: any): Promise<void> {
  // Recovery first, provider resolution second: a check that already holds a
  // valid terminal provider result is the SAME logical screening attempt.
  // Re-running the provider — or opening a second check — because the worker
  // died between persisting that result and finishing the projection would
  // duplicate a completed execution. The retry instead FINISHES the
  // interrupted persistence from the durable canonical record.
  if (subject.screening_check_id) {
    const { data: linked } = await db.schema('aml').from('screening_checks')
      .select('id, status, completed_at, provider, result_summary, metadata')
      .eq('id', subject.screening_check_id).maybeSingle();
    // Only a check this subject's execution created is resumable evidence
    // for it; anything else is treated as no reusable attempt.
    const ownedBySubject = linked &&
      String((linked.metadata ?? {}).party_screening_subject_id ?? '') === String(subject.id);
    const decision = ownedBySubject ? checkReuseDecision(linked, subject) : 'new_check';
    if (decision === 'resume_completed') {
      const summary = (linked.result_summary ?? {}) as Record<string, unknown>;
      const { data: rows } = await db.schema('aml').from('screening_matches')
        .select('id').eq('screening_check_id', linked.id);
      const summaryMatchCount = Number(summary['match_count'] ?? 0);
      if (resumableFromDurableState(summaryMatchCount, (rows ?? []).length)) {
        await completeCanonicalPersistence(db, subject, {
          checkId: String(linked.id),
          providerKey: String(linked.provider ?? subject.provider_key ?? 'unknown'),
          completedAt: String(linked.completed_at ?? new Date().toISOString()),
          listVersions: (summary['list_versions'] ?? {}) as Record<string, unknown>,
          matchCount: summaryMatchCount,
          scopesCovered: Array.isArray(summary['scopes_covered'])
            ? (summary['scopes_covered'] as string[]) : PARTY_SCREENING_SCOPE,
          recovered: true,
        });
        return;
      }
      // Durable state predates the matches-before-terminal ordering (or was
      // damaged): the candidates cannot be reconstructed, so this attempt
      // re-runs — reusing the SAME check row, never opening a second one.
      // Fall through to the rerun path below.
    }
    if (decision !== 'new_check') {
      // 'rerun_provider', or a non-resumable terminal check: reuse the row —
      // one logical attempt, one screening_check.
      subject = { ...subject, __reuse_check_id: String(linked.id) };
    }
  }

  const tenantId = String(subject.tenant_id ?? 'default');
  const resolved = await resolveTenantProvider(db, tenantId, 'pep_sanctions');
  const provider = getScreeningProvider({ resolved, admin: db });

  // Reuse the unfinished canonical check from an interrupted attempt; a
  // fresh screening round gets a fresh check so history accumulates.
  let checkId: string | null = subject.__reuse_check_id ?? null;
  if (checkId) {
    await db.schema('aml').from('screening_checks').update({
      status: 'in_progress', provider: provider.name,
      updated_at: new Date().toISOString(),
    }).eq('id', checkId);
  }
  if (!checkId) {
    const { data: inserted, error: insertErr } = await db.schema('aml')
      .from('screening_checks').insert({
        case_id: subject.case_id,
        subject_label: subject.screened_name,
        subject_type: 'individual',
        provider: provider.name,
        scope: PARTY_SCREENING_SCOPE,
        status: 'in_progress',
        metadata: {
          party_screening_subject_id: subject.id,
          party_type: subject.party_type,
          party_id: subject.party_id ?? null,
        },
      }).select('id').single();
    if (insertErr) throw insertErr;
    checkId = inserted.id as string;
    await db.schema('aml').from('party_screening_subjects')
      .update({ screening_check_id: checkId, updated_at: new Date().toISOString() })
      .eq('id', subject.id);
  }

  let result;
  try {
    result = await runWithMetrics(db, {
      tenantId, capability: 'pep_sanctions',
      providerKey: provider.name, costCents: resolved?.costCents ?? 0,
      configId: resolved?.configId ?? null,
    }, () => provider.runScreening({
      caseId: subject.case_id,
      subjectLabel: subject.screened_name,
      subjectType: 'individual',
      scope: PARTY_SCREENING_SCOPE,
      // All identifying information the reconciled party carries. Missing
      // DOB stays missing — the matcher treats it as 'unknown', never as a
      // mismatch or a failure.
      metadata: {
        ...(subject.date_of_birth ? { date_of_birth: String(subject.date_of_birth) } : {}),
        ...(Array.isArray(subject.aliases) && subject.aliases.length
          ? { aliases: subject.aliases } : {}),
        ...(subject.country ? { country: String(subject.country) } : {}),
        party_screening_subject_id: subject.id,
      },
    }));
  } catch (err) {
    // The canonical record says what happened; the thrown error drives the
    // subject's error projection and the outbox retry in the caller.
    await db.schema('aml').from('screening_checks').update({
      status: 'failed',
      result_summary: {
        error_category: /sanctions_list_unavailable/.test(String((err as Error)?.message))
          ? 'list_data_unavailable' : 'provider_unavailable',
        error: String((err as Error)?.message ?? 'screening_failure').slice(0, 300),
      },
      completed_at: new Date().toISOString(),
    }).eq('id', checkId);
    throw err;
  }

  // Persist candidates BEFORE the terminal status: a terminal check is the
  // durable marker that the provider execution finished, so everything the
  // projection needs must already be on disk when it appears. A crash before
  // the terminal write re-runs the provider (dedup-keyed inserts absorb the
  // overlap); a crash after it resumes WITHOUT the provider.
  if (result.matches.length > 0) {
    // Idempotency on redelivery after a partial failure: only insert
    // candidates the check does not already carry. Keyed on the list's own
    // external id, falling back to name+list for providers that supply none.
    const { data: existingMatches } = await db.schema('aml').from('screening_matches')
      .select('details, matched_name, list_name').eq('screening_check_id', checkId);
    const known = new Set((existingMatches ?? []).map((m: any) => matchDedupKey(m)));
    const fresh = result.matches.filter((m) => !known.has(matchDedupKey(m)));
    if (fresh.length > 0) {
      const { error: matchErr } = await db.schema('aml').from('screening_matches').insert(
        fresh.map((m) => ({
          screening_check_id: checkId,
          case_id: subject.case_id,
          match_type: m.matchType,
          list_name: m.listName,
          matched_name: m.matchedName,
          score: m.score,
          jurisdiction: m.jurisdiction,
          details: m.details,
        })),
      );
      if (matchErr) throw matchErr;
    }
  }

  const now = new Date().toISOString();
  await db.schema('aml').from('screening_checks').update({
    status: result.status,
    provider_reference: result.providerReference,
    // list_versions travels into the durable summary so a resumed projection
    // can stamp the subject's list evidence without the provider result.
    // Canonical result metadata only — no payloads, no PII beyond the summary.
    result_summary: { ...result.summary, list_versions: (result.raw as any)?.list_versions ?? {} },
    completed_at: now,
  }).eq('id', checkId);

  await completeCanonicalPersistence(db, subject, {
    checkId: String(checkId),
    providerKey: provider.name,
    completedAt: now,
    listVersions: ((result.raw as any)?.list_versions ?? {}) as Record<string, unknown>,
    matchCount: result.matches.length,
    scopesCovered: ((result.summary as any)?.scopes_covered as string[]) ?? PARTY_SCREENING_SCOPE,
    recovered: false,
  });
}

/**
 * The downstream persistence a terminal check requires: projection from the
 * canonical match set, the subject's evidence stamps, and the case event.
 * Used by the fresh path and by terminal-check recovery — the two must stay
 * one code path so recovery cannot drift from normal completion. Projection
 * reads match STATUSES, so recorded human adjudications (confirmed /
 * dismissed) are honoured, never overwritten.
 */
export async function completeCanonicalPersistence(
  db: any,
  subject: any,
  args: {
    checkId: string;
    providerKey: string;
    completedAt: string;
    listVersions: Record<string, unknown>;
    matchCount: number;
    scopesCovered: string[];
    recovered: boolean;
  },
): Promise<void> {
  const { data: allMatches } = await db.schema('aml').from('screening_matches')
    .select('status').eq('screening_check_id', args.checkId);
  const projected = projectPartyScreeningState((allMatches ?? []).map((m: any) => m.status));

  const intervalDays = await rescreenIntervalDays(db);
  const listVersion = Object.entries(args.listVersions)
    .map(([code, v]) => `${code}:${v}`).join(' ').slice(0, 500) || null;

  // last_screened_at is the check's completion time — on recovery that is
  // when the screening actually happened, not when the retry landed. It also
  // matches check.completed_at exactly, which is what marks this round's
  // projection as done for the reuse decision.
  await db.schema('aml').from('party_screening_subjects').update({
    state: projected,
    screening_check_id: args.checkId,
    provider_key: args.providerKey,
    list_version: listVersion,
    last_screened_at: args.completedAt,
    refresh_due_at: computeRefreshDueAt(args.completedAt, intervalDays),
    error_category: null,
    updated_at: new Date().toISOString(),
  }).eq('id', subject.id);

  await appendCaseEvent(
    db, subject.case_id,
    args.matchCount > 0 ? 'pep_sanctions_hit' : 'system',
    args.matchCount > 0
      ? `Party screening found ${args.matchCount} candidate match(es) for ${subject.screened_name} — human adjudication required`
      : `Party screening ${projected} for ${subject.screened_name} via ${args.providerKey}`,
    {
      party_screening_subject_id: subject.id,
      screening_check_id: args.checkId,
      state: projected,
      match_count: args.matchCount,
      scopes_covered: args.scopesCovered,
      ...(args.recovered ? { recovered_from_interrupted_persistence: true } : {}),
    },
  );
}
