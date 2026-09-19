// PASTE-READY — Auto-generate report (wflIvnXu2Jcs7eQ95)
// REPLACES the placeholder Find records node `wacM5IrEzCPRTTWDy` inside the
// conditional branch. Delete that node, add Run script in its place.
//
// Input variables to declare in the UI. Every value comes from the trigger
// record except the last; the nine field names are unchanged from the source
// base, so pick them by name.
//   recordId      -> Airtable record ID
//   address       -> Address
//   suburb        -> Suburb
//   propertyType  -> Property Type
//   price         -> Price
//   beds          -> Beds
//   baths         -> Baths
//   state         -> State
//   propertyName  -> Project Name          (yes, Project Name — that is what the source bound)
//   webhookSecret -> the value of AUTO_REPORT_WEBHOOK_SECRET, pasted
//
// The URL is correct as written — dduzbchuswwbefdunfct is the LIVE NPC Property
// Dashboard project and auto-report-webhook is deployed there. Do not re-point it.
//
// Verified 2026-09-15 against the function source: it still reads x-webhook-secret
// and constant-time compares it against AUTO_REPORT_WEBHOOK_SECRET, with
// verify_jwt = false at the gateway. Note the function's own comment — when
// AUTO_REPORT_WEBHOOK_SECRET is UNSET in Supabase the secret path is unavailable
// and nothing this script sends can authenticate. Confirm it is set before pasting.
//
// A script input is not a secret store: anyone who can edit this base can read
// the value. If the editor list is wider than the people who should hold that
// secret, call the endpoint from somewhere that can hold one instead.

let config = input.config();

let payload = {
  listing: {
    id: config.recordId,
    address: config.address || '',
    propertyName: config.propertyName || '',
    suburb: config.suburb || '',
    propertyType: config.propertyType || '',
    price: config.price || null,
    beds: config.beds || null,
    baths: config.baths || null,
    state: config.state || ''
  }
};

let response = await fetch('https://dduzbchuswwbefdunfct.supabase.co/functions/v1/auto-report-webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-webhook-secret': config.webhookSecret
  },
  body: JSON.stringify(payload)
});

let text = await response.text();
if (!response.ok) {
    // Fail loudly. A silent 401 is how this went unnoticed in the source base.
    throw new Error(`auto-report-webhook ${response.status}: ${text}`);
}
console.log('Webhook response:', text);
