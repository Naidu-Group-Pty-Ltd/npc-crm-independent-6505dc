import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAuth, createCorsHeaders as createAuthCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { getBrandConfig } from '../_shared/brand-config.ts';
import { internalError } from '../_shared/errorResponse.ts';

const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
const tenantId = Deno.env.get('MICROSOFT_TENANT_ID');
const mailboxEmail = Deno.env.get('MICROSOFT_MAILBOX_EMAIL');

interface SecondaryRecipient {
  /**
   * The finance partner this invitation is for, when it is one.
   *
   * Optional, because the client and an additional contact have no finance
   * contact id — and `appointment_secondary_recipients.finance_contact_id`
   * used to be NOT NULL, so every insert for one of them was refused and the
   * invitation ledger held finance partners alone. That is why a booking's
   * detail window listed no additional contact, and why a reschedule and a
   * cancellation — both of which read this ledger to know whom to tell —
   * reached nobody but the finance partner.
   */
  financeContactId?: string | null;
  /** What this person is to the booking, recorded rather than inferred. */
  role?: 'client' | 'additional_contact' | 'finance_partner';
  name: string;
  email: string;
  /**
   * Set only by the ledger resolution below. A person already recorded as
   * invited must not be filed a second time, or the next cancellation finds
   * them twice and emails them twice. It is per RECIPIENT rather than per
   * batch because a reschedule can carry both: people read back from the
   * ledger and somebody newly added, who does need filing.
   */
  alreadyInvited?: boolean;
}

/**
 * Which notice this is.
 *
 * Audit item 33: a cancellation reached only the client, because the command
 * centre never told anyone else — it set `appointmentStatus: 'cancelled'` on
 * GHL and stopped, and GHL emails the client alone. The additional contact and
 * the finance partner were invited by THIS function and had to be uninvited by
 * it too.
 *
 * Optional, and absent means `booked`. Every existing caller omits it and is
 * byte-for-byte unaffected.
 */
type NotificationKind = 'booked' | 'cancelled' | 'rescheduled';

/**
 * A notice about an EXISTING booking goes to everyone who was invited to it.
 *
 * `booked` is the invitation: the caller's list is the list, and it is written
 * to the ledger. `cancelled` and `rescheduled` are notices about a booking
 * that already has one, so the ledger is the authority and anything the caller
 * passes is ADDED to it rather than replacing it.
 *
 * Replacing it is what a reschedule used to do, and only when the operator
 * happened to re-type somebody: the page skipped the call entirely when the
 * form was empty, so the additional contact and the finance partner from the
 * original booking heard nothing at all.
 */
const NOTICES_ABOUT_AN_EXISTING_BOOKING: ReadonlySet<NotificationKind> =
  new Set(['cancelled', 'rescheduled']);

interface NotificationRequest {
  kind?: NotificationKind;
  appointmentGhlId: string;
  appointmentTitle: string;
  appointmentStart: string; // ISO string
  appointmentEnd: string;   // ISO string
  /**
   * call | zoom | in-person. Optional: a cancellation or reschedule notice is
   * about an appointment that was already booked, and the ledger recorded what
   * kind it was. The callers used to hardcode 'call' and 'reschedule' here,
   * so every such notice announced the wrong thing — a Zoom booking was
   * cancelled as a "Phone Call", and a reschedule printed the raw word
   * "reschedule" because it is not a meeting type at all.
   */
  appointmentType?: string;
  appointmentNotes?: string;
  /**
   * Where the meeting happens — for a Zoom booking this is the join link.
   *
   * Audit item 33: no Zoom link reached any of these people, because this
   * function never carried one. GHL puts it on the appointment's `address`;
   * nothing passed it here, so neither the email nor the .ics had it.
   */
  appointmentLocation?: string;
  calendarName?: string;
  recipients: SecondaryRecipient[];
}

async function getAccessToken(): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId!,
    client_secret: clientSecret!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[Appointment Notification] Token error:', error);
    throw new Error('Failed to get Microsoft access token');
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Generate a standard .ics calendar invite string
 */
function generateICS(params: {
  title: string;
  start: string;
  end: string;
  notes?: string;
  organizer: string;
  attendeeEmail: string;
  attendeeName: string;
  uid: string;
  brandName: string;
  /** Absent or false = the REQUEST this function has always produced. */
  cancelled?: boolean;
  location?: string;
}): string {
  const formatICSDate = (iso: string): string => {
    const d = new Date(iso);
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };

  const escapeICS = (text: string): string => {
    return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  };

  const now = formatICSDate(new Date().toISOString());
  const dtStart = formatICSDate(params.start);
  const dtEnd = formatICSDate(params.end);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${params.brandName}//Command Centre//EN`,
    'CALSCALE:GREGORIAN',
    params.cancelled ? 'METHOD:CANCEL' : 'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${params.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeICS(params.title)}`,
    params.notes ? `DESCRIPTION:${escapeICS(params.notes)}` : '',
    params.location ? `LOCATION:${escapeICS(params.location)}` : '',
    `ORGANIZER;CN=${escapeICS(params.brandName)}:mailto:${params.organizer}`,
    `ATTENDEE;CN=${escapeICS(params.attendeeName)};RSVP=TRUE:mailto:${params.attendeeEmail}`,
    params.cancelled ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    // A cancellation must out-rank the invitation it withdraws, or the calendar
    // client keeps the original. No alarm on a meeting that is not happening.
    params.cancelled ? 'SEQUENCE:1' : 'SEQUENCE:0',
    ...(params.cancelled ? [] : [
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Reminder',
      'END:VALARM',
    ]),
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

/**
 * Build a professional HTML email body for the appointment notification
 */
function buildEmailBody(params: {
  recipientName: string;
  title: string;
  start: string;
  end: string;
  /** Optional: a notice about an existing booking resolves it from the ledger. */
  type?: string;
  notes?: string;
  calendarName?: string;
  brandName: string;
  /** Absent or false = the invitation this function has always sent. */
  cancelled?: boolean;
  location?: string;
}): string {
  const startDate = new Date(params.start);
  const endDate = new Date(params.end);
  
  const dateStr = startDate.toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Australia/Sydney'
  });
  const startTimeStr = startDate.toLocaleTimeString('en-AU', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney'
  });
  const endTimeStr = endDate.toLocaleTimeString('en-AU', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney'
  });

  const typeLabels: Record<string, string> = {
    'call': '📞 Phone Call',
    'zoom': '💻 Zoom Meeting',
    'in-person': '🤝 In-Person Meeting',
  };
  // An unrecognised value is rendered as words rather than as the token
  // itself: "reschedule" reached this line and was printed verbatim.
  const typeLabel = (params.type ? typeLabels[params.type] : undefined)
    || (params.type
      ? params.type.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : 'Meeting');

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1a1a2e; color: #d4a843; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 20px;">${params.cancelled ? '🚫 Meeting Cancelled' : '📅 Meeting Invitation'}</h2>
        <p style="margin: 5px 0 0; opacity: 0.9; font-size: 14px;">${params.brandName} — Command Centre</p>
      </div>
      <div style="background: #ffffff; padding: 24px; border: 1px solid #e0e0e0; border-top: none;">
        <p style="color: #333; font-size: 15px;">Hi ${params.recipientName},</p>
        <p style="color: #555; font-size: 14px;">${params.cancelled
          ? 'The following appointment has been cancelled. You do not need to attend, and no action is required.'
          : 'You have been added as a participant to the following appointment:'}</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e0e0e0; font-weight: bold; color: #333; width: 130px;">Title</td>
            <td style="padding: 10px 12px; border: 1px solid #e0e0e0; color: #333;">${params.title}</td>
          </tr>
          <tr>
            <td style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Date</td>
            <td style="padding: 10px 12px; border: 1px solid #e0e0e0; color: #333;">${dateStr}</td>
          </tr>
          <tr>
            <td style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Time</td>
            <td style="padding: 10px 12px; border: 1px solid #e0e0e0; color: #333;">${startTimeStr} — ${endTimeStr} (AEST)</td>
          </tr>
          <tr>
            <td style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Type</td>
            <td style="padding: 10px 12px; border: 1px solid #e0e0e0; color: #333;">${typeLabel}</td>
          </tr>
          ${params.calendarName ? `
          <tr>
            <td style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Calendar</td>
            <td style="padding: 10px 12px; border: 1px solid #e0e0e0; color: #333;">${params.calendarName}</td>
          </tr>` : ''}
          ${params.location ? `
          <tr>
            <td style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">${/^https?:\/\//i.test(params.location) ? 'Join' : 'Location'}</td>
            <td style="padding: 10px 12px; border: 1px solid #e0e0e0; color: #333;">${/^https?:\/\//i.test(params.location)
              ? `<a href="${params.location}" style="color: #1a1a2e; font-weight: bold;">${params.location}</a>`
              : params.location}</td>
          </tr>` : ''}
          ${params.notes ? `
          <tr>
            <td style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e0e0e0; font-weight: bold; color: #333;">Notes</td>
            <td style="padding: 10px 12px; border: 1px solid #e0e0e0; color: #333;">${params.notes}</td>
          </tr>` : ''}
        </table>

        <p style="color: #888; font-size: 12px; margin-top: 24px; border-top: 1px solid #eee; padding-top: 12px;">
          A calendar invite (.ics) is attached to this email. You can add it directly to your calendar application.
        </p>
      </div>
      <div style="background: #f4f4f4; padding: 12px 20px; border-radius: 0 0 8px 8px; border: 1px solid #e0e0e0; border-top: none;">
        <p style="color: #999; font-size: 11px; margin: 0; text-align: center;">
          This is an automated notification from ${params.brandName} Command Centre.
        </p>
      </div>
    </div>
  `;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createAuthCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    if (!clientId || !clientSecret || !tenantId || !mailboxEmail) {
      throw new Error('Microsoft Graph API credentials not configured');
    }

    const body = await req.json();
    const {
      kind = 'booked',
      appointmentGhlId, appointmentTitle, appointmentStart, appointmentEnd,
      appointmentType, appointmentNotes, appointmentLocation, calendarName, recipients
    }: NotificationRequest = body;
    // Absent means an invitation, which is every caller that existed before
    // cancellations were sent at all.
    const isCancellation = kind === 'cancelled';

    // Auth
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[Appointment Notification] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    // A cancellation names an appointment, not a list. Whoever this function
    // invited is already recorded against the booking, so the caller does not
    // have to remember them — and the client never had them to remember: the
    // cancel path is `updateEvent(id, { appointmentStatus: 'cancelled' })` and
    // holds nothing else. Resolved here so one caller cannot uninvite a
    // different set of people from the set that was invited.
    // What kind of meeting this actually is. A caller announcing a change to
    // an existing booking need not know: the booking recorded it.
    let effectiveType = appointmentType;
    let effectiveRecipients = recipients;
    // Whoever was invited is already recorded against the booking, so a notice
    // about a change to it need not be told again. That applied to
    // cancellations only, and only when the caller passed an empty list —
    // which is why a reschedule made the operator re-add the additional
    // contact and the finance partner by hand every time, and quietly told
    // nobody when they forgot. A notice about an EXISTING booking now always
    // starts from the ledger, whatever the caller passes.
    //
    // Each resolved recipient is stamped `alreadyInvited`, which keeps the
    // ledger honest: a reschedule must not file a second row per person per
    // change, while somebody the operator ADDS to it is genuinely newly
    // invited and is filed like any other invitation.
    const aboutAnExistingBooking = NOTICES_ABOUT_AN_EXISTING_BOOKING.has(kind);
    if (aboutAnExistingBooking || !effectiveRecipients || effectiveRecipients.length === 0) {
      const { data: invited, error: lookupError } = await supabase
        .from('appointment_secondary_recipients')
        .select('finance_contact_id, recipient_role, contact_name, contact_email, appointment_type')
        .eq('appointment_ghl_id', appointmentGhlId);
      if (lookupError) {
        console.error('[Appointment Notification] Could not read invited recipients:', lookupError.message);
      }
      // The booking knows what kind of meeting it is; the canceller does not.
      const recordedType = (invited ?? [])
        .map((r: any) => String(r?.appointment_type ?? '').trim())
        .find((t: string) => t && t !== 'reschedule');
      if (recordedType) effectiveType = recordedType;

      // One notice per person, however many rows they have.
      const seen = new Set<string>();
      effectiveRecipients = (invited ?? [])
        .filter((r: any) => {
          const email = String(r?.contact_email ?? '').trim().toLowerCase();
          if (!email || seen.has(email)) return false;
          seen.add(email);
          return true;
        })
        .map((r: any) => ({
          financeContactId: r.finance_contact_id ?? null,
          role: r.recipient_role ?? undefined,
          name: r.contact_name,
          email: r.contact_email,
          // Already on the ledger, so this notice must not file them again.
          alreadyInvited: true,
        }));

      // Anyone the caller named who is not already on the ledger. Adding a
      // person to a reschedule must not remove everybody else from it — and
      // they ARE newly invited, so they are filed like any other invitation
      // and a later cancellation will reach them.
      if (aboutAnExistingBooking && recipients && recipients.length > 0) {
        for (const extra of recipients) {
          const email = String(extra?.email ?? '').trim().toLowerCase();
          if (!email || seen.has(email)) continue;
          seen.add(email);
          effectiveRecipients.push(extra);
        }
      }
      console.log(`[Appointment Notification] Resolved ${effectiveRecipients.length} recipient(s) for this ${kind} notice`);
    }

    if (!effectiveRecipients || effectiveRecipients.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No recipients to notify' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Appointment Notification] Sending ${kind} to ${effectiveRecipients.length} recipient(s) for: ${appointmentTitle}`);

    const brand = await getBrandConfig();
    const brandName = brand.companyName;
    // Derive a UID domain from the configured contact email (fallback to a stable placeholder)
    const uidDomain = (brand.contactEmail.split('@')[1] || 'command-centre.local').toLowerCase();

    const accessToken = await getAccessToken();
    const results: { email: string; success: boolean; error?: string }[] = [];

    for (const recipient of effectiveRecipients) {
      try {
        // Generate unique .ics for this recipient
        const icsContent = generateICS({
          title: appointmentTitle,
          start: appointmentStart,
          end: appointmentEnd,
          notes: appointmentNotes,
          organizer: mailboxEmail!,
          attendeeEmail: recipient.email,
          attendeeName: recipient.name,
          uid: `${appointmentGhlId}-${recipient.financeContactId}@${uidDomain}`,
          brandName,
          cancelled: isCancellation,
          location: appointmentLocation,
        });

        const icsBase64 = btoa(icsContent);

        const emailBody = buildEmailBody({
          recipientName: recipient.name.split(' ')[0],
          title: appointmentTitle,
          start: appointmentStart,
          end: appointmentEnd,
          type: effectiveType,
          notes: appointmentNotes,
          calendarName,
          brandName,
          cancelled: isCancellation,
          location: appointmentLocation,
        });

        // Send via Microsoft Graph (always admin mailbox)
        const message = {
          message: {
            // A reschedule is not a new invitation. Sending one under
            // "Meeting Invitation" is how a reader takes an unchanged-looking
            // note for a duplicate and ignores the new time in it.
            subject: isCancellation
              ? `Meeting Cancelled: ${appointmentTitle}`
              : kind === 'rescheduled'
                ? `Meeting Rescheduled: ${appointmentTitle}`
                : `Meeting Invitation: ${appointmentTitle}`,
            body: { contentType: 'HTML', content: emailBody },
            toRecipients: [{ emailAddress: { address: recipient.email } }],
            attachments: [{
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: 'invite.ics',
              contentType: `text/calendar; method=${isCancellation ? 'CANCEL' : 'REQUEST'}`,
              contentBytes: icsBase64,
            }],
          },
          saveToSentItems: true,
        };

        const sendUrl = `https://graph.microsoft.com/v1.0/users/${mailboxEmail}/sendMail`;
        const sendResponse = await fetch(sendUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
        });

        if (!sendResponse.ok) {
          const errorText = await sendResponse.text();
          throw new Error(`Graph API ${sendResponse.status}: ${errorText}`);
        }

        // Record success in DB. Not for a cancellation: this table is the record
        // of who was INVITED, and it is what a cancellation reads back to know
        // whom to tell. Writing a row here would make the next cancellation
        // find the same person twice.
        if (!isCancellation && !(recipient as { alreadyInvited?: boolean }).alreadyInvited) await supabase
          .from('appointment_secondary_recipients')
          .insert({
            appointment_ghl_id: appointmentGhlId,
            finance_contact_id: recipient.financeContactId || null,
            recipient_role: recipient.role
              || (recipient.financeContactId ? 'finance_partner' : 'additional_contact'),
            contact_name: recipient.name,
            contact_email: recipient.email,
            notification_sent: true,
            notification_sent_at: new Date().toISOString(),
            appointment_title: appointmentTitle,
            appointment_start: appointmentStart,
            appointment_end: appointmentEnd,
            appointment_type: effectiveType,
            appointment_notes: appointmentNotes || null,
            calendar_name: calendarName || null,
          });

        results.push({ email: recipient.email, success: true });
        console.log(`[Appointment Notification] ✓ Sent to ${recipient.email}`);

      } catch (err: any) {
        console.error(`[Appointment Notification] ✗ Failed for ${recipient.email}:`, err.message);
        
        // Record failure in DB — same reasoning as the success path above.
        if (!isCancellation && !(recipient as { alreadyInvited?: boolean }).alreadyInvited) await supabase
          .from('appointment_secondary_recipients')
          .insert({
            appointment_ghl_id: appointmentGhlId,
            finance_contact_id: recipient.financeContactId || null,
            recipient_role: recipient.role
              || (recipient.financeContactId ? 'finance_partner' : 'additional_contact'),
            contact_name: recipient.name,
            contact_email: recipient.email,
            notification_sent: false,
            notification_error: err.message,
            appointment_title: appointmentTitle,
            appointment_start: appointmentStart,
            appointment_end: appointmentEnd,
            appointment_type: effectiveType,
            appointment_notes: appointmentNotes || null,
            calendar_name: calendarName || null,
          });

        results.push({ email: recipient.email, success: false, error: err.message });
      }
    }

    // Log API usage
    await logApiUsage(supabase, {
      service_name: 'microsoft-graph',
      endpoint: '/v1.0/users/sendMail',
      status: results.every(r => r.success) ? 'success' : 'error',
      model_used: 'graph-api',
      metadata: {
        function: 'send-appointment-notification',
        appointment_id: appointmentGhlId,
        recipients_total: effectiveRecipients.length,
        recipients_success: results.filter(r => r.success).length,
        recipients_failed: results.filter(r => !r.success).length,
      },
    });

    const successCount = results.filter(r => r.success).length;
    return new Response(
      JSON.stringify({
        success: true,
        message: `Sent ${successCount}/${effectiveRecipients.length} notifications`,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Appointment Notification] Error:', error);
    return new Response(
      JSON.stringify(internalError(error, 'send-appointment-notification')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
