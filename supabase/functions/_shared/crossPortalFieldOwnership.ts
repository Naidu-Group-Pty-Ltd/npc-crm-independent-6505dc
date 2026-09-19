export type PortalDomain = 'command_centre' | 'client' | 'finance' | 'solicitor';
export interface FieldOwnershipRule { field: string; owning_domain: PortalDomain | 'case'; readable_by: PortalDomain[]; writable_by: PortalDomain[]; projection_targets: PortalDomain[]; conflict_policy: 'owner_wins' | 'reject' | 'derived' }
export const CROSS_PORTAL_FIELD_OWNERSHIP: readonly FieldOwnershipRule[] = [
  { field:'client_identity',owning_domain:'command_centre',readable_by:['command_centre','client','finance','solicitor'],writable_by:['command_centre'],projection_targets:['client','finance','solicitor'],conflict_policy:'owner_wins' },
  { field:'shared_lifecycle_status',owning_domain:'case',readable_by:['command_centre','client','finance','solicitor'],writable_by:['command_centre'],projection_targets:['client','finance','solicitor'],conflict_policy:'derived' },
  { field:'purchase_price',owning_domain:'finance',readable_by:['command_centre','finance','solicitor'],writable_by:['finance','command_centre'],projection_targets:['solicitor'],conflict_policy:'owner_wins' },
  { field:'deposit_amount',owning_domain:'finance',readable_by:['command_centre','finance','solicitor'],writable_by:['finance','command_centre'],projection_targets:['solicitor'],conflict_policy:'owner_wins' },
  { field:'finance_clause_date',owning_domain:'finance',readable_by:['command_centre','finance','solicitor'],writable_by:['finance','command_centre'],projection_targets:['solicitor'],conflict_policy:'owner_wins' },
  { field:'finance_status',owning_domain:'finance',readable_by:['command_centre','client','finance','solicitor'],writable_by:['finance'],projection_targets:['command_centre','client','solicitor'],conflict_policy:'owner_wins' },
  { field:'lender',owning_domain:'finance',readable_by:['command_centre','finance','solicitor'],writable_by:['finance'],projection_targets:['command_centre','solicitor'],conflict_policy:'owner_wins' },
  { field:'finance_contact',owning_domain:'finance',readable_by:['command_centre','finance','solicitor'],writable_by:['finance'],projection_targets:['command_centre','solicitor'],conflict_policy:'owner_wins' },
  { field:'legal_status',owning_domain:'solicitor',readable_by:['command_centre','client','finance','solicitor'],writable_by:['solicitor'],projection_targets:['command_centre','client','finance'],conflict_policy:'owner_wins' },
  { field:'contractual_settlement_date',owning_domain:'solicitor',readable_by:['command_centre','client','finance','solicitor'],writable_by:['solicitor'],projection_targets:['command_centre','client','finance'],conflict_policy:'owner_wins' },
  { field:'shared_summary',owning_domain:'solicitor',readable_by:['command_centre','client','solicitor'],writable_by:['solicitor'],projection_targets:['command_centre','client'],conflict_policy:'owner_wins' },
  { field:'legal_practice_contact',owning_domain:'solicitor',readable_by:['command_centre','client','finance','solicitor'],writable_by:['solicitor'],projection_targets:['command_centre','client','finance'],conflict_policy:'owner_wins' },
  { field:'internal_notes',owning_domain:'solicitor',readable_by:['solicitor'],writable_by:['solicitor'],projection_targets:['solicitor'],conflict_policy:'reject' },
  { field:'npc_internal_notes',owning_domain:'command_centre',readable_by:['command_centre'],writable_by:['command_centre'],projection_targets:['command_centre'],conflict_policy:'reject' },
  { field:'finance_private_notes',owning_domain:'finance',readable_by:['finance'],writable_by:['finance'],projection_targets:['finance'],conflict_policy:'reject' },
] as const;
const byField = new Map(CROSS_PORTAL_FIELD_OWNERSHIP.map(rule => [rule.field,rule]));
export function mayWriteCrossPortalField(field:string,domain:PortalDomain):boolean { const rule=byField.get(field); return !rule || rule.writable_by.includes(domain); }
export function projectionFieldsFor(domain:PortalDomain):string[] { return CROSS_PORTAL_FIELD_OWNERSHIP.filter(rule=>rule.projection_targets.includes(domain)).map(rule=>rule.field); }
