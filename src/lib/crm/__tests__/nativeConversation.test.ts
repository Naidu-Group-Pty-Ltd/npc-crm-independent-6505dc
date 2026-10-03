/**
 * How a native conversation is addressed. Both ends of a thread — an
 * operator opening it and a client texting in — must key it the same way, or
 * a reply lands in a second thread nobody is reading.
 */
import { describe, expect, it } from "vitest";
import {
  NATIVE_CONVERSATION_PREFIX,
  australianMobileToE164,
  confirmedMobileMatches,
  mobileLookupVariants,
  nativeConversationKey,
  reachableChannels,
  smsConversationKey,
} from "../../../../supabase/functions/_shared/crm/nativeConversation.pure";
import { planNativeSend } from "../../../../supabase/functions/_shared/crm/nativeOutbound.pure";

describe("a mobile number as a person typed it", () => {
  it.each([
    ["0412 345 678", "+61412345678"],
    ["0412345678", "+61412345678"],
    ["(04) 1234 5678", "+61412345678"],
    ["0412-345-678", "+61412345678"],
    ["+61 412 345 678", "+61412345678"],
    ["+61412345678", "+61412345678"],
    ["61412345678", "+61412345678"],
    ["61 412 345 678", "+61412345678"],
    ["412 345 678", "+61412345678"],
    ["+61 0412 345 678", "+61412345678"],
    ["  0412 345 678  ", "+61412345678"],
  ])("reads %j as %s", (raw, e164) => {
    expect(australianMobileToE164(raw)).toBe(e164);
  });

  it("keeps a number that names its own country", () => {
    // Never guesses Australia over a country the number states.
    expect(australianMobileToE164("+44 7700 900123")).toBe("+447700900123");
    expect(australianMobileToE164("+1 (415) 555-0100")).toBe("+14155550100");
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["   "],
    ["not recorded"],
    ["jane@example.com"],
    ["0412 345 67"], // one digit short
    ["04123456789"], // one digit long
    ["+61 412 +345 678"],
    ["123"],
    ["+1234567"], // too short for any country
  ])("refuses %j rather than repairing it into somebody else's number", (raw) => {
    expect(australianMobileToE164(raw as string | null | undefined)).toBeNull();
  });
});

describe("the key a thread is filed under", () => {
  it("is the number when the client can be texted", () => {
    expect(
      nativeConversationKey({ mobileE164: "+61412345678", clientId: "c1" }),
    ).toBe("native-sms-+61412345678");
  });

  it("is the key the inbound webhook derives from Twilio's From", () => {
    // The whole point: an operator's first message and the client's reply
    // address one thread.
    expect(
      nativeConversationKey({ mobileE164: "+61412345678", clientId: "c1" }),
    ).toBe(smsConversationKey("+61412345678"));
  });

  it("is the client when there is no number, because email is a channel too", () => {
    expect(nativeConversationKey({ mobileE164: null, clientId: "c1" })).toBe(
      "native-client-c1",
    );
  });

  it("always carries the native prefix, so no vendor id can collide", () => {
    for (const key of [
      nativeConversationKey({ mobileE164: "+61412345678", clientId: "c" }),
      nativeConversationKey({ mobileE164: null, clientId: "c" }),
    ]) {
      expect(key.startsWith(NATIVE_CONVERSATION_PREFIX)).toBe(true);
    }
  });
});

describe("the channels a record can be reached on", () => {
  it("offers SMS for a mobile and email for an address", () => {
    expect(
      reachableChannels({ mobileE164: "+61412345678", email: "a@b.co" }),
    ).toEqual(["sms", "email"]);
  });

  it("offers nothing for a record with neither", () => {
    // A thread whose composer cannot send is a dead control.
    expect(reachableChannels({ mobileE164: null, email: "" })).toEqual([]);
    expect(reachableChannels({ mobileE164: null, email: "not an address" })).toEqual([]);
  });

  it("never offers WhatsApp, which this build cannot send", () => {
    const all = reachableChannels({ mobileE164: "+61412345678", email: "a@b.co" });
    expect(all).not.toContain("whatsapp");
  });
});

describe("finding the client an inbound number belongs to", () => {
  it("asks for every form a person commonly types", () => {
    const variants = mobileLookupVariants("+61412345678");
    for (const typed of [
      "+61412345678",
      "0412345678",
      "0412 345 678",
      "+61 412 345 678",
      "61412345678",
      "(04) 1234 5678",
      "0412-345-678",
    ]) {
      expect(variants).toContain(typed);
    }
  });

  it("every variant reads back as the same line", () => {
    for (const v of mobileLookupVariants("+61412345678")) {
      expect(australianMobileToE164(v)).toBe("+61412345678");
    }
  });

  it("links the one client whose record IS the number", () => {
    expect(
      confirmedMobileMatches("+61412345678", [
        { id: "a", primary_mobile: "0412 345 678" },
      ]),
    ).toBe("a");
  });

  it("links nobody when two records hold the line", () => {
    // Who somebody is is a question for a person, not for a webhook.
    expect(
      confirmedMobileMatches("+61412345678", [
        { id: "a", primary_mobile: "0412 345 678" },
        { id: "b", primary_mobile: "+61412345678" },
      ]),
    ).toBeNull();
  });

  it("never links on a shared suffix belonging to another country", () => {
    expect(
      confirmedMobileMatches("+61412345678", [
        { id: "uk", primary_mobile: "+44 412 345 678" },
      ]),
    ).toBeNull();
  });

  it("counts one client once, however many rows came back", () => {
    expect(
      confirmedMobileMatches("+61412345678", [
        { id: "a", primary_mobile: "0412 345 678" },
        { id: "a", primary_mobile: "0412345678" },
      ]),
    ).toBe("a");
  });
});

describe("the outbound path addresses the same line", () => {
  const TWILIO = {
    TWILIO_ACCOUNT_SID: "AC1",
    TWILIO_AUTH_TOKEN: "t",
    TWILIO_FROM_NUMBER: "+61400000000",
  };

  it("sends to E.164, which is all Twilio accepts", () => {
    const plan = planNativeSend({ channel: "sms", to: "0412 345 678", env: TWILIO });
    expect(plan).toMatchObject({ act: "send", to: "+61412345678" });
  });

  it("refuses an unreadable record with a sentence about the record", () => {
    const plan = planNativeSend({ channel: "sms", to: "call reception", env: TWILIO });
    if (plan.act !== "refuse") throw new Error("expected a refusal");
    expect(plan.kind).toBe("no_destination");
    expect(plan.message).toMatch(/record could not be read/i);
    expect(plan.remedy).toMatch(/client's record/i);
  });

  it("still asks the deployment's gap first", () => {
    const plan = planNativeSend({ channel: "sms", to: "call reception", env: {} });
    if (plan.act !== "refuse") throw new Error("expected a refusal");
    expect(plan.kind).toBe("not_configured");
  });
});
