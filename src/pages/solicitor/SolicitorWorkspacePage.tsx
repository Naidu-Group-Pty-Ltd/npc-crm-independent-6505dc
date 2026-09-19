import { Bell, Inbox, ListChecks, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SolicitorEmptyState } from '@/components/solicitor-portal/SolicitorEmptyState';
import { SolicitorPortalShell } from '@/components/solicitor-portal/SolicitorPortalShell';

type WorkspaceKind = 'messages' | 'tasks' | 'notifications';

const COPY: Record<WorkspaceKind, {
  title: string;
  description: string;
  emptyTitle: string;
  emptyBody: string;
  hint: string;
  icon: React.ElementType;
}> = {
  messages: {
    title: 'Messages',
    description: 'Matter-scoped conversations with the referring team.',
    emptyTitle: 'No conversations yet',
    emptyBody: 'Case conversations appear here as soon as you are added as a participant on a matter.',
    hint: 'Matter-scoped · audited',
    icon: MessageSquare,
  },
  tasks: {
    title: 'Tasks',
    description: 'Shared and legal tasks across every matter shared with your practice.',
    emptyTitle: 'Nothing needs your attention',
    emptyBody: 'Shared and legal tasks appear here once a matter runway is configured.',
    hint: 'Requisitions · searches · settlement',
    icon: ListChecks,
  },
  notifications: {
    title: 'Notifications',
    description: 'Everything that changed since you last signed in.',
    emptyTitle: "You're all caught up",
    emptyBody: 'Updates appear here when cases, access, documents or projections change.',
    hint: 'Realtime · per matter',
    icon: Bell,
  },
};

export default function SolicitorWorkspacePage({ kind }: { kind: WorkspaceKind }) {
  const navigate = useNavigate();
  const copy = COPY[kind];
  const Icon = copy.icon ?? Inbox;

  return (
    <SolicitorPortalShell title={copy.title} description={copy.description}>
      <SolicitorEmptyState
        icon={<Icon className="h-6 w-6" aria-hidden />}
        title={copy.emptyTitle}
        description={copy.emptyBody}
        actionLabel="Open matters"
        onAction={() => navigate('/solicitor/matters')}
        secondaryLabel="Back to dashboard"
        onSecondaryAction={() => navigate('/solicitor')}
        hint={copy.hint}
      />
    </SolicitorPortalShell>
  );
}
