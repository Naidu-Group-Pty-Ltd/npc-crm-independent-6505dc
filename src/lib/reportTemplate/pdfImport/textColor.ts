/**
 * Pure text-colour recovery for PDF reconstruction (R1 remainder).
 *
 * `getTextContent()` never exposes glyph colour — colour lives in the content
 * stream's graphics state. This module replays the colour-relevant slice of the
 * operator stream (CTM + fill colour through save/restore, plus the text matrix
 * via BT/Tm/Td/T*) and records a colour *sample* at every show-text op, tagged
 * with the glyph origin in the SAME bottom-left PDF user space that
 * `getTextContent` item transforms use. `nearestColor` then attributes a colour
 * to each extracted text span by position.
 *
 * Pure + unit-tested. The impure Docling-era PDF operator-list → command translation
 * lives in `extractPdfViaDocling`.
 */
import { matMul, applyMatrix, type Matrix } from './vectorExtract';

export type TextColorCommand =
  | { op: 'save' }
  | { op: 'restore' }
  | { op: 'transform'; m: Matrix }        // cm — modify CTM
  | { op: 'setFillColor'; color: string } // rg / g / k (fill)
  | { op: 'beginText' }                   // BT — reset the text matrix
  | { op: 'setTextMatrix'; m: Matrix }    // Tm
  | { op: 'moveText'; tx: number; ty: number } // Td
  | { op: 'setLeading'; leading: number } // TL
  | { op: 'nextLine' }                    // T* — moves down by the leading
  | { op: 'showText' };                   // Tj / TJ — emit a sample here

export interface ColorSample { x: number; y: number; color: string; }

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

interface CState { ctm: Matrix; fill: string; }

/** Replay the colour/text-matrix command stream into positioned colour samples. */
export function collectColorSamples(commands: TextColorCommand[], initialCtm: Matrix = IDENTITY): ColorSample[] {
  let state: CState = { ctm: initialCtm, fill: '#000000' };
  const stack: CState[] = [];
  let textMatrix: Matrix = IDENTITY;
  let lineMatrix: Matrix = IDENTITY;
  let leading = 0;
  const samples: ColorSample[] = [];

  for (const c of commands) {
    switch (c.op) {
      case 'save': stack.push({ ...state, ctm: [...state.ctm] as Matrix }); break;
      case 'restore': if (stack.length) state = stack.pop()!; break;
      case 'transform': state = { ...state, ctm: matMul(state.ctm, c.m) }; break;
      case 'setFillColor': state = { ...state, fill: c.color }; break;
      case 'beginText': textMatrix = IDENTITY; lineMatrix = IDENTITY; break;
      case 'setTextMatrix': textMatrix = c.m; lineMatrix = c.m; break;
      case 'moveText':
        lineMatrix = matMul(lineMatrix, [1, 0, 0, 1, c.tx, c.ty]);
        textMatrix = lineMatrix;
        break;
      case 'setLeading': leading = c.leading; break;
      case 'nextLine':
        lineMatrix = matMul(lineMatrix, [1, 0, 0, 1, 0, -leading]);
        textMatrix = lineMatrix;
        break;
      case 'showText': {
        const origin = applyMatrix(matMul(state.ctm, textMatrix), 0, 0);
        samples.push({ x: origin[0], y: origin[1], color: state.fill });
        break;
      }
    }
  }
  return samples;
}

/**
 * Attribute a colour to a span at (x,y) by nearest sample. Baseline (y) is
 * weighted far above x so same-line samples win; samples to the *right* of the
 * span (later on the line) are penalised since a show-op starts at-or-before its
 * glyphs. Returns `undefined` only when there are no samples at all.
 */
export function nearestColor(samples: ColorSample[], x: number, y: number): string | undefined {
  let best: ColorSample | undefined;
  let bestScore = Infinity;
  for (const s of samples) {
    const dy = Math.abs(s.y - y);
    const dx = s.x <= x + 1 ? (x - s.x) : (s.x - x) * 4;
    const score = dy * 8 + Math.abs(dx);
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best?.color;
}
