export type SyncSurface = 'internal_dashboard' | 'finance_portal' | 'client_portal' | 'automation' | 'external_system';

export type SyncActorType = 'internal_user' | 'finance_user' | 'client_user' | 'system';
export type SyncStatus = 'local' | 'synced' | 'duplicate' | 'superseded' | 'conflict';

const SURFACE_PRIORITY: Record<SyncSurface, number> = {
  internal_dashboard: 5,
  finance_portal: 4,
  client_portal: 3,
  automation: 2,
  external_system: 1,
};

export const SYNC_CONFLICT_WINDOW_MS = 10 * 60 * 1000;

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(buffer: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return toHex(hash);
}

export function buildDocumentDedupeKey(input: {
  clientId: string;
  filename: string;
  fileSize: number;
  category?: string | null;
}) {
  const normalizedName = input.filename.trim().toLowerCase().replace(/\s+/g, '-');
  const normalizedCategory = (input.category || 'general').trim().toLowerCase();
  return `${input.clientId}:${normalizedCategory}:${input.fileSize}:${normalizedName}`;
}

export function buildNoteDedupeKey(input: {
  clientId: string;
  noteType?: string | null;
  content: string;
}) {
  const normalizedType = (input.noteType || 'general').trim().toLowerCase();
  const normalizedContent = input.content.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
  return `${input.clientId}:${normalizedType}:${normalizedContent}`;
}

export async function sha256Text(value: string) {
  return sha256Hex(new TextEncoder().encode(value).buffer);
}

export function resolveSyncConflict(input: {
  existing?: {
    id: string;
    source_surface?: SyncSurface | null;
    uploaded_at?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    version_group_id?: string | null;
    version_number?: number | null;
  } | null;
  incomingSurface: SyncSurface;
  incomingTimestamp?: string | null;
}) {
  const existing = input.existing;
  if (!existing) {
    return {
      status: 'synced' as SyncStatus,
      versionGroupId: crypto.randomUUID(),
      versionNumber: 1,
      supersedesEntityId: null,
      conflictReason: null,
      shouldSupersedeExisting: false,
    };
  }

  const existingSurface = (existing.source_surface || 'external_system') as SyncSurface;
  const existingPriority = SURFACE_PRIORITY[existingSurface] || 0;
  const incomingPriority = SURFACE_PRIORITY[input.incomingSurface] || 0;
  const existingTimestamp = new Date(existing.updated_at || existing.uploaded_at || existing.created_at || 0).getTime();
  const incomingTimestamp = new Date(input.incomingTimestamp || Date.now()).getTime();

  const incomingWins = incomingPriority > existingPriority
    || (incomingPriority === existingPriority && incomingTimestamp >= existingTimestamp);

  const winner = incomingWins ? input.incomingSurface : existingSurface;
  const loser = incomingWins ? existingSurface : input.incomingSurface;

  return {
    status: incomingWins ? ('synced' as SyncStatus) : ('conflict' as SyncStatus),
    versionGroupId: existing.version_group_id || crypto.randomUUID(),
    versionNumber: (existing.version_number || 1) + 1,
    supersedesEntityId: incomingWins ? existing.id : null,
    conflictReason: `Conflict resolved in favour of ${winner.replace(/_/g, ' ')} over ${loser.replace(/_/g, ' ')}`,
    shouldSupersedeExisting: incomingWins,
  };
}

export async function createSyncEvent(
  supabase: any,
  input: {
    clientId: string;
    entityId: string;
    entityTable: string;
    entityType: string;
    sourceSurface: SyncSurface;
    sourceActorType: SyncActorType;
    sourceActorName?: string | null;
    sourceReference?: string | null;
    sourceDetails?: Record<string, unknown>;
    syncStatus?: SyncStatus;
    dedupeKey?: string | null;
    contentHash?: string | null;
    propagatedTo?: unknown[];
    versionGroupId?: string | null;
    versionNumber?: number;
    supersedesEntityId?: string | null;
    conflictReason?: string | null;
    conflictGroup?: string | null;
  },
) {
  try {
    await supabase.from('client_sync_events').insert({
      client_id: input.clientId,
      entity_id: input.entityId,
      entity_table: input.entityTable,
      entity_type: input.entityType,
      source_surface: input.sourceSurface,
      source_actor_type: input.sourceActorType,
      source_actor_name: input.sourceActorName ?? null,
      source_reference: input.sourceReference ?? null,
      source_details: input.sourceDetails ?? {},
      sync_status: input.syncStatus ?? 'synced',
      dedupe_key: input.dedupeKey ?? null,
      content_hash: input.contentHash ?? null,
      propagated_to: input.propagatedTo ?? [],
      version_group_id: input.versionGroupId ?? null,
      version_number: input.versionNumber ?? 1,
      supersedes_entity_id: input.supersedesEntityId ?? null,
      conflict_reason: input.conflictReason ?? null,
      conflict_group: input.conflictGroup ?? null,
    });
  } catch (error) {
    console.error('[client-sync] failed to create sync event', error);
  }
}