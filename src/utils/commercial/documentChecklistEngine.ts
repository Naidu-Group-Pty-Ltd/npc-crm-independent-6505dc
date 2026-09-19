import type { CommercialIndustrialDealProfile } from './commercialDealState';
export type DocumentStatus = 'required' | 'uploaded' | 'reviewed' | 'verified' | 'missing' | 'not applicable';
export interface DynamicDocumentItem { documentName: string; requiredBecause: string; relatedCalculatorField: string; status: DocumentStatus; }
export function buildDynamicDocumentChecklist(profile: CommercialIndustrialDealProfile): DynamicDocumentItem[] {
  const status = (field: string): DocumentStatus => profile.documentVerificationStatus[field] ?? 'required';
  const items: DynamicDocumentItem[] = [
    { documentName: 'Executed contract of sale', requiredBecause: 'Purchase price, GST treatment and settlement terms must be verified.', relatedCalculatorField: 'propertyValuation.purchasePrice', status: status('contract') },
    { documentName: 'Current leases and variations', requiredBecause: 'NOI, lease expiry, recoveries and tenant covenant must be verified.', relatedCalculatorField: 'leaseIncome.grossPassingRent', status: status('leaseDocs') },
    { documentName: 'Outgoings statement / budget', requiredBecause: 'Owner-borne expenses and recoverable outgoings affect actual and lender-adjusted NOI.', relatedCalculatorField: 'operatingExpenses', status: status('outgoings') },
    { documentName: 'Independent valuation', requiredBecause: 'Cap-rate benchmarks are not a valuation and lender LVR relies on value evidence.', relatedCalculatorField: 'propertyValuation.bankValuation', status: status('valuation') },
    { documentName: 'GST advice from solicitor/accountant', requiredBecause: 'Unknown or unverified GST cannot produce Green purchase ability.', relatedCalculatorField: 'gstInputs.treatment', status: status('gstAdvice') },
  ];
  if (profile.dealProfile.assetCategory === 'industrial') items.push({ documentName: 'Environmental / contamination report', requiredBecause: 'Industrial environmental risk cannot be Green while unknown.', relatedCalculatorField: 'riskInputs.environmentalRisk', status: status('environmental') });
  if (profile.purchaserStructure.purchaserType === 'company') items.push({ documentName: 'Company borrower documents', requiredBecause: 'Entity documentation required. Business servicing is separate unless operating cashflow supports debt.', relatedCalculatorField: 'purchaserStructure.purchaserType', status: status('companyDocs') });
  if (String(profile.purchaserStructure.purchaserType).includes('Trust')) items.push({ documentName: 'Trust deed and trustee documents', requiredBecause: 'Trust borrowing powers and trustee details must be confirmed.', relatedCalculatorField: 'purchaserStructure.trusteeDetails', status: status('trustDocs') });
  if (profile.purchaserStructure.purchaserType === 'smsf') items.push({ documentName: 'SMSF LRBA legal pack', requiredBecause: 'SMSF lending requires specialist LRBA review.', relatedCalculatorField: 'purchaserStructure.smsfBalance', status: status('smsfDocs') });
  if (profile.dealProfile.acquisitionPurpose === 'relatedPartyLease' || profile.purchaserStructure.relatedPartyTenant) items.push({ documentName: 'Related-party lease and market rent evidence', requiredBecause: 'Related-party rent requires market support and lender review.', relatedCalculatorField: 'leaseIncome.incomeType', status: status('relatedPartyLease') });
  return items;
}
