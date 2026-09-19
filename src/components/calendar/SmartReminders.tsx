import { useState, useEffect } from 'react';
import { Bell, BellOff, Clock, Mail, MessageSquare, Smartphone, Settings2, Plus, Trash2, Save } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface ReminderRule {
  id: string;
  name: string;
  enabled: boolean;
  timing: number; // minutes before
  timingUnit: 'minutes' | 'hours' | 'days';
  channels: ('browser' | 'email' | 'sms')[];
  applyTo: 'all' | 'specific';
  calendarIds?: string[];
}

interface SmartRemindersProps {
  calendars: Array<{ id: string; name: string; eventColor?: string }>;
  onSaveRules?: (rules: ReminderRule[]) => void;
}

const DEFAULT_RULES: ReminderRule[] = [
  {
    id: '1',
    name: '15 min before',
    enabled: true,
    timing: 15,
    timingUnit: 'minutes',
    channels: ['browser'],
    applyTo: 'all',
  },
  {
    id: '2',
    name: '1 hour before',
    enabled: true,
    timing: 1,
    timingUnit: 'hours',
    channels: ['browser', 'email'],
    applyTo: 'all',
  },
  {
    id: '3',
    name: 'Day before',
    enabled: false,
    timing: 1,
    timingUnit: 'days',
    channels: ['email'],
    applyTo: 'all',
  },
];

export function SmartReminders({ calendars, onSaveRules }: SmartRemindersProps) {
  const { toast } = useToast();
  const [rules, setRules] = useState<ReminderRule[]>(() => {
    const saved = localStorage.getItem('calendar-reminder-rules');
    return saved ? JSON.parse(saved) : DEFAULT_RULES;
  });
  const [masterEnabled, setMasterEnabled] = useState(true);
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setHasChanges(true);
  }, [rules, masterEnabled]);

  const handleToggleRule = (ruleId: string) => {
    setRules(prev => prev.map(r => 
      r.id === ruleId ? { ...r, enabled: !r.enabled } : r
    ));
  };

  const handleToggleChannel = (ruleId: string, channel: 'browser' | 'email' | 'sms') => {
    setRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r;
      const channels = r.channels.includes(channel)
        ? r.channels.filter(c => c !== channel)
        : [...r.channels, channel];
      return { ...r, channels };
    }));
  };

  const handleUpdateTiming = (ruleId: string, timing: number, unit: 'minutes' | 'hours' | 'days') => {
    setRules(prev => prev.map(r => 
      r.id === ruleId ? { ...r, timing, timingUnit: unit } : r
    ));
  };

  const handleAddRule = () => {
    const newRule: ReminderRule = {
      id: Date.now().toString(),
      name: 'New Reminder',
      enabled: true,
      timing: 30,
      timingUnit: 'minutes',
      channels: ['browser'],
      applyTo: 'all',
    };
    setRules(prev => [...prev, newRule]);
    setEditingRule(newRule.id);
  };

  const handleDeleteRule = (ruleId: string) => {
    setRules(prev => prev.filter(r => r.id !== ruleId));
  };

  const handleSave = () => {
    localStorage.setItem('calendar-reminder-rules', JSON.stringify(rules));
    localStorage.setItem('calendar-reminders-enabled', String(masterEnabled));
    onSaveRules?.(rules);
    setHasChanges(false);
    toast({
      title: 'Reminders saved',
      description: `${rules.filter(r => r.enabled).length} active reminder rules`,
    });
  };

  const getTimingDisplay = (rule: ReminderRule) => {
    const unit = rule.timingUnit === 'minutes' ? 'min' : 
                 rule.timingUnit === 'hours' ? 'hr' : 'day';
    return `${rule.timing} ${unit}${rule.timing !== 1 ? 's' : ''}`;
  };

  const getChannelIcon = (channel: 'browser' | 'email' | 'sms') => {
    switch (channel) {
      case 'browser': return <Bell className="h-3 w-3" />;
      case 'email': return <Mail className="h-3 w-3" />;
      case 'sms': return <Smartphone className="h-3 w-3" />;
    }
  };

  const activeRulesCount = rules.filter(r => r.enabled).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Bell className="h-4 w-4" />
          Smart Reminders
        </h3>
        <div className="flex items-center gap-2">
          <Switch
            checked={masterEnabled}
            onCheckedChange={setMasterEnabled}
          />
          <span className="text-xs text-muted-foreground">
            {masterEnabled ? 'On' : 'Off'}
          </span>
        </div>
      </div>

      {!masterEnabled ? (
        <Card className="p-6 text-center bg-muted/30">
          <BellOff className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
          <p className="text-sm font-medium text-muted-foreground">Reminders Disabled</p>
          <p className="text-xs text-muted-foreground mt-1">
            Turn on reminders to get notified before events
          </p>
        </Card>
      ) : (
        <>
          {/* Status */}
          <Card className="p-3 bg-primary/5 border-primary/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge className="bg-success/20 text-success border-success/30">
                  {activeRulesCount} active
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {rules.length - activeRulesCount} paused
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={handleAddRule}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
          </Card>

          {/* Rules list */}
          <div className="space-y-2">
              {rules.map(rule => (
                <Card
                  key={rule.id}
                  className={cn(
                    'p-3 transition-all',
                    !rule.enabled && 'opacity-60',
                    editingRule === rule.id && 'ring-1 ring-primary'
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={() => handleToggleRule(rule.id)}
                      />
                      {editingRule === rule.id ? (
                        <Input
                          value={rule.name}
                          onChange={(e) => setRules(prev => prev.map(r => 
                            r.id === rule.id ? { ...r, name: e.target.value } : r
                          ))}
                          className="h-7 w-32 text-xs"
                          onBlur={() => setEditingRule(null)}
                          autoFocus
                        />
                      ) : (
                        <button
                          onClick={() => setEditingRule(rule.id)}
                          className="text-sm font-medium hover:text-primary"
                        >
                          {rule.name}
                        </button>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteRule(rule.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Timing */}
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <Select
                      value={String(rule.timing)}
                      onValueChange={(v) => handleUpdateTiming(rule.id, Number(v), rule.timingUnit)}
                    >
                      <SelectTrigger className="h-7 w-16 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[5, 10, 15, 30, 45, 60].map(n => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={rule.timingUnit}
                      onValueChange={(v) => handleUpdateTiming(rule.id, rule.timing, v as any)}
                    >
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minutes">minutes</SelectItem>
                        <SelectItem value="hours">hours</SelectItem>
                        <SelectItem value="days">days</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">before</span>
                  </div>

                  {/* Channels */}
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground mr-1">Via:</span>
                    {(['browser', 'email', 'sms'] as const).map(channel => (
                      <button
                        key={channel}
                        onClick={() => handleToggleChannel(rule.id, channel)}
                        className={cn(
                          'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
                          rule.channels.includes(channel)
                            ? 'bg-primary/20 text-primary'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        )}
                      >
                        {getChannelIcon(channel)}
                        <span className="capitalize">{channel}</span>
                      </button>
                    ))}
                  </div>
                </Card>
              ))}
          </div>

          {/* Save button */}
          {hasChanges && (
            <Button onClick={handleSave} className="w-full">
              <Save className="h-4 w-4 mr-2" />
              Save Reminder Settings
            </Button>
          )}
        </>
      )}

      {/* Help text */}
      <div className="pt-2 border-t text-xs text-muted-foreground">
        <p className="flex items-center gap-1">
          <Settings2 className="h-3 w-3" />
          Reminders sync with your GHL calendar events
        </p>
      </div>
    </div>
  );
}
