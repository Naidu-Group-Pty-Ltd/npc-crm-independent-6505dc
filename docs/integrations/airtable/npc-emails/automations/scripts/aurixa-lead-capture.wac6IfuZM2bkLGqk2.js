// Aurixa Lead Capture  —  node wac6IfuZM2bkLGqk2
// Source automation wflM9vUhBoHb0ZE8r in base apptyShYE0yzL4IGB (NPC Emails).
// Paste into the Airtable UI: the API cannot author a script node.
// Declared input variables: recordId

// 1. Fetch table context
let table = base.getTable("Aurixa Waitlist");

// 2. Get the record ID from the automation environment
let config = input.config();
let recordId = config.recordId;

// 3. Generate a secure, pseudo-random 16-byte character sequence
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
let rawString = '';
for (let i = 0; i < 16; i++) {
    rawString += chars.charAt(Math.floor(Math.random() * chars.length));
}

// 4. Convert the sequence to a URL-Safe Base64 string manually (bypassing btoa)
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

// 5. Set expiration time (e.g., 24 hours from now)
let hoursToLive = 24;
let expiryDate = new Date();
expiryDate.setHours(expiryDate.getHours() + hoursToLive);
let expiryTimestamp = expiryDate.toISOString(); // Format: YYYY-MM-DDTHH:mm:ss.sssZ

// 6. Construct the final URL
let baseUrl = "https://aurixasystems.com.au/questionnaire";
let mintedUrl = `${baseUrl}?token=${base64Token}&expires=${encodeURIComponent(expiryTimestamp)}`;

// 7. Update the Airtable record fields
await table.updateRecordAsync(recordId, {
    "Token": base64Token,
    "Bypass URL": mintedUrl
});
