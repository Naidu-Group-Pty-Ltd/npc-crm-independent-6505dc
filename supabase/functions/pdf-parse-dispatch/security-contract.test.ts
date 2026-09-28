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

// The first form of this scoped a human's read and let the service role read
// any job. The owner filter is unconditional now: a service-role caller has to
// name the owner, and no owner is a refusal. The contract follows the stricter
// rule.
Deno.test('PDF job status is scoped to its authenticated owner', () => {
  const statusStart = source.indexOf("if (operation === 'status') {");
  const status = source.slice(statusStart, source.indexOf("if (operation === 'download') {", statusStart));
  assert(statusStart > -1);
  assertStringIncludes(source, "const userId = auth.userId && auth.userId !== 'service_role' ? auth.userId : (body.user_id ?? null);");
  assertStringIncludes(status, "if (!userId) return createForbiddenResponse('job owner required', cors);");
  assertStringIncludes(status, ".eq('user_id', userId)");
  assert(status.indexOf("createForbiddenResponse('job owner required'") < status.indexOf(".from('pdf_import_jobs')"));
});
