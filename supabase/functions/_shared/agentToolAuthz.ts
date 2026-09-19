import { actorIsSuperadmin, requireModulePermission } from './authz.ts';

// WP-05A base type + WP-05B/C forward-compatible fields (all optional so the
// existing 217 policy rows below remain valid). WP-05B will add per-tool
// resourceType/resolveResource + requiresStepUp; WP-05C will add
// allowedInternalCallers + maxBatchSize on the bulk_* tools.
export type ToolSecurityPolicy = {
  moduleKey: string | null;
  permission: 'can_view' | 'can_edit' | 'can_delete';
  allowedActorTypes: Array<'human' | 'scheduled' | 'internal'>;
  requiresConfirmation?: boolean;
  // WP-05B — resource-scoped authorization
  resourceType?: 'client' | 'deal' | 'appointment' | 'reminder' | 'game_plan' | 'note' | 'file' | 'playbook' | 'agreement' | 'checklist' | 'outlook_event' | 'scheduled_task' | 'chart' | 'report' | 'none';
  resolveResource?: (args: Record<string, unknown>) => { resourceType: string; resourceId: string } | null;
  requiresStepUp?: boolean;
  // WP-05C — internal-caller allowlist + bulk-tool ceilings
  allowedInternalCallers?: readonly string[];
  maxBatchSize?: number;
  /** Organization-wide/admin data must never be exposed to ordinary staff. */
  requiresSuperadmin?: boolean;
};

/**
 * The legacy inventory was initially classified under `ai_dashboard`. These
 * overrides are the application permission model, not a UI label: a tool is
 * authorized against the module that owns the underlying business data.
 */
const REAL_MODULE_OVERRIDES: Record<string, Pick<ToolSecurityPolicy, 'moduleKey' | 'permission' | 'requiresSuperadmin'>> = {
  search_clients: { moduleKey: 'client_management', permission: 'can_view', requiresSuperadmin: true },
  get_client_details: { moduleKey: 'client_management', permission: 'can_view' },
  get_client_additional_contacts: { moduleKey: 'client_management', permission: 'can_view' },
  get_client_activities: { moduleKey: 'client_management', permission: 'can_view' },
  get_client_deals: { moduleKey: 'client_management', permission: 'can_view' },
  get_income_sources: { moduleKey: 'client_management', permission: 'can_view' },
  get_client_expenses: { moduleKey: 'client_management', permission: 'can_view' },
  get_client_liabilities: { moduleKey: 'client_management', permission: 'can_view' },
  get_client_assets: { moduleKey: 'client_management', permission: 'can_view' },
  get_client_properties: { moduleKey: 'client_management', permission: 'can_view' },
  get_employment_details: { moduleKey: 'client_management', permission: 'can_view' },
  update_client_field: { moduleKey: 'client_management', permission: 'can_edit' },
  create_client: { moduleKey: 'client_management', permission: 'can_edit' },
  delete_client: { moduleKey: 'client_management', permission: 'can_delete' },
  bulk_update_clients: { moduleKey: 'client_management', permission: 'can_edit' },
  get_clients_by_pipeline_status: { moduleKey: 'client_management', permission: 'can_view', requiresSuperadmin: true },
  get_clients_needing_follow_up: { moduleKey: 'client_management', permission: 'can_view', requiresSuperadmin: true },
  // These aggregate organization-wide client/deal records and accept no
  // resource identifier that the ownership gate can verify.
  get_proactive_insights: { moduleKey: 'agent', permission: 'can_view', requiresSuperadmin: true },
  get_top_clients: { moduleKey: 'client_management', permission: 'can_view', requiresSuperadmin: true },
  get_commission_actuals: { moduleKey: 'cash_flow', permission: 'can_view' },
  get_commission_forecast: { moduleKey: 'cash_flow', permission: 'can_view' },
  get_pipeline_overview: { moduleKey: 'cash_flow', permission: 'can_view', requiresSuperadmin: true },
  export_pipeline_data: { moduleKey: 'cash_flow', permission: 'can_view', requiresSuperadmin: true },
  send_email: { moduleKey: 'email_copilot', permission: 'can_edit' },
  get_client_emails: { moduleKey: 'email_copilot', permission: 'can_view' },
  search_emails: { moduleKey: 'email_copilot', permission: 'can_view' },
  get_email_thread: { moduleKey: 'email_copilot', permission: 'can_view' },
  send_agreement_docusign: { moduleKey: 'agreements', permission: 'can_edit' },
  generate_agreement: { moduleKey: 'agreements', permission: 'can_edit' },
  get_agreement_details: { moduleKey: 'agreements', permission: 'can_view' },
  get_client_agreements: { moduleKey: 'agreements', permission: 'can_view' },
  get_user_list: { moduleKey: 'user_management', permission: 'can_view', requiresSuperadmin: true },
  get_user_permissions: { moduleKey: 'user_management', permission: 'can_view', requiresSuperadmin: true },
  get_audit_trail: { moduleKey: 'user_management', permission: 'can_view', requiresSuperadmin: true },
  get_error_logs: { moduleKey: 'user_management', permission: 'can_view', requiresSuperadmin: true },
  get_error_summary: { moduleKey: 'user_management', permission: 'can_view', requiresSuperadmin: true },
  // The service-role executor returns unscoped, sensitive tracking records.
  // Legacy activity_logs module grants must not authorize this system-wide read.
  get_recent_activity: { moduleKey: 'activity_logs', permission: 'can_view', requiresSuperadmin: true },
};
export const TOOL_SECURITY_POLICIES:Record<string,ToolSecurityPolicy>={
  'add_additional_contact':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'add_game_plan_action':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'add_game_plan_kpi':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'add_game_plan_milestone':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'add_game_plan_note':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'add_game_plan_phase':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  // WP-05C — bulk tools carry an explicit batch ceiling and a service-role
  // caller allowlist. agent-task-runner is the only internal caller today; add
  // future runners here by name (matches ctx.internalCaller passed by the
  // execute-tool handler in ai-dashboard-agent/index.ts).
  'bulk_create_reminders':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human','internal'],maxBatchSize:100,allowedInternalCallers:['agent-task-runner']},
  'bulk_set_follow_up_dates':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human','internal'],maxBatchSize:100,allowedInternalCallers:['agent-task-runner']},
  'bulk_update_clients':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human','internal'],maxBatchSize:50,allowedInternalCallers:['agent-task-runner']},
  'calculate_equity_position':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'calculate_lmi':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'calculate_loan_repayment':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'calculate_rental_yield':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'calculate_stamp_duty':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'cancel_appointment':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'compare_clients':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'compare_lender_rates':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'complete_deal_stage':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'create_appointment':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'create_checklist_instance':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'create_checklist_template':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'create_client':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'create_client_note':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'create_deal':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'create_follow_up_block':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'create_game_plan':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'create_outlook_event':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'create_outlook_prep_block':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'create_playbook':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'create_reminder':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'create_scheduled_task':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'delete_checklist_instance':{moduleKey:'ai_dashboard',permission:'can_delete',allowedActorTypes:['human'],requiresConfirmation:true},
  'delete_client':{moduleKey:'ai_dashboard',permission:'can_delete',allowedActorTypes:['human'],requiresConfirmation:true},
  'delete_client_file':{moduleKey:'ai_dashboard',permission:'can_delete',allowedActorTypes:['human'],requiresConfirmation:true},
  'delete_client_note':{moduleKey:'ai_dashboard',permission:'can_delete',allowedActorTypes:['human'],requiresConfirmation:true},
  'delete_deal':{moduleKey:'ai_dashboard',permission:'can_delete',allowedActorTypes:['human'],requiresConfirmation:true},
  'delete_game_plan':{moduleKey:'ai_dashboard',permission:'can_delete',allowedActorTypes:['human'],requiresConfirmation:true},
  'delete_game_plan_phase':{moduleKey:'ai_dashboard',permission:'can_delete',allowedActorTypes:['human'],requiresConfirmation:true},
  'delete_outlook_event':{moduleKey:'ai_dashboard',permission:'can_delete',allowedActorTypes:['human'],requiresConfirmation:true},
  'delete_playbook':{moduleKey:'ai_dashboard',permission:'can_delete',allowedActorTypes:['human'],requiresConfirmation:true},
  'delete_reminder':{moduleKey:'ai_dashboard',permission:'can_delete',allowedActorTypes:['human'],requiresConfirmation:true},
  'delete_scheduled_task':{moduleKey:'ai_dashboard',permission:'can_delete',allowedActorTypes:['human'],requiresConfirmation:true},
  'draft_follow_up':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'export_client_portfolio':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'export_pipeline_data':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'find_best_rates':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'generate_agreement':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'generate_chart_data':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'generate_client_summary_report':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'get_active_checklists':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_agreement_details':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_agreement_templates':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_agreements_overview':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_all_reminders':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_api_health':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_api_usage_stats':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_appointment_notifications':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_appointments_for_client':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_attribution_summary':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_audit_trail':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_auto_report_log':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_auto_report_switches':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_borrowing_capacity':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_borrowing_capacity_history':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_branding_profiles':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_build_progress':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_builder_invoices':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_bulk_generation_status':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_cache_statistics':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_calendars':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_call_alerts':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_call_analytics':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_call_details':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_campaign_performance':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_cash_flow_analysis':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_chart_analysis':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_checklist_items':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_checklist_templates':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_clawback_monitor':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_activities':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_additional_contacts':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_agreements':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_assets':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_deals':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_details':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_emails':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_engagement_score':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_expenses':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_files':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_lead_source':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_liabilities':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_notes':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_portal_status':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_properties':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_reminders':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_client_score':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_clients_by_pipeline_status':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_clients_needing_follow_up':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_cloudflare_status':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_commission_actuals':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_commission_forecast':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_conversation_collaborators':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_conversion_funnel':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_dashboard_summary':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_data_sources':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_deal_health_score':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_deal_timeline':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_deals_by_risk':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_deals_by_stage':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_depreciation_comps':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_depreciation_summary':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_document_readiness':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_email_stats':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_email_thread':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_employment_details':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_error_logs':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_error_summary':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_flagged_calls':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_free_slots':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_game_plan_details':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_game_plans':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_import_history':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_income_sources':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_integration_status':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_investment_reports':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_lead_attributions':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_lending_rates':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_listing_details':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_listings_summary':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_marketing_funnel':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_marketing_reports':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_monitoring_dashboard':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_notification_summary':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_outlook_events':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_overdue_reminders':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_performance_metrics':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_pipeline_overview':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_pipeline_trends':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_pipeline_velocity':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_playbooks':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_portal_overview':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_portal_users':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_portfolio_review_details':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_portfolio_reviews':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_proactive_insights':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_qa_queue':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_qa_stats':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_recent_activity':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_recent_calls':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_recent_listings':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_report_details':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_report_qa_details':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_report_templates':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_revenue_forecast':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_saved_charts':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_scheduled_tasks':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_settlement_countdown':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_shared_conversations':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_stale_deals':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_team_members':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_team_outlook_availability':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_todays_schedule':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_top_clients':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_unlinked_emails':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_upcoming_calendar':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_upcoming_milestones':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_user_list':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_user_permissions':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_user_preferences':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'get_weekly_digest':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'link_email_to_client':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'log_client_activity':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'recall_memories':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'remove_additional_contact':{moduleKey:'ai_dashboard',permission:'can_delete',allowedActorTypes:['human'],requiresConfirmation:true},
  'reschedule_appointment':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'revoke_conversation_share':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'revoke_portal_access':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'run_playbook':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'run_system_health_check':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'save_memory':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'save_semantic_memory':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'search_agreements':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'search_calendar_events':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'search_calls':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'search_charts':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'search_clients':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'search_emails':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'search_property_listings':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'search_reports_by_address':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'search_semantic_memory':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'search_uploaded_files':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'send_agreement_docusign':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'send_email':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'send_portal_invite':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'set_follow_up_date':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'set_user_preference':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'share_conversation':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'smart_search':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
  'toggle_auto_report_switch':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'toggle_checklist_item':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'toggle_game_plan_action':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'toggle_scheduled_task':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'trigger_investment_report':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'undo_action':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'update_additional_contact':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'update_build_payment':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'update_client_field':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'update_client_note':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'update_deal_field':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'update_deal_risk_status':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'update_deal_stage':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'update_game_plan':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'update_game_plan_kpi':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'update_game_plan_milestone':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'update_game_plan_phase':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'update_reminder':{moduleKey:'ai_dashboard',permission:'can_edit',allowedActorTypes:['human']},
  'what_if_analysis':{moduleKey:'ai_dashboard',permission:'can_view',allowedActorTypes:['human']},
};
export function requireToolPolicy(name:string, actorType:'human'|'scheduled'|'internal'){const policy=TOOL_SECURITY_POLICIES[name];if(!policy||!policy.allowedActorTypes.includes(actorType))throw new Error('Tool policy denied');return policy;}

// ============================================================================
// WP-05B — Resource-scoped authorization + step-up enforcement
// ----------------------------------------------------------------------------
// Purpose: enforce policies at the executor boundary. Prior to WP-05B the
// TOOL_SECURITY_POLICIES table was declared but never consulted at runtime,
// so a compromised prompt path could dispatch any tool as long as the calling
// function was reached. This module adds three fail-closed gates:
//   1. Actor-type gate (same rule as requireToolPolicy)
//   2. Resource-ownership gate: for every tool carrying a client_id (or a
//      *_id that resolves through client_id), the acting user must own or be
//      assigned to the parent client row OR be a superadmin. This blocks
//      cross-tenant IDOR through the agent tool surface, including reads.
//   3. Step-up gate: destructive/bulk tools require an explicit step-up
//      signal from the caller (satisfied today by the pending-message
//      confirmation flow; forward-compatible with a real TOTP/WebAuthn
//      step-up in a later WP).
// The gate is a single call authorizeAgentTool(...) invoked at the top of
// executeTool in ai-dashboard-agent.
// ============================================================================

// Default resource resolver — derives {resourceType, resourceId} from
// convention-based arg keys. Keeps the 217-row policy table compact.
const DEFAULT_ARG_TO_RESOURCE: Record<string, { table: string; ownerColumn: string; parentClientColumn?: string }> = {
  client_id:            { table: 'clients',                ownerColumn: 'created_by' },
  // Bulk client tools carry a collection rather than a singular client_id.
  // Keep this alias in the same ownership map so each ID is verified before a
  // confirmed bulk action reaches its service-role executor.
  client_ids:           { table: 'clients',                ownerColumn: 'created_by' },
  deal_id:              { table: 'client_deals',           ownerColumn: 'created_by', parentClientColumn: 'client_id' },
  reminder_id:          { table: 'client_reminders',       ownerColumn: 'created_by', parentClientColumn: 'client_id' },
  note_id:              { table: 'client_notes',           ownerColumn: 'created_by', parentClientColumn: 'client_id' },
  file_id:              { table: 'client_files',           ownerColumn: 'created_by', parentClientColumn: 'client_id' },
  activity_id:          { table: 'client_activities',      ownerColumn: 'created_by', parentClientColumn: 'client_id' },
  playbook_id:          { table: 'agent_playbooks',        ownerColumn: 'user_id' },
  scheduled_task_id:    { table: 'agent_scheduled_tasks',  ownerColumn: 'user_id' },
  checklist_instance_id:{ table: 'checklist_instances',    ownerColumn: 'created_by', parentClientColumn: 'client_id' },
  game_plan_id:         { table: 'game_plans',             ownerColumn: 'created_by' },
  agreement_id:         { table: 'agency_agreements',      ownerColumn: 'created_by', parentClientColumn: 'client_id' },
  chart_id:             { table: 'charts',                 ownerColumn: 'user_id' },
  report_id:            { table: 'generated_reports',      ownerColumn: 'user_id' },
  // P1.4: previously-unresolved identifiers now under central ownership.
  memory_id:            { table: 'agent_semantic_memories', ownerColumn: 'user_id' },
};

// Multi-hop resource resolvers for identifiers whose ownership is reached by
// walking a foreign-key chain the flat map above cannot express. Each returns
// true only when `userId` owns the resource. Any missing row or error fails
// closed (returns false). P1.4.
const CUSTOM_OWNERSHIP_RESOLVERS: Record<string, (sb: any, userId: string, id: string) => Promise<boolean>> = {
  // agent_conversations: owner OR an active share (mirrors userCanAccessConversation
  // so shared-conversation tool access is not broken by ownership gating).
  conversation_id: async (sb, userId, id) => {
    const { data: conv } = await sb.from('agent_conversations').select('user_id').eq('id', id).maybeSingle();
    if (conv && conv.user_id === userId) return true;
    const { data: share } = await sb.from('agent_conversation_shares')
      .select('id').eq('conversation_id', id).eq('shared_with', userId).eq('is_active', true).maybeSingle();
    return !!share;
  },
  // game_plan_phases.plan_id -> game_plans.created_by
  phase_id: async (sb, userId, id) => ownsGamePlanPhase(sb, userId, id),
  // game_plan_milestones.phase_id -> phase -> plan -> created_by
  milestone_id: async (sb, userId, id) => {
    const { data } = await sb.from('game_plan_milestones').select('phase_id').eq('id', id).maybeSingle();
    return data?.phase_id ? ownsGamePlanPhase(sb, userId, data.phase_id) : false;
  },
  // game_plan_kpis.phase_id -> phase -> plan -> created_by
  kpi_id: async (sb, userId, id) => {
    const { data } = await sb.from('game_plan_kpis').select('phase_id').eq('id', id).maybeSingle();
    return data?.phase_id ? ownsGamePlanPhase(sb, userId, data.phase_id) : false;
  },
  // game_plan_actions.phase_id -> phase -> plan -> created_by
  action_id: async (sb, userId, id) => {
    const { data } = await sb.from('game_plan_actions').select('phase_id').eq('id', id).maybeSingle();
    return data?.phase_id ? ownsGamePlanPhase(sb, userId, data.phase_id) : false;
  },
  // client_additional_contacts.client_id -> clients owner/assignee.
  //
  // `contact_id` used to sit in NON_OWNERSHIP_ID_ARGS, which exempted it from
  // the ownership loop entirely. update_additional_contact and
  // remove_additional_contact take contact_id as their ONLY resource argument
  // and their executors run service-role with `.eq('id', contact_id)` and no
  // user filter — so any user holding client_management edit/delete could
  // rewrite or delete a co-borrower (name, email, mobile, DOB) belonging to
  // another user's client. The table has no created_by; ownership is reached
  // through the parent client, same as the other child-row resolvers here.
  contact_id: async (sb, userId, id) => {
    const { data: contact } = await sb.from('client_additional_contacts')
      .select('client_id').eq('id', id).maybeSingle();
    if (!contact?.client_id) return false;
    const { data: c } = await sb.from('clients')
      .select('created_by, assigned_team_user_id').eq('id', contact.client_id).maybeSingle();
    return !!c && (c.created_by === userId || c.assigned_team_user_id === userId);
  },
  // agent_scheduled_tasks.user_id — direct ownership.
  //
  // Same root cause: `task_id` was exempt, and toggle_scheduled_task /
  // delete_scheduled_task filter only on `.eq('id', task_id)`, so one user
  // could disable or delete another user's scheduled task. The ownership-mapped
  // key `scheduled_task_id` existed but no tool ever used it.
  task_id: async (sb, userId, id) => {
    const { data } = await sb.from('agent_scheduled_tasks')
      .select('user_id').eq('id', id).maybeSingle();
    return !!data && data.user_id === userId;
  },
  // build_progress_payments.deal_id -> client_deals.client_id -> clients owner/assignee
  payment_id: async (sb, userId, id) => {
    const { data: pay } = await sb.from('build_progress_payments').select('deal_id').eq('id', id).maybeSingle();
    if (!pay?.deal_id) return false;
    const { data: deal } = await sb.from('client_deals').select('client_id, created_by').eq('id', pay.deal_id).maybeSingle();
    if (!deal) return false;
    if (deal.created_by === userId) return true;
    if (!deal.client_id) return false;
    const { data: c } = await sb.from('clients').select('created_by, assigned_team_user_id').eq('id', deal.client_id).maybeSingle();
    return !!c && (c.created_by === userId || c.assigned_team_user_id === userId);
  },
};

async function ownsGamePlanPhase(sb: any, userId: string, phaseId: string): Promise<boolean> {
  const { data: phase } = await sb.from('game_plan_phases').select('plan_id').eq('id', phaseId).maybeSingle();
  if (!phase?.plan_id) return false;
  const { data: plan } = await sb.from('game_plans').select('created_by').eq('id', phase.plan_id).maybeSingle();
  return !!plan && plan.created_by === userId;
}

/** All arg keys that carry an ownership-checked resource id (flat + custom). */
const RESOURCE_ARG_KEYS = new Set<string>([
  ...Object.keys(DEFAULT_ARG_TO_RESOURCE),
  ...Object.keys(CUSTOM_OWNERSHIP_RESOLVERS),
]);

/**
 * Snake_case `*_id` argument keys that are NOT ownership-scoped resources and so
 * are exempt from the fail-closed unknown-id guard below (message/tool-call refs,
 * child ids resolved via their parent, external provider ids, and the caller's
 * own identity). Any NEW `*_id` argument a tool accepts must either be given an
 * ownership resolver (RESOURCE_ARG_KEYS) or be listed here — otherwise the guard
 * rejects it. Deny-by-default for identifiers.
 */
const NON_OWNERSHIP_ID_ARGS = new Set<string>([
  'tool_call_id', 'message_id', 'source_message_id', 'branch_from_message_id',
  'parent_message_id', 'library_image_id', 'source_report_id', 'source_conversation_id',
  'template_id', 'target_user_id', 'user_id', 'thread_id', 'place_id', 'external_id',
  'ghl_contact_id', 'ghl_conversation_id', 'mailbox_id', 'subscription_id',
  'envelope_id', 'session_id', 'run_id', 'job_id', 'request_id', 'correlation_id',
  // `contact_id` and `task_id` were listed here and are now ownership-resolved
  // in CUSTOM_OWNERSHIP_RESOLVERS above — they named real, user-owned rows.
  // `ghl_contact_id` stays exempt: it is an external CRM identifier, not a row
  // in this database.
]);

/** True for a snake_case argument key that names a single resource identifier. */
function looksLikeResourceId(key: string): boolean {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_id$/.test(key);
}

/**
 * Map an AI tool to its TRUE business module (registered dashboard_modules key)
 * so tool authorization is scoped to the actual capability rather than the
 * generic `ai_dashboard` gate. Ordered keyword match, most specific first; an
 * unrecognized tool returns null and keeps the tool's declared module (the
 * deny-by-default `ai_dashboard` for the un-remapped set), which stays
 * superadmin-only until an admin grants it. Every returned key MUST exist in
 * dashboard_modules.
 */
export function resolveToolBusinessModule(name: string): string | null {
  const n = name.toLowerCase();
  const has = (...s: string[]) => s.some((x) => n.includes(x));
  if (has('game_plan')) return 'game_plans';
  if (has('agreement')) return 'agreements';
  if (has('email')) return 'email_copilot';
  if (has('checklist')) return 'checklists';
  if (has('reminder', 'follow_up')) return 'reminders';
  if (has('chart')) return 'charts';
  if (has('depreciation')) return 'depreciation_comps';
  if (has('borrowing')) return 'borrowing_capacity';
  if (has('report_qa')) return 'report_qa';
  if (has('qa_queue', 'qa_stats', 'quality')) return 'quality_assurance';
  // memory/recall must resolve to agent before the 'call' rule below catches "reCALL".
  if (has('playbook', 'memory', 'memories', 'recall', 'semantic', 'scheduled_task', 'proactive_insight', 'system_health')) return 'agent';
  if (has('portal')) return 'client_portal_admin';
  if (has('listing')) return 'listings';
  if (has('conversation')) return 'conversations';
  if (has('appointment', 'outlook', 'calendar', 'free_slot', 'prep_block')) return 'calendar';
  if (has('call')) return 'call_logs';
  if (has('cloudflare')) return 'cloudflare';
  if (has('monitoring', 'api_health', 'api_usage', 'cache_statistic', 'integration_status', 'performance_metric')) return 'monitoring';
  if (has('preference')) return 'settings';
  if (has('branding')) return 'white_label';
  if (has('lmi', 'lender_rate', 'best_rate', 'lending_rate', 'loan_repayment', 'stamp_duty', 'rental_yield')) return 'borrowing_capacity';
  if (has('recent_activity')) return 'activity_logs';
  if (has('import_history')) return 'data_import';
  if (has('data_source')) return 'sources';
  if (has('cash_flow', 'commission', 'pipeline', 'revenue', 'clawback', 'equity_position')) return 'cash_flow';
  if (has('checklist_template', 'template')) return 'templates';
  if (has('investment_report', 'marketing_report', 'auto_report', 'report_details', 'bulk_generation', 'report')) return 'reports';
  if (has('build_progress', 'builder_invoice', 'build_payment')) return 'client_management';
  // client + deal + financial-position sub-data all live under client management
  if (has('client', 'deal', 'employment', 'income', 'expense', 'asset', 'liabilit',
          'contact', 'portfolio', 'settlement', 'lead_source', 'document_readiness')) return 'client_management';
  // Marketing attribution. Last so it cannot shadow the report rules above —
  // get_marketing_reports keeps resolving to `reports`. Without this the four
  // attribution tools fall through to `ai_dashboard`, which is not a registered
  // module and therefore cannot be granted to anyone: they were permanently
  // superadmin-only even though `marketing_analytics` exists for exactly them.
  if (has('attribution', 'campaign', 'marketing_funnel')) return 'marketing_analytics';
  return null; // unrecognized → keep declared module (stays restricted)
}

// Tools that MUST have a caller-supplied step-up signal. Derived by prefix so
// the 217-row policy table doesn't have to be re-audited; explicit policy
// requiresStepUp:true still wins.
function toolRequiresStepUp(name: string, policy: ToolSecurityPolicy): boolean {
  if (policy.requiresStepUp) return true;
  if (name.startsWith('bulk_')) return true;
  if (policy.permission === 'can_delete') return true;
  return false;
}

export interface AgentToolAuthzContext {
  actorType: 'human' | 'scheduled' | 'internal';
  stepUpVerified?: boolean;      // true when the confirm-tool path executed it
  internalCaller?: string;       // service-role caller identity (WP-05C)
}

export class AgentToolAuthzError extends Error {
  constructor(public code: 'policy_denied' | 'actor_denied' | 'module_denied' | 'resource_denied' | 'step_up_required' | 'batch_too_large', message: string) {
    super(message);
    this.name = 'AgentToolAuthzError';
  }
}

async function isSuperadmin(sb: any, userId: string): Promise<boolean> {
  return actorIsSuperadmin(sb, userId);
}

async function ownsResource(sb: any, userId: string, argKey: string, argValue: string): Promise<boolean> {
  if (!argValue || typeof argValue !== 'string') return true;
  // Multi-hop resolvers take precedence for the identifiers they cover.
  const custom = CUSTOM_OWNERSHIP_RESOLVERS[argKey];
  if (custom) {
    try { return await custom(sb, userId, argValue); } catch { return false; }
  }
  const spec = DEFAULT_ARG_TO_RESOURCE[argKey];
  if (!spec) return true; // unknown key → no resource gate (still gated by other args)
  try {
    // First: direct ownership on the row itself.
    const columns = `${spec.ownerColumn}${spec.parentClientColumn ? ',' + spec.parentClientColumn : ''}${spec.table === 'clients' ? ',assigned_team_user_id' : ''}`;
    const { data: row } = await sb.from(spec.table).select(columns).eq('id', argValue).maybeSingle();
    if (!row) return false; // row missing → fail closed
    if ((row as any)[spec.ownerColumn] === userId) return true;
    if (spec.table === 'clients' && (row as any).assigned_team_user_id === userId) return true;
    // Fallback: ownership of the parent client (many child rows are owned via clients.created_by).
    const parentClientId = spec.parentClientColumn ? (row as any)[spec.parentClientColumn] : null;
    if (parentClientId) {
      const { data: c } = await sb.from('clients').select('created_by, assigned_team_user_id').eq('id', parentClientId).maybeSingle();
      if (c && ((c as any).created_by === userId || (c as any).assigned_team_user_id === userId)) return true;
    }
    return false;
  } catch {
    return false; // fail closed on any error
  }
}

async function auditToolDecision(sb: any, userId: string, tool: string, decision: 'allow' | 'deny', resourceIds: string[], reason?: string, actorType = 'human'): Promise<void> {
  try {
    await sb.from('security_events').insert({
      actor_type: actorType,
      actor_id: userId || null,
      action: `ai_agent_tool:${tool}`,
      decision,
      target_type: 'agent_tool',
      target_id: resourceIds[0] || null,
      reason_code: reason || null,
      metadata_redacted: { resource_ids: resourceIds },
    });
  } catch (error) {
    // Audit outages must not convert a denied request into an allowed one; an
    // allow is recorded best-effort until the security_events rollout is live.
    console.error('[agentToolAuthz] security event write failed:', error);
  }
}

/**
 * Fail-closed authorization gate for every agent tool dispatch.
 *
 * Order:
 *  1. Policy must exist and permit the actorType.
 *  2. Step-up gate (delete_*, bulk_*, or policy.requiresStepUp) requires
 *     ctx.stepUpVerified. The pending-message confirmation path sets this;
 *     direct tool calls without confirmation are rejected.
 *  3. Batch ceiling (WP-05C surface, wired here so future policies opt in).
 *  4. Resource-ownership gate on read and write tools:
 *     - superadmin bypasses
 *     - service-role internal callers bypass (they act system-wide)
 *     - every recognised *_id arg is checked against the acting user
 */
export async function authorizeAgentTool(sb: any, name: string, args: Record<string, any>, userId: string, ctx: AgentToolAuthzContext): Promise<void> {
  const basePolicy = TOOL_SECURITY_POLICIES[name];
  const policy = basePolicy ? { ...basePolicy, ...(REAL_MODULE_OVERRIDES[name] || {}) } : null;
  // Scope any still-generic `ai_dashboard` tool to its true business module.
  if (policy && policy.moduleKey === 'ai_dashboard') {
    const businessModule = resolveToolBusinessModule(name);
    if (businessModule) policy.moduleKey = businessModule;
  }
  if (!policy) throw new AgentToolAuthzError('policy_denied', `No policy registered for tool '${name}'`);
  if (!policy.allowedActorTypes.includes(ctx.actorType)) {
    throw new AgentToolAuthzError('actor_denied', `Tool '${name}' cannot be invoked by actor '${ctx.actorType}'`);
  }
  if (ctx.actorType === 'internal' && !policy.allowedInternalCallers?.includes(ctx.internalCaller || '')) {
    throw new AgentToolAuthzError('actor_denied', `Internal caller is not allowlisted for tool '${name}'`);
  }
  const resourceIds = Object.entries(args || {}).flatMap(([key, value]) => {
    if (!RESOURCE_ARG_KEYS.has(key)) return [];
    if (typeof value === 'string') return [value];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  });
  if (ctx.actorType === 'human') {
    const module = await requireModulePermission(sb, { userId, authMethod: 'human' }, policy.moduleKey || '', policy.permission);
    if (!module.ok) {
      await auditToolDecision(sb, userId, name, 'deny', resourceIds, module.reason_code);
      throw new AgentToolAuthzError('module_denied', module.error || `Missing ${policy.moduleKey} permission`);
    }
  }
  const superadmin = ctx.actorType !== 'internal' && await isSuperadmin(sb, userId);
  if (policy.requiresSuperadmin && !superadmin && ctx.actorType !== 'internal') {
    await auditToolDecision(sb, userId, name, 'deny', resourceIds, 'superadmin_required');
    throw new AgentToolAuthzError('module_denied', `Tool '${name}' requires superadmin privilege`);
  }
  // Batch ceiling (WP-05C). Every bulk_* policy MUST declare maxBatchSize; the
  // gate scans every array-valued top-level arg and rejects the largest one
  // that exceeds the ceiling. This blocks callers from renaming the payload
  // (e.g. `client_ids` vs `updates`) to slip past a hard-coded key check.
  if (typeof policy.maxBatchSize === 'number') {
    let largest = 0;
    for (const v of Object.values(args || {})) {
      if (Array.isArray(v) && v.length > largest) largest = v.length;
    }
    if (largest > policy.maxBatchSize) {
      throw new AgentToolAuthzError('batch_too_large', `Tool '${name}' batch of ${largest} exceeds ceiling ${policy.maxBatchSize}`);
    }
  } else if (name.startsWith('bulk_')) {
    // Defense-in-depth: an un-ceilinged bulk tool is a config bug — refuse.
    throw new AgentToolAuthzError('policy_denied', `Tool '${name}' is a bulk operation without a maxBatchSize policy`);
  }
  // Step-up gate (deletes, bulk_*, or explicit requiresStepUp).
  if (toolRequiresStepUp(name, policy) && !ctx.stepUpVerified) {
    // Internal service-role callers may bypass step-up ONLY when the policy
    // explicitly whitelists them (WP-05C). Default: fail closed.
    const internalWhitelisted = ctx.actorType === 'internal' && !!policy.allowedInternalCallers?.includes(ctx.internalCaller || '');
    if (!internalWhitelisted) {
      throw new AgentToolAuthzError('step_up_required', `Tool '${name}' requires step-up confirmation`);
    }
  }
  // Resource scope applies to reads AND writes. Service callers are separately
  // authenticated and allowlisted; human callers must be owner/assignee.
  if (ctx.actorType === 'internal') {
    await auditToolDecision(sb, userId, name, 'allow', resourceIds, 'allowlisted_internal_caller', 'internal');
    return;
  }
  if (superadmin) { await auditToolDecision(sb, userId, name, 'allow', resourceIds); return; }
  // Fail closed on identifiers we cannot ownership-resolve. Any snake_case
  // `*_id` argument must be either an ownership resource (RESOURCE_ARG_KEYS) or
  // an explicitly-listed non-ownership id (NON_OWNERSHIP_ID_ARGS). An unknown
  // `*_id` means a tool can accept a resource reference that escapes the
  // ownership loop below — reject rather than trust it.
  for (const key of Object.keys(args || {})) {
    if (!looksLikeResourceId(key)) continue;
    if (RESOURCE_ARG_KEYS.has(key) || NON_OWNERSHIP_ID_ARGS.has(key)) continue;
    await auditToolDecision(sb, userId, name, 'deny', resourceIds, 'unresolvable_resource_id');
    throw new AgentToolAuthzError('resource_denied', `Tool '${name}' received an unrecognized resource id '${key}'`);
  }
  // Use policy.resolveResource if provided, otherwise scan args for known keys.
  const explicit = policy.resolveResource?.(args);
  if (explicit) {
    // Map the explicit resource back to an arg key if we recognise the type.
    const argKey = Object.keys(DEFAULT_ARG_TO_RESOURCE).find((k) => DEFAULT_ARG_TO_RESOURCE[k].table.startsWith(explicit.resourceType));
    if (argKey && !(await ownsResource(sb, userId, argKey, explicit.resourceId))) {
      await auditToolDecision(sb, userId, name, 'deny', resourceIds, 'resource_denied');
      throw new AgentToolAuthzError('resource_denied', `User does not own ${explicit.resourceType} ${explicit.resourceId}`);
    }
  } else {
    for (const [key, value] of Object.entries(args || {})) {
      if (!RESOURCE_ARG_KEYS.has(key)) continue;
      const resourceValues = Array.isArray(value) ? value : [value];
      for (const resourceId of resourceValues) {
        if (typeof resourceId !== 'string' || !(await ownsResource(sb, userId, key, resourceId))) {
          await auditToolDecision(sb, userId, name, 'deny', resourceIds, 'resource_denied');
          throw new AgentToolAuthzError('resource_denied', `User does not own ${key}=${String(resourceId)}`);
        }
      }
    }
  }
  await auditToolDecision(sb, userId, name, 'allow', resourceIds);
}
