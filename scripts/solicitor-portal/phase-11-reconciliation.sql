-- Read-only Finance–Solicitor collaboration health report.
SELECT 'finance_projections' metric,count(*) value FROM public.finance_case_read_model
UNION ALL SELECT 'solicitor_projections',count(*) FROM public.solicitor_case_read_model
UNION ALL SELECT 'unlinked_legal_matters',count(*) FROM public.legal_matters m WHERE NOT EXISTS(SELECT 1 FROM public.transaction_case_links l WHERE l.legal_matter_id=m.id)
UNION ALL SELECT 'unlinked_purchase_files',count(*) FROM public.purchase_files p WHERE p.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.transaction_case_links l WHERE l.purchase_file_id=p.id)
UNION ALL SELECT 'unlinked_client_deals',count(*) FROM public.client_deals d WHERE NOT EXISTS(SELECT 1 FROM public.transaction_case_links l WHERE l.client_deal_id=d.id)
UNION ALL SELECT 'cross_projection_client_mismatch',count(*) FROM public.finance_case_read_model f JOIN public.solicitor_case_read_model s USING(case_id) WHERE f.client_id IS DISTINCT FROM s.client_id
UNION ALL SELECT 'stale_finance_projection',count(*) FROM public.finance_case_read_model WHERE updated_at<now()-interval '15 minutes'
UNION ALL SELECT 'stale_solicitor_projection',count(*) FROM public.solicitor_case_read_model WHERE updated_at<now()-interval '15 minutes'
UNION ALL SELECT 'finance_conversations_without_current_participant',count(*) FROM public.conversations c WHERE c.scope='finance_solicitor' AND NOT EXISTS(SELECT 1 FROM public.conversation_participants p WHERE p.conversation_id=c.id AND p.participant_type='finance_user' AND p.left_at IS NULL)
UNION ALL SELECT 'failed_delivery_attempts',count(*) FROM public.integration_delivery_attempts WHERE status='failed';

SELECT tc.id case_id,l.legal_matter_id,l.purchase_file_id,l.client_deal_id,f.updated_at finance_projection_at,s.updated_at solicitor_projection_at,h.link_health,h.open_issue_count
FROM public.transaction_cases tc LEFT JOIN public.transaction_case_links l ON l.case_id=tc.id LEFT JOIN public.finance_case_read_model f ON f.case_id=tc.id LEFT JOIN public.solicitor_case_read_model s ON s.case_id=tc.id LEFT JOIN public.command_case_health_read_model h ON h.case_id=tc.id
WHERE l.legal_matter_id IS NULL OR l.purchase_file_id IS NULL OR l.client_deal_id IS NULL OR f.case_id IS NULL OR s.case_id IS NULL OR f.updated_at<now()-interval '15 minutes' OR s.updated_at<now()-interval '15 minutes' ORDER BY tc.updated_at DESC;
