/**
 * Shared spreadsheet styling.
 *
 * Extracted so the Summary sheet and the question sheets look like one
 * document. Office cannot resolve our CSS tokens, so the neutrals below are
 * literal — but every brand colour still comes from resolved branding rather
 * than being written down here.
 */

import type ExcelJS from 'exceljs';
import { argb, type PackBranding } from './branding';

/** Neutral greys for rules and secondary text. */
export const INK = '111827';
export const MUTED = '6B7280';
export const HAIRLINE = 'D1D5DB';
export const PAPER = 'FFFFFF';
export const TINT = 'F3F4F6';

/**
 * The cream an input cell is filled with.
 *
 * The workbook's whole convention rests on this: cream means "yours to fill
 * in", sand means "calculated, leave alone". A client who can see at a glance
 * which cells are theirs fills more of them in.
 */
export const INPUT_FILL = 'FFFDF5E6';
export const CALC_FILL = 'FFF5F0E4';

export function fill(cell: ExcelJS.Cell, colour: string): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
}

export function titleRow(
  sheet: ExcelJS.Worksheet, row: number, text: string, branding: PackBranding, span: number,
): void {
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { bold: true, size: 15, color: { argb: argb(branding.brandHex) } };
  sheet.getRow(row).height = 22;
  if (span > 1) sheet.mergeCells(row, 1, row, span);
}

export function introRow(sheet: ExcelJS.Worksheet, row: number, text: string, span: number): void {
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { size: 10, italic: true, color: { argb: argb(`#${MUTED}`) } };
  cell.alignment = { wrapText: true, vertical: 'top' };
  sheet.getRow(row).height = 30;
  if (span > 1) sheet.mergeCells(row, 1, row, span);
}

/** Brand-filled header band. Foreground is white — brand colours here are dark. */
export function headerCell(cell: ExcelJS.Cell, text: string, branding: PackBranding): void {
  cell.value = text;
  fill(cell, argb(branding.brandHex));
  cell.font = { bold: true, size: 10, color: { argb: argb(`#${PAPER}`) } };
  cell.alignment = { vertical: 'middle', wrapText: true };
  cell.border = { bottom: { style: 'thin', color: { argb: argb(`#${HAIRLINE}`) } } };
}

/** A group heading inside a sheet — smaller than the sheet title. */
export function bandRow(
  sheet: ExcelJS.Worksheet, row: number, column: number, text: string, branding: PackBranding,
): void {
  const cell = sheet.getCell(row, column);
  cell.value = text;
  cell.font = {
    bold: true, size: 9, color: { argb: argb(branding.brandHex) },
  };
  cell.alignment = { vertical: 'middle' };
}

/** Small muted commentary, used for the guidance column and note blocks. */
export function noteCell(cell: ExcelJS.Cell, text: string): void {
  cell.value = text;
  cell.font = { size: 9, color: { argb: argb(`#${MUTED}`) } };
  cell.alignment = { wrapText: true, vertical: 'top' };
}

/** The cream box the client types into. */
export function inputCell(cell: ExcelJS.Cell, branding: PackBranding): void {
  fill(cell, INPUT_FILL);
  cell.border = {
    top: { style: 'hair', color: { argb: argb(`#${HAIRLINE}`) } },
    left: { style: 'thin', color: { argb: argb(branding.accentHex) } },
    bottom: { style: 'hair', color: { argb: argb(`#${HAIRLINE}`) } },
    right: { style: 'hair', color: { argb: argb(`#${HAIRLINE}`) } },
  };
  cell.alignment = { wrapText: true, vertical: 'top' };
}

/** The sand box the workbook fills in for itself. */
export function calcCell(cell: ExcelJS.Cell): void {
  fill(cell, CALC_FILL);
  cell.font = { bold: true, size: 10, color: { argb: argb(`#${INK}`) } };
  cell.border = {
    top: { style: 'hair', color: { argb: argb(`#${HAIRLINE}`) } },
    bottom: { style: 'hair', color: { argb: argb(`#${HAIRLINE}`) } },
  };
}
