import { Bell, Check, CheckCheck, Trash2, FileText, AlertCircle, Info, Phone, CalendarPlus, CalendarClock, CalendarX, Clock, AlarmClock, PhoneMissed, Mail, Send, FileCheck, FileClock, FileX, RefreshCw, Archive, ArchiveRestore, Loader2, UserPlus, UserCheck, Wallet, FileSpreadsheet, Download, Share2, ShieldCheck, UserCog, Wrench, DatabaseZap, MessageSquare, FileSignature, Contact, Megaphone, Timer, Users, Map, Flag, Target, Landmark, BadgeCheck, Link2, Unlink, Lightbulb, ClipboardCheck, Newspaper, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useNotifications } from '@/contexts/NotificationsContext';
import { formatDistanceToNow } from 'date-fns';

export function NotificationsDropdown() {
  const {
    notifications,
    unreadCount,
    markAllAsRead,
    clearAll,
    handleNotificationClick,
    clearNotification
  } = useNotifications();

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'report_generated':
      case 'report_generation_completed':
        return <FileCheck className="h-4 w-4 text-success" />;
      case 'report_failed':
      case 'report_generation_failed':
        return <FileX className="h-4 w-4 text-destructive" />;
      case 'report_generation_started':
        return <FileClock className="h-4 w-4 text-primary" />;
      case 'report_regeneration_started':
        return <RefreshCw className="h-4 w-4 text-primary animate-spin" />;
      case 'report_regeneration_completed':
        return <FileCheck className="h-4 w-4 text-success" />;
      case 'report_regeneration_failed':
        return <FileX className="h-4 w-4 text-destructive" />;
      case 'report_archived':
        return <Archive className="h-4 w-4 text-muted-foreground" />;
      case 'report_restored':
        return <ArchiveRestore className="h-4 w-4 text-success" />;
      case 'call_completed':
        return <Phone className="h-4 w-4 text-primary" />;
      case 'appointment_created':
        return <CalendarPlus className="h-4 w-4 text-success" />;
      case 'appointment_rescheduled':
        return <CalendarClock className="h-4 w-4 text-brand-500" />;
      case 'appointment_cancelled':
        return <CalendarX className="h-4 w-4 text-destructive" />;
      // Phase 1 additions
      case 'client_reminder_due':
        return <Clock className="h-4 w-4 text-brand-500" />;
      case 'client_reminder_overdue':
        return <AlarmClock className="h-4 w-4 text-destructive" />;
      case 'call_alert_triggered':
        return <AlertCircle className="h-4 w-4 text-brand-500" />;
      case 'missed_call':
        return <PhoneMissed className="h-4 w-4 text-destructive" />;
      case 'email_received':
        return <Mail className="h-4 w-4 text-primary" />;
      case 'email_reply_sent':
        return <Send className="h-4 w-4 text-success" />;
      // Phase 3 - Client & Portfolio
      case 'client_created':
        return <UserPlus className="h-4 w-4 text-success" />;
      case 'client_updated':
        return <UserCheck className="h-4 w-4 text-info" />;
      case 'portfolio_updated':
        return <Wallet className="h-4 w-4 text-accent-foreground" />;
      case 'formara_form_uploaded':
        return <FileSpreadsheet className="h-4 w-4 text-success" />;
      case 'formara_form_exported':
        return <Download className="h-4 w-4 text-info" />;
      case 'finance_agent_notified':
        return <Send className="h-4 w-4 text-primary" />;
      case 'client_file_shared':
        return <Share2 className="h-4 w-4 text-info" />;
      // Phase 4 - System & User
      case 'user_role_updated':
        return <ShieldCheck className="h-4 w-4 text-accent-foreground" />;
      case 'new_user_invited':
        return <UserCog className="h-4 w-4 text-success" />;
      case 'system_maintenance':
        return <Wrench className="h-4 w-4 text-brand-500" />;
      case 'data_import_complete':
        return <DatabaseZap className="h-4 w-4 text-success" />;
      case 'report_comment_added':
        return <MessageSquare className="h-4 w-4 text-info" />;
      case 'outlook_event_created':
        return <CalendarPlus className="h-4 w-4 text-info" />;
      // Phase 6 - Extended coverage
      case 'agreement_generated':
        return <FileSignature className="h-4 w-4 text-success" />;
      case 'new_ghl_contact':
        return <Contact className="h-4 w-4 text-info" />;
      case 'new_marketing_lead':
        return <Megaphone className="h-4 w-4 text-warning" />;
      case 'portal_report_requested':
        return <FileText className="h-4 w-4 text-accent-foreground" />;
      case 'client_reminder_upcoming':
        return <Timer className="h-4 w-4 text-info" />;
      case 'conversation_shared':
        return <Users className="h-4 w-4 text-accent-foreground" />;
      // Game Plan
      case 'game_plan_created':
        return <Map className="h-4 w-4 text-accent-foreground" />;
      case 'game_plan_updated':
        return <Flag className="h-4 w-4 text-brand-500" />;
      case 'game_plan_milestone_completed':
        return <Target className="h-4 w-4 text-success" />;
      // Producers repaired in 20260803030000. Every type below was writing a
      // column that does not exist on `notifications`, so none of them had ever
      // reached the bell and none had an icon.
      case 'internal_message':
        return <MessageSquare className="h-4 w-4 text-primary" />;
      case 'lender_submission_status':
        return <Landmark className="h-4 w-4 text-brand-500" />;
      case 'purchase_file_unconditional_approval':
        return <BadgeCheck className="h-4 w-4 text-success" />;
      case 'purchase_file_linked':
        return <Link2 className="h-4 w-4 text-info" />;
      case 'purchase_file_unlinked':
        return <Unlink className="h-4 w-4 text-muted-foreground" />;
      case 'agent_insight':
        return <Lightbulb className="h-4 w-4 text-warning" />;
      case 'agent_plan_scheduled':
        return <ClipboardCheck className="h-4 w-4 text-primary" />;
      case 'market_qa_digest':
        return <Newspaper className="h-4 w-4 text-info" />;
      case 'market_qa_subscription':
        return <BellRing className="h-4 w-4 text-brand-500" />;
      case 'qa_conversation_shared':
        return <Users className="h-4 w-4 text-accent-foreground" />;
      case 'portal_message_received':
      case 'finance_portal_message_received':
        return <MessageSquare className="h-4 w-4 text-info" />;
      case 'client_data_updated':
        return <UserCheck className="h-4 w-4 text-info" />;
      case 'client_property_added':
        return <Wallet className="h-4 w-4 text-success" />;
      case 'bulk_conversation_sync_completed':
        return <RefreshCw className="h-4 w-4 text-info" />;
      default:
        return <Info className="h-4 w-4 text-info" />;
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Icon-only trigger: without an explicit name a screen reader
            announces it as an unlabelled button. Found by the AML browser
            journey's accessibility sweep. */}
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 bg-popover">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {notifications.length > 0 && (
            <div className="flex gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    markAllAsRead();
                  }}
                >
                  <CheckCheck className="h-3 w-3 mr-1" />
                  Mark all read
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  clearAll();
                }}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Clear all
              </Button>
            </div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {notifications.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            {notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className={`flex flex-col items-start gap-2 p-3 cursor-pointer ${
                  !notification.read ? 'bg-muted/50' : ''
                }`}
                onClick={() => handleNotificationClick(notification)}
              >
                <div className="flex items-start gap-2 w-full">
                  <div className="mt-0.5">{getNotificationIcon(notification.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm leading-tight">{notification.title}</p>
                      {!notification.read && (
                        <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {notification.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearNotification(notification.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </DropdownMenuItem>
            ))}
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
