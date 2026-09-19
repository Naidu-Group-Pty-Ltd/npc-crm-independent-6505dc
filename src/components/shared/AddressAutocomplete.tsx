import { useState, useCallback, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Loader2, MapPin, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


interface Prediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Show the MapPin icon on the left */
  showIcon?: boolean;
}

export function AddressAutocomplete({
  value,
  onChange,
  placeholder = 'Start typing an address...',
  disabled = false,
  className,
  id,
  showIcon = true,
}: AddressAutocompleteProps) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showPredictions, setShowPredictions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  const handleChange = (newValue: string) => {
    onChange(newValue);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchPlaces(newValue), 300);
  };

  const selectPrediction = (prediction: Prediction) => {
    onChange(prediction.description);
    setPredictions([]);
    setShowPredictions(false);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        {showIcon && (
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        )}
        <Input
          id={id}
          placeholder={placeholder}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => predictions.length > 0 && setShowPredictions(true)}
          className={cn(showIcon && 'pl-9', 'pr-9', className)}
          disabled={disabled}
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
    </div>
  );
}
