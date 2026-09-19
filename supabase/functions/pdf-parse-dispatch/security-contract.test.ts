import { assert, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));

Deno.test('PDF dispatch rejects caller-controlled source URLs', () => {
  assertStringIncludes(source, "if (directUrl) return { error: 'source_url is not supported; upload the PDF first' }");
  assert(!source.includes('if (directUrl) return { url: directUrl }'));
  assert(!source.includes("source = { kind: 'url', url: body.source_url as string }"));
});

Deno.test('PDF dispatch only signs allowlisted storage locations', () => {
  assertStringIncludes(source, 'const isTemplateSource = bucket === SOURCE_BUCKET;');
  assertStringIncludes(source, "storagePath.startsWith('pdf-import-sources/')");
  assertStringIncludes(source, "return { error: 'source bucket or path is not allowed' }");
});

Deno.test('PDF job status is scoped to its authenticated owner', () => {
  assertStringIncludes(source, "if (auth.userId !== 'service_role') query = query.eq('user_id', userId);");
});
