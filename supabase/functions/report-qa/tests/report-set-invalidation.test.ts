import { assert, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const source = await Deno.readTextFile(new URL('../index.ts', import.meta.url));

Deno.test('updating a conversation report set invalidates all derived RAG data', () => {
  const updateHandler = source.slice(
    source.indexOf('if (action === "update-conversation")'),
    source.indexOf('// Handle summarize-conversation'),
  );

  assertStringIncludes(updateHandler, 'reportNames !== undefined || reportContents !== undefined');
  assertStringIncludes(updateHandler, '.from("document_chunks")');
  assertStringIncludes(updateHandler, '.delete()');
  assertStringIncludes(updateHandler, '.eq("conversation_id", conversationId)');
  assertStringIncludes(updateHandler, 'updateData.structured_report = null');

  assert(
    updateHandler.indexOf('.delete()') < updateHandler.indexOf('.update(updateData)'),
    'stale chunks must be deleted before the changed report set is published',
  );
});
