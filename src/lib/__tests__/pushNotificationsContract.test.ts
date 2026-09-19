/**
 * Contract tests for staff push notifications.
 *
 * The pipeline was fully built and had never delivered a single push. Three
 * independent blockers, each silent:
 *
 * 1. THE TRIGGER READ A DIFFERENT TABLE'S COLUMNS.
 *    `dispatch_web_push_on_notification` opens with
 *    `IF NEW.user_id IS NULL THEN RETURN NEW; END IF;` and later reads
 *    `NEW.link_url` and `NEW.category`. `public.notifications` has none of
 *    those — they are the client-portal notification columns. plpgsql resolves
 *    record fields at runtime, so the first statement raised on every insert,
 *    and a bare `EXCEPTION WHEN OTHERS THEN RETURN NEW` discarded it. Verified
 *    against production: the offending fields are exactly
 *    `category, link_url, user_id`.
 *
 * 2. THE TRIGGER COULD NOT AUTHENTICATE.
 *    It sent `Authorization: Bearer <anon key>` — hardcoded as a literal in the
 *    function body — while `send-web-push` requires an internal credential. Even
 *    a well-formed call would have been refused 401.
 *
 * 3. NO DEVICE COULD EVER SUBSCRIBE.
 *    `pushNotifications.ts` called `push-subscribe` through
 *    `supabase.functions.invoke`, which sends the anon key and NO cookies, so
 *    `verifyAuth` found no session and returned 401. `push_subscriptions` has
 *    been empty since the feature shipped — zero rows, all subscriber types.
 *
 * Plus mobile: iOS only delivers Web Push to an INSTALLED PWA, and the manifest
 * declared a 48x48 `.ico` as its 192px and 512px icons, which fails
 * installability outright.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/**
 * Strip comments before asserting. These files document the bug they fix by
 * quoting the broken code, so a naive `not.toContain('NEW.user_id')` matches
 * the explanation rather than the implementation.
 */
const sqlCode = (s: string) => s.replace(/^\s*--.*$/gm, '');
const tsCode = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIGRATION = 'supabase/migrations/20260803050000_repair_staff_push_dispatch.sql';

describe('the dispatch trigger matches the table it is attached to', () => {
  const sql = read(MIGRATION);
  const code = sqlCode(sql);
  const fn = code.slice(0, code.indexOf('drop trigger'));

  it('targets the recipient column that exists', () => {
    expect(fn).toMatch(/NEW\.target_user_id/);
  });

  it('never reads a portal column off a staff notification', () => {
    for (const phantom of ['NEW.user_id', 'NEW.link_url', 'NEW.category']) {
      expect(fn, `still reads ${phantom}`).not.toContain(phantom);
    }
  });

  it('sends only the id, so the payload cannot drift from the schema again', () => {
    // send-web-push re-reads title/body/link/audience from the persisted row.
    expect(fn).toMatch(/jsonb_build_object\('notification_id', NEW\.id\)/);
    for (const supplied of ["'title'", "'body'", "'url'", "'category'"]) {
      expect(fn, `${supplied} should be derived server-side`).not.toContain(supplied);
    }
  });

  it('drops the hardcoded anon key literal', () => {
    // The old body embedded the key as a string constant.
    expect(fn).not.toMatch(/eyJhbGciOiJIUzI1NiI/);
    expect(fn).toMatch(/vault\.decrypted_secrets/);
    expect(fn).toMatch(/cron_signed_internal_headers/);
  });

  it('warns instead of returning silently', () => {
    // A push failure must not block the insert — but the old bare handler is
    // exactly why this went unnoticed since the feature shipped.
    expect(fn).toMatch(/exception when others then[\s\S]{0,200}raise warning/i);
    expect(fn).toMatch(/return NEW;/);
  });

  it('asserts at deploy time that no trigger reads a missing field', () => {
    expect(code).toMatch(/regexp_matches\(p\.prosrc, 'NEW\\\.\(\[a-zA-Z_\]\[a-zA-Z0-9_\]\*\)'/);
    expect(code).toMatch(/raise exception[\s\S]{0,120}read fields that do not exist/i);
  });
});

describe('a device can actually register', () => {
  const push = tsCode(read('src/lib/pushNotifications.ts'));

  it('carries the session cookie instead of the anon key', () => {
    expect(push).toMatch(/import \{ invokeSecureFunction \}/);
    // supabase.functions.invoke sends no cookies, so verifyAuth always 401'd.
    expect(push).not.toMatch(/supabase\.functions\.invoke/);
  });

  it('routes all three push endpoints through it', () => {
    for (const fn of ['get-vapid-public-key', 'push-subscribe', 'push-unsubscribe']) {
      expect(push).toMatch(new RegExp(`invokeSecureFunction[\\s\\S]{0,80}'${fn}'`));
    }
  });

  it('declares the staff subscriber type', () => {
    // push_subscriptions is keyed on (subscriber_type, endpoint); defaulting is
    // fine but being explicit keeps staff rows out of the portal namespace.
    expect(push).toMatch(/subscriber_type: 'staff'/);
  });

  it('does not leave the browser subscribed when the server did not store it', () => {
    // Otherwise the toggle reads "on" and nothing is ever delivered — the exact
    // failure mode this whole change exists to remove.
    const idx = push.indexOf("'push-subscribe'");
    const after = push.slice(idx, idx + 900);
    expect(after).toMatch(/subscription\.unsubscribe\(\)/);
    expect(after).toMatch(/throw new Error/);
  });
});

describe('send-web-push stays fail-closed while accepting the trigger', () => {
  const src = tsCode(read('supabase/functions/send-web-push/index.ts'));

  /**
   * ONE scheme, not either.
   *
   * This asserted `verifyRequiredCronSecret` was present, and WP-12 removed
   * that path on purpose: the function used to compare a raw
   * `x-internal-edge-secret` first and fall back to the signed check, and a
   * bearer-style shared secret is replayable, carries no caller identity and
   * binds nothing to the body. Both callers —
   * `dispatch_web_push_for_portal_notification` and the staff dispatcher —
   * already build their headers with `public.cron_signed_internal_headers(...)`,
   * so dropping it removed a redundant weaker credential rather than a
   * capability.
   *
   * The assertion is inverted rather than deleted. A test that demands the
   * static path be present does not merely fail — it tells whoever is trying to
   * make the suite green to put a replayable secret back into an
   * unauthenticated edge function. That is the most expensive shape a stale
   * test can have, so this one now fails if the static path returns.
   *
   * It is not a new opinion, either: `send-web-push/security-contract.test.ts`
   * has held exactly this contract on the Deno side since WP-12 ("the static
   * cron-secret helper must no longer gate this function"). The two suites
   * simply disagreed, and the one that ran in CI's vitest job was the stale
   * one. `verifyRequiredCronSecret` remains correct for the fourteen functions
   * that still authenticate that way; this is about this receiver.
   */
  it('takes the signed envelope and nothing weaker', () => {
    expect(src).toMatch(/verifySignedInternal/);
    expect(src).not.toMatch(/verifyRequiredCronSecret/);
    expect(src).not.toMatch(/x-internal-edge-secret/i);
    expect(src).not.toMatch(/CRON_SECRET/);
  });

  it('still refuses an unauthenticated caller', () => {
    expect(src).toMatch(/if \(!signed\.ok\) return securityJsonError\(401, 'unauthorized'\)/);
  });

  it('restricts which internal callers may dispatch', () => {
    expect(src).toMatch(/'notifications_trigger'/);
    expect(src).toMatch(/'pg_cron'/);
  });

  it('reads the body once so the HMAC covers the exact bytes', () => {
    expect(src).toMatch(/const rawBody = await req\.text\(\)/);
    expect(src).toMatch(/JSON\.parse\(rawBody\)/);
    expect(src).not.toMatch(/await req\.json\(\)/);
  });
});

describe('the app is installable, which is what iOS requires for push', () => {
  const manifest = JSON.parse(read('public/manifest.json'));
  const html = read('index.html');

  it('ships real PNG icons at the installability sizes', () => {
    const bySize = new Map(manifest.icons.map((i: any) => [i.sizes, i]));
    for (const size of ['192x192', '512x512']) {
      const icon: any = bySize.get(size);
      expect(icon, `no ${size} icon`).toBeTruthy();
      // The manifest used to point every size at a 48x48 .ico.
      expect(icon.type).toBe('image/png');
      expect(icon.src).toMatch(/\.png$/);
    }
  });

  it('provides a maskable icon so Android does not crop the logo', () => {
    expect(manifest.icons.some((i: any) => String(i.purpose).includes('maskable'))).toBe(true);
  });

  it('stays standalone, which iOS requires before it will deliver push', () => {
    expect(manifest.display).toBe('standalone');
  });

  it('gives iOS a PNG home-screen icon', () => {
    // The PATH is not the contract — `platformBrand.ts` owns which mark this
    // is, and pinning one filename here is what made moving it off the NPC
    // email-signature banner look like a test failure. What iOS needs is a
    // declared PNG.
    expect(html).toMatch(/rel="apple-touch-icon"[^>]*href="[^"]+\.png"/);
    expect(html).toMatch(/apple-mobile-web-app-capable/);
  });
});
