/**
 * What a native deployment may say, and may record, about a message it did
 * not send.
 */
import { describe, expect, it } from "vitest";
import {
  TWILIO_CREDENTIAL_NAMES,
  hasTwilioCredentials,
  missingTwilioCredentials,
  planMayRecordDelivery,
  planNativeSend,
} from "../../../../supabase/functions/_shared/crm/nativeOutbound.pure";

/** This clone's real environment: none of the three names is set. */
const NO_SENDER = {} as const;
const TWILIO = {
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: "tok",
  TWILIO_FROM_NUMBER: "+61400000000",
} as const;

describe("a deployment with no sender", () => {
  const plan = planNativeSend({
    channel: "sms",
    to: "+61411111111",
    env: NO_SENDER,
  });

  it("refuses rather than sending", () => {
    expect(plan.act).toBe("refuse");
  });

  it("blames the deployment, never the contact", () => {
    // The live GHL path answers 'This contact does not have a valid mobile
    // number.' — which on a deployment with no sender is libel about
    // somebody's customer. Same rule as `geocoder_unavailable`.
    if (plan.act !== "refuse") throw new Error("expected a refusal");
    expect(plan.kind).toBe("not_configured");
    expect(plan.message).toMatch(/not a problem with the contact/i);
    for (const blame of ["opted out", "invalid", "does not have a valid"]) {
      expect(plan.message.toLowerCase()).not.toContain(blame);
    }
  });

  it("names the fields to fill, not a count", () => {
    if (plan.act !== "refuse") throw new Error("expected a refusal");
    for (const name of TWILIO_CREDENTIAL_NAMES)
      expect(plan.remedy).toContain(name);
  });

  it("names only what is actually absent", () => {
    const partial = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" };
    expect(missingTwilioCredentials(partial)).toEqual(["TWILIO_FROM_NUMBER"]);
    // Two of three is not configured — the half-configuration rule.
    expect(hasTwilioCredentials(partial)).toBe(false);
  });
});

describe("a refusal is never recorded as a send", () => {
  it.each([
    [
      "no sender",
      { channel: "sms" as const, to: "+61411111111", env: NO_SENDER },
    ],
    ["no destination", { channel: "sms" as const, to: "  ", env: TWILIO }],
    [
      "whatsapp",
      { channel: "whatsapp" as const, to: "+61411111111", env: TWILIO },
    ],
  ])("%s may not write a delivery row", (_label, input) => {
    expect(planMayRecordDelivery(planNativeSend(input))).toBe(false);
  });

  it("permits it only on an actual send", () => {
    const plan = planNativeSend({
      channel: "sms",
      to: "+61411111111",
      env: TWILIO,
    });
    expect(plan.act).toBe("send");
    expect(planMayRecordDelivery(plan)).toBe(true);
  });
});

describe("a channel this build cannot carry", () => {
  it("is refused rather than downgraded to SMS", () => {
    // Silently sending an SMS picks a channel the operator did not choose, at
    // a cost they did not agree to.
    const plan = planNativeSend({
      channel: "whatsapp",
      to: "+61411111111",
      env: TWILIO,
    });
    if (plan.act !== "refuse") throw new Error("expected a refusal");
    expect(plan.kind).toBe("not_implemented");
  });

  it("is refused on the ground that no credential changes, even with none set", () => {
    // Telling an operator to configure Twilio and then refusing them anyway is
    // worse than refusing once.
    const plan = planNativeSend({
      channel: "whatsapp",
      to: "+61411111111",
      env: NO_SENDER,
    });
    if (plan.act !== "refuse") throw new Error("expected a refusal");
    expect(plan.kind).toBe("not_implemented");
    expect(plan.remedy).toBeNull();
  });
});

describe("where the contact IS the reason", () => {
  it("says so plainly", () => {
    const plan = planNativeSend({ channel: "sms", to: null, env: TWILIO });
    if (plan.act !== "refuse") throw new Error("expected a refusal");
    expect(plan.kind).toBe("no_destination");
    expect(plan.message).toMatch(/no mobile number recorded/i);
  });

  it("is asked only once a sender exists", () => {
    // Order matters: with no sender AND no number, the deployment's own gap is
    // the one an operator can act on.
    const plan = planNativeSend({ channel: "sms", to: null, env: NO_SENDER });
    if (plan.act !== "refuse") throw new Error("expected a refusal");
    expect(plan.kind).toBe("not_configured");
  });
});
