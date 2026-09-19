/**
 * The Summary sheet — indicative working figures, live in Excel.
 *
 * Why this exists: the pack is filled in at a client meeting, and the question
 * a client asks in that meeting is "so does it work?". Before this sheet the
 * only answer was "I'll run it when I'm back at the office". Now the workbook
 * closes the funding, strikes the gearing and shows a coverage ratio while
 * everyone is still at the table.
 *
 * What it is emphatically not: a credit assessment. It is arithmetic on what
 * has been typed in, using one plain set of assumptions. The real engine —
 * policy layers, binding-constraint tests, sensitisation — runs in the app when
 * the pack is uploaded, and the wording on the sheet says so in as many words.
 *
 * Every cell reference is composed from the schema through `layout.ts`. See
 * that file's header for why: a hardcoded `$G$5` is correct only until a field
 * is inserted above it, and then it is silently, unfalsifiably wrong.
 */

import type ExcelJS from 'exceljs';
import { argb, type PackBranding } from './branding';
import {
  SUMMARY_SHEET, answerRef, columnRange, derivedColumnRange, sheetRef,
} from './layout';
import {
  HAIRLINE, INK, MUTED, bandRow, calcCell, inputCell, noteCell,
} from './sheetStyle';

const LABEL_COL = 2;
const VALUE_COL = 3;
const NOTE_COL = 4;

/** Where the selected financial period is typed. Referenced by the income rows. */
const PERIOD_CELL = '$C$6';

type Format = 'money' | 'ratio' | 'percent' | 'text';

interface Line {
  kind: 'band' | 'value' | 'input' | 'blank' | 'note';
  label?: string;
  formula?: string;
  value?: string | number;
  note?: string;
  format?: Format;
  /** Rendered heavier — the lines a reader's eye should land on first. */
  emphasis?: boolean;
}

const NUMBER_FORMATS: Record<Format, string> = {
  money: '$#,##0;[Red]($#,##0)',
  ratio: '0.00"x"',
  percent: '0.0%',
  text: '@',
};

/**
 * Total funds needed to complete: price, everything it costs to get there, and
 * any debt being taken out. Costs are summed as a contiguous range over the
 * cost fields rather than added one reference at a time — see `costRange`.
 */
function costRange(): string {
  // The transaction sheet lists its cost fields consecutively, so a range from
  // the first to the last picks up any that are added between them later.
  const first = answerRef('transaction', 'property.stampDuty').replace(/^.*!/, '');
  const last = answerRef('transaction', 'property.contingency').replace(/^.*!/, '');
  return `SUM(${sheetRef('transaction')}!${first}:${last})`;
}

function lines(): Line[] {
  const price = answerRef('transaction', 'property.purchasePrice');
  const valuation = answerRef('transaction', 'property.currentValuation');
  const contribution = answerRef('transaction', 'property.depositOrContribution');
  const refinance = answerRef('transaction', 'property.refinanceAmount');
  const requested = answerRef('transaction', 'loan.requestedLoan');
  const rate = answerRef('transaction', 'loan.actualRatePercent');
  const repayment = answerRef('transaction', 'loan.repaymentType');
  const amortisation = answerRef('transaction', 'loan.amortisationYears');
  const establishment = answerRef('transaction', 'loan.establishmentFees');
  const annualFees = answerRef('transaction', 'loan.annualFees');

  const business = answerRef('purpose', 'ownership.purposeIsPredominantlyBusiness');
  const residential = answerRef('purpose', 'ownership.residentialSecurityInvolved');

  const ownershipShare = columnRange('ownership', 'entity.ownershipPercent');

  const periodLabels = columnRange('incomePeriods', 'period.label');
  const ebitda = columnRange('incomePeriods', 'period.ebitda');
  const salary = columnRange('incomePeriods', 'period.salaryWages');
  const distributions = columnRange('incomePeriods', 'period.distributions');
  const dividends = columnRange('incomePeriods', 'period.dividends');
  const otherIncome = columnRange('incomePeriods', 'period.otherRecurringIncome');

  const addbackPeriod = columnRange('addbacks', 'addback.periodLabel');
  const addbackAmount = columnRange('addbacks', 'addback.amount');
  const addbackConfirmed = columnRange('addbacks', 'addback.confirmed');

  const assetValue = columnRange('portfolio', 'asset.currentValue');
  const assetBalance = columnRange('portfolio', 'asset.currentBalance');
  const assetRent = columnRange('portfolio', 'asset.annualRent');
  const assetOutgoings = columnRange('portfolio', 'asset.outgoings');
  const assetRates = columnRange('portfolio', 'asset.rates');
  const assetInsurance = columnRange('portfolio', 'asset.insurance');
  const assetMaintenance = columnRange('portfolio', 'asset.maintenance');
  const assetManagement = columnRange('portfolio', 'asset.managementCosts');
  const assetRepayments = derivedColumnRange('portfolio');

  const liabilityBalance = columnRange('liabilities', 'liability.balance');
  const liabilityRepayments = derivedColumnRange('liabilities');

  const tenancyRent = columnRange('tenancies', 'tenancy.annualRent');
  const nonRecoverable = answerRef('leaseSettings', 'lease.nonRecoverableOutgoings');
  const vacancy = answerRef('leaseSettings', 'lease.vacancyAllowancePercent');
  const management = answerRef('leaseSettings', 'lease.managementAllowancePercent');

  /** Sum one income column for the selected period only. */
  const forPeriod = (range: string) => `SUMIF(${periodLabels},${PERIOD_CELL},${range})`;

  return [
    { kind: 'band', label: 'ASSESSMENT BASIS' },
    {
      kind: 'input', label: 'Financial period being assessed', format: 'text',
      note: 'Type the period label exactly as it appears on the Income sheet, e.g. FY2025.',
    },
    { kind: 'blank' },

    { kind: 'band', label: 'FUNDS REQUIRED' },
    { kind: 'value', label: 'Purchase price', formula: `N(${price})`, format: 'money' },
    {
      kind: 'value', label: 'Acquisition and establishment costs',
      formula: `${costRange()}+N(${establishment})`, format: 'money',
      note: 'Stamp duty, legal, valuation, lender and broker fees, fit-out, plant, repairs, immediate capital works and contingency.',
    },
    { kind: 'value', label: 'Existing debt being refinanced', formula: `N(${refinance})`, format: 'money' },
    { kind: 'value', label: 'Total funds required', formula: 'N($C$9)+N($C$10)+N($C$11)', format: 'money', emphasis: true },
    { kind: 'blank' },

    { kind: 'band', label: 'FUNDS AVAILABLE' },
    { kind: 'value', label: 'Borrower contribution', formula: `N(${contribution})`, format: 'money' },
    { kind: 'value', label: 'Loan requested', formula: `N(${requested})`, format: 'money' },
    { kind: 'value', label: 'Total funds available', formula: 'N($C$15)+N($C$16)', format: 'money', emphasis: true },
    {
      kind: 'value', label: 'Surplus / (shortfall)', formula: 'N($C$17)-N($C$12)', format: 'money',
      emphasis: true,
      note: 'Negative means the funding does not yet close. Revisit contribution, loan or costs.',
    },
    { kind: 'blank' },

    { kind: 'band', label: 'SECURITY AND GEARING' },
    {
      kind: 'value', label: 'Security value taken', format: 'money',
      formula: `IF(AND(${price}="",${valuation}=""),"",`
        + `IF(${price}="",${valuation},IF(${valuation}="",${price},MIN(${price},${valuation}))))`,
      note: 'The lower of price and valuation, as lending is struck against that figure.',
    },
    { kind: 'value', label: 'Loan to value ratio', formula: 'IFERROR(N($C$16)/$C$21,"")', format: 'percent' },
    {
      kind: 'value', label: 'Total property value across the group',
      formula: `N($C$21)+SUM(${assetValue})`, format: 'money',
      note: 'Subject property plus everything recorded on the Portfolio sheet.',
    },
    {
      kind: 'value', label: 'Total debt across the group',
      formula: `N($C$16)+SUM(${assetBalance})+SUM(${liabilityBalance})`, format: 'money',
    },
    { kind: 'value', label: 'Net position', formula: 'N($C$23)-N($C$24)', format: 'money', emphasis: true },
    { kind: 'value', label: 'Group loan to value ratio', formula: 'IFERROR(N($C$24)/N($C$23),"")', format: 'percent' },
    { kind: 'blank' },

    { kind: 'band', label: 'ANNUAL COMMITMENTS' },
    {
      kind: 'value', label: 'New facility — indicative repayment', format: 'money',
      formula: `IF(OR(${requested}="",${rate}=""),"",`
        + `IF(${repayment}="Interest only",${requested}*${rate}/100,`
        + `IF(${amortisation}>0,-PMT(${rate}/100,${amortisation},${requested}),${requested}*${rate}/100)))`,
      note: 'Interest only uses rate × balance. Principal and interest amortises over the years recorded.',
    },
    { kind: 'value', label: 'Ongoing facility fees', formula: `N(${annualFees})`, format: 'money' },
    {
      kind: 'value', label: 'Existing property repayments', formula: `SUM(${assetRepayments})`, format: 'money',
      note: 'Uses the figure recorded, or derives one from balance, rate and remaining term.',
    },
    { kind: 'value', label: 'Other liability repayments', formula: `SUM(${liabilityRepayments})`, format: 'money' },
    {
      kind: 'value', label: 'Total annual commitments',
      formula: 'N($C$29)+N($C$30)+N($C$31)+N($C$32)', format: 'money', emphasis: true,
    },
    { kind: 'blank' },

    { kind: 'band', label: 'INCOME' },
    {
      kind: 'value', label: 'EBITDA (selected period)', format: 'money',
      formula: `IF(${PERIOD_CELL}="","",${forPeriod(ebitda)})`,
    },
    {
      kind: 'value', label: 'Confirmed add-backs', format: 'money',
      formula: `IF(${PERIOD_CELL}="","",`
        + `SUMIFS(${addbackAmount},${addbackPeriod},${PERIOD_CELL},${addbackConfirmed},"Yes"))`,
      note: 'Only add-backs marked Confirmed are counted.',
    },
    {
      kind: 'value', label: 'Salary, distributions, dividends and other recurring income', format: 'money',
      formula: `IF(${PERIOD_CELL}="","",${forPeriod(salary)}+${forPeriod(distributions)}`
        + `+${forPeriod(dividends)}+${forPeriod(otherIncome)})`,
    },
    { kind: 'value', label: 'Subject property — gross rent', formula: `SUM(${tenancyRent})`, format: 'money' },
    {
      kind: 'value', label: 'Subject property — net rent after allowances', format: 'money',
      formula: `IF($C$39=0,0,$C$39*(1-N(${vacancy})/100)*(1-N(${management})/100)-N(${nonRecoverable}))`,
      note: 'Gross rent less the vacancy and management allowances, less outgoings the landlord absorbs.',
    },
    {
      kind: 'value', label: 'Existing portfolio — net rent', format: 'money',
      formula: `SUM(${assetRent})-SUM(${assetOutgoings})-SUM(${assetRates})`
        + `-SUM(${assetInsurance})-SUM(${assetMaintenance})-SUM(${assetManagement})`,
      note: 'Rent received less outgoings, rates, insurance, maintenance and management.',
    },
    {
      kind: 'value', label: 'Total assessable income (indicative)',
      formula: 'N($C$36)+N($C$37)+N($C$38)+N($C$40)+N($C$41)', format: 'money', emphasis: true,
      note: 'Rent is taken from the property sheets, so the Rent received line on the Income sheet is '
        + 'deliberately left out to avoid counting it twice.',
    },
    { kind: 'blank' },

    { kind: 'band', label: 'COVERAGE' },
    {
      kind: 'value', label: 'Indicative coverage (income ÷ commitments)',
      formula: 'IFERROR(N($C$42)/N($C$33),"")', format: 'ratio', emphasis: true,
      note: 'A working ratio only. Every lender calculates servicing its own way, and the assessment '
        + 'in the app applies policy layers this sheet does not.',
    },
    { kind: 'value', label: 'Indicative annual surplus', formula: 'N($C$42)-N($C$33)', format: 'money' },
    { kind: 'value', label: 'Passing yield on the subject property', formula: 'IFERROR($C$39/N($C$21),"")', format: 'percent' },
    { kind: 'blank' },

    // Checks. Each one answers "is this pack finished?" in words rather than
    // leaving the adviser to compare two numbers on different sheets.
    { kind: 'band', label: 'CHECKS BEFORE THIS LEAVES YOUR DESK' },
    {
      kind: 'value', label: 'Ownership shares total 100%', format: 'text',
      formula: `IF(COUNT(${ownershipShare})=0,"None recorded",`
        + `IF(ABS(SUM(${ownershipShare})-100)<=0.5,"OK",`
        + `"Totals "&TEXT(SUM(${ownershipShare}),"0.0")&"% — must be 100%"))`,
      note: 'Every borrowing party on the Ownership sheet, added together.',
    },
    {
      kind: 'value', label: 'Funding closes', format: 'text',
      formula: `IF(AND(${price}="",${requested}=""),"Not started",`
        + 'IF(N($C$18)>=-1,"OK","Shortfall of "&TEXT(-N($C$18),"$#,##0")))',
    },
    {
      kind: 'value', label: 'Purpose is predominantly business or investment', format: 'text',
      formula: `IF(${business}="","Not answered",IF(${business}="Yes","OK","Specialist review required"))`,
    },
    {
      kind: 'value', label: 'Residential security', format: 'text',
      formula: `IF(${residential}="","Not answered",`
        + `IF(${residential}="No","OK","Residential security offered — flag it"))`,
    },
    {
      kind: 'value', label: 'Valuation supports the price', format: 'text',
      formula: `IF(OR(${price}="",${valuation}=""),"Not available",`
        + `IF(${valuation}>=${price},"OK","Valuation "&TEXT(${price}-${valuation},"$#,##0")&" below price"))`,
    },
    {
      kind: 'value', label: 'Add-backs confirmed against source', format: 'text',
      formula: `IF(COUNT(${addbackAmount})=0,"None recorded",`
        + `IF(COUNTIF(${addbackConfirmed},"Yes")=COUNT(${addbackAmount}),"OK",`
        + `TEXT(COUNT(${addbackAmount})-COUNTIF(${addbackConfirmed},"Yes"),"0")&" not yet confirmed"))`,
      note: 'Unconfirmed add-backs are excluded from the income figure above.',
    },
    {
      kind: 'value', label: 'Financial periods recorded', format: 'text',
      formula: `IF(COUNTA(${periodLabels})=0,"None recorded",`
        + `IF(COUNTA(${periodLabels})>=2,"OK","Only one period — a trend needs two"))`,
    },
    {
      kind: 'value', label: 'Tenancy income recorded', format: 'text',
      formula: `IF(SUM(${tenancyRent})=0,"None recorded","OK")`,
    },
  ];
}

/**
 * Build the sheet.
 *
 * Row positions matter: several formulas above refer to earlier Summary rows by
 * absolute address (`$C$12`). The list is written to start at row 5 and the
 * assertion below fails loudly if a line is inserted that would shift them,
 * rather than letting the workbook ship with quietly wrong totals.
 */
export function buildSummarySheet(
  workbook: ExcelJS.Workbook, branding: PackBranding, periodLabel?: string,
): void {
  const sheet = workbook.addWorksheet(SUMMARY_SHEET, {
    views: [{ state: 'frozen', ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = [{ width: 3 }, { width: 52 }, { width: 20 }, { width: 62 }];

  // Written straight into the label column rather than through `titleRow`,
  // which merges from column A — and a merged A1 swallows anything written to
  // B1 afterwards, leaving the heading in the narrow gutter column.
  const title = sheet.getCell(1, LABEL_COL);
  title.value = 'Indicative working figures';
  title.font = { bold: true, size: 15, color: { argb: argb(branding.brandHex) } };
  sheet.getRow(1).height = 22;

  const intro = sheet.getCell(2, LABEL_COL);
  intro.value = 'Everything here is calculated from the sheets that follow. It is a working view for '
    + 'the adviser — not a credit assessment, a servicing decision or an offer of finance.';
  intro.font = { size: 10, italic: true, color: { argb: argb(`#${MUTED}`) } };
  intro.alignment = { wrapText: true, vertical: 'top' };
  sheet.mergeCells(2, LABEL_COL, 2, NOTE_COL);
  sheet.getRow(2).height = 26;

  let row = 5;
  lines().forEach((line) => {
    if (line.kind === 'blank') { row += 1; return; }

    if (line.kind === 'band') {
      bandRow(sheet, row, LABEL_COL, line.label ?? '', branding);
      sheet.getCell(row, LABEL_COL).border = {
        bottom: { style: 'thin', color: { argb: argb(branding.accentHex) } },
      };
      row += 1;
      return;
    }

    const label = sheet.getCell(row, LABEL_COL);
    label.value = line.label ?? '';
    label.font = { size: 10, bold: Boolean(line.emphasis), color: { argb: argb(`#${INK}`) } };
    label.alignment = { wrapText: true, vertical: 'middle' };

    const value = sheet.getCell(row, VALUE_COL);
    if (line.kind === 'input') {
      inputCell(value, branding);
      if (periodLabel) value.value = periodLabel;
    } else {
      calcCell(value);
      value.value = { formula: line.formula ?? '', date1904: false };
      if (line.emphasis) {
        value.font = { bold: true, size: 11, color: { argb: argb(branding.brandHex) } };
      }
    }
    value.numFmt = NUMBER_FORMATS[line.format ?? 'money'];

    if (line.note) noteCell(sheet.getCell(row, NOTE_COL), line.note);
    row += 1;
  });

  row += 1;
  const disclaimer = sheet.getCell(row, LABEL_COL);
  disclaimer.value = 'This pack is an information-gathering tool. It is not a credit approval, a '
    + 'pre-approval, an offer of finance, financial advice or legal advice, and it does not represent '
    + 'the credit policy of any particular lender.';
  disclaimer.font = { size: 9, italic: true, color: { argb: argb(`#${MUTED}`) } };
  disclaimer.alignment = { wrapText: true, vertical: 'top' };
  sheet.mergeCells(row, LABEL_COL, row, NOTE_COL);
  sheet.getRow(row).height = 28;
  sheet.getRow(row - 1).border = {
    top: { style: 'hair', color: { argb: argb(`#${HAIRLINE}`) } },
  };
}

/**
 * Row addresses the Summary's own formulas depend on.
 *
 * Exported only so a test can assert them. They are the one thing in this file
 * that is positional rather than derived, so they are the one thing that needs
 * pinning from outside.
 */
export const SUMMARY_SELF_REFERENCES = {
  periodCell: PERIOD_CELL,
  totalFundsRequired: 12,
  borrowerContribution: 15,
  loanRequested: 16,
  totalFundsAvailable: 17,
  surplus: 18,
  securityValue: 21,
  groupValue: 23,
  groupDebt: 24,
  newFacilityRepayment: 29,
  facilityFees: 30,
  existingRepayments: 31,
  otherRepayments: 32,
  totalCommitments: 33,
  ebitda: 36,
  confirmedAddbacks: 37,
  otherIncome: 38,
  grossRent: 39,
  netRent: 40,
  portfolioNetRent: 41,
  totalIncome: 42,
} as const;
