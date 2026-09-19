/**
 * The VAPID subject is a contact URI, and it is this deployment's own.
 *
 * Two defects met here. `send-web-push` prefixed `mailto:` onto anything that
 * did not already start with it, so a legal `https://tenant.example` subject
 * became `mailto:https://tenant.example` — which no push service accepts, and
 * which only mattered once the subject stopped being one shared address.
 * And nothing forwarded the name the function reads: Mission Control marked
 * `VAPID_SUBJECT` inheritable (a variable no function anywhere consults) while
 * `VAPID_SUBJECT_EMAIL` was forwarded by nothing, so every deployment fell
 * through to `admin@example.com`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveVapidSubject } from "../../../supabase/functions/_shared/vapidSubject.pure";

describe("both contact URI forms RFC 8292 admits", () => {
  it("keeps an https: origin intact — the form a control plane can derive", () => {
    expect(resolveVapidSubject("https://preflight.aurixasystems.com.au")).toEqual({
      ok: true,
      subject: "https://preflight.aurixasystems.com.au",
    });
  });

  it("normalises an https: URL to its origin", () => {
    const r = resolveVapidSubject("https://example.com.au/some/path?x=1");
    expect(r).toEqual({ ok: true, subject: "https://example.com.au" });
  });

  it("passes a mailto: through", () => {
    expect(resolveVapidSubject("mailto:ops@example.com.au")).toEqual({
      ok: true,
      subject: "mailto:ops@example.com.au",
    });
  });

  it("still prefixes a bare address, which is what the variable used to hold", () => {
    expect(resolveVapidSubject("ops@example.com.au")).toEqual({
      ok: true,
      subject: "mailto:ops@example.com.au",
    });
  });

  it("never produces the mailto:https:// corruption", () => {
    const r = resolveVapidSubject("https://tenant.example");
    expect(r.ok && r.subject.startsWith("mailto:")).toBe(false);
  });
});

describe("an unusable subject is refused, never sent malformed", () => {
  it("refuses http:", () => {
    const r = resolveVapidSubject("http://tenant.example");
    expect(r).toMatchObject({ ok: false, reason: "unusable" });
  });

  it("refuses a value that is neither a URL nor an address", () => {
    expect(resolveVapidSubject("Naidu Property")).toMatchObject({ ok: false, reason: "unusable" });
  });

  it("refuses a mailto: with nothing usable after it", () => {
    expect(resolveVapidSubject("mailto:not-an-address")).toMatchObject({
      ok: false,
      reason: "unusable",
    });
  });
});

describe("there is no fabricated fallback", () => {
  it("unset is unset, not a placeholder address", () => {
    // `admin@example.com` reaches a push service looking exactly like a real
    // contact, on a domain RFC 2606 reserves so nobody can receive there. The
    // same rule as this platform's "never a fabricated zero".
    for (const empty of [undefined, null, "", "   "]) {
      expect(resolveVapidSubject(empty)).toMatchObject({ ok: false, reason: "unset" });
    }
  });

  it("the dispatcher declines to send rather than signing with a default", () => {
    const src = readFileSync("supabase/functions/send-web-push/index.ts", "utf8");
    expect(src).not.toContain("admin@example.com");
    expect(src).toContain("resolveVapidSubject");
    // The prefix that corrupted an https: subject is gone.
    expect(src).not.toContain("`mailto:${VAPID_SUBJECT}`");
  });
});
