export type AssumptionConfidenceTag =
  | 'Verified'
  | 'Manual Estimate'
  | 'Client Profile Source'
  | 'AI Estimate'
  | 'Unknown'
  | 'Overridden'
  | 'Specialist Review Required'
  | 'Calculated';

export interface AssumptionProvenance {
  fieldKey: string;
  label: string;
  confidenceTag: AssumptionConfidenceTag;
  sourceBasis?: string[];
  requiredDocuments?: string[];
  verificationRequired?: boolean;
  notes?: string;
}

export const CONFIDENCE_BADGE_CLASS: Record<AssumptionConfidenceTag, string> = {
  Verified: 'bg-success/15 text-success border-success/40',
  'Manual Estimate': 'bg-warning/15 text-warning border-warning/40',
  'Client Profile Source': 'bg-warning/15 text-warning border-warning/40',
  'AI Estimate': 'bg-info/15 text-info border-info/40',
  Unknown: 'bg-muted text-muted-foreground border-border',
  Overridden: 'bg-chart-5/15 text-chart-5 border-chart-5/40',
  'Specialist Review Required': 'bg-destructive/15 text-destructive border-destructive/40',
  Calculated: 'bg-primary/15 text-primary border-primary/40',
};

export function deriveCalculatedConfidence(tags: AssumptionConfidenceTag[]): AssumptionConfidenceTag {
  if (tags.includes('Specialist Review Required')) return 'Specialist Review Required';
  if (tags.includes('Unknown')) return 'Unknown';
  if (tags.includes('Overridden')) return 'Overridden';
  if (tags.includes('AI Estimate')) return 'AI Estimate';
  if (tags.includes('Client Profile Source')) return 'Client Profile Source';
  if (tags.includes('Manual Estimate')) return 'Manual Estimate';
  if (tags.length && tags.every(t => t === 'Verified')) return 'Verified';
  return 'Calculated';
}

export function confidenceLabel(tag: AssumptionConfidenceTag): string {
  return tag === 'Calculated' ? 'Calculated from verified + estimated inputs' : tag;
}
