/**
 * Figma → ReportTemplate compiler.
 *
 * Walks a Figma node tree and emits the project's `ReportTemplate` JSON
 * shape (see `src/lib/reportTemplate/templateSchema.ts`).
 *
 * Conventions (encoded in Figma layer names):
 *   FRAME at depth 1                 → page
 *   FRAME at depth 2 named `slot:x`  → slot block (props.slotKey = x)
 *   TEXT named `bind:path.to.field`  → textBlock bound to data path
 *   TEXT (plain)                     → textBlock with literal content
 *   RECTANGLE/FRAME with image fill  → imageBlock
 *   RECTANGLE/FRAME (solid fill)     → shape overlay
 *   Layer name prefix `token:xxx`    → forces colour binding to token xxx
 *
 * Unknown node types are skipped with a warning recorded into `warnings[]`.
 */

export interface CompileResult {
  template: any;
  warnings: string[];
  stats: { pages: number; blocks: number; overlays: number; bound: number };
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  children?: FigmaNode[];
  fills?: any[];
  strokes?: any[];
  strokeWeight?: number;
  cornerRadius?: number;
  characters?: string;
  style?: {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    lineHeightPx?: number;
    letterSpacing?: number;
    textAlignHorizontal?: string;
    italic?: boolean;
  };
  rotation?: number;
  opacity?: number;
}

const A4 = { width: 595, height: 842 };

function rgbToHex(c: { r: number; g: number; b: number; a?: number }): string {
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`.toUpperCase();
}

function getSolidFill(node: FigmaNode): string | null {
  const fill = (node.fills || []).find((f: any) => f.visible !== false && f.type === 'SOLID');
  if (!fill?.color) return null;
  return rgbToHex(fill.color);
}

function hasImageFill(node: FigmaNode): boolean {
  return (node.fills || []).some((f: any) => f.visible !== false && f.type === 'IMAGE');
}

function imageRefFill(node: FigmaNode): string | null {
  const fill = (node.fills || []).find((f: any) => f.visible !== false && f.type === 'IMAGE');
  return fill?.imageRef || null;
}

function parseNamePrefix(name: string): { kind: string | null; value: string; rest: string } {
  const m = name.match(/^(bind|slot|token|kpi|chart|repeat|image):([^\s]+)\s*(.*)$/i);
  if (!m) return { kind: null, value: '', rest: name };
  return { kind: m[1].toLowerCase(), value: m[2], rest: m[3] || '' };
}

function relativeBox(node: FigmaNode, parent: FigmaNode | null) {
  const nb = node.absoluteBoundingBox;
  if (!nb) return { x: 0, y: 0, width: 0, height: 0 };
  const pb = parent?.absoluteBoundingBox;
  return {
    x: pb ? nb.x - pb.x : 0,
    y: pb ? nb.y - pb.y : 0,
    width: nb.width,
    height: nb.height,
  };
}

function nodeToTextOverlay(node: FigmaNode, parent: FigmaNode, warnings: string[]) {
  const box = relativeBox(node, parent);
  const { kind, value } = parseNamePrefix(node.name);
  const content = kind === 'bind' ? `{{${value}}}` : (node.characters || '');
  const color = getSolidFill(node) || '#000000';
  const style = node.style || {};
  return {
    id: node.id,
    type: 'text' as const,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: node.rotation ? -node.rotation * (180 / Math.PI) : 0,
    opacity: node.opacity ?? 1,
    content,
    fontFamily: style.fontFamily || 'Helvetica',
    fontSize: style.fontSize || 12,
    fontWeight: (style.fontWeight && style.fontWeight >= 600) ? ('bold' as const) : ('normal' as const),
    fontStyle: style.italic ? ('italic' as const) : ('normal' as const),
    color,
    align: (style.textAlignHorizontal?.toLowerCase() || 'left') as 'left' | 'center' | 'right',
    lineHeight: style.lineHeightPx && style.fontSize ? style.lineHeightPx / style.fontSize : 1.3,
    letterSpacing: style.letterSpacing || 0,
  };
}

function nodeToImageOverlay(node: FigmaNode, parent: FigmaNode, fileKey: string) {
  const box = relativeBox(node, parent);
  const ref = imageRefFill(node);
  // Figma image fills need a separate /v1/images endpoint to resolve; we store
  // a placeholder URL that the front-end will resolve via the edge fn.
  const src = ref ? `figma://${fileKey}/image/${ref}` : '';
  return {
    id: node.id,
    type: 'image' as const,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: 0,
    opacity: node.opacity ?? 1,
    src,
    fit: 'cover' as const,
  };
}

function nodeToShapeOverlay(node: FigmaNode, parent: FigmaNode) {
  const box = relativeBox(node, parent);
  const fill = getSolidFill(node);
  return {
    id: node.id,
    type: 'shape' as const,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: 0,
    opacity: node.opacity ?? 1,
    shape: 'rect' as const,
    fill: fill || undefined,
    strokeWidth: node.strokeWeight || 0,
    borderRadius: node.cornerRadius || 0,
  };
}

function walkPageChildren(
  pageNode: FigmaNode,
  fileKey: string,
  warnings: string[],
  counters: { blocks: number; overlays: number; bound: number },
) {
  const blocks: any[] = [];
  const overlays: any[] = [];

  const traverse = (node: FigmaNode, parent: FigmaNode) => {
    if (node.visible === false) return;
    const { kind, value } = parseNamePrefix(node.name);

    // Slot block — emits a `slot` block referencing slotKey
    if (kind === 'slot') {
      blocks.push({
        id: node.id,
        type: 'slot',
        props: { slotKey: value },
        overlays: [],
      });
      counters.blocks++;
      return;
    }

    if (node.type === 'TEXT') {
      const o = nodeToTextOverlay(node, parent, warnings);
      overlays.push(o);
      counters.overlays++;
      if (kind === 'bind') counters.bound++;
      return;
    }

    if (hasImageFill(node)) {
      overlays.push(nodeToImageOverlay(node, parent, fileKey));
      counters.overlays++;
      return;
    }

    if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE' || (node.type === 'FRAME' && getSolidFill(node))) {
      overlays.push(nodeToShapeOverlay(node, parent));
      counters.overlays++;
    }

    // Recurse into groups / inner frames
    if (node.children) {
      for (const c of node.children) traverse(c, parent);
    }
  };

  for (const child of pageNode.children || []) traverse(child, pageNode);

  // Wrap all overlays in a single 'free' block so the renderer picks them up.
  if (overlays.length > 0) {
    blocks.push({
      id: `${pageNode.id}_overlays`,
      type: 'free',
      props: {},
      overlays,
    });
    counters.blocks++;
  }

  return blocks;
}

/** Extract colour and font tokens from any node we encounter. */
function harvestTokens(root: FigmaNode): { colors: Record<string, string>; fonts: Record<string, string> } {
  const colors: Record<string, string> = {};
  const fonts: Record<string, string> = {};
  const walk = (n: FigmaNode) => {
    if (n.visible === false) return;
    const c = getSolidFill(n);
    if (c) colors[`auto_${Object.keys(colors).length}`] = c;
    if (n.style?.fontFamily) fonts[n.style.fontFamily.replace(/\s+/g, '_').toLowerCase()] = n.style.fontFamily;
    (n.children || []).forEach(walk);
  };
  walk(root);
  // Dedupe colours by value, keep nicer keys
  const seen = new Set<string>();
  const out: Record<string, string> = {};
  let i = 0;
  for (const v of Object.values(colors)) {
    if (seen.has(v)) continue;
    seen.add(v);
    out[i === 0 ? 'primary' : i === 1 ? 'accent' : `c${i}`] = v;
    i++;
  }
  return { colors: out, fonts };
}

export function compileFigmaToReportTemplate(rootNode: FigmaNode, fileKey: string): CompileResult {
  const warnings: string[] = [];
  const counters = { blocks: 0, overlays: 0, bound: 0 };

  // Root is typically a FRAME (document/canvas). Pages = top-level FRAME children.
  const pageNodes: FigmaNode[] = (rootNode.children || []).filter(
    (c) => c.type === 'FRAME' && c.visible !== false,
  );

  if (pageNodes.length === 0 && rootNode.type === 'FRAME') {
    // The root itself is a single-page frame.
    pageNodes.push(rootNode);
  }

  if (pageNodes.length === 0) {
    warnings.push('No FRAME pages found in the selected Figma node.');
  }

  const pages = pageNodes.map((pn) => {
    const box = pn.absoluteBoundingBox;
    const bg = getSolidFill(pn);
    return {
      id: pn.id,
      name: pn.name || 'Page',
      size: { width: box?.width || A4.width, height: box?.height || A4.height },
      background: bg ? { color: bg } : {},
      blocks: walkPageChildren(pn, fileKey, warnings, counters),
    };
  });

  const tokens = harvestTokens(rootNode);

  return {
    template: {
      version: 1,
      tokens: { colors: tokens.colors, fonts: tokens.fonts, spacing: { gutter: 16 } },
      pages,
      slots: {},
    },
    warnings,
    stats: { pages: pages.length, ...counters },
  };
}
