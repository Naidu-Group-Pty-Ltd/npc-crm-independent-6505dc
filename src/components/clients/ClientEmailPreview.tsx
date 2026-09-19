import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Mail, 
  ExternalLink, 
  Loader2,
  Clock,
  Sparkles,
  ChevronRight
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';

interface LinkedEmail {
  id: string;
  sender: string;
  subject: string;
  received_at: string;
  status: string;
  summary: any | null;
}

interface ClientEmailPreviewProps {
  clientId: string;
  maxEmails?: number;
  onViewAll?: () => void;
}

export function ClientEmailPreview({ 
  clientId, 
  maxEmails = 3,
  onViewAll 
}: ClientEmailPreviewProps) {
  const navigate = useNavigate();

  const { data: emails = [], isLoading } = useQuery({
    queryKey: ['client-emails-preview', clientId],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        clientId,
        include: { emails: true },
      });

      if (error) throw error;
      return (data?.emails || []).slice(0, maxEmails) as LinkedEmail[];
    },
    staleTime: 30000, // 30 seconds
  });

  const extractSenderName = (sender: string): string => {
    const match = sender.match(/^([^<]+)</);
    if (match) return match[1].trim();
    const emailMatch = sender.match(/^([^@]+)@/);
    if (emailMatch) {
      return emailMatch[1]
        .split(/[._-]/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
    }
    return sender;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="text-center py-3">
        <Mail className="h-5 w-5 mx-auto text-muted-foreground/50 mb-1" />
        <p className="text-xs text-muted-foreground">No linked emails</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Mail className="h-3 w-3" />
          Recent Emails
        </span>
        {onViewAll && emails.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[10px] px-1.5"
            onClick={onViewAll}
          >
            View All
            <ChevronRight className="h-3 w-3 ml-0.5" />
          </Button>
        )}
      </div>
      
      <div className="space-y-1.5">
        {emails.map((email) => (
          <div
            key={email.id}
            onClick={() => navigate(`/email-copilot?emailId=${email.id}`)}
            className="flex items-start gap-2 p-2 rounded-md bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-semibold text-primary">
                {extractSenderName(email.sender).slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">
                {email.subject || '(No Subject)'}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-muted-foreground truncate">
                  {extractSenderName(email.sender)}
                </span>
                <span className="text-muted-foreground/40">•</span>
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" />
                  {formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}
                </span>
                {email.summary && (
                  <Sparkles className="h-2.5 w-2.5 text-success flex-shrink-0" />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
