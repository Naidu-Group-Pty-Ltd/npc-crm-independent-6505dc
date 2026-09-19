import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  MessageSquare, 
  FileUp, 
  Bell, 
  CheckCircle, 
  Tag, 
  Building2, 
  Activity,
  Phone,
  Mail,
  Users,
  Settings,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { SyncConflictDetailsPopover } from '@/components/sync/SyncConflictDetailsPopover';
import { SyncStatusBadge } from '@/components/sync/SyncStatusBadge';
import { getActorLabel, getConflictReason, getSurfaceLabel, getVersionNumber } from '@/lib/syncDisplay';

interface ClientActivityTimelineProps {
  clientId: string;
}

const activityIcons: Record<string, any> = {
  note_added: MessageSquare,
  file_uploaded: FileUp,
  reminder_created: Bell,
  reminder_completed: CheckCircle,
  tag_added: Tag,
  tag_removed: Tag,
  property_added: Building2,
  property_updated: Building2,
  score_updated: Activity,
  contact_made: Phone,
  meeting: Users,
  email_sent: Mail,
  status_changed: Settings,
  custom: Activity,
};

const activityColors: Record<string, string> = {
  note_added: 'bg-info/10 text-info border-info/20',
  file_uploaded: 'bg-accent/15 text-accent-foreground border-accent/30',
  reminder_created: 'bg-warning/10 text-warning border-warning/20',
  reminder_completed: 'bg-success/10 text-success border-success/20',
  tag_added: 'bg-primary/10 text-primary border-primary/20',
  tag_removed: 'bg-muted text-muted-foreground border-border',
  property_added: 'bg-success/10 text-success border-success/20',
  property_updated: 'bg-success/10 text-success border-success/20',
  score_updated: 'bg-warning/10 text-warning border-warning/20',
  contact_made: 'bg-info/10 text-info border-info/20',
  meeting: 'bg-primary/10 text-primary border-primary/20',
  email_sent: 'bg-info/10 text-info border-info/20',
  status_changed: 'bg-muted text-muted-foreground border-border',
  custom: 'bg-muted text-muted-foreground border-border',
};

/**
 * Secure fetch for activities data using HttpOnly cookies
 */
async function fetchActivitiesSecure(clientId: string) {
  const { data, error } = await invokeSecureFunction('get-client-data', {
    clientId,
    include: { activities: true },
  });

  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error('Failed to fetch activities');
  return data.activities || [];
}

export function ClientActivityTimeline({ clientId }: ClientActivityTimelineProps) {
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['client-activities', clientId],
    queryFn: () => fetchActivitiesSecure(clientId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No activity recorded yet</p>
        </CardContent>
      </Card>
    );
  }

  // Group activities by date
  const groupedActivities: Record<string, typeof activities> = {};
  activities.forEach((activity: any) => {
    const dateKey = format(new Date(activity.created_at), 'yyyy-MM-dd');
    if (!groupedActivities[dateKey]) {
      groupedActivities[dateKey] = [];
    }
    groupedActivities[dateKey].push(activity);
  });

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-6 pr-4">
        {Object.entries(groupedActivities).map(([dateKey, dateActivities]) => (
          <div key={dateKey}>
            <div className="sticky top-0 bg-background py-2">
              <Badge variant="outline" className="text-xs">
                {format(new Date(dateKey), 'EEEE, MMMM d, yyyy')}
              </Badge>
            </div>
            <div className="space-y-0 mt-2 relative">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
              
              {dateActivities.map((activity: any) => {
                const Icon = activityIcons[activity.activity_type] || Activity;
                const colorClass = activityColors[activity.activity_type] || activityColors.custom;
                
                return (
                  <div key={activity.id} className="relative pl-10 pb-4">
                    {/* Timeline dot */}
                    <div className={`absolute left-2 w-5 h-5 rounded-full flex items-center justify-center ${colorClass}`}>
                      <Icon className="h-3 w-3" />
                    </div>
                    
                    <Card className="hover:shadow-sm transition-shadow">
                      <CardContent className="py-3 px-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{activity.title}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <SyncStatusBadge status={activity.sync_status} />
                              {activity.source_surface && (
                                <Badge variant="outline" className="text-xs">
                                  {getSurfaceLabel(activity.source_surface)}
                                </Badge>
                              )}
                            </div>
                            {activity.description && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {activity.description}
                              </p>
                            )}
                            {(getActorLabel(activity) || getVersionNumber(activity) || getConflictReason(activity)) && (
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                {getActorLabel(activity) && <span>By {getActorLabel(activity)}</span>}
                                {getVersionNumber(activity) ? <span>v{getVersionNumber(activity)}</span> : null}
                                {getConflictReason(activity) ? <span className="text-warning">{getConflictReason(activity)}</span> : null}
                                <SyncConflictDetailsPopover record={activity} />
                              </div>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(activity.created_at), 'h:mm a')}
                          </span>
                        </div>
                        
                        {/* Activity metadata */}
                        {activity.metadata && Object.keys(activity.metadata as object).length > 0 && (
                          <div className="mt-2 pt-2 border-t">
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(activity.metadata as Record<string, any>).slice(0, 3).map(([key, value]) => (
                                <Badge key={key} variant="secondary" className="text-xs">
                                  {key}: {String(value)}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
