import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { callLogBadgeTone } from './badgeStyles';
import { useToast } from '@/hooks/use-toast';
import { 
  Bell, 
  BellRing, 
  Plus, 
  Trash2, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  DollarSign,
  ThumbsUp,
  ThumbsDown,
  Zap,
  Settings,
  Mail,
  Send
} from 'lucide-react';
import { format } from 'date-fns';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { cn } from '@/lib/utils';

interface AlertRule {
  id: string;
  name: string;
  condition_type: string;
  condition_operator: string;
  condition_value: string;
  is_positive: boolean;
  is_enabled: boolean;
  notification_type: string;
  created_at: string;
}

interface AlertHistory {
  id: string;
  rule_id: string;
  call_id: string;
  rule_name: string;
  message: string;
  is_positive: boolean;
  is_read: boolean;
  triggered_at: string;
}

interface CallLog {
  id: string;
  sentiment: string | null;
  duration_seconds: number | null;
  call_outcome: string | null;
  cost: number | null;
  customer_name: string | null;
  phone_number: string | null;
}

interface CallAlertsProps {
  calls: CallLog[];
  onAlertTriggered?: (alert: AlertHistory) => void;
  triggerClassName?: string;
}

const CONDITION_TYPES = [
  { value: 'sentiment', label: 'Sentiment', icon: ThumbsUp },
  { value: 'duration', label: 'Duration (seconds)', icon: Clock },
  { value: 'outcome', label: 'Call Outcome', icon: CheckCircle },
  { value: 'cost', label: 'Cost ($)', icon: DollarSign },
];

const OPERATORS = {
  sentiment: [
    { value: 'equals', label: 'equals' },
  ],
  duration: [
    { value: 'greater_than', label: 'greater than' },
    { value: 'less_than', label: 'less than' },
  ],
  outcome: [
    { value: 'equals', label: 'equals' },
  ],
  cost: [
    { value: 'greater_than', label: 'greater than' },
    { value: 'less_than', label: 'less than' },
  ],
};

const VALUE_OPTIONS = {
  sentiment: ['positive', 'negative', 'neutral', 'mixed'],
  outcome: ['completed', 'failed', 'voicemail', 'no-answer', 'busy', 'cancelled'],
};


const alertDialogShell =
  'max-h-[80vh] max-w-3xl overflow-y-auto border border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/98 via-card dark:via-background/95 to-background dark:to-black/95 p-0 text-foreground dark:text-foreground shadow-2xl shadow-sm dark:shadow-black/50';
const alertSectionCard =
  'relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/95 via-card dark:via-background/80 to-background dark:to-black/90 shadow-xl shadow-sm dark:shadow-black/25 before:pointer-events-none before:absolute before:inset-x-6 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-200/35 before:to-transparent';
const alertControl =
  'rounded-2xl border-border dark:border-white/10 bg-background dark:bg-black/45 text-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/25 transition-all placeholder:text-muted-foreground hover:border-brand-300/35 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black';
const alertPrimaryButton =
  'rounded-2xl bg-gradient-to-r from-brand-300 via-brand-400 to-brand-500 font-semibold text-black shadow-lg shadow-brand-500/20 transition-all hover:-translate-y-0.5 hover:from-brand-200 hover:via-brand-300 hover:to-brand-400 hover:shadow-brand-500/30 disabled:translate-y-0 disabled:opacity-50';

// Secure API helpers
async function fetchRulesSecure(): Promise<AlertRule[]> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'list',
    table: 'call_alert_rules',
  });
  
  if (error || !data?.success) {
    console.error('Error fetching rules:', error || data?.error);
    return [];
  }
  return data.items || [];
}

async function fetchHistorySecure(): Promise<AlertHistory[]> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'list',
    table: 'call_alert_history',
    filters: { limit: 50 },
  });
  
  if (error || !data?.success) {
    console.error('Error fetching history:', error || data?.error);
    return [];
  }
  return data.items || [];
}

async function createRuleSecure(ruleData: Partial<AlertRule>): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'create',
    table: 'call_alert_rules',
    data: ruleData,
  });
  
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error };
  return { success: true };
}

async function updateRuleSecure(ruleId: string, updateData: Partial<AlertRule>): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'update',
    table: 'call_alert_rules',
    recordId: ruleId,
    data: updateData,
  });
  
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error };
  return { success: true };
}

async function deleteRuleSecure(ruleId: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'delete',
    table: 'call_alert_rules',
    recordId: ruleId,
  });
  
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error };
  return { success: true };
}

async function createAlertHistorySecure(alertData: Partial<AlertHistory>): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'create',
    table: 'call_alert_history',
    data: alertData,
  });
  
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error };
  return { success: true };
}

async function checkExistingAlertSecure(callId: string, ruleId: string): Promise<boolean> {
  // We need to check if an alert already exists - use list with filters would be ideal
  // For now, we'll fetch all and check client-side (not ideal but works)
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'list',
    table: 'call_alert_history',
    filters: { limit: 500 },
  });
  
  if (error || !data?.success) return false;
  
  const items = data.items || [];
  return items.some((item: AlertHistory) => item.call_id === callId && item.rule_id === ruleId);
}

async function markAllReadSecure(): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await invokeSecureFunction('manage-call-settings', {
    operation: 'update',
    table: 'call_alert_history',
    recordId: 'bulk',
    data: { is_read: true },
  });
  
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error };
  return { success: true };
}

export const CallAlerts = ({ calls, onAlertTriggered, triggerClassName }: CallAlertsProps) => {
  const { toast } = useToast();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistory[]>([]);
  const [showManager, setShowManager] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  
  // New rule form
  const [newRuleName, setNewRuleName] = useState('');
  const [newConditionType, setNewConditionType] = useState('sentiment');
  const [newOperator, setNewOperator] = useState('equals');
  const [newValue, setNewValue] = useState('');
  const [newIsPositive, setNewIsPositive] = useState(false);
  const [newNotificationType, setNewNotificationType] = useState('toast');
  const [emailRecipient, setEmailRecipient] = useState('');

  useEffect(() => {
    fetchRules();
    fetchHistory();

    // Subscribe to new alerts (realtime still works for notifications)
    const channel = supabase
      .channel('call-alerts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_alert_history' }, (payload) => {
        const newAlert = payload.new as AlertHistory;
        setHistory(prev => [newAlert, ...prev]);
        setUnreadCount(prev => prev + 1);
        
        // Show toast notification
        toast({
          title: newAlert.is_positive ? '🎉 Positive Alert' : '⚠️ Alert Triggered',
          description: newAlert.message,
          variant: newAlert.is_positive ? 'default' : 'destructive',
        });
        
        onAlertTriggered?.(newAlert);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Check calls against rules and send email notifications if needed
  const sendEmailNotification = async (rule: AlertRule, call: CallLog, message: string) => {
    if (rule.notification_type !== 'email' && rule.notification_type !== 'both') return;
    
    const adminEmail = localStorage.getItem('alertEmailRecipient') || '';
    if (!adminEmail) {
      console.log('No email recipient configured for alerts');
      return;
    }
    
    try {
      const response = await invokeSecureFunction('send-call-alert-email', {
        to: adminEmail,
        alertName: rule.name,
        callId: call.id,
        customerName: call.customer_name,
        phoneNumber: call.phone_number,
        sentiment: call.sentiment,
        duration: call.duration_seconds,
        outcome: call.call_outcome,
        cost: call.cost,
        message,
        isPositive: rule.is_positive,
      });
      
      if (response.error) {
        console.error('Failed to send email notification:', response.error);
      } else {
        console.log('Email notification sent successfully');
      }
    } catch (error) {
      console.error('Error sending email notification:', error);
    }
  };

  // Check calls against rules
  const checkCallsAgainstRules = useCallback(async (callsToCheck: CallLog[]) => {
    const enabledRules = rules.filter(r => r.is_enabled);
    
    for (const call of callsToCheck) {
      for (const rule of enabledRules) {
        const triggered = evaluateRule(rule, call);
        if (triggered) {
          // Check if alert already exists for this call/rule combo
          const exists = await checkExistingAlertSecure(call.id, rule.id);
          
          if (!exists) {
            const message = generateAlertMessage(rule, call);
            await createAlertHistorySecure({
              rule_id: rule.id,
              call_id: call.id,
              rule_name: rule.name,
              message,
              is_positive: rule.is_positive,
            });
            
            // Send email notification if configured
            await sendEmailNotification(rule, call, message);
          }
        }
      }
    }
  }, [rules]);

  useEffect(() => {
    if (calls.length > 0 && rules.length > 0) {
      const recentCalls = calls.filter(c => {
        return true; // Check all current calls
      });
      checkCallsAgainstRules(recentCalls);
    }
  }, [calls, rules, checkCallsAgainstRules]);

  const evaluateRule = (rule: AlertRule, call: CallLog): boolean => {
    const { condition_type, condition_operator, condition_value } = rule;
    
    switch (condition_type) {
      case 'sentiment':
        return call.sentiment === condition_value;
      case 'duration':
        if (!call.duration_seconds) return false;
        const durationVal = parseInt(condition_value);
        return condition_operator === 'greater_than' 
          ? call.duration_seconds > durationVal
          : call.duration_seconds < durationVal;
      case 'outcome':
        return call.call_outcome === condition_value;
      case 'cost':
        if (!call.cost) return false;
        const costVal = parseFloat(condition_value);
        return condition_operator === 'greater_than'
          ? call.cost > costVal
          : call.cost < costVal;
      default:
        return false;
    }
  };

  const generateAlertMessage = (rule: AlertRule, call: CallLog): string => {
    const caller = call.customer_name || call.phone_number || 'Unknown caller';
    
    switch (rule.condition_type) {
      case 'sentiment':
        return `${caller} - ${rule.condition_value} sentiment detected`;
      case 'duration':
        return `${caller} - Call duration: ${Math.round((call.duration_seconds || 0) / 60)}min`;
      case 'outcome':
        return `${caller} - Call ${rule.condition_value}`;
      case 'cost':
        return `${caller} - Call cost: $${(call.cost || 0).toFixed(2)}`;
      default:
        return `${caller} - Alert triggered`;
    }
  };

  const fetchRules = async () => {
    const items = await fetchRulesSecure();
    setRules(items);
  };

  const fetchHistory = async () => {
    const items = await fetchHistorySecure();
    setHistory(items);
    setUnreadCount(items.filter(a => !a.is_read).length);
  };

  const createRule = async () => {
    if (!newRuleName.trim() || !newValue) return;
    
    if ((newNotificationType === 'email' || newNotificationType === 'both') && !emailRecipient) {
      toast({ title: 'Error', description: 'Please enter an email address for notifications', variant: 'destructive' });
      return;
    }
    
    if (emailRecipient) {
      localStorage.setItem('alertEmailRecipient', emailRecipient);
    }
    
    setLoading(true);
    try {
      const result = await createRuleSecure({
        name: newRuleName.trim(),
        condition_type: newConditionType,
        condition_operator: newOperator,
        condition_value: newValue,
        is_positive: newIsPositive,
        notification_type: newNotificationType,
      });

      if (!result.success) {
        toast({ title: 'Error', description: result.error || 'Failed to create rule', variant: 'destructive' });
        return;
      }

      toast({ title: 'Rule created', description: `"${newRuleName}" alert rule created` });
      logActivityDirect({
        actionType: 'alert_rule_created',
        entityType: 'call_alert_rule',
        entityName: newRuleName,
        metadata: { conditionType: newConditionType, notificationType: newNotificationType }
      });
      setNewRuleName('');
      setNewValue('');
      setNewIsPositive(false);
      setNewNotificationType('toast');
      fetchRules();
    } finally {
      setLoading(false);
    }
  };

  const toggleRule = async (ruleId: string, enabled: boolean) => {
    const rule = rules.find(r => r.id === ruleId);
    const result = await updateRuleSecure(ruleId, { is_enabled: enabled });
    
    if (result.success) {
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, is_enabled: enabled } : r));
      logActivityDirect({
        actionType: 'alert_rule_updated',
        entityType: 'call_alert_rule',
        entityId: ruleId,
        entityName: rule?.name,
        metadata: { field: 'is_enabled', value: enabled }
      });
    }
  };

  const deleteRule = async (ruleId: string) => {
    const rule = rules.find(r => r.id === ruleId);
    const result = await deleteRuleSecure(ruleId);
    
    if (result.success) {
      logActivityDirect({
        actionType: 'alert_rule_deleted',
        entityType: 'call_alert_rule',
        entityId: ruleId,
        entityName: rule?.name
      });
      fetchRules();
    }
  };

  const markAllRead = async () => {
    const result = await markAllReadSecure();
    
    if (result.success) {
      setHistory(prev => prev.map(a => ({ ...a, is_read: true })));
      setUnreadCount(0);
    }
  };

  const getConditionIcon = (type: string) => {
    const found = CONDITION_TYPES.find(c => c.value === type);
    return found ? found.icon : AlertTriangle;
  };

  const getNotificationTypeLabel = (type: string) => {
    switch (type) {
      case 'email': return 'Email';
      case 'both': return 'Toast + Email';
      default: return 'Toast';
    }
  };

  // Load saved email from localStorage
  useEffect(() => {
    const savedEmail = localStorage.getItem('alertEmailRecipient');
    if (savedEmail) setEmailRecipient(savedEmail);
  }, []);

  return (
    <div className="space-y-4">
      {/* Alert Bell with Dropdown */}
      <div className="flex items-center gap-2">
        <Dialog open={showManager} onOpenChange={setShowManager}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className={`gap-2 relative ${triggerClassName || ''}`}>
              {unreadCount > 0 ? (
                <BellRing className="h-4 w-4 text-brand-300" />
              ) : (
                <Bell className="w-4 h-4 shrink-0" />
              )}
              Alerts
              {unreadCount > 0 && (
                <Badge className={callLogBadgeTone('danger', 'absolute -top-2 -right-2 h-5 w-5 justify-center p-0 text-[10px]')}>
                  {unreadCount}
                </Badge>
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className={alertDialogShell}>
            <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
            <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-brand-500/10 blur-3xl" />
            <DialogHeader className="relative border-b border-border dark:border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_34%),linear-gradient(90deg,rgba(24,24,27,0.94),rgba(0,0,0,0.78),rgba(120,53,15,0.16))] px-6 py-5">
              <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-brand-300/20 bg-brand-300/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-100">
                <BellRing className="h-3 w-3" />
                Operational Monitoring
              </div>
              <DialogTitle className="flex items-center gap-3 text-2xl text-foreground dark:text-foreground">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-500/10 text-brand-200 shadow-inner shadow-brand-950/40">
                  <Bell className="h-5 w-5" />
                </span>
                Call Alerts
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-6 px-6 py-5">
              {/* Email Configuration */}
              <Card className={alertSectionCard}>
                <CardHeader className="border-b border-border dark:border-white/10 bg-gradient-to-r from-info/10 via-transparent to-brand-500/10 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm text-foreground dark:text-foreground">
                    <Mail className="w-4 h-4" />
                    Email Notifications
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground dark:text-muted-foreground">
                    Configure email address for alert notifications
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="admin@example.com"
                      value={emailRecipient}
                      onChange={(e) => setEmailRecipient(e.target.value)}
                      className={cn("flex-1", alertControl)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-2xl border-info/20 bg-info/10 text-info hover:bg-info/20"
                      onClick={() => {
                        localStorage.setItem('alertEmailRecipient', emailRecipient);
                        toast({ title: 'Saved', description: 'Email recipient saved' });
                      }}
                      disabled={!emailRecipient}
                    >
                      Save
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Create New Rule */}
              <Card className={alertSectionCard}>
                <CardHeader className="border-b border-border dark:border-white/10 bg-gradient-to-r from-brand-500/10 via-transparent to-accent/10 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm text-foreground dark:text-foreground">
                    <Plus className="w-4 h-4" />
                    Create Alert Rule
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    className={alertControl}
                    placeholder="Rule name (e.g., 'Negative Sentiment Alert')"
                    value={newRuleName}
                    onChange={(e) => setNewRuleName(e.target.value)}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <Select value={newConditionType} onValueChange={(v) => {
                      setNewConditionType(v);
                      setNewOperator(OPERATORS[v as keyof typeof OPERATORS]?.[0]?.value || 'equals');
                      setNewValue('');
                    }}>
                      <SelectTrigger className={alertControl}>
                        <SelectValue placeholder="Condition" />
                      </SelectTrigger>
                      <SelectContent>
                        {CONDITION_TYPES.map(type => (
                          <SelectItem key={type.value} value={type.value}>
                            <div className="flex items-center gap-2">
                              <type.icon className="w-4 h-4" />
                              {type.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    
                    <Select value={newOperator} onValueChange={setNewOperator}>
                      <SelectTrigger className={alertControl}>
                        <SelectValue placeholder="Operator" />
                      </SelectTrigger>
                      <SelectContent>
                        {OPERATORS[newConditionType as keyof typeof OPERATORS]?.map(op => (
                          <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    
                    {VALUE_OPTIONS[newConditionType as keyof typeof VALUE_OPTIONS] ? (
                      <Select value={newValue} onValueChange={setNewValue}>
                        <SelectTrigger className={alertControl}>
                          <SelectValue placeholder="Value" />
                        </SelectTrigger>
                        <SelectContent>
                          {VALUE_OPTIONS[newConditionType as keyof typeof VALUE_OPTIONS].map(val => (
                            <SelectItem key={val} value={val} className="capitalize">{val}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        className={alertControl}
                        type="number"
                        placeholder={newConditionType === 'duration' ? 'Seconds' : 'Amount'}
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                      />
                    )}
                  </div>
                  
                  {/* Notification Type Selection */}
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Notification Type</Label>
                    <Select value={newNotificationType} onValueChange={setNewNotificationType}>
                      <SelectTrigger className={alertControl}>
                        <SelectValue placeholder="Select notification type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="toast">
                          <div className="flex items-center gap-2">
                            <Bell className="w-4 h-4" />
                            Toast Only
                          </div>
                        </SelectItem>
                        <SelectItem value="email">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            Email Only
                          </div>
                        </SelectItem>
                        <SelectItem value="both">
                          <div className="flex items-center gap-2">
                            <Send className="w-4 h-4" />
                            Toast + Email
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="flex items-center justify-between rounded-3xl border border-border dark:border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center gap-2">
                      <Switch checked={newIsPositive} onCheckedChange={setNewIsPositive} />
                      <span className="text-sm">
                        {newIsPositive ? (
                          <span className="flex items-center gap-1 text-success">
                            <ThumbsUp className="w-4 h-4" /> Positive Alert
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-brand-300">
                            <AlertTriangle className="w-4 h-4" /> Warning Alert
                          </span>
                        )}
                      </span>
                    </div>
                    <Button onClick={createRule} disabled={loading || !newRuleName.trim() || !newValue} size="sm" className={alertPrimaryButton}>
                      <Plus className="w-4 h-4 mr-1" />
                      Create Rule
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Active Rules */}
              <Card className={alertSectionCard}>
                <CardHeader className="border-b border-border dark:border-white/10 bg-gradient-to-r from-accent/10 via-transparent to-info/10 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm text-foreground dark:text-foreground">
                    <Settings className="w-4 h-4" />
                    Active Rules ({rules.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[150px]">
                    <div className="space-y-2">
                      {rules.map(rule => {
                        const Icon = getConditionIcon(rule.condition_type);
                        return (
                          <div key={rule.id} className="group flex items-center justify-between rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] p-3 transition-all hover:-translate-y-0.5 hover:border-brand-300/30 hover:bg-brand-300/[0.06] hover:shadow-lg hover:shadow-brand-500/10">
                            <div className="flex items-center gap-3">
                              <div className={`rounded-2xl border p-2 ${rule.is_positive ? 'border-success/20 bg-success/10' : 'border-brand-300/20 bg-brand-500/10'}`}>
                                <Icon className={`h-4 w-4 ${rule.is_positive ? 'text-success' : 'text-brand-300'}`} />
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-foreground dark:text-foreground">{rule.name}</p>
                                <div className="flex items-center gap-2">
                                  <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                                    {rule.condition_type} {rule.condition_operator.replace('_', ' ')} {rule.condition_value}
                                  </p>
                                  <Badge variant="outline" className={callLogBadgeTone('neutral', 'h-4 text-[10px]')}>
                                    {rule.notification_type === 'email' && <Mail className="w-3 h-3 mr-1" />}
                                    {rule.notification_type === 'both' && <Send className="w-3 h-3 mr-1" />}
                                    {getNotificationTypeLabel(rule.notification_type)}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={rule.is_enabled}
                                onCheckedChange={(checked) => toggleRule(rule.id, checked)}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 rounded-xl p-0 text-muted-foreground dark:text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => deleteRule(rule.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                      {rules.length === 0 && (
                        <p className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] py-5 text-center text-sm text-muted-foreground dark:text-muted-foreground">No alert rules configured</p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Alert History */}
              <Card className={alertSectionCard}>
                <CardHeader className="border-b border-border dark:border-white/10 bg-gradient-to-r from-brand-500/10 via-transparent to-success/10 pb-3">
                  <div className="flex items-center justify-between rounded-3xl border border-border dark:border-white/10 bg-white/[0.03] p-4">
                    <CardTitle className="flex items-center gap-2 text-sm text-foreground dark:text-foreground">
                      <Zap className="w-4 h-4" />
                      Recent Alerts
                    </CardTitle>
                    {unreadCount > 0 && (
                      <Button variant="ghost" size="sm" className="h-8 rounded-2xl text-xs text-brand-100 hover:bg-brand-300/10" onClick={markAllRead}>
                        Mark all read
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-2">
                      {history.map(alert => (
                        <div
                          key={alert.id}
                          className={`group flex items-start gap-3 rounded-2xl border p-3 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                            !alert.is_read ? 'border-brand-300/25 bg-brand-300/[0.06] hover:shadow-brand-500/10' : 'border-border dark:border-white/10 bg-white/[0.03] hover:border-white/20'
                          }`}
                        >
                          <div className={`rounded-2xl border p-2 ${alert.is_positive ? 'border-success/20 bg-success/10' : 'border-brand-300/20 bg-brand-500/10'}`}>
                            {alert.is_positive ? (
                              <CheckCircle className="h-4 w-4 text-success" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-brand-300" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold text-foreground dark:text-foreground">{alert.rule_name}</p>
                              {!alert.is_read && (
                                <Badge variant="secondary" className={callLogBadgeTone('warning', 'h-4 text-[10px]')}>New</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground dark:text-muted-foreground">{alert.message}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground dark:text-muted-foreground">
                              {format(new Date(alert.triggered_at), 'MMM dd, HH:mm')}
                            </p>
                          </div>
                        </div>
                      ))}
                      {history.length === 0 && (
                        <p className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] py-5 text-center text-sm text-muted-foreground dark:text-muted-foreground">No alerts yet</p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};
