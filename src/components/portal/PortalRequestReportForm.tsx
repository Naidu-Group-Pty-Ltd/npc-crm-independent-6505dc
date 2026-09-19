import { useState, useCallback, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  BarChart3, PiggyBank, Building2, Send, X, Loader2, CheckCircle2, MapPin, Search as SearchIcon
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { PortalPanel, PortalPanelContent, PortalPanelHeader, PortalPanelTitle } from '@/components/portal/PortalSurface';
import { portalSessionBodyFields, portalSessionHeaders } from '@/lib/portalSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';
import { PORTFOLIO_REPORT_LABEL } from '@/lib/reports/portfolio/label';


interface Prediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

interface Property {
  id: string;
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  property_type?: string;
}

interface Props {
  properties: Property[];
  onSubmitted: () => void;
  onCancel: () => void;
}

const reportTypes = [
  {
    value: 'portfolio_review',
    label: PORTFOLIO_REPORT_LABEL,
    description: 'A comprehensive analysis of your entire investment portfolio performance, equity growth, and projections.',
    icon: BarChart3,
    color: 'border-success/20 bg-success/10 hover:bg-success/15',
    activeColor: 'border-success bg-success/15 ring-2 ring-success/20',
    iconColor: 'text-success',
  },
  {
    value: 'borrowing_capacity',
    label: 'Borrowing Capacity Snapshot',
    description: 'An updated assessment of your current borrowing power based on income, expenses, and existing commitments.',
    icon: PiggyBank,
    color: 'border-warning/20 bg-warning/10 hover:bg-warning/15',
    activeColor: 'border-warning bg-warning/15 ring-2 ring-warning/20',
    iconColor: 'text-warning',
  },
  {
    value: 'investment_property',
    label: 'Investment Property Report',
    description: 'Detailed investment analysis for a specific property — from your portfolio or a new property you\'re considering.',
    icon: Building2,
    color: 'border-primary/20 bg-primary/10 hover:bg-primary/15',
    activeColor: 'border-primary bg-primary/15 ring-2 ring-primary/20',
    iconColor: 'text-primary',
  },
];

export function PortalRequestReportForm({ properties, onSubmitted, onCancel }: Props) {
  const [requestType, setRequestType] = useState<string>('');
  const [propertySource, setPropertySource] = useState<'portfolio' | 'external'>('portfolio');
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [externalAddress, setExternalAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedSummary, setSubmittedSummary] = useState<{ type: string; property?: string; notes?: string } | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showPredictions, setShowPredictions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close predictions on outside click
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
    if (input.length < 3) { setPredictions([]); return; }
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

  const handleAddressChange = (newValue: string) => {
    setExternalAddress(newValue);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchPlaces(newValue), 300);
  };

  const selectPrediction = (prediction: Prediction) => {
    setExternalAddress(prediction.description);
    setPredictions([]);
    setShowPredictions(false);
  };

  const formatPropertyAddress = (p: Property) => {
    return [p.address, p.suburb, p.state, p.postcode].filter(Boolean).join(', ');
  };

  const handleSubmit = async () => {
    if (!requestType) {
      toast.error('Please select a report type');
      return;
    }

    if (requestType === 'investment_property') {
      if (propertySource === 'portfolio' && !selectedPropertyId) {
        toast.error('Please select a property from your portfolio');
        return;
      }
      if (propertySource === 'external' && !externalAddress.trim()) {
        toast.error('Please enter the property address');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload: Record<string, any> = {
        operation: 'insert',
        table: 'client_portal_report_requests',
        data: {
          request_type: requestType,
          notes: notes.trim() || null,
        },
        ...portalSessionBodyFields(),
      };

      if (requestType === 'investment_property') {
        if (propertySource === 'portfolio' && selectedPropertyId) {
          payload.data.client_property_id = selectedPropertyId;
          const prop = properties.find(p => p.id === selectedPropertyId);
          if (prop) payload.data.property_address = formatPropertyAddress(prop);
        } else if (propertySource === 'external') {
          payload.data.property_address = externalAddress.trim();
        }
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/manage-portal-client-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          ...portalSessionHeaders(),
        },
        // Attach the HttpOnly session cookie; see src/lib/portalSession.ts.
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to submit request');
      }

      // Save summary for confirmation screen
      const typeLabel = reportTypes.find(t => t.value === requestType)?.label || requestType;
      let propertyLabel: string | undefined;
      if (requestType === 'investment_property') {
        if (propertySource === 'portfolio' && selectedPropertyId) {
          const prop = properties.find(p => p.id === selectedPropertyId);
          if (prop) propertyLabel = formatPropertyAddress(prop);
        } else if (propertySource === 'external') {
          propertyLabel = externalAddress.trim();
        }
      }
      setSubmittedSummary({
        type: typeLabel,
        property: propertyLabel,
        notes: notes.trim() || undefined,
      });

      setSubmitted(true);
      toast.success('Report request submitted successfully!');
      setTimeout(() => onSubmitted(), 2500);
    } catch (err: any) {
      toast.error('Failed to submit: ' + (err.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted && submittedSummary) {
    return (
      <PortalPanel className="border-success/20 bg-success/10">
        <PortalPanelContent className="py-8 text-center space-y-3">
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
          <div>
            <p className="text-sm font-semibold text-foreground">Request submitted</p>
            <p className="mt-1 text-xs text-muted-foreground">Your advisor will review this and prepare the report for you.</p>
          </div>
          <div className="mx-auto max-w-xs rounded-lg border bg-background p-3 text-left space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Report:</span>
              <span className="font-medium text-foreground">{submittedSummary.type}</span>
            </div>
            {submittedSummary.property && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground shrink-0">Property:</span>
                <span className="font-medium text-foreground">{submittedSummary.property}</span>
              </div>
            )}
            {submittedSummary.notes && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground shrink-0">Notes:</span>
                <span className="text-foreground line-clamp-2">{submittedSummary.notes}</span>
              </div>
            )}
          </div>
        </PortalPanelContent>
      </PortalPanel>
    );
  }

  return (
    <PortalPanel>
      <PortalPanelHeader className="pb-4">
        <div className="flex items-center justify-between">
          <PortalPanelTitle className="text-base">
            <Send className="h-4 w-4 text-primary" />
            Request a Report
          </PortalPanelTitle>
          <Button variant="ghost" size="icon" onClick={onCancel} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </PortalPanelHeader>
      <PortalPanelContent className="space-y-5">
        {/* Report Type Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">What type of report do you need?</Label>
          <div className="grid gap-3">
            {reportTypes.map((type) => {
              const Icon = type.icon;
              const isSelected = requestType === type.value;
              return (
                <button
                  key={type.value}
                  onClick={() => setRequestType(type.value)}
                  className={cn(
                    'flex items-start gap-3 p-4 rounded-xl border text-left transition-all duration-200',
                    isSelected ? type.activeColor : type.color
                  )}
                >
                  <div className={cn('p-2 rounded-lg shrink-0', isSelected ? 'bg-background' : 'bg-background/80')}>
                    <Icon className={cn('h-5 w-5', type.iconColor)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{type.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{type.description}</p>
                  </div>
                  {isSelected && (
                    <CheckCircle2 className={cn('h-5 w-5 shrink-0 mt-0.5', type.iconColor)} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Property Selection (for investment_property type) */}
        {requestType === 'investment_property' && (
          <div className="space-y-3 animate-in slide-in-from-top-2 duration-200">
            <Label className="text-sm font-medium">Which property?</Label>
            <div className="flex gap-2">
              <Button
                variant={propertySource === 'portfolio' ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setPropertySource('portfolio'); setExternalAddress(''); }}
                className="text-xs"
              >
                <Building2 className="h-3.5 w-3.5 mr-1.5" />
                From Portfolio
              </Button>
              <Button
                variant={propertySource === 'external' ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setPropertySource('external'); setSelectedPropertyId(''); }}
                className="text-xs"
              >
                <MapPin className="h-3.5 w-3.5 mr-1.5" />
                New / External Property
              </Button>
            </div>

            {propertySource === 'portfolio' ? (
              properties.length > 0 ? (
                <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a property..." />
                  </SelectTrigger>
                  <SelectContent>
                    {properties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {formatPropertyAddress(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
                  No properties in your portfolio. Use "New / External Property" to enter an address.
                </p>
              )
            ) : (
              <div className="space-y-1 relative" ref={wrapperRef}>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Start typing a property address..."
                    value={externalAddress}
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
                        type="button"
                        onClick={() => selectPrediction(p)}
                        className="w-full text-left px-4 py-3 hover:bg-accent transition-colors flex items-start gap-3 border-b border-border/50 last:border-0"
                      >
                        <SearchIcon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{p.mainText}</p>
                          <p className="text-xs text-muted-foreground truncate">{p.secondaryText}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">Search and select a validated address with suburb, state and postcode</p>
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Additional Notes (optional)</Label>
          <Textarea
            placeholder="Any specific details or areas of focus you'd like included..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !requestType}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-1.5" />
                Submit Request
              </>
            )}
          </Button>
        </div>
      </PortalPanelContent>
    </PortalPanel>
  );
}
