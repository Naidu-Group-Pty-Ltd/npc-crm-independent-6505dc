/**
 * The submission record as a PDF — the download the reviewer keeps.
 *
 * ── A presentation, never a second source ─────────────────────────────
 * This renders the SAME `SubmissionRecord` structure the reading view, the
 * self-contained HTML and the stored copy come from
 * (`submissionRecord.pure.ts`). Nothing here reads the review payload —
 * every string on the page was already decided by `buildSubmissionRecord`,
 * so the PDF cannot say anything the other presentations do not.
 *
 * ── Why jsPDF, drawn directly ─────────────────────────────────────────
 * Direct text drawing is this repo's established client-download path
 * (`OverviewSnapshotPDF.ts` and kin), it produces selectable, searchable
 * text, and it runs entirely in the browser from the data on screen — no
 * edge round-trip, no render container, nothing fetched from anywhere. The
 * WeasyPrint report programme is deliberately untouched: the record is an
 * internal compliance artefact, not a branded client report, so none of the
 * template machinery, tenant branding or ledger rows apply. Never
 * rasterise this through html2canvas — a compliance record must stay text.
 *
 * ── Print rules that DO apply (REPORT_RULES.md) ───────────────────────
 * Small type keeps a ≥7:1 contrast floor: labels and running feet are
 * achromatic greys chosen for it, ink is near-black on white. No logo asset
 * appears (the record is internal, and most repo "logos" are signature
 * banners), no engine name is printed, dates arrive already formatted by
 * the shared `formatUtc`.
 */
import { recordDocumentTitle, type RecordBlock, type RecordTable, type SubmissionRecord } from "@/lib/aml/submissionRecord";
import type { RecordBrand } from "@/lib/aml/submissionRecordBrand";

/** jsPDF wants 0–255 channels; the brand ramp arrives as hex. */
function hexRgb255(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [17, 17, 17];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Warm cream for type on the obsidian masthead — fixed, like the ground:
 *  the wordmark must read whatever accent a tenant chooses. */
const CREAM: [number, number, number] = [245, 239, 228];

/**
 * What the page calls itself: the masthead title, the line under the
 * subject, and the running foot's left segment.
 *
 * ── Why this is a parameter ───────────────────────────────────────────
 * The three strings were composed inline from `record.audience` and
 * `record.version`, with "Submission v{n}" written into the masthead, the
 * identity line and the foot. That is correct for the one document this
 * renderer was built for and wrong for every other — an AUSTRAC bundle
 * printed "Submission v1" across a document that is not a submission and
 * has no submission version.
 *
 * The alternative was a second generator, which is how a repository ends up
 * with two print treatments that drift: this one already carries the
 * white-label masthead, the Aurixa fallback, the contrast floor the print
 * rules set, and selectable text. So the identity is lifted out and
 * defaulted, and the existing caller passes nothing and renders exactly what
 * it rendered before.
 */
export interface RecordDocumentIdentity {
  /** Opposite the masthead logo — what kind of document this is. */
  title: string;
  /** Under the subject: reference, then what edition of it this is. */
  identityLine: string;
  /** The running foot, minus the issuing brand and the page numbers. */
  footLine: string;
}

/** The identity a client submission record has always carried. */
export function submissionRecordIdentity(record: SubmissionRecord): RecordDocumentIdentity {
  return {
    title: recordDocumentTitle(record),
    identityLine: `${record.reference}  ·  Submission v${record.version}`,
    footLine: `${record.reference} · Submission v${record.version} · ${record.generatedAt}`,
  };
}

/** `…-record.html` → `…-record.pdf` — one filename rule, one extension swap. */
export function submissionRecordPdfFilename(record: Pick<SubmissionRecord, "filename">): string {
  return record.filename.replace(/\.html$/, ".pdf");
}

/* A4 in mm. */
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOT_Y = PAGE_H - 11;
/** Content must stop above the running foot. */
const CONTENT_BOTTOM = PAGE_H - MARGIN - 4;

const PT_TO_MM = 0.3528;
const lineHeight = (pt: number) => pt * PT_TO_MM * 1.45;

/* Achromatic palette. #555 on white is ≈7.5:1 — over the 7:1 floor the
 * print rules set for sub-10pt type. */
const INK: [number, number, number] = [17, 17, 17];
const LABEL: [number, number, number] = [85, 85, 85];
const RULE_DARK = 120;
const RULE_LIGHT = 210;

/* 44mm holds the longest label the record produces ("Risk assessment
 * standing", "Service gate (read-only)") without wrapping; 62mm left a dead
 * trench between question and answer across the whole page. */
const LABEL_COL_W = 44;
const GRID_GAP = 4;
/** One trailing pad after every block, so a section heading always gets the
 *  same space-before whatever precedes it. */
const BLOCK_PAD = 2;

interface Cursor { y: number }

type Doc = import("jspdf").jsPDF;

function newPageIfNeeded(doc: Doc, cursor: Cursor, needed: number): boolean {
  if (cursor.y + needed <= CONTENT_BOTTOM) return false;
  doc.addPage();
  cursor.y = MARGIN;
  return true;
}

interface MeasuredRow { labelLines: string[]; valueLines: string[]; rowH: number }

function measureLabelled(doc: Doc, label: string, value: string): MeasuredRow {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const labelLines = doc.splitTextToSize(label.toUpperCase(), LABEL_COL_W) as string[];
  doc.setFontSize(9.5);
  const valueLines = doc.splitTextToSize(value, CONTENT_W - LABEL_COL_W - GRID_GAP) as string[];
  const rowH = Math.max(labelLines.length * lineHeight(7.5), valueLines.length * lineHeight(9.5)) + 1.1;
  return { labelLines, valueLines, rowH };
}

function drawMeasuredRow(doc: Doc, cursor: Cursor, row: MeasuredRow) {
  // Label and value share ONE baseline — the value's. Offsetting each by its
  // own line height staggered every row by 0.8mm, which read as unset type
  // beside the tables (whose header and cells align exactly).
  const baseline = cursor.y + lineHeight(9.5) * 0.8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...LABEL);
  doc.text(row.labelLines, MARGIN, baseline);
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(row.valueLines, MARGIN + LABEL_COL_W + GRID_GAP, baseline);
  cursor.y += row.rowH;
}

/**
 * Draw a fields group with widow control: the final row of a group must
 * never sit alone at the top of a page (a lone "INSTITUTIONS  Cba" under
 * the page strip belongs to nothing a reader can see). The second-to-last
 * row reserves the last row's height too — either both fit here, or both
 * move together.
 */
function drawFieldRows(doc: Doc, cursor: Cursor, rows: MeasuredRow[]) {
  for (let i = 0; i < rows.length; i++) {
    const needed = i === rows.length - 2 ? rows[i].rowH + rows[i + 1].rowH : rows[i].rowH;
    newPageIfNeeded(doc, cursor, needed);
    drawMeasuredRow(doc, cursor, rows[i]);
  }
}

/**
 * Column widths from MEASURED text, not character counts — a proportional
 * face renders 22 chars of date narrower than 17 chars of hex, so counting
 * characters starved exactly the columns that needed width. Each column's
 * natural width is the widest of its rendered header and rendered cells
 * (capped, so one opaque filename cannot starve the rest); the set is then
 * scaled to fill the content width so every table ends on the right rule.
 * A cell wider than its column wraps — it is never truncated.
 */
function tableColumnWidths(doc: Doc, table: RecordTable): number[] {
  const MIN_W = 16;
  const CAP_W = 78;
  const PAD = 4;
  const natural = table.columns.map((c, i) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    let w = doc.getTextWidth(c.toUpperCase());
    for (const row of table.rows) {
      const cell = row[i] || "—";
      // A hex literal draws in Courier at 8.5pt (see drawTable) — measure it
      // in the face it will wear, or the column is sized for the wrong text.
      doc.setFont(isHexLiteral(cell) ? "courier" : "helvetica", "normal");
      doc.setFontSize(isHexLiteral(cell) ? 8.5 : 9.5);
      w = Math.max(w, doc.getTextWidth(cell));
    }
    return Math.min(Math.max(w + PAD, MIN_W), CAP_W);
  });
  doc.setFont("helvetica", "normal");
  const total = natural.reduce((a, b) => a + b, 0);
  const scaled = natural.map((w) => (w / total) * CONTENT_W);
  for (let i = 0; i < scaled.length; i++) {
    if (scaled[i] < MIN_W) {
      const deficit = MIN_W - scaled[i];
      scaled[i] = MIN_W;
      scaled[scaled.indexOf(Math.max(...scaled))] -= deficit;
    }
  }
  /*
   * Snap every interior column edge to a 5mm grid. Stacked tables carry
   * their own measured grids by design — but measurement makes two terminal
   * columns land 1.3mm apart, and NEAR-alignment reads as a wobble where
   * either exact alignment or a visible difference reads as intent.
   */
  const edges: number[] = [];
  let cum = 0;
  for (let i = 0; i < scaled.length - 1; i++) {
    cum += scaled[i];
    const prev = edges[i - 1] ?? 0;
    const remaining = (scaled.length - 1 - i) * MIN_W;
    edges.push(Math.min(
      Math.max(Math.round(cum / 5) * 5, prev + MIN_W),
      CONTENT_W - remaining,
    ));
  }
  edges.push(CONTENT_W);
  const widths = edges.map((e, i) => e - (edges[i - 1] ?? 0));
  /*
   * Gutter floor: snapping and the min-width lift must never squeeze a
   * column below the text it holds — that collapses the gutter and two
   * columns read (and machine-extract) as one run. Any deficit is taken
   * from the widest column; legibility outranks the 5mm grid when the two
   * conflict.
   */
  for (let i = 0; i < widths.length; i++) {
    const deficit = natural[i] - widths[i];
    if (deficit > 0) {
      const widest = widths.indexOf(Math.max(...widths));
      if (widest !== i && widths[widest] - deficit >= MIN_W) {
        widths[widest] -= deficit;
        widths[i] += deficit;
      }
    }
  }
  return widths;
}

/** A long hex token is a literal — a hash, a key. It wears a monospaced
 *  face: more digits fit before wrapping, and the face itself says "read me
 *  back character by character". */
const isHexLiteral = (s: string) => /^[0-9a-f]{24,}$/i.test(s.trim());

function drawTableHeader(doc: Doc, cursor: Cursor, table: RecordTable, widths: number[]) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...LABEL);
  let x = MARGIN;
  const h = lineHeight(7.5) + 1.2;
  table.columns.forEach((c, i) => {
    doc.text(c.toUpperCase(), x, cursor.y + lineHeight(7.5) * 0.8, { maxWidth: widths[i] - 2 });
    x += widths[i];
  });
  cursor.y += h;
  doc.setDrawColor(RULE_DARK);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, cursor.y, MARGIN + CONTENT_W, cursor.y);
  cursor.y += 1.2;
  doc.setFont("helvetica", "normal");
}

function drawTable(doc: Doc, cursor: Cursor, table: RecordTable) {
  const widths = tableColumnWidths(doc, table);
  newPageIfNeeded(doc, cursor, lineHeight(7.5) + lineHeight(9.5) * 2 + 6);
  drawTableHeader(doc, cursor, table, widths);
  for (const row of table.rows) {
    const cells = row.map((cell, i) => {
      const text = cell || "—";
      const mono = isHexLiteral(text);
      doc.setFont(mono ? "courier" : "helvetica", "normal");
      doc.setFontSize(mono ? 8.5 : 9.5);
      return {
        mono,
        size: mono ? 8.5 : 9.5,
        lines: doc.splitTextToSize(text, widths[i] - 3) as string[],
      };
    });
    const rowH = Math.max(...cells.map((c) => c.lines.length * lineHeight(c.size))) + 2.2;
    // A row never splits; the header travels to the new page with it.
    if (newPageIfNeeded(doc, cursor, rowH)) {
      drawTableHeader(doc, cursor, table, widths);
    }
    doc.setTextColor(...INK);
    // One baseline for the whole row, whatever face each cell wears.
    const baseline = cursor.y + lineHeight(9.5) * 0.8;
    let x = MARGIN;
    cells.forEach((c, i) => {
      doc.setFont(c.mono ? "courier" : "helvetica", "normal");
      doc.setFontSize(c.size);
      doc.text(c.lines, x, baseline);
      x += widths[i];
    });
    doc.setFont("helvetica", "normal");
    cursor.y += rowH;
    doc.setDrawColor(RULE_LIGHT);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, cursor.y - 0.8, MARGIN + CONTENT_W, cursor.y - 0.8);
  }
  cursor.y += BLOCK_PAD;
}

function drawBlock(doc: Doc, cursor: Cursor, block: RecordBlock) {
  const rows = block.fields ? block.fields.map((f) => measureLabelled(doc, f.label, f.value)) : null;
  if (block.heading) {
    /* A group heading arrives WITH its rows or not at all: a heading at
     * the page foot over one row, with the rest overleaf under the page
     * strip, leaves rows belonging to nothing a reader can see. A small
     * group (≤4 rows) is kept whole; a large one must bring its first two
     * rows; a heading over a paragraph reserves the paragraph's start. */
    const headingH = 2 + lineHeight(9.5) + 1.5;
    const reserve = rows
      ? rows.length <= 4
        ? headingH + rows.reduce((a, r) => a + r.rowH, 0)
        : headingH + rows[0].rowH + rows[1].rowH
      : headingH + lineHeight(9.5) * 2;
    newPageIfNeeded(doc, cursor, reserve);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    cursor.y += 2;
    doc.text(block.heading, MARGIN, cursor.y + lineHeight(9.5) * 0.8);
    cursor.y += lineHeight(9.5) + 1.5;
    doc.setFont("helvetica", "normal");
  }
  if (block.paragraph) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    // Space-before, so a sentence following a fields block reads as prose
    // and not as a value that slid out of the grid.
    cursor.y += 1.5;
    const lines = doc.splitTextToSize(block.paragraph, CONTENT_W) as string[];
    const h = lines.length * lineHeight(9.5) + BLOCK_PAD;
    newPageIfNeeded(doc, cursor, h);
    doc.setTextColor(...LABEL);
    doc.text(lines, MARGIN, cursor.y + lineHeight(9.5) * 0.8);
    cursor.y += h;
  }
  if (rows) {
    drawFieldRows(doc, cursor, rows);
    cursor.y += BLOCK_PAD;
  }
  if (block.table) drawTable(doc, cursor, block.table);
}

/**
 * Render the record to a PDF blob. jsPDF is imported lazily so the case
 * workspace pays nothing until somebody actually downloads.
 *
 * `brand` is the issuing identity (tenant white-label, or the Aurixa
 * Systems fallback — see `submissionRecordBrand.ts`). It dresses the
 * document: the obsidian masthead, the accent rules, the wordmark or logo,
 * the "prepared by" line in the foot. It never touches content — body ink,
 * table structure and every string stay exactly what the record says.
 * Omitted (tests, degraded paths), the document renders in its unbranded
 * austere form.
 */
export async function generateSubmissionRecordPdf(
  record: SubmissionRecord,
  brand?: RecordBrand,
  identity: RecordDocumentIdentity = submissionRecordIdentity(record),
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  // Multi-line text draws at jsPDF's default 1.15 leading unless told
  // otherwise, while every height RESERVED here uses 1.45 — the mismatch
  // floats row rules away from wrapped text. One factor, set once.
  doc.setLineHeightFactor(1.45);
  const cursor: Cursor = { y: MARGIN };
  const docTitle = identity.title;

  const BAND_H = 16;
  if (brand) {
    /* ── The masthead band: who issues this document ──────────────────
     * One flat obsidian ground with an accent strip beneath — the print
     * rules' cover treatment at letterhead scale. The identity is the
     * logo when a raster mark loaded, the wordmark otherwise; the
     * document type sits opposite in the accent light, which holds ≥7:1
     * on obsidian. */
    doc.setFillColor(...hexRgb255(brand.ground));
    doc.rect(0, 0, PAGE_W, BAND_H, "F");
    doc.setFillColor(...hexRgb255(brand.accent));
    doc.rect(0, BAND_H, PAGE_W, 1.1, "F");

    let identityX = MARGIN;
    let logoDrawn = false;
    if (brand.logoDataUrl) {
      try {
        const props = doc.getImageProperties(brand.logoDataUrl);
        const h = 10;
        const w = Math.min((props.width / props.height) * h, 46);
        doc.addImage(brand.logoDataUrl, MARGIN, (BAND_H - h) / 2, w, h);
        identityX = MARGIN + w + 3.5;
        logoDrawn = true;
      } catch {
        // A mark that cannot be drawn degrades to the wordmark below.
      }
    }
    // A bare emblem (the Aurixa delta) does not carry the name, so the
    // wordmark stands beside it; a tenant's report logo is a complete
    // lockup and stands alone.
    if (!logoDrawn || brand.wordmarkBesideLogo) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...CREAM);
      doc.text(brand.name.toUpperCase(), identityX, BAND_H / 2 + 1.4, { charSpace: 0.5 });
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...hexRgb255(brand.accentLight));
    // Measured by hand and drawn left-anchored: jsPDF's `align: "right"`
    // anchors on getTextWidth(), which excludes charSpace — the string then
    // overruns the right margin by the whole accumulated letter-spacing
    // (~14mm here) and stops millimetres from the trim.
    const bandLabel = docTitle.toUpperCase();
    const bandLabelW = doc.getTextWidth(bandLabel) + 0.6 * Math.max(0, bandLabel.length - 1);
    doc.text(bandLabel, PAGE_W - MARGIN - bandLabelW, BAND_H / 2 + 1, { charSpace: 0.6 });

    /* Below the band: the case, not the issuer — subject leads, the
     * reference line under it, and the heavy rule takes the accent deep. */
    cursor.y = BAND_H + 1.1 + 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...INK);
    doc.text(record.subject, MARGIN, cursor.y + lineHeight(16) * 0.8);
    cursor.y += lineHeight(16) + 1;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...LABEL);
    doc.text(identity.identityLine, MARGIN, cursor.y + lineHeight(9.5) * 0.8);
    cursor.y += lineHeight(9.5) + 3;
    doc.setDrawColor(...hexRgb255(brand.accentDeep));
    doc.setLineWidth(0.6);
    doc.line(MARGIN, cursor.y, MARGIN + CONTENT_W, cursor.y);
    cursor.y += 6;
  } else {
    /* Document header — mirrors the HTML's: title, identity line, heavy
     * rule. The meta line stays UNDER body size: at 10.5pt it crowded the
     * section titles and the type scale lost its middle. */
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...INK);
    doc.text(docTitle, MARGIN, cursor.y + lineHeight(16) * 0.8);
    cursor.y += lineHeight(16) + 1;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...LABEL);
    doc.text(record.headerFields.map((f) => f.value).join("  ·  "), MARGIN, cursor.y + lineHeight(9.5) * 0.8);
    cursor.y += lineHeight(9.5) + 3;
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, cursor.y, MARGIN + CONTENT_W, cursor.y);
    cursor.y += 6;
  }

  for (const section of record.sections) {
    /* Never strand a section title at the page foot — and "not stranded"
     * means the title arrives WITH the start of its first block. A flat
     * reserve left a heading and its rule alone at the foot of a client's
     * page with a bare table header overleaf: a table's opening needs more
     * room than a fields row, so the reserve asks the first block what it
     * needs. */
    const first = section.blocks[0];
    const firstBlockMin = first?.table
      ? lineHeight(7.5) + lineHeight(9.5) * 2 + 6
      : first?.heading
        ? lineHeight(9.5) + 15.5
        : lineHeight(9.5) * 2 + 3;
    newPageIfNeeded(doc, cursor, lineHeight(11.5) + 4.2 + firstBlockMin);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...INK);
    doc.text(section.title, MARGIN, cursor.y + lineHeight(11.5) * 0.8);
    cursor.y += lineHeight(11.5) + 1.2;
    doc.setDrawColor(RULE_DARK);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, cursor.y, MARGIN + CONTENT_W, cursor.y);
    cursor.y += 3;
    for (const block of section.blocks) drawBlock(doc, cursor, block);
    cursor.y += 3.5;
  }

  /* The closing notice — the record's own words (`record.notice`), which
   * differ by audience: the internal record says it must not reach the
   * client, the client copy says what was deliberately left out. The
   * reference and generation timestamp are NOT repeated here: the running
   * foot below already carries both on every page, and printing them twice
   * on one sheet reads as a mistake. Only what the foot lacks — who
   * generated it — precedes the notice. */
  const notice = record.notice;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const noticeLines = doc.splitTextToSize(notice, CONTENT_W) as string[];
  // Pinned just above the running foot of the last page — a colophon sitting
  // wherever the content happened to stop reads as a truncated document.
  const colophonH = 3
    + (record.generatedBy ? lineHeight(8.5) + 1 : 0)
    + noticeLines.length * lineHeight(8.5);
  /* 10mm above the foot, not 6: at 6 the foot read as a third line of the
     colophon — same grey, same alignment, one point of size apart.

     It is PINNED to the foot only when it fits on the page the content ended
     on. When it does not, pinning it to the foot of a fresh page produces a
     sheet that is blank apart from a footer — which is what a two-page
     AUSTRAC record looked like when its content overran by a centimetre. On
     a new page it follows the top margin instead, so a break yields a page
     that starts with something rather than a blank one that ends with it. */
  if (cursor.y + 2 > FOOT_Y - 10 - colophonH) {
    doc.addPage();
    cursor.y = MARGIN + 4;
  } else {
    cursor.y = FOOT_Y - 10 - colophonH;
  }
  doc.setDrawColor(RULE_DARK);
  doc.setLineWidth(0.25);
  doc.line(MARGIN, cursor.y, MARGIN + CONTENT_W, cursor.y);
  cursor.y += 3;
  doc.setTextColor(...LABEL);
  if (record.generatedBy) {
    doc.text(`Generated by ${record.generatedBy}.`, MARGIN, cursor.y + lineHeight(8.5) * 0.8);
    cursor.y += lineHeight(8.5) + 1;
  }
  doc.text(noticeLines, MARGIN, cursor.y + lineHeight(8.5) * 0.8);

  /* Running foot on every page, once the page count is final — the issuer
   * leads it when the document is branded. Continuation pages carry the
   * masthead reduced to a strip, so every sheet says whose document it is. */
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    if (brand && i > 1) {
      doc.setFillColor(...hexRgb255(brand.ground));
      doc.rect(0, 0, PAGE_W, 2.2, "F");
      doc.setFillColor(...hexRgb255(brand.accent));
      doc.rect(0, 2.2, PAGE_W, 0.6, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...LABEL);
    const footLeft = brand ? `${brand.name} · ${identity.footLine}` : identity.footLine;
    doc.text(footLeft, MARGIN, FOOT_Y);
    doc.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, FOOT_Y, { align: "right" });
  }

  return doc.output("blob");
}
