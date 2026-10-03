/**
 * A finance partner's message on a native deployment: what is sent, what is
 * refused, and in whose words.
 *
 * The planner is exercised directly. The function's guarantees are orderings
 * (decide before sending, refuse before writing), so they are read from its
 * comment-stripped source.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emailBodyHtml,
  emailSubjectText,
  planFinancePortalSend,
} from "../../../../supabase/functions/_shared/crm/financePortalNativeSend.pure";

const TWILIO = {
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: "secret",
  TWILIO_FROM_NUMBER: "+61400000000",
};
const RESEND = { RESEND_API_KEY: "re_123" };
const client = { email: "ada@example.com", mobile: "0412 345 678" };

describe("a text message", () => {
  it("goes to the client's mobile as E.164 where the deployment can send", () => {
    expect(planFinancePortalSend({ channel: "sms", client, env: TWILIO })).toEqual({
      act: "send",
      via: "twilio",
      channel: "sms",
      to: "+61412345678",
    });
  });

  it("is refused in the broker's words where no sender is set, and names the fix for the log", () => {
    const plan = planFinancePortalSend({ channel: "sms", client, env: {} });
    if (plan.act !== "refuse") throw new Error("expected a refusal");
    expect(plan.reason).toBe("not_configured");
    expect(plan.message).toContain("not the problem");
    expect(plan.message).not.toMatch(/TWILIO|deployment|project/);
    expect(plan.operatorRemedy).toContain("TWILIO_ACCOUNT_SID");
  });

  it("tells a missing number apart from one that cannot be read", () => {
    const none = planFinancePortalSend({ channel: "sms", client: { ...client, mobile: "  " }, env: TWILIO });
    const bad = planFinancePortalSend({ channel: "sms", client: { ...client, mobile: "call me" }, env: TWILIO });
    if (none.act !== "refuse" || bad.act !== "refuse") throw new Error("expected refusals");
    expect(none.message).toContain("no mobile number recorded");
    expect(bad.message).toContain("could not be read");
    expect(none.reason).toBe("no_destination");
    expect(bad.reason).toBe("no_destination");
  });
});

describe("a WhatsApp message", () => {
  it("is refused rather than sent as a text, whatever is configured", () => {
    const plan = planFinancePortalSend({ channel: "whatsapp", client, env: { ...TWILIO, ...RESEND } });
    if (plan.act !== "refuse") throw new Error("expected a refusal");
    expect(plan.reason).toBe("not_implemented");
    expect(plan.message).toContain("text message or an email");
  });
});

describe("an email", () => {
  it("goes to the client's address where the deployment can send email", () => {
    expect(planFinancePortalSend({ channel: "email", client, env: RESEND })).toEqual({
      act: "send",
      via: "resend",
      channel: "email",
      to: "ada@example.com",
    });
  });

  it("is refused where no email sender is set, without blaming the address", () => {
    const plan = planFinancePortalSend({ channel: "email", client, env: TWILIO });
    if (plan.act !== "refuse") throw new Error("expected a refusal");
    expect(plan.reason).toBe("not_configured");
    expect(plan.message).toContain("not the problem");
    expect(plan.operatorRemedy).toContain("RESEND_API_KEY");
  });

  it("is refused where the record has no address, or one that is not an address", () => {
    for (const email of [null, "", "ada at example"]) {
      const plan = planFinancePortalSend({ channel: "email", client: { ...client, email }, env: RESEND });
      expect(plan.act).toBe("refuse");
    }
  });
});

describe("what reaches the email", () => {
  it("sets the broker's text as text", () => {
    expect(emailBodyHtml('<img src=x onerror="go()">\nRegards & thanks')).toBe(
      '&lt;img src=x onerror="go()"&gt;<br/>Regards &amp; thanks',
    );
  });

  it("keeps the subject as typed, less anything that could open a tag", () => {
    expect(emailSubjectText("Q&A: what's next <b>now</b>", "fallback")).toBe("Q&A: what's next bnow/b");
    expect(emailSubjectText("   ", "A message from your broker")).toBe("A message from your broker");
    expect(emailSubjectText(undefined, "A message from your broker")).toBe("A message from your broker");
  });
});

describe("finance-portal-client-comms on a native deployment", () => {
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
  const source = strip(
    readFileSync(
      resolve(__dirname, "../../../../supabase/functions/finance-portal-client-comms/index.ts"),
      "utf8",
    ),
  );
  const send = source.slice(source.indexOf("async function sendMessage("));
  const native = send.slice(
    send.indexOf("servingCrmProvider() === 'native'"),
    send.indexOf(".from('ghl_conversations')"),
  );

  it("takes the native branch before the vendor's", () => {
    const branch = send.indexOf("servingCrmProvider() === 'native'");
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(send.indexOf("leadconnectorhq.com"));
  });

  it("decides before it sends, and refuses before it writes", () => {
    const plan = native.indexOf("planFinancePortalSend(");
    const refuse = native.indexOf("plan.act === 'refuse'");
    expect(plan).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(plan);
    expect(refuse).toBeLessThan(native.indexOf("sendTwilioSms("));
    expect(refuse).toBeLessThan(native.indexOf("sendPortalNotificationEmail("));
    expect(send.indexOf("plan.act === 'refuse'")).toBeLessThan(send.indexOf("finance_outbound_messages"));
  });

  it("never reaches the CRM vendor from the native branch", () => {
    expect(native.length).toBeGreaterThan(500);
    expect(native).not.toContain("leadconnectorhq");
    expect(native).not.toContain("getEffectiveGhlCredentials");
  });

  it("shows the broker a sentence, never a code", () => {
    expect(native).toContain("json({ error: plan.message");
  });

  it("tracks an email's opening the way the vendor path does", () => {
    const email = native.slice(native.indexOf("sendPortalNotificationEmail("));
    expect(native).toContain("trackingToken = crypto.randomUUID()");
    expect(native).toContain("trackingPixelUrl(trackingToken)");
    expect(email.slice(0, email.indexOf("});"))).toMatch(/message:\s*`\$\{emailBodyHtml\(String\(text\)\)\}\$\{pixel\}`/);
  });
});
