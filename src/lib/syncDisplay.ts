export function getSurfaceLabel(surface?: string | null) {
  switch (surface) {
    case 'internal_dashboard':
      return 'Internal';
    case 'finance_portal':
      return 'Finance portal';
    case 'client_portal':
      return 'Client portal';
    case 'automation':
      return 'Automation';
    case 'external_system':
      return 'External';
    default:
      return 'Unknown source';
  }
}

export function getSyncStatusLabel(status?: string | null) {
  switch (status) {
    case 'synced':
      return 'Synced';
    case 'duplicate':
      return 'Duplicate';
    case 'conflict':
      return 'Conflict';
    case 'superseded':
      return 'Superseded';
    case 'local':
      return 'Local only';
    default:
      return 'Unknown';
  }
}

export function getConflictReason(record: Record<string, any> | null | undefined) {
  if (!record) return null;
  return record.last_sync_error
    || record.conflict_reason
    || record.metadata?.conflict_reason
    || record.metadata?.source_details?.sync_conflict_reason
    || record.source_details?.sync_conflict_reason
    || null;
}

export function getActorLabel(record: Record<string, any> | null | undefined) {
  if (!record) return null;
  return record.source_actor_name
    || record.metadata?.source_actor_name
    || record.source_details?.actor_name
    || null;
}

export function getVersionNumber(record: Record<string, any> | null | undefined) {
  if (!record) return null;
  return record.version_number
    || record.metadata?.version_number
    || record.source_details?.version_number
    || null;
}

export function getVersionGroupId(record: Record<string, any> | null | undefined) {
  if (!record) return null;
  return record.version_group_id
    || record.metadata?.version_group_id
    || record.source_details?.version_group_id
    || null;
}

export function getSupersedesEntityId(record: Record<string, any> | null | undefined) {
  if (!record) return null;
  return record.supersedes_entity_id
    || record.metadata?.supersedes_entity_id
    || record.source_details?.supersedes_entity_id
    || null;
}

export function getSupersededByEntityId(record: Record<string, any> | null | undefined) {
  if (!record) return null;
  return record.superseded_by_entity_id
    || record.metadata?.superseded_by_entity_id
    || record.source_details?.superseded_by_entity_id
    || null;
}

export function getSupersededByVersionNumber(record: Record<string, any> | null | undefined) {
  if (!record) return null;
  return record.superseded_by_version_number
    || record.metadata?.superseded_by_version_number
    || record.source_details?.superseded_by_version_number
    || null;
}