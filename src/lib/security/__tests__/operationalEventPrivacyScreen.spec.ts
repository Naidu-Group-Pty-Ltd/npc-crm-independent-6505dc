/**
 * THE TELEMETRY PRIVACY SCREEN — IT MUST RECORD WHAT IS HARMLESS AND REFUSE
 * WHAT IS NOT.
 *
 * `record_portal_operational_event` refuses metadata carrying a sensitive key
 * (internal notes, financial position, SMR/AML material) with the jsonpath
 *
 *     $.**.keyvalue() ? (@.key like_regex "…")
 *
 * `$.**` visits EVERY item — the scalars included — and `.keyvalue()` raises
 * on anything that is not an object. So every metadata object holding an
 * ordinary value (`{"attempt": 1}`) made the recorder throw. Measured in
 * production on 25 Sep 2026: "jsonpath item method .keyvalue() can only be
 * applied to an object". Every caller in the repository passes such metadata,
 * so login failures, outbox delivery, audit-chain failures and malware
 * detection — four of them alert-raising — were never recorded.
 *
 * The fix walks OBJECTS only. These specs run the real recorder (the phase 14
 * migration, then the fix) against a throwaway Postgres and assert:
 *
 *   1. the failure, reproduced against the current definition;
 *   2. harmless metadata of every shape records;
 *   3. a sensitive key is refused at any depth, in any container, in any case —
 *      the screen stays fail-closed;
 *   4. a direct write to the table cannot go round the screen;
 *   5. every existing caller's metadata shape records, and every caller in the
 *      repository passes keys the screen allows.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  postgresAvailable, startThrowawayPostgres, type ThrowawayPostgres,
} from '../../__tests__/support/throwawayPostgres';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const MIGRATIONS = join(REPO_ROOT, 'supabase', 'migrations');
const PHASE14 = '20260730290000_cross_portal_observability_phase14.sql';
export const SCREEN_FIX = '20261221110000_the_telemetry_screen_walks_objects_only.sql';

/** The pattern the screen has always refused, verbatim from phase 14. */
const SENSITIVE = /^(internal_notes|risk_notes|contract_text|raw_content|income|expenses|assets|liabilities|borrowing_capacity|smr|aml_restricted)$/i;

const runs = postgresAvailable();
let db: ThrowawayPostgres;

const q = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;

function record(metadata: unknown, eventName = 'spec_event'): string {
  return db.sql(`SELECT public.record_portal_operational_event(
    '${eventName}', 'warning', gen_random_uuid(), 'spec', 'worker', NULL, 'integration_worker',
    NULL, NULL, NULL, NULL, false, ${q(metadata)})`);
}

function refusal(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? (error as Error).message);
    return stderr;
  }
}

function applyPhase14(): void {
  db.sql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS public.transaction_cases (id uuid PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS public.legal_matters (id uuid PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS public.solicitor_firms (id uuid PRIMARY KEY);`);
  db.file(join(MIGRATIONS, PHASE14));
}

describe.skipIf(!runs)('the telemetry privacy screen', () => {
  beforeAll(() => {
    db = startThrowawayPostgres();
    applyPhase14();
  });
  afterAll(() => db?.stop());

  describe('1. the defect, reproduced against the definition production runs', () => {
    it('refuses ordinary metadata with the error production logged', () => {
      const error = refusal(() => record({ attempt: 1 }));
      expect(error).toMatch(/keyvalue\(\) can only be applied to an object/);
    });

    it('only an empty object ever recorded', () => {
      expect(refusal(() => record({}))).toBeNull();
    });
  });

  describe('after the fix', () => {
    beforeAll(() => {
      db.file(join(MIGRATIONS, SCREEN_FIX));
      db.sql('DELETE FROM public.portal_operational_alerts; DELETE FROM public.portal_operational_events;');
    });

    describe('2. harmless metadata records', () => {
      const harmless: Array<[string, unknown]> = [
        ['a flat string', { reason: 'verification_failed' }],
        ['a number', { attempt: 3, duration: 12.5 }],
        ['a boolean', { retried: true, terminal: false }],
        ['a null', { error_code: null }],
        ['a nested object', { outcome: { stage: 'apply', counts: { applied: 2, refused: 0 } } }],
        ['an array of strings', { forbidden_paths: ['payload.client_name', 'payload.internal_notes'] }],
        ['an array of objects', { batches: [{ id: 1, ok: true }, { id: 2, ok: false }] }],
        ['a mixed array', { mixed: [1, 'two', null, true, { nested: 'ok' }, [3, 4]] }],
        ['an empty object', {}],
        ['operational metadata of the ordinary kind', {
          event_type: 'stock.item.upserted', consumer: 'network', attempt: 2,
          connection_id: '00000000-0000-4000-8000-000000000000', duration_ms: 41,
        }],
      ];
      it.each(harmless)('%s', (_label, metadata) => {
        const id = record(metadata);
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(JSON.parse(db.sql(`SELECT metadata FROM public.portal_operational_events WHERE id = '${id}'`)))
          .toEqual(metadata);
      });

      it('a sensitive WORD as a value is not a sensitive key', () => {
        // The screen is about fields, never about prose: a reason naming
        // "income" says nothing about anybody's income.
        expect(record({ reason: 'income', note: 'assets' })).toMatch(/^[0-9a-f-]{36}$/);
      });
    });

    describe('3. a sensitive key is refused wherever it is', () => {
      const sensitive: Array<[string, unknown]> = [
        ['at the top', { internal_notes: 'x' }],
        ['with a scalar sibling', { attempt: 1, income: 90000 }],
        ['nested', { client: { position: { liabilities: 1 } } }],
        ['deeply nested', { a: { b: { c: { d: { e: { smr: true } } } } } }],
        ['inside an array of objects', { rows: [{ ok: 1 }, { borrowing_capacity: 500000 }] }],
        ['inside a mixed array', { mixed: [1, 'x', null, { contract_text: '…' }] }],
        ['inside an array inside an array', { grid: [[{ risk_notes: 'x' }]] }],
        ['in a different case', { Internal_Notes: 'x' }],
        ['whose value is null', { aml_restricted: null }],
        ['whose value is an object', { raw_content: { any: 'thing' } }],
        ['at the top of an array payload', [{ expenses: 1 }]],
      ];
      it.each(sensitive)('%s', (_label, metadata) => {
        const before = db.sql('SELECT count(*) FROM public.portal_operational_events');
        expect(refusal(() => record(metadata))).toMatch(/SENSITIVE_TELEMETRY_FIELD_FORBIDDEN/);
        expect(db.sql('SELECT count(*) FROM public.portal_operational_events')).toBe(before);
      });

      it('every key phase 14 named is still refused', () => {
        for (const key of ['internal_notes', 'risk_notes', 'contract_text', 'raw_content', 'income',
          'expenses', 'assets', 'liabilities', 'borrowing_capacity', 'smr', 'aml_restricted']) {
          expect(refusal(() => record({ nested: [{ [key]: 1 }] })), key)
            .toMatch(/SENSITIVE_TELEMETRY_FIELD_FORBIDDEN/);
          expect(SENSITIVE.test(key)).toBe(true);
        }
      });
    });

    describe('4. nothing goes round the screen', () => {
      it('a direct INSERT carrying a sensitive key is refused', () => {
        expect(refusal(() => db.sql(`INSERT INTO public.portal_operational_events
          (event_name, severity, correlation_id, actor_type, portal, metadata)
          VALUES ('direct', 'info', gen_random_uuid(), 'worker', 'x', ${q({ a: [{ income: 1 }] })})`)))
          .toMatch(/SENSITIVE_TELEMETRY_FIELD_FORBIDDEN/);
      });

      it('an UPDATE that introduces a sensitive key is refused', () => {
        const id = record({ attempt: 1 });
        expect(refusal(() => db.sql(`UPDATE public.portal_operational_events
          SET metadata = ${q({ attempt: 1, smr: true })} WHERE id = '${id}'`)))
          .toMatch(/SENSITIVE_TELEMETRY_FIELD_FORBIDDEN/);
      });

      it('a direct INSERT of harmless metadata still records', () => {
        expect(refusal(() => db.sql(`INSERT INTO public.portal_operational_events
          (event_name, severity, correlation_id, actor_type, portal, metadata)
          VALUES ('direct', 'info', gen_random_uuid(), 'worker', 'x', ${q({ attempt: 1, ok: true })})`)))
          .toBeNull();
      });

      it('browser roles cannot call the recorder or the screen, or write the table', () => {
        for (const role of ['anon', 'authenticated']) {
          expect(db.sql(`SELECT has_function_privilege('${role}',
            'public.record_portal_operational_event(text,text,uuid,text,text,uuid,text,uuid,uuid,uuid,integer,boolean,jsonb)', 'EXECUTE')`)).toBe('f');
          expect(db.sql(`SELECT has_function_privilege('${role}',
            'public.portal_operational_metadata_is_forbidden(jsonb)', 'EXECUTE')`)).toBe('f');
          expect(db.sql(`SELECT has_table_privilege('${role}', 'public.portal_operational_events', 'INSERT')`)).toBe('f');
        }
      });

      it('a failure of the screen itself refuses rather than records', () => {
        // Fail-closed: the recorder has no handler that could swallow a screen
        // error and write the row anyway.
        const body = db.sql(`SELECT pg_get_functiondef(
          'public.record_portal_operational_event(text,text,uuid,text,text,uuid,text,uuid,uuid,uuid,integer,boolean,jsonb)'::regprocedure)`);
        expect(body).not.toMatch(/EXCEPTION\s+WHEN/i);
        expect(body).toContain('portal_operational_metadata_is_forbidden');
      });
    });

    describe('5. every existing caller keeps working', () => {
      // The metadata each call site in the repository sends, by shape.
      const callers: Array<[string, string, unknown]> = [
        ['solicitor-portal-matters: stale write', 'stale_write_conflict', { command: 'update_matter', expected_version: 3 }],
        ['solicitor-portal-intelligence: run', 'ai_analysis_run', { model: 'm', prompt_version: 'v1', cost_usd: 0.01, input_tokens: 10, output_tokens: 5 }],
        ['solicitor-portal-intelligence: failure', 'ai_analysis_run', { model: 'm', prompt_version: 'v1', error_code: 'timeout' }],
        ['cross-portal-outbox-worker: network dead', 'builder_network_delivery_dead', { event_type: 'e', attempt: 5, error_code: 'x' }],
        ['cross-portal-outbox-worker: privacy violation', 'builder_network_outbound_privacy_violation', { event_type: 'e', forbidden_path_count: 1, forbidden_paths: ['payload.client_name'] }],
        ['cross-portal-outbox-worker: projection', 'client_projection_privacy_violation', { forbidden_field_count: 2 }],
        ['cross-portal-outbox-worker: audit chain', 'audit_chain_failure', { reason: 'verification_failed' }],
        ['cross-portal-outbox-worker: delivery', 'outbox_delivery', { event_type: 'e', consumer: 'c', attempt: 1 }],
        ['cross-portal-outbox-worker: notification', 'conversation_delivery_failure', { channel: 'email', attempt: 2, error_code: 'dispatcher_not_configured' }],
        ['legal-document-processor', 'document_malware_detected', { document_version_id: 'v', scan_status: 'infected', provider: 'p', error_code: null }],
        ['solicitorPortalAuth: activity', 'mandatory_audit_write_failure', { action: 'a', entity_type: null }],
        ['solicitor-portal-login: failure', 'solicitor_login_failure', { attempt_bucket: 'below_lockout' }],
        ['solicitor-portal-login: success', 'solicitor_login_success', { session_id: 's' }],
        ['builder_network_media_note', 'builder_network_media_refused', { reason: 'invalid_media', connection_id: 'c' }],
      ];
      it.each(callers)('%s', (_site, eventName, metadata) => {
        expect(record(metadata, eventName)).toMatch(/^[0-9a-f-]{36}$/);
      });

      it('an alert-raising event raises its alert again', () => {
        const id = record({ scan_status: 'infected' }, 'document_malware_detected');
        expect(db.sql(`SELECT alert_type FROM public.portal_operational_alerts WHERE event_id = '${id}'`))
          .toBe('document_malware_detected');
      });
    });
  });
});

describe('every call site passes keys the screen allows', () => {
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) out.push(...sources(path));
      else if (entry.endsWith('.ts')) out.push(path);
    }
    return out;
  }

  it('no _metadata literal names a sensitive key', () => {
    const offenders: string[] = [];
    let sites = 0;
    for (const file of sources(join(REPO_ROOT, 'supabase', 'functions'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/record_portal_operational_event[\s\S]{0,1200}?_metadata\s*:\s*\{([^}]*)\}/g)) {
        sites += 1;
        for (const key of match[1].matchAll(/([A-Za-z_]+)\s*:/g)) {
          if (SENSITIVE.test(key[1])) offenders.push(`${file}: ${key[1]}`);
        }
      }
    }
    expect(sites).toBeGreaterThanOrEqual(10);
    expect(offenders).toEqual([]);
  });
});
