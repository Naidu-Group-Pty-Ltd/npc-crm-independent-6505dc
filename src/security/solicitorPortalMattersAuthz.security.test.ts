import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/solicitor-portal-matters/index.ts', 'utf8');
const upcomingDates = source.slice(
  source.indexOf("if (operation === 'upcoming_dates')"),
  source.indexOf('// ───────────────────────── STATS'),
);

/**
 * The permission is resolved once, under its own key, before anything is read.
 *
 * This asserted a per-client loop — `resolveClientPermissions(...)`,
 * `can(perms, 'critical_dates', 'view')`, `.in('client_id',
 * permittedClientIds)`. The operation now calls
 * `listAccessibleMatterIds(supabase, me.id, me.firm_id, 'critical_dates')`,
 * which is the same decision made in one place with the permission key passed
 * in, and filters both queries on the matter ids it returns.
 *
 * The ordering assertion is the part worth keeping and is kept: the access set
 * must be resolved BEFORE either table is queried, so an unpermitted solicitor
 * never reaches a row. The empty-set short circuit is asserted too — without
 * it, `.in('id', [])` semantics become the only thing standing between an
 * unpermitted caller and an unfiltered read.
 */
describe('solicitor-portal-matters authorization', () => {
  it('resolves critical-dates access before reading, and bounds both queries by it', () => {
    expect(upcomingDates).toContain(
      "listAccessibleMatterIds(supabase, me.id, me.firm_id, 'critical_dates')",
    );
    expect(upcomingDates).toContain('if (!dateMatterIds.length) return json({ success: true, records: [] });');
    expect(upcomingDates).toContain(".in('id', dateMatterIds)");
    expect(upcomingDates).toContain(".eq('firm_id', me.firm_id)");
    expect(upcomingDates).toContain(".in('legal_matter_id', Array.from(matterMap.keys()))");

    const accessResolved = upcomingDates.indexOf('listAccessibleMatterIds(');
    expect(accessResolved).toBeGreaterThan(-1);
    expect(accessResolved).toBeLessThan(upcomingDates.indexOf(".from('legal_matters')"));
    expect(accessResolved).toBeLessThan(upcomingDates.indexOf(".from('legal_matter_critical_dates')"));
  });

  it('asks for critical_dates, not the matters permission, on this operation', () => {
    // The key is what makes the resolver's answer specific to this data; a
    // solicitor who may see a matter does not automatically see its dates.
    expect(upcomingDates).toContain("'critical_dates'");
  });
});
