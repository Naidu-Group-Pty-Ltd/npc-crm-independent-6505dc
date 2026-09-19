/**
 * Audit item 48 — the Finance Messages thread labelled every incoming message
 * `ARVINRAJ2829@GMAIL.COM`, for the finance partner and the client alike, and
 * drew both in the same bubble. The reporter annotated the screenshot with "F"
 * and "C" to say which was which, because their finance portal and client
 * portal share an address.
 *
 * Measured over `finance_portal_messages` on 2026-08-31: 26 staff messages,
 * none of them an email; 5 client messages and 5 partner messages, all ten an
 * email. The name comes from `finance-portal-messages`, which had nowhere
 * better to look — neither `finance_portal_users` nor `client_portal_users`
 * carries a name column.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SENDER_BUBBLE_CLASS,
  SENDER_ROLE_LABEL,
  bubbleClassFor,
  looksLikeEmailAddress,
  senderIdentity,
  senderLabel,
} from '../messageSender.pure';

describe('an address is never a name', () => {
  it.each([
    'arvinraj2829@gmail.com',
    'ARVINRAJ2829@GMAIL.COM',
    ' lavan.smi@gmail.com ',
  ])('%s is shown as the role alone', (stored) => {
    expect(senderIdentity('client', stored)).toEqual({ role: 'Client', name: null });
    expect(senderLabel('partner', stored)).toBe('Finance Partner');
  });

  it('keeps a real name', () => {
    expect(senderIdentity('staff', 'Arvin')).toEqual({ role: 'Command Centre', name: 'Arvin' });
    expect(senderLabel('partner', 'Graham Turnbull')).toBe('Finance Partner · Graham Turnbull');
  });

  it('drops a name that only repeats the role', () => {
    expect(senderIdentity('client', 'Client')).toEqual({ role: 'Client', name: null });
    expect(senderIdentity('partner', 'finance partner')).toEqual({ role: 'Finance Partner', name: null });
  });

  it('never renders nothing', () => {
    // A missing or unrecognised sender type still has to say something.
    expect(senderLabel('client', null)).toBe('Client');
    expect(senderLabel(null, null)).toBe('Participant');
    expect(senderLabel('something_new', null)).toBe('Participant');
  });
});

describe('the role is what distinguishes the parties', () => {
  it('is present on every message, name or not', () => {
    for (const type of ['partner', 'client', 'staff'] as const) {
      expect(senderIdentity(type, null).role).toBe(SENDER_ROLE_LABEL[type]);
      expect(senderLabel(type, null).length).toBeGreaterThan(0);
    }
  });

  it('uses no database vocabulary', () => {
    for (const label of Object.values(SENDER_ROLE_LABEL)) {
      expect(label).not.toMatch(/_/);
      expect(label).not.toMatch(/^[a-z]/);
    }
  });
});

describe('the bubble', () => {
  it('gives the client and the finance partner different treatments', () => {
    expect(bubbleClassFor('client')).not.toBe(bubbleClassFor('partner'));
    expect(bubbleClassFor('staff')).not.toBe(bubbleClassFor('partner'));
  });

  it('falls back rather than rendering an unstyled bubble', () => {
    expect(bubbleClassFor(null)).toBe(SENDER_BUBBLE_CLASS.partner);
    expect(bubbleClassFor('something_new')).toBe(SENDER_BUBBLE_CLASS.partner);
  });

  it('avoids the tokens that collapse to one colour in dark mode', () => {
    // `--primary`, `--accent`, `--warning` and `--brand` are all `43 74% 49%`
    // under `.dark`. A palette built from them is unreadable on the theme this
    // defect was reported on.
    for (const cls of Object.values(SENDER_BUBBLE_CLASS)) {
      expect(cls).not.toMatch(/\b(bg|border|text)-(primary|accent|warning|brand)\b/);
    }
  });

  it('uses semantic tokens only', () => {
    for (const cls of Object.values(SENDER_BUBBLE_CLASS)) {
      expect(cls).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(cls).not.toMatch(/\b(bg|border|text)-(slate|gray|zinc|neutral|stone|red|blue|green|amber|yellow|purple)-\d/);
    }
  });
});

describe('the thread renders it', () => {
  const root = join(__dirname, '..', '..', '..', '..');
  const thread = readFileSync(
    join(root, 'src', 'components', 'finance-portal', 'FinanceMessagesThread.tsx'),
    'utf8',
  );
  const server = readFileSync(
    join(root, 'supabase', 'functions', 'finance-portal-messages', 'index.ts'),
    'utf8',
  );

  it('no longer prints the stored name raw', () => {
    expect(thread).not.toMatch(/\{m\.sender_name \|\|/);
    expect(thread).toMatch(/senderIdentity\(m\.sender_type, m\.sender_name\)/);
  });

  it('styles the bubble by who is speaking', () => {
    expect(thread).toMatch(/bubbleClassFor\(m\.sender_type\)/);
  });

  it('stops the server storing an address as a name', () => {
    // The browser repairs the ten messages already stored; this stops new ones
    // being written that way.
    expect(server).not.toMatch(/name: portalUser\.email \}/);
    expect(server).not.toMatch(/name: portalUser\.email \|\| 'Client'/);
    expect(server).toMatch(/from\('finance_agent_contacts'\)/);
    expect(server).toMatch(/partnerName \?\? 'Finance Partner'/);
    expect(server).toMatch(/clientName \?\? 'Client'/);
  });

  it('never falls back to the address when a lookup fails', () => {
    expect(server).toMatch(/if \(candidate && !candidate\.includes\('@'\)\) partnerName = candidate;/);
    expect(server).toMatch(/if \(candidate && !candidate\.includes\('@'\)\) clientName = candidate;/);
  });
});
