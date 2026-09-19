export type LightModeVisualOverlay = 'champagne' | 'ivory';

export interface LightModeModuleVisual {
  image: string;
  alt: string;
  overlay: LightModeVisualOverlay;
  fallbackGradient: 'champagne' | 'ivory' | 'brand-studio';
}

export const lightModeModuleVisuals = {
  overview: {
    image: '/assets/light-mode/overview-luxury-interior.webp',
    alt: 'Luxury residential advisory interior',
    overlay: 'champagne',
    fallbackGradient: 'champagne',
  },
  reports: {
    image: '/assets/light-mode/reports-advisory-workspace.webp',
    alt: 'Property advisory reports workspace',
    overlay: 'ivory',
    fallbackGradient: 'ivory',
  },
  clientCrm: {
    image: '/assets/light-mode/client-advisory-meeting.webp',
    alt: 'Professional client advisory meeting',
    overlay: 'champagne',
    fallbackGradient: 'champagne',
  },
  operations: {
    image: '/assets/light-mode/operations-planning-board.webp',
    alt: 'Operations planning board',
    overlay: 'ivory',
    fallbackGradient: 'ivory',
  },
  administration: {
    image: '/assets/light-mode/admin-data-centre.webp',
    alt: 'Secure system administration workspace',
    overlay: 'champagne',
    fallbackGradient: 'champagne',
  },
  branding: {
    image: '/assets/light-mode/branding-studio.webp',
    alt: 'Premium branding studio workspace',
    overlay: 'champagne',
    fallbackGradient: 'brand-studio',
  },
  'branding-studio': {
    image: '/assets/light-mode/branding-studio.webp',
    alt: 'Premium branding studio workspace',
    overlay: 'champagne',
    fallbackGradient: 'brand-studio',
  },
} as const satisfies Record<string, LightModeModuleVisual>;

export type LightModeModuleVisualKey = keyof typeof lightModeModuleVisuals;
