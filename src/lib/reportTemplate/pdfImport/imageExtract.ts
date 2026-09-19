/**
 * Pure image-placement geometry for PDF reconstruction (R4).
 *
 * A PDF image XObject is painted by mapping the unit square [0,1]×[0,1] through
 * the CTM in effect at the `Do` operator. Given that CTM and the page viewport
 * transform, this returns the axis-aligned device-space rect (top-left origin)
 * the decoded bitmap should occupy as an `image` overlay.
 *
 * Axis-aligned placement (rotation 0) is intentional: it is exact for the
 * common scale+translate image matrix and a safe approximation for the rare
 * rotated/skewed image (the bitmap is rendered upright into its bounding box).
 *
 * Pure + unit-tested. The impure Docling-era PDF object resolution / canvas decode lives
 * in `extractPdfViaDocling`.
 */
import { matMul, applyMatrix, type Matrix } from './vectorExtract';

export interface ImagePlacement { x: number; y: number; width: number; height: number; rotation: number; }

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Map an image XObject's CTM (+ page viewport transform) to a device rect. */
export function imageRectFromCtm(imageCtm: Matrix, viewportCtm: Matrix): ImagePlacement {
  const m = matMul(viewportCtm, imageCtm);
  const corners = [
    applyMatrix(m, 0, 0),
    applyMatrix(m, 1, 0),
    applyMatrix(m, 1, 1),
    applyMatrix(m, 0, 1),
  ];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return {
    x: round2(minX),
    y: round2(minY),
    width: round2(maxX - minX),
    height: round2(maxY - minY),
    rotation: 0,
  };
}
