// PASTE-READY — Aurixa Lead Capture, script 1 of 2 (wflEQ1wsJH1x7GQhL)
// Goes after the email node `wacuQvJSp0tGlWStY`.
// Input variables to declare in the UI:
//   recordId  -> the TRIGGER record's Airtable record ID
//
// ── Why this still uses Math.random(), and why that is not the defect ────────
//
// A crypto.getRandomValues version was written first and REFUSED BY THE RUNTIME:
// Airtable's automation script sandbox exposes no CSPRNG (the Scripting
// *extension* runs in the browser and does; automation actions do not).
// Measured 2026-09-15 by running it.
//
// That matters less than it looks, because THE TOKEN IS NOT CHECKED ANYWHERE.
// `aurixa-systems/src/lib/questionnaireLinkAccess.ts` gates /questionnaire and
// says so itself: "This is not an authorisation boundary, and cannot be made
// into one." It tests only that the token is SHAPED like one — 16+ URL-safe
// characters — and that `expires` is in the future. So
// `?token=aaaaaaaaaaaaaaaa&expires=2030-01-01` already opens the form. Raising
// the entropy of this string changes nothing about who can get in.
//
// The real control is written and NOT DEPLOYED:
// `aurixa-systems/supabase/functions/readiness-questionnaire/index.ts` mints
// tokens from 32 bytes of CSPRNG, stores only their SHA-256, returns the raw
// value exactly once, and exchanges it through `authorise`. Its migration is
// unapplied. Once that service is live, THIS SCRIPT SHOULD BE DELETED — the
// token stops being Airtable's to mint.
//
// So this file is deliberately the legacy behaviour, unchanged: pasting it is
// not a regression, it is parity with the source base. Do not "improve" the RNG
// here — it is the wrong layer, and a stronger token in front of a gate that
// does not read it is theatre.
//
// One thing IS fixed: the source's comment called this "secure, pseudo-random".
// It is neither. The wording below says what it is.

// 1. Fetch table context
let table = base.getTable("Aurixa Waitlist");

// 2. Get the record ID from the automation environment
let config = input.config();
let recordId = config.recordId;

// 3. Generate a 16-character random sequence.
//    NOT a credential: Math.random() is not a CSPRNG, and nothing validates
//    this value today. It is a lookup key until `readiness-questionnaire` ships.
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
let rawString = '';
for (let i = 0; i < 16; i++) {
    rawString += chars.charAt(Math.floor(Math.random() * chars.length));
}

// 4. Convert the sequence to a URL-safe Base64 string manually (bypassing btoa)
const b64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
let base64Token = '';
let i = 0;

while (i < rawString.length) {
    let c1 = rawString.charCodeAt(i++);
    let c2 = i < rawString.length ? rawString.charCodeAt(i++) : NaN;
    let c3 = i < rawString.length ? rawString.charCodeAt(i++) : NaN;

    let byte1 = c1 >> 2;
    let byte2 = ((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4);
    let byte3 = isNaN(c2) ? 64 : ((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6);
    let byte4 = isNaN(c3) ? 64 : c3 & 63;

    base64Token += b64Chars.charAt(byte1) + b64Chars.charAt(byte2);
    if (byte3 !== 64) base64Token += b64Chars.charAt(byte3);
    if (byte4 !== 64) base64Token += b64Chars.charAt(byte4);
}

// 5. Set expiration time (24 hours from now)
let hoursToLive = 24;
let expiryDate = new Date();
expiryDate.setHours(expiryDate.getHours() + hoursToLive);
let expiryTimestamp = expiryDate.toISOString();

// 6. Construct the final URL
let baseUrl = "https://aurixasystems.com.au/questionnaire";
let mintedUrl = `${baseUrl}?token=${base64Token}&expires=${encodeURIComponent(expiryTimestamp)}`;

// 7. Update the Airtable record fields
await table.updateRecordAsync(recordId, {
    "Token": base64Token,
    "Bypass URL": mintedUrl
});
