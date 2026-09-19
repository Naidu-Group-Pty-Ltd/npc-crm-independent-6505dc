import type { BorrowingInputs } from './calculatorTypes';

const unique = (items: string[]) => Array.from(new Set(items));

export function generateDocumentChecklist(inputs: BorrowingInputs): string[] {
  const base = ['Contract of sale', 'Title search', 'Lease agreement', 'Rent ledger', 'Outgoings statement', 'Tenant incentive deed or side agreement', 'Council rates notice', 'Water rates notice', 'Land tax estimate', 'Insurance certificate', 'Building inspection', 'Fire compliance / essential safety measures report', 'Zoning confirmation', 'Strata / owners corporation records, if applicable', 'Valuation', 'GST treatment confirmation', 'Purchaser entity documents'];
  const industrial = ['Environmental report', 'Asbestos register or asbestos review', 'Roof inspection', 'Slab / structural inspection', 'Fire services report', 'Power capacity confirmation', 'Site plan', 'Floor plan', 'Hardstand / truck access details', 'Trade waste approvals, if applicable', 'Dangerous goods information, if applicable', 'EPA notices or contamination history, if applicable', 'Make-good obligations', 'Plant and equipment ownership / PPSR search, if relevant'];
  const company = ['Company financials', 'Company tax returns', 'BAS statements', 'ASIC extract', 'Director details', 'Existing debt schedule', 'Bank statements', 'Director guarantees'];
  const trust = ['Trust deed', 'Trustee details', 'Appointor details', 'Beneficiary details', 'Trust financials', 'Trust tax returns', 'Trustee resolutions', 'Guarantor details'];
  const owner = ['Operating business financials', 'Business tax returns', 'BAS statements', 'Proposed lease', 'Related-party rent support', 'Current rent evidence', 'Business debt schedule', 'Director guarantees', 'Cashflow forecast'];
  const smsf = ['SMSF deed', 'Bare trust deed', 'LRBA documents', 'Member balances', 'Contribution history', 'Related-party lease review', 'SMSF lender review', 'Accountant / legal confirmation'];
  const items = [...base];
  if (inputs.dealProfile.assetCategory === 'industrial') items.push(...industrial);
  if (['company', 'holdingCompany', 'spv', 'operatingBusiness'].includes(inputs.purchaserStructure.purchaserType)) items.push(...company);
  if (['discretionaryTrust', 'unitTrust'].includes(inputs.purchaserStructure.purchaserType)) items.push(...trust);
  if (inputs.dealProfile.acquisitionPurpose === 'ownerOccupied' || inputs.dealProfile.acquisitionPurpose === 'relatedPartyLease' || inputs.purchaserStructure.relatedPartyTenant) items.push(...owner);
  if (inputs.purchaserStructure.purchaserType === 'smsf') items.push(...smsf);
  return unique(items);
}
