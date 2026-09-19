export type SourceSurface = 'internal_dashboard' | 'finance_portal' | 'client_portal' | 'automation' | 'external_system';
export type SourceActorType = 'internal_user' | 'finance_user' | 'client_user' | 'system';

export interface ProvenanceInput {
  sourceSurface: SourceSurface;
  sourceActorType: SourceActorType;
  sourceActorName?: string | null;
  sourceReference?: string | null;
  sourceDetails?: Record<string, unknown> | null;
}

export interface ClientActivityLogInput {
  clientId: string;
  activityType: string;
  title: string;
  description?: string | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown> | null;
  provenance: ProvenanceInput;
}

export function buildProvenance(input: ProvenanceInput) {
  return {
    source_surface: input.sourceSurface,
    source_actor_type: input.sourceActorType,
    source_actor_name: input.sourceActorName ?? null,
    source_reference: input.sourceReference ?? null,
    source_details: input.sourceDetails ?? {},
  };
}

export function mergeSourceDetails(
  existing: unknown,
  incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {};

  return {
    ...base,
    ...(incoming ?? {}),
  };
}

export async function logClientActivity(supabase: any, input: ClientActivityLogInput) {
  const { clientId, activityType, title, description, createdBy, metadata, provenance } = input;

  return await supabase.from('client_activities').insert({
    client_id: clientId,
    activity_type: activityType,
    title,
    description: description ?? null,
    created_by: createdBy ?? null,
    metadata: metadata ?? {},
    ...buildProvenance(provenance),
  });
}