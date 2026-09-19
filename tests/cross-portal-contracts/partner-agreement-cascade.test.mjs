import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const cascade = read('supabase/migrations/20260901000700_partner_portal_agreement_cascade.sql');
const solicitorAmendment = read('supabase/migrations/20260901000600_solicitor_agreement_four_acknowledgments.sql');

const sharedContract = read('supabase/functions/_shared/portalAgreement.ts');
const sharedClient = read('src/lib/portalAgreement.ts');
const consentWall = read('src/components/portal/PortalAgreementConsent.tsx');

/* The Builder Portal's verify function and terms page left this repository
   with the portal (network extraction Phase 7) — a builder accepts the
   network's terms on the network now, and the builder rows this cascade once
   wrote were archived and deleted by 20261124000000. The cascade migration
   itself still carries its builder vocabulary verbatim: it is applied
   history, and the CHECKs it installed still admit the value. */
const solicitorVerify = read('supabase/functions/solicitor-portal-verify/index.ts');
const financeVerify = read('supabase/functions/finance-portal-verify/index.ts');

const solicitorPage = read('src/pages/solicitor/SolicitorTerms.tsx');
// The Finance Portal presented the agreement in a modal mounted inside the
// portal layout until it was made a route like the other two. `financeGuard` is
// where the gating decision now lives; `financePage` is the wall itself.
const financePage = read('src/pages/finance-portal/FinancePortalTerms.tsx');
const financeGuard = read('src/components/finance-portal/FinancePortalProtectedRoute.tsx');

const body = (sql) => sql.slice(sql.indexOf('$md$') + 4, sql.lastIndexOf('$md$'));

/**
 * One agreement, three portals.
 *
 * The Portal Access, Confidentiality, Privacy and AML/CTF Compliance Passport
 * Agreement binds "the Partner Organisation" — a solicitor's practice, a
 * builder, a finance partner alike. Before this cascade each portal asked for
 * something different: the Builder Portal a six-clause terms of use, the
 * Finance Portal a string compiled into the bundle. These tests exist to keep
 * the three from drifting apart again, because drift here is invisible until
 * two portals' acceptance records are compared and found to name different
 * documents under one name.
 */

test('every portal publishes the same document, not a similar one', () => {
  // The cascade migration carries the solicitor text verbatim; it is generated
  // from that migration rather than retyped.
  assert.equal(body(cascade), body(solicitorAmendment));

  // One INSERT, both portals, so the two cannot be given different text.
  assert.match(cascade, /FROM \(VALUES \('builder'\), \('finance'\)\) AS p\(portal\)/);
  assert.match(cascade, /'2026-08-07'/);

  // And the migration proves it after the fact rather than assuming it.
  assert.match(cascade, /the % agreement differs from the solicitor agreement/);
  assert.match(cascade, /has % current terms versions, expected 1/);
});

test('a portal keeps its own version row, hash and acceptance history', () => {
  // Not one shared row: acceptance is an act by a named person in a named
  // portal, and the audit trail has to say which.
  assert.match(cascade, /portal_terms_versions_portal_check[\s\S]*?CHECK \(portal IN \('solicitor','builder','finance'\)\)/);
  assert.match(cascade, /portal_terms_acceptances_portal_check[\s\S]*?CHECK \(portal IN \('solicitor','builder','finance'\)\)/);
  assert.match(cascade, /ADD COLUMN IF NOT EXISTS finance_user_id uuid\s*\n\s*REFERENCES public\.finance_portal_users\(id\) ON DELETE CASCADE/);
  assert.match(cascade, /num_nonnulls\(solicitor_user_id, builder_user_id, finance_user_id\) = 1/);
  assert.match(cascade, /portal_terms_acceptances_finance_key/);

  // Every portal's owner column must agree with the portal discriminator, so
  // one portal's user cannot accept another portal's terms.
  for (const portal of ['solicitor', 'builder', 'finance']) {
    assert.ok(
      new RegExp(`portal = '${portal}'\\s+AND \\w+_user_id\\s+IS NOT NULL`).test(cascade),
      `the owner-agreement CHECK does not cover ${portal}`,
    );
  }

  // History is retired, never rewritten: the Builder Portal's old terms of use
  // and every acceptance of it stay exactly as they are.
  assert.match(cascade, /SET retired_at = now\(\)[\s\S]*?AND version <> '2026-08-07'/);
  assert.doesNotMatch(cascade, /DELETE FROM public\.portal_terms_versions/);
  assert.doesNotMatch(cascade, /DELETE FROM public\.portal_terms_acceptances/);
});

test('all three portals enforce the same four acknowledgments, server-side', () => {
  const keys = [
    'global_confidentiality_privacy',
    'authority_binding_acceptance',
    'portal_access',
    'binding_amlctf_arrangement',
  ];
  for (const key of keys) {
    assert.ok(sharedContract.includes(`'${key}'`), `the shared server contract is missing "${key}"`);
    assert.ok(sharedClient.includes(`'${key}'`), `the shared client list is missing "${key}"`);
  }
  // Sliced to the lists themselves: both files name the withdrawn key in a
  // comment that records why it is gone, and that note is worth keeping.
  const serverList = sharedContract.slice(
    sharedContract.indexOf('export const REQUIRED_TERMS_ACKNOWLEDGEMENTS'),
    sharedContract.indexOf('] as const;'),
  );
  const clientList = sharedClient.slice(
    sharedClient.indexOf('export const PORTAL_TERMS_ACKNOWLEDGEMENTS'),
    sharedClient.indexOf('] as const;'),
  );
  assert.ok(!serverList.includes('independent_amlctf_responsibility'));
  assert.ok(!clientList.includes('independent_amlctf_responsibility'));
  assert.equal(serverList.match(/'\w+'/g)?.length, keys.length);

  // Each portal reads the one list rather than keeping its own.
  for (const [name, source] of [
    ['solicitor', solicitorVerify], ['finance', financeVerify],
  ]) {
    assert.match(source, /readAcknowledgements/, `${name} does not read the shared acknowledgments`);
    assert.match(source, /ACKNOWLEDGEMENTS_INCOMPLETE/, `${name} does not refuse an incomplete acceptance`);
    assert.doesNotMatch(
      source, /const REQUIRED_TERMS_ACKNOWLEDGEMENTS = \[/,
      `${name} keeps its own copy of the required keys`,
    );
  }
});

test('an acceptance records which acknowledgments were asserted, in every portal', () => {
  // Solicitor and Finance insert directly. (Builder went through its RPC
  // until the portal moved; the RPC's parameter shape survives in the
  // applied migration below and the RPC itself is dropped by 20261124000000.)
  assert.match(solicitorVerify, /portal_terms_acceptances'\)\.insert\(\{[^}]*acknowledgements/);
  assert.match(financeVerify, /finance_user_id: portalUser\.id,\s*\n\s*acknowledgements,/);
  assert.match(cascade, /_acknowledgements jsonb DEFAULT NULL/);
  assert.match(cascade, /terms_version_id, portal, builder_user_id, acknowledgements, ip_hash, user_agent_hash/);
  assert.match(cascade, /'acknowledgements', COALESCE\(_acknowledgements, '\[\]'::jsonb\)/);
});

test('all three portals present the agreement through one wall', () => {
  for (const [name, source] of [
    ['solicitor', solicitorPage], ['finance', financePage],
  ]) {
    assert.match(source, /<PortalAgreementConsent/, `${name} does not use the shared consent wall`);
  }

  // The wall renders the stored Markdown; no portal restates the agreement.
  assert.match(consentWall, /terms\.content_markdown/);
  for (const [name, source] of [
    ['finance', financePage],
  ]) {
    assert.doesNotMatch(source, /Terms of Use\n/, `${name} still carries its own terms text`);
  }
  assert.doesNotMatch(financePage, /buildTermsBody/, 'the finance terms are still compiled into the bundle');
});

test('all three portals present the agreement on a page, not squeezed into a dialog', () => {
  // The shared DialogContent pins `sm:max-h-[85dvh] sm:overflow-visible` on
  // every dialog at ≥640px, and a `sm:` class beats the unprefixed max-height
  // and overflow a caller passes in. The Finance Portal passed both, lost both,
  // and the agreement ran off the top and bottom of the viewport with no way to
  // scroll it. Whatever else changes here, the wall does not go back in a modal.
  for (const [name, source] of [
    ['solicitor', solicitorPage], ['finance', financePage],
  ]) {
    assert.doesNotMatch(source, /<DialogContent/, `${name} presents the agreement in a dialog again`);
    assert.match(source, /min-h-screen/, `${name} does not lay the agreement out as a page`);
  }
});

test('the Finance Portal gate is version-aware', () => {
  // `has_accepted_terms` only records that the partner once accepted
  // something. Gating on it would mean an amended agreement is never shown to
  // anyone already through the door.
  assert.match(financeGuard, /!user\.has_accepted_current_terms/);
  assert.match(financeVerify, /const hasAcceptedCurrentTerms = Boolean\(currentTerms && currentAcceptance\)/);
  assert.match(financeVerify, /has_accepted_current_terms: hasAcceptedCurrentTerms/);
  assert.match(read('supabase/functions/finance-portal-login/index.ts'), /has_accepted_current_terms: hasAcceptedCurrentTerms/);
  assert.match(financeVerify, /action === 'get_governance'/);
});

/**
 * Migrations, edge functions and the site build ship on three separate tracks
 * here, and the site build is the fastest of the three. Anything that assumes
 * they land together is a regression waiting for the next merge — these tests
 * pin the two places where that assumption would take a portal down.
 */

test('the cascade RPC kept its deploy-order default while it lived', () => {
  // The deployed `builder-portal-verify` called the RPC with four named
  // arguments, so the fifth had to carry a default or every builder
  // acceptance failed until the function deployed. Both sides are retired
  // now; the applied migration still shows the shape the rule demanded.
  assert.match(cascade, /_acknowledgements jsonb DEFAULT NULL\)/);
});

test('the Finance gate does not lock partners out of an un-upgraded deployment', () => {
  // `has_accepted_current_terms` is absent, not false, when the app is running
  // against a finance-portal-verify that predates versioned acceptance. Reading
  // absent as "has not accepted" blocks every finance partner behind a document
  // that deployment cannot serve.
  assert.match(financeGuard, /typeof user\.has_accepted_current_terms === 'boolean'/);
  assert.match(financeGuard, /\? !user\.has_accepted_current_terms\s*\n\s*: !user\.has_accepted_terms;/);
  assert.match(
    read('src/hooks/useFinancePortalAuth.tsx'),
    /has_accepted_current_terms\?: boolean;/,
    'the field is typed as always present, which is what caused the lockout',
  );
});

test('a partner is told why the agreement is missing rather than shown a dead button', () => {
  assert.match(financePage, /const termsUnavailable = !termsLoading && !terms;/);
  assert.match(financePage, /The current terms could not be loaded, so they cannot be accepted yet/);
  assert.match(financePage, /Nothing has\s*\n?\s*been recorded against your account/);
  assert.match(financePage, /onClick=\{loadTerms\}/);
  // Gating still happens: an unloadable document does not become a way in.
  // The page cannot let anyone past — only the guard routes, and it routes on
  // the acceptance flag, never on whether the document could be fetched.
  assert.match(financeGuard, /<Navigate to="\/finance\/terms" replace/);
  assert.doesNotMatch(financePage, /<Navigate/, 'the terms page decides who passes');
});

/**
 * The Finance Portal's consent wall and its welcome tour used to be siblings
 * inside the portal layout. The tour auto-started on a 900ms timer and painted
 * at z-[60]; the terms dialog sat at z-50. A partner's first login showed both
 * at once, the tour's "Welcome to the Finance Portal" card on top of an
 * agreement they had not read. These pin the sequencing that replaced it.
 */

test('the Finance Portal gates in order, by routing rather than by z-index', () => {
  const layout = read('src/components/finance-portal/FinancePortalLayout.tsx');
  const app = read('src/App.tsx');

  // Password, then terms, then onboarding — the order the guard enforces.
  const order = ['must_change_password', 'needsTerms', 'has_completed_onboarding']
    .map((needle) => financeGuard.indexOf(needle));
  assert.ok(order.every((i) => i > 0), 'the guard no longer covers all three gates');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the gates are enforced out of order');

  // Each gate is a route outside the portal layout, so neither can be mounted
  // beside the tour.
  assert.match(app, /path="terms"[\s\S]{0,200}<FinancePortalTerms \/>/);
  assert.match(app, /path="onboarding"[\s\S]{0,200}<FinancePortalOnboarding \/>/);
  assert.doesNotMatch(layout, /FinancePortalOnboardingGate/, 'the blocking modal is mounted in the layout again');

  // The modal it replaced dismissed in place, so a partner who followed a deep
  // link (an emailed AML snapshot, say) stayed on it. Redirecting to a gate
  // must not cost them that — the destination travels with them, and never a
  // gate path, which would loop.
  assert.match(financeGuard, /state=\{\{ from \}\}/);
  assert.match(financeGuard, /<Navigate to=\{from \?\? '\/finance'\} replace \/>/);
  assert.match(financeGuard, /onGatePath \? undefined :/);
});

test('the welcome tour cannot open over the agreement', () => {
  const tour = read('src/components/finance-portal/FinanceOnboardingTour.tsx');
  // Auto-start is conditioned on the partner being through both gates, not on
  // "a user exists" — the condition that let it fire over the consent wall.
  assert.match(tour, /const throughTheDoor = [\s\S]{0,200}has_completed_onboarding/);
  assert.match(tour, /if \(!throughTheDoor\) return;/);
  // And it applies the same absent-is-not-false tolerance as the guard, so an
  // un-upgraded deployment does not silently suppress the tour forever.
  assert.match(tour, /typeof user\.has_accepted_current_terms === 'boolean'/);
});
