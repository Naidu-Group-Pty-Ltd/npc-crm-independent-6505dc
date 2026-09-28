import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builderConversationHref, builderMessagePopup } from '../builderMessagePopups.pure';

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
