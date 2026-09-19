import { lightModeModuleVisuals, type LightModeModuleVisualKey } from '@/theme/lightModeVisuals';

export { lightModeModuleVisuals };
export type { LightModeModuleVisualKey };

export function getLightModeModuleVisual(key: LightModeModuleVisualKey) {
  return lightModeModuleVisuals[key];
}
