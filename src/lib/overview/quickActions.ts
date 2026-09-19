// The quick-action registry for the Overview.
//
// One declarative table; the row component filters it through the capability
// resolver. An action that is not commercially entitled, not permitted for
// the user, or not operationally available is REMOVED — never rendered
// disabled. Baseline actions are part of every tier; conditional actions
// appear exactly when their module does.

import {
  Bell,
  Building2,
  Calendar,
  FileText,
  GitCompare,
  Newspaper,
  TrendingUp,
  UserPlus,
  Activity,
  type LucideIcon,
} from 'lucide-react';
import type { CapabilityKey } from '@/lib/entitlements';

export interface QuickActionDefinition {
  id: string;
  label: string;
  route: string;
  icon: LucideIcon;
  /** Capability that must be enabled. Omit for baseline actions. */
  capability?: CapabilityKey;
  /** Legacy user-permission key checked when no capability applies. */
  permissionKey?: string;
}

export const OVERVIEW_QUICK_ACTIONS: readonly QuickActionDefinition[] = [
  // Baseline — included in every tier, subject to user permission.
  { id: 'add-client', label: 'Add Client', route: '/clients?action=add', icon: UserPlus, capability: 'module.clients' },
  { id: 'create-report', label: 'Create Report', route: '/reports', icon: FileText, capability: 'module.reports' },
  { id: 'add-reminder', label: 'Add Reminder', route: '/reminders', icon: Bell, capability: 'module.reminders' },
  { id: 'open-calendar', label: 'Open Calendar', route: '/calendar', icon: Calendar, capability: 'module.calendar' },
  { id: 'cash-flow', label: 'Cash-Flow Analysis', route: '/cash-flow-analysis', icon: Activity, capability: 'cashflow.standard' },

  // Conditional — premium modules, shown only when entitled.
  { id: 'market-news', label: 'Market News Feed', route: '/market-updates', icon: Newspaper, capability: 'module.market_news_feed' },
  { id: 'commercial-assessment', label: 'Commercial Assessment', route: '/commercial', icon: Building2, capability: 'module.commercial_industrial' },
  { id: 'compare-reports', label: 'Compare Reports', route: '/generated-reports?tab=comparisons', icon: GitCompare, capability: 'report.comparisons' },
  { id: 'deal-pipeline', label: 'Deal Pipeline', route: '/deal-pipeline', icon: TrendingUp, capability: 'module.deal_pipeline' },
  { id: 'marketplace', label: 'Property Marketplace', route: '/listings', icon: Building2, capability: 'module.property_marketplace' },
];
