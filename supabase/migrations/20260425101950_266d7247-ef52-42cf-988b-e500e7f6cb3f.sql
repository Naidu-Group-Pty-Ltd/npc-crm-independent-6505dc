INSERT INTO public.ghl_migration_baseline (snapshot_label, table_name, row_count, notes)
SELECT 'phase-0-post-delta-freeze', t.table_name, t.row_count, 'Locked-in counts after final delta pull from old GHL account; this is what gets mirrored to new account'
FROM (
  SELECT 'clients_with_ghl_contact_id' AS table_name, (SELECT COUNT(*) FROM public.clients WHERE ghl_contact_id IS NOT NULL) AS row_count
  UNION ALL SELECT 'clients_total', (SELECT COUNT(*) FROM public.clients)
  UNION ALL SELECT 'ghl_client_opportunities', (SELECT COUNT(*) FROM public.ghl_client_opportunities)
  UNION ALL SELECT 'ghl_conversations', (SELECT COUNT(*) FROM public.ghl_conversations)
  UNION ALL SELECT 'ghl_conversation_messages', (SELECT COUNT(*) FROM public.ghl_conversation_messages)
  UNION ALL SELECT 'client_notes_total', (SELECT COUNT(*) FROM public.client_notes)
  UNION ALL SELECT 'client_notes_with_ghl_note_id', (SELECT COUNT(*) FROM public.client_notes WHERE ghl_note_id IS NOT NULL)
  UNION ALL SELECT 'ghl_pipelines', (SELECT COUNT(*) FROM public.ghl_pipelines)
  UNION ALL SELECT 'ghl_pipeline_stages', (SELECT COUNT(*) FROM public.ghl_pipeline_stages)
  UNION ALL SELECT 'ghl_workflows', (SELECT COUNT(*) FROM public.ghl_workflows)
  UNION ALL SELECT 'ghl_forms', (SELECT COUNT(*) FROM public.ghl_forms)
  UNION ALL SELECT 'ghl_funnels', (SELECT COUNT(*) FROM public.ghl_funnels)
  UNION ALL SELECT 'ghl_funnel_pages', (SELECT COUNT(*) FROM public.ghl_funnel_pages)
  UNION ALL SELECT 'ghl_id_mapping', (SELECT COUNT(*) FROM public.ghl_id_mapping)
) t;