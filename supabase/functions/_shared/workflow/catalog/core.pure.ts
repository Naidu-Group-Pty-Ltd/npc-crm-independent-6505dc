/**
 * Platform-native triggers and control flow.
 *
 * The triggers here are the reason this builder is worth having over a generic
 * one: they fire on things that happen inside this dashboard — a purchase file
 * changing status, an AML alert, a report finishing — so an automation can react
 * to the business rather than only to third-party webhooks.
 *
 * Each trigger names a real table in this project. Adding one means the runtime
 * needs a matching source; do not invent events the platform cannot emit.
 */

import { f, native, opt, outs } from './builders.pure.ts';
import type { CatalogNode } from '../types.pure.ts';

const CLIENT_OUTPUTS = outs(
  'clientId:string:Client ID',
  'firstName:string:First name',
  'lastName:string:Last name',
  'email:string',
  'phone:string',
  'stage:string:Pipeline stage',
  'assignedTo:string:Assigned to',
);

/** Triggers sourced from this platform's own tables. */
export const PLATFORM_TRIGGERS: CatalogNode[] = native('platform', [
  {
    id: 'platform.client_created',
    kind: 'trigger',
    name: 'Client added',
    summary: 'Runs when a new client record is created.',
    icon: 'userPlus',
    keywords: ['crm', 'lead', 'contact', 'clients'],
    fields: [
      f.select(
        'source',
        'Only when created by',
        [opt('any', 'Any source'), opt('portal', 'Client portal'), opt('import', 'Data import'), opt('ghl', 'GoHighLevel sync'), opt('manual', 'Added by a user')],
        { defaultValue: 'any', help: 'Narrow the trigger to one intake path.' },
      ),
    ],
    outputs: CLIENT_OUTPUTS,
  },
  {
    id: 'platform.client_stage_changed',
    kind: 'trigger',
    name: 'Client stage changed',
    summary: 'Runs when a client moves between pipeline stages.',
    icon: 'gitBranch',
    keywords: ['pipeline', 'deal', 'stage'],
    fields: [
      f.text('toStage', 'Moved into', { placeholder: 'Any stage', help: 'Leave blank to run on every stage change.' }),
      f.text('fromStage', 'Moved out of', { placeholder: 'Any stage' }),
    ],
    outputs: [...CLIENT_OUTPUTS, ...outs('fromStage:string:Previous stage', 'toStage:string:New stage')],
  },
  {
    id: 'platform.report_generated',
    kind: 'trigger',
    name: 'Report generated',
    summary: 'Runs when an investment report finishes generating.',
    icon: 'fileText',
    keywords: ['investment', 'pdf', 'analysis'],
    fields: [
      f.select('reportType', 'Report type', [opt('any', 'Any report'), opt('investment', 'Investment report'), opt('portfolio', 'Portfolio review'), opt('comparison', 'Property comparison'), opt('marketing', 'Marketing intelligence')], { defaultValue: 'any' }),
    ],
    outputs: outs('reportId:string:Report ID', 'reportType:string:Report type', 'clientId:string:Client ID', 'propertyAddress:string:Property address', 'pdfUrl:string:PDF URL', 'generatedAt:string:Generated at'),
  },
  {
    id: 'platform.purchase_file_status_changed',
    kind: 'trigger',
    name: 'Purchase file status changed',
    summary: 'Runs when a purchase file moves to a new status.',
    icon: 'folderCheck',
    keywords: ['settlement', 'contract', 'conveyancing', 'transaction'],
    fields: [
      f.text('toStatus', 'Moved into', { placeholder: 'Any status', help: 'For example: unconditional, settled, cooling-off.' }),
    ],
    outputs: outs('purchaseFileId:string:Purchase file ID', 'clientId:string:Client ID', 'fromStatus:string:Previous status', 'toStatus:string:New status', 'settlementDate:string:Settlement date', 'purchasePrice:number:Purchase price'),
  },
  {
    id: 'platform.aml_alert_raised',
    kind: 'trigger',
    name: 'Compliance alert raised',
    summary: 'Runs when AML or risk screening flags a client.',
    icon: 'shieldAlert',
    keywords: ['aml', 'kyc', 'risk', 'pep', 'sanctions', 'compliance'],
    fields: [
      f.select('severity', 'Minimum severity', [opt('low', 'Low and above'), opt('medium', 'Medium and above'), opt('high', 'High only')], { defaultValue: 'medium' }),
    ],
    outputs: outs('alertId:string:Alert ID', 'clientId:string:Client ID', 'severity:string', 'reason:string', 'raisedAt:string:Raised at'),
  },
  {
    id: 'platform.call_completed',
    kind: 'trigger',
    name: 'Call completed',
    summary: 'Runs when a voice call ends and its transcript is ready.',
    icon: 'phone',
    keywords: ['vapi', 'voice', 'transcript', 'phone'],
    fields: [
      f.select('direction', 'Direction', [opt('any', 'Inbound and outbound'), opt('inbound', 'Inbound only'), opt('outbound', 'Outbound only')], { defaultValue: 'any' }),
      f.number('minDurationSeconds', 'Minimum duration (seconds)', { placeholder: '0', help: 'Skip short calls such as immediate hang-ups.' }),
    ],
    outputs: outs('callId:string:Call ID', 'direction:string', 'durationSeconds:number:Duration (seconds)', 'transcript:string', 'summary:string', 'phoneNumber:string:Phone number', 'clientId:string:Client ID'),
  },
  {
    id: 'platform.portal_message_received',
    kind: 'trigger',
    name: 'Client portal message received',
    summary: 'Runs when a client sends a message from their portal.',
    icon: 'messageSquare',
    keywords: ['portal', 'inbox', 'client'],
    outputs: outs('messageId:string:Message ID', 'clientId:string:Client ID', 'body:string:Message body', 'receivedAt:string:Received at'),
  },
  {
    id: 'platform.document_uploaded',
    kind: 'trigger',
    name: 'Document uploaded',
    summary: 'Runs when a client or team member uploads a document.',
    icon: 'upload',
    keywords: ['file', 'attachment', 'statement', 'contract'],
    fields: [
      f.text('matchesName', 'File name contains', { placeholder: 'Any file', help: 'For example: contract, payslip, rates notice.' }),
    ],
    outputs: outs('documentId:string:Document ID', 'clientId:string:Client ID', 'fileName:string:File name', 'mimeType:string:MIME type', 'sizeBytes:number:Size (bytes)', 'storagePath:string:Storage path'),
  },
  {
    id: 'platform.market_update_published',
    kind: 'trigger',
    name: 'Market update published',
    summary: 'Runs when a market update clears review and goes live.',
    icon: 'newspaper',
    keywords: ['market', 'news', 'digest', 'suburb'],
    fields: [f.text('suburb', 'Only for suburb', { placeholder: 'Any suburb' })],
    outputs: outs('updateId:string:Update ID', 'headline:string', 'suburb:string', 'state:string', 'summary:string', 'publishedAt:string:Published at'),
  },
  {
    id: 'platform.borrowing_capacity_completed',
    kind: 'trigger',
    name: 'Borrowing capacity assessed',
    summary: 'Runs when a borrowing capacity assessment finishes.',
    icon: 'calculator',
    keywords: ['finance', 'lending', 'serviceability', 'broker'],
    outputs: outs('assessmentId:string:Assessment ID', 'clientId:string:Client ID', 'maxBorrowing:number:Maximum borrowing', 'lender:string', 'assessedAt:string:Assessed at'),
  },
]);

/** Triggers that do not depend on a domain event. */
export const GENERIC_TRIGGERS: CatalogNode[] = native('logic', [
  {
    id: 'core.schedule',
    kind: 'trigger',
    name: 'On a schedule',
    summary: 'Runs on a repeating schedule you choose.',
    icon: 'clock',
    keywords: ['cron', 'daily', 'weekly', 'recurring', 'timer'],
    fields: [
      f.select(
        'preset',
        'Frequency',
        [opt('hourly', 'Every hour'), opt('daily', 'Every day'), opt('weekly', 'Every week'), opt('monthly', 'Every month'), opt('custom', 'Custom schedule')],
        { defaultValue: 'daily', required: true },
      ),
      f.text('timeOfDay', 'At', { placeholder: '09:00', showWhen: { field: 'preset', equals: ['daily', 'weekly', 'monthly'] } }),
      f.cron('cron', 'Cron expression', { required: true, placeholder: '0 9 * * 1-5', showWhen: { field: 'preset', equals: ['custom'] }, help: 'Five fields, evaluated in the workspace time zone.' }),
    ],
    outputs: outs('scheduledFor:string:Scheduled for', 'runId:string:Run ID'),
  },
  {
    id: 'core.webhook',
    kind: 'trigger',
    name: 'Incoming webhook',
    summary: 'Runs when something posts to this workflow’s URL.',
    icon: 'webhook',
    keywords: ['http', 'post', 'callback', 'inbound', 'api'],
    fields: [
      f.select('method', 'Accepted method', [opt('POST'), opt('GET'), opt('PUT')], { defaultValue: 'POST' }),
      f.text('secretHeader', 'Shared secret header', { placeholder: 'X-Signature', help: 'Requests without a matching header are rejected and counted, not silently dropped.' }),
    ],
    outputs: outs('body:object:Request body', 'headers:object:Request headers', 'query:object:Query string', 'receivedAt:string:Received at'),
  },
  {
    id: 'core.manual',
    kind: 'trigger',
    name: 'Run manually',
    summary: 'Runs only when someone presses Run.',
    icon: 'play',
    keywords: ['test', 'button', 'on demand'],
    fields: [f.json('sampleInput', 'Sample input', { help: 'Used when testing so downstream nodes have data to work with.' })],
    outputs: outs('startedBy:string:Started by', 'startedAt:string:Started at'),
  },
]);

/** Control flow. Nothing here leaves the platform. */
export const LOGIC_NODES: CatalogNode[] = native('logic', [
  {
    id: 'core.branch',
    name: 'Branch',
    summary: 'Sends the run down one path or the other based on a condition.',
    icon: 'gitBranch',
    keywords: ['if', 'else', 'condition', 'split'],
    branches: [
      { id: 'true', label: 'Matches' },
      { id: 'false', label: 'Otherwise' },
    ],
    fields: [
      f.expr('left', 'Value', { required: true, placeholder: '{{trigger.stage}}' }),
      f.select(
        'operator',
        'Condition',
        [
          opt('eq', 'is equal to'),
          opt('neq', 'is not equal to'),
          opt('contains', 'contains'),
          opt('gt', 'is greater than'),
          opt('lt', 'is less than'),
          opt('exists', 'has any value'),
          opt('empty', 'is empty'),
        ],
        { required: true, defaultValue: 'eq' },
      ),
      f.expr('right', 'Compared with', { showWhen: { field: 'operator', equals: ['eq', 'neq', 'contains', 'gt', 'lt'] } }),
    ],
    outputs: outs('matched:boolean:Matched'),
  },
  {
    id: 'core.filter',
    name: 'Only continue if',
    summary: 'Stops the run unless the condition holds.',
    icon: 'filter',
    keywords: ['guard', 'stop', 'condition', 'gate'],
    fields: [
      f.expr('left', 'Value', { required: true, placeholder: '{{trigger.amount}}' }),
      f.select('operator', 'Condition', [opt('eq', 'is equal to'), opt('neq', 'is not equal to'), opt('gt', 'is greater than'), opt('lt', 'is less than'), opt('contains', 'contains'), opt('exists', 'has any value')], { required: true, defaultValue: 'exists' }),
      f.expr('right', 'Compared with', { showWhen: { field: 'operator', equals: ['eq', 'neq', 'gt', 'lt', 'contains'] } }),
    ],
    outputs: [],
  },
  {
    id: 'core.delay',
    name: 'Wait',
    summary: 'Pauses the run before continuing.',
    icon: 'timer',
    keywords: ['sleep', 'pause', 'throttle', 'later'],
    fields: [
      f.duration('duration', 'Wait for', { required: true, defaultValue: '1h', help: 'For example 30m, 4h, 2d.' }),
    ],
    outputs: outs('resumedAt:string:Resumed at'),
  },
  {
    id: 'core.loop',
    name: 'For each',
    summary: 'Runs the following nodes once per item in a list.',
    icon: 'repeat',
    keywords: ['iterate', 'map', 'batch', 'each'],
    fields: [
      f.expr('items', 'List', { required: true, placeholder: '{{search.results}}' }),
      f.number('concurrency', 'At a time', { defaultValue: 1, help: 'Raise for speed; keep at 1 when the downstream API rate-limits.' }),
    ],
    outputs: outs('item:object:Current item', 'index:number:Position', 'total:number:Total items'),
  },
  {
    id: 'core.merge',
    name: 'Merge paths',
    summary: 'Waits for several paths and continues once with their combined data.',
    icon: 'gitMerge',
    keywords: ['join', 'combine', 'collect', 'fan in'],
    fields: [
      f.select('mode', 'Continue when', [opt('all', 'Every path has finished'), opt('any', 'The first path finishes')], { defaultValue: 'all' }),
    ],
    outputs: outs('combined:object:Combined data'),
  },
  {
    id: 'core.set',
    name: 'Set values',
    summary: 'Names a value now so later nodes can reuse it.',
    icon: 'braces',
    keywords: ['variable', 'assign', 'map', 'transform'],
    fields: [f.keyValue('values', 'Values', { required: true, help: 'Each value may reference upstream data.' })],
    outputs: outs('values:object:Values'),
  },
  {
    id: 'core.http',
    name: 'HTTP request',
    summary: 'Calls any URL — use it for services with no dedicated node.',
    icon: 'globe',
    keywords: ['rest', 'api', 'fetch', 'curl', 'custom'],
    fields: [
      f.select('method', 'Method', [opt('GET'), opt('POST'), opt('PUT'), opt('PATCH'), opt('DELETE')], { required: true, defaultValue: 'GET' }),
      f.expr('url', 'URL', { required: true, placeholder: 'https://api.example.com/v1/records' }),
      f.keyValue('headers', 'Headers'),
      f.json('body', 'Body', { showWhen: { field: 'method', equals: ['POST', 'PUT', 'PATCH'] } }),
      f.number('timeoutSeconds', 'Timeout (seconds)', { defaultValue: 30 }),
    ],
    outputs: outs('status:number:Status code', 'body:object:Response body', 'headers:object:Response headers'),
  },
  {
    id: 'core.code',
    name: 'Run code',
    summary: 'Transforms the run’s data with a small JavaScript expression.',
    icon: 'code',
    keywords: ['javascript', 'script', 'function', 'transform', 'custom'],
    fields: [
      f.textarea('expression', 'Expression', { required: true, placeholder: 'return { total: input.items.length };', help: 'Runs sandboxed with no network or file access.' }),
    ],
    outputs: outs('result:object:Result'),
  },
  {
    id: 'core.template',
    name: 'Compose text',
    summary: 'Builds a block of text from the run’s data.',
    icon: 'type',
    keywords: ['format', 'string', 'message', 'body', 'render'],
    fields: [
      f.textarea('template', 'Text', { required: true, placeholder: 'Hi {{trigger.firstName}}, your report for {{trigger.propertyAddress}} is ready.' }),
    ],
    outputs: outs('text:string:Text'),
  },
  {
    id: 'core.dedupe',
    name: 'Skip duplicates',
    summary: 'Drops runs it has already seen for the same key.',
    icon: 'copyCheck',
    keywords: ['unique', 'once', 'idempotent', 'repeat'],
    fields: [
      f.expr('key', 'Unique key', { required: true, placeholder: '{{trigger.clientId}}' }),
      f.duration('window', 'Remember for', { defaultValue: '7d' }),
    ],
    outputs: [],
  },
  {
    id: 'core.approval',
    name: 'Wait for approval',
    summary: 'Pauses until a teammate approves or rejects the run.',
    icon: 'userCheck',
    keywords: ['human', 'review', 'sign off', 'gate', 'manual'],
    branches: [
      { id: 'approved', label: 'Approved' },
      { id: 'rejected', label: 'Rejected' },
    ],
    fields: [
      f.text('approver', 'Ask', { required: true, placeholder: 'Team or user', help: 'They are notified in the dashboard and by email.' }),
      f.textarea('question', 'What they are approving', { required: true, placeholder: 'Send this valuation summary to the client?' }),
      f.duration('expiresAfter', 'Auto-reject after', { defaultValue: '2d' }),
    ],
    outputs: outs('decision:string', 'decidedBy:string:Decided by', 'comment:string', 'decidedAt:string:Decided at'),
  },
  {
    id: 'core.notify_team',
    name: 'Notify the team',
    summary: 'Posts a notification inside this dashboard.',
    icon: 'bell',
    keywords: ['alert', 'internal', 'message', 'inbox'],
    fields: [
      f.text('recipient', 'Notify', { required: true, placeholder: 'Team or user' }),
      f.expr('title', 'Title', { required: true }),
      f.expr('body', 'Details'),
      f.select('priority', 'Priority', [opt('normal', 'Normal'), opt('high', 'High'), opt('urgent', 'Urgent')], { defaultValue: 'normal' }),
    ],
    outputs: outs('notificationId:string:Notification ID'),
  },
  {
    id: 'core.stop',
    name: 'Stop the run',
    summary: 'Ends the run here, optionally recording why.',
    icon: 'octagon',
    keywords: ['end', 'halt', 'terminate', 'abort'],
    fields: [
      f.select('outcome', 'Record as', [opt('success', 'Finished'), opt('skipped', 'Skipped'), opt('failed', 'Failed')], { defaultValue: 'success' }),
      f.expr('reason', 'Reason'),
    ],
    outputs: [],
  },
]);

export const CORE_NODES: CatalogNode[] = [
  ...PLATFORM_TRIGGERS,
  ...GENERIC_TRIGGERS,
  ...LOGIC_NODES,
];
