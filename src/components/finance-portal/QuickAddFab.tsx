import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Plus, Briefcase, AlarmClock, FileText, Users, MessageSquare, X, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SmartSnoozeDialog } from './SmartSnoozeDialog';
import { VoiceMemoDialog } from './VoiceMemoDialog';

const ACTIONS = [
  { key: 'pf', label: 'New Purchase File', icon: Briefcase, path: '/finance/purchase-files?new=1' },
  { key: 'msg', label: 'New Message', icon: MessageSquare, path: '/finance/messages' },
  { key: 'client', label: 'View Clients', icon: Users, path: '/finance/clients' },
  { key: 'tpl', label: 'Templates Library', icon: FileText, path: '/finance/settings?tab=templates' },
];

export function QuickAddFab() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);


  return (
    <>
      <div data-fab="true" className="fab fixed bottom-6 right-4 sm:right-6 z-40 flex flex-col items-end gap-3 print:hidden">
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col items-end gap-2"
            >
              <button
                onClick={() => { setSnoozeOpen(true); setOpen(false); }}
                className="flex items-center gap-2 bg-card border border-border rounded-full pl-3 pr-4 py-2 shadow-lg hover:bg-accent transition-colors"
              >
                <AlarmClock className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Smart Snooze</span>
              </button>
              <button
                onClick={() => { setVoiceOpen(true); setOpen(false); }}
                className="flex items-center gap-2 bg-card border border-border rounded-full pl-3 pr-4 py-2 shadow-lg hover:bg-accent transition-colors"
              >
                <Mic className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Voice Memo</span>
              </button>
              {ACTIONS.map(a => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.key}
                    onClick={() => { navigate(a.path); setOpen(false); }}
                    className="flex items-center gap-2 bg-card border border-border rounded-full pl-3 pr-4 py-2 shadow-lg hover:bg-accent transition-colors"
                  >
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{a.label}</span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        <Button
          size="lg"
          onClick={() => setOpen(o => !o)}
          className={cn(
            'h-14 w-14 rounded-full shadow-xl transition-transform',
            open && 'rotate-45',
          )}
          aria-label="Quick add"
        >
          {open ? <X className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
        </Button>
      </div>

      <SmartSnoozeDialog open={snoozeOpen} onOpenChange={setSnoozeOpen} />
      <VoiceMemoDialog open={voiceOpen} onOpenChange={setVoiceOpen} />
    </>
  );
}
