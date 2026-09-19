/**
 * The rules a Finance Portal recipient is judged by.
 *
 * These were four inline conditions inside `share-report-with-finance`, and the
 * menus that chose a recipient knew none of them: the Command Centre named the
 * first `finance_agent_contacts` row and, since production flags no contact as
 * default, "first" meant insertion order. That partner has no portal account,
 * so the rule tested first here is the one every one of those sends died on.
 */
import { describe, expect, it } from 'vitest';

import {
  canViewDocuments,
  evaluateRecipient,
  recipientBlockMessage,
  recipientBlockStatus,
  type RecipientInputs,
} from '../../supabase/functions/_shared/financeReportRecipients.pure';

const contact = { id: 'contact-1', is_active: true };
const portalUser = { id: 'portal-1', is_active: true, revoked_at: null, global_permissions: null };
const assignment = { id: 'assignment-1', permissions: null };

const inputs = (overrides: Partial<RecipientInputs> = {}): RecipientInputs => ({
  contact,
  portalUser,
  assignment,
  ...overrides,
});

describe('evaluateRecipient', () => {
  it('accepts an active contact with a live portal account assigned to the client', () => {
    expect(evaluateRecipient(inputs())).toEqual({
      eligible: true,
      reason: null,
      portalUserId: 'portal-1',
    });
  });

  it('refuses an inactive contact', () => {
    const verdict = evaluateRecipient(inputs({ contact: { id: 'contact-1', is_active: false } }));
    expect(verdict).toMatchObject({ eligible: false, reason: 'contact_inactive' });
  });

  /** The production case: a partner in Settings with no Finance Portal login. */
  it('refuses a contact with no portal account, and reports no portal user', () => {
    const verdict = evaluateRecipient(inputs({ portalUser: null, assignment: null }));
    expect(verdict).toEqual({ eligible: false, reason: 'no_portal_account', portalUserId: null });
  });

  it.each([
    ['deactivated', { ...portalUser, is_active: false }],
    ['revoked', { ...portalUser, revoked_at: '2026-01-01T00:00:00Z' }],
  ])('refuses a %s portal account', (_label, user) => {
    expect(evaluateRecipient(inputs({ portalUser: user }))).toMatchObject({
      eligible: false,
      reason: 'portal_account_revoked',
    });
  });

  it('refuses a partner who is not assigned to this client', () => {
    expect(evaluateRecipient(inputs({ assignment: null }))).toMatchObject({
      eligible: false,
      reason: 'not_assigned_to_client',
    });
  });

  it('refuses a partner whose document permission is withheld on both sides', () => {
    const verdict = evaluateRecipient(
      inputs({
        portalUser: { ...portalUser, global_permissions: { documents: { view: false } } },
        assignment: { id: 'assignment-1', permissions: { documents: { view: false } } },
      }),
    );
    expect(verdict).toMatchObject({ eligible: false, reason: 'documents_not_permitted' });
  });

  /**
   * Order matters for what a person is told to do next: sending someone to the
   * assignment screen for a partner who has no account to assign to is a dead
   * end, so the missing account is reported first.
   */
  it('reports the missing account before the missing assignment', () => {
    expect(evaluateRecipient({ contact, portalUser: null, assignment: null }).reason).toBe(
      'no_portal_account',
    );
  });
});

describe('canViewDocuments', () => {
  it('is default-allow when neither side names documents', () => {
    // Partners assigned before the permission matrix existed carry no
    // `documents` key and have always been able to read documents in the portal.
    expect(canViewDocuments(null, null)).toBe(true);
    expect(canViewDocuments({}, {})).toBe(true);
  });

  it.each([
    ['the global baseline', { documents: { view: true } }, { documents: { view: false } }],
    ['the per-client matrix', { documents: { view: false } }, { documents: { view: true } }],
  ])('is granted by %s alone', (_label, global, perClient) => {
    expect(canViewDocuments(global, perClient)).toBe(true);
  });

  it('is denied only when a stated permission withholds it', () => {
    expect(canViewDocuments({ documents: { view: false } }, {})).toBe(false);
  });
});

describe('what a refusal says and answers with', () => {
  it('names the fix rather than restating the rule', () => {
    expect(recipientBlockMessage('not_assigned_to_client')).toContain('not assigned to this client');
    expect(recipientBlockMessage('no_portal_account')).toContain('does not have a Finance Portal account');
  });

  /** A state of the world (422) is not an authorisation failure (403). */
  it('separates a missing account from a refusal', () => {
    expect(recipientBlockStatus('no_portal_account')).toBe(422);
    expect(recipientBlockStatus('portal_account_revoked')).toBe(422);
    expect(recipientBlockStatus('not_assigned_to_client')).toBe(403);
    expect(recipientBlockStatus('contact_inactive')).toBe(403);
    expect(recipientBlockStatus('documents_not_permitted')).toBe(403);
  });
});
