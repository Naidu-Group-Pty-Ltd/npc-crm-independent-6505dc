import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, MapPin, Edit, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { usePortalUpdateData } from '@/hooks/usePortalData';
import { ThreeYearCoverageWarning } from '@/components/clients/ThreeYearCoverageWarning';
import { calculateCoverage } from '@/utils/threeYearCoverage';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { portalPanelClassName } from '@/components/portal/PortalSurface';

const livingSituationOptions = [
  { value: 'own_home', label: 'Own Home' },
  { value: 'renting', label: 'Renting' },
  { value: 'boarding', label: 'Boarding' },
  { value: 'living_with_family', label: 'Living with Family' },
  { value: 'company_housing', label: 'Company Housing' },
  { value: 'other', label: 'Other' },
];

const residentialStatusOptions = [
  { value: 'australian_citizen', label: 'Australian Citizen' },
  { value: 'permanent_resident', label: 'Permanent Resident' },
  { value: 'temporary_visa', label: 'Temporary Visa' },
  { value: 'other', label: 'Other' },
];

interface AddressFormData {
  address: string;
  current_suburb: string;
  current_state: string;
  current_postcode: string;
  country: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  living_situation: string;
  residential_status: string;
}

const defaultForm: AddressFormData = {
  address: '',
  current_suburb: '',
  current_state: '',
  current_postcode: '',
  country: 'Australia',
  start_date: '',
  end_date: '',
  is_current: true,
  living_situation: '',
  residential_status: '',
};

interface PortalAddressHistoryFormProps {
  existingAddresses: any[];
  onRefresh: () => void;
}

export function PortalAddressHistoryForm({ existingAddresses, onRefresh }: PortalAddressHistoryFormProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AddressFormData>({ ...defaultForm });
  const mutation = usePortalUpdateData();

  const updateField = useCallback((field: keyof AddressFormData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const resetForm = () => {
    setForm({ ...defaultForm });
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (addr: any) => {
    setForm({
      address: addr.address || '',
      current_suburb: addr.current_suburb || '',
      current_state: addr.current_state || '',
      current_postcode: addr.current_postcode || '',
      country: addr.country || 'Australia',
      start_date: addr.start_date || '',
      end_date: addr.end_date || '',
      is_current: addr.is_current ?? false,
      living_situation: addr.living_situation || '',
      residential_status: addr.residential_status || '',
    });
    setEditingId(addr.id);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.address.trim()) { toast.error('Address is required'); return; }
    if (!form.start_date) { toast.error('Start date is required'); return; }
    if (form.current_postcode.trim() && !/^\d{4}$/.test(form.current_postcode.trim())) { toast.error('Postcode must be 4 digits'); return; }
    if (form.current_state.trim() && !/^[A-Za-z]{2,3}$/.test(form.current_state.trim())) { toast.error('State must be a 2–3 letter code'); return; }

    const payload: Record<string, any> = {
      contact_type: 'primary',
      address: form.address.trim(),
      current_suburb: form.current_suburb.trim() || null,
      current_state: form.current_state.trim().toUpperCase() || null,
      current_postcode: form.current_postcode.trim() || null,
      country: form.country.trim() || 'Australia',
      start_date: form.start_date,
      end_date: form.is_current ? null : (form.end_date || null),
      is_current: form.is_current,
      living_situation: form.living_situation || null,
      residential_status: form.residential_status || null,
    };

    try {
      await mutation.mutateAsync({
        operation: editingId ? 'update' : 'insert',
        table: 'client_address_history',
        id: editingId || undefined,
        data: payload,
      });
      toast.success(editingId ? 'Address updated' : 'Address added');
      resetForm();
      onRefresh();
    } catch (err: any) {
      toast.error('Failed to save: ' + (err.message || 'Unknown error'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await mutation.mutateAsync({ operation: 'delete', table: 'client_address_history', id });
      toast.success('Address deleted');
      if (editingId === id) resetForm();
      onRefresh();
    } catch (err: any) {
      toast.error('Failed to delete: ' + (err.message || 'Unknown error'));
    }
  };

  const addressCoverage = useMemo(() => calculateCoverage(existingAddresses), [existingAddresses]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <MapPin className="h-4 w-4" /> Address History
        </h3>
      </div>

      <ThreeYearCoverageWarning coverage={addressCoverage} label="Address History" />

      {existingAddresses.length > 0 ? (
        <div className="space-y-2">
          {existingAddresses.map((addr: any) => (
            <Card key={addr.id} className={portalPanelClassName('group')}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium text-sm">{[addr.address, addr.current_suburb, addr.current_state, addr.current_postcode].filter(Boolean).join(', ') || 'Unknown Address'}</span>
                       {addr.is_current && <span className="rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[10px] text-success">Current</span>}
                       {!addr.is_current && <span className="rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-[10px] text-warning">Previous</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {addr.living_situation?.replace(/_/g, ' ') || 'Not specified'} • From: {addr.start_date || 'N/A'}
                      {addr.end_date && ` to ${addr.end_date}`}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(addr)}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(addr.id)} disabled={mutation.isPending}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <PortalEmptyState
          className="client-portal-soft-panel"
          icon={<MapPin className="h-8 w-8" />}
          title="No address records yet"
          description="Add your address history so your profile stays complete and ready for lender reviews."
        />
      )}

      {showForm ? (
        <Card className={portalPanelClassName('border-primary/20')}>
          <CardContent className="pt-4 space-y-4">
            <p className="text-sm font-medium">{editingId ? 'Edit Address' : 'Add Address'}</p>

            <div className="space-y-1.5">
              <Label className="text-xs">Address *</Label>
              <Input value={form.address} onChange={(e) => updateField('address', e.target.value)} placeholder="123 Main Street" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Suburb / City</Label>
                <Input value={form.current_suburb} onChange={(e) => updateField('current_suburb', e.target.value)} placeholder="Sydney" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">State</Label>
                <Input value={form.current_state} onChange={(e) => updateField('current_state', e.target.value.toUpperCase())} placeholder="NSW" maxLength={3} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Postcode</Label>
                <Input value={form.current_postcode} onChange={(e) => updateField('current_postcode', e.target.value)} placeholder="2000" maxLength={4} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Country</Label>
                <Input value={form.country} onChange={(e) => updateField('country', e.target.value)} placeholder="Australia" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Start Date *</Label>
                <Input type="date" value={form.start_date} onChange={(e) => updateField('start_date', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">End Date</Label>
                <Input type="date" value={form.end_date} onChange={(e) => updateField('end_date', e.target.value)} disabled={form.is_current} />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-sm">Current Address</Label>
              <Switch checked={form.is_current} onCheckedChange={(v) => updateField('is_current', v)} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Living Situation</Label>
              <Select value={form.living_situation} onValueChange={(v) => updateField('living_situation', v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {livingSituationOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Residential Status</Label>
              <Select value={form.residential_status} onValueChange={(v) => updateField('residential_status', v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {residentialStatusOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={resetForm} className="flex-1">Cancel</Button>
              <Button onClick={handleSubmit} disabled={mutation.isPending} className="flex-1">
                {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingId ? 'Update' : 'Add'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" size="sm" className="w-full" onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Address
        </Button>
      )}
    </div>
  );
}
