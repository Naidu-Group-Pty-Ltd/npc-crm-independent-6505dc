import fs from 'node:fs';
const sql=fs.readFileSync('supabase/migrations/20260730240000_unified_conversations_notifications_phase8.sql','utf8');
for(const token of ['conversations','conversation_participants','messages','message_attachments','message_receipts','notification_deliveries','notification_preferences','ensure_case_conversation','post_conversation_message','mark_conversation_read','claim_notification_deliveries','FIRM_INTERNAL_PARTICIPANT_FORBIDDEN','assigned_finance_user_id','canonical_message_id','uncertain_historical_mirror'])if(!sql.includes(token))throw new Error(`Missing ${token}`);
if(/DELETE FROM public\.(legal_matter_messages|client_portal_messages|finance_portal_messages)/i.test(sql))throw new Error('Phase 8 must preserve legacy messages');
console.log('Phase 8 migration contract passed');
