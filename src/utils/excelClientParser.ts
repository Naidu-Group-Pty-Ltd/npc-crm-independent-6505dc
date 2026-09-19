import * as XLSX from 'xlsx';

// Types for parsed client data
export interface ParsedContact {
  firstName: string | null;
  middleName: string | null;
  surname: string | null;
  mobile: string | null;
  email: string | null;
  gender: string | null;
  dob: string | null;
}

export interface ParsedAddress {
  currentAddress: string | null;
  country: string | null;
  livingSituation: string | null;
}

export interface ParsedFamilyRelations {
  maritalStatus: string | null;
  dependentsCount: number;
}

export interface ParsedEmployment {
  contactType: 'primary' | 'secondary';
  employerName: string | null;
  employmentType: string | null;
  occupationRole: string | null;
  startDate: string | null;
}

export interface ParsedIncome {
  contactType: 'primary' | 'secondary';
  grossSalary: number;
  salaryFrequency: string;
  bonus: number;
  allowance: number;
  commission: number;
  overtimeEssential: number;
  overtimeNonEssential: number;
  otherTaxableIncome: number;
}

export interface ParsedProperty {
  propertyType: 'owner_occupied' | 'investment';
  address: string | null;
  value: number;
  loanRemaining: number;
  interestRate: number;
  ownershipPercentage: number;
  monthlyInterestRepayment: number;
  monthlyBodyCorporate: number;
  monthlyCouncilRates: number;
  monthlyWaterRates: number;
  monthlyRepairsMaintenance: number;
  monthlyPropertyManagement: number;
  monthlyLandlordInsurance: number;
  monthlyBuildingInsurance: number;
  monthlyRentalIncome: number;
  weeklyRentalIncome: number;
  totalMonthlyExpenditure: number;
  netMonthlyCashflow: number;
}

export interface ParsedAsset {
  assetType: 'vehicle' | 'savings' | 'superfund' | 'other';
  vehicleType?: string;
  makeModel?: string;
  institutionName?: string;
  description?: string;
  value: number;
}

export interface ParsedLiability {
  liabilityType: 'mortgage' | 'credit_card' | 'personal_loan' | 'vehicle_loan' | 'student_loan' | 'other';
  providerName?: string;
  currentBalance: number;
  creditLimit?: number;
  interestRate?: number;
  monthlyRepayment: number;
  repaymentType?: string;
}

export interface ParsedPortfolioSummary {
  totalPortfolioValue: number;
  totalDebt: number;
  totalMonthlyExpenditure: number;
  totalMonthlyIncome: number;
  totalMonthlyRentalIncome: number;
  netMonthlyCashFlow: number;
}

export interface ParsedAdditionalContact {
  relationship: string;
  firstName: string | null;
  middleName: string | null;
  surname: string | null;
  mobile: string | null;
  email: string | null;
  gender: string | null;
  dob: string | null;
  displayOrder: number;
}

export interface ParsedClient {
  primaryContact: ParsedContact;
  secondaryContact?: ParsedContact;
  additionalContacts?: ParsedAdditionalContact[];
  address?: ParsedAddress;
  residentialStatus?: string;
  familyRelations?: ParsedFamilyRelations;
  employment?: ParsedEmployment[];
  income?: ParsedIncome[];
  properties?: ParsedProperty[];
  assets?: ParsedAsset[];
  liabilities?: ParsedLiability[];
  portfolioSummary?: ParsedPortfolioSummary;
}

// Helper to safely get cell value
function getCellValue(sheet: XLSX.WorkSheet, cellRef: string): any {
  const cell = sheet[cellRef];
  return cell ? cell.v : null;
}

// Helper to parse currency values with enhanced handling for edge cases
function parseCurrency(value: any): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    let str = value.trim();
    
    // Handle "Paid Off", "N/A", "-" etc.
    if (/^(paid off|n\/a|nil|none|-|—)$/i.test(str)) return 0;
    
    // Handle parenthetical negatives (e.g., "($500)" → -500)
    const parenMatch = str.match(/^\([\$]?\s*([\d.,]+)\s*\)$/);
    if (parenMatch) {
      const num = parseFloat(parenMatch[1].replace(/,/g, ''));
      return isNaN(num) ? 0 : -num;
    }
    
    // Handle "Million" notation (e.g., "1.15Million", "$1.15 million" → 1150000)
    const millionMatch = str.match(/[\$]?\s*([\d.,]+)\s*million/i);
    if (millionMatch) {
      const num = parseFloat(millionMatch[1].replace(/,/g, ''));
      return isNaN(num) ? 0 : num * 1000000;
    }
    
    // Handle "K" notation more flexibly (e.g., "950K", "680K - Cbus", "$85k", "950k")
    const kMatch = str.match(/[\$]?\s*([\d.,]+)\s*k\b/i);
    if (kMatch) {
      const num = parseFloat(kMatch[1].replace(/,/g, ''));
      return isNaN(num) ? 0 : num * 1000;
    }
    
    // Handle range values (e.g., "120-130 Excl Super" → take midpoint, assume thousands)
    const rangeMatch = str.match(/^[\$]?\s*([\d.,]+)\s*[-–]\s*([\d.,]+)/);
    if (rangeMatch) {
      const low = parseFloat(rangeMatch[1].replace(/,/g, ''));
      const high = parseFloat(rangeMatch[2].replace(/,/g, ''));
      if (!isNaN(low) && !isNaN(high)) {
        const midpoint = (low + high) / 2;
        return midpoint < 500 ? midpoint * 1000 : midpoint;
      }
    }
    
    // Handle European-style decimals (e.g., "476.433.17" → 476433.17)
    const periods = (str.match(/\./g) || []).length;
    if (periods > 1) {
      const parts = str.split('.');
      const lastPart = parts.pop();
      str = parts.join('') + '.' + lastPart;
    }
    
    // Standard cleanup: remove currency symbols, commas, spaces
    const cleaned = str.replace(/[$,\s]/g, '').replace(/[()]/g, '-');
    
    // Extract the first valid number from the string
    const numMatch = cleaned.match(/-?[\d.]+/);
    if (numMatch) {
      const parsed = parseFloat(numMatch[0]);
      return isNaN(parsed) ? 0 : parsed;
    }
  }
  return 0;
}

// Helper to extract institution name from combined text (e.g., "680K - Cbus" → "Cbus")
function extractInstitutionFromCombinedText(value: any): string | null {
  if (!value || typeof value !== 'string') return null;
  const str = value.trim();
  
  // Pattern: "Amount - Institution" (e.g., "680K - Cbus", "950K - ANZ")
  const dashMatch = str.match(/[\d.,]+\s*[kKmM]?\s*[-–]\s*(.+)/);
  if (dashMatch) {
    return dashMatch[1].trim();
  }
  
  // Pattern: "Amount Institution" without dash
  const textAfterNum = str.match(/[\d.,]+\s*[kKmM]?\s+([a-zA-Z].+)/);
  if (textAfterNum) {
    return textAfterNum[1].trim();
  }
  
  return null;
}

// Helper to parse percentage values with enhanced handling
function parsePercentage(value: any): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    // If already a decimal (0.059 for 5.9%), convert to percentage
    return value < 1 ? value * 100 : value;
  }
  if (typeof value === 'string') {
    // Handle "$1.00" mistakenly entered as percentage (should be 100%)
    if (value.startsWith('$')) {
      const num = parseCurrency(value);
      // If it's $1.00 or similar, likely meant to be 100%
      if (num === 1) return 100;
      return num;
    }
    const cleaned = value.replace(/[%\s]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

// Helper to parse text-based dates (e.g., "8/9/73", "6/29/81", "1992")
function parseTextDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const str = dateStr.toString().trim();
  
  // Handle year-only (e.g., "1992")
  if (/^\d{4}$/.test(str)) {
    return `${str}-01-01`;
  }
  
  // Handle "X Years" format (e.g., "10 Years")
  if (/^\d+\s*years?$/i.test(str)) {
    return null; // Not a valid date, just duration
  }
  
  // Handle MM/DD/YY or M/D/YY format (US format common in Excel)
  const usMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usMatch) {
    let [, month, day, year] = usMatch;
    // Handle 2-digit year
    if (year.length === 2) {
      const yearNum = parseInt(year);
      year = yearNum > 50 ? `19${year}` : `20${year}`;
    }
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Handle DD/MM/YYYY format (AU format)
  const auMatch = str.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
  if (auMatch) {
    const [, day, month, year] = auMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Return original if no pattern matched
  return str;
}

// Helper to find row by label in column A
function findRowByLabel(sheet: XLSX.WorkSheet, label: string, startRow: number = 1, endRow: number = 200): number | null {
  for (let row = startRow; row <= endRow; row++) {
    const cellValue = getCellValue(sheet, `A${row}`);
    if (cellValue && typeof cellValue === 'string' && cellValue.toLowerCase().includes(label.toLowerCase())) {
      return row;
    }
  }
  return null;
}

// Helper to find column by header
function findColumnByHeader(sheet: XLSX.WorkSheet, header: string, row: number = 1): string | null {
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  for (const col of cols) {
    const cellValue = getCellValue(sheet, `${col}${row}`);
    if (cellValue && typeof cellValue === 'string' && cellValue.toLowerCase().includes(header.toLowerCase())) {
      return col;
    }
  }
  return null;
}

// Parse a single sheet into a client
function parseSheetToClient(sheet: XLSX.WorkSheet): ParsedClient | null {
  try {
    // Find key sections by looking for labels
    const primaryContactRow = findRowByLabel(sheet, 'Primary Contact') || findRowByLabel(sheet, 'First name');
    
    if (!primaryContactRow) {
      return null; // No valid client data found
    }

    // Parse primary contact
    const primaryContact: ParsedContact = {
      firstName: getCellValue(sheet, `B${primaryContactRow + 1}`) || getCellValue(sheet, `B9`),
      middleName: getCellValue(sheet, `B${primaryContactRow + 2}`) || getCellValue(sheet, `B10`),
      surname: getCellValue(sheet, `B${primaryContactRow + 3}`) || getCellValue(sheet, `B11`),
      mobile: getCellValue(sheet, `B${primaryContactRow + 4}`) || getCellValue(sheet, `B12`),
      email: getCellValue(sheet, `B${primaryContactRow + 5}`) || getCellValue(sheet, `B13`),
      gender: getCellValue(sheet, `B${primaryContactRow + 6}`) || getCellValue(sheet, `B14`),
      dob: null
    };

    // Parse DOB for primary contact
    const dobRow = findRowByLabel(sheet, 'date of birth', primaryContactRow, primaryContactRow + 15) ||
                   findRowByLabel(sheet, 'dob', primaryContactRow, primaryContactRow + 15);
    if (dobRow) {
      const dobValue = getCellValue(sheet, `B${dobRow}`);
      if (dobValue) {
        if (typeof dobValue === 'number') {
          const date = XLSX.SSF.parse_date_code(dobValue);
          primaryContact.dob = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
        } else {
          primaryContact.dob = parseTextDate(dobValue?.toString());
        }
      }
    }

    // If no first name found in expected location, search more broadly
    if (!primaryContact.firstName) {
      // Try to find name in column B near "First name" label
      for (let row = 5; row <= 20; row++) {
        const labelCell = getCellValue(sheet, `A${row}`);
        if (labelCell && typeof labelCell === 'string' && labelCell.toLowerCase().includes('first name')) {
          primaryContact.firstName = getCellValue(sheet, `B${row}`);
          primaryContact.middleName = getCellValue(sheet, `B${row + 1}`);
          primaryContact.surname = getCellValue(sheet, `B${row + 2}`);
          break;
        }
      }
    }

    // Parse secondary contact
    const secondaryRow = findRowByLabel(sheet, 'Secondary Contact');
    let secondaryContact: ParsedContact | undefined;
    
    if (secondaryRow) {
      const secFirstName = getCellValue(sheet, `B${secondaryRow + 1}`);
      if (secFirstName) {
        secondaryContact = {
          firstName: secFirstName,
          middleName: getCellValue(sheet, `B${secondaryRow + 2}`),
          surname: getCellValue(sheet, `B${secondaryRow + 3}`),
          mobile: getCellValue(sheet, `B${secondaryRow + 4}`),
          email: getCellValue(sheet, `B${secondaryRow + 5}`),
          gender: getCellValue(sheet, `B${secondaryRow + 6}`),
          dob: null
        };
        
        // Parse DOB for secondary contact
        const secDobRow = findRowByLabel(sheet, 'date of birth', secondaryRow, secondaryRow + 15) ||
                          findRowByLabel(sheet, 'dob', secondaryRow, secondaryRow + 15);
        if (secDobRow && secDobRow > secondaryRow) {
          const secDobValue = getCellValue(sheet, `B${secDobRow}`);
          if (secDobValue) {
            if (typeof secDobValue === 'number') {
              const date = XLSX.SSF.parse_date_code(secDobValue);
              secondaryContact.dob = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
            } else {
              secondaryContact.dob = parseTextDate(secDobValue?.toString());
            }
          }
        }
      }
    }

    // Parse properties - look for "Property (Owner Occupied)" and "Investment Property"
    const properties: ParsedProperty[] = [];

    // Owner Occupied Property - typically in column E/F
    const ownerOccupiedRow = findRowByLabel(sheet, 'Owner Occupied');
    if (ownerOccupiedRow) {
      const value = parseCurrency(getCellValue(sheet, `F${ownerOccupiedRow + 2}`) || getCellValue(sheet, `F10`));
      const loanRemaining = parseCurrency(getCellValue(sheet, `F${ownerOccupiedRow + 3}`) || getCellValue(sheet, `F11`));
      
      if (value > 0 || loanRemaining > 0) {
        properties.push({
          propertyType: 'owner_occupied',
          address: getCellValue(sheet, `F${ownerOccupiedRow + 1}`) || getCellValue(sheet, `F9`),
          value,
          loanRemaining,
          interestRate: parsePercentage(getCellValue(sheet, `F${ownerOccupiedRow + 4}`) || getCellValue(sheet, `F12`)),
          ownershipPercentage: parsePercentage(getCellValue(sheet, `F${ownerOccupiedRow + 5}`) || getCellValue(sheet, `F13`)) || 100,
          monthlyInterestRepayment: parseCurrency(getCellValue(sheet, `F${ownerOccupiedRow + 6}`) || getCellValue(sheet, `F14`)),
          monthlyBodyCorporate: 0,
          monthlyCouncilRates: 0,
          monthlyWaterRates: 0,
          monthlyRepairsMaintenance: 0,
          monthlyPropertyManagement: 0,
          monthlyLandlordInsurance: 0,
          monthlyBuildingInsurance: 0,
          monthlyRentalIncome: 0,
          weeklyRentalIncome: 0,
          totalMonthlyExpenditure: 0,
          netMonthlyCashflow: 0
        });
      }
    }

    // Investment Properties - search for "Investment Property 1", "Investment Property 2", etc.
    for (let propNum = 1; propNum <= 5; propNum++) {
      const invPropRow = findRowByLabel(sheet, `Investment Property ${propNum}`);
      if (invPropRow) {
        const value = parseCurrency(getCellValue(sheet, `F${invPropRow + 2}`));
        const loanRemaining = parseCurrency(getCellValue(sheet, `F${invPropRow + 3}`));
        let monthlyRental = parseCurrency(getCellValue(sheet, `F${invPropRow + 16}`)); // Monthly Rental Income row
        const weeklyRental = parseCurrency(getCellValue(sheet, `G${invPropRow + 16}`));
        
        // Verify and reconcile weekly vs monthly rental income
        if (weeklyRental > 0) {
          const calculatedMonthly = weeklyRental * (52 / 12); // 4.333...
          // If monthly wasn't captured or differs significantly (>5%), use calculated
          if (monthlyRental === 0 || 
              Math.abs(monthlyRental - calculatedMonthly) / calculatedMonthly > 0.05) {
            monthlyRental = Math.round(calculatedMonthly * 100) / 100;
          }
        }
        
        if (value > 0 || monthlyRental > 0) {
          const monthlyBodyCorp = parseCurrency(getCellValue(sheet, `F${invPropRow + 7}`));
          const monthlyCouncil = parseCurrency(getCellValue(sheet, `F${invPropRow + 8}`));
          const monthlyWater = parseCurrency(getCellValue(sheet, `F${invPropRow + 9}`));
          const monthlyRepairs = parseCurrency(getCellValue(sheet, `F${invPropRow + 10}`));
          const monthlyPM = parseCurrency(getCellValue(sheet, `F${invPropRow + 11}`));
          const monthlyLandlord = parseCurrency(getCellValue(sheet, `F${invPropRow + 12}`));
          const monthlyBuilding = parseCurrency(getCellValue(sheet, `F${invPropRow + 13}`));
          const totalExpenditure = parseCurrency(getCellValue(sheet, `F${invPropRow + 14}`));
          
          properties.push({
            propertyType: 'investment',
            address: getCellValue(sheet, `F${invPropRow + 1}`),
            value,
            loanRemaining,
            interestRate: parsePercentage(getCellValue(sheet, `F${invPropRow + 4}`)),
            ownershipPercentage: parsePercentage(getCellValue(sheet, `F${invPropRow + 5}`)) || 100,
            monthlyInterestRepayment: parseCurrency(getCellValue(sheet, `F${invPropRow + 6}`)),
            monthlyBodyCorporate: monthlyBodyCorp,
            monthlyCouncilRates: monthlyCouncil,
            monthlyWaterRates: monthlyWater,
            monthlyRepairsMaintenance: monthlyRepairs,
            monthlyPropertyManagement: monthlyPM,
            monthlyLandlordInsurance: monthlyLandlord,
            monthlyBuildingInsurance: monthlyBuilding,
            monthlyRentalIncome: monthlyRental,
            weeklyRentalIncome: weeklyRental,
            totalMonthlyExpenditure: totalExpenditure,
            netMonthlyCashflow: parseCurrency(getCellValue(sheet, `F${invPropRow + 17}`))
          });
        }
      }
    }

    // Parse Portfolio Summary
    const portfolioRow = findRowByLabel(sheet, 'Portfolio Cashflow Analysis');
    let portfolioSummary: ParsedPortfolioSummary | undefined;
    
    if (portfolioRow) {
      portfolioSummary = {
        totalPortfolioValue: parseCurrency(getCellValue(sheet, `F${portfolioRow + 2}`)),
        totalDebt: parseCurrency(getCellValue(sheet, `F${portfolioRow + 3}`)),
        totalMonthlyExpenditure: parseCurrency(getCellValue(sheet, `F${portfolioRow + 4}`)),
        totalMonthlyIncome: parseCurrency(getCellValue(sheet, `F${portfolioRow + 5}`)),
        totalMonthlyRentalIncome: parseCurrency(getCellValue(sheet, `F${portfolioRow + 6}`)),
        netMonthlyCashFlow: parseCurrency(getCellValue(sheet, `F${portfolioRow + 8}`))
      };
    }

    // Only return if we have valid primary contact data
    if (!primaryContact.firstName && !primaryContact.surname) {
      return null;
    }

    return {
      primaryContact,
      secondaryContact,
      properties: properties.length > 0 ? properties : undefined,
      portfolioSummary
    };
  } catch (error) {
    console.error('Error parsing sheet:', error);
    return null;
  }
}

// Main export function
export function parseExcelToClients(workbook: XLSX.WorkBook): ParsedClient[] {
  const clients: ParsedClient[] = [];
  
  // Process each sheet
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const client = parseSheetToClient(sheet);
    
    if (client) {
      clients.push(client);
    }
  }

  // If no clients found from individual sheets, the workbook might have a different structure
  // Try parsing the first sheet as a single client
  if (clients.length === 0 && workbook.SheetNames.length > 0) {
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const client = parseSheetToClient(firstSheet);
    if (client) {
      clients.push(client);
    }
  }

  return clients;
}
