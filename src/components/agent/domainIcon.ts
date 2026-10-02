/**
 * The icon for each area of the business a tool touches — shared by the work
 * trace and the approval card so a step and the action it proposes look alike.
 */
import {
  Bell, Brain, Briefcase, Calendar, ClipboardList, FileText, Home, LineChart, Mail, Phone, Search,
  Settings2, Sparkles, Target, Users, Wallet, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ToolDomain } from '@/lib/agent/toolNarration.pure';

const DOMAIN_ICON: Record<ToolDomain, LucideIcon> = {
  clients: Users,
  deals: Briefcase,
  reminders: Bell,
  financial: Wallet,
  email: Mail,
  calendar: Calendar,
  calls: Phone,
  reports: FileText,
  operations: ClipboardList,
  plans: Target,
  analytics: LineChart,
  team: Users,
  listings: Home,
  admin: Settings2,
  memory: Brain,
  tools: Wrench,
  general: Search,
};

export function domainIcon(domain: ToolDomain): LucideIcon {
  return DOMAIN_ICON[domain] ?? Sparkles;
}
