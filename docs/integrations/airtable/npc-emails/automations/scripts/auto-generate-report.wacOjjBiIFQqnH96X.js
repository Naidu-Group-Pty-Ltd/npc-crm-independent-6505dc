// Auto-generate report  —  node wacOjjBiIFQqnH96X
// Source automation wflV2MkgLeNmGwq0B in base apptyShYE0yzL4IGB (NPC Emails).
// Paste into the Airtable UI: the API cannot author a script node.
// Declared input variables: recordId, address, suburb, propertyType, price, beds, baths, state, propertyName

let config = input.config();

// Build the listing data from your Airtable fields
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

// Send POST request to webhook
let response = await fetch('https://dduzbchuswwbefdunfct.supabase.co/functions/v1/auto-report-webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
});

let result = await response.json();
console.log('Webhook response:', result);
