import * as XLSX from 'xlsx';

export type GHLRequiredColumnKey = 'firstName' | 'lastName' | 'email' | 'phone' | 'tags' | 'source';

export interface GHLExportField {
  key: string;
  label: string;
}

export interface GHLExportRecord {
  [key: string]: string | number | null | undefined;
}

export interface GHLHeaderOption {
  key: GHLRequiredColumnKey;
  label: string;
  required?: boolean;
}

export type GHLHeaderMapping = Record<GHLRequiredColumnKey, string>;

export const GHL_HEADER_OPTIONS: GHLHeaderOption[] = [
  { key: 'firstName', label: 'First Name', required: true },
  { key: 'lastName', label: 'Last Name' },
  { key: 'email', label: 'Email', required: true },
  { key: 'phone', label: 'Phone', required: true },
  { key: 'tags', label: 'Tags' },
  { key: 'source', label: 'Source' },
];

export const UNMAPPED_FIELD = '__unmapped__';

const escapeCell = (value: unknown) => String(value ?? '').replace(/"/g, '""');

export function createDefaultGHLMapping(fields: GHLExportField[]): GHLHeaderMapping {
  const byLabel = (patterns: RegExp[]) =>
    fields.find((field) => patterns.some((pattern) => pattern.test(`${field.key} ${field.label}`.toLowerCase())))?.key || UNMAPPED_FIELD;

  return {
    firstName: byLabel([/first/, /given/]),
    lastName: byLabel([/last/, /surname/, /family/]),
    email: byLabel([/email/]),
    phone: byLabel([/phone/, /mobile/]),
    tags: byLabel([/tag/]),
    source: byLabel([/source/]),
  };
}

export function buildGHLExportRows({
  fields,
  records,
  mapping,
  includeUnmapped,
}: {
  fields: GHLExportField[];
  records: GHLExportRecord[];
  mapping: GHLHeaderMapping;
  includeUnmapped: boolean;
}) {
  const selectedFieldKeys = new Set(Object.values(mapping).filter((value) => value !== UNMAPPED_FIELD));
  const unmappedFields = includeUnmapped ? fields.filter((field) => !selectedFieldKeys.has(field.key)) : [];

  const headers = [
    ...GHL_HEADER_OPTIONS.filter((option) => mapping[option.key] !== UNMAPPED_FIELD).map((option) => option.label),
    ...unmappedFields.map((field) => field.label),
  ];

  const rows = records.map((record) => {
    const mappedValues = GHL_HEADER_OPTIONS
      .filter((option) => mapping[option.key] !== UNMAPPED_FIELD)
      .map((option) => record[mapping[option.key]] ?? '');

    const extraValues = unmappedFields.map((field) => record[field.key] ?? '');
    return [...mappedValues, ...extraValues];
  });

  return { headers, rows };
}

export function downloadGHLCSV(fileName: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${escapeCell(cell)}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadGHLXLSX(fileName: string, sheetName: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet['!cols'] = headers.map((header) => ({ wch: Math.max(header.length + 2, 18) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, fileName);
}