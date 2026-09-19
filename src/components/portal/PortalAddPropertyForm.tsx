import { useState, useCallback, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, X, MapPin, CheckCircle2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { usePortalUpdateData } from '@/hooks/usePortalData';
import { formatNumberWithCommas, removeCommas } from '@/hooks/useFormattedNumber';
import { PortalPanel, PortalPanelContent, PortalPanelHeader, PortalPanelTitle } from '@/components/portal/PortalSurface';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


interface Prediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

interface Props {
  onSubmitted: () => void;
  onCancel: () => void;
}

export function PortalAddPropertyForm({ onSubmitted, onCancel }: Props) {
  const [address, setAddress] = useState('');
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showPredictions, setShowPredictions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [purchasePrice, setPurchasePrice] = useState('');
  const [loanRemaining, setLoanRemaining] = useState('');
  const [weeklyRent, setWeeklyRent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const mutation = usePortalUpdateData();

  // Close predictions dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowPredictions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchPlaces = useCallback(async (input: string) => {
    if (input.length < 3) {
      setPredictions([]);
      return;
    }
    setSearchLoading(true);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/google-places-autocomplete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        credentials: 'omit',
        body: JSON.stringify({ input }),
      });
      const data = await response.json();
      if (data.success) {
        setPredictions(data.predictions || []);
        setShowPredictions(true);
      }
    } catch (err) {
      console.error('Places search error:', err);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleAddressChange = (value: string) => {
    setAddress(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchPlaces(value), 300);
  };

  const selectPrediction = (prediction: Prediction) => {
    setAddress(prediction.description);
    setPredictions([]);
    setShowPredictions(false);
  };

  const handleCurrencyChange = (
    setter: (v: string) => void,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const raw = removeCommas(e.target.value);
    if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
      setter(raw);
    }
  };

  const handleSubmit = async () => {
    if (!address.trim()) {
      toast.error('Please enter a property address');
      return;
    }

    setSubmitting(true);
    try {
      await mutation.mutateAsync({
        operation: 'insert',
        table: 'client_properties',
        data: {
          address: address.trim(),
          purchase_price: purchasePrice ? Number(purchasePrice) : null,
          loan_remaining: loanRemaining ? Number(loanRemaining) : null,
          weekly_rental_income: weeklyRent ? Number(weeklyRent) : null,
        },
      });

      setSubmitted(true);
      toast.success('Property added successfully!');
      setTimeout(() => onSubmitted(), 1500);
    } catch (err: any) {
      toast.error('Failed to add property: ' + (err.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <PortalEmptyState
        className="client-portal-soft-panel"
        icon={<CheckCircle2 className="h-8 w-8" />}
        title="Property added"
        description="Your property has been added to your portfolio and will appear in your list shortly."
      />
    );
  }

  return (
    <PortalPanel>
      <PortalPanelHeader className="pb-4">
        <div className="flex items-center justify-between">
          <PortalPanelTitle className="text-base">
            <Plus className="h-4 w-4 text-primary" />
            Add Property
          </PortalPanelTitle>
          <Button variant="ghost" size="icon" onClick={onCancel} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </PortalPanelHeader>
      <PortalPanelContent className="space-y-5">
        {/* Address with Google Places Autocomplete */}
        <div className="relative" ref={wrapperRef}>
          <Label className="text-sm font-medium">Property Address *</Label>
          <div className="relative mt-1.5">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Start typing an address..."
              value={address}
              onChange={(e) => handleAddressChange(e.target.value)}
              onFocus={() => predictions.length > 0 && setShowPredictions(true)}
              className="pl-9 pr-9"
            />
            {searchLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          {showPredictions && predictions.length > 0 && (
            <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
              {predictions.map((p) => (
                <button
                  key={p.placeId}
                  onClick={() => selectPrediction(p)}
                  className="w-full text-left px-4 py-3 hover:bg-accent transition-colors flex items-start gap-3 border-b border-border/50 last:border-0"
                >
                  <Search className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{p.mainText}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.secondaryText}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">
            Powered by Google — select a suggestion for the most accurate address
          </p>
        </div>

        {/* Financial Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Purchase Price</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input
                placeholder="0"
                value={formatNumberWithCommas(purchasePrice)}
                onChange={(e) => handleCurrencyChange(setPurchasePrice, e)}
                className="pl-7"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Loan Remaining</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input
                placeholder="0"
                value={formatNumberWithCommas(loanRemaining)}
                onChange={(e) => handleCurrencyChange(setLoanRemaining, e)}
                className="pl-7"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Weekly Rent</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input
                placeholder="0"
                value={formatNumberWithCommas(weeklyRent)}
                onChange={(e) => handleCurrencyChange(setWeeklyRent, e)}
                className="pl-7"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !address.trim()}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-1.5" />
                Add Property
              </>
            )}
          </Button>
        </div>
      </PortalPanelContent>
    </PortalPanel>
  );
}
