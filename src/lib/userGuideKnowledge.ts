/**
 * User Guide Knowledge Base — the context the AI assistant answers from.
 *
 * The sections below were originally hand-copied out of UserGuide.tsx, which
 * is why the two drifted: two copies of the same prose, updated by hand, with
 * nothing to catch a section added to one and not the other.
 *
 * New content lives in `userGuideSections.ts` and is appended here rather than
 * duplicated, so page and knowledge base cannot disagree about what exists.
 * `userGuideCoverage.test.ts` enforces that.
 */

import {
  ADDITIONAL_GUIDE_SECTIONS,
  type GuideSectionContent,
} from './userGuideSections';
import { filterEntitledSections } from './userGuideEntitlements';
import {
  MODULE_TIERS,
  SUB_MODULE_ENTITLEMENTS,
  isKnownPlan,
  type PlanSlug,
} from './pricing/planEntitlements';

export interface GuideSection {
  id: string;
  title: string;
  description: string;
  items: GuideItem[];
}

export interface GuideItem {
  title: string;
  description: string;
  features?: string[];
  steps?: string[];
  tips?: string[];
  shortcuts?: { keys: string[]; description: string }[];
}

const baseGuideKnowledge: GuideSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    description: 'Essential navigation and dashboard overview',
    items: [
      {
        title: 'Dashboard Overview',
        description: 'The main dashboard provides a comprehensive view of your property data with key performance indicators (KPIs), charts, and recent activity.',
        features: [
          'Real-time data updates across all modules',
          'Interactive charts and visualizations',
          'Quick access to all sections via sidebar navigation',
          'Notification center for alerts and updates',
        ],
      },
      {
        title: 'Navigation & Sidebar',
        description: 'Use the collapsible sidebar to navigate between different sections. The active page is highlighted for easy reference.',
        features: [
          'Collapsible sidebar for more screen space',
          'Quick search functionality (Ctrl/⌘ + K)',
          'User profile and settings access',
          'Role-based menu visibility',
        ],
      },
    ],
  },
  {
    id: 'client-management',
    title: 'Client Management',
    description: 'Comprehensive CRM for managing investor clients',
    items: [
      {
        title: 'Client Tracker',
        description: 'The Client Tracker is your central hub for managing all client relationships, tracking their investment journey, and maintaining detailed records.',
        features: [
          'Client cards with key financial summaries',
          'Pipeline stage tracking for each client',
          'Favorite clients for quick access',
          'Advanced filtering by status, tags, and activity',
          'Bulk actions for efficient management',
        ],
        steps: [
          'Navigate to "Client Tracker" in the sidebar',
          'Use the search bar to find specific clients',
          'Click on a client card to view full details',
          'Use tabs to navigate between Personal, Employment, Financials, Properties, Emails, Notes, and Reports',
          'Update client information directly in the modal',
        ],
      },
      {
        title: 'Client Details & Financials',
        description: 'Each client profile contains comprehensive financial information for borrowing capacity and portfolio analysis.',
        features: [
          'Personal and employment details',
          'Income sources with multiple entry types',
          'Expense tracking by category',
          'Assets and liabilities management',
          'Property portfolio overview',
          'Borrowing capacity calculations',
        ],
      },
      {
        title: 'Client Notes & Reminders',
        description: 'Keep detailed notes and set reminders for follow-ups and important dates.',
        features: [
          'Rich text notes with timestamps',
          'Voice note recording capability',
          'Reminder scheduling with priority levels',
          'Activity timeline showing all interactions',
        ],
      },
      {
        title: 'Client Tags & Segmentation',
        description: 'Organize clients with custom tags for better segmentation and targeting.',
        features: [
          'Create custom colored tags',
          'Assign multiple tags per client',
          'Filter clients by tag combinations',
          'Bulk tag assignment',
        ],
      },
      {
        title: 'Portfolio Analysis Reports',
        description: 'Generate comprehensive portfolio health reports for your clients.',
        features: [
          'Overall portfolio health scoring',
          'Property-by-property breakdown',
          'Equity and cashflow analysis',
          'LVR and yield calculations',
          'PDF export with professional formatting',
        ],
        steps: [
          'Open a client\'s details modal',
          'Navigate to the "Reports" tab',
          'Click "Generate Portfolio Analysis"',
          'Wait for the AI to analyze all properties',
          'Download the PDF report',
        ],
      },
    ],
  },
  {
    id: 'email-copilot',
    title: 'Email Copilot',
    description: 'AI-powered email management and automation',
    items: [
      {
        title: 'Email Overview',
        description: 'The Email Copilot centralizes all client communications with AI-powered features for drafting, summarizing, and managing emails.',
        features: [
          'Unified inbox for admin and personal mailboxes',
          'AI-generated email summaries',
          'Smart draft replies with context awareness',
          'Urgency detection and prioritization',
          'Client linking for organized communications',
        ],
      },
      {
        title: 'Managing Emails',
        description: 'Process and organize incoming emails efficiently with AI assistance.',
        steps: [
          'Navigate to "Email Copilot" in the sidebar',
          'View inbox organized by urgency and status',
          'Click on an email to see full content and AI summary',
          'Use "Generate AI Reply" for smart draft responses',
          'Link emails to specific clients for tracking',
          'Mark emails as processed when complete',
        ],
      },
      {
        title: 'Linking Emails to Clients',
        description: 'Associate email threads with specific clients for organized tracking.',
        features: [
          'Search and select clients from the dropdown',
          'View all linked emails in client details',
          'Track communication history per client',
          'Quick access from both Email Copilot and Client Tracker',
        ],
      },
      {
        title: 'Email Actions',
        description: 'Take action on emails directly from the copilot interface.',
        features: [
          'Generate AI-powered reply drafts',
          'Mark as processed/pending/follow-up',
          'Set urgency levels (low, normal, high, critical)',
          'Compose and send replies with signature',
          'Archive completed conversations',
        ],
      },
    ],
  },
  {
    id: 'report-qa',
    title: 'Aurixa Intelligence Hub (AI Chat)',
    description: 'AI-powered assistant for property report analysis',
    items: [
      {
        title: 'AI Chat Overview',
        description: 'The Aurixa Intelligence Hub feature allows you to have natural conversations with an AI assistant that has access to your property reports and market data.',
        features: [
          'Natural language queries about properties',
          'Context-aware responses using your report data',
          'Multi-turn conversations with memory',
          'PDF document attachment and analysis',
          'Voice message input support',
        ],
      },
      {
        title: 'Using the AI Chat',
        description: 'Ask questions about properties, market trends, and investment analysis.',
        steps: [
          'Navigate to "Aurixa Intelligence Hub" in the sidebar',
          'Select reports from the sidebar to provide context',
          'Type your question in the message input',
          'Use voice recording for hands-free input',
          'Review AI responses with source citations',
          'Follow up with clarifying questions',
        ],
        tips: [
          'Attach specific reports for more accurate answers',
          'Ask comparative questions across multiple properties',
          'Request summaries of complex report sections',
          'Use follow-up suggestions for deeper analysis',
        ],
      },
      {
        title: 'Conversation Management',
        description: 'Organize and manage your AI chat history.',
        features: [
          'Pin important conversations',
          'Tag conversations by topic',
          'Search conversation history (⌘/Ctrl + K)',
          'Export conversations as PDF or text',
          'Start new chats (⌘/Ctrl + N)',
        ],
      },
      {
        title: 'Advanced Features',
        description: 'Power user features for enhanced productivity.',
        features: [
          'Full-screen mode (⌘/Ctrl + Enter)',
          'Text-to-speech for responses',
          'Message reactions for feedback',
          'Auto-summarize long responses',
          'Theme customization',
          'Accessibility settings',
        ],
      },
    ],
  },
  {
    id: 'property-management',
    title: 'Property Management',
    description: 'View and manage property listings',
    items: [
      {
        title: 'Property Marketplace',
        description: 'View and manage all property listings with advanced filtering and search capabilities.',
        features: [
          'Search by address, suburb, or postcode',
          'Filter by property type, price range, and status',
          'View detailed property information',
          'Generate investment reports for individual properties',
          'Compare multiple properties side-by-side',
        ],
      },
      {
        title: 'Property Filters',
        description: 'Use filters to narrow down properties based on your criteria.',
        features: [
          'State and suburb filtering',
          'Property type selection (house, unit, land, etc.)',
          'Price range filtering with min/max',
          'Status filtering (active, pending, sold, withdrawn)',
          'Save filter presets for quick access',
        ],
      },
      {
        title: 'Property Details',
        description: 'View comprehensive information about each property.',
        features: [
          'Property specifications and features',
          'Price history and market comparison',
          'Location insights and amenities',
          'Agent and agency information',
          'Quick report generation buttons',
        ],
      },
    ],
  },
  {
    id: 'cash-flow-analysis',
    title: 'Cash Flow Analysis',
    description: 'Detailed property cash flow modeling',
    items: [
      {
        title: 'Cash Flow Calculator',
        description: 'Model the cash flow of investment properties with detailed income and expense projections.',
        features: [
          'Rental income projections',
          'Operating expense calculations',
          'Loan repayment modeling',
          'Tax benefit analysis',
          'Net cash flow visualization',
        ],
      },
      {
        title: 'Scenario Comparison',
        description: 'Compare different investment scenarios side-by-side.',
        features: [
          'Multiple property comparison',
          'Interest rate sensitivity analysis',
          'Occupancy rate impact modeling',
          'Growth rate projections',
          'Export comparison reports',
        ],
      },
    ],
  },
  {
    id: 'borrowing-capacity',
    title: 'Borrowing Capacity',
    description: 'Calculate client borrowing power',
    items: [
      {
        title: 'Capacity Calculator',
        description: 'Calculate borrowing capacity based on income, expenses, and existing commitments using bank-approved methodologies.',
        features: [
          'Gross and net income calculation',
          'Living expense modeling (HEM/declared)',
          'Existing commitment factoring',
          'Buffer rate application',
          'Serviceability assessment',
        ],
      },
      {
        title: 'Conservative Mode',
        description: 'Apply stricter lending criteria for more realistic capacity estimates.',
        features: [
          '$1,000/mo minimum surplus floor',
          '$1,500 residual income floor',
          '85% surplus utilization',
          '6x DTI (debt-to-income) cap',
          'Lender-specific adjustments',
        ],
        tips: [
          'Use Conservative Mode for client-facing quotes',
          'Standard mode shows theoretical maximum',
          'Compare both modes to set expectations',
        ],
      },
      {
        title: 'Saving Assessments',
        description: 'Save borrowing capacity assessments to client profiles.',
        steps: [
          'Complete the borrowing capacity calculation',
          'Review the results and recommendations',
          'Click "Save to Client" button',
          'Select the client from the dropdown',
          'Access saved assessments from client details',
        ],
      },
    ],
  },
  {
    id: 'call-logs',
    title: 'Call Logs',
    description: 'AI-powered call recording and analysis',
    items: [
      {
        title: 'Call Management',
        description: 'Track and analyze all client calls with AI-powered transcription and insights.',
        features: [
          'Automatic call recording',
          'AI transcription of conversations',
          'Sentiment analysis',
          'Key topic extraction',
          'Call duration and status tracking',
        ],
      },
      {
        title: 'Call Analysis',
        description: 'Extract insights from recorded calls.',
        features: [
          'Full transcript review',
          'Speaker identification',
          'Action item extraction',
          'Follow-up task creation',
          'Client linking for context',
        ],
      },
      {
        title: 'Alert Rules',
        description: 'Set up automated alerts based on call content or metrics.',
        features: [
          'Keyword-based triggers',
          'Duration thresholds',
          'Sentiment-based alerts',
          'Custom notification rules',
          'Team notification routing',
        ],
      },
    ],
  },
  {
    id: 'automation',
    title: 'Auto Report Generation',
    description: 'Automated report generation and workflows',
    items: [
      {
        title: 'Auto-Report Switches',
        description: 'Configure automated report generation based on property criteria.',
        features: [
          'Criteria-based triggers (price, location, type)',
          'Priority ordering for multiple switches',
          'Enable/disable individual switches',
          'Generation logging and history',
          'Master toggle for all automation',
        ],
        steps: [
          'Navigate to "Auto Report Generation" in the sidebar',
          'Click "Add Switch" to create a new automation',
          'Configure trigger criteria (state, price range, property type)',
          'Set priority order for switch evaluation',
          'Enable the switch and master toggle',
          'Monitor generation logs for activity',
        ],
      },
      {
        title: 'Generation Logs',
        description: 'View history of all automated report generations.',
        features: [
          'Success/failure status for each generation',
          'Property details and switch that triggered',
          'Error messages for troubleshooting',
          'Timestamp and duration tracking',
          'Link to generated reports',
        ],
      },
    ],
  },
  {
    id: 'reports-analytics',
    title: 'Reports & Analytics',
    description: 'Investment reports and data visualization',
    items: [
      {
        title: 'Investment Report Generation',
        description: 'Create comprehensive property investment analysis reports with AI-powered insights.',
        features: [
          '13-section comprehensive analysis',
          'Market KPIs and pricing trends',
          'Demographics and demand analysis',
          'Risk assessment (flood, bushfire, crime)',
          'Financial projections with depreciation',
        ],
        steps: [
          'Go to "Property Marketplace" and find your target property',
          'Click "Generate Report" on the property card',
          'Choose analysis mode (Address/Postcode/State)',
          'Configure financial assumptions',
          'Wait for AI analysis (2-5 minutes)',
          'Review and download the report',
        ],
      },
      {
        title: 'Generated Reports',
        description: 'Access and manage all your generated investment reports.',
        features: [
          'Report library with search and filters',
          'PDF download and sharing',
          'Report versioning history',
          'Bookmarking for quick access',
          'Usage analytics',
        ],
      },
      {
        title: 'Charts & Visualization',
        description: 'Create custom charts for market analysis and presentations.',
        features: [
          'Multiple chart types (bar, line, pie, scatter)',
          'Custom data filtering and grouping',
          'Export as images or PDFs',
          'Real-time data updates',
          'Comparative analysis tools',
        ],
      },
      {
        title: 'Portfolio Reports',
        description: 'Generate portfolio-level analysis across multiple properties.',
        features: [
          'Multi-property health scoring',
          'Diversification analysis',
          'Combined cash flow projections',
          'Risk distribution overview',
          'Client-ready PDF exports',
        ],
      },
    ],
  },
  {
    id: 'data-import',
    title: 'Data Import',
    description: 'Import client and property data',
    items: [
      {
        title: 'Excel Import',
        description: 'Bulk import clients and properties from Excel spreadsheets.',
        features: [
          'Template download for correct formatting',
          'Column mapping assistance',
          'Validation and error reporting',
          'Duplicate detection',
          'Import history logging',
        ],
        steps: [
          'Navigate to "Data Import" in the sidebar',
          'Download the import template',
          'Fill in your data following the template format',
          'Upload the completed spreadsheet',
          'Review validation results',
          'Confirm and complete the import',
        ],
      },
      {
        title: 'Formara Forms',
        description: 'Import client data from Formara form submissions.',
        features: [
          'Automatic form parsing',
          'Client profile creation',
          'Income and expense extraction',
          'Property detail import',
          'Document attachment linking',
        ],
      },
    ],
  },
  {
    id: 'templates',
    title: 'Template Management',
    description: 'Manage report templates and PDF layouts',
    items: [
      {
        title: 'Report Format Templates',
        description: 'Configure templates for different report types including Investment Compass, Executive Brief, and Snapshot reports.',
        features: [
          'Investment report templates (Compass, Executive, Snapshot)',
          'Comparison analysis templates',
          'Individual cash flow templates',
          'Template priority ordering',
          'Category-based organization',
        ],
      },
      {
        title: 'AI Structure Templates',
        description: 'Reference documents that define report structure and content patterns for AI generation.',
        features: [
          'Upload reference PDFs for AI learning',
          'Vector embedding for context injection',
          'Template type categorization',
          'Priority-based template selection',
        ],
        steps: [
          'Navigate to "Templates" in the sidebar',
          'Select the "AI Structure" tab',
          'Click "Upload Template" and select your reference PDF',
          'Configure category and priority settings',
          'Save to enable for report generation',
        ],
      },
      {
        title: 'PDF Layout Templates',
        description: 'HTML/CSS templates that control the visual layout and styling of generated PDF reports.',
        features: [
          'Custom header and footer designs',
          'Page layout configurations',
          'Font and color scheme settings',
          'Section ordering and visibility',
        ],
      },
      {
        title: 'Q&A Export Templates',
        description: 'Customize how Aurixa Intelligence Hub conversations are exported to PDF.',
        features: [
          'Cover page design customization',
          'Font and color settings',
          'Header and footer styling',
          'Active template selection',
        ],
      },
      {
        title: 'Cash Flow Export Templates',
        description: 'Customize how 10-Year Cash Flow analyses are exported.',
        features: [
          'Branding and logo placement',
          'Color scheme customization',
          'Professional PDF formatting',
          'Template activation toggle',
        ],
      },
      {
        title: 'Client Branding Profiles',
        description: 'Create branded profile variations for different clients.',
        features: [
          'Client-specific logos and colors',
          'Multiple saved profiles',
          'Default profile setting',
          'Per-report branding selection',
        ],
      },
      {
        title: 'Global Report Settings',
        description: 'Configure default settings that apply to all reports.',
        features: [
          'Default assumptions and values',
          'Standard disclaimers',
          'Contact information',
          'Footer content settings',
        ],
      },
    ],
  },
  {
    id: 'sources',
    title: 'Data Sources',
    description: 'Track and manage listing data sources',
    items: [
      {
        title: 'Email Sources',
        description: 'View and manage email sources that send property listings.',
        features: [
          'Email domain tracking',
          'Listing count per source',
          'Latest received timestamps',
          'Source filtering and search',
        ],
      },
      {
        title: 'Agency Sources',
        description: 'Track real estate agencies and their listing activity.',
        features: [
          'Agency name and contact info',
          'Associated agents list',
          'Listing volume tracking',
          'Activity timeline',
        ],
      },
      {
        title: 'Agent Sources',
        description: 'Individual agent tracking and contact management.',
        features: [
          'Agent contact details',
          'Agency affiliation',
          'Listing history',
          'Phone and email quick actions',
        ],
      },
    ],
  },
  {
    id: 'integrations',
    title: 'Integrations',
    description: 'Configure external service connections',
    items: [
      {
        title: 'Integration Overview',
        description: 'Connect and manage external services for enhanced functionality.',
        features: [
          'Airtable for property listings',
          'Vapi for voice AI and call handling',
          'GoHighLevel for CRM sync',
          'OpenAI for AI analysis',
          'Microsoft/Outlook for email',
          'Twilio for SMS communications',
          'Make.com for workflow automation',
        ],
      },
      {
        title: 'Configuring Integrations',
        description: 'Set up API keys and credentials for each service.',
        steps: [
          'Navigate to "Integrations" in the sidebar',
          'Select the integration you want to configure',
          'Enter the required API keys or credentials',
          'Click "Save" to store the configuration',
          'Use "Sync to Supabase" to enable for edge functions',
          'Verify connection status shows "Configured"',
        ],
        tips: [
          'Keep API keys secure and never share them',
          'Use the visibility toggle to verify key values',
          'Check documentation links for each service',
          'Refresh Supabase status after syncing',
        ],
      },
      {
        title: 'Supabase Secrets',
        description: 'Manage secrets for edge function access.',
        features: [
          'Sync API keys to Supabase secrets',
          'Status indicators for each integration',
          'Partial configuration warnings',
          'One-click refresh for status',
        ],
      },
    ],
  },
  {
    id: 'depreciation',
    title: 'Depreciation Comps',
    description: 'Manage depreciation comparable data',
    items: [
      {
        title: 'Depreciation Database',
        description: 'Maintain a database of property depreciation comparables for accurate estimates.',
        features: [
          'Property type categorization',
          'Build year and purchase date tracking',
          'Finish standard classification',
          'City-based regional data',
          '10-year depreciation projections',
        ],
      },
      {
        title: 'Adding Comparables',
        description: 'Add new depreciation comparable data to the system.',
        steps: [
          'Navigate to Admin > Depreciation Comps',
          'Click "Add New" to create a manual entry',
          'Fill in property details and depreciation values',
          'Or use CSV upload for bulk imports',
          'Review and save the data',
        ],
      },
      {
        title: 'CSV Import',
        description: 'Bulk import depreciation data from spreadsheets.',
        features: [
          'Template download for correct formatting',
          'Column mapping validation',
          'Preview before import',
          'Error reporting for invalid rows',
        ],
        tips: [
          'Download the template first to ensure correct format',
          'Include all 10 years of depreciation values',
          'Specify property type and finish standard',
          'Review preview before confirming import',
        ],
      },
      {
        title: 'Depreciation Estimator',
        description: 'Generate depreciation estimates based on property characteristics.',
        features: [
          'Match against comparable properties',
          'Confidence scoring',
          'Plant & Equipment (P&E) estimates',
          'Division 40/43 calculations',
        ],
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Configure your personal preferences',
    items: [
      {
        title: 'Profile & Credentials',
        description: 'Manage your account settings and security.',
        features: [
          'Password change',
          'Profile information',
          'Session management',
          'Two-factor authentication setup',
        ],
      },
      {
        title: 'Personal Mailbox',
        description: 'Configure your email settings for the Email Copilot.',
        features: [
          'Personal mailbox address',
          'Email signature customization',
          'HTML signature support',
          'Auto-append to sent emails',
        ],
      },
      {
        title: 'Finance Agent Contacts',
        description: 'Manage contacts for finance-related communications.',
        features: [
          'Add finance broker contacts',
          'Set default recipients',
          'Contact categorization',
          'Quick access for report sending',
        ],
      },
      {
        title: 'Display & Preferences',
        description: 'Customize your dashboard experience.',
        features: [
          'Theme selection (Light/Dark/System)',
          'Timezone configuration',
          'Browser notification settings',
          'Auto-refresh intervals',
        ],
      },
      {
        title: 'Report Generation',
        description: 'Configure automatic report generation behavior.',
        features: [
          'Auto-continue for stalled reports',
          'Maximum retry attempts (1-5)',
          'Retry delay configuration (10-60s)',
          'Notification preferences',
        ],
        tips: [
          'Enable auto-continue for unattended report generation',
          'Set reasonable retry limits to avoid loops',
          'Adjust delay based on network conditions',
        ],
      },
      {
        title: 'Security & Access',
        description: 'View your permission levels and API access.',
        features: [
          'API token status',
          'User permission levels',
          'Read/write access indicators',
          'Export permissions',
        ],
      },
    ],
  },
  {
    id: 'white-label',
    title: 'Branding',
    description: 'Manage dashboard logos, colours, browser identity, email signature, and theme defaults',
    items: [
      {
        title: 'Dashboard Branding',
        description: 'Customize the overall look and feel of your dashboard.',
        features: [
          'Auth page logo upload',
          'Sidebar logo (expanded and collapsed)',
          'Favicon customization',
          'Automatic background removal for logos',
        ],
        steps: [
          'Navigate to "Branding" in the sidebar',
          'Upload logos for each placement',
          'Use drag-and-drop or click to upload',
          'Preview changes in real-time',
          'Save to apply across the dashboard',
        ],
      },
      {
        title: 'Color Themes',
        description: 'Configure your brand colors for the dashboard.',
        features: [
          'Primary color selection',
          'Accent color customization',
          'HSL format for precise control',
          'Real-time preview',
          'CSS variable injection',
        ],
      },
      {
        title: 'Dark Mode',
        description: 'Control dark mode appearance.',
        features: [
          'Light/Dark/System theme toggle',
          'Theme persistence across sessions',
          'Automatic system preference detection',
        ],
      },
      {
        title: 'Report Branding',
        description: 'White-label generated reports for clients.',
        features: [
          'Company logo on reports',
          'Custom color schemes',
          'Header and footer styling',
          'Contact information display',
          'Multiple branding profiles',
        ],
      },
    ],
  },
  {
    id: 'calendar',
    title: 'Calendar & Scheduling',
    description: 'Track appointments and important dates',
    items: [
      {
        title: 'Calendar View',
        description: 'Manage appointments, follow-ups, and property-related events.',
        features: [
          'Day, week, and month views',
          'Client appointment scheduling',
          'Property inspection tracking',
          'Reminder notifications',
          'Integration with client reminders',
        ],
      },
      {
        title: 'Outlook Calendar Integration',
        description: 'Sync and manage Microsoft Outlook calendars for your team directly within the dashboard.',
        features: [
          'Link Microsoft email per user to sync Outlook events',
          'View Outlook events alongside GHL appointments in a unified calendar',
          'Create, update, and delete Outlook events from the dashboard',
          'Team availability overlay — see who is free or busy at a glance',
          'Conflict detection highlights scheduling clashes with proposed times',
          'Auto Prep Blocks — automatically create 15-min prep events before GHL appointments',
          'Follow-Up Blocking — schedule tentative 9 AM reminders on follow-up dates',
          'Test Connection & Permissions diagnostic panel for troubleshooting',
          'Outlook settings housed in the Calendar page sidebar under the Outlook tab',
        ],
      },
      {
        title: 'Keyboard Navigation',
        description: 'Navigate the calendar efficiently with keyboard shortcuts.',
        shortcuts: [
          { keys: ['T'], description: 'Go to today' },
          { keys: ['←'], description: 'Previous period' },
          { keys: ['→'], description: 'Next period' },
          { keys: ['D'], description: 'Day view' },
          { keys: ['W'], description: 'Week view' },
          { keys: ['M'], description: 'Month view' },
        ],
      },
    ],
  },
  {
    id: 'monitoring',
    title: 'Monitoring & Logs',
    description: 'System health and activity tracking',
    items: [
      {
        title: 'System Monitoring',
        description: 'Monitor the health of data sources and integrations.',
        features: [
          'API health status indicators',
          'Data sync monitoring',
          'Response time tracking',
          'Error rate visualization',
          'Uptime statistics',
        ],
      },
      {
        title: 'Error Logs',
        description: 'View and troubleshoot system errors.',
        features: [
          'Error categorization',
          'Stack trace details',
          'Timestamp and frequency',
          'Resolution status tracking',
          'Export for support',
        ],
      },
      {
        title: 'Activity Logs',
        description: 'Track user and system activities across the platform.',
        features: [
          'User action logging',
          'Report generation tracking',
          'Login/logout history',
          'Data modification audit',
          'Filter by user, action, or date',
        ],
      },
    ],
  },
  {
    id: 'admin',
    title: 'Administration',
    description: 'User and system management (Admin only)',
    items: [
      {
        title: 'User Management',
        description: 'Manage user accounts and access levels.',
        features: [
          'Create and edit user accounts',
          'Role assignment (Admin, User, Viewer)',
          'Password reset functionality',
          'Account activation/deactivation',
          'Bulk user operations',
        ],
      },
      {
        title: 'Quality Assurance',
        description: 'Review and validate generated reports.',
        features: [
          'Report quality scoring',
          'Content review workflows',
          'Approval/rejection tracking',
          'Quality metrics dashboard',
        ],
      },
    ],
  },
  {
    id: 'deal-pipeline',
    title: 'Deal Pipeline',
    description: 'Track property deals from inquiry to settlement',
    items: [
      {
        title: 'Pipeline Overview',
        description: 'The Deal Pipeline provides a Kanban-style board to track every property deal through its lifecycle stages.',
        features: [
          'Kanban board with drag-and-drop stage progression',
          'Deal stages: Lead, Qualified, Proposal, Negotiation, Under Contract, Settlement, Completed',
          'Deal value and commission tracking',
          'Client and property linking',
          'Assigned team member per deal',
          'Build progress payment tracking for construction deals',
        ],
        steps: [
          'Navigate to "Deal Pipeline" in the sidebar',
          'Click "Add Deal" to create a new deal',
          'Link the deal to a client and property',
          'Drag deals between stages as they progress',
          'Track commissions and builder invoices within each deal',
        ],
      },
      {
        title: 'Build Progress Payments',
        description: 'Track construction stage payments and builder invoices for build deals.',
        features: [
          'Stage-by-stage payment tracking (Slab, Frame, Lock-up, etc.)',
          'Builder invoice receipt and submission tracking',
          'Funds released and paid-to-builder status',
          'Commission trigger identification per stage',
          'Lender submission tracking',
        ],
      },
    ],
  },
  {
    id: 'agreements',
    title: 'Agency Agreements',
    description: 'Generate, send, and manage buyer agency agreements',
    items: [
      {
        title: 'Agreement Generation',
        description: 'Create professional agency agreements from templates linked to your clients and deals.',
        features: [
          'Template-based agreement generation',
          'Auto-populated buyer details from client records',
          'Custom commitment fee and terms',
          'Secondary buyer support',
          'PDF generation and storage',
        ],
        steps: [
          'Navigate to "Agreements" in the sidebar',
          'Click "New Agreement" to start',
          'Select a client and optionally link a deal',
          'Fill in buyer details, fees, and notes',
          'Generate and review the PDF',
          'Send via DocuSign for electronic signature',
        ],
      },
      {
        title: 'DocuSign Integration',
        description: 'Send agreements for electronic signature via DocuSign.',
        features: [
          'One-click DocuSign envelope creation',
          'Real-time signing status tracking',
          'Automatic status sync (Sent, Delivered, Signed, Voided)',
          'Signed PDF retrieval and storage',
        ],
      },
    ],
  },
  {
    id: 'checklists',
    title: 'Checklists',
    description: 'Manage process checklists from templates',
    items: [
      {
        title: 'Checklist Templates',
        description: 'Create reusable checklist templates for standardized processes like onboarding, settlement, or compliance.',
        features: [
          'Multi-section checklist templates',
          'Custom item ordering and section grouping',
          'Icon assignment per section',
          'Template activation/deactivation',
          'Cron-based auto-generation scheduling',
        ],
      },
      {
        title: 'Checklist Instances',
        description: 'Generate and work through checklist instances from templates.',
        features: [
          'Progress percentage tracking',
          'Checked-by user and timestamp logging',
          'Status tracking (In Progress, Completed)',
          'AI-powered checklist generation',
        ],
        steps: [
          'Navigate to "Checklists" in the sidebar',
          'Select a template or create a new instance',
          'Work through items by checking them off',
          'Track overall progress in the dashboard',
        ],
      },
    ],
  },
  {
    id: 'marketing-analytics',
    title: 'Marketing Analytics',
    description: 'Track marketing campaigns, leads, and conversion metrics',
    items: [
      {
        title: 'Campaign Tracking',
        description: 'Monitor the performance of your marketing campaigns across channels.',
        features: [
          'UTM parameter tracking for leads',
          'Meta/Facebook ad attribution',
          'Lead source identification',
          'Campaign-level conversion rates',
          'Cost-per-lead analysis',
        ],
      },
      {
        title: 'Lead Management',
        description: 'View and manage incoming leads from marketing campaigns.',
        features: [
          'Real-time lead notifications',
          'Lead-to-client conversion tracking',
          'Source attribution (Google, Meta, Organic, Referral)',
          'Lead scoring and prioritization',
        ],
      },
    ],
  },
  {
    id: 'reminders',
    title: 'Reminders Hub',
    description: 'Centralized view of all reminders and follow-ups',
    items: [
      {
        title: 'Reminders Dashboard',
        description: 'A centralized hub showing all upcoming, overdue, and completed reminders across all clients.',
        features: [
          'Today, upcoming, and overdue reminder filters',
          'Priority-based sorting (Urgent, High, Normal, Low)',
          'Client-linked reminders with quick navigation',
          'Snooze and complete actions',
          'Bell notification integration for upcoming reminders',
        ],
        tips: [
          'Check the Reminders Hub daily to stay on top of follow-ups',
          'Set high-priority reminders for time-sensitive items',
          'Upcoming reminders trigger bell notifications the day before',
        ],
      },
    ],
  },
  {
    id: 'report-requests',
    title: 'Report Requests',
    description: 'Manage report requests from the client portal',
    items: [
      {
        title: 'Incoming Requests',
        description: 'View and process report requests submitted by clients through the client portal.',
        features: [
          'Real-time notifications when a client submits a request',
          'Request status tracking (Pending, In Progress, Completed, Declined)',
          'Property address and client details',
          'Notes and comments per request',
          'Direct report generation from requests',
        ],
        steps: [
          'Navigate to "Report Requests" in the sidebar',
          'Review pending requests from clients',
          'Accept a request and generate the report',
          'Update the status as you work on it',
          'Client receives automatic email notification on completion',
        ],
      },
    ],
  },
  {
    id: 'client-portal',
    title: 'Client Portal',
    description: 'Self-service portal for your clients',
    items: [
      {
        title: 'Portal Overview',
        description: 'The Client Portal allows your clients to log in, view their reports, request new reports, and book appointments.',
        features: [
          'Secure client login with magic links or passwords',
          'Personalized dashboard per client',
          'Report viewing and download',
          'New report request submission',
          'Appointment booking',
          'In-app notification feed',
        ],
      },
      {
        title: 'Client Portal',
        description: 'Configure branding and settings for the client-facing portal.',
        features: [
          'Custom branding and logos',
          'Enable/disable portal features',
          'Booking calendar configuration',
          'Welcome message customization',
          'Auto-email notifications for portal events',
        ],
        steps: [
          'Navigate to "Client Portal" in the sidebar',
          'Configure branding, colors, and logos',
          'Enable the features you want clients to access',
          'Test the portal by logging in as a client',
        ],
      },
    ],
  },
  {
    id: 'ai-agent',
    title: 'AI Agent',
    description: 'Conversational AI assistant with tool-calling capabilities',
    items: [
      {
        title: 'Agent Overview',
        description: 'The AI Agent is an advanced conversational assistant that can perform actions on your behalf such as looking up clients, creating reminders, and running analyses.',
        features: [
          'Natural language commands for dashboard actions',
          'Tool-calling: search clients, create reminders, query data',
          'Conversation history with pinning and sharing',
          'Playbooks for multi-step automated workflows',
          'Scheduled tasks for recurring agent actions',
          'Action audit log with rollback capability',
        ],
      },
      {
        title: 'Playbooks & Scheduling',
        description: 'Automate multi-step workflows and schedule recurring AI agent tasks.',
        features: [
          'Create reusable playbooks with ordered steps',
          'Schedule tasks with cron expressions',
          'Run history and status tracking',
          'Enable/disable individual scheduled tasks',
        ],
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Real-time alerts and notification management',
    items: [
      {
        title: 'Notification Center',
        description: 'The bell icon in the top navigation provides real-time alerts for important events across the platform.',
        features: [
          'Real-time push notifications for reports, emails, calls, and bookings',
          'Notification types: report completed, new email, call completed, appointment created, new lead, agreement generated, portal report request, upcoming reminder',
          'Click-to-navigate to the relevant page',
          'Mark as read / mark all as read',
          'Notification persistence across sessions',
        ],
      },
      {
        title: 'Notification Sources',
        description: 'Events that trigger internal dashboard notifications.',
        features: [
          'Investment report generation completed or failed',
          'Incoming emails (admin and personal mailboxes)',
          'VAPI call completions with outcome details',
          'Appointment bookings from GHL, Outlook, or dashboard',
          'New GHL contacts synced',
          'Marketing leads with campaign attribution',
          'Client portal report requests',
          'Agency agreement generation',
          'Client reminders due today or upcoming',
        ],
      },
    ],
  },
  {
    id: 'api-usage',
    title: 'API Usage & Costs',
    description: 'Monitor AI token usage and API costs',
    items: [
      {
        title: 'Usage Dashboard',
        description: 'Track API consumption across all AI-powered features to manage costs.',
        features: [
          'Token usage breakdown by service (OpenAI, Gemini, etc.)',
          'Cost estimation in USD',
          'Usage trends over time',
          'Per-user consumption tracking',
          'Model-level breakdown',
        ],
        tips: [
          'Monitor usage regularly to stay within budget',
          'Review which features consume the most tokens',
          'Use efficient analysis modes to reduce costs',
        ],
      },
    ],
  },
];

/** Sections defined as data in `userGuideSections.ts`, minus their icon. */
const additionalKnowledge: GuideSection[] = ADDITIONAL_GUIDE_SECTIONS.map(
  ({ id, title, description, items }: GuideSectionContent) => ({
    id,
    title,
    description,
    items,
  }),
);

/**
 * Everything the assistant knows about. Ordered so the newer, previously
 * undocumented areas sit after the original guide rather than interleaved,
 * which keeps the on-page ordering and this list identical.
 */
export const userGuideKnowledge: GuideSection[] = [
  ...baseGuideKnowledge,
  ...additionalKnowledge,
];

/** Display names for the pricing-catalogue slugs, for AI-facing prose. */
const MODULE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'market-updates': 'Market News Feed',
  'commercial-industrial': 'Commercial / Industrial',
  'opportunity-marketplace': 'Property Marketplace',
  'intelligence-hub': 'Aurixa Intelligence Hub',
  'report-comparisons': 'Generated Reports — Comparisons',
  'cashflow-comparisons': 'Cash Flow Analysis — Comparisons',
  'email-copilot': 'Email Copilot',
  'call-logs': 'Call Logs',
  'portfolio-analysis': 'Portfolio Analysis',
  'send-portfolio': 'Send Portfolio To Client',
  'client-forms': 'Client Forms',
  'borrowing-capacity': 'Borrowing Capacity',
  lenders: 'Lenders',
  'client-ai': 'Client AI',
  agreements: 'Agreements',
  marketing: 'Marketing',
  'deal-pipeline': 'Deal Pipeline',
  'aml-ctf': 'AML / CTF Compliance',
  'model-hub': 'Model Hub',
  'finance-portal': 'Finance Portal',
  integrations: 'Integrations',
  'api-usage': 'API Usage',
  'aurixa-agent': 'Aurixa Agent',
};

const PLAN_NAMES: Record<string, string> = {
  launch: 'Launch',
  growth: 'Growth',
  scale: 'Scale',
};

/**
 * What the assistant needs in order to answer availability questions.
 *
 * Previously it only had feature prose, so "can I use Borrowing Capacity?" got
 * an enthusiastic explanation of a Scale-only feature regardless of the plan
 * the person was actually on. Telling a customer how to use something they
 * cannot see is worse than saying it is not included.
 *
 * When `planSlug` is known the catalogue is split into included / not included
 * for that plan. When it is not, the full matrix is provided and the assistant
 * is told to ask rather than assume.
 */
export function formatModuleAwarenessForAI(
  planSlug?: string | null,
  addonSlugs?: readonly string[] | null,
): string {
  const slugs = Object.keys(MODULE_TIERS).sort();
  const known = isKnownPlan(planSlug ?? undefined);
  const plan = known ? (planSlug as PlanSlug) : null;

  let out = `# MODULE CATALOGUE & PLAN ENTITLEMENTS\n\n`;
  out += `The platform is sold as three tiers — Launch, Growth and Scale — plus modules that can be bought individually. A feature being documented below does NOT mean this workspace has it.\n\n`;

  if (plan) {
    out += `## This workspace is on the ${PLAN_NAMES[plan]} plan\n\n`;

    // A purchased add-on counts as included whatever the tier says — that is
    // what buying it did. Reporting it as "requires an upgrade" would tell a
    // paying customer to buy something twice.
    const held = new Set(addonSlugs ?? []);
    const included = slugs.filter((s) => (MODULE_TIERS[s] ?? []).includes(plan) || held.has(s));
    const addonOnly = slugs.filter(
      (s) => (MODULE_TIERS[s] ?? []).length === 0 && !held.has(s),
    );
    const higherTier = slugs.filter(
      (s) =>
        (MODULE_TIERS[s] ?? []).length > 0 && !(MODULE_TIERS[s] ?? []).includes(plan) && !held.has(s),
    );

    out += `### Included in this plan\n`;
    if (held.size > 0) {
      out += `(includes ${held.size} separately purchased add-on(s))\n`;
    }
    for (const s of included) out += `- ${MODULE_DISPLAY_NAMES[s] ?? s}\n`;
    out += `\n### Not included — requires an upgrade\n`;
    for (const s of higherTier) {
      const tiers = (MODULE_TIERS[s] ?? []).map((t) => PLAN_NAMES[t] ?? t).join(' or ');
      out += `- ${MODULE_DISPLAY_NAMES[s] ?? s} (available on ${tiers})\n`;
    }
    out += `\n### Available as a paid add-on on any plan\n`;
    for (const s of addonOnly) out += `- ${MODULE_DISPLAY_NAMES[s] ?? s}\n`;

    const subs = SUB_MODULE_ENTITLEMENTS.filter((r) => r[plan]);
    const blocked = SUB_MODULE_ENTITLEMENTS.filter((r) => !r[plan]);
    out += `\n### Sub-features enabled on this plan (${subs.length})\n`;
    for (const r of subs) out += `- ${r.module} → ${r.subModule}\n`;
    out += `\n### Sub-features NOT enabled on this plan (${blocked.length})\n`;
    for (const r of blocked) {
      const on = (['launch', 'growth', 'scale'] as PlanSlug[])
        .filter((t) => r[t])
        .map((t) => PLAN_NAMES[t]);
      out += `- ${r.module} → ${r.subModule}${on.length ? ` (available on ${on.join(', ')})` : ' (not yet released)'}\n`;
    }
  } else {
    out += `## Plan unknown\n\nThe current workspace plan could not be determined. Describe which plans include a module and ask the user which plan they are on rather than assuming they have access.\n\n`;
    out += `### Module availability by plan\n`;
    for (const s of slugs) {
      const tiers = MODULE_TIERS[s] ?? [];
      const where = tiers.length
        ? tiers.map((t) => PLAN_NAMES[t] ?? t).join(', ')
        : 'paid add-on only';
      out += `- ${MODULE_DISPLAY_NAMES[s] ?? s}: ${where}\n`;
    }
  }

  out += `\n**When answering:** if a feature is not included on this plan, say so plainly and name the plan or add-on that provides it, then offer to explain what it does. Never walk someone through using something their plan does not include.\n`;

  return out;
}

/**
 * Format the knowledge base as context for AI
 */
export function formatKnowledgeBaseForAI(
  planSlug?: string | null,
  addonSlugs?: readonly string[] | null,
): string {
  let context = `# Property Dashboard - User Guide Knowledge Base\n\n`;
  context += `This is a comprehensive property investment analysis platform. Below is the complete documentation:\n\n`;

  // The module catalogue goes first so the assistant can answer "do I have X"
  // before it starts describing how X works. Without it, the assistant happily
  // explained Scale-only features to Launch customers as though they were
  // sitting in their sidebar.
  context += formatModuleAwarenessForAI(planSlug, addonSlugs);

  context += `\n---\n\n# FEATURE DOCUMENTATION\n\n`;

  // Only what this workspace can actually see. Feeding the assistant the full
  // catalogue and asking it to self-censor does not work reliably — and the
  // failure is bad in both directions: it either walks someone through a
  // screen that is not in their sidebar, or links them to a section the page
  // will not render, which scrolls nowhere.
  const visibleSections = filterEntitledSections(userGuideKnowledge, { planSlug, addonSlugs });

  for (const section of visibleSections) {
    // The section id is what the assistant needs to emit a working
    // [[section:id|Title]] link. It was never included, so the edge function
    // carried a hand-maintained list of ids instead — a third copy that went
    // stale the moment a section was added.
    context += `## ${section.title}\n`;
    context += `Section ID: \`${section.id}\` — link with [[section:${section.id}|${section.title}]]\n`;
    context += `${section.description}\n\n`;
    
    for (const item of section.items) {
      context += `### ${item.title}\n`;
      context += `${item.description}\n\n`;
      
      if (item.features && item.features.length > 0) {
        context += `**Features:**\n`;
        for (const feature of item.features) {
          context += `- ${feature}\n`;
        }
        context += '\n';
      }
      
      if (item.steps && item.steps.length > 0) {
        context += `**Steps:**\n`;
        item.steps.forEach((step, i) => {
          context += `${i + 1}. ${step}\n`;
        });
        context += '\n';
      }
      
      if (item.tips && item.tips.length > 0) {
        context += `**Tips:**\n`;
        for (const tip of item.tips) {
          context += `- 💡 ${tip}\n`;
        }
        context += '\n';
      }
      
      if (item.shortcuts && item.shortcuts.length > 0) {
        context += `**Keyboard Shortcuts:**\n`;
        for (const shortcut of item.shortcuts) {
          context += `- \`${shortcut.keys.join(' + ')}\`: ${shortcut.description}\n`;
        }
        context += '\n';
      }
    }
  }
  
  return context;
}

/**
 * Find sections that match a query
 */
export function findRelevantSections(query: string): GuideSection[] {
  const lowerQuery = query.toLowerCase();
  const relevantSections: GuideSection[] = [];
  
  for (const section of userGuideKnowledge) {
    const sectionMatches = 
      section.title.toLowerCase().includes(lowerQuery) ||
      section.description.toLowerCase().includes(lowerQuery) ||
      section.items.some(item => 
        item.title.toLowerCase().includes(lowerQuery) ||
        item.description.toLowerCase().includes(lowerQuery) ||
        item.features?.some(f => f.toLowerCase().includes(lowerQuery)) ||
        item.steps?.some(s => s.toLowerCase().includes(lowerQuery))
      );
    
    if (sectionMatches) {
      relevantSections.push(section);
    }
  }
  
  return relevantSections;
}

/**
 * Get all section IDs for navigation
 */
export function getAllSectionIds(): string[] {
  return userGuideKnowledge.map(section => section.id);
}
