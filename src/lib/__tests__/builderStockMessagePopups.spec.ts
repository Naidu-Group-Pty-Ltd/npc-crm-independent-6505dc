import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILDER_MESSAGE_BACKGROUND_POLL_MS, BUILDER_MESSAGE_POPUP_POLL_MS, builderAlertKey, builderCatchUpKey,
  builderConversationHref, builderConversationIdFromPath, builderConversationPopup, builderMessagePollingRefused,
  builderMessagePopup, groupBuilderMessages, isViewingBuilderConversation,
} from '../builderMessagePopups.pure';

const base = {
  message_id: 'm1', conversation_id: 'conv-1', builder_name: 'Bob The Builder Pty Ltd', sender_display_name: 'Bobby',
  lot_number: '1629', address: '12 Example Street', received_at: '2026-09-26T12:00:00Z',
};

describe('the "new message from <builder>" popup', () => {
  it('names the builder company, then who wrote it and the property', () => {
    expect(builderMessagePopup(base)).toEqual({
      id: 'm1',
      title: 'New message from Bob The Builder Pty Ltd',
      description: 'Bobby · Lot 1629, 12 Example Street',
      href: '/admin/builder-portal/messaging/conv-1',
    });
  });

  it('says something true when a part is missing', () => {
    expect(builderMessagePopup({ ...base, builder_name: null }).title).toBe('New message from a builder');
    expect(builderMessagePopup({ ...base, address: null }).description).toBe('Bobby · Lot 1629');
    expect(builderMessagePopup({ ...base, sender_display_name: '', lot_number: null, address: null }).description)
      .toBe('Open the conversation to read it.');
  });

  it('opens the conversation on the Builder Portal page, which the router serves', () => {
    expect(builderConversationHref('a/b')).toBe('/admin/builder-portal/messaging/a%2Fb');
    const app = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');
    expect(app).toContain('path="admin/builder-portal/:tab/:conversationId"');
  });

  it('is mounted on both layouts, desktop and mobile', () => {
    const layout = readFileSync(join(__dirname, '..', '..', 'components', 'layout', 'DashboardLayout.tsx'), 'utf8');
    expect(layout.match(/<BuilderMessagePopups \/>/g)?.length).toBe(2);
  });
});

describe('one conversation, told once', () => {
  const at = (id: string, conversation: string, receivedAt: string) => ({
    ...base, message_id: id, conversation_id: conversation, received_at: receivedAt,
  });

  it('groups what one check found by conversation, oldest first, in the order they last arrived', () => {
    const groups = groupBuilderMessages([
      at('m2', 'conv-1', '2026-09-30T01:00:02Z'), at('m3', 'conv-2', '2026-09-30T01:00:01Z'),
      at('m1', 'conv-1', '2026-09-30T01:00:00Z'),
    ]);
    expect(groups.map((g) => g.conversationId)).toEqual(['conv-2', 'conv-1']);
    expect(groups[1].messages.map((m) => m.message_id)).toEqual(['m1', 'm2']);
    expect(groups[1].latest.message_id).toBe('m2');
  });

  it('counts a conversation’s messages in one popup, keyed by the conversation', () => {
    const popup = builderConversationPopup([at('m1', 'conv-1', 'a'), at('m2', 'conv-1', 'b')]);
    expect(popup).toMatchObject({
      id: 'conv-1', title: '2 new messages from Bob The Builder Pty Ltd',
      description: 'Bobby · Lot 1629, 12 Example Street', href: '/admin/builder-portal/messaging/conv-1',
    });
    expect(builderConversationPopup([at('m1', 'conv-1', 'a')]).title).toBe('New message from Bob The Builder Pty Ltd');
  });

  it('knows the conversation page, and nothing else, as the conversation being read', () => {
    expect(builderConversationIdFromPath('/admin/builder-portal/messaging/conv-1')).toBe('conv-1');
    expect(builderConversationIdFromPath('/admin/builder-portal/messaging/a%2Fb/')).toBe('a/b');
    expect(builderConversationIdFromPath('/admin/builder-portal/messaging')).toBeNull();
    expect(isViewingBuilderConversation('/admin/builder-portal/messaging/conv-1', 'conv-1')).toBe(true);
    expect(isViewingBuilderConversation('/admin/builder-portal/messaging/conv-2', 'conv-1')).toBe(false);
    expect(isViewingBuilderConversation('/admin/listings', 'conv-1')).toBe(false);
  });

  it('keeps its ledger keys apart from a team thread’s, and the two kinds apart from each other', () => {
    expect(builderAlertKey('conv-1')).not.toBe('conv-1');
    expect(builderAlertKey('conv-1')).not.toBe(builderCatchUpKey('conv-1'));
  });

  it('asks more slowly while nobody is looking, and still within a minute', () => {
    expect(BUILDER_MESSAGE_BACKGROUND_POLL_MS).toBeGreaterThan(BUILDER_MESSAGE_POPUP_POLL_MS);
    expect(BUILDER_MESSAGE_BACKGROUND_POLL_MS).toBeLessThanOrEqual(60_000);
  });

  it('stops only on a refusal', () => {
    for (const status of [401, 403]) expect(builderMessagePollingRefused(status)).toBe(true);
    for (const status of [undefined, 404, 500, 503]) expect(builderMessagePollingRefused(status)).toBe(false);
  });
});
