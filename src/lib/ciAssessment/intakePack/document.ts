/**
 * Intake-pack Word document.
 *
 * A branded interview script for sitting with a client — printable, editable,
 * and organised as questions to ask rather than fields to populate.
 *
 * The shape follows how the meeting actually runs. Cover and pack details, then
 * a short "before you begin" so whoever is holding it knows the conventions,
 * then ten numbered sections, each ending in a notes block because the useful
 * half of a client meeting is the half that does not fit in a field. Where a
 * question offers a list, the options are printed as tick boxes: a person with
 * a pen ticks, they do not transcribe an enum.
 *
 * Branding follows `REPORT_RULES.md` §5 rather than doing whatever Word allows:
 *
 *   Cover           the mark, top-left, with generous clear space
 *   Running header  wordmark TEXT only — never a repeated image. An image in a
 *                   page-margin box is fragile across a long document
 *   Footer          page counters and the trading name; no mark
 *
 * The logo is embedded as bytes, not linked, so the document renders with no
 * network and leaks no fetch back to us each time a client opens it.
 *
 * This document is deliberately NOT parsed back. A Word file's structure does
 * not survive real-world editing reliably enough to drive a financial
 * calculation, and a silent mis-mapping would be worse than asking someone to
 * use the spreadsheet. The workbook is the machine-readable half; this is the
 * human half, and it says so on its face.
 */

import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun,
  PageNumber, Packer, Paragraph, ShadingType, Table, TableCell, TableRow,
  TextRun, WidthType,
} from 'docx';
import { PACK_SECTIONS, type PackField, type PackSection } from './schema';
import { DEFAULT_PACK_BRANDING, bareHex, fitLogo, type PackBranding } from './branding';
import { encodeValue, toDisplayValue } from './values';
import {
  PROCEED_QUESTIONS, SIGN_OFF_ROWS, SUPPORTING_DOCUMENTS, projectPackRow,
  type PackDetails, type ProceedAnswers,
} from './workbook';
import type { AssessmentPayload } from '../types';

export interface BuildDocumentOptions {
  branding?: PackBranding;
  assessmentReference?: string;
  assessmentTitle?: string;
  generatedAt?: Date;
  /** Cover details. Blank in the template, filled in the worked example. */
  details?: PackDetails;
  /** Answers to write into the questions. Absent leaves the guide blank. */
  payload?: AssessmentPayload;
  proceed?: ProceedAnswers;
  /** See `EncodeOptions.preserveZeroes`. On when the guide is filled from real data. */
  preserveZeroes?: boolean;
  /** Marks every page as the worked example. See `BuildPackOptions.sample`. */
  sample?: boolean;
}

const CELL_MARGIN = { top: 90, bottom: 90, left: 130, right: 130 };

const MUTED = '6B7280';
const INK = '111827';
const HAIRLINE = 'D8D8D8';
const RULE = 'E5E7EB';
const ANSWER_TINT = 'FDF8EC';

const REQUIRED_MARK = '✱';
const BOX = '☐';
const TICKED = '☒';

const SAMPLE_BANNER = 'FICTIONAL TEST DATA — FOR REFERENCE ONLY';

/** A light rule between rows; a full grid makes a long form feel like a tax return. */
const SUBTLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 1, color: HAIRLINE },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: HAIRLINE },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: HAIRLINE },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function heading(
  text: string, brandHex: string,
  level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2,
) {
  return new Paragraph({
    heading: level,
    spacing: { before: 300, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 } },
    children: [new TextRun({ text, color: bareHex(brandHex), bold: true })],
  });
}

/** The small caps line above a section title — "Section 4", "Checklist". */
function eyebrow(text: string, accentHex: string) {
  return new Paragraph({
    spacing: { before: 340, after: 40 },
    children: [new TextRun({
      text: text.toUpperCase(), bold: true, size: 15, color: bareHex(accentHex),
    })],
  });
}

function body(text: string, options: { italic?: boolean; size?: number; color?: string } = {}) {
  return new Paragraph({
    spacing: { after: 110 },
    children: [new TextRun({
      text, italics: options.italic, size: options.size ?? 20, color: options.color,
    })],
  });
}

/** Convert pixels to the twentieths-of-a-point docx measures images in. */
function pxToPt(px: number): number {
  return Math.round(px * 0.75);
}

function cell(
  children: Paragraph[], widthPercent: number,
  options: { shaded?: boolean } = {},
): TableCell {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    margins: CELL_MARGIN,
    ...(options.shaded
      ? { shading: { type: ShadingType.CLEAR, fill: ANSWER_TINT, color: 'auto' } }
      : {}),
    children,
  });
}

function text(value: string, options: {
  size?: number; bold?: boolean; italic?: boolean; color?: string;
} = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({
      text: value,
      size: options.size ?? 20,
      bold: options.bold,
      italics: options.italic,
      color: options.color,
    })],
  });
}

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, segment) => {
    if (node == null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[segment];
  }, source);
}

/**
 * The answer side of a question.
 *
 * For a list field this is tick boxes, with the recorded choice ticked. For
 * everything else it is either the recorded answer or an empty shaded cell —
 * the shading is what tells someone with a printout where to write.
 */
function answerParagraphs(field: PackField, value: string): Paragraph[] {
  if (field.options?.length) {
    // Long option lists become a printed run of boxes rather than a wall: two
    // per line reads better than fourteen wrapping mid-label.
    const chosen = value.trim().toLowerCase();
    const runs = field.options.map((option) => new TextRun({
      text: `${option.toLowerCase() === chosen ? TICKED : BOX}  ${option}   `,
      size: 18,
      bold: option.toLowerCase() === chosen,
      color: option.toLowerCase() === chosen ? INK : MUTED,
    }));
    return [new Paragraph({ children: runs })];
  }

  if (value) return [text(value, { size: 20 })];
  if (field.type === 'date') return [text('DD / MM / YYYY', { size: 16, color: MUTED })];
  return [new Paragraph('')];
}

/** Money, percentages and dates read as a person writes them on a printed page. */
function displayValue(field: PackField, value: string): string {
  return value ? toDisplayValue(field.type, value) : value;
}

function questionRow(field: PackField, rawValue: string): TableRow {
  const value = displayValue(field, rawValue);
  const guidance = [
    field.help,
    field.optional ? 'Optional.' : null,
  ].filter(Boolean).join('  ');

  return new TableRow({
    children: [
      cell([
        text(
          field.optional ? field.question : `${field.question} ${REQUIRED_MARK}`,
          { bold: !field.optional },
        ),
        ...(guidance ? [text(guidance, { size: 16, color: MUTED, italic: true })] : []),
      ], 55),
      cell(answerParagraphs(field, value), 45, { shaded: true }),
    ],
  });
}

function questionTable(rows: TableRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: SUBTLE_BORDERS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          cell([text('Question', { bold: true, size: 18, color: MUTED })], 55),
          cell([text('Answer', { bold: true, size: 18, color: MUTED })], 45),
        ],
      }),
      ...rows,
    ],
  });
}

/** Ruled space for the things that do not fit in a field. */
function notesBlock(label: string, lines = 3): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: SUBTLE_BORDERS,
    rows: [
      new TableRow({
        children: [cell([text(label, { bold: true, size: 16, color: MUTED })], 100)],
      }),
      ...Array.from({ length: lines }, () => new TableRow({
        children: [cell([new Paragraph('')], 100)],
      })),
    ],
  });
}

/** Heading strip introducing a repeated block — "Entity 2". */
function blockLabel(label: string, hint: string, brandHex: string): TableRow {
  return new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        width: { size: 100, type: WidthType.PERCENTAGE },
        margins: CELL_MARGIN,
        columnSpan: 2,
        shading: { type: ShadingType.CLEAR, fill: RULE, color: 'auto' },
        children: [new Paragraph({
          children: [
            new TextRun({ text: label, bold: true, size: 19, color: bareHex(brandHex) }),
            new TextRun({ text: `        ${hint}`, size: 15, color: MUTED, italics: true }),
          ],
        })],
      }),
    ],
  });
}

/**
 * Sections that read better as a grid than as repeated question blocks.
 *
 * Add-backs are short, uniform and usually numerous — three columns of boxes
 * beats three copies of a six-question block.
 */
const GRID_SECTIONS = new Set(['addbacks']);

function gridTable(
  section: PackSection, rows: Record<string, string>[], brandHex: string,
): Table {
  const blank = Math.max(0, 8 - rows.length);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: SUBTLE_BORDERS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: section.fields.map((field) => cell(
          [text(
            field.optional ? field.label : `${field.label} ${REQUIRED_MARK}`,
            { bold: true, size: 15, color: bareHex(brandHex) },
          )],
          Math.round(100 / section.fields.length),
        )),
      }),
      ...rows.map((row) => new TableRow({
        children: section.fields.map((field) => cell(
          [text(displayValue(field, row[field.key] ?? ''), { size: 16 })],
          Math.round(100 / section.fields.length),
          { shaded: true },
        )),
      })),
      ...Array.from({ length: blank }, () => new TableRow({
        children: section.fields.map(() => cell(
          [new Paragraph('')], Math.round(100 / section.fields.length), { shaded: true },
        )),
      })),
    ],
  });
}

/** Encoded answers for one collection row, keyed by field key. */
function encodeRow(
  section: PackSection, item: unknown, options: BuildDocumentOptions,
): Record<string, string> {
  const record: Record<string, string> = {};
  // Same projection the workbook uses, so an add-back names its period here too.
  const projected = projectPackRow(section, item, options.payload);
  const encodeOptions = { preserveZeroes: Boolean(options.preserveZeroes) };
  section.fields.forEach((field) => {
    const encoded = encodeValue(field.key, field.type, readPath(projected, field.path), encodeOptions);
    record[field.key] = encoded === '' ? '' : String(encoded);
  });
  return record;
}

/** Singular noun for a repeated block — "Entity 1", "Tenancy 2". */
const BLOCK_NOUNS: Record<string, string> = {
  ownership: 'Entity',
  incomePeriods: 'Period',
  portfolio: 'Property',
  liabilities: 'Liability',
  tenancies: 'Tenancy',
};

function sectionBlock(
  section: PackSection, index: number, branding: PackBranding,
  options: BuildDocumentOptions,
): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [
    eyebrow(`Section ${index + 1}`, branding.accentHex),
    heading(section.title, branding.brandHex),
    body(section.intro, { italic: true, color: MUTED }),
  ];

  if (section.shape === 'single') {
    const rows = section.fields.map((field) => {
      const encoded = options.payload
        ? encodeValue(field.key, field.type, readPath(options.payload, field.path),
          { preserveZeroes: Boolean(options.preserveZeroes) })
        : '';
      return questionRow(field, encoded === '' ? '' : String(encoded));
    });
    blocks.push(questionTable(rows));
  } else {
    const items = section.collectionPath
      ? (readPath(options.payload, section.collectionPath) as unknown[] | undefined) ?? []
      : [];
    const encoded = items.map((item) => encodeRow(section, item, options));

    if (GRID_SECTIONS.has(section.id)) {
      blocks.push(gridTable(section, encoded, branding.brandHex));
    } else {
      // Two blocks minimum so the "copy this block" instruction has something
      // to point at, and one per recorded item when the guide is filled.
      const noun = BLOCK_NOUNS[section.id] ?? 'Entry';
      const count = Math.max(2, encoded.length);
      for (let blockIndex = 0; blockIndex < count; blockIndex += 1) {
        const values = encoded[blockIndex] ?? {};
        blocks.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: SUBTLE_BORDERS,
          rows: [
            blockLabel(
              `${noun} ${blockIndex + 1}`,
              'copy this block for more',
              branding.brandHex,
            ),
            new TableRow({
              tableHeader: true,
              children: [
                cell([text('Question', { bold: true, size: 18, color: MUTED })], 55),
                cell([text('Answer', { bold: true, size: 18, color: MUTED })], 45),
              ],
            }),
            ...section.fields.map((field) => questionRow(field, values[field.key] ?? '')),
          ],
        }));
        blocks.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      }
    }
  }

  blocks.push(notesBlock(`Interview notes — ${section.title}`));
  return blocks;
}

// ---------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------

function packDetailsTable(
  details: PackDetails, reference: string | undefined, brandHex: string,
): Table {
  const rows: Array<[string, string | undefined]> = [
    ['Client / borrowing entity', details.clientName],
    ['Property under consideration', details.propertyDescription],
    ['Our reference', details.reference ?? reference],
    ['Adviser conducting the interview', details.adviser],
    ['Date of interview', details.interviewDate],
    ['Date pack completed', details.completedDate],
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: SUBTLE_BORDERS,
    rows: rows.map(([label, value]) => new TableRow({
      children: [
        cell([text(label, { size: 18, bold: true, color: bareHex(brandHex) })], 38),
        cell([value ? text(value) : new Paragraph('')], 62, { shaded: true }),
      ],
    })),
  });
}

function howToUseTable(): Table {
  const steps = [
    'Work through the sections in order. Each question is worded the way you would say it out loud.',
    'Record answers in the shaded column. Tick the boxes where a list is offered.',
    'Leave anything unknown blank. A blank is safer than a guess, and it tells us what still needs chasing.',
    `Fields marked with a bronze ${REQUIRED_MARK} are needed before the file can be assessed. Everything else sharpens the result.`,
    'Where there is more than one entity, period, property, liability or tenancy, copy the block and fill it again.',
    'Sign the declaration at the back with the client, then enter the answers in the workbook so they load into the assessment.',
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: SUBTLE_BORDERS,
    rows: steps.map((step, index) => new TableRow({
      children: [
        cell([text(`${index + 1}.`, { bold: true, size: 18, color: MUTED })], 6),
        cell([text(step)], 94),
      ],
    })),
  });
}

function legendTable(brandHex: string, accentHex: string): Table {
  const entries: Array<[string, string, string]> = [
    [`${REQUIRED_MARK}   Required`, 'Needed before the file can be assessed.', accentHex],
    ['Shaded column', 'The answer column. Everything you record goes there.', brandHex],
    [`${BOX}   Tick boxes`, 'Where a list is offered, tick one rather than writing it out.', brandHex],
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: SUBTLE_BORDERS,
    rows: [new TableRow({
      children: entries.map(([label, description, colour]) => cell([
        text(label, { bold: true, size: 18, color: bareHex(colour) }),
        text(description, { size: 16, color: MUTED }),
      ], 33)),
    })],
  });
}

function contentsTable(brandHex: string): Table {
  const rows = [
    ...PACK_SECTIONS.map((section, index) => [
      String(index + 1), section.title, section.intro,
    ] as const),
    [String(PACK_SECTIONS.length + 1), 'Next steps',
      'What happens after the meeting, the documents to collect, and the declaration.'] as const,
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: SUBTLE_BORDERS,
    rows: rows.map(([number, title, intro]) => new TableRow({
      children: [
        cell([text(number, { bold: true, size: 18, color: bareHex(brandHex) })], 6),
        cell([text(title, { bold: true, size: 18 })], 30),
        cell([text(intro, { size: 16, color: MUTED })], 64),
      ],
    })),
  });
}

// ---------------------------------------------------------------------------
// Back matter
// ---------------------------------------------------------------------------

function proceedBlock(
  branding: PackBranding, index: number, options: BuildDocumentOptions,
): (Paragraph | Table)[] {
  const proceed = options.proceed ?? {};

  return [
    eyebrow(`Section ${index + 1}`, branding.accentHex),
    heading('Next steps', branding.brandHex),
    body('Complete this with the client once the figures above have been discussed.', { italic: true, color: MUTED }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: SUBTLE_BORDERS,
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            cell([text('Question', { bold: true, size: 18, color: MUTED })], 55),
            cell([text('Answer', { bold: true, size: 18, color: MUTED })], 45),
          ],
        }),
        ...PROCEED_QUESTIONS.map((entry) => {
          const value = proceed.answers?.[entry.key];
          return new TableRow({
            children: [
              cell([
                text(entry.question),
                ...(entry.options ? [text(`Options: ${entry.options}`, { size: 16, color: MUTED, italic: true })] : []),
              ], 55),
              cell([value ? text(value) : new Paragraph('')], 45, { shaded: true }),
            ],
          });
        }),
      ],
    }),
    notesBlock('Interview notes — Next steps'),

    eyebrow('Checklist', branding.accentHex),
    heading('Supporting documents', branding.brandHex),
    body('Collect these alongside the completed pack and record what has come in.', { italic: true, color: MUTED }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: SUBTLE_BORDERS,
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            cell([text('Document', { bold: true, size: 18, color: MUTED })], 46),
            cell([text('Relates to', { bold: true, size: 18, color: MUTED })], 22),
            cell([text('Held', { bold: true, size: 18, color: MUTED })], 12),
            cell([text('Date received', { bold: true, size: 18, color: MUTED })], 20),
          ],
        }),
        ...SUPPORTING_DOCUMENTS.map((entry) => {
          const record = proceed.documents?.[entry.key];
          return new TableRow({
            children: [
              cell([text(entry.label, { size: 18 })], 46),
              cell([text(entry.relatesTo, { size: 16, color: MUTED })], 22),
              cell([record?.held ? text(record.held, { size: 18 }) : text(BOX, { size: 18, color: MUTED })], 12, { shaded: true }),
              cell([record?.received ? text(record.received, { size: 16 }) : new Paragraph('')], 20, { shaded: true }),
            ],
          });
        }),
      ],
    }),
    notesBlock('Outstanding items and who is chasing them', 3),

    eyebrow('Sign-off', branding.accentHex),
    heading('Declaration and consent', branding.brandHex),
    text('Client declaration', { bold: true, size: 19 }),
    body(
      'The information recorded in this pack has been provided by the client and is, to the best of '
      + 'their knowledge, accurate at the date below. It will be verified against source documents '
      + 'before any finance application is made.',
    ),
    text('Privacy and consent', { bold: true, size: 19 }),
    body(
      `The client consents to ${branding.companyName} collecting, holding and using the information `
      + 'in this pack for the purpose of assessing and arranging finance, and to it being disclosed '
      + 'to lenders, valuers and other parties where that is necessary for that purpose.',
    ),
    body(
      'Have your own compliance sign-off on this wording before it goes into circulation.',
      { italic: true, size: 16, color: MUTED },
    ),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: SUBTLE_BORDERS,
      rows: SIGN_OFF_ROWS.map((entry) => {
        const label = entry.key === 'signoff.completedBy'
          ? `${entry.label} (${branding.companyName})`
          : entry.label;
        const value = proceed.signOff?.[entry.key];
        return new TableRow({
          children: [
            cell([text(label, { bold: true, size: 19 })], 34),
            cell([value ? text(value) : new Paragraph('')], 66, { shaded: true }),
          ],
        });
      }),
    }),
  ];
}

/** Website, email, phone, address and ABN — the ABN exists nowhere else. */
function contactBlock(branding: PackBranding): (Paragraph | Table)[] {
  if (!branding.contactRows.length) return [];
  return [
    heading(branding.companyName, branding.brandHex),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: SUBTLE_BORDERS,
      rows: branding.contactRows.map((row) => new TableRow({
        children: [
          cell([text(row.label, { size: 18, bold: true, color: MUTED })], 22),
          cell([text(row.value, { size: 18 })], 78),
        ],
      })),
    }),
  ];
}

/** Build the branded interview document. */
export function buildIntakeDocument(options: BuildDocumentOptions = {}): Document {
  const branding = options.branding ?? DEFAULT_PACK_BRANDING;
  const generatedAt = options.generatedAt ?? new Date();
  const details = options.details ?? {};

  // ---- Cover mark -------------------------------------------------------
  const coverMark: Paragraph[] = [];
  if (branding.logo) {
    // ~40mm wide / 20mm tall bounding box, aspect preserved and never enlarged.
    const { width, height } = fitLogo(branding.logo, 200, 96);
    coverMark.push(new Paragraph({
      spacing: { after: 220 },
      children: [new ImageRun({
        // `docx` types the buffer as Buffer; Uint8Array is what it actually reads.
        data: branding.logo.data as unknown as Buffer,
        transformation: { width: pxToPt(width), height: pxToPt(height) },
        // ExcelJS spells it "jpeg", docx spells it "jpg". The pack stores the
        // ExcelJS spelling, so translate rather than carrying two fields.
        type: branding.logo.extension === 'jpeg' ? 'jpg' : 'png',
      })],
    }));
  }

  const children: (Paragraph | Table)[] = [
    ...coverMark,
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({
        text: branding.companyName, bold: true, size: 26, color: bareHex(branding.brandHex),
      })],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 140 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: bareHex(branding.accentHex), space: 8 } },
      children: [new TextRun({
        text: 'Commercial & Industrial Finance Intake',
        bold: true, size: 40, color: bareHex(branding.brandHex),
      })],
    }),
    body('Client fact-find and interview guide', { italic: true, size: 20, color: MUTED }),
    ...(options.sample
      ? [new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun({
          text: SAMPLE_BANNER, bold: true, size: 20, color: bareHex(branding.accentHex),
        })],
      })]
      : []),

    heading('Pack details', branding.brandHex),
    packDetailsTable(details, options.assessmentReference, branding.brandHex),
    body(
      'This pack is an information-gathering tool. It is not a credit approval, a pre-approval, an '
      + 'offer of finance, financial advice or legal advice.',
      { italic: true, size: 16, color: MUTED },
    ),

    eyebrow('Before you begin', branding.accentHex),
    heading('How to use this pack', branding.brandHex),
    body(
      'This is an interview guide, not a form to hand to the client. Work through it with them and '
      + 'record what they say. When you are back at your desk, enter the answers in the companion '
      + 'workbook — that is the machine-readable half, and it loads every answer into the assessment '
      + 'automatically.',
      { italic: true, color: MUTED },
    ),
    howToUseTable(),

    heading('How to read the layout', branding.brandHex),
    legendTable(branding.brandHex, branding.accentHex),

    heading('A note on ownership structures', branding.brandHex),
    body(
      'Individuals, family trusts and self-managed super funds acquire commercial and industrial '
      + 'property just as often as companies do, and each is assessed differently. Record the '
      + 'structure exactly as it will appear on the contract — including trustees and fund members — '
      + 'and name the owning entity against every existing property and debt. That is what allows '
      + 'the assessment to combine the whole group into one borrowing position rather than looking '
      + 'at this purchase in isolation.',
    ),

    heading('What is in this pack', branding.brandHex),
    contentsTable(branding.brandHex),

    ...PACK_SECTIONS.flatMap((section, index) => sectionBlock(section, index, branding, options)),
    ...proceedBlock(branding, PACK_SECTIONS.length, options),
    ...contactBlock(branding),

    heading('Important', branding.brandHex),
    body(
      'This pack is an information-gathering tool. It is not a credit approval, a pre-approval, an '
      + 'offer of finance, financial advice or legal advice, and it does not represent the credit '
      + 'policy of any particular lender.'
      + (options.sample
        ? ' The figures in this copy are fictional and are provided as a worked example only.'
        : ''),
      { italic: true, size: 18, color: MUTED },
    ),
    body(
      `${options.assessmentTitle ?? 'Intake pack'}`
      + `${options.assessmentReference ? `  ·  ${options.assessmentReference}` : ''}`
      + `  ·  Generated ${generatedAt.toLocaleDateString('en-AU')}`,
      { italic: true, size: 15, color: MUTED },
    ),
  ];

  return new Document({
    creator: branding.companyName,
    title: options.sample
      ? 'Commercial & Industrial finance intake pack — worked example'
      : 'Commercial & Industrial finance intake pack',
    description: options.sample
      ? 'Worked example filled with fictional data, for reference only'
      : 'Client fact-find and interview guide',
    sections: [{
      properties: {},
      // Wordmark text, not the mark — §5. A repeated image in a margin box is
      // fragile across a document this long.
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } },
            children: [new TextRun({
              text: `${branding.companyName}  ·  Commercial & Industrial Finance Intake`
                + (options.sample ? `  —  ${SAMPLE_BANNER}` : ''),
              size: 15, color: MUTED,
            })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: `${branding.companyName}   ·   Confidential   ·   `, size: 15, color: MUTED }),
              new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 15, color: MUTED }),
            ],
          })],
        }),
      },
      children,
    }],
  });
}

/** Serialise the document to a Blob for download. */
export async function documentToBlob(document: Document): Promise<Blob> {
  return Packer.toBlob(document);
}
