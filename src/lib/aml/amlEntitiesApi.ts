import { invokeAmlFunction } from "./invokeAmlFunction";

export type AmlEntityType = "company" | "trust" | "smsf" | "partnership" | "sole_trader" | "other";
export type AmlControlType = "shareholding" | "trustee" | "beneficiary" | "appointor" | "director" | "partner" | "settlor" | "other";
export type AmlVerificationState = "unverified" | "pending" | "verified" | "failed" | "waived";
export type AmlEntityLinkRole = "subject" | "owner" | "related" | "counterparty";

export interface AmlEntity {
  id: string;
  entity_type: AmlEntityType;
  legal_name: string;
  trading_name: string | null;
  abn: string | null;
  acn: string | null;
  tfn_masked: string | null;
  jurisdiction: string;
  incorporation_date: string | null;
  registered_address: Record<string, any>;
  principal_place_of_business: Record<string, any>;
  status: string;
  is_pep_linked: boolean;
  is_sanctioned: boolean;
  risk_flags: any[];
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AmlBeneficialOwner {
  id: string;
  entity_id: string;
  full_name: string;
  date_of_birth: string | null;
  residential_country: string;
  residential_address: Record<string, any>;
  ownership_percent: number;
  control_type: AmlControlType;
  is_ubo: boolean;
  is_pep: boolean;
  is_sanctioned: boolean;
  verification_state: AmlVerificationState;
  identity_check_id: string | null;
  screening_check_id: string | null;
  notes: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AmlAuthorisedRep {
  id: string;
  entity_id: string;
  full_name: string;
  role_title: string;
  appointment_date: string | null;
  cessation_date: string | null;
  is_signatory: boolean;
  is_director: boolean;
  verification_state: AmlVerificationState;
  identity_check_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AmlEntityCaseLink {
  id: string;
  case_id: string;
  entity_id: string;
  link_role: AmlEntityLinkRole;
  notes: string | null;
  created_at: string;
  entity?: AmlEntity;
  case?: { id: string; case_reference: string; subject_display_name: string; status: string; risk_rating: string | null };
}

export interface AmlOwnershipSummary {
  total_owners: number;
  total_ownership_percent: number;
  ubo_count: number;
  pep_count: number;
  sanctioned_count: number;
  unverified_count: number;
  missing_ownership_percent: number;
}

/** Phase 6 — result of reconciling portal questionnaire answers into canonical records. */
export interface AmlQuestionnaireImportReport {
  entity_id: string | null;
  entity_created: boolean;
  entity_fields_filled: string[];
  conflicts: Array<{ scope: string; field: string; recorded: unknown; submitted: unknown }>;
  owners_created: string[];
  reps_created: string[];
  parties_already_recorded: string[];
  parties_needing_review: Array<{ name: string; role: string; reason: string }>;
  provenance_rows_added: number;
}

export interface AmlProvenanceRow {
  id: string;
  entity_id: string | null;
  party_id: string | null;
  field_key: string;
  value: { v?: unknown } | Record<string, unknown> | null;
  source_type: string;
  source_record_id: string | null;
  submitted_at: string;
  conflict_status: "none" | "conflict" | "superseded" | "resolved";
  verification_status: string;
  is_canonical: boolean;
  resolution_reason: string | null;
}

async function invoke<T = any>(payload: Record<string, any>): Promise<T> {
  return invokeAmlFunction<T>("aml-entities", payload);
}

export const amlEntitiesApi = {
  listEntities: (params: { search?: string; entity_type?: AmlEntityType; limit?: number; offset?: number } = {}) =>
    invoke<{ entities: AmlEntity[]; total: number }>({ op: "list_entities", ...params }),
  getEntity: (entity_id: string) =>
    invoke<{ entity: AmlEntity; owners: AmlBeneficialOwner[]; reps: AmlAuthorisedRep[]; links: AmlEntityCaseLink[] }>({ op: "get_entity", entity_id }),
  upsertEntity: (entity: Partial<AmlEntity>) => invoke<{ entity: AmlEntity }>({ op: "upsert_entity", entity }),
  deleteEntity: (entity_id: string) => invoke<{ ok: true }>({ op: "delete_entity", entity_id }),

  listOwners: (entity_id: string) => invoke<{ owners: AmlBeneficialOwner[] }>({ op: "list_owners", entity_id }),
  upsertOwner: (owner: Partial<AmlBeneficialOwner> & { entity_id: string }) =>
    invoke<{ owner: AmlBeneficialOwner }>({ op: "upsert_owner", owner }),
  deleteOwner: (owner_id: string) => invoke<{ ok: true }>({ op: "delete_owner", owner_id }),

  listReps: (entity_id: string) => invoke<{ reps: AmlAuthorisedRep[] }>({ op: "list_reps", entity_id }),
  upsertRep: (rep: Partial<AmlAuthorisedRep> & { entity_id: string }) =>
    invoke<{ rep: AmlAuthorisedRep }>({ op: "upsert_rep", rep }),
  deleteRep: (rep_id: string) => invoke<{ ok: true }>({ op: "delete_rep", rep_id }),

  listEntitiesForCase: (case_id: string) =>
    invoke<{ links: AmlEntityCaseLink[] }>({ op: "list_entities_for_case", case_id }),
  linkCase: (params: { case_id: string; entity_id: string; link_role?: AmlEntityLinkRole; notes?: string }) =>
    invoke<{ link: AmlEntityCaseLink }>({ op: "link_case", ...params }),
  unlinkCase: (link_id: string) => invoke<{ ok: true }>({ op: "unlink_case", link_id }),

  ownershipSummary: (entity_id: string) =>
    invoke<{ summary: AmlOwnershipSummary }>({ op: "ownership_summary", entity_id }),

  // Phase 6 — questionnaire reconciliation + provenance
  importFromQuestionnaire: (case_id: string) =>
    invoke<{ report: AmlQuestionnaireImportReport }>({ op: "import_from_questionnaire", case_id }),
  listProvenance: (case_id: string) =>
    invoke<{ provenance: AmlProvenanceRow[] }>({ op: "list_provenance", case_id }),
  linkVerification: (params: {
    case_id: string; target: "owner" | "rep"; party_id: string;
    identity_check_id?: string; screening_check_id?: string;
  }) => invoke<{ owner?: AmlBeneficialOwner; rep?: AmlAuthorisedRep }>({ op: "link_verification", ...params }),
};
