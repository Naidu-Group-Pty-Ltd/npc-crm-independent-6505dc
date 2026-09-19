import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortalNotifications, PortalNotification } from '@/contexts/PortalNotificationContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Bell, CheckCircle, Info, AlertTriangle, ArrowRight,
  Loader2, BellOff, FileText, Building2, MessageSquare,
  CheckCheck, CalendarDays, UserCircle
} from 'lucide-react';
import { formatDistanceToNow, isToday, isYesterday, isThisWeek, format } from 'date-fns';
import { toast } from 'sonner';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { PortalPanel, PortalPanelContent, portalPanelClassName } from '@/components/portal/PortalSurface';

const typeIcons: Record<string, any> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  action: ArrowRight,
};

const typeStyles: Record<string, string> = {
  info: 'border border-primary/10 bg-card text-primary',
  success: 'border border-primary/20 bg-primary/10 text-primary',
  warning: 'border border-primary/20 bg-primary/10 text-primary',
  action: 'border border-primary/20 bg-primary/10 text-primary',
};

const categoryIcons: Record<string, any> = {
  deal: Building2,
  document: FileText,
  message: MessageSquare,
  property: Building2,
  general: Bell,
  appointment: CalendarDays,
  account: UserCircle,
};

function groupByDate(notifications: PortalNotification[]) {
  const groups: { label: string; items: PortalNotification[] }[] = [];
  const buckets: Record<string, PortalNotification[]> = {};

  for (const n of notifications) {
    const d = new Date(n.created_at);
    let key: string;
    if (isToday(d)) key = 'Today';
    else if (isYesterday(d)) key = 'Yesterday';
    else if (isThisWeek(d)) key = 'This Week';
    else key = format(d, 'MMMM yyyy');

    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(n);
  }

  for (const [label, items] of Object.entries(buckets)) {
    groups.push({ label, items });
  }

  return groups;
}

export default function PortalNotifications() {
  const navigate = useNavigate();
  const { notifications, unreadCount, isLoading, markAsRead, markAllAsRead } = usePortalNotifications();
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'all'
    ? notifications
    : filter === 'unread'
      ? notifications.filter(n => !n.is_read)
      : notifications.filter(n => n.category === filter);

  const groups = groupByDate(filtered);

  const handleMarkAllRead = async () => {
    await markAllAsRead();
    toast.success('All notifications marked as read');
  };

  const handleNotifClick = (notif: PortalNotification) => {
    if (!notif.is_read) markAsRead(notif.id);
    if (notif.action_url) navigate(notif.action_url);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading notifications...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="client-portal-page-header flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <Bell className="h-6 w-6 text-primary" />
            Notifications
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Stay updated on your deals, documents, and account activity
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {unreadCount > 0 && (
            <>
              <Badge variant="default" className="text-sm px-3 py-1">
                {unreadCount} unread
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-xl text-xs shadow-sm shadow-primary/5"
                onClick={handleMarkAllRead}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList className="flex w-full flex-wrap rounded-2xl border border-border/60 bg-card/70 p-1 shadow-lg shadow-primary/5">
          <TabsTrigger value="all" className="flex-1">All</TabsTrigger>
          <TabsTrigger value="unread" className="flex-1">
            Unread {unreadCount > 0 && `(${unreadCount})`}
          </TabsTrigger>
          <TabsTrigger value="deal" className="flex-1">Deals</TabsTrigger>
          <TabsTrigger value="document" className="flex-1">Documents</TabsTrigger>
          <TabsTrigger value="appointment" className="flex-1">Appointments</TabsTrigger>
          <TabsTrigger value="account" className="flex-1">Account</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Notification List */}
      {filtered.length === 0 ? (
        <PortalEmptyState
          className="client-portal-soft-panel"
          icon={<BellOff className="h-8 w-8" />}
          title={filter === 'unread' ? 'All caught up' : 'No notifications yet'}
          description={filter === 'unread'
            ? "You've read everything in your inbox."
            : "You'll see updates about your deals, documents, appointments, and account here."}
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                {group.label}
              </p>
              <PortalPanel className="overflow-hidden">
                <PortalPanelContent className="p-0">
                  <div className="divide-y divide-border">
                    {group.items.map((notif) => {
                      const TypeIcon = typeIcons[notif.type] || Info;
                      const CatIcon = categoryIcons[notif.category] || Bell;
                      const style = typeStyles[notif.type] || typeStyles.info;

                      return (
                        <div
                          key={notif.id}
                          className={`px-5 py-4 transition-colors flex items-start gap-4 cursor-pointer ${
                            !notif.is_read
                              ? 'bg-primary/[0.04] hover:bg-primary/[0.07]'
                              : 'hover:bg-accent/20'
                          }`}
                          onClick={() => handleNotifClick(notif)}
                          role="button"
                          tabIndex={0}
                        >
                          <div className={`p-2.5 rounded-xl shrink-0 ${style}`}>
                            <TypeIcon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className={`text-sm font-medium ${!notif.is_read ? 'text-foreground' : 'text-muted-foreground'}`}>
                                {notif.title}
                              </p>
                              {!notif.is_read && (
                                <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                              )}
                            </div>
                            {notif.message && (
                              <p className="text-sm text-muted-foreground line-clamp-2">{notif.message}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5">
                              <Badge variant="outline" className="text-[10px] capitalize gap-1">
                                <CatIcon className="h-3 w-3" />
                                {notif.category}
                              </Badge>
                              <span className="text-[11px] text-muted-foreground/60">
                                {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                              </span>
                            </div>
                          </div>
                          {!notif.is_read && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                              onClick={(e) => { e.stopPropagation(); markAsRead(notif.id); }}
                            >
                              Mark read
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </PortalPanelContent>
              </PortalPanel>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
