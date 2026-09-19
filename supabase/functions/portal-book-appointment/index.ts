import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders } from "../_shared/auth.ts"
import { getBrandConfig } from "../_shared/brand-config.ts"
import { getEffectiveGhlCredentials } from "../_shared/ghl-account.ts"
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

function extractPortalToken(headers: Headers, body?: any): string | null {
  const headerToken = headers.get('x-portal-session-token');
  if (headerToken) return headerToken;
  if (body?.portal_session_token) return body.portal_session_token;
  const sessionHeader = headers.get('x-session-token');
  if (sessionHeader) return sessionHeader;
  if (body?.session_token) return body.session_token;
  return null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const _ghlCreds = await getEffectiveGhlCredentials(supabase);
    const ghlApiKey = _ghlCreds.apiKey;
    const ghlLocationId = _ghlCreds.locationId;
    console.log(`[portal-book-appointment] Using GHL account: ${_ghlCreds.label}`);

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const sessionToken = extractPortalToken(req.headers, body);
    if (!sessionToken) {
      return new Response(JSON.stringify({ error: 'Authentication required', success: false }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Validate portal session
    const { data: session, error: sessionError } = await supabase
      .from('client_portal_sessions')
      .select(`*, client_portal_users:user_id (id, client_id, email, status)`)
      .eq('session_token', sessionToken)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (sessionError || !session?.client_portal_users) {
      return new Response(JSON.stringify({ error: 'Invalid session', success: false }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const portalUser = session.client_portal_users;
    const clientId = portalUser.client_id;

    const { action } = body;

    // ── GET FREE SLOTS ──
    if (action === 'freeSlots') {
      if (!ghlApiKey || !ghlLocationId) {
        return new Response(JSON.stringify({ error: 'GHL not configured', success: false }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { calendarId, startDate, endDate, timezone } = body;
      if (!calendarId || !startDate || !endDate) {
        return new Response(JSON.stringify({ error: 'Missing calendarId, startDate, or endDate', success: false }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // GHL requires startDate/endDate as epoch milliseconds (numbers)
      let startMs: number;
      let endMs: number;
      if (typeof startDate === 'number') {
        startMs = startDate;
        endMs = typeof endDate === 'number' ? endDate : new Date(endDate).getTime();
      } else {
        // Convert date string (yyyy-MM-dd) to epoch ms - start of day and end of day
        const startD = new Date(startDate + 'T00:00:00');
        const endD = new Date(endDate + 'T23:59:59');
        startMs = startD.getTime();
        endMs = endD.getTime();
      }

      const tz = timezone || 'Australia/Sydney';
      const url = `${GHL_API_BASE}/calendars/${calendarId}/free-slots?startDate=${startMs}&endDate=${endMs}&timezone=${encodeURIComponent(tz)}`;
      
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${ghlApiKey}`,
          'Version': '2021-04-15',
          'Content-Type': 'application/json',
        },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[portal-book-appointment] GHL free slots error:', errText);
        return new Response(JSON.stringify({ error: 'Failed to fetch free slots', success: false }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const slotsData = await resp.json();
      return new Response(JSON.stringify({ success: true, slots: slotsData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── GET PORTAL CONFIG ──
    if (action === 'getConfig') {
      const { data: config } = await supabase
        .from('portal_configuration')
        .select('*')
        .limit(1)
        .maybeSingle();

      return new Response(JSON.stringify({ success: true, config }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── BOOK APPOINTMENT ──
    if (action === 'book') {
      if (!ghlApiKey || !ghlLocationId) {
        return new Response(JSON.stringify({ error: 'GHL not configured', success: false }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { calendarId, startTime, endTime, title, notes } = body;
      if (!calendarId || !startTime || !endTime) {
        return new Response(JSON.stringify({ error: 'Missing required booking fields', success: false }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Get client details for GHL contact lookup
      const { data: client } = await supabase
        .from('clients')
        .select('id, primary_first_name, primary_surname, primary_email, primary_mobile, ghl_contact_id')
        .eq('id', clientId)
        .maybeSingle();

      if (!client?.ghl_contact_id) {
        return new Response(JSON.stringify({ error: 'Client does not have a linked GHL contact. Please contact support.', success: false }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Create appointment in GHL - contactId is required
      const appointmentPayload: any = {
        calendarId,
        locationId: ghlLocationId,
        contactId: client.ghl_contact_id,
        startTime,
        endTime,
        title: title || `Portal Booking - ${client?.primary_first_name || ''} ${client?.primary_surname || ''}`.trim(),
        appointmentStatus: 'confirmed',
        notes: notes || `Booked via Client Portal by ${portalUser.email}`,
      };

      console.log('[portal-book-appointment] Creating GHL appointment:', JSON.stringify(appointmentPayload));

      const ghlResp = await fetch(`${GHL_API_BASE}/calendars/events/appointments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ghlApiKey}`,
          'Version': '2021-04-15',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(appointmentPayload),
      });

      const ghlData = await ghlResp.json();

      if (!ghlResp.ok) {
        console.error('[portal-book-appointment] GHL create error:', JSON.stringify(ghlData));
        return new Response(JSON.stringify({ error: 'Failed to create appointment in GHL', details: ghlData, success: false }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      console.log('[portal-book-appointment] GHL appointment created:', ghlData.id || ghlData);

      // Send email notifications
      const { data: portalConfig } = await supabase
        .from('portal_configuration')
        .select('booking_confirmation_email, booking_team_notification_email')
        .limit(1)
        .maybeSingle();

      const startDate = new Date(startTime);
      const formattedDate = startDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' });
      const formattedTime = startDate.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney' });

      // Resolve sender once for both notification + confirmation emails.
      const brand = await getBrandConfig();

      // Send team notification email
      if (portalConfig?.booking_team_notification_email) {
        try {
          const resendKey = Deno.env.get('RESEND_API_KEY');
          if (resendKey) {
            await meteredFetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: brand.fromHeaderNotifications,
                to: portalConfig.booking_team_notification_email,
                subject: `New Portal Booking: ${client?.primary_first_name || ''} ${client?.primary_last_name || ''} - ${formattedDate}`,
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #1a1a1a;">New Client Portal Booking</h2>
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 16px 0;">
                      <p><strong>Client:</strong> ${client?.primary_first_name || ''} ${client?.primary_last_name || ''}</p>
                      <p><strong>Email:</strong> ${portalUser.email}</p>
                      <p><strong>Phone:</strong> ${client?.primary_phone || 'N/A'}</p>
                      <p><strong>Date:</strong> ${formattedDate}</p>
                      <p><strong>Time:</strong> ${formattedTime} (AEST)</p>
                      ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
                    </div>
                    <p style="color: #666; font-size: 12px;">This appointment was booked via the Client Portal and has been automatically created in GoHighLevel.</p>
                  </div>
                `,
              }),
            });
            console.log('[portal-book-appointment] Team notification email sent');
          }
        } catch (emailErr) {
          console.error('[portal-book-appointment] Failed to send team notification:', emailErr);
        }
      }

      // Send client confirmation email
      if (portalConfig?.booking_confirmation_email && portalUser.email) {
        try {
          const resendKey = Deno.env.get('RESEND_API_KEY');
          if (resendKey) {
            await meteredFetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: brand.fromHeaderNotifications,
                to: portalUser.email,
                subject: `Booking Confirmed - ${formattedDate} at ${formattedTime}`,
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #1a1a1a;">Your Appointment is Confirmed</h2>
                    <p>Hi ${client?.primary_first_name || 'there'},</p>
                    <p>Your consultation has been successfully booked.</p>
                    <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; border: 1px solid #bbf7d0; margin: 16px 0;">
                      <p style="margin: 4px 0;"><strong>📅 Date:</strong> ${formattedDate}</p>
                      <p style="margin: 4px 0;"><strong>🕐 Time:</strong> ${formattedTime} (AEST)</p>
                      ${notes ? `<p style="margin: 4px 0;"><strong>📝 Notes:</strong> ${notes}</p>` : ''}
                    </div>
                    <p>If you need to reschedule or cancel, please contact us directly.</p>
                    <p>Best regards,<br/>${brand.companyName}</p>
                  </div>
                `,
              }),
            });
            console.log('[portal-book-appointment] Client confirmation email sent');
          }
        } catch (emailErr) {
          console.error('[portal-book-appointment] Failed to send client confirmation:', emailErr);
        }
      }

      // ── Create portal notification for the client ──
      const apptNotifTitle = 'Appointment Confirmed';
      const apptNotifMessage = `Your appointment on ${formattedDate} at ${formattedTime} (AEST) has been confirmed.`;
      try {
        await supabase.from('client_portal_notifications').insert({
          client_id: clientId,
          title: apptNotifTitle,
          message: apptNotifMessage,
          type: 'success',
          category: 'deal',
          action_url: '/client/appointments',
        });
        console.log('[portal-book-appointment] Portal notification created for client');

        // Send email notification
        const { resolveClientEmailInfo, sendPortalNotificationEmail } = await import('../_shared/portal-notification-email.ts');
        const emailInfo = await resolveClientEmailInfo(supabase, clientId);
        if (emailInfo) {
          await sendPortalNotificationEmail({
            to: emailInfo.email,
            clientFirstName: emailInfo.firstName,
            title: apptNotifTitle,
            message: apptNotifMessage,
            type: 'success',
            category: 'appointment',
            actionUrl: '/client/appointments',
            companyName: emailInfo.companyName,
          });
        }
      } catch (notifErr) {
        console.warn('[portal-book-appointment] Failed to create portal notification:', notifErr);
      }

      return new Response(JSON.stringify({ success: true, appointment: ghlData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── GET CLIENT APPOINTMENTS ──
    if (action === 'getAppointments') {
      if (!ghlApiKey || !ghlLocationId) {
        return new Response(JSON.stringify({ error: 'GHL not configured', success: false }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Get client's GHL contact ID
      const { data: client } = await supabase
        .from('clients')
        .select('ghl_contact_id')
        .eq('id', clientId)
        .maybeSingle();

      if (!client?.ghl_contact_id) {
        return new Response(JSON.stringify({ success: true, appointments: [], message: 'No GHL contact linked' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Fetch appointments from GHL for this contact
      const url = `${GHL_API_BASE}/contacts/${client.ghl_contact_id}/appointments`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${ghlApiKey}`,
          'Version': '2021-04-15',
          'Content-Type': 'application/json',
        },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[portal-book-appointment] GHL get appointments error:', errText);
        return new Response(JSON.stringify({ error: 'Failed to fetch appointments', success: false }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const appointmentsData = await resp.json();
      const events = appointmentsData?.events || appointmentsData?.appointments || [];

      return new Response(JSON.stringify({ success: true, appointments: events }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action', success: false }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('[portal-book-appointment] Error:', err);
    return new Response(JSON.stringify({ ...internalError(err, 'portal-book-appointment'), success: false }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
