/* eslint-disable no-restricted-syntax -- this suite asserts on hex colour
   conversion and on the literal ARGB values written into .xlsx/.docx, so
   hex is the subject under test rather than a styling shortcut. */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { buildIntakeWorkbook, INSTRUCTIONS_SHEET, PACK_MAGIC, packFileName } from '../workbook';
import { parseIntakeWorkbook } from '../parseWorkbook';
import { buildIntakeDocument, documentToBlob } from '../document';
import { ALL_PACK_FIELDS, PACK_SECTIONS } from '../schema';
import { SINGLE_ANSWER_COL, SINGLE_KEY_COL } from '../layout';
import { decodeDate, decodeNumber, decodeTriState, encodeValue, decodeValue } from '../values';
import { DEFAULT_PACK_BRANDING, toHex, fitLogo, argb, bareHex } from '../branding';
import { emptyAssessmentPayload, type AssessmentPayload } from '../../types';
import { runAssessment } from '../../engine';

const AS_AT = new Date('2026-08-03T00:00:00.000Z');

/**
 * Serialise an ExcelJS workbook and read it back with SheetJS — the exact
 * cross-library hop the product makes (ExcelJS writes, SheetJS parses). Tests
 * that skipped the file format entirely would not prove the hop works.
 */
async function toSheetJs(workbook: ExcelJS.Workbook): Promise<XLSX.WorkBook> {
  const buffer = await workbook.xlsx.writeBuffer();
  return XLSX.read(buffer, { type: 'buffer', cellDates: true });
}

/** Build then immediately re-read, for tests that assert on generated content. */
async function buildAndRead(options = {}) {
  return toSheetJs(await buildIntakeWorkbook({ generatedAt: AS_AT, ...options }));
}

/** Write a value into a key/value sheet by field key. */
function setScalar(workbook: XLSX.WorkBook, sheetName: string, key: string, value: unknown) {
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
  // The key column is hidden and does not sit in column A, so find it by
  // content — the same way the parser does.
  const index = rows.findIndex((row) => (row ?? []).some(
    (cell) => String(cell ?? '').trim() === key,
  ));
  if (index === -1) throw new Error(`Field key ${key} not found on ${sheetName}`);
  rows[index][SINGLE_ANSWER_COL - 1] = value as never;
  workbook.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows as never);
}

/** Append a row to a table sheet, keyed by the header row of field keys. */
function addTableRow(workbook: XLSX.WorkBook, sheetName: string, values: Record<string, unknown>) {
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
  const headerIndex = rows.findIndex((row) => (row ?? []).some(
    (cell) => ALL_PACK_FIELDS.has(String(cell ?? '').trim()),
  ));
  if (headerIndex === -1) throw new Error(`No header row on ${sheetName}`);
  const header = rows[headerIndex].map((cell) => String(cell ?? '').trim());

  // First entirely blank row after the label row.
  let target = headerIndex + 2;
  while (target < rows.length && (rows[target] ?? []).some((cell) => String(cell ?? '').trim() !== '')) {
    target += 1;
  }
  if (!rows[target]) rows[target] = [];

  Object.entries(values).forEach(([key, value]) => {
    const column = header.indexOf(key);
    if (column === -1) throw new Error(`Column ${key} not found on ${sheetName}`);
    rows[target][column] = value as never;
  });

  workbook.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows as never);
}

// ---------------------------------------------------------------------------
// Schema integrity
// ---------------------------------------------------------------------------

describe('pack schema', () => {
  it('has globally unique field keys', async () => {
    const keys = PACK_SECTIONS.flatMap((section) => section.fields.map((field) => field.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps every sheet name within Excel’s 31-character limit', async () => {
    PACK_SECTIONS.forEach((section) => {
      expect(section.sheetName.length).toBeLessThanOrEqual(31);
    });
  });

  it('gives every field an interview question', async () => {
    PACK_SECTIONS.forEach((section) => {
      section.fields.forEach((field) => {
        expect(field.question.trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('declares a collection path for every table section', async () => {
    PACK_SECTIONS.filter((section) => section.shape === 'table').forEach((section) => {
      expect(section.collectionPath).toBeTruthy();
    });
  });

  it('offers individual, trust and SMSF structures, not just company', async () => {
    const structure = ALL_PACK_FIELDS.get('entity.structure');
    expect(structure).toBeTruthy();
    expect(structure!.field.options).toEqual(
      expect.arrayContaining(['Individual', 'Trust', 'SMSF', 'Corporate trustee', 'Partnership']),
    );
  });

  it('asks who owns each portfolio asset and liability', async () => {
    expect(ALL_PACK_FIELDS.has('asset.ownershipEntity')).toBe(true);
    expect(ALL_PACK_FIELDS.has('liability.ownershipEntity')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

describe('buildIntakeWorkbook', () => {
  it('creates a sheet for every section plus instructions and proceed', async () => {
    const workbook = await buildAndRead();
    expect(workbook.SheetNames).toContain(INSTRUCTIONS_SHEET);
    expect(workbook.SheetNames).toContain('7. Proceed');
    PACK_SECTIONS.forEach((section) => {
      expect(workbook.SheetNames).toContain(section.sheetName);
    });
  });

  it('stamps a machine-readable format marker', async () => {
    const workbook = await buildAndRead();
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[INSTRUCTIONS_SHEET], { header: 1, defval: '' },
    );
    const marker = rows.find((row) => String(row?.[0]) === '__pack_format');
    expect(marker?.[1]).toBe(PACK_MAGIC);
  });

  it('carries the white-label company name', async () => {
    const workbook = await buildAndRead({ branding: { ...DEFAULT_PACK_BRANDING, companyName: 'Acme Finance Group' } });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[INSTRUCTIONS_SHEET], { header: 1, defval: '' },
    );
    expect(JSON.stringify(rows)).toContain('Acme Finance Group');
  });

  it('writes field keys onto every sheet so the parser can map columns', async () => {
    const workbook = await buildAndRead();
    PACK_SECTIONS.forEach((section) => {
      const flat = JSON.stringify(XLSX.utils.sheet_to_json(
        workbook.Sheets[section.sheetName], { header: 1, defval: '' },
      ));
      section.fields.forEach((field) => expect(flat).toContain(field.key));
    });
  });

  it('leaves blank rows on table sheets to write into', async () => {
    const workbook = await buildAndRead();
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets['3. Ownership'], { header: 1, defval: '', blankrows: true },
    );
    expect(rows.length).toBeGreaterThan(6);
  });

  it('builds a sensible filename', async () => {
    expect(packFileName(
      { ...DEFAULT_PACK_BRANDING, companyName: 'Acme Finance Group' }, 'CI-202608-X9K9U', 'xlsx',
    )).toBe('Acme-Finance-Group-CI-intake-CI-202608-X9K9U.xlsx');
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('pack round-trip', () => {
  it('rejects a workbook that is not one of our packs', async () => {
    const foreign = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      foreign, XLSX.utils.aoa_to_sheet([['Name', 'Value'], ['Anything', 1]]), 'Sheet1',
    );
    const parsed = parseIntakeWorkbook(foreign);
    expect(parsed.recognised).toBe(false);
    expect(parsed.issues[0].severity).toBe('error');
  });

  it('recognises a freshly generated, unfilled pack and imports nothing from it', async () => {
    const parsed = parseIntakeWorkbook(await buildAndRead());
    expect(parsed.recognised).toBe(true);
    // Blank template rows must not become empty entities or liabilities.
    expect(parsed.counts.entities).toBe(0);
    expect(parsed.counts.portfolioAssets).toBe(0);
    expect(parsed.counts.liabilities).toBe(0);
  });

  it('round-trips scalar transaction values', async () => {
    const workbook = await buildAndRead();
    setScalar(workbook, '1. Transaction', 'property.address', '45 Industrial Drive');
    setScalar(workbook, '1. Transaction', 'property.suburb', 'Wetherill Park');
    setScalar(workbook, '1. Transaction', 'property.state', 'NSW');
    setScalar(workbook, '1. Transaction', 'property.purchasePrice', 5_000_000);
    setScalar(workbook, '1. Transaction', 'property.gstTreatment', 'Going concern (GST-free)');
    setScalar(workbook, '1. Transaction', 'loan.requestedLoan', 3_250_000);
    setScalar(workbook, '1. Transaction', 'loan.actualRatePercent', 6.75);

    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.payload.property.address).toBe('45 Industrial Drive');
    expect(parsed.payload.property.suburb).toBe('Wetherill Park');
    expect(parsed.payload.property.state).toBe('NSW');
    expect(parsed.payload.property.purchasePrice).toBe(5_000_000);
    expect(parsed.payload.property.gstTreatment).toBe('going_concern');
    expect(parsed.payload.loan.requestedLoan).toBe(3_250_000);
    expect(parsed.payload.loan.actualRatePercent).toBe(6.75);
  });

  it('decodes select labels back to engine codes', async () => {
    const workbook = await buildAndRead();
    setScalar(workbook, '1. Transaction', 'assessment.type', 'Industrial investment');
    setScalar(workbook, '1. Transaction', 'property.assetClass', 'Cold storage');
    setScalar(workbook, '1. Transaction', 'loan.repaymentType', 'Interest only');

    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.payload.assessmentType).toBe('industrial_investment');
    expect(parsed.payload.property.assetClass).toBe('cold_storage');
    expect(parsed.payload.loan.repaymentType).toBe('interestOnly');
  });

  it('is not confused by re-ordered rows, because it matches on key', async () => {
    const workbook = await buildAndRead();
    setScalar(workbook, '1. Transaction', 'property.purchasePrice', 4_000_000);

    // Reverse the data rows entirely.
    const sheet = workbook.Sheets['1. Transaction'];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
    const reordered = [...rows.slice(0, 3), ...rows.slice(3).reverse()];
    workbook.Sheets['1. Transaction'] = XLSX.utils.aoa_to_sheet(reordered as never);

    expect(parseIntakeWorkbook(workbook).payload.property.purchasePrice).toBe(4_000_000);
  });
});

// ---------------------------------------------------------------------------
// Entity structures — the case the brief specifically called out
// ---------------------------------------------------------------------------

describe('ownership structures', () => {
  it('imports an individual, a family trust and an SMSF together', async () => {
    const workbook = await buildAndRead();
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Jane Smith', 'entity.structure': 'Individual',
      'entity.ownershipPercent': 40,
    });
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Smith Family Trust', 'entity.structure': 'Trust',
      'entity.ownershipPercent': 35, 'entity.trustees': 'Smith Holdings Pty Ltd',
      'entity.beneficiaries': 'Jane Smith, John Smith',
    });
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Smith Super Fund', 'entity.structure': 'SMSF',
      'entity.ownershipPercent': 25, 'entity.trustees': 'Smith Super Pty Ltd',
      'entity.beneficiaries': 'Jane Smith, John Smith',
    });

    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.counts.entities).toBe(3);

    const structures = parsed.payload.ownership.entities.map((entity) => entity.structure);
    expect(structures).toEqual(['individual', 'trust', 'smsf']);

    const smsf = parsed.payload.ownership.entities[2];
    expect(smsf.entityName).toBe('Smith Super Fund');
    expect(smsf.trustees).toBe('Smith Super Pty Ltd');
    expect(smsf.beneficiaries).toContain('Jane Smith');
  });

  it('routes an SMSF borrower to specialist review once calculated', async () => {
    const workbook = await buildAndRead();
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Smith Super Fund', 'entity.structure': 'SMSF', 'entity.ownershipPercent': 100,
    });
    setScalar(workbook, '2. Purpose', 'ownership.borrowingPurpose', 'Acquisition of a warehouse as a fund investment.');
    setScalar(workbook, '2. Purpose', 'ownership.purposeIsPredominantlyBusiness', 'Yes');

    const parsed = parseIntakeWorkbook(workbook);
    const result = runAssessment(parsed.payload, { asAt: AS_AT });
    expect(result.compliance.requiresSpecialistReview).toBe(true);
    expect(result.compliance.flags.some((flag) => flag.code === 'SMSF_BORROWER')).toBe(true);
  });

  it('warns when ownership percentages do not total 100', async () => {
    const workbook = await buildAndRead();
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Jane Smith', 'entity.structure': 'Individual', 'entity.ownershipPercent': 40,
    });
    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.issues.some((issue) => issue.message.includes('total 100%'))).toBe(true);
  });

  it('warns when an asset names an owner absent from the ownership sheet', async () => {
    const workbook = await buildAndRead();
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Jane Smith', 'entity.structure': 'Individual', 'entity.ownershipPercent': 100,
    });
    addTableRow(workbook, '5. Portfolio', {
      'asset.address': '9 Other Road', 'asset.ownershipEntity': 'Unlisted Trust',
      'asset.currentValue': 800_000, 'asset.currentBalance': 400_000,
    });
    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.issues.some((issue) => issue.message.includes('Unlisted Trust'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Portfolio, liabilities and income
// ---------------------------------------------------------------------------

describe('portfolio and income import', () => {
  it('imports portfolio assets with their owning entity', async () => {
    const workbook = await buildAndRead();
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Smith Family Trust', 'entity.structure': 'Trust', 'entity.ownershipPercent': 100,
    });
    addTableRow(workbook, '5. Portfolio', {
      'asset.address': '12 Example Road', 'asset.ownershipEntity': 'Smith Family Trust',
      'asset.assetType': 'Industrial', 'asset.currentValue': 3_000_000,
      'asset.currentBalance': 1_500_000, 'asset.interestRate': 6.5, 'asset.annualRent': 210_000,
    });

    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.counts.portfolioAssets).toBe(1);
    const asset = parsed.payload.portfolio.assets[0];
    expect(asset.address).toBe('12 Example Road');
    expect(asset.ownershipEntity).toBe('Smith Family Trust');
    expect(asset.assetType).toBe('industrial');
    expect(asset.currentValue).toBe(3_000_000);
  });

  it('imports liabilities and preserves the contingent flag', async () => {
    const workbook = await buildAndRead();
    addTableRow(workbook, '5b. Liabilities', {
      'liability.description': 'Director guarantee', 'liability.liabilityType': 'Guarantee',
      'liability.balance': 400_000, 'liability.isContingent': 'Yes',
    });
    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.payload.portfolio.liabilities[0].isContingent).toBe(true);
    expect(parsed.payload.portfolio.liabilities[0].liabilityType).toBe('guarantee');
  });

  it('links add-backs to their period by label', async () => {
    const workbook = await buildAndRead();
    addTableRow(workbook, '4. Income', {
      'period.label': 'FY2025', 'period.periodEnd': '2025-06-30', 'period.ebitda': 620_000,
    });
    addTableRow(workbook, '4b. Add-backs', {
      'addback.periodLabel': 'FY2025', 'addback.category': 'One-off / non-recurring',
      'addback.amount': 45_000, 'addback.reason': 'Settled legal dispute, will not recur.',
      'addback.source': 'FY2025 statements note 7', 'addback.confirmed': 'Yes',
    });

    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.counts.addbacks).toBe(1);
    expect(parsed.payload.income.addbacks[0].periodId).toBe(parsed.payload.income.periods[0].id);
    expect(parsed.payload.income.addbacks[0].confirmed).toBe(true);
  });

  it('flags an add-back whose period does not exist', async () => {
    const workbook = await buildAndRead();
    addTableRow(workbook, '4. Income', { 'period.label': 'FY2025', 'period.periodEnd': '2025-06-30' });
    addTableRow(workbook, '4b. Add-backs', {
      'addback.periodLabel': 'FY2019', 'addback.amount': 10_000,
      'addback.reason': 'x', 'addback.source': 'y',
    });
    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.issues.some((issue) => issue.message.includes('FY2019'))).toBe(true);
  });

  it('imports tenancies for the property being acquired', async () => {
    const workbook = await buildAndRead();
    addTableRow(workbook, '6. Tenancies', {
      'tenancy.tenantName': 'National Logistics Pty Ltd', 'tenancy.annualRent': 350_000,
      'tenancy.leaseExpiry': '2031-01-01', 'tenancy.tenantQuality': 'National tenant',
    });
    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.payload.lease.tenancies[0].tenantName).toBe('National Logistics Pty Ltd');
    expect(parsed.payload.lease.tenancies[0].tenantQuality).toBe('national');
  });
});

// ---------------------------------------------------------------------------
// Robustness — how people actually fill in spreadsheets
// ---------------------------------------------------------------------------

describe('value decoding', () => {
  it('accepts money written the way people type it', async () => {
    expect(decodeNumber('$1,250,000')).toBe(1_250_000);
    expect(decodeNumber('1.25m')).toBe(1_250_000);
    expect(decodeNumber('850k')).toBe(850_000);
    expect(decodeNumber('(500)')).toBe(-500);
    expect(decodeNumber('  7.25 % ')).toBe(7.25);
    expect(decodeNumber('')).toBeUndefined();
    expect(decodeNumber('not a number')).toBeUndefined();
  });

  it('reads Australian day-first dates without shifting the month', async () => {
    expect(decodeDate('03/08/2026')).toBe('2026-08-03');
    expect(decodeDate('3.8.2026')).toBe('2026-08-03');
    expect(decodeDate('2026-08-03')).toBe('2026-08-03');
    expect(decodeDate(new Date(2026, 7, 3))).toBe('2026-08-03');
    expect(decodeDate('rubbish')).toBeUndefined();
  });

  it('keeps "not yet known" distinct from "no"', async () => {
    expect(decodeTriState('Yes')).toBe(true);
    expect(decodeTriState('No')).toBe(false);
    expect(decodeTriState('Not yet known')).toBeNull();
    expect(decodeTriState('')).toBeUndefined();
  });

  it('treats a fractional percentage as a percentage', async () => {
    expect(decodeValue('asset.interestRate', 'percent', 0.065)).toBeCloseTo(6.5, 5);
    expect(decodeValue('asset.interestRate', 'percent', 6.5)).toBe(6.5);
  });

  it('writes zero as blank so the pack reads as an empty form', async () => {
    expect(encodeValue('property.stampDuty', 'money', 0)).toBe('');
    expect(encodeValue('property.stampDuty', 'money', 275_000)).toBe(275_000);
  });

  it('rejects an implausible figure rather than importing it', async () => {
    const workbook = await buildAndRead();
    setScalar(workbook, '1. Transaction', 'property.purchasePrice', 99_000_000_000);
    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.payload.property.purchasePrice).toBe(0);
    expect(parsed.issues.some((issue) => issue.severity === 'error')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pre-fill and end-to-end
// ---------------------------------------------------------------------------

describe('pre-filled pack', () => {
  function populated(): AssessmentPayload {
    const payload = emptyAssessmentPayload('industrial_investment');
    payload.property.address = '45 Industrial Drive';
    payload.property.purchasePrice = 5_000_000;
    payload.loan.requestedLoan = 3_250_000;
    payload.loan.actualRatePercent = 6.75;
    payload.ownership.entities = [{
      id: 'entity-1', entityName: 'Smith Family Trust', structure: 'trust',
      abnAcn: '12 345 678 901', ownershipPercent: 100, directors: '',
      trustees: 'Smith Holdings Pty Ltd', beneficiaries: 'Jane Smith',
      isGuarantor: true, relatedEntities: '', yearsTrading: 8, industry: 'Logistics',
      borrowerExperience: 'experienced', residency: 'australian',
      taxResidency: 'australian', beneficialOwnership: 'Jane Smith 100%',
    }];
    return payload;
  }

  it('pre-fills an existing assessment and reads it straight back', async () => {
    const parsed = parseIntakeWorkbook(await buildAndRead({ payload: populated() }));

    expect(parsed.payload.property.address).toBe('45 Industrial Drive');
    expect(parsed.payload.property.purchasePrice).toBe(5_000_000);
    expect(parsed.payload.loan.requestedLoan).toBe(3_250_000);
    expect(parsed.counts.entities).toBe(1);
    expect(parsed.payload.ownership.entities[0].structure).toBe('trust');
    expect(parsed.payload.ownership.entities[0].trustees).toBe('Smith Holdings Pty Ltd');
  });

  it('marks every imported value as requiring confirmation', async () => {
    const parsed = parseIntakeWorkbook(await buildAndRead({ payload: populated() }));
    expect(parsed.provenance.length).toBeGreaterThan(0);
    parsed.provenance.forEach((entry) => {
      expect(entry.requiresConfirmation).toBe(true);
      expect(entry.source).toBe('document_import');
    });
  });

  it('produces a payload the engine can calculate without throwing', async () => {
    const parsed = parseIntakeWorkbook(await buildAndRead({ payload: populated() }));
    expect(() => runAssessment(parsed.payload, { asAt: AS_AT })).not.toThrow();
  });

  it('carries the assessment reference back for matching', async () => {
    const parsed = parseIntakeWorkbook(await buildAndRead({ assessmentReference: 'CI-202608-X9K9U' }));
    expect(parsed.assessmentReference).toBe('CI-202608-X9K9U');
  });
});

// ---------------------------------------------------------------------------
// White-label branding
// ---------------------------------------------------------------------------

describe('brand colour resolution', () => {
  it('converts the HSL triplet the settings actually store', () => {
    // whitelabel_settings holds "228 94% 45%", not hex. An earlier version of
    // this module assumed hex and silently fell back to the default on every
    // generation, so packs came out unbranded.
    expect(toHex('228 94% 45%', '#000000')).toBe('#0732DF');
    expect(toHex('296 100% 44%', '#000000')).toBe('#D100E0');
  });

  it('passes a hex value straight through', () => {
    expect(toHex('#1F2937', '#000000')).toBe('#1F2937');
    expect(toHex('#1f2937', '#000000')).toBe('#1F2937');
  });

  it('falls back rather than emitting a broken colour', () => {
    expect(toHex('', '#123456')).toBe('#123456');
    expect(toHex(null, '#123456')).toBe('#123456');
    expect(toHex('not a colour', '#123456')).toBe('#123456');
    expect(toHex(42, '#123456')).toBe('#123456');
  });

  it('produces ARGB for ExcelJS and bare hex for docx', () => {
    expect(argb('#0732DF')).toBe('FF0732DF');
    expect(bareHex('#0732DF')).toBe('0732DF');
  });
});

describe('logo sizing', () => {
  const logo = (w: number, h: number) => ({
    data: new Uint8Array(1), extension: 'png' as const, widthPx: w, heightPx: h,
  });

  it('preserves aspect ratio when scaling down', () => {
    expect(fitLogo(logo(600, 300), 200, 200)).toEqual({ width: 200, height: 100 });
    expect(fitLogo(logo(300, 600), 200, 200)).toEqual({ width: 100, height: 200 });
  });

  it('never enlarges a small mark', () => {
    // An 80px signature mark blown up to 200px looks broken in print.
    expect(fitLogo(logo(79, 88), 200, 96)).toEqual({ width: 79, height: 88 });
  });

  it('always returns at least one pixel', () => {
    const fitted = fitLogo(logo(1000, 1), 10, 10);
    expect(fitted.height).toBeGreaterThanOrEqual(1);
  });
});

describe('branded workbook output', () => {
  const branded = {
    ...DEFAULT_PACK_BRANDING,
    companyName: 'Naidu Property Consulting Services',
    brandHex: '#0732DF',
    accentHex: '#D100E0',
    contactRows: [
      { label: 'Website', value: 'www.npcservices.com.au' },
      { label: 'Email', value: 'admin@npcservices.com.au' },
      { label: 'Phone', value: '02 8609 3299' },
      { label: 'Address', value: 'Level 5 Nexus Norwest, 4 Columbia Ct, Norwest NSW 2153' },
      { label: 'ABN', value: '50 684 555 771' },
    ],
  };

  it('writes the company contact block including the ABN', async () => {
    const workbook = await buildAndRead({ branding: branded });
    const flat = JSON.stringify(XLSX.utils.sheet_to_json(
      workbook.Sheets[INSTRUCTIONS_SHEET], { header: 1, defval: '' },
    ));
    expect(flat).toContain('50 684 555 771');
    expect(flat).toContain('admin@npcservices.com.au');
    expect(flat).toContain('Naidu Property Consulting Services');
  });

  it('repeats the contact details on the proceed sheet', async () => {
    const workbook = await buildAndRead({ branding: branded });
    const flat = JSON.stringify(XLSX.utils.sheet_to_json(
      workbook.Sheets['7. Proceed'], { header: 1, defval: '' },
    ));
    expect(flat).toContain('50 684 555 771');
  });

  it('snapshots the brand onto the pack so a reissue reproduces it', async () => {
    const workbook = await buildAndRead({ branding: branded });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[INSTRUCTIONS_SHEET], { header: 1, defval: '' },
    );
    const snapshot = rows.find((row) => String(row?.[0]) === '__brand_snapshot');
    expect(String(snapshot?.[1])).toContain('Naidu Property Consulting Services');
    expect(String(snapshot?.[1])).toContain('#0732DF');
  });

  it('applies the brand fill to header cells', async () => {
    const excel = await buildIntakeWorkbook({ branding: branded, generatedAt: AS_AT });
    const sheet = excel.getWorksheet('1. Transaction')!;
    const fill = sheet.getCell(3, 1).fill as { fgColor?: { argb?: string } };
    expect(fill.fgColor?.argb).toBe('FF0732DF');
  });

  it('declares dropdown validation on a select field', async () => {
    const excel = await buildIntakeWorkbook({ branding: branded, generatedAt: AS_AT });
    const sheet = excel.getWorksheet('1. Transaction')!;
    // property.state offers the eight states — short enough for Excel's
    // 255-character inline list limit.
    let found = false;
    sheet.eachRow((row) => {
      if (String(row.getCell(SINGLE_KEY_COL).value ?? '') === 'property.state') {
        const validation = row.getCell(SINGLE_ANSWER_COL).dataValidation;
        expect(validation?.type).toBe('list');
        expect(String(validation?.formulae?.[0])).toContain('NSW');
        found = true;
      }
    });
    expect(found).toBe(true);
  });

  it('omits validation where the option list exceeds Excel’s inline limit', async () => {
    const excel = await buildIntakeWorkbook({ branding: branded, generatedAt: AS_AT });
    const sheet = excel.getWorksheet('1. Transaction')!;
    // A list over 255 characters makes Excel declare the file corrupt, so the
    // options are left to the guidance column instead.
    sheet.eachRow((row) => {
      const validation = row.getCell(3).dataValidation;
      if (validation?.formulae?.[0]) {
        expect(String(validation.formulae[0]).length).toBeLessThanOrEqual(255);
      }
    });
  });

  it('still round-trips once branded and styled', async () => {
    const workbook = await buildAndRead({ branding: branded });
    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.recognised).toBe(true);
    expect(parsed.counts.entities).toBe(0);
  });
});

describe('branded document output', () => {
  it('builds with an embedded logo without throwing', async () => {
    // A 1x1 PNG is enough to exercise the ImageRun path.
    const png = Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    ), (c) => c.charCodeAt(0));

    const doc = buildIntakeDocument({
      generatedAt: AS_AT,
      branding: {
        ...DEFAULT_PACK_BRANDING,
        companyName: 'Naidu Property Consulting Services',
        brandHex: '#0732DF',
        logo: { data: png, extension: 'png', widthPx: 1, heightPx: 1 },
        contactRows: [{ label: 'ABN', value: '50 684 555 771' }],
      },
    });
    const blob = await documentToBlob(doc);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('builds without a logo when none is configured', async () => {
    const doc = buildIntakeDocument({ generatedAt: AS_AT, branding: DEFAULT_PACK_BRANDING });
    expect((await documentToBlob(doc)).size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Foreign layouts — workbooks that lost their field keys
//
// Real returned packs get rebuilt: copied into fresh files, restructured by an
// assistant, retyped by hand. The wording survives; the key rows do not. These
// tests pin the fallback that matches on question and label text, modelled
// directly on a workbook a user actually sent back.
// ---------------------------------------------------------------------------

describe('foreign layout fallback', () => {
  /** A KV sheet in the rebuilt shape: QUESTION | ANSWER | GUIDANCE, no keys. */
  function foreignKvSheet(rows: Array<[string, unknown]>): XLSX.WorkSheet {
    return XLSX.utils.aoa_to_sheet([
      ['Section title'],
      ['Intro text'],
      ['QUESTION', 'ANSWER', 'GUIDANCE'],
      ...rows.map(([question, answer]) => [question, answer, 'Options: irrelevant']),
    ]);
  }

  /** A table sheet in the rebuilt shape: one UPPERCASE ✱ label row, no keys. */
  function foreignTableSheet(labels: string[], data: unknown[][], notes = true): XLSX.WorkSheet {
    return XLSX.utils.aoa_to_sheet([
      ['Section title'],
      ['Intro text'],
      labels.map((label) => `${label.toUpperCase()} ✱`),
      ...data,
      [''],
      ...(notes ? [['NOTES'], ['Ownership (%) — All parties must total 100%.']] : []),
    ]);
  }

  function foreignWorkbook(): XLSX.WorkBook {
    const workbook = XLSX.utils.book_new();
    // No "Start here" markers at all — recognition rides on the sheet names.
    XLSX.utils.book_append_sheet(workbook, foreignKvSheet([
      ['What kind of transaction is this — an investment purchase, owner-occupied premises, a refinance, or something else? ✱', 'Industrial investment'],
      ['What is the full street address of the property? ✱', '88 Foundry Link'],
      ['Which suburb? ✱', 'Truganina'],
      ['Which state or territory? ✱', 'VIC'],
      ['What is the purchase price, or the price being negotiated? ✱', 5_850_000],
      ['How much are they looking to borrow?', 4_095_000],
      ['What rate are we assuming?', 6.85],
    ]), '1. Transaction');
    XLSX.utils.book_append_sheet(workbook, foreignKvSheet([
      ['Is the borrowing predominantly for business or investment purposes? ✱', 'Yes'],
    ]), '2. Purpose');
    XLSX.utils.book_append_sheet(workbook, foreignTableSheet(
      ['Entity or person name', 'Structure', 'Ownership (%)', 'Trustee(s)'],
      [
        ['Asteron Industrial Holdings Pty Ltd ATF Asteron Trust', 'Trust', 100, 'Asteron Industrial Holdings Pty Ltd'],
        ['Asteron Distribution Services Pty Ltd', 'Company', 0, 'Not applicable'],
      ],
    ), '3. Ownership');
    XLSX.utils.book_append_sheet(workbook, foreignTableSheet(
      ['Tenant', 'Annual rent', 'Lease expiry'],
      // 47756 is 30 September 2030 as an Excel serial — the rebuilt file lost
      // the date formatting, so the cell arrives as a bare number.
      [['Atlas Cold Chain Pty Ltd', 255_000, 47756]],
    ), '6. Tenancies');
    return workbook;
  }

  it('imports a workbook whose key rows were deleted, by question and label text', async () => {
    const parsed = parseIntakeWorkbook(foreignWorkbook());
    expect(parsed.recognised).toBe(true);
    expect(parsed.payload.assessmentType).toBe('industrial_investment');
    expect(parsed.payload.property.address).toBe('88 Foundry Link');
    expect(parsed.payload.property.state).toBe('VIC');
    expect(parsed.payload.property.purchasePrice).toBe(5_850_000);
    expect(parsed.payload.loan.requestedLoan).toBe(4_095_000);
    expect(parsed.payload.loan.actualRatePercent).toBe(6.85);
    expect(parsed.payload.ownership.purposeIsPredominantlyBusiness).toBe(true);
  });

  it('maps uppercased ✱-marked column labels onto table fields', async () => {
    const parsed = parseIntakeWorkbook(foreignWorkbook());
    expect(parsed.counts.entities).toBe(2);
    const [trust, guarantor] = parsed.payload.ownership.entities;
    expect(trust.structure).toBe('trust');
    expect(trust.ownershipPercent).toBe(100);
    expect(trust.trustees).toContain('Asteron');
    expect(guarantor.structure).toBe('company');
  });

  it('reads a bare Excel serial in a date field as the date it encodes', async () => {
    const parsed = parseIntakeWorkbook(foreignWorkbook());
    expect(parsed.payload.lease.tenancies[0].leaseExpiry).toBe('2030-09-30');
  });

  it('stops at a NOTES row instead of minting phantom rows from footnotes', async () => {
    const parsed = parseIntakeWorkbook(foreignWorkbook());
    // The Ownership sheet carries a NOTES block; none of it may become an entity.
    expect(parsed.payload.ownership.entities).toHaveLength(2);
    expect(parsed.payload.ownership.entities.every(
      (entity) => !entity.entityName.toLowerCase().includes('ownership (%)'),
    )).toBe(true);
  });

  it('warns, rather than importing, when a money field holds prose', async () => {
    const workbook = foreignWorkbook();
    XLSX.utils.book_append_sheet(workbook, foreignKvSheet([
      ['Is any equity being released, and what for?', 'No equity release — acquisition funding only.'],
    ]), '1b. Extra');
    // The prose answer sits on a sheet the parser does not know; move it onto
    // the transaction sheet to exercise the money-decode path.
    const parsed = parseIntakeWorkbook((() => {
      const wb = foreignWorkbook();
      const sheet = wb.Sheets['1. Transaction'];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
      rows.push(['Is any equity being released, and what for?', 'No equity release — acquisition funding only.', '']);
      wb.Sheets['1. Transaction'] = XLSX.utils.aoa_to_sheet(rows as never);
      return wb;
    })());
    expect(parsed.payload.property.proposedEquityRelease).toBe(0);
    expect(parsed.issues.some((issue) => issue.message.includes('Proposed equity release'))).toBe(true);
  });

  it('still prefers the field key when both key and heading are present', async () => {
    // My generated layout has the key in column A and the question in column B.
    // The key path must win, reading the answer from column C — not the
    // heading path misreading column B's question text as a label.
    const workbook = await buildAndRead();
    setScalar(workbook, '1. Transaction', 'property.purchasePrice', 4_000_000);
    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.payload.property.purchasePrice).toBe(4_000_000);
  });

  it('takes the first value when a heading appears twice, not the last', async () => {
    const workbook = foreignWorkbook();
    const sheet = workbook.Sheets['1. Transaction'];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
    rows.push(['Which suburb?', 'Duplicated Answer', '']);
    workbook.Sheets['1. Transaction'] = XLSX.utils.aoa_to_sheet(rows as never);
    const parsed = parseIntakeWorkbook(workbook);
    expect(parsed.payload.property.suburb).toBe('Truganina');
  });
});
