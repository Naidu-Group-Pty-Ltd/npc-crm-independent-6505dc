export interface SanitizedFigmaNode {
  type: string;
  characters?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  style?: { fontSize?: number; fontWeight?: number; fontFamily?: string; italic?: boolean };
  fills?: Array<{
    type: string;
    color?: { r: number; g: number; b: number; a?: number };
    opacity?: number;
  }>;
  children?: SanitizedFigmaNode[];
}

/**
 * Project a provider-owned Figma node onto the fields required by grounding.
 * Hidden nodes and provider metadata must never cross the edge-function boundary.
 */
export function sanitizeFigmaFrame(node: unknown): SanitizedFigmaNode | null {
  if (!node || typeof node !== 'object') return null;
  const source = node as Record<string, unknown>;
  if (source.visible === false || typeof source.type !== 'string') return null;

  const sanitized: SanitizedFigmaNode = { type: source.type };
  const box = source.absoluteBoundingBox as Record<string, unknown> | undefined;
  if (box && ['x', 'y', 'width', 'height'].every((key) => typeof box[key] === 'number')) {
    sanitized.absoluteBoundingBox = {
      x: box.x as number,
      y: box.y as number,
      width: box.width as number,
      height: box.height as number,
    };
  }

  if (source.type === 'TEXT' && typeof source.characters === 'string') {
    sanitized.characters = source.characters;
    const style = source.style as Record<string, unknown> | undefined;
    if (style) {
      const allowedStyle = Object.fromEntries(
        ['fontSize', 'fontWeight', 'fontFamily', 'italic']
          .filter((key) => ['number', 'string', 'boolean'].includes(typeof style[key]))
          .map((key) => [key, style[key]]),
      );
      if (Object.keys(allowedStyle).length) sanitized.style = allowedStyle;
    }
  }

  if (Array.isArray(source.fills)) {
    const fills = source.fills.flatMap((fill): SanitizedFigmaNode['fills'] => {
      if (!fill || typeof fill !== 'object') return [];
      const value = fill as Record<string, unknown>;
      if (value.visible === false || (value.type !== 'SOLID' && value.type !== 'IMAGE')) return [];
      const sanitizedFill: NonNullable<SanitizedFigmaNode['fills']>[number] = { type: value.type };
      if (typeof value.opacity === 'number') sanitizedFill.opacity = value.opacity;
      const color = value.color as Record<string, unknown> | undefined;
      if (value.type === 'SOLID' && color && ['r', 'g', 'b'].every((key) => typeof color[key] === 'number')) {
        sanitizedFill.color = {
          r: color.r as number,
          g: color.g as number,
          b: color.b as number,
          ...(typeof color.a === 'number' ? { a: color.a } : {}),
        };
      }
      return [sanitizedFill];
    });
    if (fills.length) sanitized.fills = fills;
  }

  if (Array.isArray(source.children)) {
    const children = source.children
      .map(sanitizeFigmaFrame)
      .filter((child): child is SanitizedFigmaNode => child !== null);
    if (children.length) sanitized.children = children;
  }
  return sanitized;
}
