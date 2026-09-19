/**
 * Passport orchestration — the connections, and what they must never become.
 *
 * This stage connected surfaces that already existed. The risk in that is not
 * that a button fails to work: it is that a *navigation* affordance quietly
 * becomes an authority, or that a request composed from the Passport takes a
 * route nobody validated. So these tests cover the seams.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_ACTIONS,
  CLIENT_ACTION_CODES,
  QUESTIONNAIRE_SECTION_CODES,
  TARGET_STEPS,
  isClientActionCode,
  kindForAction,
  sanitiseActionCode,
  sanitiseActionTarget,
} from '../../../../supabase/functions/_shared/aml/clientRequestContract.pure';
import {
  deriveOutstandingItems, outstandingHeadline, summariseOutstanding,
} from './outstandingItems.pure';
import type { PassportView } from './index';

const repo = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(repo, p), 'utf8');

/* ── the routing contract ─────────────────────────────────────────────── */

describe('a request target is a whitelist, never a location', () => {
  it('keeps the three fields the portal understands', () => {
    expect(sanitiseActionTarget({
      target_step: 'documents',
      requirement_id: '11111111-2222-3333-4444-555555555555',
      section_code: 'funding',
    })).toEqual({
      target_step: 'documents',
      requirement_id: '11111111-2222-3333-4444-555555555555',
      section_code: 'funding',
    });
  });

  it('drops every URL-shaped or crafted field', () => {
    for (const hostile of [
      { href: 'https://evil.test' },
      { url: 'https://evil.test' },
      { target_step: 'https://evil.test' },
      { target_step: 'javascript:alert(1)' },
      { section_code: '../../etc/passwd' },
      { section_code: 'https://evil.test' },
      { requirement_id: '../../../secret' },
      { requirement_id: 'not-a-uuid' },
      { target_step: { toString: () => 'documents' } },
    ]) {
      const out = sanitiseActionTarget(hostile);
      expect(Object.keys(out).sort()).toEqual(['requirement_id', 'section_code', 'target_step']);
      expect(JSON.stringify(out)).not.toMatch(/http|javascript|\.\.|passwd|secret/i);
    }
  });

  it('never echoes back an unrecognised key', () => {
    const out = sanitiseActionTarget({ target_step: 'documents', evil: 'yes', href: 'x' }) as unknown as
      Record<string, unknown>;
    expect(out.evil).toBeUndefined();
    expect(out.href).toBeUndefined();
  });

  it('a section code outside the questionnaire vocabulary is dropped, not stored', () => {
    expect(sanitiseActionTarget({ section_code: 'funding' }).section_code).toBe('funding');
    expect(sanitiseActionTarget({ section_code: 'salary_details' }).section_code).toBeNull();
    expect(sanitiseActionTarget({ section_code: 'FUNDING' }).section_code).toBeNull();
  });

  it('every questionnaire section the portal accepts a write for is routable', () => {
    for (const code of QUESTIONNAIRE_SECTION_CODES) {
      expect(sanitiseActionTarget({ section_code: code }).section_code).toBe(code);
    }
  });

  it('a target step outside the vocabulary is dropped', () => {
    for (const step of TARGET_STEPS) {
      expect(sanitiseActionTarget({ target_step: step }).target_step).toBe(step);
    }
    expect(sanitiseActionTarget({ target_step: 'admin' }).target_step).toBeNull();
  });
});

describe('the action vocabulary is closed', () => {
  it('accepts only the six codes', () => {
    for (const c of CLIENT_ACTION_CODES) expect(sanitiseActionCode(c)).toBe(c);
    for (const bad of ['approve_case', 'set_service_gate', '', null, undefined, 42, {}]) {
      expect(sanitiseActionCode(bad)).toBeNull();
      expect(isClientActionCode(bad)).toBe(false);
    }
  });

  it('every code carries client copy, an operator label and a kind', () => {
    for (const c of CLIENT_ACTION_CODES) {
      const a = CLIENT_ACTIONS[c];
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.operatorLabel.length).toBeGreaterThan(0);
      expect(a.step.length).toBeGreaterThan(0);
      expect(kindForAction(c)).toBe(a.kind);
    }
  });

  it('no client-facing label leaks AML vocabulary', () => {
    const clientCopy = CLIENT_ACTION_CODES.map((c) => CLIENT_ACTIONS[c].label).join(' | ');
    for (const internal of [
      /risk/i, /screening/i, /PEP/i, /EDD/i, /suspicion/i, /SMR/i, /MLRO/i,
      /escalat/i, /sanction/i,
    ]) {
      expect(clientCopy).not.toMatch(internal);
    }
  });
});

/* ── the servers use it ───────────────────────────────────────────────── */

describe('both request writers go through the one contract', () => {
  const cases = read('supabase/functions/aml-cases/index.ts');
  const portal = read('supabase/functions/aml-client-portal/index.ts');

  it('the generic request path sanitises code and target', () => {
    const block = cases.slice(
      cases.indexOf("case 'create_client_request'"),
      cases.indexOf("case 'resolve_client_request'"));
    expect(block).toContain('sanitiseActionCode(r.action_code)');
    expect(block).toContain('sanitiseActionTarget(r.action_target)');
    // The hand-rolled sanitiser this replaced dropped `section_code` entirely,
    // so a questionnaire request reached the client with nowhere to go.
    expect(block).not.toMatch(/target_step:\s*typeof/);
  });

  it('the submission-review path no longer trusts a raw section code', () => {
    // It used to be `String(body.section_code)` — an unvalidated routing value
    // is a routing value the caller chooses.
    expect(cases).not.toMatch(/actionTarget\.section_code\s*=\s*String\(/);
  });

  it('the portal projects through the same sanitiser', () => {
    expect(portal).toContain('sanitiseActionCode(r.action_code)');
    expect(portal).toContain('sanitiseActionTarget(r.action_target)');
  });

  it('no edge function restates the vocabulary as its own literal list', () => {
    for (const [name, src] of Object.entries({ cases, portal })) {
      const literalLists = [...src.matchAll(
        /\[\s*'complete_identity_verification'[\s\S]{0,240}?'review_and_submit'\s*,?\s*\]/g)];
      expect(literalLists, name).toHaveLength(0);
    }
  });
});

/* ── the navigation defect ────────────────────────────────────────────── */

describe('Passport controls navigate, they do not point at dead anchors', () => {
  const controls = read('src/components/aml/passport/PassportControls.tsx');
  const workspace = read('src/components/aml/passport/design/PassportWorkspace.tsx');

  it('no control is an anchor to an element the Passport page does not contain', () => {
    // `#compliance-sharing` names a section of the CASE workspace. On the
    // dedicated Passport surface both buttons did nothing at all.
    //
    // Comments are stripped first: the file's own comment names the old
    // anchor in order to record why it went, and a prose mention is not a
    // live link. Everything after the strip is code.
    const code = controls
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')   // {/* JSX comment */}
      .replace(/\/\*[\s\S]*?\*\//g, '')             // /* block */
      .replace(/^\s*\/\/.*$/gm, '');                // // line
    expect(code).not.toContain('#compliance-sharing');
    expect(code).not.toMatch(/href\s*=/);
    expect(code).not.toContain('asChild');
  });

  it('sharing and requesting are callbacks the surface supplies', () => {
    expect(controls).toContain('onShare');
    expect(controls).toContain('onRequestClientInformation');
    expect(controls).toMatch(/onClick=\{onShare\}/);
  });

  it('Share Passport selects the Partner Access page that already exists', () => {
    // Not a second share modal — the page holding the readiness cards.
    expect(workspace).toMatch(/onShare=\{\(\) => setPageId\("partners"\)\}/);
  });

  it('the workspace renders without a Router — routing belongs to the page', () => {
    expect(workspace).not.toContain('useNavigate');
    expect(read('src/pages/aml/AmlPassports.tsx')).toContain('onOpenCase');
  });
});

/* ── outstanding items ────────────────────────────────────────────────── */

function view(over: Partial<PassportView> = {}): PassportView {
  return {
    audience: 'command',
    header: { state: { code: 'building', label: 'Building', tone: 'info' } },
    verification: { parties: [] },
    documents: [],
    open_requests: [],
    ...over,
  } as unknown as PassportView;
}

describe('outstanding items are derived and client-safe', () => {
  it('asks for identity verification when nothing is recorded', () => {
    const items = deriveOutstandingItems(view());
    const idv = items.find((i) => i.key === 'verification_incomplete')!;
    expect(idv.owner).toBe('client');
    expect(idv.request!.action).toBe('complete_identity_verification');
    expect(idv.request!.target!.target_step).toBe('identity_verification');
  });

  it('does not ask again for something already asked', () => {
    const items = deriveOutstandingItems(view({
      open_requests: [{ id: 'r1', kind: 'additional_info', subject: 'x', status: 'open', created_at: '' }],
    } as unknown as Partial<PassportView>));
    const waiting = items.find((i) => i.key === 'requests_awaiting_client')!;
    expect(waiting.owner).toBe('client');
    expect(waiting.request).toBeUndefined();
  });

  it('puts a client response on STAFF, never back on the client', () => {
    const items = deriveOutstandingItems(view({
      open_requests: [{ id: 'r1', kind: 'additional_info', subject: 'x', status: 'responded', created_at: '' }],
    } as unknown as Partial<PassportView>));
    expect(items.find((i) => i.key === 'requests_awaiting_staff')!.owner).toBe('staff');
  });

  it('never sends a document row id as a requirement id', () => {
    const items = deriveOutstandingItems(view({
      documents: [{ id: 'doc-1', label: 'Passport', required: true, status: 'requested',
        uploaded_at: null, version_number: null }],
    } as unknown as Partial<PassportView>));
    const doc = items.find((i) => i.key === 'document_doc-1')!;
    expect(doc.request!.target!.requirement_id).toBeUndefined();
    expect(doc.request!.target!.target_step).toBe('documents');
  });

  it('every client message is plain English with no internal reason', () => {
    const items = deriveOutstandingItems(view({
      documents: [{ id: 'd', label: 'Proof of address', required: true, status: 'requested',
        uploaded_at: null, version_number: null }],
    } as unknown as Partial<PassportView>));
    const messages = items.filter((i) => i.request).map((i) => i.request!.message).join(' | ');
    for (const internal of [
      /risk/i, /CDD/i, /screening/i, /PEP/i, /EDD/i, /suspicio/i, /SMR/i, /MLRO/i,
      /escalat/i, /medium-risk/i,
    ]) {
      expect(messages).not.toMatch(internal);
    }
  });

  it('counts whose move it is', () => {
    const items = deriveOutstandingItems(view({
      documents: [{ id: 'd', label: 'Payslip', required: true, status: 'pending_review',
        uploaded_at: null, version_number: null }],
    } as unknown as Partial<PassportView>));
    const s = summariseOutstanding(items);
    expect(s.awaitingStaff).toBeGreaterThan(0);
    expect(s.total).toBe(items.length);
  });

  it('never claims blanket compliance', () => {
    const current = view({
      header: { state: { code: 'current', label: 'Current', tone: 'ok' } },
    } as unknown as Partial<PassportView>);
    const h = outstandingHeadline(current, summariseOutstanding(deriveOutstandingItems(current)));
    expect(h.title).toBe('Passport current');
    const all = `${h.title} ${h.detail}`;
    for (const forbidden of [/AML compliant/i, /fully approved/i, /guarantees/i]) {
      expect(all).not.toMatch(forbidden);
    }
  });

  it('is a derivation, never a stored status', () => {
    const src = read('src/lib/aml/passport/outstandingItems.pure.ts');
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|fetch\(|invoke\(/);
  });
});

/* ── the composer ─────────────────────────────────────────────────────── */

describe('the request composer uses the canonical operation only', () => {
  const dialog = read('src/components/aml/passport/design/RequestClientInformationDialog.tsx');

  it('creates requests through `create_client_request`, not a new table', () => {
    expect(dialog).toContain('amlCasesApi.createClientRequest');
    for (const invented of [
      'passport_requests', 'mlro_requests', 'client_compliance_actions',
    ]) {
      expect(dialog).not.toContain(invented);
    }
  });

  it('sends an action code from the shared contract', () => {
    expect(dialog).toContain('clientRequestContract.pure');
    expect(dialog).toContain('kindForAction(action)');
  });

  it('cannot send a free-text route', () => {
    expect(dialog).not.toMatch(/action_url|href:|window\.location/);
  });
});
