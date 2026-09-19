/**
 * Distribution UX — source contract.
 *
 * Phase 2 adds surfaces, and the risk a surface introduces is not that it
 * renders the wrong words: it is that it quietly becomes a second place where
 * permission is decided. A React component that recomputes "can this partner
 * rely?" will disagree with the server eventually, and the disagreement will
 * favour whichever side is more permissive.
 *
 * So these read the new UI sources and assert what is ABSENT from them: no
 * eligibility arithmetic, no route inference, no manifest interpretation, no
 * document paths, no way to send a claim the server would trust.
 *
 * Do not relax these to make a surface ship.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEVER_DISCLOSABLE } from './index';

const repo = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(repo, p), 'utf8');

/** Same idiom the other AML contract suites use. */
const stripComments = (src: string) =>
  src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const DISTRIBUTION = read('src/components/aml/passport/design/PartnerDistribution.tsx');
const DIALOG = read('src/components/aml/passport/design/LinkAndShareDialog.tsx');
const PRESENTATION = read('src/lib/aml/passport/distributionPresentation.pure.ts');
const STRIP = read('src/components/partner-compliance/PartnerPassportStrip.tsx');
const API = read('src/lib/aml/amlRelianceApi.ts');
const WORKSPACE = read('src/components/partner-compliance/PartnerComplianceWorkspace.tsx');

const UI_SOURCES = { DISTRIBUTION, DIALOG, STRIP };

describe('the browser decides nothing about eligibility', () => {
  it('no distribution surface derives readiness — it reads `ready` from the server', () => {
    for (const [name, src] of Object.entries(UI_SOURCES)) {
      // Assigning readiness locally is the shape this bans.
      expect(src, name).not.toMatch(/(const|let)\s+\w*[Rr]eady\s*=\s*[^;]*blockers/);
      expect(src, name).not.toMatch(/blockers\.length\s*===\s*0/);
      expect(src, name).not.toMatch(/hardBlockers/);
    }
  });

  it('no distribution surface decides a legal route by partner type or portal', () => {
    for (const [name, src] of Object.entries(UI_SOURCES)) {
      // e.g. `portal_type === 'finance' ? 'reliance' : ...`
      expect(src, name).not.toMatch(/portal_type\s*===\s*['"]finance['"]\s*\?/);
      expect(src, name).not.toMatch(/organisation_type\s*===[^?\n]*\?\s*['"]reliance['"]/);
      expect(src, name).not.toMatch(/legal_route\s*=\s*['"]/);
    }
  });

  it('the route/reliance vocabulary lives in ONE module and the surfaces import it', () => {
    // A second copy of "which routes count as reliance" is how the two halves
    // of a system start disagreeing about section 37A.
    expect(PRESENTATION).toContain("route === 'reliance' || route === 'outsourced_cdd'");
    for (const [name, src] of Object.entries(UI_SOURCES)) {
      expect(src, name).not.toMatch(/===\s*["']outsourced_cdd["']/);
      if (/isRelianceRoute/.test(src)) {
        expect(src, name).toMatch(/from ["']@\/lib\/aml\/passport\/distributionPresentation\.pure["']/);
      }
    }
  });

  it('the presentation module itself computes no permission — it only maps codes to words', () => {
    // It may read blockers to choose wording; it must never produce a verdict
    // the server did not, so `canShare` is `ready` and nothing else.
    expect(PRESENTATION).toMatch(/return r\.ready && r\.state !== 'ALREADY_CURRENT'/);
    expect(PRESENTATION).not.toMatch(/function\s+\w*[Ee]valuate/);
    expect(PRESENTATION).not.toContain('evaluateDistribution');
  });
});

describe('the button an operator can press is the button the server honours', () => {
  it('the share action is disabled from `canShare`, never from a local condition', () => {
    expect(DISTRIBUTION).toMatch(/disabled=\{!shareable\}/);
    expect(DISTRIBUTION).toMatch(/const shareable = canShare\(readiness\)/);
  });

  it('a blocked partner cannot be selected into a bulk share', () => {
    expect(DIALOG).toMatch(/const shareable = canShare\(p\)/);
    expect(DIALOG).toMatch(/disabled=\{!shareable\}/);
    // "All eligible" is derived from the server's answer, narrowed — never
    // from everything on screen, and never widened.
    expect(DIALOG).toMatch(/partners\.filter\(isBulkEligible\)/);
    expect(DISTRIBUTION).toMatch(/partners\.filter\(isBulkEligible\)/);
  });

  it('the bulk set can only be NARROWER than the server’s, never wider', () => {
    // `isBulkEligible` must be defined in terms of `canShare`, so no future
    // edit can make a bulk action reach a partner the server refused.
    expect(PRESENTATION).toMatch(/export function isBulkEligible[\s\S]{0,200}return canShare\(r\)/);
  });
});

describe('nothing the browser sends is trusted as a claim', () => {
  it('the four client methods send only a case and partner identifiers', () => {
    const block = API.slice(
      API.indexOf('getPassportDistributionReadiness:'),
      API.indexOf('/* ── canonical partner identity'),
    );
    expect(block.length).toBeGreaterThan(0);
    for (const forbidden of [
      'partner_is_eligible', 'section_37a', 'agreement_current', 'client_compliant',
      'passport_current', 'legal_route', 'attestation_id', 'consent_id', 'grant_id',
      'ready', 'blockers', 'evidence_classes',
    ]) {
      expect(block, forbidden).not.toContain(forbidden);
    }
    expect(block).toContain('case_id');
    expect(block).toContain('partner_org_ids');
  });

  it('the dialog submits identifiers only', () => {
    expect(DIALOG).toMatch(/sharePassportToPartners\(caseId, ids\)/);
    expect(DIALOG).toMatch(/sharePassportToPartner\(caseId, ids\[0\]\)/);
  });

  it('no surface calls a distribution op that is not one of the four canonical ones', () => {
    const ops = [...`${DISTRIBUTION}${DIALOG}`.matchAll(/amlRelianceApi\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(ops)).toEqual(new Set([
      'getPassportDistributionReadiness',
      'sharePassportToPartner',
      'sharePassportToPartners',
    ]));
  });
});

describe('documents are never touched by the UI', () => {
  it('no distribution surface handles bytes, paths or signed URLs', () => {
    for (const [name, src] of Object.entries(UI_SOURCES)) {
      for (const forbidden of [
        'storage_path', 'createSignedUrl', 'storage.from', 'download(', 'signed_url',
        'blob:', 'URL.createObjectURL',
      ]) {
        expect(src, `${name}:${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('the partner workspace still reaches evidence through the existing delivery panel', () => {
    // Phase 2 must not have introduced a second retrieval path beside the
    // controlled one.
    expect(WORKSPACE).toContain('EvidenceDeliveriesPanel');
    expect(WORKSPACE).not.toContain('createSignedUrl');
  });
});

describe('restricted AML material cannot reach a distribution surface', () => {
  it('no restricted class name appears in any new UI source', () => {
    for (const [name, src] of Object.entries(UI_SOURCES)) {
      const lower = src.toLowerCase();
      for (const restricted of NEVER_DISCLOSABLE) {
        // `risk_score`, `smr`, `provider_payload`, biometrics and the rest.
        expect(lower, `${name}:${restricted}`).not.toContain(restricted);
      }
    }
  });

  it('no surface reads a command-only projection section', () => {
    for (const [name, src] of Object.entries({ STRIP })) {
      for (const banned of ['view.screening', 'view.funding', 'edd_cases', 'case_events']) {
        expect(src, `${name}:${banned}`).not.toContain(banned);
      }
    }
  });
});

describe('the partner strip presents what the DTO already discloses', () => {
  it('reads the legal route from the workspace DTO rather than deriving one', () => {
    expect(STRIP).toContain('workspace.link.legal_route');
    expect(STRIP).not.toMatch(/legal_route\s*=\s*['"]/);
  });

  it('uses the shared route vocabulary, not a second copy', () => {
    expect(STRIP).toContain("from \"@/lib/aml/passport/distributionPresentation.pure\"");
  });

  it('makes no blanket compliance claim (§23)', () => {
    // Comments are stripped: this file's own prose names the banned phrases in
    // order to explain why they are banned, and that must not read as a use.
    for (const forbidden of [
      /AML compliant/i, /fully approved/i, /guarantees compliance/i, /verified client/i,
    ]) {
      expect(stripComments(STRIP)).not.toMatch(forbidden);
    }
  });

  it('still renders nothing before an attestation has been shared', () => {
    // Fail-closed presentation: no attestation, no strip.
    expect(STRIP).toMatch(/if \(!att\) return null/);
  });
});

describe('§21 — notifications cascade through the existing outbox, not a new system', () => {
  const RELIANCE_FN = read('supabase/functions/aml-reliance/index.ts');
  const EVENTS_MIGRATION = read('supabase/migrations/20260805140000_aml_partner_events_phase6.sql');
  const BLOCK = RELIANCE_FN.slice(
    RELIANCE_FN.indexOf('case "get_passport_distribution_readiness"'),
    RELIANCE_FN.indexOf('case "get_passport_view"'),
  );

  it('a distributed grant notifies because the grant table emits, not because the UI asked', () => {
    // The notification is a consequence of the row, so it cannot be forgotten
    // by a new caller and cannot be forged by one either.
    expect(EVENTS_MIGRATION).toContain('trg_aml_emit_grant_events');
    expect(EVENTS_MIGRATION).toMatch(/AFTER INSERT OR UPDATE ON aml\.reliance_grants/);
    expect(EVENTS_MIGRATION).toContain("'aml.partner_access.created'");
    expect(EVENTS_MIGRATION).toContain("'aml.partner_access.revoked'");
  });

  it('distribution writes no notification of its own', () => {
    // A second writer would double-notify and could bypass the safe-wording
    // builder the worker applies.
    expect(BLOCK).not.toMatch(/from\("partner_notifications"\)/);
    expect(BLOCK).not.toMatch(/enqueue_partner_event/);
  });

  it('a repeated share cannot produce a duplicate notification', () => {
    // Two independent guarantees, and both must hold: an ALREADY_CURRENT
    // partner writes no grant row at all, and the worker's upsert is keyed on
    // the originating event.
    expect(BLOCK).toContain('ALREADY_CURRENT');
    const worker = read('supabase/functions/cross-portal-outbox-worker/index.ts');
    expect(worker).toMatch(/onConflict:'outbox_event_id',ignoreDuplicates:true/);
    expect(EVENTS_MIGRATION).toMatch(/'aml\.partner_access\.created:' \|\| NEW\.id/);
  });

  it('the revocation notification carries identifiers, never the internal reason', () => {
    expect(EVENTS_MIGRATION).toMatch(/Deliberately NOT the free-text revoke_reason/);
  });
});

describe('the advanced governance surfaces are untouched', () => {
  it('the existing Compliance Sharing section still exists', () => {
    const reliance = read('src/components/aml/ReliancePassportSection.tsx');
    expect(reliance.length).toBeGreaterThan(0);
    // The guided path did not replace grant/revoke administration.
    expect(reliance).toMatch(/grantAccess|revokeGrant/);
  });

  it('the shared partner workspace is still the single implementation for all portals', () => {
    for (const page of [
      'src/pages/finance-portal/FinancePortalComplianceWorkspace.tsx',
      'src/pages/solicitor/SolicitorCompliance.tsx',
    ]) {
      expect(read(page), page).toContain('PartnerComplianceWorkspace');
    }
  });
});
