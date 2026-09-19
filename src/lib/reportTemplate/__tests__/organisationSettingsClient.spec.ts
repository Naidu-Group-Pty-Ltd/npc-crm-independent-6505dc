import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `global_report_settings` must be read with the staff session, never anon.
 *
 * The Command Centre has no Supabase Auth session — identity is a custom
 * HttpOnly cookie — so `@/integrations/supabase/client` is the bare anon key.
 * That table grants SELECT to `authenticated` and `service_role` only, and
 * PostgREST answers an unauthorised SELECT on an RLS-protected table with
 * `200 []` rather than a 403.
 *
 * So the read did not fail. It returned nothing, `projectReportSettings`
 * published neither `org.disclaimer` nor `org.disclaimerFontSize`, the binding
 * resolved to the empty string, and `disclaimer.html.ts` fell through to its
 * fallback — printing the generic boilerplate on every design-system document
 * for every report format. The ABN and postal address live in the same row and
 * went the same way, while the wordmark beside them kept working because
 * `whitelabel_settings` is deliberately public.
 *
 * Measured against production on 16 Aug 2026: the exact query this module makes
 * returned `[]` as anon and two rows as `authenticated`.
 *
 * This is a source assertion because the failure has no runtime signal to catch
 * — that is the whole defect. `useAuthenticatedSupabase`'s own header records
 * the same class: an anon read of an RLS table "came back empty instead of
 * failing. Fourteen tables across sixteen modules were affected."
 */
const SOURCE = readFileSync(
  resolve(__dirname, '../adapters/organisation.ts'),
  'utf8',
);

/** The statement that reads the settings row, with its client. */
function settingsReadClient(): string {
  // The `.from('global_report_settings')` call and whatever it is chained onto.
  const idx = SOURCE.indexOf(".from('global_report_settings')");
  expect(idx, 'organisation.ts no longer reads global_report_settings').toBeGreaterThan(-1);
  // Walk back to the awaited receiver on the preceding line(s).
  return SOURCE.slice(Math.max(0, idx - 200), idx);
}

describe('the report settings read is authenticated', () => {
  it('goes through the staff-session client', () => {
    expect(SOURCE).toContain('getAuthenticatedSupabaseClient');
    expect(settingsReadClient()).toMatch(/getAuthenticatedSupabaseClient\(\)|\bauthed\b/);
  });

  it('does not read the settings row on the anon client', () => {
    // `supabase` (the anon client) may still be imported — `whitelabel_settings`
    // is public and correctly read with it — but it must not be the receiver of
    // the settings query.
    expect(settingsReadClient()).not.toMatch(/await\s+supabase\s*$/);
    expect(SOURCE).not.toMatch(
      /await\s+supabase\s*\n?\s*\.from\('global_report_settings'\)/,
    );
  });

  it('still reads the public branding row on the anon client', () => {
    // Switching this one too would trade a working letterhead for a gateway
    // round trip on a row whose policy is "Anyone can view whitelabel settings".
    expect(SOURCE).toMatch(/supabase\s*\n?\s*\.from\('whitelabel_settings'\)/);
  });

  it('says so when the row comes back empty', () => {
    // "No disclaimer configured" and "the read was quietly unauthorised"
    // produced the same blank for months. Only one is a deployment's choice.
    expect(SOURCE).toContain('returned no rows');
  });
});
