import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import '../agent-tools-registry.ts';
import { getTool } from '../agent-tools.ts';

Deno.test('scrape_property_listing queues once without polling in-process', async () => {
  const invocations: Array<{ name: string; body: unknown }> = [];
  const tool = getTool('scrape_property_listing');

  if (!tool) throw new Error('scrape_property_listing tool was not registered');

  const result = await tool.execute(
    { url: 'https://example.com/property/1' },
    {
      userId: 'user-1',
      conversationId: 'conversation-1',
      supabase: {
        functions: {
          invoke: async (name: string, options: { body: unknown }) => {
            invocations.push({ name, body: options.body });
            return {
              data: { success: true, jobId: 'job-1', status: 'queued' },
              error: null,
            };
          },
        },
      },
    },
  );

  assertEquals(invocations, [
    {
      name: 'scrape-property-listing',
      body: { url: 'https://example.com/property/1' },
    },
  ]);
  assertEquals(result, {
    jobId: 'job-1',
    status: 'queued',
    message: 'The property scrape was queued and will continue asynchronously.',
  });
});
