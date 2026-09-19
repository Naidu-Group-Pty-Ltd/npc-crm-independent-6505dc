/**
 * Colourways — frontend shim.
 *
 * One line onto `supabase/functions/_shared/templateColourways.pure.ts`, the
 * same pattern `src/lib/workflow/*` uses onto the shared workflow engine. The
 * preview and the server-side working-copy bake must agree on what "Oxblood
 * Night" means down to the hex, and the only way to guarantee that is for both
 * to read the same module rather than two copies that drift.
 *
 * That module is Deno-parseable — no `@/` aliases, explicit `.ts` extensions —
 * so it is importable from an edge function unchanged.
 */
export {
  BODY_INK_LIFT,
  COLOURWAYS_BY_FAMILY,
  PANEL_STEP,
  PRINT_LARGE_TYPE_CONTRAST,
  PRINT_SMALL_TYPE_CONTRAST,
  PRIVATE_BANKING_COLOURWAYS,
  SEMANTIC_COLOURS,
  applyColourwayToSchema,
  bestContrast,
  bodyInkFor,
  colourwayColors,
  colourwayFingerprint,
  colourwayTokenOverride,
  colourwaysForFamily,
  contrastRatio,
  defaultColourwayFor,
  findColourway,
  hexToHsl,
  hexToRgb,
  hslToHex,
  relativeLuminance,
  resolveColourway,
  rgbToHex,
  shiftLightness,
  toPrintContrast,
} from '../../../supabase/functions/_shared/templateColourways.pure';

export type {
  ApprovedColourway,
  ColourwayGround,
  Hsl,
  ResolvedColourway,
} from '../../../supabase/functions/_shared/templateColourways.pure';
