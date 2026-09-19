/**
 * Category naming and accent lookup.
 *
 * Kept apart from `nodeVisuals.tsx` so that file exports only components —
 * mixing constants with components breaks fast refresh.
 */

import type { NodeCategoryId } from '@/lib/workflow/types';

/** Sets the `--wf-accent` custom property; see src/styles/workflow.css. */
export const accentClass = (category: NodeCategoryId | string) => `wf-accent-${category}`;

export const CATEGORY_LABELS: Record<NodeCategoryId, string> = {
  platform: 'This dashboard',
  logic: 'Logic',
  ai: 'AI & models',
  property_data: 'Property & market data',
  crm_marketing: 'CRM & marketing',
  communications: 'Communications',
  documents: 'Documents',
  compliance: 'Identity & compliance',
  payments: 'Payments & finance',
  analytics: 'Analytics',
  productivity: 'Productivity',
  storage: 'Storage',
  media: 'Media & social',
  automation: 'Automation',
  infrastructure: 'Infrastructure',
};
