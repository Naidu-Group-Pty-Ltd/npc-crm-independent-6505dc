/**
 * The credential audit trail, and the two ways it was silently absent.
 *
 * `activity_logs.entity_type` is the Postgres enum `activity_entity_type`.
 * `update-integration-secret` wrote `'settings'`, which is not one of its 26
 * values, and awaited the insert without reading its `error` — so every
 * credential change ever made through the Integrations page failed to record
 * who changed which secret, while answering `success: true`.
 * `aml-verification` had the same fault with `'aml_provider_config'` and an
 * explicit `.then(() => undefined, () => undefined)`.
 *
 * Measured 2026-09-08: `activity_logs` holds 5,037 rows across 22 enum values,
 * and neither literal has ever appeared, because neither could.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  ACTIVITY_ENTITY_TYPES,
  assertNoSecretValues,
  isActivityEntityType,
  recordActivity,
  type ActivityWriter,
} from '../../../../supabase/functions/_shared/activityAudit';

const writerThat = (error: unknown): { client: ActivityWriter; rows: unknown[] } => {
  const rows: unknown[] = [];
  return {
    rows,
    client: {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          rows.push(row);
          return Promise.resolve({ error });
        },
      }),
    },
  };
};

const ENTRY = {
  entity_type: 'system' as const,
  entity_name: 'Integration Secrets',
  action_type: 'update',
  user_id: 'u1',
  username: 'admin',
  metadata: { updated_secrets: ['DOMAIN_API_KEY'] },
};

describe("the vocabulary is the column's, not a guess", () => {
  it('carries all 26 enum values', () => {
    expect(ACTIVITY_ENTITY_TYPES).toHaveLength(26);
    expect(new Set(ACTIVITY_ENTITY_TYPES).size).toBe(26);
  });

  it('accepts the value the fix uses', () => {
    expect(isActivityEntityType('system')).toBe(true);
  });

  it('refuses the exact two literals that were failing in production', () => {
    expect(isActivityEntityType('settings')).toBe(false);
    expect(isActivityEntityType('aml_provider_config')).toBe(false);
  });

  it('refuses anything that is not a string', () => {
    for (const v of [null, undefined, 7, {}, ['system']]) {
      expect(isActivityEntityType(v)).toBe(false);
    }
  });
});

describe('a bad entity type fails loudly, in development', () => {
  it('throws rather than posting a row the column will reject', async () => {
    const { client, rows } = writerThat(null);
    await expect(
      recordActivity(client, { ...ENTRY, entity_type: 'settings' as never }),
    ).rejects.toThrow(/not an activity_entity_type/);
    // And nothing was sent — the mistake is caught before the round trip.
    expect(rows).toEqual([]);
  });
});

describe('a failed audit write is reported, never swallowed', () => {
  it('returns the reason when the database rejects the row', async () => {
    const { client } = writerThat({ code: '22P02', message: 'invalid input value for enum' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await recordActivity(client, ENTRY);
    expect(out.ok).toBe(false);
    expect(out).toMatchObject({ reason: expect.stringContaining('22P02') });
    // It is also visible in the logs, which is the other half of "not silent".
    expect(spy).toHaveBeenCalledWith(
      '[activity-audit] audit row was NOT written',
      expect.any(Object),
    );
    spy.mockRestore();
  });

  it('returns an outcome rather than throwing when the client throws', async () => {
    const client: ActivityWriter = {
      from: () => ({ insert: () => Promise.reject(new Error('connection reset')) }),
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await recordActivity(client, ENTRY);
    expect(out).toEqual({ ok: false, reason: 'connection reset' });
    spy.mockRestore();
  });

  it('reports success when the row lands', async () => {
    const { client, rows } = writerThat(null);
    expect(await recordActivity(client, ENTRY)).toEqual({ ok: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_type: 'system', entity_name: 'Integration Secrets' });
  });
});

describe('an audit row never carries a credential', () => {
  it('allows a list of secret NAMES, which is the whole point of the row', () => {
    expect(() =>
      assertNoSecretValues({ updated_secrets: ['DOMAIN_API_KEY', 'COTALITY_API_KEY'] }),
    ).not.toThrow();
  });

  // The fixtures below are deliberately NOT key-shaped. `assertNoSecretValues`
  // refuses any non-empty value under a matching KEY, so the content is
  // irrelevant to what is being asserted — and a realistic-looking literal
  // (this file first used `sk-live-abc123`) trips the repository's own gitleaks
  // gate, which is the gate working. A test about not storing credentials must
  // not ship something that reads as one.
  it('refuses a key that looks like it holds a value', () => {
    for (const meta of [
      { secret_value: 'placeholder' },
      { api_key: 'placeholder' },
      { password: 'placeholder' },
      { credentials: { user: 'a', pass: 'b' } },
    ]) {
      expect(() => assertNoSecretValues(meta), JSON.stringify(meta)).toThrow(/credential value/);
    }
  });

  it('is enforced by recordActivity itself, not left to the caller', async () => {
    const { client, rows } = writerThat(null);
    await expect(
      recordActivity(client, { ...ENTRY, metadata: { api_key: 'placeholder' } }),
    ).rejects.toThrow(/credential value/);
    expect(rows).toEqual([]);
  });

  it('tolerates absent metadata', () => {
    expect(() => assertNoSecretValues(undefined)).not.toThrow();
  });
});
