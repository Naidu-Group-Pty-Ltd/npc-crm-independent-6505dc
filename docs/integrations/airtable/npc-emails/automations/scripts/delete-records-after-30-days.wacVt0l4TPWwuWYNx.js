// Delete Records After 30 Days  —  node wacVt0l4TPWwuWYNx
// Source automation wflOUO4qcLHFpMUA8 in base apptyShYE0yzL4IGB (NPC Emails).
// Paste into the Airtable UI: the API cannot author a script node.
// Declared input variables: recordId, tableId

let { recordId, tableId } = input.config();

await base.getTable(tableId).deleteRecordAsync(recordId);

console.log(`Deleted record: ${recordId}`);
