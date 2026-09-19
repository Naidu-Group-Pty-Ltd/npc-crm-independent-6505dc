// PASTE-READY — Delete Records After 30 Days (wflz5O9df5UjBzd3X)
// Goes inside the loop `wdeD53LsVujdzIcyR`.
// Input variables to declare in the UI:
//   recordId  -> the loop's current item, Airtable record ID
//   tableId   -> tbl7JAawCPdd8QPZP        (Properties)
// Body below is byte-identical to the source automation's script.

let { recordId, tableId } = input.config();

await base.getTable(tableId).deleteRecordAsync(recordId);

console.log(`Deleted record: ${recordId}`);
