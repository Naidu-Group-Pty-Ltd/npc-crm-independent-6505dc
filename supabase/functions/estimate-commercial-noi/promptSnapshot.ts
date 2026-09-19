type UnknownRecord = Record<string, unknown>;

const SNAPSHOT_FIELDS = [
  'address', 'state', 'assetCategory', 'assetSubtype', 'gstTreatment',
  'purchasePrice', 'valuation', 'gfaSqm', 'nlaSqm', 'glaSqm', 'siteAreaSqm',
  'siteCoverPct', 'hardstandSqm', 'officePct', 'parkingBays', 'clearanceMetres',
  'yearBuilt', 'zoning', 'leaseStatus', 'wale', 'leaseExpiry', 'capRate',
] as const;

const NOI_INPUT_FIELDS = [
  'grossRent', 'marketRent', 'recovered', 'other', 'vacancy', 'leaseType',
  'noiBasis', 'incentiveAdjustment', 'tenantRiskHaircut', 'totalOperatingExpenses',
] as const;

const OUTGOING_FIELDS = [
  'council', 'water', 'land_tax', 'insurance', 'management',
  'repairs_maintenance', 'utilities', 'cleaning', 'security', 'other',
] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(source: UnknownRecord, fields: readonly string[]): UnknownRecord {
  return Object.fromEntries(fields.flatMap((field) =>
    source[field] === undefined ? [] : [[field, source[field]]],
  ));
}

/** Build the only property context permitted to leave the application. */
export function buildNoiPromptSnapshot(snapshot: unknown): UnknownRecord {
  if (!isRecord(snapshot)) return {};

  const promptSnapshot = pick(snapshot, SNAPSHOT_FIELDS);
  if (isRecord(snapshot.currentNoiInputs)) {
    const currentNoiInputs = pick(snapshot.currentNoiInputs, NOI_INPUT_FIELDS);
    if (isRecord(snapshot.currentNoiInputs.outgoings)) {
      currentNoiInputs.outgoings = pick(snapshot.currentNoiInputs.outgoings, OUTGOING_FIELDS);
    }
    promptSnapshot.currentNoiInputs = currentNoiInputs;
  }

  return promptSnapshot;
}
