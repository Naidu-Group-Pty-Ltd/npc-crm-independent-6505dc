/**
 * Figma layer/frame hierarchy → DOM box tree (plan §7d).
 *
 * Instead of flattening a Figma frame to a single PNG, this converts the Figma
 * REST node tree (TEXT/RECTANGLE/IMAGE nodes with `absoluteBoundingBox` + style)
 * into the same `DomBoxTree` that `render-source` emits — so a Figma import grounds
 * on the *exact* text, positions, sizes, and colours from the design, then reuses
 * the existing code-grounding + `screenshot_to_block` reconstruction unchanged.
 *
 * Pure + unit-tested; the impure Figma REST fetch lives in the import edge function.
 */
import type { DomBoxTree, DomTextBox, DomImageBox } from './codeGrounding';

export interface FigmaColor { r: number; g: number; b: number; a?: number }
export interface FigmaFill { type: string; color?: FigmaColor; opacity?: number; visible?: boolean }
export interface FigmaNode {
  type: string;
  name?: string;
  characters?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  style?: { fontSize?: number; fontWeight?: number; fontFamily?: string; italic?: boolean };
  fills?: FigmaFill[];
  visible?: boolean;
  children?: FigmaNode[];
}

function figmaSolidColor(fills?: FigmaFill[]): string | undefined {
  const solid = fills?.find((f) => f.type === 'SOLID' && f.color && f.visible !== false);
  if (!solid?.color) return undefined;
  const { r, g, b } = solid.color;
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

function hasImageFill(fills?: FigmaFill[]): boolean {
  return !!fills?.some((f) => f.type === 'IMAGE');
}

/**
 * Convert a Figma frame/page node into a DomBoxTree. Coordinates are made
 * relative to the frame origin so they match a top-left page like the renderer.
 */
export function figmaNodesToBoxTree(
  frame: FigmaNode,
  origin?: { x: number; y: number; width: number; height: number },
): DomBoxTree {
  const box = origin ?? frame.absoluteBoundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  const textBoxes: DomTextBox[] = [];
  const imageBoxes: DomImageBox[] = [];

  const walk = (n: FigmaNode) => {
    if (n.visible === false) return;
    const bb = n.absoluteBoundingBox;
    if (n.type === 'TEXT' && bb && n.characters && n.characters.trim()) {
      textBoxes.push({
        text: n.characters.replace(/\s+/g, ' ').trim(),
        x: bb.x - box.x,
        y: bb.y - box.y,
        width: bb.width,
        height: bb.height,
        fontSizePx: n.style?.fontSize || bb.height,
        fontWeight: n.style?.fontWeight,
        fontFamily: n.style?.fontFamily,
        color: figmaSolidColor(n.fills),
        italic: n.style?.italic || undefined,
      });
    } else if ((n.type === 'RECTANGLE' || n.type === 'IMAGE' || n.type === 'FRAME') && bb && hasImageFill(n.fills)) {
      imageBoxes.push({ src: n.name || 'image', x: bb.x - box.x, y: bb.y - box.y, width: bb.width, height: bb.height });
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(frame);

  return {
    pageWidthPx: box.width || 0,
    pageHeightPx: box.height || 0,
    textBoxes,
    imageBoxes,
    background: figmaSolidColor(frame.fills),
  };
}
