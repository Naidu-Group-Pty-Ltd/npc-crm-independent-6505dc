/**
 * Which columns a request body may write, per table, for the client-data
 * multiplexers.
 *
 * ## The shape of the problem
 *
 * `manage-client-data` and `manage-portal-client-data` are generic CRUD
 * endpoints: the caller names a `table` and hands over a `data` object, and the
 * handler spreads it into `.insert()` / `.update()` / `.upsert()`. The table
 * name is checked against `ALLOWED_TABLES`. The *columns* were not checked
 * against anything.
 *
 * That is item 15 of the twenty-item list in its purest form, and it is worse on
 * a multiplexer than on a single-purpose handler: one unvalidated body reaches
 * 29 tables, so the blast radius is the union of everything any of them holds.
 *
 * ## What is denied, and why
 *
 * Every list below is `information_schema.columns` for that table, read from the
 * live project, minus four groups. The groups matter more than the individual
 * names — a column added to one of these tables later is not writable until
 * somebody adds it here, and the question they should ask is which group it
 * falls into.
 *
 *  1. **Identity and audit** — `id`, `created_at`, `updated_at`. The row's own
 *     bookkeeping.
 *
 *  2. **Actor attribution** — `created_by`, `uploaded_by`, `published_by`,
 *     `generated_by`, `sent_by`, `sent_by_username`, `reviewer_id`. Who did
 *     this. The handlers stamp these from the verified session; leaving them
 *     writable let a caller put somebody else's name on their own work, which is
 *     the same defect `ALERT_WRITABLE` documents for `resolved_by`.
 *
 *  3. **Provenance and sync bookkeeping** — the `source_*` set, the
 *     `sync_origin_*` set, `sync_status`, `last_synced_at`, `last_sync_error`,
 *     `content_hash`, `dedupe_key`, `ghl_sync_status`, `ghl_last_synced_at`.
 *     These are how the GHL sync and the shared-record pipeline decide what has
 *     already been seen. A caller who can set `dedupe_key` or `content_hash` can
 *     make the deduper skip a record or collapse two distinct ones, and
 *     `buildProvenance()` exists precisely so the answer comes from the server.
 *
 *  4. **Server-computed or security-bearing state**, per table — the share-token
 *     columns on `report_qa_messages` (that is the public-link surface: a
 *     writable `share_token_hash` is a writable public link, and a writable
 *     `share_expires_at` un-expires one), the file/note version chains, the GHL
 *     replay markers, `client_scores.last_calculated_at`, and the lead-source
 *     enrichment markers.
 *
 * `client_id` stays writable: the handlers overwrite it from the authorised
 * client after the spread, and the record-ownership check is a separate control
 * (`.eq('client_id', clientId)` on the write itself).
 *
 * ## Regenerating
 *
 * These came from a single `information_schema` query against the live
 * catalogue. If a table gains a column the UI needs to write, add the name —
 * do not widen the deny groups above.
 */

export const CLIENT_DATA_WRITABLE: Record<string, Set<string>> = {
  build_progress_payments: new Set([
    'deal_id', 'stage_number', 'stage_name', 'percentage', 'amount',
    'builder_invoice_received', 'builder_invoice_date',
    'submitted_to_lender', 'submitted_to_lender_date', 'funds_released',
    'funds_released_date', 'paid_to_builder', 'paid_to_builder_date',
    'is_commission_trigger', 'commission_received',
    'commission_received_date', 'commission_amount', 'notes',
    'display_order',
  ]),
  builder_invoices: new Set([
    'deal_id', 'build_payment_id', 'client_name', 'build_stage',
    'invoice_date', 'invoice_amount', 'submitted_to_lender',
    'submitted_date', 'funds_released', 'funds_released_date',
    'paid_to_builder', 'paid_to_builder_date', 'commission_received',
    'commission_amount', 'notes',
  ]),
  client_activities: new Set([
    'client_id', 'activity_type', 'title', 'description', 'metadata',
    'related_record_id', 'related_record_table', 'event_timestamp',
  ]),
  client_additional_contacts: new Set([
    'client_id', 'relationship', 'first_name', 'surname', 'middle_name',
    'email', 'mobile', 'dob', 'gender', 'display_order', 'notes',
    'current_address', 'country', 'living_situation', 'residential_status',
    'same_address_as_primary', 'current_suburb', 'current_state',
    'current_postcode',
  ]),
  client_address_history: new Set([
    'client_id', 'contact_type', 'additional_contact_id', 'address',
    'country', 'living_situation', 'residential_status', 'start_date',
    'end_date', 'is_current', 'months_at_address', 'notes',
    'current_suburb', 'current_state', 'current_postcode',
  ]),
  client_assets: new Set([
    'client_id', 'asset_type', 'vehicle_type', 'make_model',
    'institution_name', 'description', 'value',
  ]),
  client_deals: new Set([
    'client_id', 'property_id', 'deal_type', 'current_stage',
    'current_stage_number', 'risk_status', 'responsible_person',
    'total_contract_price', 'land_price', 'build_price', 'loan_amount',
    'valuation_completed', 'shortfall_required',
    'client_contribution_confirmed', 'lmi_applied',
    'construction_loan_type', 'finance_clause_expiry', 'settlement_date',
    'land_settlement_date', 'expected_build_start', 'estimated_completion',
    'notes', 'existing_loan_amount', 'new_loan_amount', 'equity_released',
    'cash_out_purpose', 'cash_out_verified', 'discharge_authority_date',
    'lodgement_date', 'valuation_date', 'conditional_approval_date',
    'formal_approval_date', 'loan_docs_signed_date', 'commission_estimate',
    'trail_commission', 'clawback_period_months', 'clawback_expiry_date',
    'clawback_risk_active', 'property_address', 'finance_contact_id',
    'purchase_file_id',
    // Consolidated Builder Invoice Log's selected payment. It was missing
    // here, so pickAllowed silently dropped it and the stage advance the
    // invoice toggle performs never persisted across a refresh.
    'builder_invoice_current_payment_id',
    // Per-date critical-date completion stamps ({ column: ISO date }).
    'critical_date_completions',
    // Receipt of the single agent fee an existing-property or refinance deal
    // earns. House-and-land records receipt per build payment; these two are
    // the same pair on the deal itself, for the deal types that have no
    // payment schedule to hang it off.
    'commission_received', 'commission_received_date',
  ]),
  client_employment: new Set([
    'client_id', 'contact_type', 'employer_name', 'employment_type',
    'occupation_role', 'start_date', 'is_current', 'salary_amount',
    'salary_frequency', 'gross_annual_salary', 'bonus', 'commission',
    'overtime_essential', 'overtime_non_essential', 'allowance',
    'other_taxable_income', 'additional_contact_id',
    'workplace_address_line_1', 'workplace_suburb', 'workplace_state',
    'workplace_postcode', 'workplace_country', 'work_arrangement',
  ]),
  client_expenses: new Set([
    'client_id', 'expense_category', 'expense_name', 'monthly_amount',
    'frequency', 'notes', 'is_essential',
  ]),
  client_files: new Set([
    'client_id', 'file_name', 'file_path', 'file_type', 'file_size',
    'category', 'description', 'uploaded_at', 'document_type',
    'is_formara_form', 'report_type', 'storage_bucket',
  ]),
  client_income: new Set([
    'client_id', 'contact_type', 'gross_salary', 'salary_frequency',
    'bonus', 'allowance', 'commission', 'overtime_essential',
    'overtime_non_essential', 'other_taxable_income',
  ]),
  client_income_sources: new Set([
    'client_id', 'contact_type', 'source_category', 'source_type',
    'source_name', 'gross_annual_amount', 'input_frequency', 'input_amount',
    'bonus', 'commission', 'overtime_essential', 'overtime_non_essential',
    'allowance', 'other_taxable_income', 'default_shading_rate',
    'custom_shading_rate', 'display_order', 'is_active', 'notes',
    'employment_id', 'additional_contact_id',
  ]),
  client_liabilities: new Set([
    'client_id', 'liability_type', 'provider_name', 'current_balance',
    'credit_limit', 'interest_rate', 'monthly_repayment', 'repayment_type',
  ]),
  client_notes: new Set([
    'client_id', 'note_type', 'content', 'ghl_note_id', 'visibility',
  ]),
  client_portal_report_requests: new Set([
    'client_id', 'portal_user_id', 'request_type', 'status',
    'property_address', 'client_property_id', 'notes', 'admin_notes',
    'assigned_to', 'fulfilled_report_id',
  ]),
  client_portal_reports: new Set([
    'client_id', 'report_title', 'report_type', 'report_tier',
    'storage_path', 'file_size_bytes', 'source_report_id', 'is_read',
    'read_at', 'notes', 'client_visible_notes',
  ]),
  client_properties: new Set([
    'client_id', 'property_type', 'address', 'value', 'loan_remaining',
    'interest_rate', 'ownership_percentage', 'monthly_interest_repayment',
    'monthly_body_corporate', 'monthly_council_rates',
    'monthly_water_rates', 'monthly_repairs_maintenance',
    'monthly_property_management', 'monthly_landlord_insurance',
    'monthly_building_insurance', 'monthly_rental_income',
    'weekly_rental_income', 'total_monthly_expenditure',
    'net_monthly_cashflow', 'smsf_fund_name', 'smsf_trustee_name',
    'smsf_trustee_type', 'smsf_abn', 'smsf_compliance_status',
    'smsf_auditor_name', 'purchase_price', 'purchase_date', 'sourced_by',
    'deal_closed_at', 'sourced_notes', 'loan_repayment_amount',
    'loan_repayment_frequency', 'lender_name', 'repayment_type',
    'interest_only_period_years',
  ]),
  client_reminders: new Set([
    'client_id', 'title', 'description', 'due_date', 'priority', 'status',
    'reminder_type', 'completed_at', 'assigned_to', 'reminder_scope',
  ]),
  client_scores: new Set([
    'client_id', 'overall_score', 'portfolio_health', 'cash_flow_score',
    'growth_potential', 'risk_level', 'risk_factors', 'calculation_notes',
  ]),
  clients: new Set([
    'ghl_contact_id', 'primary_first_name', 'primary_middle_name',
    'primary_surname', 'primary_mobile', 'primary_email', 'primary_gender',
    'primary_dob', 'secondary_first_name', 'secondary_middle_name',
    'secondary_surname', 'secondary_mobile', 'secondary_email',
    'secondary_gender', 'secondary_dob', 'current_address', 'country',
    'living_situation', 'residential_status', 'marital_status',
    'dependents_count', 'total_portfolio_value', 'total_debt',
    'total_monthly_expenditure', 'total_monthly_income',
    'total_monthly_rental_income', 'net_monthly_cash_flow', 'notes',
    'is_favorite', 'review_frequency', 'last_review_date',
    'next_review_due', 'pipeline_status', 'follow_up_date',
    'borrowing_capacity', 'proposed_rental_income', 'equity_release',
    'pipeline_notes', 'pipeline_updated_at', 'ghl_opportunity_id',
    'current_pipeline_id', 'current_stage_id', 'opportunity_status',
    'is_active', 'last_note_at', 'secondary_current_address',
    'secondary_country', 'secondary_living_situation',
    'secondary_residential_status', 'secondary_same_address_as_primary',
    'deal_status', 'first_deal_closed_at', 'lead_source',
    'lead_source_campaign', 'lead_source_detail', 'finance_contact_id',
    'assigned_team_user_id', 'current_suburb', 'current_state',
    'current_postcode', 'secondary_current_suburb',
    'secondary_current_state', 'secondary_current_postcode',
  ]),
  deal_stages: new Set([
    'deal_id', 'stage_number', 'stage_name', 'stage_category', 'status',
    'client_action', 'internal_action', 'responsible', 'key_date',
    'completed_at', 'percentage_or_amount', 'notes', 'display_order',
    'invoice_received', 'invoice_received_date',
  ]),
  ghl_conversation_messages: new Set([
    'conversation_id', 'ghl_message_id', 'direction', 'channel_type',
    'body', 'content_type', 'attachment_urls', 'sender_name',
    'sender_number', 'recipient_number', 'message_status', 'ghl_date_added',
  ]),
  ghl_conversations: new Set([
    'client_id', 'ghl_conversation_id', 'ghl_contact_id', 'channel_type',
    'last_message_body', 'last_message_date', 'last_message_direction',
    'unread_count', 'conversation_status', 'assigned_to',
  ]),
  lead_source_attributions: new Set([
    'client_id', 'deal_id', 'utm_source', 'utm_medium', 'utm_campaign',
    'utm_content', 'utm_term', 'meta_campaign_id', 'meta_adset_id',
    'meta_ad_id', 'source_type', 'landing_page_url', 'referrer_url',
    'ghl_contact_id', 'attributed_at', 'notes', 'meta_campaign_name',
    'meta_adset_name', 'meta_ad_name', 'meta_ad_creative_url',
    'meta_campaign_objective', 'fbclid', 'gclid', 'ghl_attribution_source',
    'ghl_last_attribution_source', 'conversion_page_url', 'device_type',
    'geo_location',
  ]),
  portal_configuration: new Set([
    'module_dashboard', 'module_profile', 'module_deal_progress',
    'module_properties', 'module_property_insights', 'module_employment',
    'module_documents', 'module_emails', 'module_messages',
    'module_notifications', 'module_booking', 'welcome_title',
    'welcome_message', 'welcome_banner_url', 'default_access_level',
    'booking_calendar_id', 'booking_calendar_name', 'booking_slot_duration',
    'booking_working_hours_start', 'booking_working_hours_end',
    'booking_lead_time_hours', 'booking_max_advance_days',
    'booking_confirmation_email', 'booking_team_notification_email',
    'booking_intro_text', 'portal_accent_color', 'portal_footer_text',
    'booking_calendars',
  ]),
  portfolio_analysis_reports: new Set([
    'client_id', 'client_name', 'health_score', 'overall_health',
    'portfolio_value', 'total_equity', 'net_monthly_cashflow',
    'total_properties', 'average_lvr', 'average_yield', 'report_data',
    'pdf_file_path', 'status',
  ]),
  portfolio_reviews: new Set([
    'client_id', 'review_date', 'status', 'review_frequency',
    'overall_score', 'portfolio_health', 'cash_flow_score',
    'growth_potential', 'risk_level', 'data_completeness_score',
    'data_issues', 'validation_flags', 'executive_summary', 'key_findings',
    'recommendations', 'action_items', 'property_scores', 'scenarios',
    'next_review_due', 'notes', 'include_owner_occupied',
  ]),
  report_qa_conversations: new Set([
    'report_names', 'report_contents', 'title', 'status',
    'structured_report', 'conversation_summary', 'last_summarized_at',
    'summary_message_count', 'agent_mode', 'client_id',
    'branched_from_conversation_id', 'branched_from_message_id',
  ]),
  report_qa_messages: new Set([
    'conversation_id', 'role', 'content', 'attachments', 'model_provider',
    'edited_content', 'citations', 'comparison_mode', 'tool_invocations',
    'pinned', 'prompt_version', 'model_version', 'branched_from_message_id',
    'stream_id',
  ]),
};

/**
 * The allowlist for a table, or `null` when the table has none.
 *
 * `null` rather than an empty set on purpose. An empty set would silently strip
 * every field and write an empty row, which looks like a working call and loses
 * the data; `null` lets the caller decide, and both call sites reject.
 */
export function writableColumnsFor(table: string): Set<string> | null {
  return CLIENT_DATA_WRITABLE[table] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The client portal
// ─────────────────────────────────────────────────────────────────────────────
//
// `manage-portal-client-data` is the same shape of multiplexer, but the caller
// is a CLIENT rather than a staff user, and it had the weaker control of the
// two: a denylist (`PROTECTED_CLIENT_FIELDS`, 32 names) on the `clients` table
// and, for the other ten tables, nothing at all beyond deleting `id` and
// `client_id`.
//
// A denylist inverts the failure mode. `clients` has 69 columns and 32 were
// listed, so the 37 that were not — including `finance_contact_id` and
// `assigned_team_user_id` — were writable by the client whose record it is.
// Reassigning yourself to a different finance agent is not a data-quality
// mistake. And a column added to any of these tables tomorrow is writable from
// the portal the moment it exists, silently, because nobody has to do anything
// for that to happen.
//
// These sets are narrower than `CLIENT_DATA_WRITABLE` above, not equal to it.
// The staff set answers "may this be written through the admin console"; this
// one answers "may the client write it about themselves", and the second
// question has a smaller answer. Everything in the staff-workflow group —
// pipeline state, review scheduling, lead attribution, portfolio aggregates,
// deal status, ownership assignment — is absent here whether or not
// `PROTECTED_CLIENT_FIELDS` happened to name it.

/** `clients`, from the portal's own profile screens. Identity and contact only. */
const PORTAL_CLIENTS_WRITABLE = new Set([
  'primary_first_name', 'primary_middle_name', 'primary_surname',
  'primary_mobile', 'primary_email', 'primary_gender', 'primary_dob',
  'secondary_first_name', 'secondary_middle_name', 'secondary_surname',
  'secondary_mobile', 'secondary_email', 'secondary_gender', 'secondary_dob',
  'current_address', 'country', 'living_situation', 'residential_status',
  'current_suburb', 'current_state', 'current_postcode',
  'secondary_current_address', 'secondary_country', 'secondary_living_situation',
  'secondary_residential_status', 'secondary_same_address_as_primary',
  'secondary_current_suburb', 'secondary_current_state', 'secondary_current_postcode',
  'marital_status', 'dependents_count',
]);

/**
 * The portal's writable columns, per table.
 *
 * The financial tables are the client's own declarations — the point of the
 * portal is that they maintain them — so those sets are close to the staff
 * ones. What differs is attribution: `client_properties.sourced_by` and
 * `deal_closed_at` record which NPC agent sourced a property and when the deal
 * closed. They are commission-bearing, and they were writable from the portal.
 */
export const PORTAL_CLIENT_DATA_WRITABLE: Record<string, Set<string>> = {
  clients: PORTAL_CLIENTS_WRITABLE,

  client_properties: new Set([
    'property_type', 'address', 'value', 'loan_remaining', 'interest_rate',
    'ownership_percentage', 'monthly_interest_repayment', 'monthly_body_corporate',
    'monthly_council_rates', 'monthly_water_rates', 'monthly_repairs_maintenance',
    'monthly_property_management', 'monthly_landlord_insurance',
    'monthly_building_insurance', 'monthly_rental_income', 'weekly_rental_income',
    'total_monthly_expenditure', 'net_monthly_cashflow',
    'smsf_fund_name', 'smsf_trustee_name', 'smsf_trustee_type', 'smsf_abn',
    'smsf_compliance_status', 'smsf_auditor_name',
    'purchase_price', 'purchase_date',
    'loan_repayment_amount', 'loan_repayment_frequency', 'lender_name',
    'repayment_type', 'interest_only_period_years',
  ]),

  client_employment: new Set([
    'contact_type', 'employer_name', 'employment_type', 'occupation_role',
    'start_date', 'is_current', 'salary_amount', 'salary_frequency',
    'gross_annual_salary', 'bonus', 'commission', 'overtime_essential',
    'overtime_non_essential', 'allowance', 'other_taxable_income',
    'additional_contact_id', 'workplace_address_line_1', 'workplace_suburb',
    'workplace_state', 'workplace_postcode', 'workplace_country',
    'work_arrangement',
  ]),

  client_income_sources: new Set([
    'contact_type', 'source_category', 'source_type', 'source_name',
    'gross_annual_amount', 'input_frequency', 'input_amount', 'bonus',
    'commission', 'overtime_essential', 'overtime_non_essential', 'allowance',
    'other_taxable_income', 'display_order', 'is_active', 'notes',
    'employment_id', 'additional_contact_id',
  ]),
  // `default_shading_rate` and `custom_shading_rate` are absent: shading is how
  // the borrowing-capacity engine discounts non-salary income, and a client who
  // can set their own shading rate can set their own borrowing capacity.

  client_expenses: new Set([
    'expense_category', 'expense_name', 'monthly_amount', 'frequency', 'notes',
    'is_essential',
  ]),

  client_assets: new Set([
    'asset_type', 'vehicle_type', 'make_model', 'institution_name',
    'description', 'value',
  ]),

  client_liabilities: new Set([
    'liability_type', 'provider_name', 'current_balance', 'credit_limit',
    'interest_rate', 'monthly_repayment', 'repayment_type',
  ]),

  client_address_history: new Set([
    'contact_type', 'additional_contact_id', 'address', 'country',
    'living_situation', 'residential_status', 'start_date', 'end_date',
    'is_current', 'months_at_address', 'notes', 'current_suburb',
    'current_state', 'current_postcode',
  ]),

  // A portal message is the client's text and its read state. Everything else on
  // this table is routing and permission decided on our side: `is_internal`,
  // `visibility_scope`, `allocation_status`, `finance_allocated`,
  // `allocated_finance_user_id`, `command_owner_user_id`, `permission_status`.
  // `sender_type` is absent too — a client who can set it can post as staff.
  client_portal_messages: new Set(['message', 'is_read', 'read_at', 'thread_id', 'thread_type']),

  // A notification is written TO the client; the only thing they change is
  // whether they have read it.
  client_portal_notifications: new Set(['is_read', 'read_at']),

  // `status`, `assigned_to`, `admin_notes` and `fulfilled_report_id` are the
  // staff side of a request. The client writes what they are asking for.
  client_portal_report_requests: new Set([
    'request_type', 'property_address', 'client_property_id', 'notes',
  ]),
};

/** As `writableColumnsFor`, for the client portal. */
export function portalWritableColumnsFor(table: string): Set<string> | null {
  return PORTAL_CLIENT_DATA_WRITABLE[table] ?? null;
}
