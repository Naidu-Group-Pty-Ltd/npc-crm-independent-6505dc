import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';
/**
 * Smart capitalization for names - handles edge cases like:
 * - All uppercase or all lowercase names
 * - Special prefixes: Mc, Mac, O'
 * - Hyphenated names
 * - Already properly capitalized names (left unchanged)
 */
function smartCapitalize(name: string | null | undefined): string {
  if (!name) return '';
  
  // Handle already properly capitalized names
  if (name !== name.toLowerCase() && name !== name.toUpperCase()) {
    return name;
  }
  
  return name
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((part) => {
      // Keep separators as-is
      if (/^(\s+|-|')$/.test(part)) return part;
      
      // Handle special prefixes like Mc, Mac, O'
      if (part.startsWith('mc') && part.length > 2) {
        return 'Mc' + part.charAt(2).toUpperCase() + part.slice(3);
      }
      if (part.startsWith('mac') && part.length > 3) {
        return 'Mac' + part.charAt(3).toUpperCase() + part.slice(4);
      }
      
      // Standard capitalization
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

/**
 * Format a full name from first and last name parts
 */
function formatFullName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const first = smartCapitalize(firstName);
  const last = smartCapitalize(lastName);
  return [first, last].filter(Boolean).join(' ');
}

/**
 * Fetch customer from GHL by phone number
 */
async function fetchCustomerFromGoHighLevel(
  phoneNumber: string,
  ghlApiKey: string,
  ghlLocationId: string
): Promise<{ name: string | null; contactId: string | null; firstName: string | null; lastName: string | null }> {
  if (!phoneNumber) {
    return { name: null, contactId: null, firstName: null, lastName: null };
  }

  try {
    // Clean up phone number - remove everything except digits and +
    const cleanedPhone = phoneNumber.replace(/[^\d+]/g, '');
    
    const searchUrl = `https://services.leadconnectorhq.com/contacts/?locationId=${ghlLocationId}&query=${encodeURIComponent(cleanedPhone)}&limit=10`;
    
    console.log(`[Cleanup] GHL search URL: ${searchUrl.substring(0, 80)}...`);
    
    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ghlApiKey}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
    });

    if (!response.ok) {
      console.log(`[Cleanup] GHL API error: ${response.status} ${response.statusText}`);
      return { name: null, contactId: null, firstName: null, lastName: null };
    }

    const data = await response.json();
    console.log(`[Cleanup] GHL returned ${data.contacts?.length || 0} contacts for phone ${cleanedPhone}`);

    if (data.contacts && data.contacts.length > 0) {
      // Find the contact that matches the phone number
      const matchingContact = data.contacts.find((c: any) => {
        const contactPhone = (c.phone || '').replace(/[^\d+]/g, '');
        return contactPhone === cleanedPhone || contactPhone.endsWith(cleanedPhone.slice(-9));
      }) || data.contacts[0];
      
      console.log(`[Cleanup] GHL matched contact: ${matchingContact.firstName || ''} ${matchingContact.lastName || ''} (${matchingContact.name || 'no name'})`);
      
      return { 
        name: matchingContact.name || null,
        contactId: matchingContact.id || null,
        firstName: matchingContact.firstName || null,
        lastName: matchingContact.lastName || null,
      };
    } else {
      console.log(`[Cleanup] No GHL contacts found for ${cleanedPhone}`);
    }
  } catch (error) {
    console.error('[Cleanup] GHL error:', error);
  }

  return { name: null, contactId: null, firstName: null, lastName: null };
}

/**
 * Fetch customer from GHL by contact ID
 */
async function fetchCustomerFromGoHighLevelById(
  contactId: string,
  ghlApiKey: string
): Promise<{ name: string | null; firstName: string | null; lastName: string | null }> {
  if (!contactId) {
    return { name: null, firstName: null, lastName: null };
  }

  try {
    const response = await meteredFetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ghlApiKey}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
    });

    if (!response.ok) {
      console.log('[Cleanup] GHL API error fetching by ID:', response.status);
      return { name: null, firstName: null, lastName: null };
    }

    const data = await response.json();
    const contact = data.contact || data;
    
    if (contact) {
      return { 
        name: contact.name || null,
        firstName: contact.firstName || null,
        lastName: contact.lastName || null,
      };
    }
  } catch (error) {
    console.error('[Cleanup] GHL error fetching by ID:', error);
  }

  return { name: null, firstName: null, lastName: null };
}

/**
 * Check if a string looks like a phone number (not a real name)
 */
function looksLikePhoneNumber(value: string | null | undefined): boolean {
  if (!value) return false;
  // Remove all spaces and check if it's mostly digits with optional + prefix
  const cleaned = value.replace(/[\s\-\(\)]/g, '');
  return /^\+?\d{7,}$/.test(cleaned);
}

/**
 * Check if a name needs improvement (missing full name, is a phone number, etc.)
 */
function needsNameImprovement(customerName: string | null | undefined, ghlContactId: string | null | undefined): boolean {
  // No name at all
  if (!customerName || customerName.trim() === '') return true;
  
  // Name is actually a phone number
  if (looksLikePhoneNumber(customerName)) return true;
  
  // Missing GHL contact ID (could get better data)
  if (!ghlContactId) return true;
  
  // Single word name (likely only first name)
  const trimmedName = customerName.trim();
  if (!trimmedName.includes(' ') && trimmedName.length < 20) return true;
  
  return false;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Verify authentication and admin role
    const body = await req.json().catch(() => ({}));
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[cleanup-call-log-names] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    
    // Check if user has admin role
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['superadmin', 'admin'])
      .single();

    if (roleError || !roleData) {
      console.warn(`User ${userId} attempted to cleanup call logs without admin role.`);
      return createForbiddenResponse('Forbidden: Admin access required', corsHeaders);
    }
    
    console.log(`[cleanup-call-log-names] Admin user ${userId} starting cleanup`);

    const ghlApiKey = Deno.env.get('GOHIGHLEVEL_API_KEY');
    const ghlLocationId = Deno.env.get('GOHIGHLEVEL_LOCATION_ID');
    
    if (!ghlApiKey || !ghlLocationId) {
      return new Response(
        JSON.stringify({ success: false, error: 'GHL API credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get batch parameters
    const batchSize = body.batchSize || 50;
    const offset = body.offset || 0;
    const forceUpdate = body.forceUpdate || false;

    console.log(`[cleanup-call-log-names] Processing batch: offset=${offset}, size=${batchSize}, forceUpdate=${forceUpdate}`);

    // Fetch ALL call logs and filter in code for more robust logic
    const { data: allCallLogs, error: fetchError } = await supabase
      .from('vapi_call_logs')
      .select('id, phone_number, customer_name, ghl_contact_id')
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('[cleanup-call-log-names] Error fetching call logs:', fetchError);
      return new Response(
        JSON.stringify({ success: false, error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!allCallLogs || allCallLogs.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No call logs found',
          processed: 0,
          updated: 0,
          hasMore: false
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter records that need improvement
    const callLogsNeedingWork = forceUpdate 
      ? allCallLogs 
      : allCallLogs.filter(call => needsNameImprovement(call.customer_name, call.ghl_contact_id));

    const totalNeedingWork = callLogsNeedingWork.length;
    
    // Apply pagination to the filtered list
    const callLogs = callLogsNeedingWork.slice(offset, offset + batchSize);

    console.log(`[cleanup-call-log-names] Total records: ${allCallLogs.length}, Needing work: ${totalNeedingWork}, This batch: ${callLogs.length}`);

    if (callLogs.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No call logs need processing',
          processed: 0,
          updated: 0,
          hasMore: false,
          totalRecords: allCallLogs.length,
          totalNeedingWork: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let updated = 0;
    let skipped = 0;
    const results: Array<{ id: string; status: string; name?: string; reason?: string }> = [];

    // Build a cache of phone -> GHL contact to reduce API calls
    const phoneToContact = new Map<string, { name: string | null; contactId: string | null; firstName: string | null; lastName: string | null }>();

    for (const call of callLogs) {
      try {
        let newName: string | null = null;
        let newGhlContactId: string | null = call.ghl_contact_id;
        let lookupSource = '';

        // Priority 1: If we have GHL contact ID, fetch directly
        if (call.ghl_contact_id) {
          const ghlResult = await fetchCustomerFromGoHighLevelById(call.ghl_contact_id, ghlApiKey);
          if (ghlResult.firstName || ghlResult.lastName) {
            newName = formatFullName(ghlResult.firstName, ghlResult.lastName);
            lookupSource = 'ghl_id';
          } else if (ghlResult.name) {
            newName = smartCapitalize(ghlResult.name);
            lookupSource = 'ghl_id_name';
          }
        }

        // Priority 2: Check if existing customer_name is actually a phone number - use it for lookup
        const existingIsPhoneNumber = looksLikePhoneNumber(call.customer_name);
        const lookupPhone = call.phone_number || (existingIsPhoneNumber ? call.customer_name : null);
        
        if (!newName && lookupPhone) {
          // Normalize the phone number for lookup
          const normalizedPhone = lookupPhone.replace(/[\s\-\(\)]/g, '');
          
          // Check cache first
          const cached = phoneToContact.get(normalizedPhone);
          if (cached) {
            if (cached.firstName || cached.lastName) {
              newName = formatFullName(cached.firstName, cached.lastName);
              lookupSource = 'cache';
            } else if (cached.name) {
              newName = smartCapitalize(cached.name);
              lookupSource = 'cache_name';
            }
            if (cached.contactId && !newGhlContactId) {
              newGhlContactId = cached.contactId;
            }
          } else {
            // Fetch from GHL using the phone number
            console.log(`[cleanup-call-log-names] Looking up phone: ${normalizedPhone}${existingIsPhoneNumber ? ' (extracted from customer_name)' : ''}`);
            const ghlResult = await fetchCustomerFromGoHighLevel(normalizedPhone, ghlApiKey, ghlLocationId);
            // Cache the result
            phoneToContact.set(normalizedPhone, ghlResult);
            
            if (ghlResult.firstName || ghlResult.lastName) {
              newName = formatFullName(ghlResult.firstName, ghlResult.lastName);
              lookupSource = existingIsPhoneNumber ? 'phone_swap' : 'ghl_phone';
            } else if (ghlResult.name) {
              newName = smartCapitalize(ghlResult.name);
              lookupSource = existingIsPhoneNumber ? 'phone_swap_name' : 'ghl_phone_name';
            }
            if (ghlResult.contactId) {
              newGhlContactId = ghlResult.contactId;
            }
          }
        }
        
        // Priority 3: Capitalize existing name if no GHL match but name exists and isn't a phone number
        if (!newName && call.customer_name && !existingIsPhoneNumber) {
          newName = smartCapitalize(call.customer_name);
          lookupSource = 'existing_capitalized';
        }

        // Determine if we should update
        const shouldUpdate = 
          (newName && newName !== call.customer_name) || 
          (newGhlContactId && newGhlContactId !== call.ghl_contact_id) ||
          (existingIsPhoneNumber && !newName); // Clear phone number names

        if (shouldUpdate) {
          const updateData: Record<string, any> = {};
          
          // Only update name if we have a better one, or if current is a phone number
          if (newName && !looksLikePhoneNumber(newName)) {
            updateData.customer_name = newName;
          } else if (existingIsPhoneNumber && !newName) {
            // If current name is phone number and we found nothing better, set to null
            updateData.customer_name = null;
          }
          
          if (newGhlContactId && newGhlContactId !== call.ghl_contact_id) {
            updateData.ghl_contact_id = newGhlContactId;
          }

          if (Object.keys(updateData).length > 0) {
            const { error: updateError } = await supabase
              .from('vapi_call_logs')
              .update(updateData)
              .eq('id', call.id);

            if (updateError) {
              console.error(`[cleanup-call-log-names] Error updating call ${call.id}:`, updateError);
              results.push({ id: call.id, status: 'error', reason: updateError.message });
            } else {
              updated++;
              results.push({ id: call.id, status: 'updated', name: updateData.customer_name || '[cleared]', reason: lookupSource });
              console.log(`[cleanup-call-log-names] Updated call ${call.id}: ${updateData.customer_name || '[cleared]'} (source: ${lookupSource})`);
            }
          } else {
            skipped++;
            results.push({ id: call.id, status: 'skipped', reason: 'no_changes' });
          }
        } else {
          skipped++;
          results.push({ id: call.id, status: 'skipped', reason: 'no_improvement' });
        }

        // Add a small delay to avoid rate limiting GHL API
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`[cleanup-call-log-names] Error processing call ${call.id}:`, error);
        results.push({ id: call.id, status: 'error', reason: String(error) });
      }
    }

    const hasMore = offset + batchSize < totalNeedingWork;
    const nextOffset = hasMore ? offset + batchSize : null;

    console.log(`[cleanup-call-log-names] Batch complete: updated=${updated}, skipped=${skipped}, hasMore=${hasMore}, remaining=${totalNeedingWork - offset - callLogs.length}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Processed ${callLogs.length} call logs`,
        processed: callLogs.length,
        updated,
        skipped,
        hasMore,
        nextOffset,
        totalRecords: allCallLogs.length,
        totalNeedingWork,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[cleanup-call-log-names] Error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'cleanup-call-log-names'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
