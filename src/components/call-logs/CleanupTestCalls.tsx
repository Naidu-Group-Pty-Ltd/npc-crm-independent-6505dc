import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useSecureCallLogs } from '@/hooks/useSecureCallLogs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Trash2, Loader2, Plus, X, Settings2, ShieldAlert, FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Test phone numbers, from the environment rather than from source.
 *
 * These were two real staff mobiles written into this file, which meant they
 * shipped inside the JavaScript bundle of every build — readable by anyone who
 * opened the app. Hiding the control does not unship the module it lives in, so
 * a client-facing deployment carried them too.
 *
 * Set VITE_TEST_CALL_NUMBERS as a comma-separated list on internal builds; the
 * default is empty, and an operator can still add numbers by hand in the
 * popover exactly as before.
 */
const DEFAULT_TEST_NUMBERS: string[] = (
  (import.meta as { env?: Record<string, string | undefined> })?.env?.VITE_TEST_CALL_NUMBERS ?? ''
)
  .split(',')
  .map((n) => n.trim())
  .filter(Boolean);


const utilityControl =
  'rounded-2xl border-border dark:border-white/10 bg-background dark:bg-black/45 text-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/25 transition-all placeholder:text-muted-foreground hover:border-brand-300/35 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black';
const utilityPopoverShell =
  'w-80 overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/98 via-card dark:via-background/95 to-background dark:to-black/95 p-0 text-foreground dark:text-foreground shadow-2xl shadow-sm dark:shadow-black/50';
const destructiveDialogShell =
  'overflow-hidden border border-destructive/20 bg-gradient-to-br from-card dark:from-background/98 via-card dark:via-background/95 to-background dark:to-black/95 p-0 text-foreground dark:text-foreground shadow-2xl shadow-destructive/30 sm:max-w-lg';

interface CleanupTestCallsProps {
  onComplete?: () => void;
  testNumbersButtonClassName?: string;
  flushButtonClassName?: string;
}

export const CleanupTestCalls = ({ onComplete, testNumbersButtonClassName, flushButtonClassName }: CleanupTestCallsProps) => {
  const { toast } = useToast();
  const { cleanupTestCalls } = useSecureCallLogs();
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [testNumbers, setTestNumbers] = useState<string[]>(DEFAULT_TEST_NUMBERS);
  const [newNumber, setNewNumber] = useState('');

  const handleAddNumber = () => {
    const trimmedNumber = newNumber.trim();
    if (!trimmedNumber) return;
    
    // Basic validation - should start with + and contain digits
    if (!/^\+?[\d\s-]+$/.test(trimmedNumber)) {
      toast({
        title: 'Invalid Number',
        description: 'Please enter a valid phone number',
        variant: 'destructive',
      });
      return;
    }

    // Normalize the number (remove spaces and dashes)
    const normalizedNumber = trimmedNumber.replace(/[\s-]/g, '');
    
    if (testNumbers.includes(normalizedNumber)) {
      toast({
        title: 'Duplicate Number',
        description: 'This number is already in the list',
        variant: 'destructive',
      });
      return;
    }

    setTestNumbers([...testNumbers, normalizedNumber]);
    setNewNumber('');
  };

  const handleRemoveNumber = (numberToRemove: string) => {
    setTestNumbers(testNumbers.filter(n => n !== numberToRemove));
  };

  const handleCleanup = async () => {
    if (testNumbers.length === 0) {
      toast({
        title: 'No Numbers Selected',
        description: 'Please add at least one test number to clean up',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const { deletedCount, error } = await cleanupTestCalls(testNumbers);

      if (error) {
        throw new Error(error.message || 'Failed to cleanup test calls');
      }

      toast({
        title: 'Test Calls Cleaned Up',
        description: `Successfully removed ${deletedCount} test call${deletedCount !== 1 ? 's' : ''} from the system.`,
      });

      setIsOpen(false);
      onComplete?.();
    } catch (error) {
      console.error('Error cleaning up test calls:', error);
      toast({
        title: 'Cleanup Failed',
        description: error instanceof Error ? error.message : 'Failed to cleanup test calls',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Manage Numbers Popover */}
      <Popover open={isManageOpen} onOpenChange={setIsManageOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={`gap-2 ${testNumbersButtonClassName || ''}`}>
            <Settings2 className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Test Numbers ({testNumbers.length})</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className={utilityPopoverShell} align="end">
          <div className="border-b border-border dark:border-white/10 bg-gradient-to-r from-info/10 via-transparent to-brand-500/10 px-4 py-3">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-info/20 bg-info/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-info">
              <FlaskConical className="h-3 w-3" />
              Controlled Testing
            </div>
            <h4 className="text-sm font-semibold text-foreground dark:text-foreground">Test Phone Numbers</h4>
            <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">Calls from these numbers will be removed when flushing test calls.</p>
          </div>
          <div className="space-y-4 p-4">
            {/* Add new number */}
            <div className="flex gap-2">
              <Input
                placeholder="+61400000000"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddNumber()}
                className={cn("flex-1", utilityControl)}
              />
              <Button size="sm" onClick={handleAddNumber} disabled={!newNumber.trim()} className="rounded-2xl bg-info/15 text-info hover:bg-info/25">
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {/* Number list */}
            <div className="max-h-48 space-y-2 overflow-y-auto pr-1 scrollbar-thin scrollbar-track-black/20 scrollbar-thumb-amber-300/30">
              {testNumbers.length === 0 ? (
                <p className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] py-3 text-center text-sm text-muted-foreground dark:text-muted-foreground">
                  No test numbers configured
                </p>
              ) : (
                testNumbers.map((number) => (
                  <div
                    key={number}
                    className="flex items-center justify-between rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] px-3 py-2 transition-colors hover:border-info/25 hover:bg-info/10"
                  >
                    <span className="font-mono text-sm text-foreground dark:text-foreground">{number}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 rounded-xl p-0 text-muted-foreground dark:text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleRemoveNumber(number)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Reset to defaults */}
            {JSON.stringify(testNumbers.sort()) !== JSON.stringify(DEFAULT_TEST_NUMBERS.sort()) && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full rounded-2xl text-xs text-muted-foreground dark:text-muted-foreground hover:bg-brand-300/10 hover:text-brand-100"
                onClick={() => setTestNumbers(DEFAULT_TEST_NUMBERS)}
              >
                Reset to defaults
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Flush Button with Confirmation */}
      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className={`gap-2 text-destructive hover:text-destructive ${flushButtonClassName || ''}`}
            disabled={testNumbers.length === 0}
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Flush Test Calls</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className={destructiveDialogShell}>
          <div className="border-b border-destructive/20 bg-gradient-to-r from-destructive/15 via-background dark:via-black/40 to-brand-500/10 px-6 py-5">
            <AlertDialogHeader>
              <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-destructive/25 bg-destructive/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-destructive">
                <ShieldAlert className="h-3 w-3" />
                Destructive Action
              </div>
              <AlertDialogTitle className="flex items-center gap-3 text-2xl text-foreground dark:text-foreground">Flush Test Calls</AlertDialogTitle>
              <AlertDialogDescription className="space-y-3 text-muted-foreground dark:text-muted-foreground">
              <p>
                This will permanently delete all call logs from the following test phone numbers:
              </p>
              <ul className="max-h-32 space-y-1 overflow-y-auto rounded-2xl border border-border dark:border-white/10 bg-background dark:bg-black/30 p-3 font-mono text-sm text-foreground dark:text-foreground">
                {testNumbers.map((number) => (
                  <li key={number}>{number}</li>
                ))}
              </ul>
              <p className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 font-semibold text-destructive">
                This action cannot be undone.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          </div>
          <div className="px-6 py-5">
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading} className="rounded-2xl border-border dark:border-white/10 bg-white/[0.03] text-muted-foreground dark:text-foreground hover:bg-white/10 hover:text-foreground">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCleanup}
              disabled={isLoading}
              className="rounded-2xl bg-gradient-to-r from-destructive to-destructive text-foreground dark:text-white shadow-lg shadow-destructive/30 hover:from-destructive hover:to-destructive"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cleaning...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Flush Test Calls
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
