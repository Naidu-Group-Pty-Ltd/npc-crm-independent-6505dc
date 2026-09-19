/**
 * CRM, messaging and audience operations — everything that reaches a person.
 *
 * Anything client-facing is worth pairing with an approval gate; the readiness
 * rail flags an unapproved outbound path on a live workflow as a warning rather
 * than blocking it, because there are legitimate reasons to send unattended.
 */

import { DELIVERY_OUTPUTS, f, opt, outs, provider, recordOutputs } from './builders.pure.ts';
import type { CatalogNode } from '../types.pure.ts';

/**
 * Twilio's sending number.
 *
 * Optional on the step because a workspace almost always sends from one number,
 * and typing it into every SMS step is how a typo reaches a client. Blank falls
 * back to `TWILIO_FROM_NUMBER` from the Integrations page — see TWILIO_SENDER.
 */
const TWILIO_FROM = f.text('from', 'From', {
  placeholder: '+61…',
  help: 'Leave blank to use the number saved on the Integrations page.',
});

/** Step override first, integration-wide default second. */
const TWILIO_SENDER = { $first: ['{{from}}', '{{secret.TWILIO_FROM_NUMBER}}'] };

const EMAIL_FIELDS = [
  f.expr('to', 'To', { required: true, placeholder: '{{trigger.email}}' }),
  f.expr('subject', 'Subject', { required: true }),
  f.textarea('html', 'Message', { required: true, help: 'Supports HTML and {{…}} references to earlier steps.' }),
  f.text('replyTo', 'Reply to'),
  f.expr('attachmentUrl', 'Attach a file', { placeholder: '{{report.pdfUrl}}' }),
];

const CONTACT_OUTPUTS = outs('contactId:string:Contact ID', 'email:string', 'created:boolean:Newly created', 'url:string:Record URL');

export const ENGAGEMENT_NODES: CatalogNode[] = [
  // ── CRM ───────────────────────────────────────────────────────────────────
  ...provider({ integrationId: 'gohighlevel', category: 'crm_marketing', docs: 'https://highlevel.stoplight.io/docs/integrations' }, [
    { op: 'upsert_contact', name: 'Add or update a contact', summary: 'Creates the contact, or updates them if the email already exists.', fields: [f.expr('email', 'Email', { required: true }), f.expr('firstName', 'First name'), f.expr('lastName', 'Last name'), f.expr('phone', 'Phone'), f.multi('tags', 'Tags', [opt('investor'), opt('buyer'), opt('seller'), opt('lead'), opt('client')]), f.keyValue('customFields', 'Custom fields')], outputs: CONTACT_OUTPUTS, keywords: ['ghl', 'crm', 'contact', 'lead'] },
    { op: 'create_opportunity', name: 'Create an opportunity', summary: 'Adds a deal to a pipeline stage.', fields: [f.expr('contactId', 'Contact', { required: true }), f.text('pipelineId', 'Pipeline', { required: true }), f.text('stageId', 'Stage', { required: true }), f.expr('name', 'Name', { required: true }), f.number('monetaryValue', 'Value')], outputs: recordOutputs('Opportunity'), keywords: ['deal', 'pipeline', 'opportunity'] },
    { op: 'add_to_workflow', name: 'Start a GoHighLevel workflow', summary: 'Enrols a contact in one of your GHL workflows.', fields: [f.expr('contactId', 'Contact', { required: true }), f.text('workflowId', 'Workflow', { required: true })], outputs: outs('status:string') },
    { op: 'send_sms', name: 'Send an SMS', summary: 'Texts a contact from your GoHighLevel number.', fields: [f.expr('contactId', 'Contact', { required: true }), f.textarea('message', 'Message', { required: true })], outputs: DELIVERY_OUTPUTS },
    { op: 'opportunity_stage_changed', kind: 'trigger', name: 'Opportunity stage changed', summary: 'Runs when a deal moves stage in GoHighLevel.', fields: [f.text('pipelineId', 'Pipeline')], outputs: outs('opportunityId:string:Opportunity ID', 'contactId:string:Contact ID', 'fromStage:string:Previous stage', 'toStage:string:New stage', 'monetaryValue:number:Value') },
  ]),

  ...provider({ integrationId: 'gohighlevel_new', category: 'crm_marketing', docs: 'https://highlevel.stoplight.io/docs/integrations' }, [
    { op: 'upsert_contact', name: 'Add or update a contact', summary: 'Writes to the second GoHighLevel location.', fields: [f.expr('email', 'Email', { required: true }), f.expr('firstName', 'First name'), f.expr('phone', 'Phone')], outputs: CONTACT_OUTPUTS, keywords: ['ghl', 'second location'] },
  ]),

  ...provider({ integrationId: 'hubspot', category: 'crm_marketing', docs: 'https://developers.hubspot.com/docs/api/overview' }, [
    { op: 'upsert_contact', name: 'Add or update a contact', summary: 'Creates or updates a contact by email.', fields: [f.expr('email', 'Email', { required: true }), f.expr('firstname', 'First name'), f.expr('lastname', 'Last name'), f.expr('phone', 'Phone'), f.expr('company', 'Company'), f.keyValue('properties', 'Other properties')], outputs: CONTACT_OUTPUTS },
    { op: 'create_deal', name: 'Create a deal', summary: 'Adds a deal and links it to a contact.', fields: [f.expr('dealname', 'Name', { required: true }), f.number('amount', 'Amount'), f.text('dealstage', 'Stage'), f.expr('contactId', 'Link to contact')], outputs: recordOutputs('Deal') },
    { op: 'log_note', name: 'Log a note', summary: 'Attaches a timeline note to a contact.', fields: [f.expr('contactId', 'Contact', { required: true }), f.textarea('note', 'Note', { required: true })], outputs: outs('noteId:string:Note ID') },
  ]),

  ...provider({ integrationId: 'salesforce', category: 'crm_marketing', docs: 'https://developer.salesforce.com/docs/apis' }, [
    { op: 'create_lead', name: 'Create a lead', summary: 'Adds a lead record.', fields: [f.expr('LastName', 'Last name', { required: true }), f.expr('Company', 'Company', { required: true }), f.expr('Email', 'Email'), f.expr('Phone', 'Phone'), f.text('LeadSource', 'Source')], outputs: recordOutputs('Lead') },
    { op: 'create_opportunity', name: 'Create an opportunity', summary: 'Adds an opportunity with a close date.', fields: [f.expr('Name', 'Name', { required: true }), f.number('Amount', 'Amount'), f.text('StageName', 'Stage', { required: true }), f.text('CloseDate', 'Close date', { required: true, placeholder: 'YYYY-MM-DD' })], outputs: recordOutputs('Opportunity') },
  ]),

  ...provider({ integrationId: 'pipedrive', category: 'crm_marketing', docs: 'https://developers.pipedrive.com/docs/api/v1' }, [
    { op: 'create_person', name: 'Create a person', summary: 'Adds a person to Pipedrive.', fields: [f.expr('name', 'Name', { required: true }), f.expr('email', 'Email'), f.expr('phone', 'Phone')], outputs: recordOutputs('Person') },
    { op: 'create_deal', name: 'Create a deal', summary: 'Adds a deal in a pipeline stage.', fields: [f.expr('title', 'Title', { required: true }), f.number('value', 'Value'), f.text('stage_id', 'Stage'), f.expr('person_id', 'Person')], outputs: recordOutputs('Deal') },
  ]),

  ...provider({ integrationId: 'zoho_crm', category: 'crm_marketing', docs: 'https://www.zoho.com/crm/developer/docs/api/v6/' }, [
    { op: 'create_lead', name: 'Create a lead', summary: 'Adds a lead to Zoho CRM.', fields: [f.expr('Last_Name', 'Last name', { required: true }), f.expr('Email', 'Email'), f.expr('Company', 'Company'), f.expr('Phone', 'Phone')], outputs: recordOutputs('Lead') },
  ]),

  ...provider({ integrationId: 'activecampaign', category: 'crm_marketing', docs: 'https://developers.activecampaign.com/reference' }, [
    { op: 'upsert_contact', name: 'Add or update a contact', summary: 'Syncs a contact by email.', fields: [f.expr('email', 'Email', { required: true }), f.expr('firstName', 'First name'), f.expr('lastName', 'Last name'), f.expr('phone', 'Phone')], outputs: CONTACT_OUTPUTS },
    { op: 'add_to_automation', name: 'Start an automation', summary: 'Enrols a contact in an ActiveCampaign automation.', fields: [f.expr('contactId', 'Contact', { required: true }), f.text('automationId', 'Automation', { required: true })], outputs: outs('status:string') },
  ]),

  ...provider({ integrationId: 'mailchimp', category: 'crm_marketing', docs: 'https://mailchimp.com/developer/marketing/api/' }, [
    { op: 'subscribe', name: 'Add to an audience', summary: 'Subscribes an email address to a list.', fields: [f.text('listId', 'Audience', { required: true }), f.expr('email', 'Email', { required: true }), f.expr('firstName', 'First name'), f.multi('tags', 'Tags', [opt('investor'), opt('newsletter'), opt('client')]), f.select('status', 'Status', [opt('subscribed', 'Subscribed'), opt('pending', 'Pending — send opt-in email')], { defaultValue: 'pending' })], outputs: outs('memberId:string:Member ID', 'status:string') },
  ]),

  ...provider({ integrationId: 'klaviyo', category: 'crm_marketing', docs: 'https://developers.klaviyo.com/en/reference' }, [
    { op: 'track_event', name: 'Record an event', summary: 'Sends a customer event for segmentation and flows.', fields: [f.text('metric', 'Event name', { required: true, placeholder: 'Report Delivered' }), f.expr('email', 'Person', { required: true }), f.keyValue('properties', 'Properties')], outputs: outs('status:string') },
    { op: 'upsert_profile', name: 'Add or update a profile', summary: 'Syncs a Klaviyo profile.', fields: [f.expr('email', 'Email', { required: true }), f.expr('firstName', 'First name'), f.keyValue('properties', 'Properties')], outputs: outs('profileId:string:Profile ID') },
  ]),

  ...provider({ integrationId: 'meta_ads', category: 'crm_marketing', docs: 'https://developers.facebook.com/docs/marketing-apis/' }, [
    { op: 'lead_received', kind: 'trigger', name: 'New lead from a form', summary: 'Runs when someone submits a Meta lead form.', fields: [f.text('formId', 'Form', { placeholder: 'Any form' })], outputs: outs('leadId:string:Lead ID', 'fullName:string:Full name', 'email:string', 'phone:string', 'campaignName:string:Campaign', 'createdAt:string:Created at'), keywords: ['facebook', 'instagram', 'lead form', 'ads'] },
    { op: 'add_to_audience', name: 'Add to a custom audience', summary: 'Adds a hashed email to a Meta custom audience.', fields: [f.text('audienceId', 'Audience', { required: true }), f.expr('email', 'Email', { required: true })], outputs: outs('status:string'), keywords: ['retargeting', 'lookalike'] },
    { op: 'conversion', name: 'Send a conversion', summary: 'Reports an offline conversion back to Meta.', fields: [f.text('eventName', 'Event', { required: true, placeholder: 'Purchase' }), f.expr('email', 'Person', { required: true }), f.number('value', 'Value'), f.text('currency', 'Currency', { defaultValue: 'AUD' })], outputs: outs('eventsReceived:number:Events received'), keywords: ['capi', 'attribution', 'roas'] },
  ]),

  ...provider({ integrationId: 'google_ads', category: 'crm_marketing', docs: 'https://developers.google.com/google-ads/api/docs/start' }, [
    { op: 'upload_conversion', name: 'Upload a conversion', summary: 'Reports an offline conversion against a click.', fields: [f.text('conversionActionId', 'Conversion action', { required: true }), f.expr('gclid', 'Click ID', { required: true }), f.number('value', 'Value'), f.text('currency', 'Currency', { defaultValue: 'AUD' })], outputs: outs('status:string'), keywords: ['offline', 'attribution', 'gclid'] },
    { op: 'add_to_audience', name: 'Add to a customer list', summary: 'Adds a customer to a remarketing list.', fields: [f.text('userListId', 'Customer list', { required: true }), f.expr('email', 'Email', { required: true })], outputs: outs('status:string') },
  ]),

  ...provider({ integrationId: 'linkedin_ads', category: 'crm_marketing', docs: 'https://learn.microsoft.com/en-us/linkedin/marketing/' }, [
    { op: 'lead_received', kind: 'trigger', name: 'New lead from a form', summary: 'Runs when someone submits a LinkedIn lead form.', fields: [], outputs: outs('leadId:string:Lead ID', 'firstName:string:First name', 'lastName:string:Last name', 'email:string', 'company:string', 'jobTitle:string:Job title') },
  ]),

  ...provider({ integrationId: 'tiktok_ads', category: 'crm_marketing', docs: 'https://business-api.tiktok.com/portal/docs' }, [
    { op: 'conversion', name: 'Send a conversion', summary: 'Reports a conversion to TikTok.', fields: [f.text('event', 'Event', { required: true }), f.expr('email', 'Person'), f.number('value', 'Value')], outputs: outs('status:string') },
  ]),

  ...provider({ integrationId: 'manychat', category: 'crm_marketing', docs: 'https://api.manychat.com' }, [
    { op: 'send_flow', name: 'Send a flow', summary: 'Sends a ManyChat flow to a subscriber.', fields: [f.expr('subscriberId', 'Subscriber', { required: true }), f.text('flowNs', 'Flow', { required: true })], outputs: outs('status:string') },
    { op: 'add_tag', name: 'Tag a subscriber', summary: 'Adds a tag to a ManyChat subscriber.', fields: [f.expr('subscriberId', 'Subscriber', { required: true }), f.text('tagName', 'Tag', { required: true })], outputs: outs('status:string') },
  ]),

  // ── Email, SMS and voice ─────────────────────────────────────────────────
  ...provider({ integrationId: 'resend', category: 'communications', docs: 'https://resend.com/docs/api-reference' }, [
    { op: 'send_email', name: 'Send an email', summary: 'Sends an email from your verified domain.', fields: [...EMAIL_FIELDS, f.text('from', 'From', { placeholder: 'NPC Services <hello@example.com>', help: 'Must be an address on a domain verified with Resend.' })], outputs: DELIVERY_OUTPUTS, keywords: ['email', 'send', 'transactional'],
      request: {
        method: 'POST',
        url: 'https://api.resend.com/emails',
        auth: { type: 'bearer', secret: 'RESEND_API_KEY' },
        body: {
          from: { $first: ['{{from}}', '{{secret.RESEND_FROM_EMAIL}}'] },
          // Resend takes an array; a single address is the overwhelming case.
          to: ['{{to}}'],
          subject: '{{subject}}',
          html: '{{html}}',
          reply_to: '{{replyTo}}',
        },
        outputs: { messageId: 'id', status: '$status' },
        errorPath: 'message',
        requires: ['RESEND_API_KEY'],
      } },
    { op: 'email_bounced', kind: 'trigger', name: 'Email bounced', summary: 'Runs when a message hard-bounces or is marked spam.', fields: [], outputs: outs('email:string', 'reason:string', 'type:string', 'bouncedAt:string:Bounced at'), keywords: ['bounce', 'deliverability', 'complaint'] },
  ]),

  ...provider({ integrationId: 'sendgrid', category: 'communications', docs: 'https://www.twilio.com/docs/sendgrid/api-reference' }, [
    { op: 'send_email', name: 'Send an email', summary: 'Sends an email, optionally from a dynamic template.', fields: [...EMAIL_FIELDS, f.text('templateId', 'Template', { help: 'Leave blank to use the message body above.' }), f.keyValue('dynamicData', 'Template data')], outputs: DELIVERY_OUTPUTS },
  ]),

  ...provider({ integrationId: 'postmark', category: 'communications', docs: 'https://postmarkapp.com/developer' }, [
    { op: 'send_email', name: 'Send an email', summary: 'Sends a transactional email through Postmark.', fields: [...EMAIL_FIELDS, f.text('messageStream', 'Stream', { defaultValue: 'outbound' })], outputs: DELIVERY_OUTPUTS },
  ]),

  ...provider({ integrationId: 'mailgun', category: 'communications', docs: 'https://documentation.mailgun.com/en/latest/api_reference.html' }, [
    { op: 'send_email', name: 'Send an email', summary: 'Sends an email through Mailgun.', fields: EMAIL_FIELDS, outputs: DELIVERY_OUTPUTS },
  ]),

  ...provider({ integrationId: 'brevo', category: 'communications', docs: 'https://developers.brevo.com/reference' }, [
    { op: 'send_email', name: 'Send an email', summary: 'Sends an email through Brevo.', fields: EMAIL_FIELDS, outputs: DELIVERY_OUTPUTS },
  ]),

  ...provider({ integrationId: 'microsoft', category: 'communications', docs: 'https://learn.microsoft.com/en-us/graph/api/overview' }, [
    { op: 'send_mail', name: 'Send an email from Outlook', summary: 'Sends from your connected mailbox so it appears in Sent Items.', fields: EMAIL_FIELDS, outputs: DELIVERY_OUTPUTS, keywords: ['outlook', 'graph', 'office', 'mailbox'] },
    { op: 'create_event', name: 'Create a calendar event', summary: 'Books a meeting in the connected Outlook calendar.', fields: [f.expr('subject', 'Title', { required: true }), f.expr('start', 'Starts', { required: true, placeholder: '2026-03-04T10:00:00' }), f.number('durationMinutes', 'Duration (minutes)', { defaultValue: 30 }), f.expr('attendees', 'Attendees', { placeholder: '{{trigger.email}}' }), f.textarea('body', 'Details')], outputs: outs('eventId:string:Event ID', 'webLink:string:Link', 'joinUrl:string:Join URL'), keywords: ['calendar', 'meeting', 'appointment'] },
    { op: 'email_received', kind: 'trigger', name: 'Email received', summary: 'Runs when a message arrives in the connected mailbox.', fields: [f.text('fromContains', 'From contains'), f.text('subjectContains', 'Subject contains')], outputs: outs('messageId:string:Message ID', 'from:string', 'subject:string', 'body:string', 'receivedAt:string:Received at', 'hasAttachments:boolean:Has attachments') },
  ]),

  ...provider({ integrationId: 'twilio', category: 'communications', docs: 'https://www.twilio.com/docs/api' }, [
    { op: 'send_sms', name: 'Send an SMS', summary: 'Texts a number from your Twilio number.', fields: [f.expr('to', 'To', { required: true, placeholder: '{{trigger.phone}}' }), f.textarea('body', 'Message', { required: true, help: 'Over 160 characters is billed as multiple segments.' }), TWILIO_FROM], outputs: DELIVERY_OUTPUTS,
      request: {
        method: 'POST',
        url: 'https://api.twilio.com/2010-04-01/Accounts/{{secret.TWILIO_ACCOUNT_SID}}/Messages.json',
        auth: { type: 'basic', userSecret: 'TWILIO_ACCOUNT_SID', passSecret: 'TWILIO_AUTH_TOKEN' },
        encoding: 'form',
        body: { To: '{{to}}', From: TWILIO_SENDER, Body: '{{body}}' },
        outputs: { messageId: 'sid', status: 'status', sentAt: 'date_created' },
        errorPath: 'message',
        requires: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
      } },
    { op: 'send_whatsapp', name: 'Send a WhatsApp message', summary: 'Sends a WhatsApp message through Twilio.', fields: [f.expr('to', 'To', { required: true }), f.textarea('body', 'Message', { required: true }), TWILIO_FROM], outputs: DELIVERY_OUTPUTS,
      request: {
        method: 'POST',
        url: 'https://api.twilio.com/2010-04-01/Accounts/{{secret.TWILIO_ACCOUNT_SID}}/Messages.json',
        auth: { type: 'basic', userSecret: 'TWILIO_ACCOUNT_SID', passSecret: 'TWILIO_AUTH_TOKEN' },
        encoding: 'form',
        // WhatsApp is the same endpoint with a scheme on both numbers; the
        // executor cannot know that, so the descriptor says it.
        body: { To: 'whatsapp:{{to}}', From: { $first: ['whatsapp:{{from}}', 'whatsapp:{{secret.TWILIO_FROM_NUMBER}}'] }, Body: '{{body}}' },
        outputs: { messageId: 'sid', status: 'status', sentAt: 'date_created' },
        errorPath: 'message',
        requires: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
      } },
    { op: 'make_call', name: 'Place a call', summary: 'Calls a number and plays a message or connects an agent.', fields: [f.expr('to', 'To', { required: true }), f.textarea('say', 'Say', { help: 'Read aloud when the call connects.' }), TWILIO_FROM], outputs: outs('callSid:string:Call ID', 'status:string'),
      request: {
        method: 'POST',
        url: 'https://api.twilio.com/2010-04-01/Accounts/{{secret.TWILIO_ACCOUNT_SID}}/Calls.json',
        auth: { type: 'basic', userSecret: 'TWILIO_ACCOUNT_SID', passSecret: 'TWILIO_AUTH_TOKEN' },
        encoding: 'form',
        // Twilio wants TwiML, not prose. Wrapping it here keeps the field a
        // plain "what should it say" rather than teaching everyone an XML dialect.
        body: { To: '{{to}}', From: TWILIO_SENDER, Twiml: '<Response><Say>{{say}}</Say></Response>' },
        outputs: { callSid: 'sid', status: 'status' },
        errorPath: 'message',
        requires: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
      } },
    { op: 'sms_received', kind: 'trigger', name: 'SMS received', summary: 'Runs when someone texts your Twilio number.', fields: [], outputs: outs('from:string', 'body:string', 'messageSid:string:Message ID', 'receivedAt:string:Received at') },
  ]),

  ...provider({ integrationId: 'vapi', category: 'communications', docs: 'https://docs.vapi.ai' }, [
    { op: 'outbound_call', name: 'Place an AI call', summary: 'Has a voice agent call someone and report back.', fields: [f.expr('phoneNumber', 'To', { required: true }), f.text('assistantId', 'Assistant', { required: true }), f.textarea('context', 'Brief the assistant', { help: 'Background the agent should know, such as the client’s situation.' })], outputs: outs('callId:string:Call ID', 'status:string'), keywords: ['voice', 'ai', 'outbound', 'qualify'] },
  ]),

  ...provider({ integrationId: 'messagemedia', category: 'communications', docs: 'https://developers.sinch.com/docs/messagemedia' }, [
    { op: 'send_sms', name: 'Send an SMS', summary: 'Texts a number through MessageMedia.', fields: [f.expr('to', 'To', { required: true }), f.textarea('content', 'Message', { required: true })], outputs: DELIVERY_OUTPUTS },
  ]),

  ...provider({ integrationId: 'clicksend', category: 'communications', docs: 'https://developers.clicksend.com' }, [
    { op: 'send_sms', name: 'Send an SMS', summary: 'Texts a number through ClickSend.', fields: [f.expr('to', 'To', { required: true }), f.textarea('body', 'Message', { required: true })], outputs: DELIVERY_OUTPUTS },
    { op: 'send_post', name: 'Post a physical letter', summary: 'Prints and mails a PDF to a street address.', fields: [f.expr('pdfUrl', 'Document', { required: true, placeholder: '{{report.pdfUrl}}' }), f.expr('addressName', 'Addressed to', { required: true }), f.expr('addressLine1', 'Street address', { required: true }), f.expr('city', 'Suburb', { required: true }), f.text('state', 'State', { required: true }), f.expr('postcode', 'Postcode', { required: true })], outputs: outs('postId:string:Post ID', 'status:string', 'price:number:Cost'), keywords: ['letter', 'mail', 'print', 'physical', 'direct mail'] },
  ]),

  ...provider({ integrationId: 'whatsapp', category: 'communications', docs: 'https://developers.facebook.com/docs/whatsapp/cloud-api' }, [
    { op: 'send_template', name: 'Send a WhatsApp template', summary: 'Sends an approved template message.', fields: [f.expr('to', 'To', { required: true }), f.text('templateName', 'Template', { required: true }), f.keyValue('variables', 'Variables')], outputs: DELIVERY_OUTPUTS },
  ]),

  ...provider({ integrationId: 'telegram', category: 'communications', docs: 'https://core.telegram.org/bots/api' }, [
    { op: 'send_message', name: 'Send a message', summary: 'Posts a message to a Telegram chat.', fields: [f.expr('chatId', 'Chat', { required: true }), f.textarea('text', 'Message', { required: true })], outputs: DELIVERY_OUTPUTS },
  ]),

  ...provider({ integrationId: 'webpush', category: 'communications', docs: 'https://developer.mozilla.org/en-US/docs/Web/API/Push_API' }, [
    { op: 'send_push', name: 'Send a push notification', summary: 'Pushes a notification to a subscribed browser or device.', fields: [f.expr('userId', 'To', { required: true }), f.expr('title', 'Title', { required: true }), f.expr('body', 'Message'), f.text('url', 'Opens')], outputs: outs('delivered:number:Delivered', 'failed:number:Failed') },
  ]),

  // ── Social and publishing ────────────────────────────────────────────────
  ...provider({ integrationId: 'linkedin', category: 'media', docs: 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/share-api' }, [
    { op: 'share_post', name: 'Publish a post', summary: 'Publishes a post to your LinkedIn page.', fields: [f.textarea('text', 'Post', { required: true }), f.expr('linkUrl', 'Link'), f.expr('imageUrl', 'Image')], outputs: outs('postId:string:Post ID', 'url:string:Post URL') },
  ]),

  ...provider({ integrationId: 'x_twitter', category: 'media', docs: 'https://developer.x.com/en/docs/x-api' }, [
    { op: 'post', name: 'Publish a post', summary: 'Publishes a post to X.', fields: [f.textarea('text', 'Post', { required: true, help: 'Kept to 280 characters unless the account is Premium.' }), f.expr('mediaUrl', 'Image')], outputs: outs('postId:string:Post ID', 'url:string:Post URL') },
  ]),

  ...provider({ integrationId: 'instagram', category: 'media', docs: 'https://developers.facebook.com/docs/instagram-api' }, [
    { op: 'publish_media', name: 'Publish a post', summary: 'Publishes an image or reel to a business account.', fields: [f.expr('imageUrl', 'Image or video', { required: true }), f.textarea('caption', 'Caption')], outputs: outs('mediaId:string:Media ID', 'permalink:string:Link') },
  ]),

  ...provider({ integrationId: 'youtube', category: 'media', docs: 'https://developers.google.com/youtube/v3' }, [
    { op: 'list_videos', name: 'List channel videos', summary: 'Returns recent videos from your channel.', fields: [f.number('maxResults', 'How many', { defaultValue: 10 })], outputs: outs('videos:array:Videos') },
    { op: 'video_published', kind: 'trigger', name: 'Video published', summary: 'Runs when a new video goes live on your channel.', fields: [], outputs: outs('videoId:string:Video ID', 'title:string', 'url:string:Video URL', 'publishedAt:string:Published at') },
  ]),

  ...provider({ integrationId: 'buffer', category: 'media', docs: 'https://buffer.com/developers/api' }, [
    { op: 'schedule_post', name: 'Schedule a post', summary: 'Queues a post across your connected channels.', fields: [f.textarea('text', 'Post', { required: true }), f.multi('profileIds', 'Channels', [opt('linkedin', 'LinkedIn'), opt('facebook', 'Facebook'), opt('instagram', 'Instagram'), opt('x', 'X')], { required: true }), f.text('scheduledAt', 'Send at', { placeholder: 'Next slot in the queue' })], outputs: outs('updateIds:array:Scheduled posts') },
  ]),
];
