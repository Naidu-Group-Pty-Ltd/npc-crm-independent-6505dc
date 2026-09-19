import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What the Client Portal may learn about a document, and what it may open.
 *
 * The visible fix here was a UI one — the Documents step never read the
 * document list, so uploads vanished from the page. Making them visible adds
 * exactly one new server capability: opening a file the customer has already
 * sent us. That capability is the part worth guarding, because a document id
 * is a value clients legitimately hold for their own files and can guess for
 * anybody else's.
 *
 * Source-text assertions, in the shape `amlPortalContracts.test.ts` already
 * uses: these are boundary properties that must not quietly regress, and the
 * cheapest place to catch a regression is where the boundary is written.
 */
const repo = process.cwd();
const portal = readFileSync(join(repo, 'supabase/functions/aml-client-portal/index.ts'), 'utf8');
const portalApi = readFileSync(join(repo, 'src/lib/aml/amlPortalApi.ts'), 'utf8');
const step = readFileSync(join(repo, 'src/components/portal/DocumentsStep.tsx'), 'utf8');

/** The `get_document_url` branch, to the start of the next op. */
const documentUrlBranch = portal.slice(
  portal.indexOf("case 'get_document_url'"),
  portal.indexOf("case 'list_client_requests'"),
);
/** The `list_documents` branch. */
const listBranch = portal.slice(
  portal.indexOf("case 'list_documents'"),
  portal.indexOf("case 'get_document_url'"),
);

describe('list_documents stays portal-safe', () => {
  it('returns the projection the client contract declares, and no more', () => {
    // The columns are named explicitly rather than `select('*')` — the staff
    // function selects `*`, and copying that here would ship `storage_path`,
    // `checksum`, `uploaded_by` and the reviewer to the browser. `metadata`
    // is selected ONLY to filter out staff submission records server-side,
    // and is stripped from every row before the response.
    expect(listBranch).toContain(
      "'id, requirement_id, filename, display_name, mime_type, size_bytes, status, uploaded_at, rejection_reason, metadata, requirement:requirement_id (code, label)'");
    expect(listBranch).not.toContain("select('*')");
    // `display_name` and the requirement's code/label are client-facing by
    // construction: the client chose the one and was shown the other when
    // they were asked for the document.
    expect(listBranch).toContain("display_name");
    expect(listBranch).toContain("requirement:requirement_id (code, label)");
  });

  it('never exposes a storage path, bucket or checksum', () => {
    for (const internal of ['storage_path', 'checksum', 'uploaded_by', 'reviewed_by']) {
      expect(listBranch).not.toContain(internal);
    }
  });

  it('staff submission records are filtered out and metadata never ships', () => {
    // The record carries screening states and risk readings — staff-only
    // (SUBMISSION_RECORD.md). Filtered in code, because a PostgREST `.neq()`
    // on `metadata->>kind` also drops every row where the key is absent
    // (`null <> 'x'` is null in SQL) — which is all of the client's files.
    expect(listBranch).toContain(
      '.filter((d: any) => d?.metadata?.kind !== SUBMISSION_RECORD_DOCUMENT_KIND)');
    // …and the column selected for that decision is stripped from every row
    // before the response: the raw `data` is never what gets returned.
    expect(listBranch).toContain('.map(({ metadata: _metadata, ...d }: any) => d)');
    expect(listBranch).toContain('jsonResponse({ documents })');
    expect(listBranch).not.toContain('jsonResponse({ documents: data');
  });

  it('is scoped to a case the caller owns and hides deleted rows', () => {
    expect(listBranch).toContain('resolveCase(body.case_id)');
    expect(listBranch).toContain("eq('case_id', c.id)");
    expect(listBranch).toContain("neq('status', 'deleted')");
  });

  it('the declared client type carries nothing the projection does not', () => {
    const contract = portalApi.slice(
      portalApi.indexOf('export interface AmlPortalDocument'),
      portalApi.indexOf('export const amlPortalApi'));
    for (const internal of ['storage_path', 'bucket', 'checksum', 'uploaded_by', 'reviewed_by']) {
      expect(contract).not.toContain(internal);
    }
  });
});

describe('get_document_url proves ownership twice', () => {
  it('exists', () => {
    expect(documentUrlBranch.length).toBeGreaterThan(0);
  });

  it('resolves the case through the portal session', () => {
    // `resolveCase` is what ties `case_id` to the authenticated client.
    expect(documentUrlBranch).toContain('resolveCase(body.case_id)');
    expect(documentUrlBranch).toMatch(/if \(!c\) return jsonResponse\(\{ error: 'No case' \}, 404\)/);
  });

  it('requires the document to belong to THAT case', () => {
    /*
     * The load-bearing line. Without it a document id alone would open any
     * document in the system — and a client legitimately holds ids for their
     * own files, so the id space is not a secret.
     */
    expect(documentUrlBranch).toContain("eq('case_id', c.id)");
    expect(documentUrlBranch).toContain("eq('id', String(body.document_id))");
    expect(documentUrlBranch).toContain("neq('status', 'deleted')");
  });

  it('answers the same way for missing, deleted and someone else’s', () => {
    // Distinguishing them would confirm that an id exists on another case.
    const notFound = documentUrlBranch.match(/jsonResponse\(\{ error: 'Document not found' \}, 404\)/g);
    expect(notFound).toHaveLength(1);
  });

  it('takes the bucket and the path from the server, never the request', () => {
    // A caller-supplied path is directory traversal; a caller-supplied bucket
    // turns this into a general-purpose read of the project's storage.
    expect(documentUrlBranch).toContain("from('aml-documents')");
    expect(documentUrlBranch).toContain('createSignedUrl(doc.storage_path');
    expect(documentUrlBranch).not.toMatch(/body\.(storage_path|bucket|path)/);
  });

  it('signs for seconds, not hours', () => {
    const ttl = documentUrlBranch.match(/createSignedUrl\(doc\.storage_path,\s*(\d+)/)?.[1];
    expect(Number(ttl)).toBeGreaterThan(0);
    expect(Number(ttl)).toBeLessThanOrEqual(300);
  });

  it('serves as an attachment unless the type is one a browser may render', () => {
    /*
     * `request_upload_url` does not constrain the stored content type, and the
     * storage origin is the same host as this API — so an inline-served HTML
     * upload would execute there. Every document was therefore served as an
     * attachment, which is safe and is also why pressing "View" on a PDF
     * downloaded it instead of showing it.
     *
     * The type is now checked rather than assumed, and the fallback direction
     * is unchanged: anything not on the list is still an attachment.
     */
    expect(documentUrlBranch).toContain(
      "createSignedUrl(doc.storage_path, 120, inline ? {} : { download: doc.filename })");
    expect(documentUrlBranch).toContain('INLINE_VIEWABLE_MIME_TYPES.has(servedType)');
  });

  it('decides the disposition on what storage will SERVE, not on the row', () => {
    /*
     * The content type was set on the client's PUT; `mime_type` was sent
     * afterwards by `confirm_upload`. Same client, different routes, so they
     * can disagree — and only the served value decides how a browser treats
     * the response.
     */
    expect(documentUrlBranch).toContain("from('aml-documents')\n          .list(objectDir");
    expect(documentUrlBranch).toContain('?.metadata?.mimetype');
    // Never the request, and never the row's own declaration.
    expect(documentUrlBranch).not.toMatch(/INLINE_VIEWABLE_MIME_TYPES\.has\(\s*(doc\.mime_type|body\.)/);
  });

  it('admits nothing scriptable to the inline list', () => {
    const list = portal.slice(
      portal.indexOf('const INLINE_VIEWABLE_MIME_TYPES'),
      portal.indexOf('function jsonResponse'));
    for (const safe of ['application/pdf', 'image/jpeg', 'image/png']) {
      expect(list).toContain(`'${safe}'`);
    }
    /*
     * `image/svg+xml` is the trap: it satisfies the upload control's `image/*`
     * and it is a document that can carry a script element, so serving one
     * inline would execute it on the storage origin — the same host as this
     * API. It is an image everywhere except here.
     */
    for (const scriptable of [
      'image/svg+xml', 'text/html', 'text/xml', 'application/xhtml+xml',
      'application/octet-stream', 'text/javascript',
    ]) {
      expect(list).not.toContain(`'${scriptable}'`);
    }
  });

  it('treats an unreadable or unknown type as an attachment', () => {
    // The failure direction is a download, never an inline render.
    expect(documentUrlBranch).toMatch(/metadata\?\.mimetype \?\? ''/);
  });

  it('never echoes the storage error, which carries the path', () => {
    expect(documentUrlBranch).toMatch(/console\.error\('\[aml-client-portal\] document url signing failed'\)/);
    expect(documentUrlBranch).not.toMatch(/signErr\.message|String\(signErr/);
  });
});

describe('the browser holds no route to a document except through the server', () => {
  it('never builds a storage URL itself', () => {
    for (const source of [step, portalApi]) {
      expect(source).not.toContain('storage/v1/object');
      expect(source).not.toContain('aml-documents');
      expect(source).not.toContain('createSignedUrl');
    }
  });

  it('sends both the case and the document id when opening one', () => {
    expect(portalApi).toMatch(/documentUrl: \(case_id: string, document_id: string\)/);
    expect(step).toContain('amlPortalApi.documentUrl(caseId, doc.id)');
  });

  it('keeps the signed URL out of storage and out of the log', () => {
    // It is a credential with a deadline: fetched at the click, used, dropped.
    expect(step).not.toMatch(/(localStorage|sessionStorage)\.setItem/);
    expect(step).not.toMatch(/console\.(log|info|warn|error)\([^)]*url/i);
    expect(step).not.toMatch(/setState[^)]*url|useState<string[^>]*>\(\s*\)\s*;?\s*\/\/\s*url/i);
  });
});

describe('the upload path is unchanged', () => {
  it('still goes signed-URL then server-side confirm', () => {
    expect(portal).toContain("case 'request_upload_url'");
    expect(portal).toContain("case 'confirm_upload'");
    expect(portal).toContain('createSignedUploadUrl(key)');
    // Confirm still verifies the object landed and that the path is inside the
    // case's own prefix.
    expect(portal).toContain("pathParts[0] !== c.id");
  });

  it('still coerces a foreign requirement id to null rather than trusting it', () => {
    const confirm = portal.slice(
      portal.indexOf("case 'confirm_upload'"), portal.indexOf("case 'list_documents'"));
    expect(confirm).toContain('if (!rr || rr.case_id !== c.id) reqId = null;');
  });

  it('does not delete or supersede prior rows — no history model was invented', () => {
    const confirm = portal.slice(
      portal.indexOf("case 'confirm_upload'"), portal.indexOf("case 'list_documents'"));
    expect(confirm).not.toMatch(/status: 'superseded'/);
    expect(confirm).not.toMatch(/\.delete\(\)/);
  });
});
