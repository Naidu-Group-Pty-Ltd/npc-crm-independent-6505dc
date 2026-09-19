import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MapPin, Plus, Edit, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { ContactInfo, getContactTabLabel } from './hooks/useClientContacts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ThreeYearCoverageWarning } from './ThreeYearCoverageWarning';
import { calculateCoverage } from '@/utils/threeYearCoverage';
import { livingSituationOptions, residentialStatusOptions } from './ContactAddressFields';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';

interface AddressFormData {
  contact_type: string;
  additional_contact_id: string | null;
  address: string;
  current_suburb: string;
  current_state: string;
  current_postcode: string;
  country: string;
  living_situation: string;
  residential_status: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  notes: string;
}

const defaultForm: AddressFormData = {
  contact_type: 'primary',
  additional_contact_id: null,
  address: '',
  current_suburb: '',
  current_state: '',
  current_postcode: '',
  country: 'Australia',
  living_situation: '',
  residential_status: '',
  start_date: '',
  end_date: '',
  is_current: false,
  notes: '',
};

async function fetchAddressHistory(clientId: string) {
  const { data, error } = await invokeSecureFunction('get-client-data', {
    clientId,
    include: { addressHistory: true },
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error('Failed to fetch address history');
  return data.addressHistory || [];
}

interface AddressHistoryManualEntryProps {
  clientId: string;
  contacts: ContactInfo[];
  onComplete: () => void;
}

export function AddressHistoryManualEntry({ clientId, contacts, onComplete }: AddressHistoryManualEntryProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('primary');
  const [form, setForm] = useState<AddressFormData>({ ...defaultForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: addressHistory = [] } = useQuery({
    queryKey: ['client-address-history', clientId],
    queryFn: () => fetchAddressHistory(clientId),
  });

  const updateField = useCallback((field: keyof AddressFormData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const resetForm = useCallback(() => {
    const activeContact = contacts.find(c => c.id === activeTab);
    setForm({
      ...defaultForm,
      contact_type: activeContact?.contactType === 'additional' ? 'additional' : (activeContact?.contactType || 'primary'),
      additional_contact_id: activeContact?.additionalContactId || null,
    });
    setEditingId(null);
  }, [activeTab, contacts]);

  const getAddressesForContact = useCallback((contact: ContactInfo) => {
    return addressHistory.filter((a: any) => {
      if (contact.contactType === 'primary') return a.contact_type === 'primary' && !a.additional_contact_id;
      if (contact.contactType === 'secondary') return a.contact_type === 'secondary' && !a.additional_contact_id;
      return a.additional_contact_id === contact.additionalContactId;
    });
  }, [addressHistory]);

  const startEdit = (record: any) => {
    setForm({
      contact_type: record.contact_type || 'primary',
      additional_contact_id: record.additional_contact_id || null,
      address: record.address || '',
      current_suburb: record.current_suburb || '',
      current_state: record.current_state || '',
      current_postcode: record.current_postcode || '',
      country: record.country || 'Australia',
      living_situation: record.living_situation || '',
      residential_status: record.residential_status || '',
      start_date: record.start_date || '',
      end_date: record.end_date || '',
      is_current: record.is_current ?? false,
      notes: record.notes || '',
    });
    setEditingId(record.id);
    if (record.additional_contact_id) {
      setActiveTab(record.additional_contact_id);
    } else {
      setActiveTab(record.contact_type);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const activeContact = contacts.find(c => c.id === activeTab);
      const payload = {
        contact_type: activeContact?.contactType === 'additional' ? 'additional' : (activeContact?.contactType || 'primary'),
        additional_contact_id: activeContact?.additionalContactId || null,
        address: form.address.trim(),
        current_suburb: form.current_suburb.trim() || null,
        current_state: form.current_state.trim().toUpperCase() || null,
        current_postcode: form.current_postcode.trim() || null,
        country: form.country,
        living_situation: form.living_situation,
        residential_status: form.residential_status,
        start_date: form.start_date || null,
        end_date: form.is_current ? null : (form.end_date || null),
        is_current: form.is_current,
        notes: form.notes || null,
      };

      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: editingId ? 'update' : 'create',
        table: 'client_address_history',
        clientId,
        recordId: editingId || undefined,
        data: payload,
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to save address');
      return data.result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-address-history', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client-details', clientId] });
      queryClient.invalidateQueries({ queryKey: ['secure-client-data', clientId] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      onComplete();
      toast.success(editingId ? 'Address updated' : 'Address added');
      resetForm();
    },
    onError: (error: any) => toast.error('Failed to save: ' + error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_address_history',
        clientId,
        recordId: id,
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to delete');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-address-history', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client-details', clientId] });
      queryClient.invalidateQueries({ queryKey: ['secure-client-data', clientId] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      onComplete();
      toast.success('Address deleted');
      if (editingId) resetForm();
    },
    onError: (error: any) => toast.error('Failed to delete: ' + error.message),
  });

  // Coverage for the active contact
  const activeCoverage = useMemo(() => {
    const activeContact = contacts.find(c => c.id === activeTab);
    if (!activeContact) return calculateCoverage([]);
    return calculateCoverage(getAddressesForContact(activeContact));
  }, [activeTab, contacts, getAddressesForContact]);

  const activeContact = contacts.find(contact => contact.id === activeTab) || contacts[0];
  const activeAddresses = activeContact ? getAddressesForContact(activeContact) : [];

  return (
    <section className="space-y-4" aria-labelledby="address-residency-heading">
      <div className="space-y-1">
        <h3 id="address-residency-heading" className="text-lg font-semibold flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Address & Residency
        </h3>
        <p className="text-sm text-muted-foreground">
          Manage current and previous residential addresses for each applicant and maintain the address history required for lending and compliance.
        </p>
      </div>

      {contacts.length > 1 && (
        <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value); resetForm(); }}>
          <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${contacts.length}, minmax(0, 1fr))` }} aria-label="Select applicant address history">
            {contacts.map(contact => <TabsTrigger key={contact.id} value={contact.id}>{getContactTabLabel(contact)}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      )}

      <ThreeYearCoverageWarning coverage={activeCoverage} label={`${activeContact?.name || 'Applicant'} Address History`} />

      {activeAddresses.length > 0 ? (
        <div className="space-y-2">
          {activeAddresses.map((addr: any) => (
            <Card key={addr.id} className="group">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium text-sm">{[addr.address, addr.current_suburb, addr.current_state, addr.current_postcode].filter(Boolean).join(', ') || 'No address'}</span>
                      {addr.is_current && <span className="text-[10px] bg-success/15 text-success dark:bg-success/30 dark:text-success px-2 py-0.5 rounded">Current</span>}
                      <span className="text-xs text-muted-foreground">({getContactTabLabel(activeContact!)})</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[addr.living_situation?.replace(/_/g, ' '), addr.residential_status?.replace(/_/g, ' ')].filter(Boolean).join(' • ')}
                      {(addr.living_situation || addr.residential_status) && ' • '}
                      {addr.start_date || 'Start date required'}{addr.end_date ? ` → ${addr.end_date}` : ' → Present'}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit address" onClick={() => { startEdit(addr); setOpen(true); }}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Delete address" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(addr.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-6 text-center space-y-2">
            <p className="font-medium">No address history recorded</p>
            <p className="text-sm text-muted-foreground">Add the applicant’s current and previous residential addresses to complete their lending history.</p>
          </CardContent>
        </Card>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Add Address
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Address History
            </SheetTitle>
            <SheetDescription>
              Lenders require at least 3 years of address history per applicant
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-180px)] pr-4 mt-4">
            <Tabs value={activeTab} onValueChange={(v) => {
              setActiveTab(v);
              const contact = contacts.find(c => c.id === v);
              setForm(prev => ({
                ...prev,
                contact_type: contact?.contactType === 'additional' ? 'additional' : (contact?.contactType || 'primary'),
                additional_contact_id: contact?.additionalContactId || null,
              }));
              setEditingId(null);
            }}>
              <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${contacts.length}, 1fr)` }}>
                {contacts.map(c => (
                  <TabsTrigger key={c.id} value={c.id} className="text-xs">
                    {getContactTabLabel(c)}
                  </TabsTrigger>
                ))}
              </TabsList>

              {contacts.map(contact => {
                const contactAddresses = getAddressesForContact(contact);
                const contactCoverage = calculateCoverage(contactAddresses);
                return (
                  <TabsContent key={contact.id} value={contact.id} className="space-y-4 mt-4">
                    <ThreeYearCoverageWarning coverage={contactCoverage} label={`${contact.name} Address`} />

                    {contactAddresses.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Existing Addresses — {contact.name}</Label>
                        {contactAddresses.map((addr: any) => (
                          <Card key={addr.id} className="mb-2">
                            <CardContent className="pt-3 pb-3">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-sm font-medium">{[addr.address, addr.current_suburb, addr.current_state, addr.current_postcode].filter(Boolean).join(', ') || 'No address'}</span>
                                    {addr.is_current && <span className="text-[10px] bg-success/15 text-success dark:bg-success/30 dark:text-success px-1.5 py-0.5 rounded">Current</span>}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {addr.start_date || '?'}{addr.end_date ? ` → ${addr.end_date}` : ' → Present'}
                                  </p>
                                </div>
                                <div className="flex gap-1">
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(addr)}>
                                    <Edit className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(addr.id)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}

                    {/* Add/Edit Form */}
                    <Card className="border-primary/20">
                      <CardContent className="pt-4 space-y-4">
                        <p className="text-sm font-medium">{editingId ? 'Edit Address' : 'Add Address'}</p>

                        <div className="flex items-center justify-between">
                          <Label className="text-sm">Current Address</Label>
                          <Switch checked={form.is_current} onCheckedChange={(v) => updateField('is_current', v)} />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Address *</Label>
                          <Input
                            value={form.address}
                            onChange={(e) => updateField('address', e.target.value)}
                            placeholder="123 Main Street"
                          />
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
                          <div className="space-y-1.5">
                            <Label className="text-xs">Living Situation</Label>
                            <Select value={form.living_situation} onValueChange={(v) => updateField('living_situation', v)}>
                              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                              <SelectContent>
                                {livingSituationOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Residential Status</Label>
                          <Select value={form.residential_status} onValueChange={(v) => updateField('residential_status', v)}>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                              {residentialStatusOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Start Date</Label>
                            <Input type="date" value={form.start_date} onChange={(e) => updateField('start_date', e.target.value)} />
                          </div>
                          {!form.is_current && (
                            <div className="space-y-1.5">
                              <Label className="text-xs">End Date</Label>
                              <Input type="date" value={form.end_date} onChange={(e) => updateField('end_date', e.target.value)} />
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2 pt-2">
                          {editingId && (
                            <Button variant="outline" onClick={resetForm} className="flex-1">Cancel</Button>
                          )}
                          <Button
                            onClick={() => {
                              if (!form.address.trim()) { toast.error('Address is required'); return; }
                              if (form.current_postcode.trim() && !/^\d{4}$/.test(form.current_postcode.trim())) { toast.error('Postcode must be 4 digits'); return; }
                              if (form.current_state.trim() && !/^[A-Za-z]{2,3}$/.test(form.current_state.trim())) { toast.error('State must be a 2–3 letter code'); return; }
                              saveMutation.mutate();
                            }}
                            disabled={saveMutation.isPending}
                            className="flex-1"
                          >
                            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {editingId ? 'Update' : 'Add'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                );
              })}
            </Tabs>
          </ScrollArea>

          <SheetFooter className="pt-4">
            <Button variant="outline" onClick={() => { setOpen(false); onComplete(); }}>Done</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
