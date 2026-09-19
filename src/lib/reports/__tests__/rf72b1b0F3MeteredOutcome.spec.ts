import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toReportableEvent } from '../../../../supabase/functions/_shared/apiUsageBilling.pure.ts';

/**
 * RF-7.2B.1B0-F3 — a refused vendor call must not be billed as a served one.
 *
 * Measured in production on 2026-09-12: 24 of 24 Google geocode attempts
 * answered `REQUEST_DENIED`, and `api_usage_log` recorded **all 24** as
 * `status = 'success'`. `meteredFetch` decides from `response.ok`, and Google
 * answers HTTP 200 with the real verdict in the body — the same trap
 * `resolveOneReportGeography` already records for the ABS boundary server.
 *
 * That is not merely cosmetic. Traced end to end:
 *
 *   meteredFetch  → api_usage_log.status = 'success'
 *   claim_api_usage_for_forwarding  → does NOT filter on status
 *   toReportableEvent → status 'success', quantity 1, googlemaps is per-REQUEST
 *   report-api-usage → forwarded to Mission Control as billable
 *
 * ...so a refused call is INDISTINGUISHABLE from a served one all the way to
 * the invoice, and every health surface read the vendor as perfectly well
 * throughout a total outage.
 *
 * ## What was NOT true, measured before claiming it
 *
 * The exposure is LATENT, not realised. Checked on 2026-09-12:
 *
 *   api_usage_log, googlemaps, all time  2,331 rows,  0 forwarded, 0 attempted
 *   api_usage_log, ALL services          109,800 rows, 0 forwarded, 0 attempted
 *   cron.job matching report-api-usage   (no rows)
 *
 * `report-api-usage` has never been scheduled on this deployment, so not one
 * usage row has ever reached Mission Control and **no customer credit, balance
 * or invoice was affected by the refused geocodes**. No reconciliation is owed.
 *
 * That does not make the defect cosmetic — it makes it a bill waiting to be
 * wrong. The moment forwarding is switched on, every historical row goes with
 * the status it was written with, and 2,331 googlemaps rows are already
 * standing there marked `success`. Fixing the write is what stops the queue
 * filling with the wrong answer; the unscheduled forwarder is a separate,
 * pre-existing gap and is recorded as backlog rather than chased here.
 *
 * The fix is opt-in and default-preserving: `judgeBody` lets a call site whose
 * vendor answers 200-with-error say so. Nothing that does not pass it changes.
 */
const REPO = resolve(__dirname, '../../../..');
const metered = readFileSync(resolve(REPO, 'supabase/functions/_shared/meteredFetch.ts'), 'utf8');
const service = readFileSync(
  resolve(REPO, 'supabase/functions/location-intelligence-service/index.ts'), 'utf8',
);

const row = (status: string) => ({
  id: '00000000-0000-4000-8000-000000000000',
  service_name: 'googlemaps',
  endpoint: 'https://maps.googleapis.com/maps/api/geocode/json',
  tokens_used: 0,
  request_count: 1,
  model_used: null,
  status,
  created_at: '2026-09-12T06:23:37.445Z',
  metadata: {},
});

describe('F3 — the billing path does not distinguish a refusal from a sale', () => {
  it('a row marked success is forwarded as a billable unit', () => {
    const event = toReportableEvent(row('success') as never);
    expect(event).not.toBeNull();
    expect(event?.secret_name).toBe('GOOGLE_MAPS_API_KEY');
    expect(event?.quantity).toBe(1);
    expect(event?.status).toBe('success');
  });

  it('a row marked error still forwards, but as an error', () => {
    // It is not dropped — the count is how an outage shows up as a cliff —
    // but it no longer claims the vendor served the request.
    const event = toReportableEvent(row('error') as never);
    expect(event?.status).toBe('error');
  });

  it('nothing between the log and the invoice filters on status', () => {
    // `claim_api_usage_for_forwarding` selects on mc_reported_at / mc_attempts
    // / created_at only, and `toReportableEvent` maps rather than drops — so
    // the status written at the moment of the call is the one that is billed.
    // That is why the fix has to be at the metering boundary.
    expect(toReportableEvent(row('success') as never)?.status).toBe('success');
    expect(toReportableEvent(row('error') as never)?.status).toBe('error');
  });
});

describe('F3 — the override is opt-in and default-preserving', () => {
  it('meteredFetch still defaults to response.ok', () => {
    expect(metered).toContain('response.ok ? "success" : "error"');
    // The judge only runs when a caller supplies one.
    expect(metered).toContain('if (options.judgeBody && response.ok)');
  });

  it('it reads a CLONE, so the caller\'s stream is untouched', () => {
    expect(metered).toContain('response.clone().json()');
    // The wrapper's own rule: never change the response.
    expect(metered).toContain('Never changes the response');
  });

  it('an unparseable body falls back rather than losing the call', () => {
    expect(metered).toMatch(/catch\s*\{[\s\S]{0,200}keep the HTTP reading/);
  });

  it('metering still never throws and never blocks', () => {
    expect(metered).toContain('Never throws its own errors');
    expect(metered).toContain('void (async () =>');
  });
});

describe('F3 — Google Maps is judged by its own status', () => {
  it('OK and ZERO_RESULTS are served requests; everything else is not', () => {
    // Recreated from the shipped source so the test judges the rule, not prose.
    const judge = (status: unknown) => {
      if (typeof status !== 'string') return null;
      return status === 'OK' || status === 'ZERO_RESULTS' ? 'success' : 'error';
    };
    expect(judge('OK')).toBe('success');
    // A genuine no-match IS a request Google served and charges for.
    expect(judge('ZERO_RESULTS')).toBe('success');
    // The outage statuses return nothing and must not be billed.
    for (const s of ['REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'OVER_DAILY_LIMIT',
      'INVALID_REQUEST', 'UNKNOWN_ERROR']) {
      expect(judge(s)).toBe('error');
    }
    // An unreadable body falls back to the HTTP reading.
    expect(judge(undefined)).toBeNull();
  });

  it('the shipped judge encodes exactly that rule', () => {
    // The judge is one shared module now (`_shared/googleMapsBody.pure.ts`),
    // imported here for the Places and Distance Matrix calls and by the
    // geocoding chain for its Google provider — which is also the one place
    // `ADDRESS_IS_THE_ANSWER` is read, since the service no longer geocodes
    // against Google itself.
    expect(service).toContain('import { judgeGoogleMapsBody } from "../_shared/googleMapsBody.pure.ts"');
    const chain = readFileSync(resolve(REPO, 'supabase/functions/_shared/geocode/geocoder.ts'), 'utf8');
    expect(chain).toContain("import { ADDRESS_IS_THE_ANSWER, judgeGoogleMapsBody } from '../googleMapsBody.pure.ts';");
    const judge = readFileSync(resolve(REPO, 'supabase/functions/_shared/googleMapsBody.pure.ts'), 'utf8');
    expect(judge).toMatch(/status === 'OK' \|\| status === ADDRESS_IS_THE_ANSWER/);
    expect(judge).toContain("if (typeof status !== 'string') return null;");
  });

  it('every Google Maps call in the service is judged by its body', () => {
    const calls = service.match(/await meteredFetch\(\s*\n\s*`https:\/\/maps\.googleapis\.com/g) ?? [];
    const judged = service.match(/judgeBody: judgeGoogleMapsBody/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(judged.length).toBe(calls.length);
  });
});
