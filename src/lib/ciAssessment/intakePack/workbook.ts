/**
 * Intake-pack workbook generator.
 *
 * Produces the branded, editable spreadsheet an organisation takes to a client
 * meeting and drops back into the assessment workspace afterwards.
 *
 * Built with ExcelJS rather than SheetJS. SheetJS's community build cannot
 * write cell styles, embed images or declare data validation — a fill set on a
 * cell comes back `patternType: "none"` after a write — so a white-labelled,
 * dropdown-driven workbook is simply not expressible through it. ExcelJS is
 * loaded on demand so it stays out of the main bundle and only costs the user
 * who actually downloads a pack.
 *
 * The file is still read back by SheetJS in `parseWorkbook.ts`. Both speak
 * standard xlsx, and the round-trip tests write with ExcelJS and read with
 * SheetJS precisely to keep that guarantee honest.
 *
 * LAYOUT CONTRACT — geometry lives in `layout.ts`; the parser and the Summary
 * sheet's formulas both depend on it:
 *
 *   Key/value sheets   question in A, answer in B, guidance in C, and the
 *                      stable field key in D
 *   Table sheets       a row of field keys, human headings directly beneath,
 *                      then data
 *
 * The key column and key row are hidden. That is a change of position from the
 * earlier format, not of principle: matching by key rather than by position is
 * still what makes the round-trip safe. They are hidden because this document
 * goes in front of a client, and a column headed "do not edit" invited exactly
 * the two behaviours it was meant to prevent — people edited it, and people
 * deleted it. A returned pack that lost its keys still imports through the
 * parser's heading fallback, so hiding them costs nothing and the document
 * reads as something you would hand to somebody.
 */

import type ExcelJS from 'exceljs';
import {
  PACK_SECTIONS, type PackField, type PackSection,
} from './schema';
import { encodeValue, toSpreadsheetDate } from './values';
import {
  DEFAULT_PACK_BRANDING, argb, bareHex, fitLogo, type PackBranding,
} from './branding';
import {
  INSTRUCTIONS_SHEET, PROCEED_SHEET, SINGLE_ANSWER_COL, SINGLE_FIRST_DATA_ROW,
  SINGLE_GUIDANCE_COL, SINGLE_HEADER_ROW, SINGLE_KEY_COL, SINGLE_QUESTION_COL,
  TABLE_DATA_ROWS, TABLE_FIRST_DATA_ROW, TABLE_HEADER_ROW, TABLE_KEY_ROW,
  columnLetter, derivedColumnIndex,
} from './layout';
import {
  HAIRLINE, INK, MUTED, PAPER, TINT, bandRow, calcCell, fill, headerCell,
  inputCell, introRow, noteCell, titleRow,
} from './sheetStyle';
import { buildSummarySheet } from './summarySheet';
import type { AssessmentPayload } from '../types';

/** Marker so the parser can recognise one of our packs with confidence. */
export const PACK_MAGIC = 'NPC-CI-INTAKE-PACK';
export const PACK_FORMAT_VERSION = '3';

export { INSTRUCTIONS_SHEET, PROCEED_SHEET };

/** The required marker. A bronze asterisk, explained in the legend. */
const REQUIRED_MARK = '✱';

/** Details recorded on the cover, filled in by hand or by the sample. */
export interface PackDetails {
  clientName?: string;
  propertyDescription?: string;
  reference?: string;
  adviser?: string;
  interviewDate?: string;
  completedDate?: string;
}

export interface BuildPackOptions {
  branding?: PackBranding;
  payload?: AssessmentPayload;
  assessmentReference?: string;
  assessmentTitle?: string;
  generatedAt?: Date;
  /** Cover details. Blank in the template, filled in the worked example. */
  details?: PackDetails;
  /** Answers for the Next steps sheet, which sits outside the field schema. */
  proceed?: ProceedAnswers;
  /** See `EncodeOptions.preserveZeroes`. On when the pack is filled from real data. */
  preserveZeroes?: boolean;
  /**
   * Marks the file as the worked example.
   *
   * Everything the pack produces is client-facing, so a demonstration copy that
   * is not obviously a demonstration copy is a liability — it ends up attached
   * to a real file. When this is set the workbook says so on the cover, in the
   * title bar and in its document properties.
   */
  sample?: boolean;
}

export interface ProceedAnswers {
  answers?: Record<string, string>;
  documents?: Record<string, { held?: string; received?: string }>;
  signOff?: Record<string, string>;
}

const SAMPLE_BANNER = 'FICTIONAL TEST DATA — FOR REFERENCE ONLY';

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, segment) => {
    if (node == null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[segment];
  }, source);
}

/**
 * Project a payload collection item into the shape the pack's fields expect.
 *
 * Almost every field reads straight off the item. Add-backs are the exception:
 * the payload joins an add-back to its period by id, but there are no ids
 * anywhere in the pack — a person writing in a spreadsheet refers to "FY2025",
 * so the pack carries the label and the parser resolves it back on the way in.
 *
 * Without this, a pack pre-filled from an existing assessment wrote no period
 * against any add-back, and every one of them came back attached to the first
 * period on the sheet. Silent, and wrong in the direction that inflates income.
 */
export function projectPackRow(
  section: PackSection, item: unknown, payload?: AssessmentPayload,
): unknown {
  if (section.id !== 'addbacks') return item;
  const periodId = (item as { periodId?: string } | null)?.periodId;
  const label = payload?.income.periods.find((period) => period.id === periodId)?.label ?? '';
  return { ...(item as Record<string, unknown>), periodLabel: label };
}

function guidanceFor(field: PackField): string {
  const parts: string[] = [];
  if (field.help) parts.push(field.help);
  if (field.options?.length) parts.push(`Options: ${field.options.join(' | ')}`);
  if (field.optional) parts.push('Optional.');
  return parts.join(' ');
}

/**
 * Write an encoded value into a cell, as a real Date where the field is a date.
 *
 * Dates have to reach Excel as dates or the `dd/mm/yyyy` format on the cell is
 * decoration on a left-aligned string that will not sort.
 */
function writeValue(cell: ExcelJS.Cell, field: PackField, encoded: string | number): void {
  if (encoded === '') return;
  if (field.type === 'date') {
    const date = toSpreadsheetDate(encoded);
    cell.value = date ?? encoded;
    return;
  }
  cell.value = encoded;
}

/** Number format per field type, so Excel treats money as money. */
function numberFormat(field: PackField): string | undefined {
  switch (field.type) {
    case 'money': return '#,##0';
    case 'percent': return '0.00';
    case 'date': return 'dd/mm/yyyy';
    default: return undefined;
  }
}

/**
 * Excel's list validation is delivered inline and has a hard ~255-character
 * limit. Longer option sets are left free-text with the choices in the guidance
 * column rather than producing a file Excel declares corrupt on open.
 */
function applyValidation(cell: ExcelJS.Cell, field: PackField): void {
  if (!field.options?.length) return;
  const formula = `"${field.options.join(',')}"`;
  if (formula.length > 255) return;
  // A comma inside an option would split it into two list entries.
  if (field.options.some((option) => option.includes(','))) return;

  cell.dataValidation = {
    type: 'list',
    allowBlank: true,
    formulae: [formula],
    showErrorMessage: false,
  };
}

/** Column heading as it appears to a human: upper case, required marked. */
function headingText(field: PackField): string {
  return field.optional
    ? field.label.toUpperCase()
    : `${field.label.toUpperCase()} ${REQUIRED_MARK}`;
}

/** Question as it appears to a human, with the required marker appended. */
function questionText(field: PackField): string {
  return field.optional ? field.question : `${field.question} ${REQUIRED_MARK}`;
}

// ---------------------------------------------------------------------------
// Start here
// ---------------------------------------------------------------------------

async function buildInstructionsSheet(
  workbook: ExcelJS.Workbook, branding: PackBranding,
  options: BuildPackOptions, generatedAt: Date,
): Promise<void> {
  const sheet = workbook.addWorksheet(INSTRUCTIONS_SHEET, {
    properties: { defaultRowHeight: 15 },
    pageSetup: { paperSize: 9, orientation: 'portrait' },
  });
  sheet.columns = [{ width: 3 }, { width: 34 }, { width: 86 }];

  const LABEL = 2;
  const VALUE = 3;

  // Logo, top-left, with clear space beneath it — REPORT_RULES §5 puts the mark
  // on the cover only, never repeated in a running header.
  let cursor = 1;
  if (branding.logo) {
    const { width, height } = fitLogo(branding.logo, 220, 72);
    const imageId = workbook.addImage({
      buffer: branding.logo.data as unknown as ExcelJS.Buffer,
      extension: branding.logo.extension,
    });
    sheet.addImage(imageId, {
      tl: { col: 1.1, row: 0.4 },
      ext: { width, height },
      editAs: 'oneCell',
    });
    // Reserve vertical space so the mark does not sit on top of the wordmark.
    const rowsNeeded = Math.max(3, Math.ceil(height / 20));
    for (let index = 0; index < rowsNeeded; index += 1) {
      sheet.getRow(cursor + index).height = 20;
    }
    cursor += rowsNeeded + 1;
  }

  const title = sheet.getCell(cursor, LABEL);
  title.value = 'Commercial & Industrial Finance Intake';
  title.font = { bold: true, size: 18, color: { argb: argb(branding.brandHex) } };
  sheet.getRow(cursor).height = 26;
  cursor += 1;

  const subtitle = sheet.getCell(cursor, LABEL);
  subtitle.value = `Client fact-find and interview guide — companion workbook · ${branding.companyName}`;
  subtitle.font = { size: 11, color: { argb: argb(`#${INK}`) } };
  if (options.sample) {
    const banner = sheet.getCell(cursor, VALUE);
    banner.value = SAMPLE_BANNER;
    banner.font = { bold: true, size: 11, color: { argb: argb(branding.accentHex) } };
  }
  cursor += 2;

  // ---- Pack details -------------------------------------------------------
  bandRow(sheet, cursor, LABEL, 'PACK DETAILS', branding);
  cursor += 1;
  const details = options.details ?? {};
  ([
    ['Client / borrowing entity', details.clientName],
    ['Property under consideration', details.propertyDescription],
    ['Our reference', details.reference ?? options.assessmentReference],
    ['Adviser conducting the interview', details.adviser],
    ['Date of interview', details.interviewDate],
    ['Date pack completed', details.completedDate],
  ] as Array<[string, string | undefined]>).forEach(([label, value]) => {
    sheet.getCell(cursor, LABEL).value = label;
    sheet.getCell(cursor, LABEL).font = { size: 10, color: { argb: argb(`#${MUTED}`) } };
    const cell = sheet.getCell(cursor, VALUE);
    inputCell(cell, branding);
    if (value) cell.value = value;
    cursor += 1;
  });
  cursor += 1;

  // ---- How to use it ------------------------------------------------------
  bandRow(sheet, cursor, LABEL, 'HOW TO USE IT', branding);
  cursor += 1;
  ([
    ['1.', 'Work through the numbered sheets in order. Each row is a question to ask, worded the way you would say it out loud.'],
    ['2.', 'Record answers in the cream input cells. Where a cell offers a dropdown, use it — typed variations still import, but the list is faster.'],
    ['3.', `Leave anything unknown blank. A blank is safer than a guess, and it tells us what still needs chasing.`],
    ['4.', `Fields marked with a bronze ${REQUIRED_MARK} are needed before the file can be assessed. Everything else sharpens the result.`],
    ['5.', 'Where there is more than one entity, financial period, property, liability or tenancy, use one row per item on the matching sheet.'],
    ['6.', 'Sign the declaration on the last sheet with the client, then drop this file back into the assessment workspace to populate the assessment.'],
  ] as Array<[string, string]>).forEach(([number, text]) => {
    sheet.getCell(cursor, LABEL).value = number;
    sheet.getCell(cursor, LABEL).font = { bold: true, size: 10, color: { argb: argb(branding.accentHex) } };
    sheet.getCell(cursor, LABEL).alignment = { horizontal: 'left', vertical: 'top' };
    noteCell(sheet.getCell(cursor, VALUE), text);
    sheet.getCell(cursor, VALUE).font = { size: 10, color: { argb: argb(`#${INK}`) } };
    sheet.getRow(cursor).height = 26;
    cursor += 1;
  });
  cursor += 1;

  // ---- Conventions --------------------------------------------------------
  bandRow(sheet, cursor, LABEL, 'CONVENTIONS', branding);
  cursor += 1;
  ([
    ['Amounts', 'Australian dollars. Exclude GST unless the question says otherwise.'],
    ['Percentages', 'Enter the number only — 6.5 means 6.5%, 100 means 100%.'],
    ['Dates', 'dd/mm/yyyy.'],
    ['Cream cells', 'Yours to fill in.'],
    ['Sand cells', 'Calculated. Leave them alone — they update themselves.'],
    ['Blanks', 'Safer than a guess. A blank tells us what still needs chasing; a guess does not.'],
  ] as Array<[string, string]>).forEach(([label, text]) => {
    sheet.getCell(cursor, LABEL).value = label;
    sheet.getCell(cursor, LABEL).font = { bold: true, size: 10, color: { argb: argb(`#${INK}`) } };
    noteCell(sheet.getCell(cursor, VALUE), text);
    cursor += 1;
  });
  cursor += 1;

  // ---- Structures ---------------------------------------------------------
  // Load-bearing, not decorative: the product's default assumption used to be a
  // company borrower, and every trust and SMSF purchase read as a broken file.
  bandRow(sheet, cursor, LABEL, 'A NOTE ON STRUCTURES', branding);
  cursor += 1;
  const structures = sheet.getCell(cursor, VALUE);
  structures.value = 'Individuals, family trusts and self-managed super funds acquire commercial and '
    + 'industrial property just as often as companies do, and each is assessed differently. On the '
    + 'Ownership sheet, record the structure exactly as it will appear on the contract, including '
    + 'trustees and fund members. On the Portfolio and Liabilities sheets, name the entity that holds '
    + 'each asset and debt. That is what lets the assessment combine the whole group into one '
    + 'borrowing position rather than looking at this purchase in isolation.';
  structures.font = { size: 10, color: { argb: argb(`#${INK}`) } };
  structures.alignment = { wrapText: true, vertical: 'top' };
  sheet.getRow(cursor).height = 74;
  cursor += 2;

  // ---- Contact block ------------------------------------------------------
  // Website, email, phone, address and ABN. This is the only place an ABN
  // exists in the product, so a client-facing document that omits it is
  // incomplete — REPORT_RULES §6.
  if (branding.contactRows.length) {
    bandRow(sheet, cursor, LABEL, branding.companyName.toUpperCase(), branding);
    cursor += 1;
    branding.contactRows.forEach((row) => {
      sheet.getCell(cursor, LABEL).value = row.label;
      sheet.getCell(cursor, LABEL).font = { size: 10, color: { argb: argb(`#${MUTED}`) } };
      sheet.getCell(cursor, VALUE).value = row.value;
      sheet.getCell(cursor, VALUE).font = { size: 10, color: { argb: argb(`#${INK}`) } };
      cursor += 1;
    });
    cursor += 1;
  }

  const disclaimer = sheet.getCell(cursor, LABEL);
  disclaimer.value = 'This pack is an information-gathering tool. It is not a credit approval, a '
    + 'pre-approval, an offer of finance, financial advice or legal advice, and it does not represent '
    + 'the credit policy of any particular lender.';
  disclaimer.font = { size: 9, italic: true, color: { argb: argb(`#${MUTED}`) } };
  disclaimer.alignment = { wrapText: true, vertical: 'top' };
  sheet.mergeCells(cursor, LABEL, cursor, VALUE);
  sheet.getRow(cursor).height = 30;
  cursor += 2;

  // Machine-readable markers, in columns A and B where the parser looks. Kept
  // visible but tiny and grey: a hidden row is a row somebody deletes because
  // they cannot see why it is there.
  ([
    ['__pack_format', PACK_MAGIC],
    ['__pack_version', PACK_FORMAT_VERSION],
    ['__assessment_reference', options.assessmentReference ?? ''],
    ['__pack_kind', options.sample ? 'worked-example' : 'blank'],
    ['__brand_snapshot', `${branding.companyName} | ${branding.brandHex} | ${branding.resolvedAt}`],
    ['__generated', generatedAt.toISOString()],
  ] as Array<[string, string]>).forEach(([marker, value]) => {
    sheet.getCell(cursor, 1).value = marker;
    sheet.getCell(cursor, 2).value = value;
    sheet.getRow(cursor).font = { size: 8, color: { argb: argb(`#${HAIRLINE}`) } };
    cursor += 1;
  });
}

// ---------------------------------------------------------------------------
// Question sheets
// ---------------------------------------------------------------------------

function buildSingleSheet(
  workbook: ExcelJS.Workbook, section: PackSection, branding: PackBranding,
  options: BuildPackOptions,
): void {
  const sheet = workbook.addWorksheet(section.sheetName.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: SINGLE_HEADER_ROW }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = [{ width: 78 }, { width: 30 }, { width: 62 }, { width: 30 }];
  const encodeOptions = { preserveZeroes: Boolean(options.preserveZeroes) };

  titleRow(sheet, 1, section.title, branding, 3);
  introRow(sheet, 2, section.intro, 3);

  const header = sheet.getRow(SINGLE_HEADER_ROW);
  headerCell(header.getCell(SINGLE_QUESTION_COL), 'QUESTION', branding);
  headerCell(header.getCell(SINGLE_ANSWER_COL), 'ANSWER', branding);
  headerCell(header.getCell(SINGLE_GUIDANCE_COL), 'GUIDANCE', branding);
  headerCell(header.getCell(SINGLE_KEY_COL), 'FIELD KEY', branding);
  header.height = 22;

  section.fields.forEach((field, index) => {
    const rowNumber = SINGLE_FIRST_DATA_ROW + index;
    const row = sheet.getRow(rowNumber);

    const questionCell = row.getCell(SINGLE_QUESTION_COL);
    questionCell.value = questionText(field);
    questionCell.alignment = { wrapText: true, vertical: 'top' };
    questionCell.font = { size: 10, bold: !field.optional, color: { argb: argb(`#${INK}`) } };

    const answerCell = row.getCell(SINGLE_ANSWER_COL);
    const current = options.payload ? readPath(options.payload, field.path) : undefined;
    const encoded = encodeValue(field.key, field.type, current, encodeOptions);
    writeValue(answerCell, field, encoded);
    inputCell(answerCell, branding);
    const format = numberFormat(field);
    if (format) answerCell.numFmt = format;
    applyValidation(answerCell, field);

    noteCell(row.getCell(SINGLE_GUIDANCE_COL), guidanceFor(field));

    // The stable identifier the parser prefers. Hidden, not absent.
    const keyCell = row.getCell(SINGLE_KEY_COL);
    keyCell.value = field.key;
    keyCell.font = { size: 8, color: { argb: argb(`#${HAIRLINE}`) } };

    if (index % 2 === 1) {
      [SINGLE_QUESTION_COL, SINGLE_GUIDANCE_COL].forEach((column) => {
        fill(row.getCell(column), argb(`#${TINT}`));
      });
    }
  });

  sheet.getColumn(SINGLE_KEY_COL).hidden = true;
}

/**
 * The calculated annual-repayment column on Portfolio and Liabilities.
 *
 * Clients routinely know a balance, a rate and a term but not what they
 * actually repay each year. Without this the Summary's commitments line simply
 * under-counts, which flatters the coverage ratio — the one direction an
 * indicative figure must never be wrong in.
 */
function derivedRepaymentFormula(
  section: PackSection, row: number,
  keys: { anchor: string; recorded: string; balance: string; rate: string; type: string; term: string },
): string {
  const at = (fieldKey: string) => {
    const index = section.fields.findIndex((field) => field.key === fieldKey);
    return `$${columnLetter(index + 1)}${row}`;
  };
  const anchor = at(keys.anchor);
  const recorded = at(keys.recorded);
  const balance = at(keys.balance);
  const rate = at(keys.rate);
  const type = at(keys.type);
  const term = at(keys.term);

  return `IF(${anchor}="","",IF(${recorded}<>"",${recorded},`
    + `IF(OR(${balance}="",${rate}=""),"",`
    + `IF(${type}="Interest only",${balance}*${rate}/100,`
    + `IF(${term}>0,-PMT(${rate}/100,${term},${balance}),${balance}*${rate}/100)))))`;
}

const DERIVED_COLUMNS: Record<string, {
  heading: string;
  keys: { anchor: string; recorded: string; balance: string; rate: string; type: string; term: string };
}> = {
  portfolio: {
    heading: 'ANNUAL REPAYMENT USED (CALCULATED)',
    keys: {
      anchor: 'asset.address', recorded: 'asset.annualRepayments', balance: 'asset.currentBalance',
      rate: 'asset.interestRate', type: 'asset.repaymentType', term: 'asset.remainingTermYears',
    },
  },
  liabilities: {
    heading: 'ANNUAL REPAYMENT USED (CALCULATED)',
    keys: {
      anchor: 'liability.description', recorded: 'liability.annualRepayments', balance: 'liability.balance',
      rate: 'liability.interestRate', type: 'liability.repaymentType', term: 'liability.remainingTermYears',
    },
  },
};

/** Sheet-specific closing notes, shown under the data as a commentary block. */
const SHEET_NOTES: Record<string, string[]> = {
  ownership: [
    'Ownership (%) — All parties must total 100%.',
    'Beneficial ownership / control — Recorded here for the assessment. Formal AML verification stays in the AML workflow.',
  ],
  incomePeriods: [
    'Non-recurring income — Treated as nil for servicing under default policy. Record it anyway; it is useful context.',
  ],
  addbacks: [
    'Period — Use the same label as the financial period on the Income sheet, exactly as written.',
    'Confirmed — An add-back is left out of income until this is Yes and a reason and source are recorded.',
  ],
  portfolio: [
    'Owning entity — Use the same name recorded on the Ownership sheet so the group position adds up.',
    'Annual repayments — Leave blank and it is derived from balance, rate and remaining term.',
  ],
  liabilities: [
    'Held by (entity) — Use the same name recorded on the Ownership sheet.',
    'Limit — Cards and overdrafts are assessed on the limit, not the balance.',
  ],
  tenancies: [],
};

function buildTableSheet(
  workbook: ExcelJS.Workbook, section: PackSection, branding: PackBranding,
  options: BuildPackOptions,
): void {
  const sheet = workbook.addWorksheet(section.sheetName.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: TABLE_HEADER_ROW }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const derived = DERIVED_COLUMNS[section.id];
  const span = section.fields.length + (derived ? 1 : 0);

  sheet.columns = [
    ...section.fields.map((field) => ({
      width: field.type === 'longtext' ? 44 : Math.max(16, Math.min(32, field.label.length + 8)),
    })),
    ...(derived ? [{ width: 30 }] : []),
  ];

  const encodeOptions = { preserveZeroes: Boolean(options.preserveZeroes) };

  titleRow(sheet, 1, section.title, branding, span);
  introRow(sheet, 2, section.intro, span);

  // Hidden row of field keys, then the headings a human reads. The parser scans
  // for the key row and skips the labels beneath it.
  const keyRow = sheet.getRow(TABLE_KEY_ROW);
  section.fields.forEach((field, index) => {
    const cell = keyRow.getCell(index + 1);
    cell.value = field.key;
    cell.font = { size: 8, color: { argb: argb(`#${HAIRLINE}`) } };
  });
  keyRow.hidden = true;

  const labelRow = sheet.getRow(TABLE_HEADER_ROW);
  section.fields.forEach((field, index) => {
    headerCell(labelRow.getCell(index + 1), headingText(field), branding);
  });
  if (derived) {
    headerCell(labelRow.getCell(derivedColumnIndex(section.id)), derived.heading, branding);
  }
  labelRow.height = 32;

  const existing = section.collectionPath
    ? (readPath(options.payload, section.collectionPath) as unknown[] | undefined)
    : undefined;

  const lastRow = TABLE_FIRST_DATA_ROW + TABLE_DATA_ROWS - 1;
  for (let rowNumber = TABLE_FIRST_DATA_ROW; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const source = existing?.[rowNumber - TABLE_FIRST_DATA_ROW];
    const item = source === undefined
      ? undefined
      : projectPackRow(section, source, options.payload);

    section.fields.forEach((field, index) => {
      const cell = row.getCell(index + 1);
      if (item !== undefined) {
        writeValue(cell, field, encodeValue(
          field.key, field.type, readPath(item, field.path), encodeOptions,
        ));
      }
      inputCell(cell, branding);
      const format = numberFormat(field);
      if (format) cell.numFmt = format;
      applyValidation(cell, field);
    });

    if (derived) {
      const cell = row.getCell(derivedColumnIndex(section.id));
      cell.value = { formula: derivedRepaymentFormula(section, rowNumber, derived.keys), date1904: false };
      calcCell(cell);
      cell.numFmt = '#,##0';
    }
  }

  // Closing commentary. The parser stops at a row whose only content is
  // "NOTES", so this can never be read back as data.
  const notes = SHEET_NOTES[section.id] ?? [];
  let cursor = lastRow + 2;
  sheet.getCell(cursor, 1).value = 'NOTES';
  sheet.getCell(cursor, 1).font = { bold: true, size: 9, color: { argb: argb(branding.brandHex) } };
  cursor += 1;
  [
    ...notes,
    `Fields marked ${REQUIRED_MARK} are needed before the file can be assessed.`,
  ].forEach((note) => {
    noteCell(sheet.getCell(cursor, 1), note);
    sheet.mergeCells(cursor, 1, cursor, Math.min(span, 6));
    cursor += 1;
  });

  sheet.autoFilter = {
    from: { row: TABLE_HEADER_ROW, column: 1 },
    to: { row: TABLE_HEADER_ROW, column: span },
  };
}

// ---------------------------------------------------------------------------
// Next steps
// ---------------------------------------------------------------------------

/** Questions on the Next steps sheet. Keyed so the sample can answer them. */
export const PROCEED_QUESTIONS: ReadonlyArray<{ key: string; question: string; options?: string }> = [
  { key: 'proceed.decision', question: 'Does the client wish to proceed with a finance application?', options: 'Yes | No | Not yet known' },
  { key: 'proceed.timeframe', question: 'If yes, what is the preferred settlement timeframe?' },
  { key: 'proceed.lenders', question: 'Which lender or lenders have they already approached, if any?' },
  { key: 'proceed.adviser', question: 'Is there an existing broker or adviser involved?' },
  { key: 'proceed.concerns', question: 'What conditions or concerns do they want addressed first?' },
  { key: 'proceed.contact', question: 'Who is the primary contact, and what is the best number and email?' },
];

/** The document checklist. Keys let the worked example tick them off. */
export const SUPPORTING_DOCUMENTS: ReadonlyArray<{ key: string; label: string; relatesTo: string }> = [
  { key: 'doc.contract', label: 'Contract of sale or heads of agreement', relatesTo: 'Property and transaction' },
  { key: 'doc.leases', label: 'Current lease(s) and any rent roll', relatesTo: 'Tenancies' },
  { key: 'doc.financials', label: 'Last two years of financial statements and tax returns', relatesTo: 'Financial periods' },
  { key: 'doc.noa', label: 'Most recent notices of assessment', relatesTo: 'Financial periods' },
  { key: 'doc.trustDeed', label: 'Trust deed or SMSF trust deed and investment strategy, where applicable', relatesTo: 'Borrowing entities' },
  { key: 'doc.constitution', label: 'Company constitution and ASIC extract, where applicable', relatesTo: 'Borrowing entities' },
  { key: 'doc.rates', label: 'Rates and insurance notices for the property', relatesTo: 'Property and transaction' },
  { key: 'doc.loanStatements', label: 'Statements for existing loans, cards and equipment finance', relatesTo: 'Portfolio and liabilities' },
  { key: 'doc.identification', label: 'Identification for every borrower, director, trustee and guarantor', relatesTo: 'Borrowing entities' },
  { key: 'doc.planning', label: 'Council or planning approvals, where the property is being changed', relatesTo: 'Property and transaction' },
  { key: 'doc.atoPortal', label: 'Aged debtors and creditors, or an ATO integrated client account', relatesTo: 'Financial periods' },
];

export const SIGN_OFF_ROWS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'signoff.clientName', label: 'Client name' },
  { key: 'signoff.capacity', label: 'Position / capacity' },
  { key: 'signoff.signature', label: 'Signature' },
  { key: 'signoff.date', label: 'Date' },
  { key: 'signoff.completedBy', label: 'Completed by' },
  { key: 'signoff.adviserSignature', label: 'Adviser signature' },
  { key: 'signoff.adviserDate', label: 'Date' },
];

function buildProceedSheet(
  workbook: ExcelJS.Workbook, branding: PackBranding, options: BuildPackOptions,
): void {
  const sheet = workbook.addWorksheet(PROCEED_SHEET, {
    pageSetup: { paperSize: 9, orientation: 'portrait' },
  });
  sheet.columns = [{ width: 72 }, { width: 30 }, { width: 46 }];

  titleRow(sheet, 1, 'Next steps', branding, 3);
  introRow(sheet, 2, 'Complete this with the client once the figures have been discussed.', 3);

  const proceed = options.proceed ?? {};

  let cursor = 3;
  headerCell(sheet.getCell(cursor, 1), 'QUESTION', branding);
  headerCell(sheet.getCell(cursor, 2), 'ANSWER', branding);
  headerCell(sheet.getCell(cursor, 3), 'GUIDANCE', branding);
  cursor += 1;

  PROCEED_QUESTIONS.forEach((entry) => {
    sheet.getCell(cursor, 1).value = entry.question;
    sheet.getCell(cursor, 1).alignment = { wrapText: true, vertical: 'top' };
    const answer = sheet.getCell(cursor, 2);
    inputCell(answer, branding);
    const value = proceed.answers?.[entry.key];
    if (value) answer.value = value;
    noteCell(sheet.getCell(cursor, 3), entry.options ? `Options: ${entry.options}` : 'Optional.');
    cursor += 1;
  });
  cursor += 2;

  // ---- Supporting documents ----------------------------------------------
  bandRow(sheet, cursor, 1, 'SUPPORTING DOCUMENTS TO COLLECT', branding);
  cursor += 1;
  headerCell(sheet.getCell(cursor, 1), 'DOCUMENT', branding);
  headerCell(sheet.getCell(cursor, 2), 'HELD', branding);
  headerCell(sheet.getCell(cursor, 3), 'DATE RECEIVED', branding);
  cursor += 1;

  SUPPORTING_DOCUMENTS.forEach((entry) => {
    sheet.getCell(cursor, 1).value = entry.label;
    sheet.getCell(cursor, 1).alignment = { wrapText: true, vertical: 'top' };
    const held = sheet.getCell(cursor, 2);
    inputCell(held, branding);
    held.dataValidation = {
      type: 'list', allowBlank: true, formulae: ['"Yes,No,N/A"'], showErrorMessage: false,
    };
    const received = sheet.getCell(cursor, 3);
    inputCell(received, branding);
    const record = proceed.documents?.[entry.key];
    if (record?.held) held.value = record.held;
    if (record?.received) received.value = record.received;
    cursor += 1;
  });
  cursor += 2;

  // ---- Declaration --------------------------------------------------------
  bandRow(sheet, cursor, 1, 'DECLARATION', branding);
  cursor += 1;
  const declaration = sheet.getCell(cursor, 1);
  declaration.value = 'The information recorded in this pack has been provided by the client and is, to '
    + 'the best of their knowledge, accurate at the date below. It will be verified against source '
    + 'documents before any finance application is made.';
  declaration.font = { size: 10, color: { argb: argb(`#${INK}`) } };
  declaration.alignment = { wrapText: true, vertical: 'top' };
  sheet.mergeCells(cursor, 1, cursor, 3);
  sheet.getRow(cursor).height = 40;
  cursor += 2;

  const consent = sheet.getCell(cursor, 1);
  consent.value = `The client consents to ${branding.companyName} collecting, holding and using the `
    + 'information in this pack for the purpose of assessing and arranging finance, and to it being '
    + 'disclosed to lenders, valuers and other parties where that is necessary for that purpose. '
    + 'Have your own compliance sign-off on this wording before it goes into circulation.';
  consent.font = { size: 9, italic: true, color: { argb: argb(`#${MUTED}`) } };
  consent.alignment = { wrapText: true, vertical: 'top' };
  sheet.mergeCells(cursor, 1, cursor, 3);
  sheet.getRow(cursor).height = 44;
  cursor += 2;

  SIGN_OFF_ROWS.forEach((entry) => {
    const label = entry.key === 'signoff.completedBy'
      ? `${entry.label} (${branding.companyName})`
      : entry.label;
    sheet.getCell(cursor, 1).value = label;
    sheet.getCell(cursor, 1).font = { bold: true, size: 10 };
    const cell = sheet.getCell(cursor, 2);
    inputCell(cell, branding);
    const value = proceed.signOff?.[entry.key];
    if (value) cell.value = value;
    cursor += 1;
  });
  cursor += 2;

  // The contact block is repeated here on purpose. This is the sheet that gets
  // printed and signed on its own, and a signed page that cannot be traced back
  // to who prepared it is not much of a record — REPORT_RULES §6.
  if (branding.contactRows.length) {
    bandRow(sheet, cursor, 1, branding.companyName.toUpperCase(), branding);
    cursor += 1;
    branding.contactRows.forEach((row) => {
      sheet.getCell(cursor, 1).value = `${row.label}: ${row.value}`;
      sheet.getCell(cursor, 1).font = { size: 9, color: { argb: argb(`#${MUTED}`) } };
      cursor += 1;
    });
    cursor += 1;
  }

  const disclaimer = sheet.getCell(cursor, 1);
  disclaimer.value = 'This pack is an information-gathering tool. It is not a credit approval, a '
    + 'pre-approval, an offer of finance, financial advice or legal advice.';
  disclaimer.font = { size: 9, italic: true, color: { argb: argb(`#${MUTED}`) } };
  disclaimer.alignment = { wrapText: true, vertical: 'top' };
  sheet.mergeCells(cursor, 1, cursor, 3);
  sheet.getRow(cursor).height = 26;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Load ExcelJS on demand so it never enters the main bundle. */
async function loadExcelJs(): Promise<typeof ExcelJS> {
  const module = await import('exceljs');
  return (module.default ?? module) as unknown as typeof ExcelJS;
}

/** Build the complete branded workbook. */
export async function buildIntakeWorkbook(
  options: BuildPackOptions = {},
): Promise<ExcelJS.Workbook> {
  const branding = options.branding ?? DEFAULT_PACK_BRANDING;
  const generatedAt = options.generatedAt ?? new Date();

  const Excel = await loadExcelJs();
  const workbook = new Excel.Workbook();
  workbook.creator = branding.companyName;
  workbook.company = branding.companyName;
  workbook.title = options.sample
    ? 'Commercial & Industrial finance intake pack — worked example'
    : 'Commercial & Industrial finance intake pack';
  workbook.description = options.sample
    ? 'Worked example filled with fictional data, for reference only'
    : 'Client fact-find and interview workbook';
  workbook.created = generatedAt;
  workbook.modified = generatedAt;

  await buildInstructionsSheet(workbook, branding, options, generatedAt);
  buildSummarySheet(workbook, branding, options.payload?.income.periods[0]?.label);
  PACK_SECTIONS.forEach((section) => {
    if (section.shape === 'table') buildTableSheet(workbook, section, branding, options);
    else buildSingleSheet(workbook, section, branding, options);
  });
  buildProceedSheet(workbook, branding, options);

  return workbook;
}

/** Serialise the workbook to a Blob for download. */
export async function workbookToBlob(workbook: ExcelJS.Workbook): Promise<Blob> {
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** A filesystem-safe, human-recognisable filename. */
export function packFileName(
  branding: PackBranding,
  reference: string | undefined,
  extension: 'xlsx' | 'docx',
  variant: 'blank' | 'example' = 'blank',
): string {
  const company = branding.companyName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const ref = (reference ?? 'assessment').replace(/[^a-z0-9-]+/gi, '-');
  const suffix = variant === 'example' ? '-worked-example' : '';
  return `${company}-CI-intake-${ref}${suffix}.${extension}`;
}

export { bareHex };
