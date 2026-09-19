-- Phase 14 read-only observability reconciliation.
SELECT 'alert_without_event' issue,a.id::text record_id FROM public.portal_operational_alerts a LEFT JOIN public.portal_operational_events e ON e.id=a.event_id WHERE e.id IS NULL
UNION ALL SELECT 'critical_event_without_alert',e.id::text FROM public.portal_operational_events e WHERE e.event_name IN ('cross_firm_access_attempt','audit_chain_failure','mandatory_audit_write_failure','dead_lettered_settlement_event','document_malware_detected','client_projection_privacy_violation','cross_client_case_link_attempt','excessive_authentication_failures') AND NOT EXISTS(SELECT 1 FROM public.portal_operational_alerts a WHERE a.event_id=e.id)
UNION ALL SELECT 'missing_correlation',id::text FROM public.portal_operational_events WHERE correlation_id IS NULL
UNION ALL SELECT 'stale_open_alert',id::text FROM public.portal_operational_alerts WHERE status='open' AND created_at<now()-interval '24 hours';
