import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetDescription, SheetFooter,
  SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Edit, User, Users, MapPin, IdCard, Heart, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useNotifications } from '@/contexts/NotificationsContext';
import { format } from 'date-fns';
import { AdditionalContactCard, AdditionalContact, relationshipOptions } from './AdditionalContactCard';
import { ContactFields } from './ContactFields';
import { ContactAddressFields, ContactAddressData, livingSituationOptions, residentialStatusOptions } from './ContactAddressFields';

interface PersonalDetailsManualEntryProps {
  clientId: string;
  clientData?: {
    primary_first_name: string;
    primary_middle_name: string | null;
    primary_surname: string;
    primary_mobile: string | null;
    primary_email: string | null;
    primary_gender: string | null;
    primary_dob: string | null;
    secondary_first_name: string | null;
    secondary_middle_name: string | null;
    secondary_surname: string | null;
    secondary_mobile: string | null;
    secondary_email: string | null;
    secondary_gender: string | null;
    secondary_dob: string | null;
    current_address: string | null;
    current_suburb?: string | null;
    current_state?: string | null;
    current_postcode?: string | null;
    country: string | null;
    living_situation: string | null;
    residential_status: string | null;
    marital_status: string | null;
    dependents_count: number | null;
    // Secondary address fields
    secondary_current_address?: string | null;
    secondary_current_suburb?: string | null;
    secondary_current_state?: string | null;
    secondary_current_postcode?: string | null;
    secondary_country?: string | null;
    secondary_living_situation?: string | null;
    secondary_residential_status?: string | null;
    secondary_same_address_as_primary?: boolean | null;
  };
  additionalContacts?: AdditionalContact[];
  onComplete: () => void;
}

interface FormData {
  primary_first_name: string;
  primary_middle_name: string;
  primary_surname: string;
  primary_mobile: string;
  primary_email: string;
  primary_gender: string;
  primary_dob: string;
  secondary_first_name: string;
  secondary_middle_name: string;
  secondary_surname: string;
  secondary_mobile: string;
  secondary_email: string;
  secondary_gender: string;
  secondary_dob: string;
  // Primary address
  current_address: string;
  current_suburb: string;
  current_state: string;
  current_postcode: string;
  country: string;
  living_situation: string;
  residential_status: string;
  // Secondary address
  secondary_current_address: string;
  secondary_current_suburb: string;
  secondary_current_state: string;
  secondary_current_postcode: string;
  secondary_country: string;
  secondary_living_situation: string;
  secondary_residential_status: string;
  secondary_same_address_as_primary: boolean;
  // Family
  marital_status: string;
  dependents_count: number;
}

const genderOptions = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const maritalStatusOptions = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'defacto', label: 'De Facto' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'separated', label: 'Separated' },
];

const formatLabel = (value: string | null | undefined, options?: { value: string; label: string }[]): string => {
  if (!value) return '-';
  if (options) {
    const found = options.find(o => o.value === value);
    return found?.label || value;
  }
  return value;
};

const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '-';
  try {
    return format(new Date(dateStr), 'dd MMM yyyy');
  } catch {
    return dateStr;
  }
};

export function PersonalDetailsManualEntry({ clientId, clientData, additionalContacts: initialAdditionalContacts = [], onComplete }: PersonalDetailsManualEntryProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { addNotification } = useNotifications();

  const [additionalContacts, setAdditionalContacts] = useState<(AdditionalContact & { current_address?: string; current_suburb?: string; current_state?: string; current_postcode?: string; country?: string; living_situation?: string; residential_status?: string; same_address_as_primary?: boolean })[]>([]);
  const [deletedContactIds, setDeletedContactIds] = useState<string[]>([]);

  const [formData, setFormData] = useState<FormData>({
    primary_first_name: '', primary_middle_name: '', primary_surname: '',
    primary_mobile: '', primary_email: '', primary_gender: '', primary_dob: '',
    secondary_first_name: '', secondary_middle_name: '', secondary_surname: '',
    secondary_mobile: '', secondary_email: '', secondary_gender: '', secondary_dob: '',
    current_address: '', current_suburb: '', current_state: '', current_postcode: '', country: 'Australia', living_situation: '', residential_status: '',
    secondary_current_address: '', secondary_current_suburb: '', secondary_current_state: '', secondary_current_postcode: '', secondary_country: 'Australia', secondary_living_situation: '', secondary_residential_status: '', secondary_same_address_as_primary: false,
    marital_status: '', dependents_count: 0,
  });

  // What the record looked like when this sheet last loaded it. Saving diffs
  // against this so an untouched field is never written back.
  const baselineRef = useRef<Record<string, any> | null>(null);

  /**
   * The client this form was last seeded for.
   *
   * The seeding effect below depended on `clientData` — an object literal the
   * parent rebuilds on EVERY render (`clientData={fullClient ? { … } : undefined}`
   * in `ClientDetailsModal`), so its identity changes constantly: a tab
   * switch, a toast, a settling query. Each change re-ran the effect and reset
   * every field to the server's values, discarding whatever was being typed.
   *
   * That is the 19 Sep 2026 clone audit's "everything typed and selected in
   * the fields under the address & ID goes missing after a few seconds after
   * filling up" — the seconds are however long it took the next render to
   * arrive.
   *
   * A form is seeded when it OPENS, for the client it is open on. It is not
   * re-seeded while it stays open, because the operator's typing is then the
   * newer truth. The ref is keyed on the client id so opening the sheet on a
   * different client seeds again.
   */
  const seededForClientId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      seededForClientId.current = null;
      return;
    }
    if (!clientData) return;
    if (seededForClientId.current === clientId) return;
    seededForClientId.current = clientId;
    {
      setFormData({

        primary_first_name: clientData.primary_first_name || '',
        primary_middle_name: clientData.primary_middle_name || '',
        primary_surname: clientData.primary_surname || '',
        primary_mobile: clientData.primary_mobile || '',
        primary_email: clientData.primary_email || '',
        primary_gender: clientData.primary_gender || '',
        primary_dob: clientData.primary_dob || '',
        secondary_first_name: clientData.secondary_first_name || '',
        secondary_middle_name: clientData.secondary_middle_name || '',
        secondary_surname: clientData.secondary_surname || '',
        secondary_mobile: clientData.secondary_mobile || '',
        secondary_email: clientData.secondary_email || '',
        secondary_gender: clientData.secondary_gender || '',
        secondary_dob: clientData.secondary_dob || '',
        current_address: clientData.current_address || '',
        current_suburb: clientData.current_suburb || '',
        current_state: clientData.current_state || '',
        current_postcode: clientData.current_postcode || '',
        country: clientData.country || 'Australia',
        living_situation: clientData.living_situation || '',
        residential_status: clientData.residential_status || '',
        secondary_current_address: (clientData as any).secondary_current_address || '',
        secondary_current_suburb: (clientData as any).secondary_current_suburb || '',
        secondary_current_state: (clientData as any).secondary_current_state || '',
        secondary_current_postcode: (clientData as any).secondary_current_postcode || '',
        secondary_country: (clientData as any).secondary_country || 'Australia',
        secondary_living_situation: (clientData as any).secondary_living_situation || '',
        secondary_residential_status: (clientData as any).secondary_residential_status || '',
        secondary_same_address_as_primary: (clientData as any).secondary_same_address_as_primary || false,
        marital_status: clientData.marital_status || '',
        dependents_count: clientData.dependents_count || 0,
      });
      baselineRef.current = {
        primary_first_name: clientData.primary_first_name ?? null,
        primary_middle_name: clientData.primary_middle_name ?? null,
        primary_surname: clientData.primary_surname ?? null,
        primary_mobile: clientData.primary_mobile ?? null,
        primary_email: clientData.primary_email ?? null,
        primary_gender: clientData.primary_gender ?? null,
        primary_dob: clientData.primary_dob ?? null,
        secondary_first_name: clientData.secondary_first_name ?? null,
        secondary_middle_name: clientData.secondary_middle_name ?? null,
        secondary_surname: clientData.secondary_surname ?? null,
        secondary_mobile: clientData.secondary_mobile ?? null,
        secondary_email: clientData.secondary_email ?? null,
        secondary_gender: clientData.secondary_gender ?? null,
        secondary_dob: clientData.secondary_dob ?? null,
        current_address: clientData.current_address ?? null,
        current_suburb: clientData.current_suburb ?? null,
        current_state: clientData.current_state ?? null,
        current_postcode: clientData.current_postcode ?? null,
        country: clientData.country ?? null,
        living_situation: clientData.living_situation ?? null,
        residential_status: clientData.residential_status ?? null,
        secondary_current_address: (clientData as any).secondary_current_address ?? null,
        secondary_current_suburb: (clientData as any).secondary_current_suburb ?? null,
        secondary_current_state: (clientData as any).secondary_current_state ?? null,
        secondary_current_postcode: (clientData as any).secondary_current_postcode ?? null,
        secondary_country: (clientData as any).secondary_country ?? null,
        secondary_living_situation: (clientData as any).secondary_living_situation ?? null,
        secondary_residential_status: (clientData as any).secondary_residential_status ?? null,
        secondary_same_address_as_primary: (clientData as any).secondary_same_address_as_primary ?? false,
        marital_status: clientData.marital_status ?? null,
        dependents_count: clientData.dependents_count ?? null,
      };
      setAdditionalContacts(initialAdditionalContacts.map(c => ({ ...c })));
      setDeletedContactIds([]);
    }
    // `clientData` and `initialAdditionalContacts` are read here but are
    // deliberately NOT dependencies: both are rebuilt by the parent on every
    // render, and reacting to their identity is what wiped the form. The
    // `seededForClientId` guard above is what decides when to read them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientId]);

  const updateField = useCallback((field: keyof FormData | string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleAddContact = () => {
    const newContact: AdditionalContact & { same_address_as_primary?: boolean } = {
      relationship: 'Additional Applicant',
      first_name: '', surname: '', middle_name: '', email: '', mobile: '', dob: '', gender: '',
      display_order: additionalContacts.length + 1,
      isNew: true,
    };
    setAdditionalContacts([...additionalContacts, newContact]);
  };

  const handleUpdateContact = useCallback((index: number, updatedContact: AdditionalContact) => {
    setAdditionalContacts(prev => prev.map((c, i) => i === index ? { ...c, ...updatedContact } : c));
  }, []);

  const handleRemoveContact = useCallback((index: number) => {
    setAdditionalContacts(prev => {
      const toRemove = prev[index];
      if (toRemove.id && !toRemove.isNew) {
        setDeletedContactIds(d => [...d, toRemove.id!]);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleAdditionalContactAddress = useCallback((index: number, field: keyof ContactAddressData, value: string | boolean) => {
    setAdditionalContacts(prev => prev.map((c, i) => {
      if (i !== index) return c;
      const updated = { ...c, [field]: value };
      // If toggling "same as primary", copy primary address
      if (field === 'same_address_as_primary' && value === true) {
        updated.current_address = formData.current_address;
        (updated as any).current_suburb = formData.current_suburb;
        (updated as any).current_state = formData.current_state;
        (updated as any).current_postcode = formData.current_postcode;
        updated.country = formData.country;
        updated.living_situation = formData.living_situation;
        updated.residential_status = formData.residential_status;
      }
      return updated;
    }));
  }, [formData.current_address, formData.current_suburb, formData.current_state, formData.current_postcode, formData.country, formData.living_situation, formData.residential_status]);

  const updateClientMutation = useMutation({
    mutationFn: async () => {
      const updateData: Record<string, any> = {
        primary_first_name: formData.primary_first_name,
        primary_middle_name: formData.primary_middle_name || null,
        primary_surname: formData.primary_surname,
        primary_mobile: formData.primary_mobile || null,
        primary_email: formData.primary_email || null,
        primary_gender: formData.primary_gender || null,
        primary_dob: formData.primary_dob || null,
        secondary_first_name: formData.secondary_first_name || null,
        secondary_middle_name: formData.secondary_middle_name || null,
        secondary_surname: formData.secondary_surname || null,
        secondary_mobile: formData.secondary_mobile || null,
        secondary_email: formData.secondary_email || null,
        secondary_gender: formData.secondary_gender || null,
        secondary_dob: formData.secondary_dob || null,
        current_address: formData.current_address || null,
        current_suburb: formData.current_suburb || null,
        current_state: formData.current_state || null,
        current_postcode: formData.current_postcode || null,
        country: formData.country || null,
        living_situation: formData.living_situation || null,
        residential_status: formData.residential_status || null,
        secondary_current_address: formData.secondary_current_address || null,
        secondary_current_suburb: formData.secondary_current_suburb || null,
        secondary_current_state: formData.secondary_current_state || null,
        secondary_current_postcode: formData.secondary_current_postcode || null,
        secondary_country: formData.secondary_country || null,
        secondary_living_situation: formData.secondary_living_situation || null,
        secondary_residential_status: formData.secondary_residential_status || null,
        secondary_same_address_as_primary: formData.secondary_same_address_as_primary,
        marital_status: formData.marital_status || null,
        dependents_count: formData.dependents_count || null,
      };

      // Send only the fields this dialog actually changed. The form snapshot is
      // taken when the sheet opens, so posting the whole record would revert any
      // field edited elsewhere in the meantime (the address panel, an import, a
      // sync) back to the stale snapshot value.
      const baseline = baselineRef.current;
      const changedData: Record<string, any> = {};
      for (const [key, value] of Object.entries(updateData)) {
        if (!baseline || !(key in baseline)) {
          changedData[key] = value;
          continue;
        }
        const before = baseline[key] === '' || baseline[key] === undefined ? null : baseline[key];
        const after = value === '' || value === undefined ? null : value;
        if (before !== after) changedData[key] = value;
      }

      // Update via secure edge function only — the anon-key fallback would fail RLS and
      // silently mask errors, so we surface the real error instead.
      const { data: resp, error: edgeErr } = Object.keys(changedData).length === 0
        ? { data: { success: true } as any, error: null as any }
        : await invokeSecureFunction('manage-client-data', {
            operation: 'update', table: 'clients', clientId, data: changedData,
          });

      if (edgeErr) {
        console.error('[client-update] edge function error', edgeErr);
        throw new Error(edgeErr.message || 'Failed to save client details');
      }
      if (!resp?.success) {
        const details = (resp as any)?.details || (resp as any)?.error || 'Unknown error';
        console.error('[client-update] non-success response', resp);
        throw new Error(String(details));
      }

      // What we just wrote is now the record's state, so a second save in the
      // same session diffs against it rather than re-sending these fields.
      baselineRef.current = { ...(baseline || {}), ...changedData };



      // Delete removed contacts
      for (const contactId of deletedContactIds) {
        try {
          await invokeSecureFunction('manage-client-data', {
            operation: 'delete', table: 'client_additional_contacts', clientId, recordId: contactId,
          });
        } catch (err) {
          console.warn('Failed to delete contact:', err);
        }
      }

      // Save additional contacts (with address fields)
      for (let i = 0; i < additionalContacts.length; i++) {
        const contact = additionalContacts[i];
        if (!contact.first_name.trim() || !contact.surname.trim()) continue;

        const contactData: Record<string, any> = {
          relationship: contact.relationship,
          first_name: contact.first_name.trim(),
          surname: contact.surname.trim(),
          middle_name: contact.middle_name?.trim() || null,
          email: contact.email?.trim() || null,
          mobile: contact.mobile?.trim() || null,
          dob: contact.dob || null,
          gender: contact.gender || null,
          display_order: i + 1,
          current_address: contact.current_address || null,
          current_suburb: contact.current_suburb || null,
          current_state: contact.current_state || null,
          current_postcode: contact.current_postcode || null,
          country: contact.country || 'Australia',
          living_situation: contact.living_situation || null,
          residential_status: contact.residential_status || null,
          same_address_as_primary: contact.same_address_as_primary || false,
        };

        try {
          if (contact.id && !contact.isNew) {
            await invokeSecureFunction('manage-client-data', {
              operation: 'update', table: 'client_additional_contacts', clientId, recordId: contact.id, data: contactData,
            });
          } else {
            await invokeSecureFunction('manage-client-data', {
              operation: 'create', table: 'client_additional_contacts', clientId, data: contactData,
            });
          }
        } catch (err) {
          console.warn('Failed to save additional contact:', err);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-details', clientId] });
      queryClient.invalidateQueries({ queryKey: ['secure-client-data', clientId] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Personal details updated successfully');
      addNotification({
        type: 'client_updated', title: 'Client Updated',
        message: `Personal details updated for ${formData.primary_first_name} ${formData.primary_surname}`,
        entityId: clientId,
      });
      setOpen(false);
      onComplete();
    },
    onError: (error: any) => {
      toast.error('Failed to update personal details: ' + error.message);
    },
  });

  const handleSubmit = () => {
    if (!formData.primary_first_name.trim() || !formData.primary_surname.trim()) {
      toast.error('Primary contact name is required');
      return;
    }
    updateClientMutation.mutate();
  };

  const primaryAddressRef = {
    current_address: formData.current_address,
    current_suburb: formData.current_suburb,
    current_state: formData.current_state,
    current_postcode: formData.current_postcode,
    country: formData.country,
    living_situation: formData.living_situation,
    residential_status: formData.residential_status,
  };

  // Check if secondary contact exists
  const hasSecondary = !!(formData.secondary_first_name || formData.secondary_surname);

  const DisplayCard = ({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) => (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Icon className="h-4 w-4" />{title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-2">{children}</CardContent>
    </Card>
  );

  const DisplayItem = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between py-1 border-b border-border/50 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Users className="h-5 w-5" />
          Personal Details
        </h3>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              <Edit className="h-4 w-4 mr-2" />
              Edit Details
            </Button>
          </SheetTrigger>
          <SheetContent className="flex w-full flex-col sm:max-w-3xl">
            <SheetHeader className="shrink-0">
              <SheetTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Personal Details (All Applicants)
              </SheetTitle>
              <SheetDescription>
                Edit personal details matching Formara template format
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1 pr-4">
              <Tabs defaultValue="contacts" className="w-full mt-4">
                <div className="overflow-x-auto -mx-1 px-1 scrollbar-hide">
                  <TabsList className="inline-flex w-auto min-w-max">
                    <TabsTrigger value="contacts" className="text-xs sm:text-sm">Contacts</TabsTrigger>
                    <TabsTrigger value="address" className="text-xs sm:text-sm">Address & ID</TabsTrigger>
                    <TabsTrigger value="family" className="text-xs sm:text-sm">Family</TabsTrigger>
                  </TabsList>
                </div>

                {/* Contacts Tab */}
                <TabsContent value="contacts" className="space-y-4 mt-4">
                  <ContactFields prefix="primary" title="Primary Contact" formData={formData} updateField={updateField} />
                  <Separator className="my-4" />
                  <ContactFields prefix="secondary" title="Secondary Contact" formData={formData} updateField={updateField} />

                  {additionalContacts.length > 0 && (
                    <>
                      <Separator className="my-4" />
                      <div className="space-y-4">
                        {additionalContacts.map((contact, index) => (
                          <AdditionalContactCard
                            key={contact.id || `new-${index}`}
                            contact={contact}
                            index={index}
                            onChange={handleUpdateContact}
                            onRemove={handleRemoveContact}
                            isEditing={true}
                          />
                        ))}
                      </div>
                    </>
                  )}
                  <Separator className="my-4" />
                  <Button type="button" variant="outline" className="w-full" onClick={handleAddContact}>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Add Additional Contact
                  </Button>
                </TabsContent>

                {/* Address & ID Tab - per contact */}
                <TabsContent value="address" className="space-y-6 mt-4">
                  {/* Primary Contact Address */}
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 block">
                      Primary Contact — {formData.primary_first_name || 'Primary'} {formData.primary_surname}
                    </Label>
                    <ContactAddressFields
                      data={{
                        current_address: formData.current_address,
                        current_suburb: formData.current_suburb,
                        current_state: formData.current_state,
                        current_postcode: formData.current_postcode,
                        country: formData.country,
                        living_situation: formData.living_situation,
                        residential_status: formData.residential_status,
                        same_address_as_primary: false,
                      }}
                      onChange={(field, value) => updateField(field as string, value)}
                      hideSameAsPrimary
                    />
                  </div>

                  {/* Secondary Contact Address */}
                  {hasSecondary && (
                    <>
                      <Separator />
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 block">
                          Secondary Contact — {formData.secondary_first_name || 'Secondary'} {formData.secondary_surname}
                        </Label>
                        <ContactAddressFields
                          data={{
                            current_address: formData.secondary_current_address,
                            current_suburb: formData.secondary_current_suburb,
                            current_state: formData.secondary_current_state,
                            current_postcode: formData.secondary_current_postcode,
                            country: formData.secondary_country,
                            living_situation: formData.secondary_living_situation,
                            residential_status: formData.secondary_residential_status,
                            same_address_as_primary: formData.secondary_same_address_as_primary,
                          }}
                          onChange={(field, value) => {
                            const prefixedField = `secondary_${field}`;
                            updateField(prefixedField, value);
                          }}
                          primaryAddress={primaryAddressRef}
                        />
                      </div>
                    </>
                  )}

                  {/* Additional Contacts Addresses */}
                  {additionalContacts.map((contact, index) => {
                    if (!contact.first_name && !contact.surname) return null;
                    const contactName = [contact.first_name, contact.surname].filter(Boolean).join(' ') || `Contact ${index + 3}`;
                    return (
                      <div key={contact.id || `addr-${index}`}>
                        <Separator className="mb-6" />
                        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 block">
                          {contact.relationship || 'Additional'} — {contactName}
                        </Label>
                        <ContactAddressFields
                          data={{
                            current_address: contact.current_address || '',
                            current_suburb: contact.current_suburb || '',
                            current_state: contact.current_state || '',
                            current_postcode: contact.current_postcode || '',
                            country: contact.country || 'Australia',
                            living_situation: contact.living_situation || '',
                            residential_status: contact.residential_status || '',
                            same_address_as_primary: contact.same_address_as_primary || false,
                          }}
                          onChange={(field, value) => handleAdditionalContactAddress(index, field, value)}
                          primaryAddress={primaryAddressRef}
                        />
                      </div>
                    );
                  })}
                </TabsContent>

                {/* Family Tab */}
                <TabsContent value="family" className="space-y-4 mt-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Heart className="h-4 w-4" />
                        Family Relations
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label className="text-xs">Marital Status</Label>
                          <Select value={formData.marital_status} onValueChange={(v) => updateField('marital_status', v)}>
                            <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                            <SelectContent>
                              {maritalStatusOptions.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Number of Dependents (under 18)</Label>
                          <Input
                            type="number" min="0"
                            value={formData.dependents_count || ''}
                            onChange={(e) => updateField('dependents_count', parseInt(e.target.value) || 0)}
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </ScrollArea>

            <SheetFooter className="shrink-0 border-t border-border bg-background pt-4">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={updateClientMutation.isPending}>
                {updateClientMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {/* Read-only display */}
      <div className="grid gap-4 md:grid-cols-2">
        <DisplayCard title="Primary Contact" icon={User}>
          <DisplayItem label="Name" value={[clientData?.primary_first_name, clientData?.primary_middle_name, clientData?.primary_surname].filter(Boolean).join(' ') || '-'} />
          <DisplayItem label="Mobile" value={clientData?.primary_mobile || '-'} />
          <DisplayItem label="Email" value={clientData?.primary_email || '-'} />
          <DisplayItem label="Gender" value={formatLabel(clientData?.primary_gender, genderOptions)} />
          <DisplayItem label="Date of Birth" value={formatDate(clientData?.primary_dob)} />
        </DisplayCard>

        <DisplayCard title="Secondary Contact" icon={Users}>
          <DisplayItem label="Name" value={[clientData?.secondary_first_name, clientData?.secondary_middle_name, clientData?.secondary_surname].filter(Boolean).join(' ') || '-'} />
          <DisplayItem label="Mobile" value={clientData?.secondary_mobile || '-'} />
          <DisplayItem label="Email" value={clientData?.secondary_email || '-'} />
          <DisplayItem label="Gender" value={formatLabel(clientData?.secondary_gender, genderOptions)} />
          <DisplayItem label="Date of Birth" value={formatDate(clientData?.secondary_dob)} />
        </DisplayCard>

        <DisplayCard title="Primary Address" icon={MapPin}>
          <DisplayItem label="Current Address" value={[clientData?.current_address, clientData?.current_suburb, clientData?.current_state, clientData?.current_postcode].filter(Boolean).join(', ') || '-'} />
          <DisplayItem label="Country" value={clientData?.country || '-'} />
          <DisplayItem label="Living Situation" value={formatLabel(clientData?.living_situation, livingSituationOptions)} />
          <DisplayItem label="Residential Status" value={formatLabel(clientData?.residential_status, residentialStatusOptions)} />
        </DisplayCard>

        <DisplayCard title="Family" icon={Heart}>
          <DisplayItem label="Marital Status" value={formatLabel(clientData?.marital_status, maritalStatusOptions)} />
          <DisplayItem label="Dependents" value={clientData?.dependents_count?.toString() || '0'} />
        </DisplayCard>
      </div>

      {initialAdditionalContacts.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium text-muted-foreground mb-3">Additional Contacts</h4>
          <div className="grid gap-4 md:grid-cols-2">
            {initialAdditionalContacts.map((contact) => (
              <DisplayCard key={contact.id} title={contact.relationship} icon={UserPlus}>
                <DisplayItem label="Name" value={[contact.first_name, contact.middle_name, contact.surname].filter(Boolean).join(' ') || '-'} />
                <DisplayItem label="Mobile" value={contact.mobile || '-'} />
                <DisplayItem label="Email" value={contact.email || '-'} />
                <DisplayItem label="Date of Birth" value={formatDate(contact.dob)} />
              </DisplayCard>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
