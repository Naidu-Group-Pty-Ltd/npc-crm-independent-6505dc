// The single navigation registry.
//
// Desktop sidebar, mobile sidebar, bottom bar and the command palette all
// render from THIS table — they previously kept four hand-synchronised
// copies, which is how Market News Feed and Commercial / Industrial ended up
// marked always-visible in three places while the pricing matrix said
// otherwise.
//
// `moduleKey` is the item's gate. It is either a legacy user-permission key
// (resolved against the capability registry when the key is commercially
// mapped — see src/lib/entitlements/aliases.ts), or one of two sentinels:
// `__always__` (genuinely part of every subscription, e.g. Billing) and
// `__superadmin_only__`. Visibility is decided by useNavigationVisibility —
// components never re-implement the rule.

import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Calendar,
  ClipboardList,
  Cloud,
  Coins,
  Cpu,
  Database,
  FileSignature,
  FileStack,
  FileText,
  Gauge,
  Globe,
  History,
  Home,
  Inbox,
  Layers,
  LifeBuoy,
  Mail,
  Map as MapIcon,
  MessageSquare,
  MessageSquareQuote,
  MessageSquareText,
  Newspaper,
  Palette,
  Phone,
  Plug,
  Scale,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  UserCircle,
  Users,
  Wand2,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { REPORT_DESIGN_CONTROLS_VISIBLE } from '@/lib/reports/designControlsVisibility';

export interface NavItemDef {
  title: string;
  url: string;
  icon: LucideIcon;
  /** Legacy module/permission key, `__always__`, or `__superadmin_only__`. */
  moduleKey: string;
  group: string;
  /** Search aliases for the command palette and sidebar filter. */
  keywords?: string[];
  /** Additional path prefixes that keep this item highlighted as active. */
  activePatterns?: string[];
  /** Shown in mobile navigation surfaces. Default true. */
  mobile?: boolean;
  /** Only surfaced through the command palette, not the sidebars. */
  paletteOnly?: boolean;
}

export const NAVIGATION_ITEMS: readonly NavItemDef[] = [
  // Main Dashboard
  { title: 'Overview', url: '/', icon: Home, moduleKey: 'overview', group: 'Main Dashboard', keywords: ['home', 'dashboard'] },
  { title: 'Market News Feed', url: '/market-updates', icon: Newspaper, moduleKey: 'market_updates', group: 'Main Dashboard', keywords: ['news', 'market', 'updates'], activePatterns: ['/market-updates'] },
  { title: 'Property Marketplace', url: '/listings', icon: Building2, moduleKey: 'listings', group: 'Main Dashboard', keywords: ['property', 'listings', 'off-market', 'builder'] },
  { title: 'Commercial / Industrial', url: '/commercial', icon: Building2, moduleKey: 'commercial', group: 'Main Dashboard', keywords: ['commercial', 'industrial', 'assessment', 'calculators'], activePatterns: ['/commercial', '/industrial'] },
  { title: 'Calendar', url: '/calendar', icon: Calendar, moduleKey: 'calendar', group: 'Main Dashboard' },

  // Reports & Analysis
  { title: 'Reports', url: '/reports', icon: BarChart3, moduleKey: 'reports', group: 'Reports & Analysis' },
  { title: 'Quantitative Reports', url: '/quantitative-reports', icon: BarChart3, moduleKey: 'generated_reports', group: 'Reports & Analysis' },
  { title: 'Generated Reports', url: '/generated-reports', icon: FileText, moduleKey: 'generated_reports', group: 'Reports & Analysis' },
  { title: 'Cash Flow Analysis', url: '/cash-flow-analysis', icon: Activity, moduleKey: 'cash_flow', group: 'Reports & Analysis', activePatterns: ['/cash-flow-analysis'] },
  { title: 'Aurixa Intelligence Hub', url: '/report-qa', icon: MessageSquareText, moduleKey: 'report_qa', group: 'Reports & Analysis', keywords: ['ai', 'ask', 'report q&a', 'aurixa'] },
  { title: 'Portfolio Reports', url: '/portfolio-reports', icon: FileText, moduleKey: 'portfolio_reports', group: 'Reports & Analysis' },
  { title: 'Report Requests', url: '/report-requests', icon: Send, moduleKey: 'report_requests', group: 'Reports & Analysis' },
  { title: 'Charts', url: '/charts', icon: BarChart3, moduleKey: 'charts', group: 'Reports & Analysis' },

  // Client & CRM
  { title: 'Clients', url: '/clients', icon: UserCircle, moduleKey: 'clients', group: 'Client & CRM' },
  { title: 'Client Tracker', url: '/client-tracker', icon: Target, moduleKey: 'client_tracker', group: 'Client & CRM' },
  { title: 'CRM Conversations', url: '/conversations', icon: MessageSquare, moduleKey: 'conversations', group: 'Client & CRM' },
  { title: 'Portal Messages', url: '/messages', icon: Inbox, moduleKey: '__always__', group: 'Client & CRM' },
  { title: 'Email Copilot', url: '/email-copilot', icon: Sparkles, moduleKey: 'email_copilot', group: 'Client & CRM' },
  { title: 'Call Logs', url: '/call-logs', icon: Phone, moduleKey: 'call_logs', group: 'Client & CRM' },

  // Operations
  { title: 'Deal Pipeline', url: '/deal-pipeline', icon: TrendingUp, moduleKey: 'deal_pipeline', group: 'Operations' },
  { title: 'Reminders', url: '/reminders', icon: Bell, moduleKey: 'reminders', group: 'Operations' },
  { title: 'Checklists', url: '/checklists', icon: ClipboardList, moduleKey: 'checklists', group: 'Operations' },
  { title: 'Agreements', url: '/agreements', icon: FileSignature, moduleKey: 'agreements', group: 'Operations' },
  // Lives inside Finance Portal Admin (Administration) — reached from its
  // action bar rather than the Operations sidebar, so partner agreements sit
  // with the rest of the finance-partner tooling. paletteOnly keeps ⌘K
  // discovery and deep links working.
  // Templates only. The keywords deliberately drop 'issue', 'sign' and
  // 'executed': searching for those should not surface a page that cannot do
  // them, now that agreements are not entered into through the platform.
  { title: 'Agreement Templates', url: '/partner-agreements', icon: FileSignature, moduleKey: 'agreements', group: 'Operations', keywords: ['partner agreements', 'agreement templates', 'referral agreement', 'commission agreement', 'download template', 'word'], paletteOnly: true },
  { title: 'Partner Referrals', url: '/partner-referrals', icon: ArrowLeftRight, moduleKey: 'agreements', group: 'Operations' },
  { title: 'Loan Writer Undertakings', url: '/loan-writer-undertakings', icon: FileSignature, moduleKey: 'agreements', group: 'Operations' },
  { title: 'Partner Compliance', url: '/partner-compliance', icon: ShieldCheck, moduleKey: 'agreements', group: 'Operations' },
  { title: 'Game Plan', url: '/game-plan', icon: MapIcon, moduleKey: 'game_plans', group: 'Operations' },
  { title: 'Marketing', url: '/marketing-analytics', icon: TrendingUp, moduleKey: 'marketing_analytics', group: 'Operations' },

  // Help & Usage
  { title: 'User Guide', url: '/user-guide', icon: BookOpen, moduleKey: 'user_guide', group: 'Help & Usage' },
  { title: 'Billing & Usage', url: '/billing', icon: Coins, moduleKey: '__always__', group: 'Help & Usage' },
  { title: 'Feedback', url: '/feedback', icon: MessageSquareQuote, moduleKey: '__always__', group: 'Help & Usage' },
  { title: 'Support', url: '/support', icon: LifeBuoy, moduleKey: '__always__', group: 'Help & Usage', keywords: ['help', 'ticket', 'issue', 'incident', 'support portal'] },
];

export const ADMIN_NAVIGATION_ITEMS: readonly NavItemDef[] = [
  { title: 'Auto Report Generation', url: '/automation', icon: Zap, moduleKey: 'automation', group: 'Administration', keywords: ['automation'] },
  { title: 'Templates', url: '/templates', icon: FileStack, moduleKey: 'templates', group: 'Administration' },
  { title: 'Template Builder', url: '/admin/template-builder', icon: Layers, moduleKey: 'templates', group: 'Administration', keywords: ['visual editor', 'pdf template', 'builder', 'report template'], paletteOnly: true },
  { title: 'Template Converter', url: '/admin/template-builder/converter', icon: Wand2, moduleKey: 'templates', group: 'Administration', keywords: ['convert', 'converter', 'refurbish', 'rebrand', 'existing template', 'design system'], paletteOnly: true },
  // Brand systems is hidden product-wide with the rest of the design factor
  // (`@/lib/reports/designControlsVisibility`). The ROUTE stays declared in
  // App.tsx — hiding is never deleting, so a bookmark lands on a page that
  // explains itself rather than a 404 — but no navigation surface draws a door
  // to it. An entry is a claim that a page will open and do something.
  ...(REPORT_DESIGN_CONTROLS_VISIBLE
    ? [{ title: 'Brand systems', url: '/admin/template-builder/brand-systems', icon: Palette, moduleKey: 'templates', group: 'Administration', keywords: ['brand', 'design system', 'palette', 'paper', 'ink', 'claude design', 'import design system', 'tokens'], paletteOnly: true }]
    : []),
  { title: 'Branding', url: '/white-label', icon: Palette, moduleKey: 'white_label', group: 'Administration' },
  { title: 'Integrations', url: '/integrations', icon: Plug, moduleKey: 'integrations', group: 'Administration' },
  { title: 'Workflow Playground', url: '/workflow-playground', icon: Workflow, moduleKey: 'integrations', group: 'Administration' },
  { title: 'Cloudflare', url: '/cloudflare', icon: Cloud, moduleKey: 'cloudflare', group: 'Administration' },
  { title: 'API Usage', url: '/api-usage', icon: Gauge, moduleKey: 'api_usage', group: 'Administration' },
  { title: 'Model Hub', url: '/model-hub', icon: Cpu, moduleKey: 'model_hub', group: 'Administration' },
  { title: 'Monitoring', url: '/monitoring', icon: Activity, moduleKey: 'monitoring', group: 'Administration' },
  { title: 'Quality Assurance', url: '/quality-assurance', icon: ShieldCheck, moduleKey: 'quality_assurance', group: 'Administration' },
  { title: 'Data Import', url: '/data-import', icon: Upload, moduleKey: 'data_import', group: 'Administration' },
  { title: 'Depreciation Comps', url: '/admin/depreciation-comps', icon: Database, moduleKey: 'depreciation_comps', group: 'Administration' },
  { title: 'Error Logs', url: '/error-logs', icon: AlertTriangle, moduleKey: 'error_logs', group: 'Administration' },
  { title: 'Activity Logs', url: '/admin/activity-logs', icon: History, moduleKey: 'activity_logs', group: 'Administration' },
  { title: 'Settings', url: '/settings', icon: Settings, moduleKey: 'settings', group: 'Administration' },
  { title: 'User Management', url: '/admin/users', icon: Users, moduleKey: 'user_management', group: 'Administration' },
  { title: 'Finance Portal', url: '/admin/finance-portal', icon: ShieldCheck, moduleKey: 'finance_portal_admin', group: 'Administration' },
  { title: 'Solicitor Portal', url: '/admin/solicitor-portal', icon: Scale, moduleKey: 'solicitor_portal_admin', group: 'Administration', keywords: ['solicitor', 'conveyancer', 'legal', 'matter'] },
  { title: 'Client Portal', url: '/portal-config', icon: Globe, moduleKey: 'portal_config', group: 'Administration', keywords: ['portal config', 'portal configuration'] },
  { title: 'Token Audit Log', url: '/admin/token-audit', icon: Coins, moduleKey: '__superadmin_only__', group: 'Administration' },
  { title: 'PDF Import Engine', url: '/admin/pdf-import-engine', icon: Cpu, moduleKey: '__superadmin_only__', group: 'Administration' },
  { title: 'PDF Import Diagnostics', url: '/admin/pdf-import-diagnostics', icon: Activity, moduleKey: '__superadmin_only__', group: 'Administration' },
  { title: 'BC Segment Engine', url: '/admin/bc-segment-engine', icon: Gauge, moduleKey: '__superadmin_only__', group: 'Administration' },
  { title: 'Reclassify Property', url: '/admin/reclassify-property', icon: Database, moduleKey: '__superadmin_only__', group: 'Administration' },
  { title: 'Sources', url: '/sources', icon: Mail, moduleKey: 'sources', group: 'Administration' },
];

/** Ordered sidebar groups. Rendering walks these; an empty group is hidden. */
export const NAVIGATION_GROUP_ORDER: readonly string[] = [
  'Main Dashboard',
  'Reports & Analysis',
  'Client & CRM',
  'Operations',
  'Help & Usage',
];

/** Whether a nav item should highlight for the current path. */
export function navItemIsActive(item: NavItemDef, currentPath: string): boolean {
  if (item.activePatterns) {
    return item.activePatterns.some(
      (p) => currentPath === p || currentPath.startsWith(`${p}/`),
    );
  }
  return currentPath === item.url;
}
