/**
 * Documents, compliance, money, internal tooling and infrastructure.
 *
 * The compliance operations return decisions, not raw provider payloads: a
 * screening node emits `outcome` and `riskLevel` so a branch can act on it
 * without anyone having to parse a vendor-specific response shape in a code node.
 */

import { f, opt, outs, provider, recordOutputs } from './builders.pure.ts';
import type { CatalogNode } from '../types.pure.ts';

/** Every identity or screening check resolves to the same decision shape. */
const SCREENING_OUTPUTS = outs(
  'outcome:string:Outcome',
  'riskLevel:string:Risk level',
  'referenceId:string:Reference',
  'matches:array:Matches',
  'checkedAt:string:Checked at',
);

const PERSON_FIELDS = [
  f.expr('firstName', 'First name', { required: true }),
  f.expr('lastName', 'Last name', { required: true }),
  f.expr('dateOfBirth', 'Date of birth', { placeholder: 'YYYY-MM-DD' }),
  f.expr('email', 'Email'),
  f.expr('address', 'Address'),
];

export const OPERATIONS_NODES: CatalogNode[] = [
  // ── Documents ────────────────────────────────────────────────────────────
  ...provider({ integrationId: 'docusign', category: 'documents', docs: 'https://developers.docusign.com/docs/esign-rest-api/' }, [
    { op: 'send_envelope', name: 'Send for signature', summary: 'Sends a document to one or more people to sign.', fields: [f.expr('documentUrl', 'Document', { required: true, placeholder: '{{report.pdfUrl}}' }), f.expr('signerEmail', 'Signer email', { required: true }), f.expr('signerName', 'Signer name', { required: true }), f.expr('subject', 'Email subject', { required: true }), f.textarea('message', 'Email message')], outputs: outs('envelopeId:string:Envelope ID', 'status:string', 'sentAt:string:Sent at'), keywords: ['sign', 'esign', 'agreement', 'contract'] },
    { op: 'envelope_completed', kind: 'trigger', name: 'Document signed', summary: 'Runs when everyone has signed an envelope.', fields: [], outputs: outs('envelopeId:string:Envelope ID', 'signerEmail:string:Signer email', 'completedAt:string:Completed at', 'documentUrl:string:Signed document'), keywords: ['signed', 'executed', 'complete'] },
  ]),

  ...provider({ integrationId: 'pandadoc', category: 'documents', docs: 'https://developers.pandadoc.com/reference/about' }, [
    { op: 'create_from_template', name: 'Create a document', summary: 'Builds a document from a template and sends it.', fields: [f.text('templateId', 'Template', { required: true }), f.expr('recipientEmail', 'Recipient', { required: true }), f.expr('name', 'Document name', { required: true }), f.keyValue('tokens', 'Merge fields')], outputs: recordOutputs('Document') },
  ]),

  ...provider({ integrationId: 'dropbox_sign', category: 'documents', docs: 'https://developers.hellosign.com/api/reference/' }, [
    { op: 'signature_request', name: 'Request a signature', summary: 'Sends a document for signature through Dropbox Sign.', fields: [f.expr('fileUrl', 'Document', { required: true }), f.expr('signerEmail', 'Signer email', { required: true }), f.expr('title', 'Title', { required: true })], outputs: outs('signatureRequestId:string:Request ID', 'status:string') },
  ]),

  ...provider({ integrationId: 'adobe_pdf', category: 'documents', docs: 'https://developer.adobe.com/document-services/docs/apis/' }, [
    { op: 'extract', name: 'Extract from a PDF', summary: 'Pulls text, tables and structure out of a PDF.', fields: [f.expr('fileUrl', 'Document', { required: true }), f.multi('elements', 'Include', [opt('text', 'Text'), opt('tables', 'Tables'), opt('figures', 'Figures')], { defaultValue: 'text' })], outputs: outs('text:string', 'tables:array', 'pageCount:number:Pages') },
    { op: 'compress', name: 'Compress a PDF', summary: 'Reduces a PDF’s file size.', fields: [f.expr('fileUrl', 'Document', { required: true }), f.select('level', 'Compression', [opt('LOW', 'Light'), opt('MEDIUM', 'Balanced'), opt('HIGH', 'Aggressive')], { defaultValue: 'MEDIUM' })], outputs: outs('fileUrl:string:Compressed file', 'sizeBytes:number:Size (bytes)') },
  ]),

  ...provider({ integrationId: 'google_document_ai', category: 'documents', docs: 'https://cloud.google.com/document-ai/docs' }, [
    { op: 'process', name: 'Parse a document', summary: 'Reads a form or statement and returns its fields.', fields: [f.expr('fileUrl', 'Document', { required: true }), f.text('processorId', 'Processor', { help: 'Leave blank to use the default processor.' })], outputs: outs('entities:object:Fields', 'text:string', 'confidence:number'), keywords: ['ocr', 'form', 'payslip', 'statement', 'parse'] },
  ]),

  ...provider({ integrationId: 'cloudconvert', category: 'documents', docs: 'https://cloudconvert.com/api/v2' }, [
    { op: 'convert', name: 'Convert a file', summary: 'Converts a file from one format to another.', fields: [f.expr('fileUrl', 'File', { required: true }), f.select('outputFormat', 'Convert to', [opt('pdf', 'PDF'), opt('docx', 'Word'), opt('xlsx', 'Excel'), opt('png', 'PNG'), opt('jpg', 'JPEG')], { required: true, defaultValue: 'pdf' })], outputs: outs('fileUrl:string:Converted file', 'sizeBytes:number:Size (bytes)') },
  ]),

  ...provider({ integrationId: 'canva', category: 'documents', docs: 'https://www.canva.dev/docs/connect/' }, [
    { op: 'create_design', name: 'Create a design', summary: 'Builds a design from a brand template.', fields: [f.text('templateId', 'Template', { required: true }), f.keyValue('data', 'Merge fields')], outputs: outs('designId:string:Design ID', 'editUrl:string:Edit URL', 'exportUrl:string:Export URL'), keywords: ['brand', 'social', 'flyer', 'design'] },
  ]),

  ...provider({ integrationId: 'gamma', category: 'documents', docs: 'https://gamma.app' }, [
    { op: 'generate_deck', name: 'Generate a deck', summary: 'Turns a brief into a presentation.', fields: [f.textarea('prompt', 'Brief', { required: true, placeholder: 'A investor update for {{trigger.suburb}} covering growth, yield and supply.' }), f.number('cardCount', 'Slides', { defaultValue: 8 })], outputs: outs('deckUrl:string:Deck URL', 'pdfUrl:string:PDF URL'), keywords: ['presentation', 'slides', 'pitch'] },
  ]),

  ...provider({ integrationId: 'api2pdf', category: 'documents', docs: 'https://www.api2pdf.com/documentation/' }, [
    { op: 'html_to_pdf', name: 'Render HTML as a PDF', summary: 'Converts HTML into a PDF file.', fields: [f.textarea('html', 'HTML', { required: true }), f.select('orientation', 'Orientation', [opt('portrait', 'Portrait'), opt('landscape', 'Landscape')], { defaultValue: 'portrait' })], outputs: outs('pdfUrl:string:PDF URL', 'sizeBytes:number:Size (bytes)') },
  ]),

  ...provider({ integrationId: 'weasyprint', category: 'documents', docs: 'https://doc.courtbouillon.org/weasyprint/stable/' }, [
    { op: 'render', name: 'Render a report PDF', summary: 'Renders HTML through the in-house print pipeline.', fields: [f.textarea('html', 'HTML', { required: true }), f.text('templateId', 'Template')], outputs: outs('pdfUrl:string:PDF URL', 'pageCount:number:Pages'), keywords: ['print', 'report', 'internal'] },
  ]),

  ...provider({ integrationId: 'pdf_parse', category: 'documents', docs: 'https://github.com/modesty/pdf2json' }, [
    { op: 'extract', name: 'Extract PDF text', summary: 'Extracts text and layout through the in-house parser.', fields: [f.expr('fileUrl', 'Document', { required: true })], outputs: outs('text:string', 'pageCount:number:Pages', 'chunks:array') },
  ]),

  ...provider({ integrationId: 'render_source', category: 'documents', docs: 'https://render.com/docs' }, [
    { op: 'render', name: 'Render a source document', summary: 'Renders a source document through the in-house service.', fields: [f.expr('sourceId', 'Source', { required: true })], outputs: outs('renderUrl:string:Render URL', 'status:string') },
  ]),

  // ── Identity and compliance ──────────────────────────────────────────────
  ...provider({ integrationId: 'npc_aml_verification', category: 'compliance', docs: 'https://github.com/Naidu-Group-Pty-Ltd/npc-property-dashbord/blob/main/services/aml-verification-service/README.md' }, [
    {
      op: 'verify',
      name: 'Verify an identity document',
      summary: 'Reads the document’s MRZ, matches the selfie against the photo, and returns a decision.',
      fields: [
        f.expr('caseId', 'Case', { required: true }),
        f.expr('subjectLabel', 'Subject', { required: true }),
        f.expr('documentImage', 'Document image', { required: true, help: 'Base64. The MRZ is read from this.' }),
        f.expr('selfieImage', 'Selfie image', { help: 'Base64. Required for anything but a document-only check.' }),
        f.select('method', 'Check', [
          opt('document_and_liveness', 'Document, face match and liveness'),
          opt('document_only', 'Document only'),
        ], { defaultValue: 'document_and_liveness' }),
      ],
      outputs: SCREENING_OUTPUTS,
      keywords: ['kyc', 'idv', 'identity', 'liveness', 'face match', 'mrz', 'self-hosted'],
    },
  ]),

  ...provider({ integrationId: 'frankieone', category: 'compliance', docs: 'https://apidocs.frankiefinancial.com' }, [
    { op: 'kyc_check', name: 'Verify a person', summary: 'Runs a KYC check and returns a pass, fail or refer decision.', fields: PERSON_FIELDS, outputs: SCREENING_OUTPUTS, keywords: ['kyc', 'identity', 'onboarding', 'aml'] },
  ]),

  ...provider({ integrationId: 'greenid', category: 'compliance', docs: 'https://greenid.gbgplc.com' }, [
    { op: 'verify', name: 'Verify an Australian identity', summary: 'Checks a person against Australian identity sources.', fields: PERSON_FIELDS, outputs: SCREENING_OUTPUTS, keywords: ['australia', 'identity', 'dvs', 'kyc'] },
  ]),

  ...provider({ integrationId: 'trulioo', category: 'compliance', docs: 'https://developer.trulioo.com' }, [
    { op: 'verify', name: 'Verify an identity', summary: 'Checks a person against global identity sources.', fields: [...PERSON_FIELDS, f.text('countryCode', 'Country', { defaultValue: 'AU' })], outputs: SCREENING_OUTPUTS },
  ]),

  ...provider({ integrationId: 'sumsub', category: 'compliance', docs: 'https://docs.sumsub.com/reference' }, [
    { op: 'create_applicant', name: 'Start a verification', summary: 'Creates an applicant and returns a link for them to complete it.', fields: [...PERSON_FIELDS, f.text('levelName', 'Verification level', { defaultValue: 'basic-kyc-level' })], outputs: outs('applicantId:string:Applicant ID', 'verificationUrl:string:Verification link', 'status:string') },
    { op: 'applicant_reviewed', kind: 'trigger', name: 'Verification reviewed', summary: 'Runs when a verification is approved or rejected.', fields: [], outputs: SCREENING_OUTPUTS },
  ]),

  ...provider({ integrationId: 'onfido', category: 'compliance', docs: 'https://documentation.onfido.com' }, [
    { op: 'document_check', name: 'Check an ID document', summary: 'Verifies a photo ID and returns the result.', fields: [f.expr('applicantId', 'Applicant', { required: true }), f.expr('documentUrl', 'Document', { required: true })], outputs: SCREENING_OUTPUTS },
  ]),

  ...provider({ integrationId: 'comply_advantage', category: 'compliance', docs: 'https://docs.complyadvantage.com' }, [
    { op: 'screen', name: 'Screen for PEP and sanctions', summary: 'Checks a person against sanctions, PEP and adverse media lists.', fields: [f.expr('name', 'Full name', { required: true }), f.expr('dateOfBirth', 'Date of birth'), f.multi('lists', 'Screen against', [opt('sanction', 'Sanctions'), opt('pep', 'Politically exposed persons'), opt('adverse-media', 'Adverse media'), opt('warning', 'Warnings')], { defaultValue: 'sanction' }), f.number('fuzziness', 'Match tolerance', { defaultValue: 0.6, help: '0 is exact, 1 is loose. Higher catches more but returns more false positives.' })], outputs: SCREENING_OUTPUTS, keywords: ['pep', 'sanctions', 'aml', 'screening', 'adverse media'] },
  ]),

  ...provider({ integrationId: 'equifax', category: 'compliance', docs: 'https://developer.equifax.com' }, [
    { op: 'credit_report', name: 'Get a credit report', summary: 'Pulls a consumer credit file and score.', fields: PERSON_FIELDS, outputs: outs('score:number:Credit score', 'band:string:Score band', 'enquiries:number:Recent enquiries', 'defaults:number:Defaults', 'reportId:string:Report ID'), keywords: ['credit', 'score', 'lending'] },
  ]),

  ...provider({ integrationId: 'illion', category: 'compliance', docs: 'https://bankstatements.com.au/about/api' }, [
    { op: 'bank_statements', name: 'Retrieve bank statements', summary: 'Collects categorised bank transactions for a borrower.', fields: [f.expr('clientReference', 'Client reference', { required: true }), f.number('months', 'Months of history', { defaultValue: 3 })], outputs: outs('accounts:array:Accounts', 'income:number:Assessed income', 'expenses:number:Assessed expenses', 'reportUrl:string:Report URL'), keywords: ['bank', 'statements', 'serviceability', 'expenses'] },
  ]),

  ...provider({ integrationId: 'basiq', category: 'compliance', docs: 'https://api.basiq.io/reference' }, [
    { op: 'get_affordability', name: 'Assess affordability', summary: 'Returns income and expense figures from linked bank data.', fields: [f.expr('userId', 'Basiq user', { required: true })], outputs: outs('monthlyIncome:number:Monthly income', 'monthlyExpenses:number:Monthly expenses', 'surplus:number:Monthly surplus', 'accounts:array:Accounts') },
  ]),

  // ── Payments and finance ─────────────────────────────────────────────────
  ...provider({ integrationId: 'stripe', category: 'payments', docs: 'https://docs.stripe.com/api' }, [
    { op: 'create_customer', name: 'Create a customer', summary: 'Adds a customer record in Stripe.', fields: [f.expr('email', 'Email', { required: true }), f.expr('name', 'Name'), f.keyValue('metadata', 'Metadata')], outputs: outs('customerId:string:Customer ID', 'email:string') },
    { op: 'create_invoice', name: 'Create and send an invoice', summary: 'Bills a customer and emails them the invoice.', fields: [f.expr('customerId', 'Customer', { required: true }), f.expr('description', 'Description', { required: true }), f.number('amount', 'Amount', { required: true, help: 'In dollars. Converted to cents when sent.' }), f.text('currency', 'Currency', { defaultValue: 'aud' }), f.number('daysUntilDue', 'Due in (days)', { defaultValue: 7 })], outputs: outs('invoiceId:string:Invoice ID', 'hostedInvoiceUrl:string:Invoice link', 'status:string', 'amountDue:number:Amount due') },
    { op: 'payment_succeeded', kind: 'trigger', name: 'Payment succeeded', summary: 'Runs when a payment completes.', fields: [f.number('minimumAmount', 'Only above')], outputs: outs('paymentIntentId:string:Payment ID', 'customerId:string:Customer ID', 'amount:number', 'currency:string', 'email:string', 'paidAt:string:Paid at') },
    { op: 'payment_failed', kind: 'trigger', name: 'Payment failed', summary: 'Runs when a payment or subscription charge fails.', fields: [], outputs: outs('customerId:string:Customer ID', 'email:string', 'amount:number', 'failureMessage:string:Reason', 'attemptCount:number:Attempt') , keywords: ['dunning', 'failed', 'churn'] },
    { op: 'subscription_changed', kind: 'trigger', name: 'Subscription changed', summary: 'Runs when a subscription starts, changes plan or cancels.', fields: [], outputs: outs('subscriptionId:string:Subscription ID', 'customerId:string:Customer ID', 'status:string', 'planId:string:Plan', 'cancelAtPeriodEnd:boolean:Cancelling') },
  ]),

  ...provider({ integrationId: 'paddle', category: 'payments', docs: 'https://developer.paddle.com/api-reference/overview' }, [
    { op: 'transaction_completed', kind: 'trigger', name: 'Transaction completed', summary: 'Runs when a Paddle transaction completes.', fields: [], outputs: outs('transactionId:string:Transaction ID', 'customerId:string:Customer ID', 'amount:number', 'currency:string', 'email:string') },
  ]),

  ...provider({ integrationId: 'xero', category: 'payments', docs: 'https://developer.xero.com/documentation/api/accounting/overview' }, [
    { op: 'create_invoice', name: 'Create an invoice', summary: 'Raises a sales invoice in Xero.', fields: [f.expr('contactName', 'Contact', { required: true }), f.expr('description', 'Description', { required: true }), f.number('unitAmount', 'Amount', { required: true }), f.text('accountCode', 'Account code', { defaultValue: '200' }), f.text('dueDate', 'Due date', { placeholder: 'YYYY-MM-DD' })], outputs: outs('invoiceId:string:Invoice ID', 'invoiceNumber:string:Invoice number', 'status:string', 'total:number') },
    { op: 'create_contact', name: 'Create a contact', summary: 'Adds a contact to Xero.', fields: [f.expr('name', 'Name', { required: true }), f.expr('email', 'Email'), f.expr('phone', 'Phone')], outputs: outs('contactId:string:Contact ID') },
    { op: 'invoice_paid', kind: 'trigger', name: 'Invoice paid', summary: 'Runs when a Xero invoice is marked paid.', fields: [], outputs: outs('invoiceId:string:Invoice ID', 'invoiceNumber:string:Invoice number', 'contactName:string:Contact', 'total:number', 'paidAt:string:Paid at') },
  ]),

  ...provider({ integrationId: 'myob', category: 'payments', docs: 'https://developer.myob.com' }, [
    { op: 'create_invoice', name: 'Create an invoice', summary: 'Raises a sales invoice in MYOB.', fields: [f.expr('customerName', 'Customer', { required: true }), f.expr('description', 'Description', { required: true }), f.number('amount', 'Amount', { required: true })], outputs: outs('invoiceId:string:Invoice ID', 'number:string:Invoice number') },
  ]),

  ...provider({ integrationId: 'chargebee', category: 'payments', docs: 'https://apidocs.chargebee.com' }, [
    { op: 'create_subscription', name: 'Create a subscription', summary: 'Starts a subscription for a customer.', fields: [f.expr('customerId', 'Customer', { required: true }), f.text('planId', 'Plan', { required: true })], outputs: outs('subscriptionId:string:Subscription ID', 'status:string', 'nextBillingAt:string:Next billing') },
  ]),

  ...provider({ integrationId: 'wise', category: 'payments', docs: 'https://docs.wise.com/api-docs' }, [
    { op: 'create_quote', name: 'Get a transfer quote', summary: 'Returns the rate and fee for an international transfer.', fields: [f.text('sourceCurrency', 'From', { required: true, defaultValue: 'AUD' }), f.text('targetCurrency', 'To', { required: true }), f.number('amount', 'Amount', { required: true })], outputs: outs('quoteId:string:Quote ID', 'rate:number:Exchange rate', 'fee:number', 'targetAmount:number:They receive') },
  ]),

  // ── Team tools ───────────────────────────────────────────────────────────
  ...provider({ integrationId: 'slack', category: 'productivity', docs: 'https://api.slack.com/methods' }, [
    { op: 'post_message', name: 'Post a message', summary: 'Posts to a Slack channel.', fields: [f.text('channel', 'Channel', { placeholder: '#deals', help: 'Leave blank to use the default channel from the Integrations page.' }), f.textarea('text', 'Message', { required: true }), f.text('threadTs', 'Reply in thread', { help: 'Leave blank to start a new message.' })], outputs: outs('ts:string:Message ID', 'channel:string', 'permalink:string:Link'),
      request: {
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        auth: { type: 'bearer', secret: 'SLACK_BOT_TOKEN' },
        body: { channel: { $first: ['{{channel}}', '{{secret.SLACK_DEFAULT_CHANNEL}}'] }, text: '{{text}}', thread_ts: '{{threadTs}}' },
        outputs: { ts: 'ts', channel: 'channel' },
        // Slack answers 200 for a rejected post and puts the reason in the body.
        // Without these two paths a message that never appeared records as sent.
        okPath: 'ok',
        errorPath: 'error',
        requires: ['SLACK_BOT_TOKEN'],
      } },
    { op: 'upload_file', name: 'Upload a file', summary: 'Shares a file in a Slack channel.', fields: [f.text('channel', 'Channel', { required: true }), f.expr('fileUrl', 'File', { required: true }), f.expr('title', 'Title')], outputs: outs('fileId:string:File ID', 'permalink:string:Link') },
    { op: 'message_posted', kind: 'trigger', name: 'Message posted', summary: 'Runs when someone posts in a channel.', fields: [f.text('channel', 'Channel', { required: true }), f.text('contains', 'Containing')], outputs: outs('text:string', 'user:string', 'channel:string', 'ts:string:Message ID') },
  ]),

  ...provider({ integrationId: 'microsoft_teams', category: 'productivity', docs: 'https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/' }, [
    { op: 'post_message', name: 'Post a message', summary: 'Posts a card to a Teams channel.', fields: [f.expr('title', 'Title', { required: true }), f.textarea('text', 'Message', { required: true })], outputs: outs('status:string') },
  ]),

  ...provider({ integrationId: 'notion', category: 'productivity', docs: 'https://developers.notion.com/reference' }, [
    { op: 'create_page', name: 'Create a page', summary: 'Adds a page to a Notion database.', fields: [f.text('databaseId', 'Database', { required: true }), f.expr('title', 'Title', { required: true }), f.keyValue('properties', 'Properties'), f.textarea('content', 'Body')], outputs: recordOutputs('Page') },
    { op: 'query_database', name: 'Find pages', summary: 'Returns pages from a Notion database.', fields: [f.text('databaseId', 'Database', { required: true }), f.json('filter', 'Filter'), f.number('pageSize', 'How many', { defaultValue: 25 })], outputs: outs('pages:array:Pages', 'count:number') },
  ]),

  ...provider({ integrationId: 'linear', category: 'productivity', docs: 'https://developers.linear.app/docs' }, [
    { op: 'create_issue', name: 'Create an issue', summary: 'Files an issue in Linear.', fields: [f.text('teamId', 'Team', { required: true }), f.expr('title', 'Title', { required: true }), f.textarea('description', 'Description'), f.select('priority', 'Priority', [opt('0', 'None'), opt('1', 'Urgent'), opt('2', 'High'), opt('3', 'Medium'), opt('4', 'Low')], { defaultValue: '3' })], outputs: recordOutputs('Issue') },
  ]),

  ...provider({ integrationId: 'jira', category: 'productivity', docs: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/' }, [
    { op: 'create_issue', name: 'Create an issue', summary: 'Files an issue in a Jira project.', fields: [f.text('projectKey', 'Project', { required: true }), f.expr('summary', 'Summary', { required: true }), f.textarea('description', 'Description'), f.select('issueType', 'Type', [opt('Task'), opt('Bug'), opt('Story')], { defaultValue: 'Task' })], outputs: recordOutputs('Issue') },
  ]),

  ...provider({ integrationId: 'asana', category: 'productivity', docs: 'https://developers.asana.com/reference' }, [
    { op: 'create_task', name: 'Create a task', summary: 'Adds a task to an Asana project.', fields: [f.text('projectId', 'Project', { required: true }), f.expr('name', 'Name', { required: true }), f.textarea('notes', 'Notes'), f.text('dueOn', 'Due', { placeholder: 'YYYY-MM-DD' })], outputs: recordOutputs('Task') },
  ]),

  ...provider({ integrationId: 'monday', category: 'productivity', docs: 'https://developer.monday.com/api-reference/docs' }, [
    { op: 'create_item', name: 'Create an item', summary: 'Adds an item to a monday.com board.', fields: [f.text('boardId', 'Board', { required: true }), f.expr('itemName', 'Name', { required: true }), f.keyValue('columnValues', 'Column values')], outputs: recordOutputs('Item') },
  ]),

  ...provider({ integrationId: 'clickup', category: 'productivity', docs: 'https://developer.clickup.com/reference' }, [
    { op: 'create_task', name: 'Create a task', summary: 'Adds a task to a ClickUp list.', fields: [f.text('listId', 'List', { required: true }), f.expr('name', 'Name', { required: true }), f.textarea('description', 'Description')], outputs: recordOutputs('Task') },
  ]),

  ...provider({ integrationId: 'calendly', category: 'productivity', docs: 'https://developer.calendly.com/api-docs' }, [
    { op: 'invitee_created', kind: 'trigger', name: 'Meeting booked', summary: 'Runs when someone books a time with you.', fields: [], outputs: outs('eventId:string:Event ID', 'inviteeName:string:Name', 'inviteeEmail:string:Email', 'startTime:string:Starts', 'eventType:string:Meeting type', 'joinUrl:string:Join URL'), keywords: ['booking', 'appointment', 'discovery call'] },
    { op: 'invitee_cancelled', kind: 'trigger', name: 'Meeting cancelled', summary: 'Runs when a booking is cancelled.', fields: [], outputs: outs('eventId:string:Event ID', 'inviteeEmail:string:Email', 'reason:string', 'cancelledAt:string:Cancelled at') },
  ]),

  ...provider({ integrationId: 'google_calendar', category: 'productivity', docs: 'https://developers.google.com/calendar/api/v3/reference' }, [
    { op: 'create_event', name: 'Create an event', summary: 'Books an event in a Google calendar.', fields: [f.expr('summary', 'Title', { required: true }), f.expr('start', 'Starts', { required: true }), f.number('durationMinutes', 'Duration (minutes)', { defaultValue: 30 }), f.expr('attendees', 'Attendees'), f.textarea('description', 'Details')], outputs: outs('eventId:string:Event ID', 'htmlLink:string:Link', 'hangoutLink:string:Meet link') },
  ]),

  ...provider({ integrationId: 'zoom', category: 'productivity', docs: 'https://developers.zoom.us/docs/api/' }, [
    { op: 'create_meeting', name: 'Create a meeting', summary: 'Schedules a Zoom meeting and returns the join link.', fields: [f.expr('topic', 'Topic', { required: true }), f.expr('startTime', 'Starts', { required: true }), f.number('duration', 'Duration (minutes)', { defaultValue: 30 })], outputs: outs('meetingId:string:Meeting ID', 'joinUrl:string:Join URL', 'startUrl:string:Host URL', 'password:string:Passcode') },
  ]),

  ...provider({ integrationId: 'fireflies', category: 'productivity', docs: 'https://docs.fireflies.ai' }, [
    { op: 'transcript_ready', kind: 'trigger', name: 'Meeting transcript ready', summary: 'Runs when Fireflies finishes transcribing a meeting.', fields: [], outputs: outs('transcriptId:string:Transcript ID', 'title:string', 'transcript:string', 'summary:string', 'actionItems:array:Action items', 'attendees:array'), keywords: ['meeting', 'notes', 'recap'] },
  ]),

  // ── Storage ──────────────────────────────────────────────────────────────
  ...provider({ integrationId: 'aws_s3', category: 'storage', docs: 'https://docs.aws.amazon.com/AmazonS3/latest/API/' }, [
    { op: 'upload', name: 'Upload a file', summary: 'Stores a file in an S3 bucket.', fields: [f.expr('fileUrl', 'File', { required: true }), f.expr('key', 'Path in bucket', { required: true, placeholder: 'reports/{{trigger.reportId}}.pdf' }), f.select('acl', 'Visibility', [opt('private', 'Private'), opt('public-read', 'Public')], { defaultValue: 'private' })], outputs: outs('key:string:Path', 'url:string:URL', 'etag:string') },
    { op: 'presign', name: 'Create a download link', summary: 'Returns a temporary link to a stored file.', fields: [f.expr('key', 'Path in bucket', { required: true }), f.number('expiresInMinutes', 'Expires in (minutes)', { defaultValue: 60 })], outputs: outs('url:string:Download link', 'expiresAt:string:Expires at') },
  ]),

  ...provider({ integrationId: 'cloudflare_r2', category: 'storage', docs: 'https://developers.cloudflare.com/r2/api/' }, [
    { op: 'upload', name: 'Upload a file', summary: 'Stores a file in an R2 bucket.', fields: [f.expr('fileUrl', 'File', { required: true }), f.expr('key', 'Path in bucket', { required: true })], outputs: outs('key:string:Path', 'url:string:URL') },
  ]),

  ...provider({ integrationId: 'google_drive', category: 'storage', docs: 'https://developers.google.com/drive/api/reference/rest/v3' }, [
    { op: 'upload', name: 'Upload a file', summary: 'Saves a file to a Drive folder.', fields: [f.expr('fileUrl', 'File', { required: true }), f.expr('name', 'File name', { required: true }), f.text('folderId', 'Folder')], outputs: outs('fileId:string:File ID', 'webViewLink:string:Link') },
    { op: 'share', name: 'Share a file', summary: 'Grants someone access to a Drive file.', fields: [f.expr('fileId', 'File', { required: true }), f.expr('email', 'Share with', { required: true }), f.select('role', 'Access', [opt('reader', 'Can view'), opt('commenter', 'Can comment'), opt('writer', 'Can edit')], { defaultValue: 'reader' })], outputs: outs('permissionId:string:Permission ID') },
  ]),

  ...provider({ integrationId: 'dropbox', category: 'storage', docs: 'https://www.dropbox.com/developers/documentation/http/documentation' }, [
    { op: 'upload', name: 'Upload a file', summary: 'Saves a file to Dropbox.', fields: [f.expr('fileUrl', 'File', { required: true }), f.expr('path', 'Path', { required: true, placeholder: '/Reports/{{trigger.reportId}}.pdf' })], outputs: outs('id:string:File ID', 'sharedLink:string:Shared link') },
  ]),

  ...provider({ integrationId: 'onedrive', category: 'storage', docs: 'https://learn.microsoft.com/en-us/onedrive/developer/rest-api/' }, [
    { op: 'upload', name: 'Upload a file', summary: 'Saves a file to OneDrive.', fields: [f.expr('fileUrl', 'File', { required: true }), f.expr('path', 'Path', { required: true })], outputs: outs('id:string:File ID', 'webUrl:string:Link') },
  ]),

  ...provider({ integrationId: 'cloudinary', category: 'storage', docs: 'https://cloudinary.com/documentation/image_upload_api_reference' }, [
    { op: 'upload', name: 'Upload an image', summary: 'Stores an image and returns a delivery URL.', fields: [f.expr('fileUrl', 'Image', { required: true }), f.text('folder', 'Folder'), f.text('publicId', 'Public ID')], outputs: outs('secureUrl:string:Image URL', 'publicId:string:Public ID', 'width:number', 'height:number') },
    { op: 'transform', name: 'Transform an image', summary: 'Resizes or crops a stored image on the fly.', fields: [f.expr('publicId', 'Image', { required: true }), f.number('width', 'Width'), f.number('height', 'Height'), f.select('crop', 'Fit', [opt('fill', 'Fill'), opt('fit', 'Fit inside'), opt('thumb', 'Thumbnail')], { defaultValue: 'fill' })], outputs: outs('url:string:Image URL') },
  ]),

  // ── Automation and scraping ──────────────────────────────────────────────
  ...provider({ integrationId: 'firecrawl', category: 'automation', docs: 'https://docs.firecrawl.dev' }, [
    { op: 'scrape', name: 'Read a web page', summary: 'Fetches a page and returns it as clean markdown.', fields: [f.expr('url', 'URL', { required: true }), f.bool('onlyMainContent', 'Skip navigation and footers', { defaultValue: true })], outputs: outs('markdown:string', 'title:string', 'links:array'), keywords: ['scrape', 'crawl', 'extract', 'research'] },
    { op: 'crawl', name: 'Crawl a site', summary: 'Follows links from a starting page and returns each page’s content.', fields: [f.expr('url', 'Starting URL', { required: true }), f.number('limit', 'Maximum pages', { defaultValue: 25 })], outputs: outs('pages:array:Pages', 'count:number') },
  ]),

  ...provider({ integrationId: 'apify', category: 'automation', docs: 'https://docs.apify.com/api/v2' }, [
    { op: 'run_actor', name: 'Run a scraper', summary: 'Runs an Apify actor and waits for its dataset.', fields: [f.text('actorId', 'Actor', { required: true }), f.json('input', 'Input')], outputs: outs('items:array:Results', 'runId:string:Run ID') },
  ]),

  ...provider({ integrationId: 'scrapingbee', category: 'automation', docs: 'https://www.scrapingbee.com/documentation/' }, [
    { op: 'scrape', name: 'Fetch a page', summary: 'Fetches a page through a proxy, rendering JavaScript.', fields: [f.expr('url', 'URL', { required: true }), f.bool('renderJs', 'Render JavaScript', { defaultValue: true })], outputs: outs('html:string', 'status:number:Status code') },
  ]),

  ...provider({ integrationId: 'browserless', category: 'automation', docs: 'https://docs.browserless.io' }, [
    { op: 'screenshot', name: 'Screenshot a page', summary: 'Captures a web page as an image.', fields: [f.expr('url', 'URL', { required: true }), f.bool('fullPage', 'Full page', { defaultValue: true })], outputs: outs('imageUrl:string:Image URL') },
    { op: 'pdf', name: 'Save a page as PDF', summary: 'Captures a web page as a PDF.', fields: [f.expr('url', 'URL', { required: true })], outputs: outs('pdfUrl:string:PDF URL') },
  ]),

  ...provider({ integrationId: 'zapier', category: 'automation', docs: 'https://zapier.com/developer' }, [
    { op: 'send_webhook', name: 'Trigger a Zap', summary: 'Posts data to a Zapier catch hook.', fields: [f.json('payload', 'Data', { required: true }), f.text('hookUrl', 'Catch hook', { help: 'Leave blank to use the hook saved on the Integrations page.' })], outputs: outs('status:string'),
      request: {
        method: 'POST',
        // The hook URL *is* the credential — it is unguessable and grants the
        // right to start the Zap — so it lives with the other secrets.
        url: ['{{hookUrl}}', '{{secret.ZAPIER_WEBHOOK_URL}}'],
        // The body is whatever JSON the person entered — a catch hook has no
        // schema of its own, so there is nothing to map it onto.
        body: '{{payload}}',
        outputs: { status: '$status' },
      } },
  ]),

  ...provider({ integrationId: 'make', category: 'automation', docs: 'https://www.make.com/en/api-documentation' }, [
    { op: 'trigger_scenario', name: 'Trigger a scenario', summary: 'Posts data to a Make webhook to start a scenario.', fields: [f.json('payload', 'Data', { required: true }), f.text('hookUrl', 'Webhook', { help: 'Leave blank to use the webhook saved on the Integrations page.' })], outputs: outs('status:string'),
      request: {
        method: 'POST',
        url: ['{{hookUrl}}', '{{secret.MAKE_WEBHOOK_URL}}'],
        body: '{{payload}}',
        outputs: { status: '$status' },
      } },
  ]),

  ...provider({ integrationId: 'n8n', category: 'automation', docs: 'https://docs.n8n.io/api/' }, [
    { op: 'trigger_workflow', name: 'Trigger a workflow', summary: 'Starts an n8n workflow with data.', fields: [f.text('workflowId', 'Workflow', { required: true }), f.json('payload', 'Data')], outputs: outs('executionId:string:Execution ID', 'status:string') },
  ]),

  ...provider({ integrationId: 'inngest', category: 'automation', docs: 'https://www.inngest.com/docs' }, [
    { op: 'send_event', name: 'Send an event', summary: 'Emits an Inngest event.', fields: [f.text('name', 'Event name', { required: true }), f.json('data', 'Data')], outputs: outs('eventId:string:Event ID') },
  ]),

  ...provider({ integrationId: 'mission_control', category: 'automation', docs: 'https://www.npcservices.com.au' }, [
    { op: 'notify', name: 'Send to Mission Control', summary: 'Posts an event to the Mission Control console.', fields: [f.expr('title', 'Title', { required: true }), f.json('payload', 'Data')], outputs: outs('status:string') },
  ]),

  // ── Infrastructure ───────────────────────────────────────────────────────
  ...provider({ integrationId: 'github', category: 'infrastructure', docs: 'https://docs.github.com/en/rest' }, [
    { op: 'create_issue', name: 'Create an issue', summary: 'Files an issue on a repository.', fields: [f.text('repo', 'Repository', { required: true, placeholder: 'owner/name' }), f.expr('title', 'Title', { required: true }), f.textarea('body', 'Body'), f.multi('labels', 'Labels', [opt('bug'), opt('enhancement'), opt('documentation')])], outputs: recordOutputs('Issue') },
    { op: 'dispatch_workflow', name: 'Run a workflow', summary: 'Starts a GitHub Actions workflow.', fields: [f.text('repo', 'Repository', { required: true }), f.text('workflowId', 'Workflow file', { required: true, placeholder: 'ci.yml' }), f.text('ref', 'Branch', { defaultValue: 'main' }), f.keyValue('inputs', 'Inputs')], outputs: outs('status:string') },
  ]),

  ...provider({ integrationId: 'cloudflare', category: 'infrastructure', docs: 'https://developers.cloudflare.com/api/' }, [
    { op: 'purge_cache', name: 'Purge the cache', summary: 'Clears cached files for your zone.', fields: [f.bool('purgeEverything', 'Purge everything', { defaultValue: false }), f.expr('files', 'Specific URLs')], outputs: outs('status:string') },
    { op: 'create_dns_record', name: 'Create a DNS record', summary: 'Adds a DNS record to your zone.', fields: [f.select('type', 'Type', [opt('A'), opt('CNAME'), opt('TXT'), opt('MX')], { required: true, defaultValue: 'CNAME' }), f.expr('name', 'Name', { required: true }), f.expr('content', 'Value', { required: true }), f.bool('proxied', 'Proxy through Cloudflare', { defaultValue: true })], outputs: outs('recordId:string:Record ID') },
  ]),

  ...provider({ integrationId: 'vercel', category: 'infrastructure', docs: 'https://vercel.com/docs/rest-api' }, [
    { op: 'trigger_deploy', name: 'Trigger a deployment', summary: 'Starts a new deployment of a project.', fields: [f.text('projectId', 'Project', { required: true }), f.text('ref', 'Branch', { defaultValue: 'main' })], outputs: outs('deploymentId:string:Deployment ID', 'url:string:Deployment URL', 'status:string') },
  ]),

  ...provider({ integrationId: 'upstash', category: 'infrastructure', docs: 'https://upstash.com/docs/redis/features/restapi' }, [
    { op: 'set', name: 'Store a value', summary: 'Writes a key to Redis, optionally with an expiry.', fields: [f.expr('key', 'Key', { required: true }), f.expr('value', 'Value', { required: true }), f.duration('ttl', 'Expires after')], outputs: outs('status:string') },
    { op: 'get', name: 'Read a value', summary: 'Reads a key from Redis.', fields: [f.expr('key', 'Key', { required: true })], outputs: outs('value:string', 'found:boolean:Found') },
  ]),

  ...provider({ integrationId: 'auth0', category: 'infrastructure', docs: 'https://auth0.com/docs/api/management/v2' }, [
    { op: 'create_user', name: 'Create a user', summary: 'Adds a user to your Auth0 tenant.', fields: [f.expr('email', 'Email', { required: true }), f.expr('name', 'Name'), f.bool('sendInvite', 'Send an invitation', { defaultValue: true })], outputs: outs('userId:string:User ID', 'email:string') },
  ]),

  ...provider({ integrationId: 'segment', category: 'infrastructure', docs: 'https://segment.com/docs/connections/sources/catalog/libraries/server/http-api/' }, [
    { op: 'track', name: 'Record an event', summary: 'Sends an event to every connected Segment destination.', fields: [f.text('event', 'Event name', { required: true }), f.expr('userId', 'Person', { required: true }), f.keyValue('properties', 'Properties')], outputs: outs('status:string') },
  ]),

  ...provider({ integrationId: 'doppler', category: 'infrastructure', docs: 'https://docs.doppler.com/reference/api' }, [
    { op: 'get_secret', name: 'Read a secret', summary: 'Fetches a secret value from Doppler at run time.', fields: [f.text('project', 'Project', { required: true }), f.text('config', 'Config', { required: true }), f.text('name', 'Secret name', { required: true })], outputs: outs('value:string') },
  ]),

  ...provider({ integrationId: 'turnstile', category: 'infrastructure', docs: 'https://developers.cloudflare.com/turnstile/' }, [
    { op: 'verify', name: 'Verify a challenge', summary: 'Checks a Turnstile token before trusting a submission.', fields: [f.expr('token', 'Token', { required: true }), f.expr('remoteIp', 'Visitor IP')], outputs: outs('success:boolean:Passed', 'hostname:string', 'challengeAt:string:Challenged at') },
  ]),

  ...provider({ integrationId: 'figma', category: 'infrastructure', docs: 'https://www.figma.com/developers/api' }, [
    { op: 'get_file', name: 'Read a file', summary: 'Returns the node tree for a Figma file.', fields: [f.text('fileKey', 'File', { required: true })], outputs: outs('document:object:Document', 'name:string', 'lastModified:string:Last modified') },
    { op: 'export_image', name: 'Export a frame', summary: 'Renders a Figma frame as an image.', fields: [f.text('fileKey', 'File', { required: true }), f.text('nodeId', 'Frame', { required: true }), f.select('format', 'Format', [opt('png', 'PNG'), opt('svg', 'SVG'), opt('pdf', 'PDF')], { defaultValue: 'png' })], outputs: outs('imageUrl:string:Image URL') },
  ]),

  ...provider({ integrationId: 'supabase', category: 'infrastructure', docs: 'https://supabase.com/docs/reference/api' }, [
    { op: 'invoke_function', name: 'Run an edge function', summary: 'Calls one of this project’s edge functions.', fields: [f.text('functionName', 'Function', { required: true }), f.json('payload', 'Body')], outputs: outs('status:number:Status code', 'body:object:Response') },
  ]),

  ...provider({ integrationId: 'aws', category: 'infrastructure', docs: 'https://docs.aws.amazon.com' }, [
    { op: 'invoke_lambda', name: 'Invoke a Lambda', summary: 'Calls an AWS Lambda function.', fields: [f.text('functionName', 'Function', { required: true }), f.json('payload', 'Payload')], outputs: outs('statusCode:number:Status code', 'body:object:Response') },
  ]),
];
