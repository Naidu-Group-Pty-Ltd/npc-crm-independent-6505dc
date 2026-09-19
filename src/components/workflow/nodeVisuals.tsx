/**
 * Icons and accents for catalog nodes.
 *
 * Integration nodes borrow the brand mark the Integrations page already
 * resolves, so a Stripe step on the canvas and the Stripe card on that page read
 * as the same thing. Platform and logic nodes have no brand, so they carry a
 * lucide icon named by the catalog entry.
 */

import {
  Bell,
  Braces,
  Calculator,
  Clock,
  Code2,
  CopyCheck,
  FilterIcon,
  FolderCheck,
  FileText,
  GitBranch,
  GitMerge,
  Globe,
  MessageSquare,
  Newspaper,
  Octagon,
  Phone,
  Play,
  Puzzle,
  Repeat,
  ShieldAlert,
  Timer,
  Type,
  Upload,
  UserCheck,
  UserPlus,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { BrandMark } from '@/components/integrations/BrandMark';
import type { CatalogNode } from '@/lib/workflow/types';

const ICONS: Record<string, LucideIcon> = {
  bell: Bell,
  braces: Braces,
  calculator: Calculator,
  clock: Clock,
  code: Code2,
  copyCheck: CopyCheck,
  filter: FilterIcon,
  fileText: FileText,
  folderCheck: FolderCheck,
  gitBranch: GitBranch,
  gitMerge: GitMerge,
  globe: Globe,
  messageSquare: MessageSquare,
  newspaper: Newspaper,
  octagon: Octagon,
  phone: Phone,
  play: Play,
  repeat: Repeat,
  shieldAlert: ShieldAlert,
  timer: Timer,
  type: Type,
  upload: Upload,
  userCheck: UserCheck,
  userPlus: UserPlus,
  webhook: Webhook,
};

interface NodeGlyphProps {
  node: CatalogNode;
  size?: number;
}

/** The mark for a node: brand logo where there is one, lucide icon otherwise. */
export function NodeGlyph({ node, size = 18 }: NodeGlyphProps) {
  const Fallback = (node.icon && ICONS[node.icon]) || Puzzle;
  const fallback = <Fallback size={size} strokeWidth={1.75} aria-hidden="true" />;

  if (!node.integrationId) return fallback;
  return <BrandMark integrationId={node.integrationId} fallback={fallback} size={size} />;
}
