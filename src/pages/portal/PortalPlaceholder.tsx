import { Construction } from 'lucide-react';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';

interface PortalPlaceholderProps {
  title: string;
  description: string;
}

export default function PortalPlaceholder({ title, description }: PortalPlaceholderProps) {
  return (
    <div className="space-y-6">
      <div className="client-portal-page-header">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
      </div>
      <PortalEmptyState
        className="client-portal-soft-panel"
        icon={<Construction className="h-8 w-8" />}
        title="Coming soon"
        description={description}
      />
    </div>
  );
}
