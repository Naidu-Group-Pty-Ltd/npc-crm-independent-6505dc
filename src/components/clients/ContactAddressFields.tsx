import { memo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MapPin, IdCard } from 'lucide-react';

const livingSituationOptions = [
  { value: 'renting', label: 'Renting' },
  { value: 'living_with_parents', label: 'Living with Parents' },
  { value: 'home_with_mortgage', label: 'Home with Mortgage' },
  { value: 'home_owned_outright', label: 'Home Owned Outright' },
  { value: 'boarding', label: 'Boarding' },
  { value: 'other', label: 'Other' },
];

const residentialStatusOptions = [
  { value: 'citizen', label: 'Citizen' },
  { value: 'permanent_resident', label: 'Permanent Resident' },
  { value: 'temporary_visa', label: 'Temporary Visa' },
  { value: 'other', label: 'Other' },
];

export { livingSituationOptions, residentialStatusOptions };

export interface ContactAddressData {
  current_address: string;
  current_suburb?: string;
  current_state?: string;
  current_postcode?: string;
  country: string;
  living_situation: string;
  residential_status: string;
  same_address_as_primary: boolean;
}

interface ContactAddressFieldsProps {
  data: ContactAddressData;
  onChange: (field: keyof ContactAddressData, value: string | boolean) => void;
  /** Primary contact's address to copy when toggle is on */
  primaryAddress?: {
    current_address: string;
    current_suburb?: string;
    current_state?: string;
    current_postcode?: string;
    country: string;
    living_situation: string;
    residential_status: string;
  };
  /** Hide the "Same as primary" toggle (for primary contact itself) */
  hideSameAsPrimary?: boolean;
  contactLabel?: string;
}

export const ContactAddressFields = memo(function ContactAddressFields({
  data,
  onChange,
  primaryAddress,
  hideSameAsPrimary = false,
  contactLabel,
}: ContactAddressFieldsProps) {
  const handleToggleSame = useCallback((checked: boolean) => {
    onChange('same_address_as_primary', checked);
    if (checked && primaryAddress) {
      onChange('current_address', primaryAddress.current_address);
      onChange('current_suburb', primaryAddress.current_suburb || '');
      onChange('current_state', primaryAddress.current_state || '');
      onChange('current_postcode', primaryAddress.current_postcode || '');
      onChange('country', primaryAddress.country);
      onChange('living_situation', primaryAddress.living_situation);
      onChange('residential_status', primaryAddress.residential_status);
    }
  }, [onChange, primaryAddress]);

  const isDisabled = data.same_address_as_primary;

  return (
    <div className="space-y-4">
      {/* Same as primary toggle */}
      {!hideSameAsPrimary && (
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label className="text-sm font-medium">Same address as Primary Contact</Label>
            <p className="text-xs text-muted-foreground">Copy address & ID details from primary</p>
          </div>
          <Switch
            checked={data.same_address_as_primary}
            onCheckedChange={handleToggleSame}
          />
        </div>
      )}

      {/* Address Card */}
      <Card className={isDisabled ? 'opacity-60' : ''}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            {contactLabel ? `Address — ${contactLabel}` : 'Address'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Street Address</Label>
            <Input
              value={data.current_address}
              onChange={(e) => onChange('current_address', e.target.value)}
              placeholder="123 Main Street"
              disabled={isDisabled}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label className="text-xs">Suburb</Label>
              <Input
                value={data.current_suburb || ''}
                onChange={(e) => onChange('current_suburb', e.target.value)}
                placeholder="Sydney"
                disabled={isDisabled}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">State</Label>
              <Input
                value={data.current_state || ''}
                onChange={(e) => onChange('current_state', e.target.value.toUpperCase())}
                placeholder="NSW"
                disabled={isDisabled}
                maxLength={3}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Postcode</Label>
              <Input
                value={data.current_postcode || ''}
                onChange={(e) => onChange('current_postcode', e.target.value)}
                placeholder="2000"
                disabled={isDisabled}
                maxLength={4}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs">Country</Label>
              <Input
                value={data.country}
                onChange={(e) => onChange('country', e.target.value)}
                placeholder="Australia"
                disabled={isDisabled}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Living Situation</Label>
              <Select
                value={data.living_situation}
                onValueChange={(v) => onChange('living_situation', v)}
                disabled={isDisabled}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select situation" />
                </SelectTrigger>
                <SelectContent>
                  {livingSituationOptions.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {/*
            Where "since when" is recorded.

            This card holds the address the client is at NOW, and has no date
            on it — the 19 Sep 2026 clone audit asked for one here. It is not
            added here, because Address History on this same tab already
            records a start and end date per address, and that is the record a
            lender's serviceability questions are answered from. A second place
            to type the same fact is how two places come to disagree; what was
            missing is that nothing said where the first one was.
          */}
          <p className="text-[11px] leading-4 text-muted-foreground">
            Recording when they moved in, or a previous address? Use{' '}
            <span className="font-medium text-foreground">Address History</span> further down this
            tab — it keeps a start and end date for each address.
          </p>
        </CardContent>
      </Card>

      {/* ID Card */}
      <Card className={isDisabled ? 'opacity-60' : ''}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <IdCard className="h-4 w-4" />
            {contactLabel ? `ID — ${contactLabel}` : 'ID'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label className="text-xs">Residential Status</Label>
            <Select
              value={data.residential_status}
              onValueChange={(v) => onChange('residential_status', v)}
              disabled={isDisabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {residentialStatusOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});
