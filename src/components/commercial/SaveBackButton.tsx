/**
 * Reusable "Save back to property" button for calculator cards. Disabled
 * unless a property is linked via CalculatorPrefillContext.
 */
import { useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCalculatorPrefill } from '@/contexts/CalculatorPrefillContext';

interface Props {
  /** Builder that returns the patch to persist (raw column names of the underlying property table). */
  build: () => Record<string, unknown>;
  label?: string;
  size?: 'sm' | 'default';
  variant?: 'default' | 'outline' | 'secondary';
}

export function SaveBackButton({ build, label = 'Save back to property', size = 'sm', variant = 'outline' }: Props) {
  const { prefill, pushBack } = useCalculatorPrefill();
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setBusy(true);
    try {
      const patch = build();
      // Strip undefined / empty
      const clean = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      await pushBack(clean);
    } finally { setBusy(false); }
  };

  return (
    <Button size={size} variant={variant} onClick={handle} disabled={!prefill || busy}>
      {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
      {label}
    </Button>
  );
}
