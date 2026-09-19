import type { BorrowingInputs, CapexReserveResult } from './calculatorTypes';

const commercialCategories = ['Roof', 'HVAC', 'Lifts', 'Fire compliance', 'Electrical', 'Accessibility / DDA', 'Fit-out', 'Amenities', 'Make-good exposure', 'Tenant incentives', 'General repairs', 'Other'];
const industrialCategories = ['Roof', 'Slab', 'Fire compliance', 'Electrical / power upgrade', 'Hardstand / yard', 'Drainage / stormwater', 'Roller doors', 'Truck access', 'Asbestos', 'Environmental / contamination', 'Trade waste', 'Dangerous goods compliance', 'Make-good exposure', 'Racking / operational improvements', 'General repairs', 'Other'];

export function calculateCapexReserve(inputs: BorrowingInputs, overlayAutoReserve: number): CapexReserveResult {
  const categories = inputs.dealProfile.assetCategory === 'industrial' ? industrialCategories : commercialCategories;
  const manualItems = inputs.acquisitionCosts.manualCapexItems ?? {};
  const manualCapexReserve = Math.max(0, inputs.acquisitionCosts.capexReserve + Object.values(manualItems).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0));
  let autoCapexReserve = Math.max(0, overlayAutoReserve);
  if (inputs.propertyValuation.roofCondition === 'poor') autoCapexReserve += inputs.dealProfile.assetCategory === 'industrial' ? 75000 : 40000;
  if (inputs.propertyValuation.slabCondition === 'poor') autoCapexReserve += 75000;
  if (inputs.riskInputs.environmentalRisk === 'knownContamination') autoCapexReserve += 125000;
  if (inputs.riskInputs.asbestosRisk === 'confirmed') autoCapexReserve += 50000;
  const mode = inputs.acquisitionCosts.capexMode ?? 'manualPlusAuto';
  const totalCapexReserve = mode === 'manualOnly' ? manualCapexReserve : mode === 'autoOnly' ? autoCapexReserve : manualCapexReserve + autoCapexReserve;
  const warnings: string[] = [];
  if (autoCapexReserve > 0) warnings.push('Risk-based capex reserve has been included in funds-to-complete.');
  return { manualCapexReserve, autoCapexReserve, totalCapexReserve, categories: categories.map(name => ({ name, manual: manualItems[name] ?? 0, auto: 0, total: manualItems[name] ?? 0 })), warnings };
}
