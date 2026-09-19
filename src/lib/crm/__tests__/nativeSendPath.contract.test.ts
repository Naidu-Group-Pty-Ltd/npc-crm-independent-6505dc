/**
 * `crm-send-message`'s guarantees are ORDERINGS and an ABSENCE, so they are
 * asserted against the source. No unit test sees "this ran before that" or
 * "this never writes that word", and this repository's history is full of
 * defects of exactly that shape.
 *
 * Comment-stripped, because the function documents at length the vendor
 * sentences it exists to replace — and a test that fires on prose teaches the
 * next person to delete the explanation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fn = (name: string) =>
  readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "supabase",
      "functions",
      name,
      "index.ts",
    ),
    "utf8",
  );

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

const NATIVE = strip(fn("crm-send-message"));
const VENDOR = strip(fn("send-ghl-message"));

describe("a deployment this function does not serve is refused first", () => {
  it("checks the provider before reading the body or the database", () => {
    // Every clone receives the prime's whole function set, so a GHL
    // deployment can reach this URL on nothing worse than a stale bundle.
    // Answering would put a message on a Twilio account its operators never
    // configured, against a conversation the vendor also owns.
    const guard = NATIVE.indexOf("refuseWrongProvider(");
    expect(guard).toBeGreaterThan(-1);
    for (const later of [
      "req.json()",
      "planNativeSend(",
      "ghl_conversation_messages",
    ]) {
      const at = NATIVE.indexOf(later);
      expect(at, `${later} must be found`).toBeGreaterThan(-1);
      expect(guard, `the provider guard must precede ${later}`).toBeLessThan(
        at,
      );
    }
  });

  it("names the provider it serves rather than accepting any", () => {
    expect(NATIVE).toMatch(/refuseWrongProvider\(\s*['"]native['"]/);
  });
});

describe("a refusal is never recorded as a delivery", () => {
  it("asks the shared expression rather than re-deciding", () => {
    // One implementation, so the refuse and send paths cannot drift into
    // disagreeing about which of them writes a `sent` row.
    expect(NATIVE).toContain("planMayRecordDelivery(");
  });

  it("writes no `sent` status anywhere a refusal can reach", () => {
    const refusal = NATIVE.slice(
      NATIVE.indexOf("plan.act === 'refuse'"),
      NATIVE.indexOf("TWILIO_ACCOUNT_SID')!"),
    );
    expect(refusal.length).toBeGreaterThan(200);
    expect(refusal).toContain("message_status: 'failed'");
    expect(refusal, "a refusal must never claim delivery").not.toContain(
      "message_status: 'sent'",
    );
  });

  it("records the attempt rather than returning nothing", () => {
    // The pre-change behaviour wrote no row at all, so an operator had no way
    // to discover a send had been refused and would try again by hand.
    expect(NATIVE).toContain("ghl_conversation_messages");
  });

  it("answers 4xx for a configuration this deployment has settled", () => {
    // `not_configured` is a state, not a fault; a 5xx puts it in an error
    // budget it does not belong in.
    const refusal = NATIVE.slice(NATIVE.indexOf("plan.act === 'refuse'"));
    expect(refusal.slice(0, 1400)).toContain("status: 400");
  });
});

describe("a native send cannot go twice", () => {
  it("checks the idempotency key before planning", () => {
    // The vendor path is protected by GoHighLevel's own `Idempotency-Key`
    // header, which this one has no equivalent of — so a double-click would
    // otherwise put two SMS on the wire and bill for both.
    const guard = NATIVE.indexOf("client_request_id");
    const plan = NATIVE.indexOf("planNativeSend(");
    expect(guard).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(plan);
  });

  it("still permits a retry of a send that failed", () => {
    expect(NATIVE).toContain("message_status !== 'failed'");
  });
});

describe("the vendor function is untouched", () => {
  /**
   * The prime runs `send-ghl-message` against a live GoHighLevel account. The
   * native provider is a SEPARATE function reached through the router, so this
   * file should carry nothing about the native path at all — which is what
   * makes a later prime cascade merge instead of conflict.
   */
  it("still sends to GoHighLevel exactly as before", () => {
    expect(VENDOR).toContain(
      "https://services.leadconnectorhq.com/conversations/messages",
    );
    expect(VENDOR).toContain("getEffectiveGhlCredentials(");
    expect(VENDOR).toContain("GHL API key not configured");
  });

  it("carries no native branch", () => {
    for (const native of [
      "planNativeSend",
      "TWILIO_ACCOUNT_SID",
      "refuseWrongProvider",
    ]) {
      expect(
        VENDOR,
        `${native} belongs in crm-send-message, not here`,
      ).not.toContain(native);
    }
  });
});
