/**
 * Workbook geometry.
 *
 * Where every sheet puts its keys, headings and data. It lives in its own file
 * because three things have to agree on it and they cannot be allowed to drift:
 * the generator that writes the cells, the Summary sheet whose formulas point
 * at them, and the parser that reads them back.
 *
 * The Summary sheet is the reason this is computed rather than written down.
 * Its formulas reference real cells — `'4. Income'!$G$5:$G$18` is EBITDA — and
 * a hand-written reference like that is correct exactly until somebody inserts
 * a field into the schema, at which point EBITDA moves one column right and the
 * formula silently starts summing net profit instead. Nothing errors, nothing
 * is flagged; the number is simply wrong. So no formula in this module names a
 * column: they all ask `columnFor(section, key)` and are rebuilt from the
 * schema on every generation.
 */

import { PACK_SECTIONS, type PackSection } from './schema';

/** Title, then intro, then a hidden row of field keys, then human headings. */
export const TABLE_KEY_ROW = 3;
export const TABLE_HEADER_ROW = 4;
export const TABLE_FIRST_DATA_ROW = 5;

/**
 * Blank rows drawn on every table sheet.
 *
 * Fourteen, not four. A pack that runs out of room is a pack somebody finishes
 * in a separate document, and then nothing comes back through the importer.
 */
export const TABLE_DATA_ROWS = 14;
export const TABLE_LAST_DATA_ROW = TABLE_FIRST_DATA_ROW + TABLE_DATA_ROWS - 1;

/** Key/value sheets: question, answer, guidance, and a hidden key column. */
export const SINGLE_HEADER_ROW = 3;
export const SINGLE_FIRST_DATA_ROW = 4;
export const SINGLE_QUESTION_COL = 1;
export const SINGLE_ANSWER_COL = 2;
export const SINGLE_GUIDANCE_COL = 3;
export const SINGLE_KEY_COL = 4;

export const SUMMARY_SHEET = 'Summary';
export const INSTRUCTIONS_SHEET = 'Start here';
export const PROCEED_SHEET = '7. Proceed';

/** 1 → A, 27 → AA. Excel column letters, for formula composition. */
export function columnLetter(index: number): string {
  let remaining = index;
  let letters = '';
  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + modulo) + letters;
    remaining = Math.floor((remaining - modulo) / 26);
  }
  return letters;
}

function section(id: string): PackSection {
  const found = PACK_SECTIONS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown pack section "${id}"`);
  return found;
}

function fieldIndex(sectionId: string, fieldKey: string): number {
  const index = section(sectionId).fields.findIndex((field) => field.key === fieldKey);
  if (index === -1) throw new Error(`Unknown pack field "${fieldKey}" in section "${sectionId}"`);
  return index;
}

/** Column letter holding a table section's field. Throws on an unknown key. */
export function columnFor(sectionId: string, fieldKey: string): string {
  return columnLetter(fieldIndex(sectionId, fieldKey) + 1);
}

/** Row number holding a key/value section's field. Throws on an unknown key. */
export function rowFor(sectionId: string, fieldKey: string): number {
  return SINGLE_FIRST_DATA_ROW + fieldIndex(sectionId, fieldKey);
}

/** Quoted sheet name for use inside a formula. */
export function sheetRef(sectionId: string): string {
  return `'${section(sectionId).sheetName}'`;
}

/** Absolute single-cell reference to a key/value answer, e.g. `'1. Transaction'!$B$11`. */
export function answerRef(sectionId: string, fieldKey: string): string {
  return `${sheetRef(sectionId)}!$${columnLetter(SINGLE_ANSWER_COL)}$${rowFor(sectionId, fieldKey)}`;
}

/** Absolute column range over a table section's data rows. */
export function columnRange(sectionId: string, fieldKey: string): string {
  const letter = columnFor(sectionId, fieldKey);
  return `${sheetRef(sectionId)}!$${letter}$${TABLE_FIRST_DATA_ROW}:$${letter}$${TABLE_LAST_DATA_ROW}`;
}

/**
 * The calculated column appended to a table sheet, one past its last field.
 *
 * Portfolio and Liabilities each carry a derived annual-repayment column so the
 * Summary can total commitments even when the client only knew the balance,
 * rate and term. It is not a schema field — it is never read back — so it lives
 * outside the field list rather than polluting it.
 */
export function derivedColumnIndex(sectionId: string): number {
  return section(sectionId).fields.length + 1;
}

export function derivedColumnRange(sectionId: string): string {
  const letter = columnLetter(derivedColumnIndex(sectionId));
  return `${sheetRef(sectionId)}!$${letter}$${TABLE_FIRST_DATA_ROW}:$${letter}$${TABLE_LAST_DATA_ROW}`;
}
