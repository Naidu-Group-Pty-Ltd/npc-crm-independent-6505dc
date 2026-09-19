/**
 * The platform offers templates. It does not run agreements.
 *
 * This suite exists because the thing being prevented is a REGROWTH, not a
 * bug. The issuance workflow was built once and could plausibly be rebuilt a
 * piece at a time — an "issue to partner" action here, a status column read
 * there — and each piece would look reasonable on its own. What makes it wrong
 * is the whole: a platform that facilitates and records the formation of a
 * contract between two independent businesses is exposed to that contract.
 *
 * So these assertions are deliberately about ABSENCE, and they are mechanical.
 * See `_shared/agreements/templateResource.pure.ts` for the position itself.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_TEMPLATE_SUMMARIES,
  TEMPLATE_NEUTRALITY_NOTICE,
  TEMPLATE_NEUTRALITY_SHORT,
  TEMPLATE_RESOURCE_INTRO,
  agreementTemplate,
} from '@/lib/agreements';

const root = (...p: string[]) => join(process.cwd(), ...p);
const read = (...p: string[]) => readFileSync(root(...p), 'utf8');

describe('the execution machinery is gone', () => {
  it.each([
    'supabase/functions/manage-partner-agreements',
    'supabase/functions/finance-portal-agreements',
    'supabase/functions/agreement-centre-render',
  ])('%s no longer exists', (dir) => {
    // While any of these is deployable, the platform can still issue, accept,
    // execute or re-render an agreement — regardless of what the UI offers.
    expect(existsSync(root(dir))).toBe(false);
  });

  it.each([
    'lifecycle.pure.ts', 'partnerAccess.pure.ts', 'recipients.pure.ts',
    'annotations.pure.ts', 'syncStamp.pure.ts', 'portalReceipt.pure.ts',
    'documentRevision.pure.ts', 'render.ts', 'sendAgreementEmail.ts',
    'pendingDelivery.ts', 'anchorColumns.ts',
  ])('the %s module is gone', (mod) => {
    expect(existsSync(root('supabase/functions/_shared/agreements', mod))).toBe(false);
  });

  it('leaves only template modules behind', () => {
    const remaining = readdirSync(root('supabase/functions/_shared/agreements')).sort();
    expect(remaining).toEqual([
      'additionalClauses.pure.ts',
      'contentFinanceReferral.pure.ts',
      'contentOverrides.pure.ts',
      'contentStrategicReferral.pure.ts',
      'documentHtml.pure.ts',
      'fields.pure.ts',
      'index.pure.ts',
      'templateFiles.pure.ts',
      'templateResource.pure.ts',
      'types.pure.ts',
    ]);
  });

  it('no longer declares the removed functions to the gateway or the registry', () => {
    // A stale `[functions.X]` block asserts a gateway posture for something
    // that cannot be deployed, and a stale registry entry fails the CI count.
    const config = read('supabase/config.toml');
    const registry = read('supabase/functions-registry/SECURITY_REGISTRY.json');
    for (const fn of ['manage-partner-agreements', 'finance-portal-agreements', 'agreement-centre-render']) {
      expect(config).not.toContain(`[functions.${fn}]`);
      expect(registry).not.toContain(`"${fn}"`);
    }
  });
});

describe('there is one copy of each agreement, not three', () => {
  // These two instruments were typeset three separate ways in this repository
  // at once: a Python builder writing `public/`, a browser renderer drawing
  // the content modules into Word, and the documents their author maintains.
  // Only the last of those reaches anybody now, and the other two are gone
  // rather than dormant — a dormant generator is one `npm run` away from
  // putting a second, staler document next to the real one.
  it.each([
    'src/lib/agreements/docx.ts',
    'src/lib/agreements/docxTheme.ts',
    'scripts/finance-portal-templates/build_buyers_agent_agreement.py',
    'scripts/finance-portal-templates/build_finance_referral_agreement.py',
    'scripts/finance-portal-templates/docx_kit.py',
  ])('%s no longer exists', (path) => {
    expect(existsSync(root(path))).toBe(false);
  });

  it('the template directory holds exactly the two shipped agreements', () => {
    const dir = root('public/templates/finance-portal');
    const words = readdirSync(dir).filter((name) => name.endsWith('.docx')).sort();
    expect(words).toEqual([
      'Finance_Referral_and_Commission_Agreement.docx',
      'Strategic_Property_Referral_Agreement.docx',
    ]);
  });

  it('the pack builder no longer generates an agreement', () => {
    const src = read('scripts/finance-portal-templates/build_all.py');
    expect(src).not.toContain('build_buyers_agent_agreement');
    expect(src).not.toContain('build_finance_referral_agreement');
  });
});

describe('nothing reads the agreement register any more', () => {
  it('referrals do not resolve a governing agreement', () => {
    // A referral quoting fee terms out of a platform-held register is the
    // participation being retired, not merely a UI affordance.
    const src = read('supabase/functions/manage-partner-referrals/index.ts');
    expect(src).not.toContain("from('partner_agreements')");
  });

  it('the referral agreement picker answers empty without a query', () => {
    // Kept rather than removed so an older bundle gets an empty list instead
    // of `unknown_action`.
    const src = read('supabase/functions/manage-partner-referrals/index.ts');
    expect(src).toContain("if (action === 'list_active_agreements')");
    expect(src).toContain('return json({ agreements: [] }, corsHeaders);');
  });

  it('login and invitation acceptance no longer sweep for pending agreements', () => {
    for (const fn of ['finance-portal-login', 'finance-portal-accept-invite']) {
      expect(read('supabase/functions', fn, 'index.ts'))
        .not.toContain('deliverPendingAgreementNotifications');
    }
  });
});

describe('the templates survive, on equal terms for both parties', () => {
  it('still carries both templates with their real content', () => {
    expect(AGREEMENT_TEMPLATE_SUMMARIES).toHaveLength(2);
    for (const summary of AGREEMENT_TEMPLATE_SUMMARIES) {
      const content = agreementTemplate(summary.key);
      expect(content.title).toBe(summary.title);
      expect(content.sections.length).toBeGreaterThan(0);
    }
  });

  it('describes the flow without describing a workflow', () => {
    // The summaries used to end with "Issued by the buyer's agency / real
    // estate agency", which asserts an issuing act the platform no longer
    // performs.
    for (const summary of AGREEMENT_TEMPLATE_SUMMARIES) {
      expect(summary.referralFlow).not.toMatch(/\bIssued by\b/i);
    }
  });

  it('takes a static file, so no application call records the download', () => {
    // The neutral position is architectural: nothing observes that a template
    // was taken, by whom, or for which partner.
    //
    // This used to assert there was no `fetch(` at all, because the Word file
    // was drawn in the browser. The document is now the author's own file and
    // has to be fetched from the origin, the same as any image on the page —
    // so what is asserted is the part that actually carries the guarantee: no
    // Edge Function is invoked, and nothing is written.
    const src = read('src/lib/agreements/templateDownloads.ts');
    expect(src).toContain('agreementTemplateUrl');
    expect(src).not.toMatch(/invokeSecureFunction|invokeFinanceFunction|supabase\./);
    expect(src).not.toMatch(/\.insert\(|\.update\(|logEvent|track\(/);
  });

  it('offers no branded variant, so both sides get the same bytes', () => {
    // A tenant-stamped copy on one desk and a neutral one on the other is two
    // documents claiming to be the same template — and the branded one reads
    // as that side's prepared offer rather than a starting point.
    const src = read('src/lib/agreements/templateDownloads.ts');
    expect(src).not.toContain('templateBrand');
    expect(read('src/pages/AgreementTemplates.tsx')).not.toContain('useBrand');
  });

  it('shows BOTH sides the same component and the same words', () => {
    const shared = 'components/agreement-templates/AgreementTemplateResources';
    expect(read('src/pages/AgreementTemplates.tsx')).toContain(shared);
    expect(read('src/pages/finance-portal/FinancePortalDashboard.tsx')).toContain(shared);
  });
});

describe('the position is stated, not implied', () => {
  it('says what the platform does not do, not merely "seek advice"', () => {
    const all = TEMPLATE_NEUTRALITY_NOTICE.join(' ');
    expect(all).toMatch(/not a party/i);
    expect(all).toMatch(/does not facilitate/i);
    expect(all).toMatch(/keeps no record/i);
    expect(all).toMatch(/entirely your choice/i);
  });

  it('is short enough to be read where space is tight, and still complete', () => {
    expect(TEMPLATE_NEUTRALITY_SHORT).toMatch(/not a party/i);
    expect(TEMPLATE_NEUTRALITY_SHORT).toMatch(/keeps no record/i);
    expect(TEMPLATE_RESOURCE_INTRO).toMatch(/directly between you and the other party/i);
  });

  it('no longer opens the desk by explaining what the page used to be', () => {
    // `WORKFLOW_RETIRED_NOTICE` was removed at the product owner's direction:
    // an explanation of a change has an expiry, and until then it is the first
    // thing every routine visitor reads before the thing they came for. This
    // asserts it is gone rather than merely unrendered, so it cannot come back
    // as somebody's fix for a problem that was considered and closed.
    expect(read('supabase/functions/_shared/agreements/templateResource.pure.ts'))
      .not.toContain('export const WORKFLOW_RETIRED_NOTICE');
    expect(read('src/pages/AgreementTemplates.tsx')).not.toContain('WORKFLOW_RETIRED_NOTICE');
  });

  it('renders the notice above the downloads, not beneath them', () => {
    // A notice underneath the thing it qualifies is one most people never reach.
    const src = read('src/components/agreement-templates/AgreementTemplateResources.tsx');
    expect(src.indexOf('TEMPLATE_NEUTRALITY_NOTICE'))
      .toBeLessThan(src.indexOf('AGREEMENT_TEMPLATE_SUMMARIES.map'));
  });

  it('stops stamping platform attribution onto the document', () => {
    const src = read('supabase/functions/_shared/agreements/documentHtml.pure.ts');
    expect(src).not.toContain('Generated securely through Aurixa Systems</div>');
  });
});

describe('old links land somewhere honest', () => {
  const app = read('src/App.tsx');

  it.each([
    'partner-agreements/new',
    'partner-agreements/register',
    'partner-agreements/:id',
    'partner-agreements/:id/edit',
  ])('%s redirects instead of 404-ing', (route) => {
    // These are in bookmarks, emails and activity trails. A 404 reads as a
    // fault; the template desk reads as an answer.
    const at = app.indexOf(`path="${route}"`);
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, at + 220)).toContain('Navigate to="/partner-agreements"');
  });

  it('sends the partner\'s emailed agreement links to their dashboard', () => {
    const at = app.indexOf('path="agreements/:id"');
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, at + 200)).toContain('Navigate to="/finance"');
  });

  it('drops Agreements from the partner\'s navigation', () => {
    // Templates are a resource on the dashboard, not a destination that still
    // looks like an inbox.
    expect(read('src/components/finance-portal/FinancePortalLayout.tsx'))
      .not.toContain("label: 'Agreements'");
  });

  it('gives the desk a way out that survives a redirected arrival', () => {
    // The four routes above land here by `replace`, and the desk has no
    // sidebar entry (`paletteOnly`), so a bare `navigate(-1)` would step back
    // to whatever preceded the old bookmark — usually out of the product.
    const page = read('src/pages/AgreementTemplates.tsx');
    expect(page).toContain('navigateBack');
    expect(page).not.toMatch(/navigate\(\s*-1\s*\)/);
    expect(read('src/lib/navigation/registry.ts')).toContain("url: '/partner-agreements'");
  });

  it('no longer calls the destination the Agreement Centre', () => {
    // The admin page's link is the main in-app way in. It described the
    // destination as where issuing and executing happen, which it is not.
    const admin = read('src/pages/admin/FinancePortalAdmin.tsx');
    const at = admin.indexOf('to="/partner-agreements"');
    expect(at).toBeGreaterThan(-1);
    expect(admin.slice(at, at + 200)).not.toContain('Agreement Centre');
    expect(admin.slice(at, at + 200)).toContain('Agreement Templates');
  });
});
