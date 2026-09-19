import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/client-portal-comms/index.ts'),
  'utf8',
);

describe('client portal GHL channel security contract', () => {
  it('restricts both conversations and messages to client-visible channels', () => {
    expect(functionSource).toContain(
      "const CLIENT_VISIBLE_GHL_CHANNELS = ['sms', 'whatsapp', 'email'];",
    );

    const allowlistFilters = functionSource.match(
      /\.in\('channel_type', CLIENT_VISIBLE_GHL_CHANNELS\)/g,
    );
    expect(allowlistFilters).toHaveLength(2);
  });
});
