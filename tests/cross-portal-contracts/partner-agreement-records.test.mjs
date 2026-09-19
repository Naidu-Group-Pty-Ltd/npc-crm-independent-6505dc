import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const migration = read('supabase/migrations/20260901000900_partner_agreement_records.sql');
const fn = read('supabase/functions/partner-agreement-records/index.ts');
const doc = read('supabase/functions/_shared/partnerAgreementDocument.pure.ts');
const panel = read('src/components/admin/PartnerAgreementsPanel.tsx');
const rowAction = read('src/components/admin/useAgreementDownload.ts');
/* The Builder Portal's Command Centre admin surface left with the portal
   (network extraction Phase 7): its edge functions read tables the
   decommission migration drops, and the archive is the operator's record.
   The register keeps serving the two surviving partner portals, and the
   builder acceptance rows it once showed were archived before deletion. */
const solicitorAdmin = read('src/pages/admin/SolicitorPortalAdmin.tsx');
const financeAdmin = read('src/pages/admin/FinancePortalAdmin.tsx');
const registry = JSON.parse(read('supabase/functions-registry/SECURITY_REGISTRY.json'));
const config = read('supabase/config.toml');

/**
 * The executed copy of a Partner Portal Agreement.
 *
 * An acceptance row is a fact about a document; it is not the document. These
 * tests cover the artefact — that it contains the agreement, names both
 * parties, is produced under the operator's own branding, is written once, and
 * is reachable only by someone the Command Centre has already authorised.
 */

test('the copy contains the agreement, not a summary of it', () => {
  // The full rendered text is placed in the document. A "copy" that omitted the
  // agreement would be a receipt.
  assert.match(doc, /<div class="chapter-body agreement">\$\{agreementHtml\}/);
  // Rendered by the programme's one Markdown renderer rather than a second one.
  assert.match(fn, /import \{ renderMarkdown \} from '\.\.\/_shared\/reports\/markdown\.pure\.ts'/);
  // And a clipped legal document is refused rather than stored.
  assert.match(fn, /if \(markdown\.truncated\)/);
  assert.match(fn, /would have been clipped/);
});

test('both parties and the execution detail are on the document', () => {
  for (const fragment of [
    'Originating Organisation',
    'Partner Organisation',
    'Document hash (SHA-256)',
    'Acceptance record',
    'Mandatory acknowledgments as executed',
  ]) {
    assert.ok(doc.includes(fragment), `the document is missing: ${fragment}`);
  }

  // Only the acknowledgments this acceptance actually asserted. An older
  // acceptance that recorded none must not be printed as though it asserted all.
  assert.match(fn, /const asserted = new Set<string>\(Array\.isArray\(record\.acknowledgements\) \? record\.acknowledgements : \[\]\)/);
  assert.match(fn, /PORTAL_TERMS_ACKNOWLEDGEMENTS\.filter\(\(item\) => asserted\.has\(item\.key\)\)/);

  // The fingerprints are hashes and stay hashes.
  assert.match(doc, /source address \(hashed\)/);
  assert.doesNotMatch(doc, /execution\.ipHash|record\.ip_hash/);
});

test('the document is white-label, with nothing about one operator baked in', () => {
  // Every operator-side value comes from the tenant's brand snapshot — the same
  // one the ten report formats resolve — so the agreement carries their colour,
  // their mark and their company details rather than a palette of its own.
  assert.doesNotMatch(doc, /Naidu|NPC Services|npcservices/i);
  assert.match(doc, /resolveSnapshotBrand\(/);
  assert.match(doc, /const contact = input\.snapshot\.company/);
  assert.match(fn, /await fetchReportBrandSnapshot\(supabase/);

  // And not one colour of its own. A literal here is the ninth brand gold; see
  // docs/reports/DESIGN_SYSTEM.md §2.
  const code = doc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.deepEqual(code.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [], []);

  // Snapshotted onto the acceptance, because branding is editable and an
  // executed agreement must keep saying what it said.
  assert.match(fn, /agreement_brand_snapshot: snapshot/);
  assert.match(fn, /agreement_party_snapshot: party/);
  assert.match(migration, /agreement_brand_snapshot jsonb/);
});

test('the copy is written once and never replaced', () => {
  assert.match(fn, /upsert: false/);
  // A race loses gracefully rather than overwriting bytes someone may hold.
  assert.match(fn, /if \(uploadError && !\/exists\/i\.test\(uploadError\.message\)\)/);
  // The path is stamped only while it is still null.
  assert.match(fn, /\.is\('agreement_storage_path', null\)/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS portal_terms_acceptances_agreement_path_key/);
  // Path and timestamp move together; half a record points at nothing.
  assert.match(migration, /num_nonnulls\(agreement_storage_path, agreement_generated_at\) IN \(0, 2\)/);
});

test('only the Command Centre reaches these, and only for its own portal', () => {
  // A staff session, never a portal cookie.
  assert.match(fn, /verifyAuth\(supabase, req\.headers/);
  assert.doesNotMatch(fn, /resolveSolicitorSession|resolveBuilderSession|extractFinanceSessionToken/);

  // Deny-by-default, per portal: the Finance tab's permission does not open the
  // Solicitor tab's agreements.
  assert.match(fn, /solicitor: 'solicitor_portal_admin'/);
  assert.match(fn, /builder: 'builder_portal_admin'/);
  assert.match(fn, /finance: 'finance_portal_admin'/);
  assert.match(fn, /requireModulePermission\([\s\S]{0,200}MODULE_BY_PORTAL\[portal\], 'can_view'/);

  // The portal of a download is read from the record, not from the request: a
  // browser-supplied portal would otherwise choose which permission is checked.
  const download = fn.slice(fn.indexOf("operation === 'download_record'"), fn.indexOf('return json({ error: \'Unknown operation\' }'));
  assert.match(download, /from\('partner_agreement_records'\)[\s\S]{0,200}\.eq\('acceptance_id', acceptanceId\)/);
  assert.ok(
    download.indexOf('MODULE_BY_PORTAL[record.portal') < download.indexOf('createSignedUrl'),
    'the permission check must precede the signed URL',
  );

  // Writing is a mutation and the staff session is cookie-carried. Both
  // operations that produce and store bytes pass the same guard.
  assert.match(fn, /operation === 'download_record'[\s\S]{0,80}\) \{\s*\n\s*const csrf = enforceCsrf\(req\)/);
  // Downloading an executed agreement is an access event on a legal record.
  assert.match(fn, /action: 'partner_agreement_downloaded'/);
});

test('the artefact bucket is private and service-role only', () => {
  assert.match(migration, /'partner-agreements', 'partner-agreements', false/);
  assert.match(migration, /SET public = false/);
  assert.match(migration, /CREATE POLICY partner_agreements_service ON storage\.objects\s*\n\s*FOR ALL TO service_role/);
  assert.doesNotMatch(migration, /TO (anon|authenticated)/);
  assert.match(migration, /REVOKE ALL ON public\.partner_agreement_records FROM PUBLIC, anon, authenticated/);
  // Short-lived links, minted per request.
  assert.match(fn, /SIGNED_URL_TTL_SECONDS = 300/);
});

test('every portal has the same section, and it is the same section', () => {
  for (const [name, source, portal] of [
    ['solicitor', solicitorAdmin, 'solicitor'],
    ['finance', financeAdmin, 'finance'],
  ]) {
    assert.match(source, /<PartnerAgreementsPanel/, `${name} has no agreements section`);
    assert.ok(
      source.includes(`portal="${portal}"`),
      `${name} does not ask for its own portal's agreements`,
    );
    assert.match(
      source, /from '@\/components\/admin\/PartnerAgreementsPanel'/,
      `${name} does not use the shared panel`,
    );
  }

  // The panel reads through the Command Centre transport, not a portal one.
  assert.match(panel, /invokeSecureFunction\('partner-agreement-records'/);
  assert.match(panel, /operation: 'list_records'/);
  assert.match(panel, /operation: 'download_record'/);
});

test('the function is registered as module-gated', () => {
  const entry = registry.functions['partner-agreement-records'];
  assert.ok(entry, 'partner-agreement-records is not in the security registry');
  assert.equal(entry.exposure_class, 'module-gated');
  assert.equal(entry.verify_jwt, true);
  assert.match(config, /\[functions\.partner-agreement-records\]\nverify_jwt = true/);
});

test('the Command Centre view resolves both parties for the surviving portals', () => {
  for (const table of [
    'solicitor_portal_users', 'solicitor_firms',
    'finance_portal_users', 'finance_agent_contacts',
  ]) {
    assert.ok(migration.includes(table), `the view does not reach ${table}`);
  }
  // The builder legs left the view with the portal — a view is validated at
  // creation, so a fresh clone could not build the old definition against
  // the dropped tables, and the builder rows themselves are archived.
  assert.doesNotMatch(migration, /LEFT JOIN public\.builder_portal_users/);
  // And the migration runs the view rather than only parsing it.
  assert.match(migration, /SELECT count\(\*\) INTO v_count FROM public\.partner_agreement_records/);
});

test('the copy is reachable from the partner row, not only from the tab', () => {
  // The Agreements tab is where agreements are audited. It is not where a staff
  // user is standing when a partner rings up and asks for their copy — that is
  // the portal-users row, and the answer should be one menu item away.
  for (const [name, source, portal, id] of [
    ['solicitor', solicitorAdmin, 'solicitor', 'u.id'],
    ['finance', financeAdmin, 'finance', 'u.portal_user!.id'],
  ]) {
    assert.match(source, /Download agreement/, `${name} has no row action`);
    assert.ok(
      source.includes(`downloadForUser('${portal}', ${id}`),
      `${name} does not download for its own portal and row`,
    );
    assert.match(source, /useAgreementDownload\(\)/, `${name} does not use the shared action`);
  }

  // Asked by user, because a row knows who it is and not which acceptance is
  // current. The server resolves the most recent one.
  assert.match(rowAction, /operation: 'download_record',\s*\n\s*portal,\s*\n\s*portal_user_id: portalUserId/);
  assert.match(fn, /query\.eq\('portal_user_id', portalUserId\)\.eq\('portal', requestedPortal \?\? ''\)/);
  assert.match(fn, /\.order\('accepted_at', \{ ascending: false \}\)\.limit\(1\)/);

  // A partner who has not accepted is told so, rather than handed a 404 that
  // reads like a bug or an empty PDF.
  assert.match(fn, /NO_AGREEMENT_ON_RECORD/);
  assert.match(rowAction, /NO_AGREEMENT_ON_RECORD/);

  // Only a finance contact with a portal account can have executed anything.
  assert.match(financeAdmin, /u\.portal_user\?\.id \? \(/);
});

test('a copy is saved without waiting for someone to click Download', () => {
  // "Retained" cannot mean "retained once a staff user happened to open it".
  assert.match(fn, /operation === 'save_missing_copies'/);
  // Both "no copy" and "a copy the template has moved on from" are picked up,
  // by the document module's own rule rather than a second one in a query.
  assert.match(fn, /!hasCurrentAgreementCopy\(record\.agreement_storage_path\)/);
  assert.match(panel, /operation: 'save_missing_copies'/);
  assert.match(panel, /records\.filter\(\(record\) => copyState\(record\) !== 'current'\)\.length/);

  // Bounded and sequential: a burst of renders from one click would take down
  // the PDF service the reports also use.
  assert.match(fn, /const MAX_BATCH = 25/);
  assert.match(fn, /\.slice\(0, MAX_BATCH\)/);
  assert.match(fn, /for \(const record of pending\)/);
  // One unrenderable record must not stop the rest.
  assert.match(fn, /failed\.push\(\{ acceptance_id: record\.acceptance_id/);

  // And it is a mutation, so it passes the CSRF guard.
  assert.match(fn, /operation === 'download_record' \|\| operation === 'save_missing_copies'\) \{\s*\n\s*const csrf = enforceCsrf\(req\)/);

  // The panel says which rows are saved rather than leaving it implied.
  assert.match(panel, /Not saved yet/);
});

test('the Command Centre can tell when the service is older than the app', () => {
  // Merging is not deploying, and the gap is silent by construction: the merge
  // is green, the workflow runs, and the only symptom is a PDF that looks the
  // way it looked before. That is how three portals' agreements kept coming out
  // in the previous format for a day after the document was rebuilt.
  //
  // The frontend ships on the site build, which does deploy. So the app carries
  // the revision it expects and the function reports the one it runs.
  const revision = read('supabase/functions/_shared/partnerAgreementRevision.pure.ts');
  assert.match(revision, /export const AGREEMENT_DOCUMENT_REVISION = \d+/);
  // No imports at all: the browser must be able to read this number without
  // pulling the report stylesheet into the bundle.
  assert.doesNotMatch(revision, /^import /m);

  // One definition. The document module re-exports rather than restating.
  assert.match(doc, /export \{[\s\S]{0,200}AGREEMENT_DOCUMENT_REVISION[\s\S]{0,200}\} from '\.\/partnerAgreementRevision\.pure\.ts'/);
  assert.doesNotMatch(doc, /const AGREEMENT_DOCUMENT_REVISION = /);

  // Reported on both paths a copy can be produced through.
  assert.match(fn, /document_revision: AGREEMENT_DOCUMENT_REVISION/);
  assert.equal(fn.match(/document_revision: AGREEMENT_DOCUMENT_REVISION/g).length, 2);

  // A function that reports nothing is a function deployed before this existed,
  // which is precisely the state worth naming — so it reads as 1, not as
  // "unknown, assume fine".
  assert.match(revision, /const running = typeof reported === 'number' && Number\.isFinite\(reported\) \? reported : 1/);
  assert.match(revision, /if \(running < expected\) return 'behind'/);

  // And both surfaces say so: the panel in a banner, the row action in a toast
  // after the file has already gone to a partner.
  assert.match(panel, /agreementServiceState\(serviceRevision\) === 'behind'/);
  assert.match(panel, /previous document format/);
  assert.match(rowAction, /agreementServiceState\(/);
  assert.match(rowAction, /previous document format/);
  // Read through the bridge, so the app and the function share one number.
  for (const [name, source] of [['panel', panel], ['row action', rowAction]]) {
    assert.match(
      source, /from '@\/lib\/reports\/partnerAgreement\/revision\.pure'/,
      `${name} does not read the revision from the shared module`,
    );
  }
});
