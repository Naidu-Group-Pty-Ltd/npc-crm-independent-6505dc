/**
 * User guide sections that were never written.
 *
 * The guide covered 32 areas while the app shipped 191 routes, and the gap was
 * not random — it was everything added after the guide was first assembled.
 * AML/CTF had zero coverage despite being a Launch-tier baseline feature AND a
 * headline priced module; three of the four partner portals were absent, as
 * were Commercial/Industrial, Market Updates, Model Hub and Game Plan.
 *
 * The reason it drifted is structural: the section list lived in three
 * hand-maintained copies — this guide's page, the AI knowledge base, and a
 * hardcoded link list inside the assistant's edge function. Keeping three
 * copies in step is work nobody remembers to do, so it stopped happening.
 *
 * These sections live here, as data, and are consumed by both the page and the
 * knowledge base. The edge function now derives its link list from the
 * knowledge base rather than repeating it. One place to edit, and
 * `userGuide.coverage.test.ts` fails if a priced module has no section.
 */

export interface GuideItem {
  title: string;
  description: string;
  features?: string[];
  steps?: string[];
  tips?: string[];
  shortcuts?: { keys: string[]; description: string }[];
}

export interface GuideSectionContent {
  id: string;
  title: string;
  description: string;
  /**
   * Lucide icon name. Kept as a string so this file stays free of React
   * imports and can be consumed by the knowledge base, which has no UI.
   */
  icon: string;
  /** Pricing-catalogue slug this section documents, when it maps to one. */
  moduleSlug?: string;
  items: GuideItem[];
}

export const ADDITIONAL_GUIDE_SECTIONS: GuideSectionContent[] = [
  // ── AML / CTF ──────────────────────────────────────────────────────
  {
    id: 'aml-ctf',
    title: 'AML / CTF Compliance',
    description: 'Customer due diligence, screening, monitoring and AUSTRAC reporting',
    icon: 'ShieldCheck',
    moduleSlug: 'aml-ctf',
    items: [
      {
        title: 'Compliance Home',
        description:
          'The AML workspace opens on Compliance Home, which summarises where obligations stand right now: total cases, cases opened recently, cases awaiting a decision, open alerts, unprocessed events and periodic reviews falling due.',
        features: [
          'Metric tiles link straight through to the filtered list behind them',
          'My Queue shows only the cases assigned to you',
          'Regulatory & Assurance header flags anything overdue',
          'Legacy alias banner appears where an older workspace name is still in use',
        ],
        tips: [
          'Start at Compliance Home rather than Cases — the tiles surface what is blocked, which a raw case list does not.',
        ],
      },
      {
        title: 'Cases & the Case Workspace',
        description:
          'A case tracks one subject through customer due diligence. Cases move through a defined lifecycle and cannot skip states — the allowed transitions are enforced server-side, not just in the UI.',
        features: [
          'Statuses: draft, KYC in progress, KYC complete, EDD required, under review, escalated to MLRO, cleared, blocked, closed',
          'Risk ratings: low, medium, high, prohibited',
          'Case workspace tabs cover verification, ownership and control, structures, documents and events',
          'Every write appends to a per-case event log with a SHA-256 hash chain, so tampering is detectable',
        ],
        steps: [
          'Open Cases and create a case against the subject',
          'Complete identity verification in the Verification tab',
          'Record ownership and control for non-individual subjects',
          'Move the case to under review once KYC is complete',
          'Escalate to the MLRO where enhanced due diligence is required',
        ],
        tips: [
          'The event log is append-only. Correcting a mistake means adding a correcting event, not editing history.',
        ],
      },
      {
        title: 'Verification & Screening',
        description:
          'Verification captures identity evidence for a subject. Screening checks subjects against PEP and sanctions sources and records the result against the case.',
        features: [
          'Identity checks recorded per subject with provider results retained',
          'PEP and sanctions hits raise an event on the case',
          'Screening results are versioned so a later re-screen does not overwrite the earlier decision',
          'Step-up authentication is required before sensitive actions',
        ],
        tips: [
          'A step-up prompt is not an error. Sensitive AML actions deliberately re-verify who you are before proceeding.',
        ],
      },
      {
        title: 'Risk, Transactions & Monitoring',
        description:
          'Risk scores a subject from the factors recorded against them. Transaction Compliance and Monitoring watch activity for patterns that need review.',
        features: [
          'Risk ratings can be re-scored as new information arrives, with each change logged',
          'Transaction monitoring raises alerts against thresholds and rules',
          'Unprocessed events queue surfaces anything the engine has not yet triaged',
          'Counterparty due diligence covers the other side of a transaction',
        ],
      },
      {
        title: 'Investigations & EDD',
        description:
          'Where a case needs enhanced due diligence, Investigations holds the working record: what was asked, what was received and what was concluded.',
        features: [
          'EDD notes attach to the case event chain',
          'MLRO decisions are recorded as their own event category',
          'Investigations can be escalated or returned to standard review',
        ],
      },
      {
        title: 'AUSTRAC Hub & Reporting',
        description:
          'The AUSTRAC Hub prepares and tracks regulatory reports. Reports are generated from case data rather than re-keyed.',
        features: [
          'Report drafts built from the underlying case record',
          'Submission status tracked per report',
          'Records & Retention governs how long material is kept',
        ],
        tips: [
          'Check Records & Privacy before deleting anything — retention obligations outlast a closed case.',
        ],
      },
      {
        title: 'Governance, Intake & Launch Operations',
        description:
          'Governance holds the compliance contacts and organisational settings. Intake Queue is where new subjects arrive before a case is opened. Launch Operations covers rollout and cutover activity.',
        features: [
          'Governance & Contacts records the MLRO and responsible officers',
          'Intake Queue triages inbound subjects into cases',
          'Organisation Settings configure thresholds and provider modes',
          'Platform Administration covers integration health and version cutover',
        ],
      },
      {
        title: 'Roles & Access',
        description:
          'AML access is separate from general dashboard permission. Reads require an AML role; writes require the specific role for that action, and the service enforces this in code as well as through row-level security.',
        features: [
          'Analyst, reviewer and MLRO roles carry different write permissions',
          'MLRO-only event categories cannot be written by an analyst',
          'Restricted AML data is hidden entirely from users without a role',
        ],
      },
    ],
  },

  // ── Finance Portal ─────────────────────────────────────────────────
  {
    id: 'finance-portal',
    title: 'Finance Portal',
    description: 'Broker and finance partner workspace, referrals and commissions',
    icon: 'Landmark',
    moduleSlug: 'finance-portal',
    items: [
      {
        title: 'Portal Overview',
        description:
          'The Finance Portal is a separate login for finance partners. They see only the clients and files shared with them, never your whole book.',
        features: [
          'Dashboard summarising active files and outstanding actions',
          'Clients list scoped to assigned relationships',
          'Client inbox and messaging with the referring adviser',
          'Insights and lender intelligence for the partner',
        ],
      },
      {
        title: 'Purchase Files',
        description:
          'A purchase file is the unit of work in the portal: one client purchase, tracked from referral through to settlement.',
        features: [
          'File detail view with documents, milestones and messages',
          'Pipeline view showing where every file sits',
          'AML case snapshot surfaces compliance status against the file',
        ],
      },
      {
        title: 'Earnings & Commissions',
        description:
          'Earnings track what a partner has been paid and what is pending. Commission structures and clawbacks are administered from the staff side.',
        features: [
          'Earnings statement per partner',
          'Commission register with clawback tracking',
          'Bulk import for historical commission data',
        ],
      },
      {
        title: 'Administering the Portal',
        description:
          'Staff manage the portal from Admin → Finance Portal: inviting contacts, assigning clients, and reviewing activity.',
        steps: [
          'Invite a finance contact from Admin → Finance Portal',
          'Assign clients or purchase files to the contact',
          'Monitor activity and compliance from the admin panels',
        ],
        features: [
          'Analytics, compliance and health panels for portal operations',
          'Activity log per partner',
          'Staff-side message view mirroring the partner inbox',
        ],
      },
    ],
  },

  // ── Solicitor Portal ───────────────────────────────────────────────
  {
    id: 'solicitor-portal',
    title: 'Solicitor Portal',
    description: 'Conveyancing partner workspace and legal matters',
    icon: 'Scale',
    items: [
      {
        title: 'Matters',
        description:
          'A matter is a legal file attached to a client purchase. Solicitors log in separately and see only the matters assigned to them.',
        features: [
          'Matters list with status and key dates',
          'Matter detail holding documents, correspondence and milestones',
          'Pipeline view across all assigned matters',
        ],
      },
      {
        title: 'Client Legal Workspace',
        description:
          'On the staff side, the legal workspace on a client shows the matter without leaving the client record.',
        features: [
          'Legal tab on the client with matter status',
          'Document exchange with the solicitor',
          'Security settings governing what the partner can see',
        ],
      },
      {
        title: 'Onboarding a Solicitor',
        description:
          'Solicitors are invited from Admin → Solicitor Portal and complete their own onboarding, including accepting terms.',
        steps: [
          'Send an invite from Admin → Solicitor Portal',
          'The solicitor accepts, sets a password and agrees to terms',
          'Assign matters to the onboarded firm',
        ],
      },
    ],
  },

  // ── Builder Portal ─────────────────────────────────────────────────
  {
    id: 'builder-portal',
    title: 'Builder Portal',
    description: 'Builder partner workspace and organisation access',
    icon: 'Hammer',
    items: [
      {
        title: 'Builder Access',
        description:
          'Builders log in through their own portal and can belong to more than one organisation, selecting which they are acting for.',
        features: [
          'Separate builder login and password reset flow',
          'Organisation selection where a builder works across entities',
          'Builder settings and terms acceptance',
        ],
      },
      {
        title: 'Administering Builders',
        description:
          'Staff manage builder access from Admin → Builder Portal: invitations, organisation membership and activity review.',
        steps: [
          'Invite the builder from Admin → Builder Portal',
          'Assign them to one or more organisations',
          'Review activity from the admin panel',
        ],
      },
    ],
  },

  // ── Commercial & Industrial ────────────────────────────────────────
  {
    id: 'commercial-industrial',
    title: 'Commercial & Industrial',
    description: 'Non-residential property analysis and calculators',
    icon: 'Building2',
    moduleSlug: 'commercial-industrial',
    items: [
      {
        title: 'Commercial Properties',
        description:
          'Commercial listings are analysed separately from residential because the drivers differ — yield, lease terms and outgoings rather than rental yield alone.',
        features: [
          'Commercial property list with filtering',
          'Property detail with commercial-specific metrics',
          'Scenario modelling through the commercial calculators',
        ],
      },
      {
        title: 'Industrial Properties',
        description:
          'Industrial stock has its own list and detail view, with calculators tuned to industrial metrics.',
        features: [
          'Industrial property list and detail',
          'Industrial calculators for site and building metrics',
        ],
      },
      {
        title: 'Property Calculators',
        description:
          'The calculators page collects the standalone tools for modelling a purchase without creating a full report.',
        tips: [
          'Use the calculators for a quick sanity check; use a full report when the numbers need to be shared or retained.',
        ],
      },
    ],
  },

  // ── Market Updates ─────────────────────────────────────────────────
  {
    id: 'market-updates',
    title: 'Market News Feed',
    description: 'Curated market intelligence, digests and shareable Q&A',
    icon: 'Newspaper',
    moduleSlug: 'market-updates',
    items: [
      {
        title: 'Market Feed',
        description:
          'Market News Feed ingests configured sources, scores each item for relevance, and surfaces what matters rather than everything published.',
        features: [
          'Relevance and confidence thresholds filter low-value items',
          'Source list is administered from the Market Sources dialog',
          'Public feed URL for embedding elsewhere',
        ],
      },
      {
        title: 'Market Q&A',
        description:
          'Ask questions against the ingested market material and get an answer grounded in the sources, with the material it drew on.',
        features: [
          'Voice input for asking questions hands-free',
          'Answers can be shared via a tokenised public link',
          'Quality reporting on answers from the admin side',
        ],
      },
      {
        title: 'Digests & Subscriptions',
        description:
          'Digests bundle recent market movement on a schedule. Subscriptions control who receives them.',
        features: [
          'Scheduled digest generation',
          'Per-recipient subscription management',
          'Shared answers accessible without a login via their token',
        ],
      },
    ],
  },

  // ── Model Hub ──────────────────────────────────────────────────────
  {
    id: 'model-hub',
    title: 'Model Hub',
    description: 'AI model selection, availability and cost',
    icon: 'Cpu',
    moduleSlug: 'model-hub',
    items: [
      {
        title: 'Browsing Models',
        description:
          'Model Hub lists the AI models available through the routed provider, with their pricing and context limits, so a model can be chosen on cost as well as capability.',
        features: [
          'Model table with pricing per million tokens and context window',
          'Card view for comparing candidates',
          'Availability checked against the provider rather than assumed',
        ],
      },
      {
        title: 'Assigning Models to Agents',
        description:
          'Different jobs justify different models. Assignments map an agent key to a model, so report generation and quick chat need not share one.',
        tips: [
          'Check API Usage after changing an assignment — a more capable model changes cost per report, not just quality.',
        ],
      },
    ],
  },

  // ── Game Plan ──────────────────────────────────────────────────────
  {
    id: 'game-plan',
    title: 'Game Plan',
    description: 'Client strategy plans, phases and assigned tasks',
    icon: 'Target',
    items: [
      {
        title: 'Building a Plan',
        description:
          'A game plan sets out a client strategy as phases over a timeline, each holding the tasks that move it forward.',
        features: [
          'Phases with their own dates and rich-text detail',
          'Timeline bar showing the plan at a glance',
          'Tasks assigned to team members with due dates',
        ],
        steps: [
          'Create a plan against the client',
          'Add phases covering each stage of the strategy',
          'Add tasks to each phase and assign owners',
        ],
      },
      {
        title: 'Assigned Tasks',
        description:
          'The assigned tasks view collects everything allocated to you across every plan, so nothing depends on remembering which client it belonged to.',
      },
    ],
  },

  // ── Partner Network ────────────────────────────────────────────────
  {
    id: 'partner-network',
    title: 'Partner Network',
    description: 'Partner agreements, compliance and referrals',
    icon: 'Handshake',
    items: [
      {
        title: 'Partner Agreements',
        description:
          'Agreements record the terms a partner operates under, including when an agreement is terminated and why.',
        features: [
          'Agreement register per partner',
          'Termination dialog capturing the reason and effective date',
        ],
      },
      {
        title: 'Partner Compliance',
        description:
          'Compliance tracks partner obligations, including privacy incidents raised against a partner.',
        features: [
          'Privacy incident logging with follow-up',
          'Compliance status per partner',
        ],
      },
      {
        title: 'Partner Referrals',
        description:
          'Referrals move a client between your business and a partner, with consent captured explicitly before anything is shared.',
        features: [
          'Referral dialog and detail sheet',
          'Consent panel recording what the client agreed to share',
          'Loan writer assignment and undertakings',
          'Public consent page reachable by token, so a client can consent without an account',
        ],
        tips: [
          'Consent is recorded per referral. Re-referring the same client later asks again rather than reusing the earlier consent.',
        ],
      },
    ],
  },

  // ── Quantitative Reports ───────────────────────────────────────────
  {
    id: 'quantitative-reports',
    title: 'Quantitative Reports',
    description: 'Listings-level market analytics',
    icon: 'BarChart4',
    items: [
      {
        title: 'Reporting Command Centre',
        description:
          'Quantitative reports aggregate listing data into market-level views — volumes, pricing and distribution by suburb.',
        features: [
          'Totals for listings, average price and unique suburbs',
          'Listings by suburb breakdown',
          'Recent listings feed',
          'Individual report detail views',
        ],
      },
    ],
  },

  // ── PDF Import ─────────────────────────────────────────────────────
  {
    id: 'pdf-import',
    title: 'PDF Import & Report Ingestion',
    description: 'Importing existing reports and monitoring the ingestion engine',
    icon: 'FileInput',
    items: [
      {
        title: 'Importing Reports',
        description:
          'Existing PDF reports can be ingested so their content becomes searchable and reusable rather than sitting as a flat file.',
        features: [
          'Client report import with extraction into structured data',
          'Import quality scoring per document',
        ],
      },
      {
        title: 'Engine Administration',
        description:
          'The ingestion engine is administered from a set of admin pages, because extraction quality drifts as source documents change.',
        features: [
          'Diagnostics for a single import, showing what was extracted and what failed',
          'Monitoring across all imports for failure rate and throughput',
          'Golden regression suite catching quality regressions before they ship',
          'Retention settings governing how long imported source files are kept',
        ],
        tips: [
          'Check Diagnostics before re-importing a failed document — a repeat import of an unreadable file fails the same way.',
        ],
      },
    ],
  },

  // ── Billing & Usage ────────────────────────────────────────────────
  {
    id: 'billing-usage',
    title: 'Billing & Usage',
    description: 'Plan, token balance, invoices and payment methods',
    icon: 'CreditCard',
    items: [
      {
        title: 'Token Balance',
        description:
          'Report generation and AI features consume tokens drawn from your balance. The balance combines your plan allowance with any top-up packs bought on top.',
        features: [
          'Balance pill visible while working',
          'Cost estimate shown before an expensive action runs',
          'Out-of-tokens banner when the balance will not cover the next action',
          'Token event history explaining what each deduction paid for',
        ],
        tips: [
          'Allowance and top-ups share one balance and are spent soonest-to-expire first, so an allowance is always consumed before a pack you bought.',
        ],
      },
      {
        title: 'Plan & Invoices',
        description:
          'Your plan determines which modules are available. Changing plan takes effect against your workspace and is reflected in a banner when it happens.',
        features: [
          'Invoice history with downloadable records',
          'Payment method management',
          'Plan change banner confirming what changed',
        ],
      },
      {
        title: 'Report Cost',
        description:
          'Each report carries a cost badge so the token price is visible before generating, not discovered afterwards.',
      },
    ],
  },

  // ── Lenders ────────────────────────────────────────────────────────
  {
    id: 'lender-intelligence',
    title: 'Lenders & Lender Intelligence',
    description: 'Lender policies, rates and comparison',
    icon: 'Banknote',
    items: [
      {
        title: 'Lender Register',
        description:
          'The lender list holds the institutions you work with and the policy detail that affects borrowing capacity.',
        features: [
          'Lender records with policy attributes',
          'Comparison across lenders for a given scenario',
        ],
      },
      {
        title: 'Lender Intelligence',
        description:
          'Lender intelligence surfaces rate and policy movement, including data drawn from the CDR lending rates service.',
        tips: [
          'Borrowing capacity results depend on lender policy. A capacity figure is only as current as the lender record behind it.',
        ],
      },
    ],
  },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard Shortcuts',
    icon: 'Keyboard',
    description: 'Quick actions for power users',
    items: [
      {
        title: 'Global Shortcuts',
        description: 'Shortcuts available throughout the application.',
        shortcuts: [
          { keys: ['⌘/Ctrl', 'K'], description: 'Open search / history search' },
          { keys: ['⌘/Ctrl', 'N'], description: 'New chat (in Aurixa Intelligence Hub)' },
          { keys: ['⌘/Ctrl', '/'], description: 'Focus message input' },
          { keys: ['Esc'], description: 'Close dialogs / Exit full screen' },
        ],
      },
      {
        title: 'Aurixa Intelligence Hub Shortcuts',
        description: 'Shortcuts specific to the AI chat interface.',
        shortcuts: [
          { keys: ['⌘/Ctrl', '⇧', 'C'], description: 'Copy last response' },
          { keys: ['⌘/Ctrl', 'J'], description: 'Scroll to bottom' },
          { keys: ['⌘/Ctrl', 'B'], description: 'Toggle reports panel' },
          { keys: ['⌘/Ctrl', 'Enter'], description: 'Toggle full screen' },
          { keys: ['Enter'], description: 'Send message' },
          { keys: ['Shift', 'Enter'], description: 'New line in message' },
        ],
      },
      {
        title: 'Calendar Shortcuts',
        description: 'Shortcuts for calendar navigation.',
        shortcuts: [
          { keys: ['T'], description: 'Go to today' },
          { keys: ['←', '→'], description: 'Navigate periods' },
          { keys: ['D'], description: 'Day view' },
          { keys: ['W'], description: 'Week view' },
          { keys: ['M'], description: 'Month view' },
          { keys: ['?'], description: 'Show shortcuts help' },
        ],
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    icon: 'AlertCircle',
    description: 'Common issues and solutions',
    items: [
      {
        title: 'Report Generation Issues',
        description: 'Solutions for common report generation problems.',
        tips: [
          'If "Data Unavailable" appears, try a broader analysis mode (Address → Postcode → State)',
          'Complex analysis can take 3-7 minutes depending on data availability',
          'Avoid generating multiple reports simultaneously',
          'Check your internet connection for timeouts',
          'Verify property addresses are correctly formatted',
        ],
      },
      {
        title: 'Data Sync Issues',
        description: 'Troubleshooting data synchronization problems.',
        tips: [
          'Check the Monitoring page for API health status',
          'Manual sync can be triggered from Sources page',
          'Allow up to 24 hours for market data updates',
          'Contact support if sync failures persist',
        ],
      },
      {
        title: 'Email Copilot Issues',
        description: 'Solutions for email-related problems.',
        tips: [
          'Verify email credentials in Settings',
          'Check mailbox permissions for OAuth connections',
          'AI summaries require email body content',
          'Refresh the page if emails aren\'t loading',
        ],
      },
      {
        title: 'Best Practices',
        description: 'Tips for optimal system usage.',
        tips: [
          'Use complete addresses with suburb, state, and postcode',
          'Generate reports after major market events for current data',
          'Use consistent financial assumptions when comparing properties',
          'Regularly review and update client information',
          'Export important reports for offline access',
        ],
      },
    ],
  },
];

/** Section ids added by this file — used by the coverage test. */
export const ADDITIONAL_SECTION_IDS = ADDITIONAL_GUIDE_SECTIONS.map((s) => s.id);
