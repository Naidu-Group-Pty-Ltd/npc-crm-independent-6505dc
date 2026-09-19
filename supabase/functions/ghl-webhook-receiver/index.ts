import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getEffectiveGhlCredentials } from '../_shared/ghl-account.ts';
import { verifyWebhookSecret } from '../_shared/auth_v2.ts';
import { insertTargetedNotification } from '../_shared/notify.ts';
import { internalError } from '../_shared/errorResponse.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCustomField(customFields: any[], keys: string[]) {
  for (const key of keys) {
    const field = customFields.find((f: any) =>
      f.key === key || f.id === key || f.fieldKey === key
    );
    if (field?.value) return field.value;
  }
  return null;
}

/** Resolve a GHL stage ID to the local Supabase stage/pipeline UUIDs */
async function resolveStage(supabase: any, ghlStageId: string) {
  const { data: stage } = await supabase
    .from('ghl_pipeline_stages')
    .select('id, name, pipeline_id')
    .eq('ghl_id', ghlStageId)
    .maybeSingle();

  if (!stage) return null;

  const { data: pipeline } = await supabase
    .from('ghl_pipelines')
    .select('id, name')
    .eq('id', stage.pipeline_id)
    .maybeSingle();

  return {
    stageUuid: stage.id,
    stageName: stage.name,
    pipelineUuid: stage.pipeline_id,
    pipelineName: pipeline?.name || 'Unknown',
  };
}

/** Look up the contact's opportunity in GHL via the API (GET endpoint with query params) */
async function fetchOpportunityForContact(
  contactId: string,
  apiKey: string,
  locationId: string
): Promise<{ id: string; pipelineStageId: string; pipelineId: string; status: string; monetaryValue?: number } | null> {
  try {
    // Use GET /opportunities/search with query params — the POST endpoint rejects contactId
    const params = new URLSearchParams({
      location_id: locationId,
      contact_id: contactId,
    });
    const res = await fetch(`${GHL_API_BASE}/opportunities/search?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28',
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('[ghl-webhook] Opportunity search failed:', res.status, errText);
      return null;
    }

    const data = await res.json();
    const opps = data.opportunities || [];
    if (opps.length === 0) return null;

    // Return the first (most recent) opportunity
    const opp = opps[0];
    return {
      id: opp.id,
      pipelineStageId: opp.pipelineStageId,
      pipelineId: opp.pipelineId,
      status: opp.status || 'open',
      monetaryValue: opp.monetaryValue,
    };
  } catch (err) {
    console.error('[ghl-webhook] Error fetching opportunity:', err);
    return null;
  }
}

/** Update client pipeline fields from an opportunity's stage data */
async function updateClientPipelineFields(
  supabase: any,
  clientId: string,
  opportunityId: string,
  ghlStageId: string,
  opportunityStatus: string,
  monetaryValue?: number
) {
  const stageInfo = await resolveStage(supabase, ghlStageId);

  const updateData: Record<string, any> = {
    ghl_opportunity_id: opportunityId,
    opportunity_status: opportunityStatus,
    pipeline_updated_at: new Date().toISOString(),
    ghl_last_synced_at: new Date().toISOString(),
    ghl_sync_status: 'synced',
  };

  if (stageInfo) {
    updateData.pipeline_status = stageInfo.stageName;
    updateData.current_stage_id = stageInfo.stageUuid;
    updateData.current_pipeline_id = stageInfo.pipelineUuid;
    console.log(`[ghl-webhook] Resolved stage: ${stageInfo.stageName} (${stageInfo.pipelineName})`);
  } else {
    console.warn(`[ghl-webhook] Could not resolve GHL stage ID: ${ghlStageId} — stage may not be synced yet`);
  }

  if (monetaryValue) {
    updateData.borrowing_capacity = monetaryValue;
  }

  const { error } = await supabase
    .from('clients')
    .update(updateData)
    .eq('id', clientId);

  if (error) {
    console.error('[ghl-webhook] Error updating pipeline fields:', error);
  } else {
    console.log(`[ghl-webhook] Updated pipeline fields for client ${clientId}`);
  }
}

// ─── Conversation / Message Event Handler ───────────────────────────────────

function mapGhlChannelType(ghlType: string | number | undefined): string {
  if (!ghlType) return 'sms';
  const typeStr = String(ghlType).toLowerCase();
  const mapping: Record<string, string> = {
    'sms': 'sms', '1': 'sms', 'phone': 'sms',
    'email': 'email', '2': 'email',
    'whatsapp': 'whatsapp', '3': 'whatsapp',
    'fb': 'facebook', 'facebook': 'facebook', '4': 'facebook',
    'ig': 'instagram', 'instagram': 'instagram', '5': 'instagram',
    'live_chat': 'live_chat', 'livechat': 'live_chat', '6': 'live_chat',
    'google_my_business': 'gmb', 'gmb': 'gmb', '7': 'gmb',
  };
  return mapping[typeStr] || typeStr;
}

async function handleConversationMessageEvent(supabase: any, body: any, eventType: string) {
  // GHL sends: InboundMessage, OutboundMessage, ConversationUnreadUpdate, etc.
  const messageId = body.id || body.messageId;
  const conversationId = body.conversationId || body.conversation_id;
  const contactId = body.contactId || body.contact_id;
  const messageBody = body.body || body.message || body.text || '';
  const direction = eventType.includes('inbound') ? 'inbound' : 'outbound';
  const messageType = body.messageType || body.type;
  const dateAdded = body.dateAdded || body.createdAt || new Date().toISOString();

  if (!conversationId) {
    console.error('[ghl-webhook] Message event missing conversationId');
    return { success: false, error: 'Missing conversationId' };
  }

  console.log(`[ghl-webhook] Processing message event: type=${eventType}, msgId=${messageId}, conv=${conversationId}, contact=${contactId}`);

  // Find client by ghl_contact_id
  let clientId: string | null = null;
  if (contactId) {
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('ghl_contact_id', contactId)
      .maybeSingle();
    clientId = client?.id || null;
  }

  // Upsert the conversation record
  const channelType = mapGhlChannelType(messageType);
  const { data: convRecord, error: convError } = await supabase
    .from('ghl_conversations')
    .upsert({
      ghl_conversation_id: conversationId,
      client_id: clientId,
      ghl_contact_id: contactId || null,
      channel_type: channelType,
      last_message_body: messageBody.substring(0, 500),
      last_message_date: dateAdded,
      last_message_direction: direction,
      unread_count: direction === 'inbound' ? 1 : 0,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'ghl_conversation_id' })
    .select('id, unread_count')
    .single();

  if (convError) {
    console.error('[ghl-webhook] Conversation upsert failed:', convError.message);
    return { success: false, error: convError.message };
  }

  // If inbound, increment unread count on existing conversation
  if (direction === 'inbound' && convRecord) {
    await supabase
      .from('ghl_conversations')
      .update({ unread_count: (convRecord.unread_count || 0) + 1 })
      .eq('id', convRecord.id);
  }

  // Upsert the message if we have a message ID
  if (messageId) {
    const attachments = body.attachments?.map((a: any) => a.url).filter(Boolean) || null;

    const { error: msgError } = await supabase
      .from('ghl_conversation_messages')
      .upsert({
        conversation_id: convRecord.id,
        ghl_message_id: messageId,
        direction,
        channel_type: channelType,
        body: messageBody || null,
        content_type: body.contentType?.includes('image') ? 'image' : 
                      body.contentType?.includes('video') ? 'video' : 
                      body.contentType?.includes('audio') ? 'audio' : 'text',
        attachment_urls: attachments,
        sender_name: body.contactName || body.userName || null,
        sender_number: body.from || body.phone || null,
        recipient_number: body.to || null,
        message_status: body.status || 'sent',
        ghl_date_added: dateAdded,
      }, { onConflict: 'ghl_message_id' });

    if (msgError) {
      console.error('[ghl-webhook] Message upsert failed:', msgError.message);
      return { success: false, error: msgError.message };
    }

    console.log(`[ghl-webhook] ✅ Synced ${direction} message ${messageId} to conversation ${conversationId}`);
  }

  // ── Insert notification for inbound messages (webhook-level, supplements DB trigger) ──
  if (direction === 'inbound' && convRecord) {
    try {
      // Get client name for the notification title
      let clientName = body.contactName || 'Unknown Contact';
      if (clientId) {
        const { data: clientRow } = await supabase
          .from('clients')
          .select('primary_first_name, primary_surname')
          .eq('id', clientId)
          .maybeSingle();
        if (clientRow) {
          clientName = [clientRow.primary_first_name, clientRow.primary_surname].filter(Boolean).join(' ') || clientName;
        }
      }

      const channelLabel = channelType.toUpperCase();
      const preview = (messageBody || '(Attachment)').substring(0, 100);

      await insertTargetedNotification(supabase, {
        moduleKey: 'conversations',
        notification: {
          type: 'conversation_reply',
          title: `New ${channelLabel} from ${clientName}`,
          message: preview,
          entity_id: clientId || convRecord.id,
        },
      });

      console.log(`[ghl-webhook] 📬 Notification created for inbound ${channelLabel} from ${clientName}`);
    } catch (notifErr) {
      console.error('[ghl-webhook] Notification insert failed (non-fatal):', notifErr);
    }
  }

  return {
    success: true,
    action: 'message_synced',
    direction,
    conversationId,
    clientId,
  };
}

// ─── Conversation Unread Update Handler ─────────────────────────────────────

async function handleConversationUnreadUpdate(supabase: any, body: any) {
  const conversationId = body.conversationId || body.id;
  const unreadCount = body.unreadCount ?? body.unread_count ?? 0;

  if (!conversationId) {
    return { success: false, error: 'Missing conversationId' };
  }

  const { error } = await supabase
    .from('ghl_conversations')
    .update({ unread_count: unreadCount })
    .eq('ghl_conversation_id', conversationId);

  if (error) {
    console.error('[ghl-webhook] Unread update failed:', error.message);
    return { success: false, error: error.message };
  }

  return { success: true, action: 'unread_updated', conversationId, unreadCount };
}

// ─── Note Event Handler ─────────────────────────────────────────────────────

async function handleNoteEvent(supabase: any, body: any, eventType: string) {
  const noteId = body.id || body.noteId || body.note_id;
  const contactId = body.contactId || body.contact_id || body.contact?.id;
  const noteBody = body.body || body.content || body.note || '';
  const dateAdded = body.dateAdded || body.date_added || new Date().toISOString();

  if (!contactId) {
    console.error('[ghl-webhook] Note event missing contactId');
    return { success: false, error: 'Missing contactId in note event' };
  }

  if (!noteId) {
    console.error('[ghl-webhook] Note event missing note ID');
    return { success: false, error: 'Missing note ID' };
  }

  console.log(`[ghl-webhook] Processing note event: type=${eventType}, noteId=${noteId}, contact=${contactId}`);

  // Find client by ghl_contact_id
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('ghl_contact_id', contactId)
    .maybeSingle();

  if (!client) {
    console.warn(`[ghl-webhook] No client found for GHL contact ${contactId} — note event ignored`);
    return { success: false, error: 'Client not found for this contact' };
  }

  // Handle delete
  if (eventType.includes('delete')) {
    const { error } = await supabase
      .from('client_notes')
      .delete()
      .eq('ghl_note_id', noteId);

    if (error) {
      console.error('[ghl-webhook] Error deleting note:', error);
      return { success: false, error: error.message };
    }
    console.log(`[ghl-webhook] Deleted note with ghl_note_id=${noteId}`);
    return { success: true, action: 'deleted', noteId };
  }

  // Handle create/update — upsert by ghl_note_id
  // Strip type prefix if present (e.g., "[GENERAL] content" → "content")
  let cleanContent = noteBody;
  const prefixMatch = noteBody.match(/^\[([A-Z_]+)\]\s*/);
  let noteType = 'general';
  if (prefixMatch) {
    noteType = prefixMatch[1].toLowerCase();
    cleanContent = noteBody.replace(prefixMatch[0], '');
  }

  // Check if note already exists
  const { data: existingNote } = await supabase
    .from('client_notes')
    .select('id')
    .eq('ghl_note_id', noteId)
    .maybeSingle();

  if (existingNote) {
    // Update existing
    const { error } = await supabase
      .from('client_notes')
      .update({
        content: cleanContent,
        note_type: noteType,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingNote.id);

    if (error) {
      console.error('[ghl-webhook] Error updating note:', error);
      return { success: false, error: error.message };
    }
    console.log(`[ghl-webhook] Updated existing note ${existingNote.id} from GHL`);
    return { success: true, action: 'updated', noteId: existingNote.id };
  } else {
    // Insert new
    const { data: inserted, error } = await supabase
      .from('client_notes')
      .insert({
        client_id: client.id,
        content: cleanContent,
        note_type: noteType,
        ghl_note_id: noteId,
        created_at: dateAdded,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[ghl-webhook] Error inserting note:', error);
      return { success: false, error: error.message };
    }
    console.log(`[ghl-webhook] Created new note ${inserted.id} from GHL note ${noteId}`);
    return { success: true, action: 'created', noteId: inserted.id };
  }
}

// ─── Opportunity Event Handler ──────────────────────────────────────────────

async function handleOpportunityEvent(supabase: any, body: any) {
  // GHL opportunity webhooks typically include: id, pipelineId, pipelineStageId, contact.id, status
  const opp = body;
  const opportunityId = opp.id;
  const contactId = opp.contact?.id || opp.contactId || opp.contact_id;
  const pipelineStageId = opp.pipelineStageId || opp.pipeline_stage_id;
  const pipelineId = opp.pipelineId || opp.pipeline_id;
  const status = opp.status || 'open';
  const monetaryValue = opp.monetaryValue || opp.monetary_value;

  if (!contactId) {
    console.error('[ghl-webhook] Opportunity event missing contactId');
    return { success: false, error: 'Missing contactId in opportunity event' };
  }

  if (!pipelineStageId) {
    console.error('[ghl-webhook] Opportunity event missing pipelineStageId');
    return { success: false, error: 'Missing pipelineStageId' };
  }

  console.log(`[ghl-webhook] Processing opportunity event: opp=${opportunityId}, contact=${contactId}, stage=${pipelineStageId}`);

  // Find client by ghl_contact_id
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('ghl_contact_id', contactId)
    .maybeSingle();

  if (!client) {
    console.warn(`[ghl-webhook] No client found for GHL contact ${contactId} — opportunity event ignored`);
    return { success: false, error: 'Client not found for this contact' };
  }

  await updateClientPipelineFields(supabase, client.id, opportunityId, pipelineStageId, status, monetaryValue);

  return {
    success: true,
    clientId: client.id,
    stageSynced: true,
  };
}

// ─── Contact Event Handler (existing logic) ─────────────────────────────────

async function handleContactEvent(supabase: any, body: any, apiKey: string | null, locationId: string | null) {
  const contact = body.contact || body;
  const contactId = contact.id || body.contact_id || body.contactId;
  const firstName = contact.firstName || contact.first_name || body.first_name || 'Unknown';
  const lastName = contact.lastName || contact.last_name || body.last_name || 'Unknown';
  const email = contact.email || body.email || null;
  const phone = contact.phone || body.phone || null;
  const address = contact.address1 || body.address1 || null;
  const city = contact.city || body.city || null;
  const state = contact.state || body.state || null;
  const postalCode = contact.postalCode || body.postalCode || null;
  const country = contact.country || body.country || 'Australia';
  const source = contact.source || body.source || null;
  const dateAdded = contact.dateAdded || body.dateAdded || new Date().toISOString();
  const customFields = contact.customFields || body.customFields || [];
  const tags = contact.tags || body.tags || [];

  if (!contactId) {
    console.error('[ghl-webhook] No contact ID in webhook payload');
    return { success: false, error: 'Missing contact ID', status: 400 };
  }

  // Base identity payload always safe to sync
  const baseSyncData: Record<string, any> = {
    ghl_contact_id: contactId,
    ghl_sync_status: 'synced',
    ghl_last_synced_at: new Date().toISOString(),
  };

  // Structured address from GHL — split into our per-field columns so a round-trip
  // stays idempotent. Only include a field if GHL explicitly provided a non-empty
  // value; otherwise we must NOT clobber local edits (a ContactUpdate webhook for
  // an unrelated field would otherwise revert address changes made in the app).
  const incomingFields: Record<string, any> = {
    primary_first_name: firstName && firstName !== 'Unknown' ? firstName : undefined,
    primary_surname: lastName && lastName !== 'Unknown' ? lastName : undefined,
    primary_email: email || undefined,
    primary_mobile: phone || undefined,
    current_address: address || undefined,
    current_suburb: city || undefined,
    current_state: state || undefined,
    current_postcode: postalCode || undefined,
    country: country || undefined,
  };
  const nonEmptyFields = Object.fromEntries(
    Object.entries(incomingFields).filter(([_, v]) => v !== undefined && v !== null && v !== '')
  );

  const buildUpdatePayload = (existing: Record<string, any> | null) => {
    // For NEW clients, seed everything from GHL. For existing rows, only overwrite
    // a field if it is currently blank OR the incoming value actually differs and
    // the existing row was last touched by GHL (never overwrite user-edited fields
    // with stale GHL data). Safest baseline: never overwrite non-empty local values.
    const patch: Record<string, any> = { ...baseSyncData };
    for (const [key, value] of Object.entries(nonEmptyFields)) {
      const current = existing?.[key];
      if (current === null || current === undefined || current === '') {
        patch[key] = value;
      }
    }
    return patch;
  };

  // Check if client already exists by ghl_contact_id
  const { data: existingByGhl } = await supabase
    .from('clients')
    .select('id, primary_first_name, primary_surname, primary_email, primary_mobile, current_address, current_suburb, current_state, current_postcode, country')
    .eq('ghl_contact_id', contactId)
    .maybeSingle();

  let clientDbId: string | null = null;
  let isNewClient = false;

  if (existingByGhl) {
    const patch = buildUpdatePayload(existingByGhl);
    const { error: updateError } = await supabase
      .from('clients')
      .update(patch)
      .eq('id', existingByGhl.id);
    if (updateError) console.error('[ghl-webhook] Error updating client:', updateError);
    clientDbId = existingByGhl.id;
    console.log('[ghl-webhook] Updated existing client (non-destructive):', clientDbId, Object.keys(patch));
  } else if (email) {
    const { data: existingByEmail } = await supabase
      .from('clients')
      .select('id, primary_first_name, primary_surname, primary_email, primary_mobile, current_address, current_suburb, current_state, current_postcode, country')
      .eq('primary_email', email)
      .maybeSingle();

    if (existingByEmail) {
      const patch = buildUpdatePayload(existingByEmail);
      const { error: updateError } = await supabase
        .from('clients')
        .update(patch)
        .eq('id', existingByEmail.id);
      if (updateError) console.error('[ghl-webhook] Error updating client by email:', updateError);
      clientDbId = existingByEmail.id;
      console.log('[ghl-webhook] Updated client by email match (non-destructive):', clientDbId);
    }
  }

  // For NEW client inserts below, use the full seeded payload
  const clientData: Record<string, any> = {
    ...baseSyncData,
    primary_first_name: firstName,
    primary_surname: lastName,
    primary_email: email,
    primary_mobile: phone,
    current_address: address || null,
    current_suburb: city || null,
    current_state: state || null,
    current_postcode: postalCode || null,
    country: country,
  };

  if (!clientDbId) {
    const { data: inserted, error: insertError } = await supabase
      .from('clients')
      .insert(clientData)
      .select('id')
      .single();

    if (insertError) {
      console.error('[ghl-webhook] Error inserting client:', insertError);
      return { success: false, error: 'Failed to create client', details: insertError.message, status: 500 };
    }
    clientDbId = inserted.id;
    isNewClient = true;
    console.log('[ghl-webhook] Created new client:', clientDbId);
  }

  // ── Auto-fetch opportunity from GHL API to populate pipeline fields ──
  if (clientDbId && apiKey && locationId) {
    console.log(`[ghl-webhook] Auto-fetching opportunity for contact ${contactId}...`);
    const opp = await fetchOpportunityForContact(contactId, apiKey, locationId);
    if (opp) {
      console.log(`[ghl-webhook] Found opportunity ${opp.id} at stage ${opp.pipelineStageId}`);
      await updateClientPipelineFields(supabase, clientDbId, opp.id, opp.pipelineStageId, opp.status, opp.monetaryValue);
    } else {
      console.log(`[ghl-webhook] No opportunity found for contact ${contactId} (may be created later)`);
    }
  }

  // ── Extract UTM attribution data ──
  const utmSource = getCustomField(customFields, ['utm_source', 'utmSource']) || source;
  const utmMedium = getCustomField(customFields, ['utm_medium', 'utmMedium']);
  const utmCampaign = getCustomField(customFields, ['utm_campaign', 'utmCampaign']);
  const utmContent = getCustomField(customFields, ['utm_content', 'utmContent']);
  const utmTerm = getCustomField(customFields, ['utm_term', 'utmTerm']);
  const metaCampaignId = getCustomField(customFields, ['meta_campaign_id', 'fb_campaign_id', 'facebook_campaign_id']);
  const metaAdsetId = getCustomField(customFields, ['meta_adset_id', 'fb_adset_id', 'facebook_adset_id']);
  const metaAdId = getCustomField(customFields, ['meta_ad_id', 'fb_ad_id', 'facebook_ad_id']);
  const landingPage = getCustomField(customFields, ['landing_page', 'landing_page_url', 'page_url', 'full_url']);
  const fbclid = getCustomField(customFields, ['fbclid', 'fb_click_id']);
  const gclid = getCustomField(customFields, ['gclid', 'google_click_id']);
  const deviceType = getCustomField(customFields, ['device', 'device_type']);
  const geoLocation = getCustomField(customFields, ['geo_location', 'location', 'ip_city']);
  const conversionPage = getCustomField(customFields, ['conversion_page', 'form_url', 'conversion_url']);

  const ghlAttrSource = contact.attributionSource || contact.attribution_source
    || getCustomField(customFields, ['attribution_source']) || null;
  const ghlLastAttrSource = contact.lastAttributionSource || contact.last_attribution_source
    || getCustomField(customFields, ['last_attribution_source']) || null;

  const hasAttribution = utmSource || utmMedium || utmCampaign || utmContent || utmTerm
    || metaCampaignId || metaAdsetId || metaAdId || fbclid || gclid || source
    || ghlAttrSource || ghlLastAttrSource;

  if (clientDbId && hasAttribution) {
    const attributionData = {
      client_id: clientDbId,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      meta_campaign_id: metaCampaignId,
      meta_adset_id: metaAdsetId,
      meta_ad_id: metaAdId,
      landing_page_url: landingPage,
      fbclid,
      gclid,
      device_type: deviceType,
      geo_location: geoLocation,
      conversion_page_url: conversionPage,
      ghl_attribution_source: ghlAttrSource,
      ghl_last_attribution_source: ghlLastAttrSource,
      source_type: 'webhook_auto',
      ghl_contact_id: contactId,
      attributed_at: dateAdded,
      enrichment_status: metaCampaignId ? 'pending' : 'not_applicable',
    };

    const { error: attrError } = await supabase
      .from('lead_source_attributions')
      .upsert(attributionData, { onConflict: 'ghl_contact_id' })
      .select();

    if (attrError) {
      console.warn('[ghl-webhook] Upsert failed, trying insert:', attrError.message);
      const { error: insertAttrError } = await supabase
        .from('lead_source_attributions')
        .insert(attributionData);
      if (insertAttrError) {
        console.error('[ghl-webhook] Failed to save attribution:', insertAttrError.message);
      }
    }

    console.log('[ghl-webhook] Saved attribution data for client:', clientDbId);
  }

  return {
    success: true,
    clientId: clientDbId,
    isNewClient,
    hasAttribution: !!hasAttribution,
    status: 200,
  };
}

// ─── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const webhookSecret = Deno.env.get('GHL_WEBHOOK_SECRET');
    // GHL credentials resolved post-supabase init below

    if (!supabaseUrl || !supabaseKey) {
      console.error('[ghl-webhook] Missing Supabase credentials');
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const _ghlCreds = await getEffectiveGhlCredentials(supabase);
    const apiKey = _ghlCreds.apiKey;
    const locationId = _ghlCreds.locationId;
    console.log(`[ghl-webhook] Using GHL account: ${_ghlCreds.label}`);
    const body = await req.json();

    console.log('[ghl-webhook] Received webhook:', JSON.stringify({
      type: body.type,
      contactId: body.contact_id || body.id,
      pipelineStageId: body.pipelineStageId,
      hasCustomFields: !!body.customFields,
    }));

    // FAIL CLOSED: this webhook mutates CRM/pipeline data with the service role.
    // It must refuse to run unless a strong GHL_WEBHOOK_SECRET is configured AND
    // the caller presents it (constant-time compare). The previous check only
    // validated the secret "if configured", so an unset secret let anyone post
    // arbitrary webhook payloads.
    if (!verifyWebhookSecret(webhookSecret, req.headers.get('x-ghl-webhook-secret'))) {
      console.warn('[ghl-webhook] Rejected: missing/invalid webhook secret');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Detect event type ──
    // GHL webhook types: ContactCreate, ContactUpdate, OpportunityCreate,
    // OpportunityStageUpdate, OpportunityStatusUpdate, OpportunityMonetaryValueUpdate, etc.
    const eventType = (body.type || body.event || body.eventType || '').toLowerCase();

    // ── Conversation / Message events ──
    const isMessageEvent = eventType.includes('inboundmessage') || eventType.includes('outboundmessage')
      || eventType.includes('inbound_message') || eventType.includes('outbound_message')
      || (body.conversationId && (body.body || body.message) && !eventType.includes('note'));

    if (isMessageEvent) {
      console.log(`[ghl-webhook] Detected message event: ${eventType}`);
      const result = await handleConversationMessageEvent(supabase, body, eventType);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Conversation unread update events ──
    const isUnreadEvent = eventType.includes('conversationunread') || eventType.includes('conversation_unread');
    if (isUnreadEvent) {
      console.log(`[ghl-webhook] Detected unread update event: ${eventType}`);
      const result = await handleConversationUnreadUpdate(supabase, body);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Note events ──
    const isNoteEvent = eventType.includes('note')
      || (body.type && body.type.toLowerCase().includes('note'));

    if (isNoteEvent) {
      console.log(`[ghl-webhook] Detected note event: ${eventType}`);
      const result = await handleNoteEvent(supabase, body, eventType);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Appointment events ──
    const isAppointmentEvent = eventType.includes('appointment')
      || eventType.includes('calendar')
      || body.appointmentStatus
      || body.calendarId;

    if (isAppointmentEvent) {
      console.log(`[ghl-webhook] Detected appointment event: ${eventType}`);
      const contactId = body.contactId || body.contact_id || body.contact?.id;
      const appointmentTitle = body.title || body.name || 'Appointment';
      const appointmentStatus = body.appointmentStatus || body.status || '';
      const startTime = body.startTime || body.start_time || body.selectedSlot || '';
      const calendarName = body.calendarName || body.calendar_name || '';

      // Determine notification type
      let notificationType = 'appointment_created';
      let notificationTitle = 'New GHL Appointment';
      let notificationMessage = `"${appointmentTitle}" has been scheduled`;

      if (eventType.includes('delete') || eventType.includes('cancel') || appointmentStatus === 'cancelled') {
        notificationType = 'appointment_cancelled';
        notificationTitle = 'Appointment Cancelled';
        notificationMessage = `"${appointmentTitle}" has been cancelled`;
      } else if (eventType.includes('update') || eventType.includes('reschedule')) {
        notificationType = 'appointment_rescheduled';
        notificationTitle = 'Appointment Updated';
        notificationMessage = `"${appointmentTitle}" has been updated`;
      }

      if (startTime) {
        try {
          const dateStr = new Date(startTime).toLocaleString('en-AU', { 
            timeZone: 'Australia/Sydney', 
            dateStyle: 'medium', 
            timeStyle: 'short' 
          });
          notificationMessage += ` — ${dateStr}`;
        } catch (_) { /* ignore date parsing errors */ }
      }

      if (calendarName) {
        notificationMessage += ` (${calendarName})`;
      }

      // Insert notification, targeted to conversations-module viewers.
      await insertTargetedNotification(supabase, {
        moduleKey: 'conversations',
        notification: {
          type: notificationType,
          title: notificationTitle,
          message: notificationMessage,
          entity_id: body.id || null,
        },
      });
      console.log('[ghl-webhook] Appointment notification inserted');

      // Also try to resolve client and log activity
      if (contactId) {
        const { data: client } = await supabase
          .from('clients')
          .select('id, primary_first_name, primary_surname')
          .eq('ghl_contact_id', contactId)
          .maybeSingle();

        if (client) {
          notificationMessage = `"${appointmentTitle}" for ${client.primary_first_name} ${client.primary_surname}`;
          if (startTime) {
            try {
              const dateStr = new Date(startTime).toLocaleString('en-AU', { 
                timeZone: 'Australia/Sydney', 
                dateStyle: 'medium', 
                timeStyle: 'short' 
              });
              notificationMessage += ` — ${dateStr}`;
            } catch (_) {}
          }

          // Update the notification with client context
          await supabase
            .from('notifications')
            .update({ message: notificationMessage, entity_id: client.id })
            .eq('entity_id', body.id || '')
            .order('created_at', { ascending: false })
            .limit(1);
        }
      }

      return new Response(JSON.stringify({ success: true, event: 'appointment', type: notificationType }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Opportunity events ──
    const isOpportunityEvent = eventType.includes('opportunity')
      || body.pipelineStageId
      || body.pipelineId
      || (body.pipeline_stage_id && body.contact);

    if (isOpportunityEvent) {
      console.log(`[ghl-webhook] Detected opportunity event: ${eventType || 'inferred from payload'}`);
      const result = await handleOpportunityEvent(supabase, body);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Default: contact event
    console.log(`[ghl-webhook] Processing as contact event: ${eventType || 'default'}`);
    const result = await handleContactEvent(supabase, body, apiKey || null, locationId || null);
    const httpStatus = result.status || 200;
    delete result.status;

    return new Response(JSON.stringify(result), {
      status: httpStatus,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[ghl-webhook] Error:', error);
    return new Response(JSON.stringify(internalError(error, 'ghl-webhook-receiver')), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
