import type { ReactNode } from 'react';
import { PageHero } from './PageHero';
import type { LightModeModuleVisualKey } from '@/config/moduleVisuals';

interface ModuleHeroProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  moduleKey?: LightModeModuleVisualKey;
  actions?: ReactNode;
  className?: string;
}

export function ModuleHero({ moduleKey = 'overview', ...props }: ModuleHeroProps) {
  return <PageHero imageVariant={moduleKey} {...props} />;
}

export type { LightModeModuleVisualKey } from '@/config/moduleVisuals';
