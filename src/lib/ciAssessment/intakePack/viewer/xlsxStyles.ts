/**
 * Cell styling, read straight out of the .xlsx.
 *
 * ## Why this exists
 *
 * Neither library already in the project can supply it:
 *
 *  - **ExcelJS cannot open these files at all.** They are written with a
 *    namespace prefix on every element (`<x:worksheet>` rather than
 *    `<worksheet>`), and ExcelJS's SAX reader matches unprefixed tag names, so
 *    it parses the file to nothing and throws on the empty model. Perfectly
 *    valid OOXML — Excel opens them without complaint — but not something that
 *    reader accepts.
 *  - **SheetJS opens them fine** and gives values, formatted text, widths,
 *    heights and merges, but its community build resolves only fills onto the
 *    cell. Fonts, borders and alignment are dropped.
 *
 * Between them that leaves white bold text on the brand header bands rendering
 * as black, and every rule in the document disappearing. For a viewer whose
 * whole job is to show the approved document faithfully, that is not a detail.
 *
 * So this reads `styles.xml` and the sheet XML directly and resolves each
 * cell's style index. It is namespace-agnostic by construction — every lookup
 * goes through `getElementsByTagNameNS('*', …)`, which matches on local name —
 * which is exactly the thing ExcelJS gets wrong.
 */

export interface CellStyle {
  fill?: string;
  fontColour?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontName?: string;
  horizontal?: string;
  vertical?: string;
  wrap?: boolean;
  indent?: number;
  border?: {
    top?: BorderEdge; right?: BorderEdge; bottom?: BorderEdge; left?: BorderEdge;
  };
}

export interface BorderEdge {
  style: string;
  colour?: string;
}

/** address (`B4`) → style, per sheet name. */
export type SheetStyles = Map<string, Map<string, CellStyle>>;

function children(node: Element | Document, localName: string): Element[] {
  return Array.from(node.getElementsByTagNameNS('*', localName));
}

/** Direct children only — `<xf>` inside `<cellXfs>`, not inside `<cellStyleXfs>`. */
function directChildren(node: Element, localName: string): Element[] {
  return Array.from(node.children).filter((child) => child.localName === localName);
}

function attribute(node: Element | null | undefined, name: string): string | undefined {
  if (!node) return undefined;
  // Attributes may or may not carry a namespace prefix depending on the writer.
  const direct = node.getAttribute(name);
  if (direct != null) return direct;
  const match = Array.from(node.attributes).find((item) => item.localName === name);
  return match?.value;
}

/** `FFRRGGBB` or `RRGGBB` → `#rrggbb`. Theme and indexed colours are skipped. */
function colourOf(node: Element | undefined): string | undefined {
  if (!node) return undefined;
  const rgb = attribute(node, 'rgb');
  if (!rgb) return undefined;
  const hex = rgb.length === 8 ? rgb.slice(2) : rgb;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  return `#${hex.toLowerCase()}`;
}

function firstChild(node: Element, localName: string): Element | undefined {
  return directChildren(node, localName)[0];
}

interface StyleTables {
  fonts: Array<Partial<CellStyle>>;
  fills: Array<string | undefined>;
  borders: Array<CellStyle['border']>;
  cellXfs: Array<{ fontId: number; fillId: number; borderId: number; alignment?: Partial<CellStyle> }>;
}

function parseStyles(xml: string): StyleTables {
  const document = new DOMParser().parseFromString(xml, 'application/xml');

  const fonts = (children(document, 'fonts')[0]
    ? directChildren(children(document, 'fonts')[0], 'font')
    : []
  ).map<Partial<CellStyle>>((font) => ({
    bold: directChildren(font, 'b').length > 0,
    italic: directChildren(font, 'i').length > 0,
    underline: directChildren(font, 'u').length > 0,
    fontSize: Number(attribute(firstChild(font, 'sz'), 'val')) || undefined,
    fontName: attribute(firstChild(font, 'name'), 'val') ?? undefined,
    fontColour: colourOf(firstChild(font, 'color')),
  }));

  const fills = (children(document, 'fills')[0]
    ? directChildren(children(document, 'fills')[0], 'fill')
    : []
  ).map((fill) => {
    const pattern = firstChild(fill, 'patternFill');
    if (!pattern) return undefined;
    if (attribute(pattern, 'patternType') === 'none') return undefined;
    return colourOf(firstChild(pattern, 'fgColor'));
  });

  const borders = (children(document, 'borders')[0]
    ? directChildren(children(document, 'borders')[0], 'border')
    : []
  ).map((border) => {
    const edge = (name: string): BorderEdge | undefined => {
      const node = firstChild(border, name);
      const style = node ? attribute(node, 'style') : undefined;
      if (!style || style === 'none') return undefined;
      return { style, colour: colourOf(firstChild(node!, 'color')) };
    };
    const resolved = {
      top: edge('top'), right: edge('right'), bottom: edge('bottom'), left: edge('left'),
    };
    return Object.values(resolved).some(Boolean) ? resolved : undefined;
  });

  const cellXfsNode = children(document, 'cellXfs')[0];
  const cellXfs = (cellXfsNode ? directChildren(cellXfsNode, 'xf') : []).map((xf) => {
    const alignmentNode = firstChild(xf, 'alignment');
    const alignment: Partial<CellStyle> | undefined = alignmentNode
      ? {
        horizontal: attribute(alignmentNode, 'horizontal') ?? undefined,
        vertical: attribute(alignmentNode, 'vertical') ?? undefined,
        wrap: attribute(alignmentNode, 'wrapText') === '1',
        indent: Number(attribute(alignmentNode, 'indent')) || undefined,
      }
      : undefined;
    return {
      fontId: Number(attribute(xf, 'fontId') ?? 0),
      fillId: Number(attribute(xf, 'fillId') ?? 0),
      borderId: Number(attribute(xf, 'borderId') ?? 0),
      // `applyFont="0"` means "inherit", but writers are inconsistent about
      // emitting it, and every style in these files is explicit. Taking the
      // referenced ids unconditionally matches what Excel shows.
      alignment,
    };
  });

  return { fonts, fills, borders, cellXfs };
}

function resolve(tables: StyleTables, index: number): CellStyle | undefined {
  const xf = tables.cellXfs[index];
  if (!xf) return undefined;

  const font = tables.fonts[xf.fontId] ?? {};
  const style: CellStyle = {
    fill: tables.fills[xf.fillId],
    border: tables.borders[xf.borderId],
    bold: font.bold || undefined,
    italic: font.italic || undefined,
    underline: font.underline || undefined,
    fontSize: font.fontSize,
    fontName: font.fontName,
    fontColour: font.fontColour,
    horizontal: xf.alignment?.horizontal,
    vertical: xf.alignment?.vertical,
    wrap: xf.alignment?.wrap || undefined,
    indent: xf.alignment?.indent,
  };

  return Object.values(style).some((value) => value !== undefined) ? style : undefined;
}

/**
 * Read every cell's resolved style, keyed by sheet name then cell address.
 *
 * Sheet order in `workbook.xml` maps to `worksheets/sheetN.xml` through the
 * relationship ids, which is the only mapping that is reliable — the file names
 * do not have to be in order and do not have to be `sheet1.xml` at all.
 */
export async function readWorkbookStyles(data: ArrayBuffer): Promise<SheetStyles> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(data);

  const stylesXml = await zip.file('xl/styles.xml')?.async('string');
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!stylesXml || !workbookXml || !relsXml) return new Map();

  const tables = parseStyles(stylesXml);

  const relationships = new Map<string, string>();
  children(
    new DOMParser().parseFromString(relsXml, 'application/xml'), 'Relationship',
  ).forEach((node) => {
    const id = attribute(node, 'Id');
    const target = attribute(node, 'Target');
    if (id && target) relationships.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  });

  const sheetNodes = children(
    new DOMParser().parseFromString(workbookXml, 'application/xml'), 'sheet',
  );

  const result: SheetStyles = new Map();

  for (const node of sheetNodes) {
    const name = attribute(node, 'name');
    const relationshipId = attribute(node, 'id');
    if (!name || !relationshipId) continue;

    const target = relationships.get(relationshipId);
    const file = target ? zip.file(`xl/${target}`) : null;
    if (!file) continue;

    const sheetXml = await file.async('string');
    const sheet = new DOMParser().parseFromString(sheetXml, 'application/xml');
    const styles = new Map<string, CellStyle>();

    children(sheet, 'c').forEach((cell) => {
      const address = attribute(cell, 'r');
      const styleIndex = attribute(cell, 's');
      if (!address || styleIndex == null) return;
      const style = resolve(tables, Number(styleIndex));
      if (style) styles.set(address, style);
    });

    result.set(name, styles);
  }

  return result;
}
