import * as XLSX from 'xlsx';
import { 
  ParsedClient, 
  ParsedContact, 
  ParsedProperty, 
  ParsedPortfolioSummary,
  ParsedEmployment,
  ParsedIncome,
  ParsedAsset,
  ParsedLiability,
  ParsedAddress,
  ParsedFamilyRelations,
  ParsedAdditionalContact
} from './excelClientParser';

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
    // Match number followed by K, regardless of what comes after
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
        // If values are small (<500), likely in thousands
        const midpoint = (low + high) / 2;
        return midpoint < 500 ? midpoint * 1000 : midpoint;
      }
    }
    
    // Handle European-style decimals (e.g., "476.433.17" → 476433.17)
    // Count periods - if more than one, treat all but last as thousand separators
    const periods = (str.match(/\./g) || []).length;
    if (periods > 1) {
      // Replace all periods except the last one
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
  
  // Pattern: "Institution Amount" or "Amount Institution" without dash
  // Only extract if there's clearly text after the number
  const textAfterNum = str.match(/[\d.,]+\s*[kKmM]?\s+([a-zA-Z].+)/);
  if (textAfterNum) {
    return textAfterNum[1].trim();
  }
  
  return null;
}

// Helper to validate if a value looks like it belongs in a text field (not a currency/number)
// Returns null if the value appears to be contaminated data (e.g., "950K - ANZ" in living situation)
function validateTextField(value: any, fieldType: 'livingSituation' | 'residentialStatus' | 'maritalStatus' | 'gender' | 'generic'): string | null {
  if (!value) return null;
  const str = value.toString().trim();
  
  // If it looks like a currency value (e.g., "950K - ANZ", "$500,000"), it's contaminated
  if (/^\$?\d+[\d.,]*\s*[kKmM]?\s*[-–]/.test(str) || /^\$[\d,]+/.test(str)) {
    console.warn(`Data contamination detected in ${fieldType} field: "${str}"`);
    return null;
  }
  
  // Validate based on field type
  switch (fieldType) {
    case 'livingSituation':
      // Valid values: Own, Rent, Boarding, Living with Parents, etc.
      if (/^(own|rent|board|living|lease|mortgage)/i.test(str)) return str;
      if (str.length < 50 && !/\d{3,}/.test(str)) return str; // Short text without large numbers
      return null;
      
    case 'residentialStatus':
      // Valid values: Citizen, Permanent Resident, Visa Holder, etc.
      if (/^(citizen|resident|visa|temporary|permanent)/i.test(str)) return str;
      if (str.length < 50 && !/\d{3,}/.test(str)) return str;
      return null;
      
    case 'maritalStatus':
      // Valid values: Single, Married, De Facto, Divorced, Widowed, etc.
      if (/^(single|married|de facto|defacto|divorced|separated|widowed|partnered)/i.test(str)) return str;
      if (str.length < 30 && !/\d/.test(str)) return str;
      return null;
      
    case 'gender':
      // Valid values: Male, Female, Other, etc.
      if (/^(male|female|other|m|f|non-binary)/i.test(str)) return str;
      if (str.length < 20 && !/\d/.test(str)) return str;
      return null;
      
    default:
      return str;
  }
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

// Helper to find row by label in column A (or any column)
function findRowByLabel(sheet: XLSX.WorkSheet, label: string, startRow: number = 1, endRow: number = 300): number | null {
  const searchLabel = label.toLowerCase().trim();
  for (let row = startRow; row <= endRow; row++) {
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const cellValue = getCellValue(sheet, `${col}${row}`);
      if (cellValue && typeof cellValue === 'string') {
        const cellText = cellValue.toLowerCase().trim();
        if (cellText === searchLabel || cellText.includes(searchLabel)) {
          return row;
        }
      }
    }
  }
  return null;
}

// Helper to get value from adjacent cell (typically column B for labels in A, or F for labels in E)
function getValueNextToLabel(sheet: XLSX.WorkSheet, labelRow: number, labelCol: string): any {
  const nextCols: Record<string, string> = { 'A': 'B', 'B': 'C', 'C': 'D', 'D': 'E', 'E': 'F', 'F': 'G' };
  return getCellValue(sheet, `${nextCols[labelCol] || 'B'}${labelRow}`);
}

// Search for a cell value by looking for a label in the row
function findValueByRowLabel(sheet: XLSX.WorkSheet, label: string, valueCol: string = 'B'): any {
  const row = findRowByLabel(sheet, label);
  if (row) {
    return getCellValue(sheet, `${valueCol}${row}`);
  }
  return null;
}

// Parse personal details from Formara form
function parsePersonalDetails(sheet: XLSX.WorkSheet): { primary: ParsedContact; secondary?: ParsedContact; address?: ParsedAddress; family?: ParsedFamilyRelations; residentialStatus?: string } {
  const primary: ParsedContact = {
    firstName: null,
    middleName: null,
    surname: null,
    mobile: null,
    email: null,
    gender: null,
    dob: null
  };

  // Search for primary contact details
  const firstNameRow = findRowByLabel(sheet, 'first name');
  if (firstNameRow) {
    primary.firstName = getCellValue(sheet, `B${firstNameRow}`);
    
    // Look for subsequent fields
    for (let offset = 1; offset <= 10; offset++) {
      const label = getCellValue(sheet, `A${firstNameRow + offset}`)?.toString().toLowerCase() || '';
      const value = getCellValue(sheet, `B${firstNameRow + offset}`);
      
      if (label.includes('middle')) primary.middleName = value;
      if (label.includes('surname') || label.includes('last name')) primary.surname = value;
      if (label.includes('mobile') || label.includes('phone')) primary.mobile = value?.toString();
      if (label.includes('email')) primary.email = value;
      if (label.includes('gender')) primary.gender = value;
      if (label.includes('dob') || label.includes('date of birth') || label.includes('birth')) {
        if (value) {
          // Handle Excel date serial or string
          if (typeof value === 'number') {
            const date = XLSX.SSF.parse_date_code(value);
            primary.dob = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
          } else {
            primary.dob = parseTextDate(value?.toString());
          }
        }
      }
    }
  }

  // Search for secondary contact
  let secondary: ParsedContact | undefined;
  const secondaryRow = findRowByLabel(sheet, 'secondary contact');
  if (secondaryRow) {
    const secFirstNameRow = findRowByLabel(sheet, 'first name', secondaryRow, secondaryRow + 20);
    if (secFirstNameRow && secFirstNameRow > secondaryRow) {
      const secFirstName = getCellValue(sheet, `B${secFirstNameRow}`);
      if (secFirstName) {
        secondary = {
          firstName: secFirstName,
          middleName: null,
          surname: null,
          mobile: null,
          email: null,
          gender: null,
          dob: null
        };
        
        // Extend search range to include DOB which may be further down
        for (let offset = 1; offset <= 15; offset++) {
          const label = getCellValue(sheet, `A${secFirstNameRow + offset}`)?.toString().toLowerCase() || '';
          const value = getCellValue(sheet, `B${secFirstNameRow + offset}`);
          
          if (label.includes('middle')) secondary.middleName = value;
          if (label.includes('surname') || label.includes('last name')) secondary.surname = value;
          if (label.includes('mobile') || label.includes('phone')) secondary.mobile = value?.toString();
          if (label.includes('email')) secondary.email = value;
          if (label.includes('gender')) secondary.gender = value;
          if (label.includes('dob') || label.includes('date of birth') || label.includes('birth')) {
            if (value) {
              if (typeof value === 'number') {
                const date = XLSX.SSF.parse_date_code(value);
                secondary.dob = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
              } else {
                secondary.dob = parseTextDate(value?.toString());
              }
            }
          }
        }
      }
    }
  }

  // Parse address
  const address: ParsedAddress = {
    currentAddress: null,
    country: null,
    livingSituation: null
  };
  
  const addressRow = findRowByLabel(sheet, 'current address') || findRowByLabel(sheet, 'address');
  if (addressRow) {
    address.currentAddress = getCellValue(sheet, `B${addressRow}`);
  }
  
  const countryRow = findRowByLabel(sheet, 'country');
  if (countryRow) {
    address.country = getCellValue(sheet, `B${countryRow}`);
  }

  // Parse family relations with validation for data contamination
  const family: ParsedFamilyRelations = {
    maritalStatus: null,
    dependentsCount: 0
  };
  
  const maritalRow = findRowByLabel(sheet, 'marital');
  if (maritalRow) {
    const rawMarital = getCellValue(sheet, `B${maritalRow}`);
    family.maritalStatus = validateTextField(rawMarital, 'maritalStatus');
  }
  
  const dependentsRow = findRowByLabel(sheet, 'dependent');
  if (dependentsRow) {
    const depValue = getCellValue(sheet, `B${dependentsRow}`);
    family.dependentsCount = typeof depValue === 'number' ? depValue : parseInt(depValue) || 0;
  }

  // Residential status with validation
  let residentialStatus: string | undefined;
  const residentialRow = findRowByLabel(sheet, 'residential status');
  if (residentialRow) {
    const rawResidential = getCellValue(sheet, `B${residentialRow}`);
    residentialStatus = validateTextField(rawResidential, 'residentialStatus') || undefined;
  }
  
  // Living situation with validation (often stored near address)
  const livingSituationRow = findRowByLabel(sheet, 'living situation') || findRowByLabel(sheet, 'housing');
  if (livingSituationRow) {
    const rawLiving = getCellValue(sheet, `B${livingSituationRow}`);
    address.livingSituation = validateTextField(rawLiving, 'livingSituation');
  }

  return { primary, secondary, address, family, residentialStatus };
}

// Parse additional contacts (beyond primary and secondary)
function parseAdditionalContacts(sheet: XLSX.WorkSheet): ParsedAdditionalContact[] {
  const additionalContacts: ParsedAdditionalContact[] = [];
  
  // Common patterns for additional contacts in Formara forms:
  // - "Third Contact", "3rd Contact", "Contact 3"
  // - "Fourth Contact", "4th Contact", "Contact 4"
  // - "Applicant 3", "Borrower 3"
  // - "Guarantor", "Co-borrower"
  const additionalContactPatterns = [
    { pattern: /third\s*contact|3rd\s*contact|contact\s*3|applicant\s*3|borrower\s*3/i, order: 1, defaultRelation: 'Additional Applicant' },
    { pattern: /fourth\s*contact|4th\s*contact|contact\s*4|applicant\s*4|borrower\s*4/i, order: 2, defaultRelation: 'Additional Applicant' },
    { pattern: /fifth\s*contact|5th\s*contact|contact\s*5|applicant\s*5|borrower\s*5/i, order: 3, defaultRelation: 'Additional Applicant' },
    { pattern: /guarantor/i, order: 10, defaultRelation: 'Guarantor' },
    { pattern: /co-?borrower/i, order: 11, defaultRelation: 'Additional Applicant' },
    { pattern: /trustee/i, order: 12, defaultRelation: 'Trustee' },
    { pattern: /director/i, order: 13, defaultRelation: 'Director' },
  ];

  for (const { pattern, order, defaultRelation } of additionalContactPatterns) {
    const sectionRow = findRowByLabelPattern(sheet, pattern);
    if (sectionRow) {
      const contact = parseContactSection(sheet, sectionRow, defaultRelation, order);
      if (contact && (contact.firstName || contact.surname)) {
        additionalContacts.push(contact);
      }
    }
  }

  // Sort by display order
  return additionalContacts.sort((a, b) => a.displayOrder - b.displayOrder);
}

// Helper to find a row by regex pattern
function findRowByLabelPattern(sheet: XLSX.WorkSheet, pattern: RegExp, startRow: number = 1, endRow: number = 300): number | null {
  for (let row = startRow; row <= endRow; row++) {
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const value = getCellValue(sheet, `${col}${row}`);
      if (value && typeof value === 'string' && pattern.test(value)) {
        return row;
      }
    }
  }
  return null;
}

// Parse a contact section starting from a given row
function parseContactSection(sheet: XLSX.WorkSheet, startRow: number, relationship: string, displayOrder: number): ParsedAdditionalContact | null {
  const contact: ParsedAdditionalContact = {
    relationship,
    firstName: null,
    middleName: null,
    surname: null,
    mobile: null,
    email: null,
    gender: null,
    dob: null,
    displayOrder
  };

  // Search for contact fields within 20 rows of the section header
  const searchEnd = startRow + 20;
  
  for (let row = startRow; row <= searchEnd; row++) {
    const labelA = getCellValue(sheet, `A${row}`)?.toString().toLowerCase() || '';
    const labelB = getCellValue(sheet, `B${row}`)?.toString().toLowerCase() || '';
    const valueB = getCellValue(sheet, `B${row}`);
    const valueC = getCellValue(sheet, `C${row}`);
    
    // Use value from column B or C depending on where the label is
    const value = labelA.includes('first') || labelA.includes('surname') || labelA.includes('name') ? valueB : 
                  (labelB.includes('first') || labelB.includes('surname') ? valueC : valueB);

    if (labelA.includes('first') && labelA.includes('name') && !contact.firstName) {
      contact.firstName = valueB?.toString() || null;
    }
    if ((labelA.includes('middle') || labelA.includes('second name')) && !contact.middleName) {
      contact.middleName = valueB?.toString() || null;
    }
    if ((labelA.includes('surname') || labelA.includes('last name') || labelA.includes('family name')) && !contact.surname) {
      contact.surname = valueB?.toString() || null;
    }
    if ((labelA.includes('mobile') || labelA.includes('phone') || labelA.includes('contact number')) && !contact.mobile) {
      contact.mobile = valueB?.toString() || null;
    }
    if (labelA.includes('email') && !contact.email) {
      contact.email = valueB?.toString() || null;
    }
    if (labelA.includes('gender') && !contact.gender) {
      const genderVal = validateTextField(valueB, 'gender');
      contact.gender = genderVal;
    }
    if ((labelA.includes('dob') || labelA.includes('date of birth') || labelA.includes('birth')) && !contact.dob) {
      if (valueB) {
        if (typeof valueB === 'number') {
          const date = XLSX.SSF.parse_date_code(valueB);
          contact.dob = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
        } else {
          contact.dob = parseTextDate(valueB?.toString());
        }
      }
    }
  }

  return (contact.firstName || contact.surname) ? contact : null;
}

// Parse employment data
function parseEmployment(sheet: XLSX.WorkSheet): ParsedEmployment[] {
  const employment: ParsedEmployment[] = [];

  // Look for primary employment
  const empRow = findRowByLabel(sheet, 'employment') || findRowByLabel(sheet, 'employer');
  if (empRow) {
    const primaryEmp: ParsedEmployment = {
      contactType: 'primary',
      employerName: null,
      employmentType: null,
      occupationRole: null,
      startDate: null
    };

    for (let offset = 0; offset <= 15; offset++) {
      const label = getCellValue(sheet, `A${empRow + offset}`)?.toString().toLowerCase() || '';
      const value = getCellValue(sheet, `B${empRow + offset}`);
      
      if (label.includes('employer') && !label.includes('type')) primaryEmp.employerName = value;
      if (label.includes('employment type') || label.includes('type of employment')) primaryEmp.employmentType = value;
      if (label.includes('occupation') || label.includes('role') || label.includes('position')) primaryEmp.occupationRole = value;
      if (label.includes('start date') || label.includes('commenced')) {
        if (value && typeof value === 'number') {
          const date = XLSX.SSF.parse_date_code(value);
          primaryEmp.startDate = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
        } else if (value) {
          primaryEmp.startDate = value?.toString();
        }
      }
    }

    if (primaryEmp.employerName || primaryEmp.occupationRole) {
      employment.push(primaryEmp);
    }
  }

  // Look for secondary employment (after secondary contact section)
  const secondaryContactRow = findRowByLabel(sheet, 'secondary contact');
  if (secondaryContactRow) {
    const secEmpRow = findRowByLabel(sheet, 'employer', secondaryContactRow, secondaryContactRow + 50);
    if (secEmpRow && secEmpRow > secondaryContactRow) {
      const secondaryEmp: ParsedEmployment = {
        contactType: 'secondary',
        employerName: null,
        employmentType: null,
        occupationRole: null,
        startDate: null
      };

      for (let offset = 0; offset <= 15; offset++) {
        const label = getCellValue(sheet, `A${secEmpRow + offset}`)?.toString().toLowerCase() || '';
        const value = getCellValue(sheet, `B${secEmpRow + offset}`);
        
        if (label.includes('employer') && !label.includes('type')) secondaryEmp.employerName = value;
        if (label.includes('employment type')) secondaryEmp.employmentType = value;
        if (label.includes('occupation') || label.includes('role')) secondaryEmp.occupationRole = value;
      }

      if (secondaryEmp.employerName || secondaryEmp.occupationRole) {
        employment.push(secondaryEmp);
      }
    }
  }

  return employment;
}

// Parse income data
function parseIncome(sheet: XLSX.WorkSheet): ParsedIncome[] {
  const incomeList: ParsedIncome[] = [];

  // Look for income section
  const incomeRow = findRowByLabel(sheet, 'income') || findRowByLabel(sheet, 'gross salary') || findRowByLabel(sheet, 'salary');
  if (incomeRow) {
    const primaryIncome: ParsedIncome = {
      contactType: 'primary',
      grossSalary: 0,
      salaryFrequency: 'annual',
      bonus: 0,
      allowance: 0,
      commission: 0,
      overtimeEssential: 0,
      overtimeNonEssential: 0,
      otherTaxableIncome: 0
    };

    for (let offset = 0; offset <= 20; offset++) {
      const label = getCellValue(sheet, `A${incomeRow + offset}`)?.toString().toLowerCase() || '';
      const value = getCellValue(sheet, `B${incomeRow + offset}`);
      
      if (label.includes('gross salary') || label.includes('base salary')) primaryIncome.grossSalary = parseCurrency(value);
      if (label.includes('frequency')) primaryIncome.salaryFrequency = value || 'annual';
      if (label.includes('bonus')) primaryIncome.bonus = parseCurrency(value);
      if (label.includes('allowance')) primaryIncome.allowance = parseCurrency(value);
      if (label.includes('commission')) primaryIncome.commission = parseCurrency(value);
      if (label.includes('overtime') && label.includes('essential') && !label.includes('non')) {
        primaryIncome.overtimeEssential = parseCurrency(value);
      }
      if (label.includes('overtime') && label.includes('non')) {
        primaryIncome.overtimeNonEssential = parseCurrency(value);
      }
      if (label.includes('other') && label.includes('taxable')) primaryIncome.otherTaxableIncome = parseCurrency(value);
    }

    if (primaryIncome.grossSalary > 0) {
      incomeList.push(primaryIncome);
    }
  }

  // Look for secondary income
  const secondaryContactRow = findRowByLabel(sheet, 'secondary contact');
  if (secondaryContactRow) {
    const secIncomeRow = findRowByLabel(sheet, 'salary', secondaryContactRow, secondaryContactRow + 80);
    if (secIncomeRow && secIncomeRow > secondaryContactRow + 20) {
      const secondaryIncome: ParsedIncome = {
        contactType: 'secondary',
        grossSalary: 0,
        salaryFrequency: 'annual',
        bonus: 0,
        allowance: 0,
        commission: 0,
        overtimeEssential: 0,
        overtimeNonEssential: 0,
        otherTaxableIncome: 0
      };

      for (let offset = 0; offset <= 15; offset++) {
        const label = getCellValue(sheet, `A${secIncomeRow + offset}`)?.toString().toLowerCase() || '';
        const value = getCellValue(sheet, `B${secIncomeRow + offset}`);
        
        if (label.includes('gross salary') || label.includes('base salary')) secondaryIncome.grossSalary = parseCurrency(value);
        if (label.includes('bonus')) secondaryIncome.bonus = parseCurrency(value);
        if (label.includes('allowance')) secondaryIncome.allowance = parseCurrency(value);
        if (label.includes('commission')) secondaryIncome.commission = parseCurrency(value);
      }

      if (secondaryIncome.grossSalary > 0) {
        incomeList.push(secondaryIncome);
      }
    }
  }

  return incomeList;
}

// Helper to check if an asset record has meaningful data (not empty/placeholder)
function hasValidAssetData(asset: ParsedAsset): boolean {
  // Must have either a value greater than 0 or meaningful descriptive data
  if (asset.value > 0) return true;
  
  // Check for meaningful text in other fields (not just whitespace or generic placeholders)
  const isValidText = (text: string | undefined): boolean => {
    if (!text) return false;
    const trimmed = text.trim().toLowerCase();
    if (trimmed.length < 2) return false;
    // Reject common placeholder values
    if (['n/a', 'na', '-', 'nil', 'none', 'tba', 'tbc'].includes(trimmed)) return false;
    return true;
  };
  
  if (isValidText(asset.makeModel)) return true;
  if (isValidText(asset.institutionName)) return true;
  if (isValidText(asset.description)) return true;
  
  return false;
}

// Parse assets with validation to skip empty records
function parseAssets(sheet: XLSX.WorkSheet): ParsedAsset[] {
  const assets: ParsedAsset[] = [];

  // Look for assets section
  const assetsRow = findRowByLabel(sheet, 'assets') || findRowByLabel(sheet, 'vehicle') || findRowByLabel(sheet, 'savings');
  if (!assetsRow) return assets;

  // Parse vehicles with validation
  for (let i = 1; i <= 3; i++) {
    const vehicleRow = findRowByLabel(sheet, `vehicle ${i}`) || (i === 1 ? findRowByLabel(sheet, 'vehicle') : null);
    if (vehicleRow) {
      let makeModel: string | undefined;
      let value = 0;
      let vehicleType: string | undefined;

      for (let offset = 0; offset <= 5; offset++) {
        const label = getCellValue(sheet, `A${vehicleRow + offset}`)?.toString().toLowerCase() || '';
        const cellValue = getCellValue(sheet, `B${vehicleRow + offset}`);
        
        if (label.includes('make') || label.includes('model')) makeModel = cellValue;
        if (label.includes('type')) vehicleType = cellValue;
        if (label.includes('value') || label.includes('worth')) value = parseCurrency(cellValue);
      }

      const asset: ParsedAsset = {
        assetType: 'vehicle',
        vehicleType,
        makeModel,
        value
      };
      
      // Only add if has valid data
      if (hasValidAssetData(asset)) {
        assets.push(asset);
      }
    }
  }

  // Parse savings accounts - handle combined text like "950K - ANZ"
  const savingsRow = findRowByLabel(sheet, 'savings');
  if (savingsRow) {
    for (let offset = 0; offset <= 10; offset++) {
      const label = getCellValue(sheet, `A${savingsRow + offset}`)?.toString().toLowerCase() || '';
      const cellValue = getCellValue(sheet, `B${savingsRow + offset}`);
      
      // Check for combined value+institution format
      if (cellValue && typeof cellValue === 'string') {
        const combinedInstitution = extractInstitutionFromCombinedText(cellValue);
        const amount = parseCurrency(cellValue);
        if (combinedInstitution && amount > 0) {
          const asset: ParsedAsset = {
            assetType: 'savings',
            institutionName: combinedInstitution,
            value: amount
          };
          if (hasValidAssetData(asset)) {
            assets.push(asset);
          }
          continue;
        }
      }
      
      if (label.includes('bank') || label.includes('institution')) {
        const amount = getCellValue(sheet, `B${savingsRow + offset + 1}`);
        const asset: ParsedAsset = {
          assetType: 'savings',
          institutionName: cellValue,
          value: parseCurrency(amount)
        };
        if (hasValidAssetData(asset)) {
          assets.push(asset);
        }
      }
    }
  }

  // Parse superannuation - handle combined text like "680K - Cbus"
  const superRow = findRowByLabel(sheet, 'superannuation') || findRowByLabel(sheet, 'superfund');
  if (superRow) {
    let institutionName: string | undefined;
    let value = 0;

    for (let offset = 0; offset <= 8; offset++) {
      const label = getCellValue(sheet, `A${superRow + offset}`)?.toString().toLowerCase() || '';
      const cellValue = getCellValue(sheet, `B${superRow + offset}`);
      
      if (label.includes('fund') || label.includes('provider') || label.includes('institution')) {
        institutionName = cellValue;
      }
      if (label.includes('balance') || label.includes('value') || label.includes('super')) {
        // Check if it's combined text (e.g., "680K - Cbus")
        const combinedInstitution = extractInstitutionFromCombinedText(cellValue);
        if (combinedInstitution && !institutionName) {
          institutionName = combinedInstitution;
        }
        value = parseCurrency(cellValue);
      }
    }
    
    // Also check the cell right next to "Superfund" label for combined values
    if (value === 0) {
      const directValue = getCellValue(sheet, `B${superRow}`);
      if (directValue) {
        value = parseCurrency(directValue);
        const combinedInstitution = extractInstitutionFromCombinedText(directValue);
        if (combinedInstitution && !institutionName) {
          institutionName = combinedInstitution;
        }
      }
    }

    const asset: ParsedAsset = {
      assetType: 'superfund',
      institutionName,
      value
    };
    
    if (hasValidAssetData(asset)) {
      assets.push(asset);
    }
  }

  return assets;
}

// Parse liabilities - enhanced to handle combined text like "5k Credit Card"
function parseLiabilities(sheet: XLSX.WorkSheet): ParsedLiability[] {
  const liabilities: ParsedLiability[] = [];

  // First, scan for any combined text liabilities in common locations
  // Pattern: "5k Credit Card", "10k Car Loan", etc.
  for (let row = 1; row <= 200; row++) {
    for (const col of ['A', 'B', 'E', 'F']) {
      const cellValue = getCellValue(sheet, `${col}${row}`);
      if (cellValue && typeof cellValue === 'string') {
        const str = cellValue.toLowerCase();
        
        // Check for combined credit card text (e.g., "5k credit card")
        if (str.includes('credit card') && /\d+\s*k?\b/i.test(str)) {
          const amount = parseCurrency(cellValue);
          if (amount > 0) {
            // Check if we haven't already added this
            const exists = liabilities.some(l => 
              l.liabilityType === 'credit_card' && Math.abs(l.currentBalance - amount) < 100
            );
            if (!exists) {
              liabilities.push({
                liabilityType: 'credit_card',
                currentBalance: amount,
                monthlyRepayment: 0
              });
            }
          }
        }
        
        // Check for combined car/vehicle loan text
        if ((str.includes('car loan') || str.includes('vehicle loan')) && /\d+\s*k?\b/i.test(str)) {
          const amount = parseCurrency(cellValue);
          if (amount > 0) {
            const exists = liabilities.some(l => 
              l.liabilityType === 'vehicle_loan' && Math.abs(l.currentBalance - amount) < 100
            );
            if (!exists) {
              liabilities.push({
                liabilityType: 'vehicle_loan',
                currentBalance: amount,
                monthlyRepayment: 0
              });
            }
          }
        }
      }
    }
  }

  // Credit cards - structured parsing
  const creditCardRow = findRowByLabel(sheet, 'credit card');
  if (creditCardRow) {
    for (let cardNum = 1; cardNum <= 4; cardNum++) {
      const cardRow = findRowByLabel(sheet, `credit card ${cardNum}`, creditCardRow) || 
                      (cardNum === 1 ? creditCardRow : null);
      
      if (cardRow) {
        let providerName: string | undefined;
        let currentBalance = 0;
        let creditLimit: number | undefined;
        let interestRate: number | undefined;
        let monthlyRepayment = 0;

        for (let offset = 0; offset <= 8; offset++) {
          const label = getCellValue(sheet, `A${cardRow + offset}`)?.toString().toLowerCase() || '';
          const value = getCellValue(sheet, `B${cardRow + offset}`);
          
          if (label.includes('provider') || label.includes('bank') || label.includes('issuer')) {
            providerName = value;
          }
          if (label.includes('balance') || label.includes('owing')) {
            currentBalance = parseCurrency(value);
          }
          if (label.includes('limit')) {
            creditLimit = parseCurrency(value);
          }
          if (label.includes('rate') || label.includes('interest')) {
            interestRate = parsePercentage(value);
          }
          if (label.includes('repayment') || label.includes('monthly')) {
            monthlyRepayment = parseCurrency(value);
          }
        }

        if (currentBalance > 0 || creditLimit) {
          // Check for duplicates from combined text scan
          const exists = liabilities.some(l => 
            l.liabilityType === 'credit_card' && Math.abs(l.currentBalance - currentBalance) < 100
          );
          if (!exists) {
            liabilities.push({
              liabilityType: 'credit_card',
              providerName,
              currentBalance,
              creditLimit,
              interestRate,
              monthlyRepayment
            });
          }
        }
      }
    }
  }

  // Personal loans
  const personalLoanRow = findRowByLabel(sheet, 'personal loan');
  if (personalLoanRow) {
    let providerName: string | undefined;
    let currentBalance = 0;
    let interestRate: number | undefined;
    let monthlyRepayment = 0;

    for (let offset = 0; offset <= 8; offset++) {
      const label = getCellValue(sheet, `A${personalLoanRow + offset}`)?.toString().toLowerCase() || '';
      const value = getCellValue(sheet, `B${personalLoanRow + offset}`);
      
      if (label.includes('provider') || label.includes('lender')) providerName = value;
      if (label.includes('balance') || label.includes('owing')) currentBalance = parseCurrency(value);
      if (label.includes('rate')) interestRate = parsePercentage(value);
      if (label.includes('repayment')) monthlyRepayment = parseCurrency(value);
    }

    if (currentBalance > 0) {
      liabilities.push({
        liabilityType: 'personal_loan',
        providerName,
        currentBalance,
        interestRate,
        monthlyRepayment
      });
    }
  }

  // Vehicle loans / car loans
  const vehicleLoanRow = findRowByLabel(sheet, 'vehicle loan') || findRowByLabel(sheet, 'car loan');
  if (vehicleLoanRow) {
    let providerName: string | undefined;
    let currentBalance = 0;
    let interestRate: number | undefined;
    let monthlyRepayment = 0;

    for (let offset = 0; offset <= 8; offset++) {
      const label = getCellValue(sheet, `A${vehicleLoanRow + offset}`)?.toString().toLowerCase() || '';
      const value = getCellValue(sheet, `B${vehicleLoanRow + offset}`);
      
      if (label.includes('provider') || label.includes('lender')) providerName = value;
      if (label.includes('balance') || label.includes('owing')) currentBalance = parseCurrency(value);
      if (label.includes('rate')) interestRate = parsePercentage(value);
      if (label.includes('repayment')) monthlyRepayment = parseCurrency(value);
    }

    if (currentBalance > 0) {
      liabilities.push({
        liabilityType: 'vehicle_loan',
        providerName,
        currentBalance,
        interestRate,
        monthlyRepayment
      });
    }
  }

  return liabilities;
}

// Helper to validate if a value is a valid property address (not a financial value or label)
function isValidPropertyAddress(value: any): boolean {
  if (!value || typeof value !== 'string') return false;
  const str = value.trim();
  
  // Reject if it looks like a currency value
  if (/^\$[\d,]+/.test(str) || /^\d+\s*[kKmM]?\s*[-–]/.test(str)) return false;
  
  // Reject if it's a common label
  const labels = ['address', 'value', 'loan', 'rate', 'ownership', 'rental', 'income', 'expenditure', 'cashflow', 'total', 'balance'];
  if (labels.some(l => str.toLowerCase() === l)) return false;
  
  // Reject if it's too short (less than 5 chars) or just a number
  if (str.length < 5 || /^\d+$/.test(str)) return false;
  
  // Accept if it contains typical address patterns (numbers, street names, suburb indicators)
  if (/\d+.*(?:street|st|road|rd|avenue|ave|drive|dr|court|ct|place|pl|crescent|cres|lane|ln|way|boulevard|blvd)/i.test(str)) {
    return true;
  }
  
  // Accept if it looks like an address (contains comma or postcode pattern)
  if (/,/.test(str) || /\b\d{4}\b/.test(str)) {
    return true;
  }
  
  // Accept if reasonably long and doesn't look like a financial field
  if (str.length >= 10 && !/^\d/.test(str) && !/[%$]/.test(str)) {
    return true;
  }
  
  return false;
}

// Helper to detect if we've entered a new section (for boundary detection)
function isNewSection(labelA: string, labelE: string, sectionKeywords: string[]): boolean {
  const combined = `${labelA} ${labelE}`.toLowerCase();
  return sectionKeywords.some(keyword => combined.includes(keyword));
}

// Parse properties with robust section boundary detection and validation
function parseProperties(sheet: XLSX.WorkSheet): ParsedProperty[] {
  const properties: ParsedProperty[] = [];
  
  // Define section boundaries to prevent data bleeding between sections
  const sectionBoundaries = [
    'portfolio cashflow', 'portfolio summary', 'total portfolio', 
    'liabilities', 'assets', 'income section', 'employment section',
    'secondary contact', 'notes', 'comments'
  ];

  // Owner Occupied Property
  const ownerOccupiedRow = findRowByLabel(sheet, 'owner occupied') || findRowByLabel(sheet, 'ppor');
  if (ownerOccupiedRow) {
    const prop: ParsedProperty = {
      propertyType: 'owner_occupied',
      address: null,
      value: 0,
      loanRemaining: 0,
      interestRate: 0,
      ownershipPercentage: 100,
      monthlyInterestRepayment: 0,
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
    };

    // Determine the boundary for this property section
    let maxOffset = 25;
    for (let offset = 1; offset <= 40; offset++) {
      const labelA = getCellValue(sheet, `A${ownerOccupiedRow + offset}`)?.toString().toLowerCase() || '';
      const labelE = getCellValue(sheet, `E${ownerOccupiedRow + offset}`)?.toString().toLowerCase() || '';
      
      // Check for investment property section which marks end of owner-occupied
      if (labelA.includes('investment property') || labelE.includes('investment property')) {
        maxOffset = offset - 1;
        break;
      }
      
      // Check for other section boundaries
      if (isNewSection(labelA, labelE, sectionBoundaries)) {
        maxOffset = offset - 1;
        break;
      }
    }

    // Parse within the bounded section
    for (let offset = 0; offset <= maxOffset; offset++) {
      const labelE = getCellValue(sheet, `E${ownerOccupiedRow + offset}`)?.toString().toLowerCase() || '';
      const labelA = getCellValue(sheet, `A${ownerOccupiedRow + offset}`)?.toString().toLowerCase() || '';
      const valueF = getCellValue(sheet, `F${ownerOccupiedRow + offset}`);
      const valueB = getCellValue(sheet, `B${ownerOccupiedRow + offset}`);
      
      const label = labelE || labelA;
      const value = valueF ?? valueB;

      // Address parsing with validation
      if (label.includes('address') && !prop.address) {
        if (isValidPropertyAddress(value)) {
          prop.address = value;
        }
      }
      
      // Property value - be specific to avoid capturing wrong values
      if ((label.includes('property value') || label.includes('current value') || 
          (label === 'value') || (label.includes('value') && !label.includes('loan'))) && 
          !label.includes('investment') && !label.includes('portfolio') && !label.includes('total')) {
        const parsedValue = parseCurrency(value);
        // Sanity check: property value should be reasonable (between $10k and $50M)
        if (parsedValue >= 10000 && parsedValue <= 50000000) {
          prop.value = parsedValue;
        }
      }
      
      // Loan remaining - explicit label matching
      if ((label.includes('loan remaining') || label.includes('loan balance') || 
          label.includes('remaining loan') || label.includes('balance owing') ||
          (label.includes('loan') && (label.includes('remaining') || label.includes('balance') || label.includes('owing'))))) {
        prop.loanRemaining = parseCurrency(value);
      }
      
      // Interest rate - ensure it's actually a rate field, not ownership
      if ((label.includes('interest rate') || label === 'rate' || label === 'interest') && 
          !label.includes('ownership') && !label.includes('share')) {
        const rate = parsePercentage(value);
        // Interest rates are typically between 2% and 15%
        if (rate >= 2 && rate <= 15) {
          prop.interestRate = rate;
        }
      }
      
      // Ownership percentage - must be explicitly ownership related
      if (label.includes('ownership') || label.includes('share %') || label.includes('ownership %')) {
        const pct = parsePercentage(value);
        // Ownership is typically 50% or 100%
        if (pct >= 1 && pct <= 100) {
          prop.ownershipPercentage = pct;
        }
      }
      
      if (label.includes('monthly') && label.includes('interest') && label.includes('repayment')) {
        prop.monthlyInterestRepayment = parseCurrency(value);
      }
    }

    // Only add property if it has meaningful data
    if (prop.value > 0 || prop.loanRemaining > 0 || isValidPropertyAddress(prop.address)) {
      properties.push(prop);
    }
  }

  // Investment Properties - dynamic detection without assuming fixed count
  // First, find all investment property section starts
  const investmentPropertyRows: number[] = [];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:Z500');
  
  for (let row = 1; row <= range.e.r; row++) {
    const labelA = getCellValue(sheet, `A${row}`)?.toString().toLowerCase() || '';
    const labelE = getCellValue(sheet, `E${row}`)?.toString().toLowerCase() || '';
    const combined = `${labelA} ${labelE}`;
    
    // Match "Investment Property", "Investment Property 1", "Investment Property 2", etc.
    if (/investment\s*property\s*\d*/i.test(combined)) {
      // Avoid duplicates (same row matched in both columns)
      if (!investmentPropertyRows.includes(row)) {
        investmentPropertyRows.push(row);
      }
    }
  }

  // Parse each investment property section
  for (let i = 0; i < investmentPropertyRows.length; i++) {
    const invPropRow = investmentPropertyRows[i];
    
    // Determine the end boundary for this property
    let maxOffset = 30;
    const nextPropertyRow = investmentPropertyRows[i + 1];
    
    if (nextPropertyRow) {
      maxOffset = nextPropertyRow - invPropRow - 1;
    } else {
      // Find the portfolio summary or other section boundary
      for (let offset = 1; offset <= 40; offset++) {
        const labelA = getCellValue(sheet, `A${invPropRow + offset}`)?.toString().toLowerCase() || '';
        const labelE = getCellValue(sheet, `E${invPropRow + offset}`)?.toString().toLowerCase() || '';
        
        if (isNewSection(labelA, labelE, sectionBoundaries)) {
          maxOffset = offset - 1;
          break;
        }
      }
    }

    const prop: ParsedProperty = {
      propertyType: 'investment',
      address: null,
      value: 0,
      loanRemaining: 0,
      interestRate: 0,
      ownershipPercentage: 100,
      monthlyInterestRepayment: 0,
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
    };

    for (let offset = 0; offset <= maxOffset; offset++) {
      const labelE = getCellValue(sheet, `E${invPropRow + offset}`)?.toString().toLowerCase() || '';
      const labelA = getCellValue(sheet, `A${invPropRow + offset}`)?.toString().toLowerCase() || '';
      const valueF = getCellValue(sheet, `F${invPropRow + offset}`);
      const valueB = getCellValue(sheet, `B${invPropRow + offset}`);
      const valueG = getCellValue(sheet, `G${invPropRow + offset}`);
      
      const label = labelE || labelA;
      const value = valueF ?? valueB;

      // Address with validation
      if (label.includes('address') && !prop.address) {
        if (isValidPropertyAddress(value)) {
          prop.address = value;
        }
      }
      
      // Property value - exclude summary fields
      if ((label.includes('property value') || label.includes('current value') || 
          (label === 'value') || (label.includes('value') && !label.includes('loan'))) && 
          !label.includes('total') && !label.includes('portfolio')) {
        const parsedValue = parseCurrency(value);
        if (parsedValue >= 10000 && parsedValue <= 50000000) {
          prop.value = parsedValue;
        }
      }
      
      // Loan - explicit matching
      if ((label.includes('loan remaining') || label.includes('loan balance') || 
          label.includes('remaining loan') || label.includes('balance owing') ||
          (label.includes('loan') && (label.includes('remaining') || label.includes('balance'))))) {
        prop.loanRemaining = parseCurrency(value);
      }
      
      // Interest rate with validation
      if ((label.includes('interest rate') || label === 'rate') && 
          !label.includes('ownership')) {
        const rate = parsePercentage(value);
        if (rate >= 2 && rate <= 15) {
          prop.interestRate = rate;
        }
      }
      
      // Ownership percentage with validation
      if (label.includes('ownership') || label.includes('share %')) {
        const pct = parsePercentage(value);
        if (pct >= 1 && pct <= 100) {
          prop.ownershipPercentage = pct;
        }
      }
      
      if (label.includes('monthly') && label.includes('interest') && label.includes('repayment')) {
        prop.monthlyInterestRepayment = parseCurrency(value);
      }
      if (label.includes('body corporate') || label.includes('strata')) {
        prop.monthlyBodyCorporate = parseCurrency(value);
      }
      if (label.includes('council')) {
        prop.monthlyCouncilRates = parseCurrency(value);
      }
      if (label.includes('water')) {
        prop.monthlyWaterRates = parseCurrency(value);
      }
      if (label.includes('repairs') || label.includes('maintenance')) {
        prop.monthlyRepairsMaintenance = parseCurrency(value);
      }
      if (label.includes('property management') || label.includes('agent fee')) {
        prop.monthlyPropertyManagement = parseCurrency(value);
      }
      if (label.includes('landlord insurance')) {
        prop.monthlyLandlordInsurance = parseCurrency(value);
      }
      if (label.includes('building insurance')) {
        prop.monthlyBuildingInsurance = parseCurrency(value);
      }
      if (label.includes('monthly') && label.includes('rental')) {
        prop.monthlyRentalIncome = parseCurrency(value);
      }
      if (label.includes('weekly') && label.includes('rental')) {
        prop.weeklyRentalIncome = parseCurrency(valueG) || parseCurrency(value);
      }
      // Expenditure within property section only
      if (label.includes('expenditure') && !label.includes('portfolio') && !label.includes('total portfolio')) {
        prop.totalMonthlyExpenditure = parseCurrency(value);
      }
      if (label.includes('net') && label.includes('cashflow') && !label.includes('portfolio')) {
        prop.netMonthlyCashflow = parseCurrency(value);
      }
    }

    // Reconcile weekly vs monthly rental income
    if (prop.weeklyRentalIncome > 0) {
      const calculatedMonthly = prop.weeklyRentalIncome * (52 / 12);
      if (prop.monthlyRentalIncome === 0 || 
          Math.abs(prop.monthlyRentalIncome - calculatedMonthly) / calculatedMonthly > 0.05) {
        prop.monthlyRentalIncome = Math.round(calculatedMonthly * 100) / 100;
      }
    }

    // Only add if it has meaningful data (address or significant financial values)
    if (prop.value > 0 || prop.monthlyRentalIncome > 0 || isValidPropertyAddress(prop.address)) {
      properties.push(prop);
    }
  }

  return properties;
}

// Parse portfolio summary
function parsePortfolioSummary(sheet: XLSX.WorkSheet): ParsedPortfolioSummary | undefined {
  const portfolioRow = findRowByLabel(sheet, 'portfolio cashflow') || findRowByLabel(sheet, 'portfolio summary');
  if (!portfolioRow) return undefined;

  const summary: ParsedPortfolioSummary = {
    totalPortfolioValue: 0,
    totalDebt: 0,
    totalMonthlyExpenditure: 0,
    totalMonthlyIncome: 0,
    totalMonthlyRentalIncome: 0,
    netMonthlyCashFlow: 0
  };

  for (let offset = 0; offset <= 15; offset++) {
    const labelE = getCellValue(sheet, `E${portfolioRow + offset}`)?.toString().toLowerCase() || '';
    const labelA = getCellValue(sheet, `A${portfolioRow + offset}`)?.toString().toLowerCase() || '';
    const valueF = getCellValue(sheet, `F${portfolioRow + offset}`);
    const valueB = getCellValue(sheet, `B${portfolioRow + offset}`);
    
    const label = labelE || labelA;
    const value = valueF ?? valueB;

    if (label.includes('total') && label.includes('portfolio') && label.includes('value')) {
      summary.totalPortfolioValue = parseCurrency(value);
    }
    if (label.includes('total') && (label.includes('debt') || label.includes('liability'))) {
      summary.totalDebt = parseCurrency(value);
    }
    if (label.includes('total') && label.includes('expenditure')) {
      summary.totalMonthlyExpenditure = parseCurrency(value);
    }
    if (label.includes('total') && label.includes('income') && !label.includes('rental')) {
      summary.totalMonthlyIncome = parseCurrency(value);
    }
    if (label.includes('total') && label.includes('rental')) {
      summary.totalMonthlyRentalIncome = parseCurrency(value);
    }
    if (label.includes('net') && (label.includes('cashflow') || label.includes('cash flow'))) {
      summary.netMonthlyCashFlow = parseCurrency(value);
    }
  }

  return summary;
}

// Main parsing function for Formara forms
export function parseFormaraForm(workbook: XLSX.WorkBook): ParsedClient | null {
  // Formara forms typically have data in the first sheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return null;

  const sheet = workbook.Sheets[sheetName];
  
  try {
    // Parse all sections
    const { primary, secondary, address, family, residentialStatus } = parsePersonalDetails(sheet);
    const additionalContacts = parseAdditionalContacts(sheet);
    const employment = parseEmployment(sheet);
    const income = parseIncome(sheet);
    const assets = parseAssets(sheet);
    const liabilities = parseLiabilities(sheet);
    const properties = parseProperties(sheet);
    const portfolioSummary = parsePortfolioSummary(sheet);

    // Only return if we found meaningful data
    if (!primary.firstName && !primary.surname && properties.length === 0) {
      return null;
    }

    return {
      primaryContact: primary,
      secondaryContact: secondary,
      additionalContacts: additionalContacts.length > 0 ? additionalContacts : undefined,
      address,
      residentialStatus,
      familyRelations: family,
      employment: employment.length > 0 ? employment : undefined,
      income: income.length > 0 ? income : undefined,
      properties: properties.length > 0 ? properties : undefined,
      assets: assets.length > 0 ? assets : undefined,
      liabilities: liabilities.length > 0 ? liabilities : undefined,
      portfolioSummary
    };
  } catch (error) {
    console.error('Error parsing Formara form:', error);
    return null;
  }
}
