/**
 * Starter workflows.
 *
 * These exist to answer "what would I even build with this?" — each one is a
 * real job this business does, wired end to end so it can be opened, read and
 * adapted rather than assembled from a blank canvas.
 *
 * Every node id here must exist in the catalog; `templates.spec.ts` fails the
 * build if one drifts.
 */

import type { WorkflowGraph } from './types';

/**
 * Grouped by the job, not by the integration. Someone arriving here knows what
 * they are trying to get done ("chase a settlement") long before they know
 * which of 142 integrations does it.
 */
export type TemplateCategory =
  | 'compliance'
  | 'client'
  | 'property'
  | 'finance'
  | 'marketing'
  | 'operations'
  | 'ai';

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string; blurb: string }[] = [
  { id: 'client', label: 'Client care', blurb: 'Onboarding, messages and appointments.' },
  { id: 'compliance', label: 'Compliance', blurb: 'Screening, identity and alert handling.' },
  { id: 'property', label: 'Property research', blurb: 'Valuations, comparables and suburb data.' },
  { id: 'finance', label: 'Money', blurb: 'Invoices, payments and borrowing capacity.' },
  { id: 'marketing', label: 'Growth', blurb: 'Leads, campaigns and social.' },
  { id: 'operations', label: 'Operations', blurb: 'Settlements, documents and incidents.' },
  { id: 'ai', label: 'AI assistants', blurb: 'Summaries, extraction and research agents.' },
];

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** Integrations the template needs, so the card can warn before it is opened. */
  requires: string[];
  graph: WorkflowGraph;
}

/** Laid out left to right on the same row unless a branch needs a second row. */
const at = (column: number, row = 0) => ({ x: 80 + column * 368, y: 120 + row * 200 });

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'new-client-compliance',
    name: 'Screen every new client',
    category: 'compliance',
    description:
      'Runs sanctions and PEP screening the moment a client is added, escalates a hit to the team, and quietly records a clean result.',
    requires: ['comply_advantage'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'platform.client_created', position: at(0), config: { source: 'any' } },
        {
          id: 'screen',
          type: 'comply_advantage.screen',
          position: at(1),
          config: {
            name: '{{trigger.firstName}} {{trigger.lastName}}',
            lists: ['sanction', 'pep'],
            fuzziness: 0.6,
          },
        },
        {
          id: 'decide',
          type: 'core.branch',
          position: at(2),
          config: { left: '{{screen.outcome}}', operator: 'eq', right: 'match' },
        },
        {
          id: 'escalate',
          type: 'core.notify_team',
          position: at(3, -1),
          config: {
            recipient: 'Compliance',
            title: 'Screening hit: {{trigger.firstName}} {{trigger.lastName}}',
            body: 'Risk level {{screen.riskLevel}}. Review before proceeding.',
            priority: 'urgent',
          },
        },
        {
          id: 'record',
          type: 'core.set',
          position: at(3, 1),
          config: { values: [{ key: 'screeningOutcome', value: '{{screen.outcome}}' }] },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'screen' },
        { id: 'e2', source: 'screen', target: 'decide' },
        { id: 'e3', source: 'decide', target: 'escalate', sourceBranch: 'true' },
        { id: 'e4', source: 'decide', target: 'record', sourceBranch: 'false' },
      ],
    },
  },

  {
    id: 'report-delivery',
    name: 'Deliver a finished report',
    category: 'client',
    description:
      'When an investment report finishes, emails it to the client, logs the delivery against their CRM record, and tells the team it went out.',
    requires: ['resend', 'gohighlevel'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'platform.report_generated', position: at(0), config: { reportType: 'investment' } },
        {
          id: 'compose',
          type: 'core.template',
          position: at(1),
          config: {
            template:
              'Hi {{trigger.clientId}},\n\nYour investment report for {{trigger.propertyAddress}} is ready.\n\nIt covers the numbers we discussed, the comparable sales, and what we think the next step should be.',
          },
        },
        {
          id: 'email',
          type: 'resend.send_email',
          position: at(2),
          config: {
            to: '{{trigger.clientId}}',
            subject: 'Your report for {{trigger.propertyAddress}}',
            html: '{{compose.text}}',
            attachmentUrl: '{{trigger.pdfUrl}}',
          },
        },
        {
          id: 'log',
          type: 'gohighlevel.upsert_contact',
          position: at(3),
          config: { email: '{{trigger.clientId}}', tags: ['client'] },
        },
        {
          id: 'notify',
          type: 'core.notify_team',
          position: at(4),
          config: { recipient: 'Advisors', title: 'Report sent for {{trigger.propertyAddress}}' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'compose' },
        { id: 'e2', source: 'compose', target: 'email' },
        { id: 'e3', source: 'email', target: 'log' },
        { id: 'e4', source: 'log', target: 'notify' },
      ],
    },
  },

  {
    id: 'listing-watch',
    name: 'Value a new listing the day it appears',
    category: 'property',
    description:
      'Watches a suburb, values anything that lands, checks the zoning, and only bothers you when the estimate beats the asking price.',
    requires: ['domain', 'cotality', 'landchecker'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'domain.new_listing', position: at(0), config: { suburb: '', minBedrooms: 3 } },
        {
          id: 'value',
          type: 'cotality.valuation',
          position: at(1),
          config: { address: '{{trigger.address}}', propertyType: 'house' },
        },
        {
          id: 'planning',
          type: 'landchecker.planning_overlays',
          position: at(2),
          config: { address: '{{trigger.address}}' },
        },
        {
          id: 'worthwhile',
          type: 'core.filter',
          position: at(3),
          config: { left: '{{value.estimate}}', operator: 'gt', right: '{{trigger.price}}' },
        },
        {
          id: 'alert',
          type: 'core.notify_team',
          position: at(4),
          config: {
            recipient: 'Buyers agents',
            title: 'Under-priced: {{trigger.address}}',
            body: 'Asking {{trigger.price}}, valued at {{value.estimate}}. Zone {{planning.zone}}.',
            priority: 'high',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'value' },
        { id: 'e2', source: 'value', target: 'planning' },
        { id: 'e3', source: 'planning', target: 'worthwhile' },
        { id: 'e4', source: 'worthwhile', target: 'alert' },
      ],
    },
  },

  {
    id: 'call-follow-up',
    name: 'Turn a call into a follow-up',
    category: 'ai',
    description:
      'Summarises a finished call, drafts the follow-up email, and holds it for approval before anything reaches the client.',
    requires: ['anthropic', 'resend'],
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'platform.call_completed',
          position: at(0),
          config: { direction: 'any', minDurationSeconds: 60 },
        },
        {
          id: 'draft',
          type: 'anthropic.messages',
          position: at(1),
          config: {
            model: 'claude-sonnet-4',
            system: 'You write brief, warm follow-up emails for an Australian property advisory. No fluff.',
            prompt:
              'Write a follow-up email based on this call transcript. Summarise what was agreed and state the next step.\n\n{{trigger.transcript}}',
            maxTokens: 700,
            temperature: 0.3,
          },
        },
        {
          id: 'approve',
          type: 'core.approval',
          position: at(2),
          config: {
            approver: 'Advisors',
            question: 'Send this follow-up to the client?',
            expiresAfter: '2d',
          },
        },
        {
          id: 'send',
          type: 'resend.send_email',
          position: at(3, -1),
          config: {
            to: '{{trigger.phoneNumber}}',
            subject: 'Following up on our call',
            html: '{{draft.text}}',
          },
        },
        {
          id: 'shelve',
          type: 'core.stop',
          position: at(3, 1),
          config: { outcome: 'skipped', reason: 'Follow-up rejected by {{approve.decidedBy}}' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'draft' },
        { id: 'e2', source: 'draft', target: 'approve' },
        { id: 'e3', source: 'approve', target: 'send', sourceBranch: 'approved' },
        { id: 'e4', source: 'approve', target: 'shelve', sourceBranch: 'rejected' },
      ],
    },
  },

  {
    id: 'rate-change-briefing',
    name: 'Brief clients when the cash rate moves',
    category: 'marketing',
    description:
      'Picks up an RBA decision, researches what it means for borrowers, and posts a briefing to the team channel for sign-off.',
    requires: ['rba', 'perplexity', 'slack'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'rba.rate_changed', position: at(0), config: {} },
        {
          id: 'research',
          type: 'perplexity.search',
          position: at(1),
          config: {
            model: 'sonar',
            query:
              'The RBA moved the cash rate to {{trigger.cashRate}}%. What does this mean for Australian mortgage holders and property buyers this quarter?',
            recency: 'week',
          },
        },
        {
          id: 'brief',
          type: 'core.template',
          position: at(2),
          config: {
            template:
              'Cash rate is now {{trigger.cashRate}}% ({{trigger.direction}} {{trigger.changeBps}}bps).\n\n{{research.answer}}',
          },
        },
        {
          id: 'post',
          type: 'slack.post_message',
          position: at(3),
          config: { channel: '#market', text: '{{brief.text}}' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'research' },
        { id: 'e2', source: 'research', target: 'brief' },
        { id: 'e3', source: 'brief', target: 'post' },
      ],
    },
  },

  {
    id: 'client-onboarding',
    name: 'Onboard a new client properly',
    category: 'client',
    description:
      'Puts a new client into the CRM, books the discovery call, and sends the welcome note — the three things that always get done late.',
    requires: ['hubspot', 'google_calendar', 'resend'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'platform.client_created', position: at(0), config: { source: 'any' } },
        {
          id: 'crm',
          type: 'hubspot.upsert_contact',
          position: at(1),
          config: {
            email: '{{trigger.email}}',
            firstname: '{{trigger.firstName}}',
            lastname: '{{trigger.lastName}}',
            phone: '{{trigger.phone}}',
          },
        },
        {
          id: 'book',
          type: 'google_calendar.create_event',
          position: at(2),
          config: {
            summary: 'Discovery call — {{trigger.firstName}} {{trigger.lastName}}',
            start: '{{trigger.clientId}}',
            durationMinutes: 45,
            attendees: '{{trigger.email}}',
            description: 'First conversation. Goals, budget, timeframe.',
          },
        },
        {
          id: 'welcome',
          type: 'resend.send_email',
          position: at(3),
          config: {
            to: '{{trigger.email}}',
            subject: 'Welcome to NPC Services',
            html: 'Hi {{trigger.firstName}}, welcome aboard. Your discovery call is in the diary — details are in the invitation.',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'crm' },
        { id: 'e2', source: 'crm', target: 'book' },
        { id: 'e3', source: 'book', target: 'welcome' },
      ],
    },
  },

  {
    id: 'aml-alert-triage',
    name: 'Triage an AML alert',
    category: 'compliance',
    description:
      'Reads the alert, classifies how serious it really is, and either wakes the compliance channel or files it with the reasoning attached.',
    requires: ['openai', 'microsoft_teams', 'airtable'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'platform.aml_alert_raised', position: at(0), config: { severity: 'any' } },
        {
          id: 'classify',
          type: 'openai.structured',
          position: at(1),
          config: {
            model: 'gpt-4o-mini',
            input:
              'Classify this AML alert for an Australian property advisory. Alert: {{trigger.reason}} (severity {{trigger.severity}}).',
            schema:
              '{"type":"object","properties":{"urgency":{"type":"string","enum":["escalate","monitor"]},"rationale":{"type":"string"}},"required":["urgency","rationale"]}',
          },
        },
        {
          id: 'decide',
          type: 'core.branch',
          position: at(2),
          config: { left: '{{classify.data}}', operator: 'contains', right: 'escalate' },
        },
        {
          id: 'escalate',
          type: 'microsoft_teams.post_message',
          position: at(3, -1),
          config: {
            title: 'AML escalation — client {{trigger.clientId}}',
            text: '{{trigger.reason}}\n\nAssessment: {{classify.data}}',
          },
        },
        {
          id: 'file',
          type: 'airtable.create_record',
          position: at(3, 1),
          config: {
            table: 'AML alerts',
            fields: [
              { key: 'Alert', value: '{{trigger.alertId}}' },
              { key: 'Assessment', value: '{{classify.data}}' },
            ],
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'classify' },
        { id: 'e2', source: 'classify', target: 'decide' },
        { id: 'e3', source: 'decide', target: 'escalate', sourceBranch: 'true' },
        { id: 'e4', source: 'decide', target: 'file', sourceBranch: 'false' },
      ],
    },
  },

  {
    id: 'identity-verification',
    name: 'Verify an uploaded ID document',
    category: 'compliance',
    description:
      'Reads a passport or licence the moment it is uploaded, runs the KYC check, and only involves a person when the result is not clean.',
    requires: ['google_document_ai', 'frankieone'],
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'platform.document_uploaded',
          position: at(0),
          config: { matchesName: 'passport' },
        },
        {
          id: 'read',
          type: 'google_document_ai.process',
          position: at(1),
          config: { fileUrl: '{{trigger.storagePath}}' },
        },
        {
          id: 'kyc',
          type: 'frankieone.kyc_check',
          position: at(2),
          config: {
            firstName: '{{read.entities}}',
            lastName: '{{read.entities}}',
            dateOfBirth: '{{read.entities}}',
          },
        },
        {
          id: 'clean',
          type: 'core.branch',
          position: at(3),
          config: { left: '{{kyc.outcome}}', operator: 'eq', right: 'clear' },
        },
        {
          id: 'pass',
          type: 'core.set',
          position: at(4, -1),
          config: {
            values: [
              { key: 'kycOutcome', value: '{{kyc.outcome}}' },
              { key: 'kycReference', value: '{{kyc.referenceId}}' },
            ],
          },
        },
        {
          id: 'review',
          type: 'core.notify_team',
          position: at(4, 1),
          config: {
            recipient: 'Compliance',
            title: 'Manual ID review — client {{trigger.clientId}}',
            body: 'KYC returned {{kyc.outcome}} at risk level {{kyc.riskLevel}}.',
            priority: 'high',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'read' },
        { id: 'e2', source: 'read', target: 'kyc' },
        { id: 'e3', source: 'kyc', target: 'clean' },
        { id: 'e4', source: 'clean', target: 'pass', sourceBranch: 'true' },
        { id: 'e5', source: 'clean', target: 'review', sourceBranch: 'false' },
      ],
    },
  },

  {
    id: 'settlement-countdown',
    name: 'Run the settlement countdown',
    category: 'operations',
    description:
      'The moment a purchase goes unconditional, books the settlement date, texts the client, and raises the tasks the team has to finish first.',
    requires: ['google_calendar', 'clicksend', 'asana'],
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'platform.purchase_file_status_changed',
          position: at(0),
          config: { toStatus: 'unconditional' },
        },
        {
          id: 'diary',
          type: 'google_calendar.create_event',
          position: at(1),
          config: {
            summary: 'Settlement — file {{trigger.purchaseFileId}}',
            start: '{{trigger.settlementDate}}',
            durationMinutes: 60,
            description: 'Purchase price {{trigger.purchasePrice}}.',
          },
        },
        {
          id: 'tell_client',
          type: 'clicksend.send_sms',
          position: at(2),
          config: {
            to: '{{trigger.clientId}}',
            body: 'Good news — your purchase is unconditional. Settlement is set for {{trigger.settlementDate}}.',
          },
        },
        {
          id: 'tasks',
          type: 'asana.create_task',
          position: at(3),
          config: {
            projectId: 'Settlements',
            name: 'Pre-settlement checks — {{trigger.purchaseFileId}}',
            notes: 'Final inspection, funds confirmation, insurance certificate.',
            dueOn: '{{trigger.settlementDate}}',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'diary' },
        { id: 'e2', source: 'diary', target: 'tell_client' },
        { id: 'e3', source: 'tell_client', target: 'tasks' },
      ],
    },
  },

  {
    id: 'weekly-suburb-digest',
    name: 'Post a weekly suburb digest',
    category: 'property',
    description:
      'Every Monday, pulls the suburb’s median, growth and vacancy rate and posts one short read to the team channel.',
    requires: ['domain', 'sqm_research', 'slack'],
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'core.schedule',
          position: at(0),
          config: { preset: 'weekly', timeOfDay: '07:30', cron: '30 7 * * 1' },
        },
        {
          id: 'performance',
          type: 'domain.suburb_performance',
          position: at(1),
          config: { suburb: 'Richmond', state: 'VIC', propertyCategory: 'house' },
        },
        {
          id: 'vacancy',
          type: 'sqm_research.vacancy_rates',
          position: at(2),
          config: { postcode: '3121' },
        },
        {
          id: 'digest',
          type: 'core.template',
          position: at(3),
          config: {
            template:
              'Richmond this week\n\nMedian {{performance.medianPrice}} ({{performance.annualGrowth}} year on year), {{performance.daysOnMarket}} days on market, clearance {{performance.auctionClearanceRate}}.\nVacancy {{vacancy.vacancyRate}} and {{vacancy.trend}}.',
          },
        },
        {
          id: 'post',
          type: 'slack.post_message',
          position: at(4),
          config: { channel: '#market', text: '{{digest.text}}' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'performance' },
        { id: 'e2', source: 'performance', target: 'vacancy' },
        { id: 'e3', source: 'vacancy', target: 'digest' },
        { id: 'e4', source: 'digest', target: 'post' },
      ],
    },
  },

  {
    id: 'yield-check',
    name: 'Check the yield on an address',
    category: 'property',
    description:
      'Give it an address: it standardises it, values the property, estimates the rent, and files the result as a page you can share.',
    requires: ['geoscape', 'proptrack', 'pricefinder', 'notion'],
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'core.manual',
          position: at(0),
          config: { sampleInput: '{ "address": "12 Example St, Richmond VIC 3121" }' },
        },
        {
          id: 'standardise',
          type: 'geoscape.validate_address',
          position: at(1),
          config: { address: '{{trigger.startedBy}}' },
        },
        {
          id: 'value',
          type: 'proptrack.valuation',
          position: at(2),
          config: { address: '{{standardise.formatted}}' },
        },
        {
          id: 'rent',
          type: 'pricefinder.rental_estimate',
          position: at(3),
          config: { address: '{{standardise.formatted}}' },
        },
        {
          id: 'summary',
          type: 'core.template',
          position: at(4),
          config: {
            template:
              '{{standardise.formatted}}\n\nValue {{value.estimate}} (range {{value.lowEstimate}}–{{value.highEstimate}}, confidence {{value.confidence}}).\nRent {{rent.weeklyRent}} per week, gross yield {{rent.grossYield}}.',
          },
        },
        {
          id: 'file',
          type: 'notion.create_page',
          position: at(5),
          config: {
            databaseId: 'Property research',
            title: '{{standardise.formatted}}',
            content: '{{summary.text}}',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'standardise' },
        { id: 'e2', source: 'standardise', target: 'value' },
        { id: 'e3', source: 'value', target: 'rent' },
        { id: 'e4', source: 'rent', target: 'summary' },
        { id: 'e5', source: 'summary', target: 'file' },
      ],
    },
  },

  {
    id: 'comparables-pack',
    name: 'Build a comparables pack',
    category: 'property',
    description:
      'Pulls recent comparable sales, scores the location for walkability, renders a map, and saves the lot to the shared drive.',
    requires: ['cotality', 'walkscore', 'google', 'mapbox', 'google_drive'],
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'core.manual',
          position: at(0),
          config: { sampleInput: '{ "address": "12 Example St, Richmond VIC 3121" }' },
        },
        {
          id: 'comps',
          type: 'cotality.comparables',
          position: at(1),
          config: { address: '{{trigger.startedBy}}', radiusKm: 2, months: 12, limit: 10 },
        },
        {
          id: 'walk',
          type: 'walkscore.scores',
          position: at(2),
          config: { address: '{{trigger.startedBy}}' },
        },
        {
          id: 'locate',
          type: 'google.geocode',
          position: at(3),
          config: { address: '{{trigger.startedBy}}' },
        },
        {
          id: 'map',
          type: 'mapbox.static_map',
          position: at(4),
          config: {
            latitude: '{{locate.latitude}}',
            longitude: '{{locate.longitude}}',
            style: 'streets-v12',
            zoom: 15,
          },
        },
        {
          id: 'save',
          type: 'google_drive.upload',
          position: at(5),
          config: {
            fileUrl: '{{map.imageUrl}}',
            name: 'Comparables — {{locate.formatted}}',
            folderId: 'Property research',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'comps' },
        { id: 'e2', source: 'comps', target: 'walk' },
        { id: 'e3', source: 'walk', target: 'locate' },
        { id: 'e4', source: 'locate', target: 'map' },
        { id: 'e5', source: 'map', target: 'save' },
      ],
    },
  },

  {
    id: 'failed-payment-recovery',
    name: 'Recover a failed payment',
    category: 'finance',
    description:
      'A first failure gets a polite email with a link. A third one stops being an email problem and goes to a person.',
    requires: ['stripe', 'resend'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'stripe.payment_failed', position: at(0), config: {} },
        {
          id: 'persistent',
          type: 'core.branch',
          position: at(1),
          config: { left: '{{trigger.attemptCount}}', operator: 'gt', right: '2' },
        },
        {
          id: 'call_them',
          type: 'core.notify_team',
          position: at(2, -1),
          config: {
            recipient: 'Accounts',
            title: 'Payment failing repeatedly — {{trigger.email}}',
            body: '{{trigger.attemptCount}} attempts. Last message: {{trigger.failureMessage}}.',
            priority: 'high',
          },
        },
        {
          id: 'nudge',
          type: 'resend.send_email',
          position: at(2, 1),
          config: {
            to: '{{trigger.email}}',
            subject: 'Your payment did not go through',
            html: 'We could not process {{trigger.amount}} — the bank said: {{trigger.failureMessage}}. Updating your card takes a minute and we will retry automatically.',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'persistent' },
        { id: 'e2', source: 'persistent', target: 'call_them', sourceBranch: 'true' },
        { id: 'e3', source: 'persistent', target: 'nudge', sourceBranch: 'false' },
      ],
    },
  },

  {
    id: 'settlement-invoice',
    name: 'Invoice on settlement',
    category: 'finance',
    description:
      'Raises the fee invoice when a purchase settles, waits a fortnight, and reminds the team if it is still sitting there.',
    requires: ['xero'],
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'platform.purchase_file_status_changed',
          position: at(0),
          config: { toStatus: 'settled' },
        },
        {
          id: 'invoice',
          type: 'xero.create_invoice',
          position: at(1),
          config: {
            contactName: '{{trigger.clientId}}',
            description: 'Buyers advocacy fee — file {{trigger.purchaseFileId}}',
            unitAmount: '{{trigger.purchasePrice}}',
            dueDate: '14',
          },
        },
        { id: 'wait', type: 'core.delay', position: at(2), config: { duration: '14d' } },
        {
          id: 'chase',
          type: 'core.notify_team',
          position: at(3),
          config: {
            recipient: 'Accounts',
            title: 'Check invoice {{invoice.invoiceNumber}}',
            body: 'Raised for {{invoice.total}} on settlement of {{trigger.purchaseFileId}}. Confirm it has been paid.',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'invoice' },
        { id: 'e2', source: 'invoice', target: 'wait' },
        { id: 'e3', source: 'wait', target: 'chase' },
      ],
    },
  },

  {
    id: 'borrowing-capacity-follow-up',
    name: 'Follow up a borrowing capacity result',
    category: 'finance',
    description:
      'Cross-checks a capacity assessment against real bank data, drafts the explanation, and waits for a human to approve before it is sent.',
    requires: ['basiq', 'anthropic', 'resend'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'platform.borrowing_capacity_completed', position: at(0), config: {} },
        {
          id: 'affordability',
          type: 'basiq.get_affordability',
          position: at(1),
          config: { userId: '{{trigger.clientId}}' },
        },
        {
          id: 'explain',
          type: 'anthropic.messages',
          position: at(2),
          config: {
            model: 'claude-sonnet-4',
            system:
              'You explain borrowing capacity to Australian home buyers. Plain English, no jargon, never give personal financial advice.',
            prompt:
              'Assessment says {{trigger.maxBorrowing}} with {{trigger.lender}}. Bank data shows income {{affordability.monthlyIncome}}, expenses {{affordability.monthlyExpenses}}, surplus {{affordability.surplus}}. Explain what this means and what would move the number.',
            maxTokens: 800,
            temperature: 0.2,
          },
        },
        {
          id: 'approve',
          type: 'core.approval',
          position: at(3),
          config: {
            approver: 'Finance',
            question: 'Send this borrowing capacity explanation?',
            expiresAfter: '2d',
          },
        },
        {
          id: 'send',
          type: 'resend.send_email',
          position: at(4, -1),
          config: {
            to: '{{trigger.clientId}}',
            subject: 'What your borrowing capacity means',
            html: '{{explain.text}}',
          },
        },
        {
          id: 'hold',
          type: 'core.stop',
          position: at(4, 1),
          config: { outcome: 'skipped', reason: 'Held by {{approve.decidedBy}}' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'affordability' },
        { id: 'e2', source: 'affordability', target: 'explain' },
        { id: 'e3', source: 'explain', target: 'approve' },
        { id: 'e4', source: 'approve', target: 'send', sourceBranch: 'approved' },
        { id: 'e5', source: 'approve', target: 'hold', sourceBranch: 'rejected' },
      ],
    },
  },

  {
    id: 'ad-lead-capture',
    name: 'Catch a lead from paid ads',
    category: 'marketing',
    description:
      'Takes a Meta lead form submission, ignores it if it is a repeat, opens the opportunity, and texts them back while they still remember clicking.',
    requires: ['meta_ads', 'gohighlevel', 'twilio'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'meta_ads.lead_received', position: at(0), config: {} },
        {
          id: 'once',
          type: 'core.dedupe',
          position: at(1),
          config: { key: '{{trigger.email}}', window: '30d' },
        },
        {
          id: 'contact',
          type: 'gohighlevel.upsert_contact',
          position: at(2),
          config: {
            email: '{{trigger.email}}',
            firstName: '{{trigger.fullName}}',
            phone: '{{trigger.phone}}',
            tags: ['paid-lead'],
          },
        },
        {
          id: 'opportunity',
          type: 'gohighlevel.create_opportunity',
          position: at(3),
          config: {
            contactId: '{{contact.contactId}}',
            pipelineId: 'Buyers',
            stageId: 'New enquiry',
            name: '{{trigger.fullName}} — {{trigger.campaignName}}',
          },
        },
        {
          id: 'text',
          type: 'twilio.send_sms',
          position: at(4),
          config: {
            to: '{{trigger.phone}}',
            body: 'Hi {{trigger.fullName}}, thanks for the enquiry. When suits for a quick call this week?',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'once' },
        { id: 'e2', source: 'once', target: 'contact' },
        { id: 'e3', source: 'contact', target: 'opportunity' },
        { id: 'e4', source: 'opportunity', target: 'text' },
      ],
    },
  },

  {
    id: 'market-update-broadcast',
    name: 'Turn a market update into social posts',
    category: 'marketing',
    description:
      'Rewrites a published market update for each channel — the same facts, in the voice each platform actually rewards.',
    requires: ['openai', 'linkedin', 'x_twitter'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'platform.market_update_published', position: at(0), config: { suburb: '' } },
        {
          id: 'write',
          type: 'openai.chat',
          position: at(1),
          config: {
            model: 'gpt-4o',
            system:
              'You write for an Australian property advisory. Specific, calm, no hype, no emoji. Never invent a number.',
            prompt:
              'Write two versions of this market update — one for LinkedIn (about 120 words) and one for X (under 260 characters). Separate them with "---".\n\n{{trigger.headline}}\n{{trigger.summary}}',
            maxTokens: 600,
            temperature: 0.4,
          },
        },
        {
          id: 'linkedin',
          type: 'linkedin.share_post',
          position: at(2, -1),
          config: { text: '{{write.text}}' },
        },
        {
          id: 'x',
          type: 'x_twitter.post',
          position: at(2, 1),
          config: { text: '{{write.text}}' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'write' },
        { id: 'e2', source: 'write', target: 'linkedin' },
        { id: 'e3', source: 'write', target: 'x' },
      ],
    },
  },

  {
    id: 'meeting-to-actions',
    name: 'Turn a meeting into tracked actions',
    category: 'ai',
    description:
      'Reads the transcript the moment it lands, extracts what was actually committed to, raises the issues, and posts the recap.',
    requires: ['fireflies', 'openai', 'linear', 'slack'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'fireflies.transcript_ready', position: at(0), config: {} },
        {
          id: 'extract',
          type: 'openai.structured',
          position: at(1),
          config: {
            model: 'gpt-4o',
            input:
              'Extract the commitments from this meeting. Only things someone agreed to do.\n\n{{trigger.transcript}}',
            schema:
              '{"type":"object","properties":{"actions":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"owner":{"type":"string"}},"required":["title","owner"]}}},"required":["actions"]}',
          },
        },
        {
          id: 'raise',
          type: 'linear.create_issue',
          position: at(2),
          config: {
            teamId: 'Advisory',
            title: 'Actions from {{trigger.title}}',
            description: '{{extract.data}}',
            priority: 3,
          },
        },
        {
          id: 'recap',
          type: 'slack.post_message',
          position: at(3),
          config: {
            channel: '#meetings',
            text: '{{trigger.title}}\n\n{{trigger.summary}}\n\nTracked at {{raise.url}}',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'extract' },
        { id: 'e2', source: 'extract', target: 'raise' },
        { id: 'e3', source: 'raise', target: 'recap' },
      ],
    },
  },

  {
    id: 'mcp-research-agent',
    name: 'Run a research agent over MCP',
    category: 'ai',
    description:
      'Asks a connected MCP server what tools it has, calls the right one, backs the answer with live sources, and briefs the team.',
    requires: ['mcp', 'perplexity', 'microsoft_teams'],
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'core.schedule',
          position: at(0),
          config: { preset: 'daily', timeOfDay: '06:00', cron: '0 6 * * *' },
        },
        { id: 'tools', type: 'mcp.list_tools', position: at(1), config: {} },
        {
          id: 'call',
          type: 'mcp.call_tool',
          position: at(2),
          config: {
            toolName: 'search_properties',
            arguments: [{ key: 'state', value: 'VIC' }],
            timeoutSeconds: 30,
          },
        },
        {
          id: 'corroborate',
          type: 'perplexity.search',
          position: at(3),
          config: {
            model: 'sonar',
            query: 'What is moving the Victorian property market right now? Context: {{call.text}}',
            recency: 'day',
          },
        },
        {
          id: 'brief',
          type: 'core.template',
          position: at(4),
          config: {
            template:
              'Morning brief\n\nFrom our data ({{tools.count}} tools available):\n{{call.text}}\n\nWhat the market is saying:\n{{corroborate.answer}}',
          },
        },
        {
          id: 'post',
          type: 'microsoft_teams.post_message',
          position: at(5),
          config: { title: 'Morning market brief', text: '{{brief.text}}' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'tools' },
        { id: 'e2', source: 'tools', target: 'call' },
        { id: 'e3', source: 'call', target: 'corroborate' },
        { id: 'e4', source: 'corroborate', target: 'brief' },
        { id: 'e5', source: 'brief', target: 'post' },
      ],
    },
  },

  {
    id: 'portal-message-triage',
    name: 'Triage a client portal message',
    category: 'client',
    description:
      'Works out whether a portal message needs someone now or just needs recording, so nothing urgent waits behind something routine.',
    requires: ['openai', 'hubspot'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'platform.portal_message_received', position: at(0), config: {} },
        {
          id: 'read',
          type: 'openai.structured',
          position: at(1),
          config: {
            model: 'gpt-4o-mini',
            input: 'How urgent is this client message, and what is it about?\n\n{{trigger.body}}',
            schema:
              '{"type":"object","properties":{"urgency":{"type":"string","enum":["now","routine"]},"topic":{"type":"string"}},"required":["urgency","topic"]}',
          },
        },
        {
          id: 'urgent',
          type: 'core.branch',
          position: at(2),
          config: { left: '{{read.data}}', operator: 'contains', right: 'now' },
        },
        {
          id: 'interrupt',
          type: 'core.notify_team',
          position: at(3, -1),
          config: {
            recipient: 'Advisors',
            title: 'Client needs a reply — {{trigger.clientId}}',
            body: '{{trigger.body}}',
            priority: 'high',
          },
        },
        {
          id: 'log',
          type: 'hubspot.log_note',
          position: at(3, 1),
          config: { contactId: '{{trigger.clientId}}', note: 'Portal message: {{trigger.body}}' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'read' },
        { id: 'e2', source: 'read', target: 'urgent' },
        { id: 'e3', source: 'urgent', target: 'interrupt', sourceBranch: 'true' },
        { id: 'e4', source: 'urgent', target: 'log', sourceBranch: 'false' },
      ],
    },
  },

  {
    id: 'signed-contract-filing',
    name: 'File a signed contract',
    category: 'operations',
    description:
      'When an envelope completes, the executed copy goes straight to the drive and the team is told — before anyone asks where it is.',
    requires: ['docusign', 'google_drive'],
    graph: {
      nodes: [
        { id: 'trigger', type: 'docusign.envelope_completed', position: at(0), config: {} },
        {
          id: 'file',
          type: 'google_drive.upload',
          position: at(1),
          config: {
            fileUrl: '{{trigger.documentUrl}}',
            name: 'Executed contract — {{trigger.envelopeId}}',
            folderId: 'Contracts',
          },
        },
        {
          id: 'tell',
          type: 'core.notify_team',
          position: at(2),
          config: {
            recipient: 'Operations',
            title: 'Contract signed by {{trigger.signerEmail}}',
            body: 'Filed at {{file.webViewLink}}.',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'file' },
        { id: 'e2', source: 'file', target: 'tell' },
      ],
    },
  },
];
