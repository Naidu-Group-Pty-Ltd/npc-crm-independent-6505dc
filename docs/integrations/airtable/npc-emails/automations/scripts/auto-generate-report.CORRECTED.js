// Auto-generate report — corrected for the target base (appFNPL7iYiuQyHAO)
//
// This replaces auto-generate-report.wacOjjBiIFQqnH96X.js, which is the verbatim
// export and NO LONGER WORKS. Two changes, both explained in
// ../migration/rebuilt/AUTO_GENERATE_REPORT.md:
//
//   1. Sends x-webhook-secret. The endpoint has failed closed since 2026-08-15
//      (supabase/functions/auto-report-webhook/index.ts, commit c76bcd9): it
//      accepts an internal service call OR a constant-time-compared
//      AUTO_REPORT_WEBHOOK_SECRET, and answers 401 to anything else. The
//      exported script sends no credential at all.
//   2. Checks response.ok. The exported script called response.json() and
//      logged it, so a 401 body was logged as if it were a result and the run
//      still reported success.
//
// The URL is UNCHANGED. dduzbchuswwbefdunfct is the live NPC Property Dashboard
// project, not an old one — the earlier note about re-pointing it was wrong.
//
// Declared input variables (all nine, same names the exported script expects):
//   recordId, address, suburb, propertyType, price, beds, baths, state, propertyName
// Plus one new one:
//   webhookSecret — paste the value of AUTO_REPORT_WEBHOOK_SECRET from the
//   Supabase project's Edge Function secrets. Airtable script inputs are
//   visible to anyone who can edit the base; if that is not acceptable, call
//   the endpoint from somewhere that can hold a secret instead.

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
