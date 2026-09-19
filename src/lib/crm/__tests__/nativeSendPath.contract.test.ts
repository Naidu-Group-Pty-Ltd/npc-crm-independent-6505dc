/**
 * The native branch's guarantees are ORDERINGS and an ABSENCE, so they are
 * asserted against the source. No unit test can see "this ran before that" or
 * "this never writes that word", and this repository's own history is full of
 * defects of exactly that shape.
 *
 * Comment-stripped, because the branch documents its reasoning at length and
 * quotes the vendor sentences it exists to replace — a test that fires on
 * prose teaches the next person to delete the explanation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILE = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "supabase",
  "functions",
  "send-ghl-message",
  "index.ts",
);
const RAW = readFileSync(FILE, "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(
  /(^|[^:])\/\/.*$/gm,
  "$1 ",
);

/** The native branch: from the provider resolution to the vendor credentials. */
const NATIVE = CODE.slice(
  CODE.indexOf("const crm = resolveCrmProvider("),
  CODE.indexOf("const _ghlCreds = await getEffectiveGhlCredentials("),
);

describe("the native branch is reached before the vendor is", () => {
  it("resolves the provider ahead of the GoHighLevel credentials", () => {
    const resolve = CODE.indexOf("resolveCrmProvider(");
    const creds = CODE.indexOf("getEffectiveGhlCredentials(");
    expect(resolve).toBeGreaterThan(-1);
    expect(creds).toBeGreaterThan(-1);
    expect(resolve).toBeLessThan(creds);
  });

  it("returns rather than falling through to the vendor path", () => {
    // Without a return, a native deployment would resolve its provider and
    // then go on to answer `GHL API key not configured` anyway.
    expect(NATIVE.length).toBeGreaterThan(400);
    expect(NATIVE).toContain("return new Response");
  });

  it("does not answer 5xx for a configuration this deployment has settled", () => {
    // `not_configured` is a state, not a fault. A 500 puts it in an error
    // budget it does not belong in.
    expect(NATIVE).not.toMatch(/status:\s*5\d\d[\s\S]{0,200}not_configured/);
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
      NATIVE.indexOf("TWILIO_ACCOUNT_SID"),
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
});

describe("a native send cannot go twice", () => {
  it("checks the idempotency key before planning", () => {
    // The vendor path is protected by GoHighLevel's own `Idempotency-Key`
    // header, which this path has no equivalent of — so a double-click would
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

describe("the vendor path is untouched", () => {
  it("still sends to GoHighLevel exactly as before", () => {
    expect(CODE).toContain(
      "https://services.leadconnectorhq.com/conversations/messages",
    );
    expect(CODE).toContain("getEffectiveGhlCredentials(");
    expect(CODE).toContain("resolveGhlAccessTokenForLocation(");
  });

  it("keeps the vendor's own credential refusal for a GoHighLevel deployment", () => {
    // The prime runs this same file. Removing this would change what the
    // prime does when a key is rotated out.
    expect(CODE).toContain("GHL API key not configured");
  });
});
