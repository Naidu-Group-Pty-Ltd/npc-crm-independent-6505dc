/**
 * Contract tests for internal-message attachments.
 *
 * The reported symptom was "attachments aren't working". The code was correct
 * and merged; PRODUCTION WAS RUNNING A STALE COPY. The deployed
 * `internal-messaging` function (v10) contained zero occurrences of
 * `attachment`, `ATTACHMENT_BUCKET`, `attachment_upload_url` or
 * `screenAttachments`, while the same file on main had 22. A deploy batch went
 * out that afternoon and did not include this function.
 *
 * Attachments live entirely in that function — the browser holds no table or
 * bucket privileges and cannot mint its own storage tickets — so a stale
 * deployment does not degrade the feature, it removes it: both actions fall
 * through to `unknown action` and every upload fails at the first step. The
 * bucket had 0 objects and 0 messages carried an attachment.
 *
 * These tests cannot see production. What they CAN do is pin the client and the
 * function to the same action names, so a rename can never silently reintroduce
 * the same "unknown action" dead end, and keep the URL fallback usable.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const client = read('src/lib/internalMessageAttachments.ts');
const fn = read('supabase/functions/internal-messaging/index.ts');
const transport = read('supabase/functions/internal-message-attachments/index.ts');

describe('client and function agree on the attachment protocol', () => {
  it('keeps the legacy main-function actions available during transition', () => {
    for (const action of [
      'attachment_upload_url',
      'attachment_upload_direct',
      'attachment_download_url',
    ]) {
      expect(fn, `function does not implement ${action}`).toContain(action);
    }
  });

  it('agrees on the bucket', () => {
    const name = 'internal-message-attachments';
    expect(client).toContain(name);
    expect(fn).toContain(name);
  });

  it('documents the attachment actions in the function header', () => {
    // The header is the first thing anyone reads when deciding what to redeploy;
    // it listed seven actions and omitted these two.
    const header = fn.slice(0, fn.indexOf('import '));
    expect(header).toContain('attachment_upload_url');
    expect(header).toContain('attachment_upload_direct');
    expect(header).toContain('attachment_download_url');
  });
});

describe('dedicated attachment transport', () => {
  it('does not depend on the stale main messaging deployment', () => {
    expect(client).toContain("invokeSecureFunction('internal-message-attachments'");
    expect(transport).toContain("operation === 'upload_direct'");
    expect(transport).toContain("operation === 'upload_ticket'");
    expect(transport).toContain("operation === 'download_ticket'");
  });

  it('uses direct server upload before signed browser storage upload', () => {
    expect(client.indexOf("operation: 'upload_direct'")).toBeLessThan(
      client.indexOf("operation: 'upload_ticket'"),
    );
  });

  it('owns attachment message creation atomically', () => {
    expect(client).toContain("operation: 'send'");
    expect(transport).toContain("operation === 'send'");
    expect(transport).toMatch(/insert\(\{ thread_id: threadId, sender_id: auth\.userId, body: text, priority, attachments: cleaned \}\)/);
  });

  it('opens the download window during the click gesture', () => {
    expect(client.indexOf("window.open('', '_blank')")).toBeLessThan(
      client.indexOf("operation: 'download_ticket'"),
    );
  });
});

describe('the upload URL fallback can actually resolve', () => {
  it('does not collapse to a relative URL when the env var is absent', () => {
    // The fallback used to be `import.meta.env.VITE_SUPABASE_URL ?? ''`, read
    // inline in this module, which produced a relative path — so the upload PUT
    // went to the app's own origin and got HTML back. A fallback that cannot
    // work is worse than none.
    //
    // The URL now comes from the ONE resolver, which never yields an empty
    // string (src/integrations/supabase/env.ts, and its own unit tests pin
    // that). So the assertion is that this module does not resolve the project
    // for itself — reading the variable here is how the bug returns.
    expect(client).toContain("from '@/integrations/supabase/env'");
    expect(client).toMatch(/import \{[^}]*\bSUPABASE_URL\b[^}]*\} from '@\/integrations\/supabase\/env'/);
    // No inline read of the variable, with or without an empty-string fallback.
    const code = client.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/import\.meta\.env/);
    expect(code).not.toMatch(/VITE_SUPABASE_URL/);
  });

  it('still prefers the signed URL the server minted', () => {
    expect(client).toMatch(/if \(ticket\.signed_url && \/\^https\?:\\\/\\\/\/i\.test\(ticket\.signed_url\)\) return ticket\.signed_url;/);
  });
});

describe('the server remains the only thing that can mint or screen', () => {
  it('verifies thread participation before issuing either ticket', () => {
    const block = fn.slice(fn.indexOf("action === 'attachment_upload_url'"));
    expect(block.slice(0, 900)).toMatch(/internal_thread_participants/);
    expect(block.slice(0, 900)).toMatch(/not_a_participant/);
  });

  it('confines a download to the thread that asked for it', () => {
    // Without this a participant of thread A could read thread B's objects.
    expect(fn).toMatch(/path\.startsWith\(`\$\{threadId\}\/`\)/);
  });

  it('screens uploads server-side rather than trusting the declared type', () => {
    expect(fn).toMatch(/screenAttachments/);
    expect(fn).toMatch(/BLOCKED_EXTENSIONS/);
    expect(fn).toMatch(/MAGIC_SIGNATURES/);
  });
});
