export interface TemplateSchemaSummary {
  coordinateSystem: 'pdf-points-top-left-origin';
  page: {
    required: string[];
    background: string[];
  };
  block: {
    freeOverlayBlockType: 'free';
    required: string[];
  };
  overlays: Record<string, string[]>;
  hardRules: string[];
}

/** Compact schema contract for AI reconciliation prompts; the renderer still validates the real schema. */
export function buildTemplateSchemaSummary(): TemplateSchemaSummary {
  return {
    coordinateSystem: 'pdf-points-top-left-origin',
    page: {
      required: ['id', 'name', 'size.width', 'size.height', 'background.imageUrl', 'blocks'],
      background: ['color', 'imageUrl', 'gradient', 'opacity'],
    },
    block: {
      freeOverlayBlockType: 'free',
      required: ['id', 'type', 'props', 'overlays'],
    },
    overlays: {
      text: ['id', 'type', 'x', 'y', 'width', 'height', 'content', 'fontFamily', 'fontSize', 'fontWeight', 'color', 'align', 'lineHeight'],
      image: ['id', 'type', 'x', 'y', 'width', 'height', 'src', 'fit'],
      shape: ['id', 'type', 'x', 'y', 'width', 'height', 'shape', 'fill', 'stroke', 'strokeWidth'],
      table: ['id', 'type', 'x', 'y', 'width', 'height', 'columns', 'rows', 'showHeader'],
      vector: ['id', 'type', 'x', 'y', 'width', 'height', 'viewBox', 'paths'],
    },
    hardRules: [
      'Preserve the rendered reference image as background.imageUrl on every imported page.',
      'Do not output HTML, React, CSS files, or prose in the JSON response.',
      'Create editable overlays only when the raw manifest or vision analysis supports them.',
      'Set confidence on imported overlays; lock overlays below confidence 0.65.',
      'Never remove the deterministic background in hybrid/background-first modes.',
    ],
  };
}
