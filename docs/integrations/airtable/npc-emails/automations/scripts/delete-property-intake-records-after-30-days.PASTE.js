// PASTE-READY — Delete Property Intake Records After 30 Days (wflOrWaQohUvhvcFb)
// Goes inside the loop `wde3USh8klqOZAuRt`.
// Input variables to declare in the UI:
//   recordId  -> the loop's current item, Airtable record ID
//   tableId   -> tblumTIRYBn92B2ST        (Property Intake Master)
// Body below is byte-identical to the source automation's script.
//
// Read SCRIPT_NODES.md before enabling: the filter above this script reads a
// CREATED_TIME() column that dates the MIGRATION, so all 148 existing rows
// come due at once on 2026-09-17. They are empty shells and deleting them is
// harmless cleanup — but know that is what the first run does.

let { recordId, tableId } = input.config();

await base.getTable(tableId).deleteRecordAsync(recordId);

console.log(`Deleted record: ${recordId}`);
