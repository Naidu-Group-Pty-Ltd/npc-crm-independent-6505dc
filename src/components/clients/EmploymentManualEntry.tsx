import { useState, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Sheet, SheetContent, SheetDescription, SheetFooter,
  SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Briefcase, Trash2, Edit, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { EmploymentFormFields, EmploymentFormData } from './EmploymentFormFields';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { formatCurrency, convertToAnnual } from './income/incomeSourceTypes';
import { ContactInfo, getContactTabLabel } from './hooks/useClientContacts';
import { ThreeYearCoverageWarning } from './ThreeYearCoverageWarning';
import { calculateCoverage } from '@/utils/threeYearCoverage';

interface EmploymentManualEntryProps {
  clientId: string;
  contacts: ContactInfo[];
  onComplete: () => void;
}

const defaultFormData: EmploymentFormData = {
  contact_type: 'primary',
  additional_contact_id: null,
  is_current: true,
  employment_type: 'permanent',
  occupation_role: '',
  employer_name: '',
  start_date: '',
  salary_amount: 0,
  salary_frequency: 'annual',
  gross_annual_salary: 0,
  bonus: 0,
  commission: 0,
  overtime_essential: 0,
  overtime_non_essential: 0,
  allowance: 0,
  other_taxable_income: 0,
  workplace_address_line_1: '',
  workplace_suburb: '',
  workplace_state: '',
  workplace_postcode: '',
  workplace_country: '',
  work_arrangement: '',
};

async function fetchEmploymentSecure(clientId: string) {
  const { data, error } = await invokeSecureFunction('get-client-data', {
    clientId,
    include: { employment: true },
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error('Failed to fetch employment');
  return data.employment || [];
}

export function EmploymentManualEntry({ clientId, contacts, onComplete }: EmploymentManualEntryProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('primary');
  // One independent draft (and edit target) per contact tab. A single shared
  // formData let one contact's workplace address bleed into another's panel when
  // switching tabs, so every tab keeps its own record state.
  const [drafts, setDrafts] = useState<Record<string, EmploymentFormData>>({});
  const [editingIds, setEditingIds] = useState<Record<string, string | null>>({});
  const queryClient = useQueryClient();

  const blankFormFor = useCallback((tabId: string): EmploymentFormData => {
    const contact = contacts.find(c => c.id === tabId);
    return {
      ...defaultFormData,
      contact_type: contact?.contactType === 'additional' ? 'additional' : (contact?.contactType || 'primary') as any,
      additional_contact_id: contact?.additionalContactId || null,
    };
  }, [contacts]);

  const formData = drafts[activeTab] ?? blankFormFor(activeTab);
  const editingId = editingIds[activeTab] ?? null;

  const { data: existingEmployment = [] } = useQuery({
    queryKey: ['client-employment', clientId],
    queryFn: () => fetchEmploymentSecure(clientId),
  });

  // Filter employment records per contact
  const getEmploymentForContact = useCallback((contact: ContactInfo) => {
    return existingEmployment.filter((e: any) => {
      if (contact.contactType === 'primary') return e.contact_type === 'primary' && !e.additional_contact_id;
      if (contact.contactType === 'secondary') return e.contact_type === 'secondary' && !e.additional_contact_id;
      return e.additional_contact_id === contact.additionalContactId;
    });
  }, [existingEmployment]);

  const previousEmployment = useMemo(() => existingEmployment.filter((e: any) => !e.is_current), [existingEmployment]);

  // 3-year coverage for primary contact employment
  const primaryCoverage = useMemo(() => {
    const primaryEmp = existingEmployment.filter((e: any) => e.contact_type === 'primary' && !e.additional_contact_id);
    return calculateCoverage(primaryEmp);
  }, [existingEmployment]);

  const updateField = useCallback((field: keyof EmploymentFormData, value: any) => {
    setDrafts(prev => ({
      ...prev,
      [activeTab]: { ...(prev[activeTab] ?? blankFormFor(activeTab)), [field]: value },
    }));
  }, [activeTab, blankFormFor]);

  const resetForm = useCallback(() => {
    setDrafts(prev => ({ ...prev, [activeTab]: blankFormFor(activeTab) }));
    setEditingIds(prev => ({ ...prev, [activeTab]: null }));
  }, [activeTab, blankFormFor]);


  const startEdit = (employment: any) => {
    // The record's own contact determines which tab owns this draft.
    const tabId = employment.additional_contact_id || employment.contact_type;
    setDrafts(prev => ({
      ...prev,
      [tabId]: {
        id: employment.id,
        contact_type: employment.contact_type,
        additional_contact_id: employment.additional_contact_id || null,
        is_current: employment.is_current ?? true,
        employment_type: employment.employment_type || 'permanent',
        occupation_role: employment.occupation_role || '',
        employer_name: employment.employer_name || '',
        start_date: employment.start_date || '',
        salary_amount: employment.salary_amount || 0,
        salary_frequency: employment.salary_frequency || 'annual',
        gross_annual_salary: employment.gross_annual_salary || 0,
        bonus: employment.bonus || 0,
        commission: employment.commission || 0,
        overtime_essential: employment.overtime_essential || 0,
        overtime_non_essential: employment.overtime_non_essential || 0,
        allowance: employment.allowance || 0,
        other_taxable_income: employment.other_taxable_income || 0,
        workplace_address_line_1: employment.workplace_address_line_1 || '',
        workplace_suburb: employment.workplace_suburb || '',
        workplace_state: employment.workplace_state || '',
        workplace_postcode: employment.workplace_postcode || '',
        workplace_country: employment.workplace_country || '',
        work_arrangement: employment.work_arrangement || '',
      },
    }));
    setEditingIds(prev => ({ ...prev, [tabId]: employment.id }));
    setActiveTab(tabId);
  };


  const saveMutation = useMutation({
    mutationFn: async () => {
      const activeContact = contacts.find(c => c.id === activeTab);
      const payload = {
        contact_type: activeContact?.contactType === 'additional' ? 'additional' : (activeContact?.contactType || 'primary'),
        additional_contact_id: activeContact?.additionalContactId || null,
        is_current: formData.is_current,
        employment_type: formData.employment_type,
        occupation_role: formData.occupation_role,
        employer_name: formData.employer_name,
        start_date: formData.start_date || null,
        salary_amount: formData.salary_amount,
        salary_frequency: formData.salary_frequency,
        gross_annual_salary: formData.gross_annual_salary || convertToAnnual(formData.salary_amount || 0, formData.salary_frequency || 'annual'),
        bonus: formData.bonus,
        commission: formData.commission,
        overtime_essential: formData.overtime_essential,
        overtime_non_essential: formData.overtime_non_essential,
        allowance: formData.allowance,
        other_taxable_income: formData.other_taxable_income,
        workplace_address_line_1: formData.workplace_address_line_1.trim() || null,
        workplace_suburb: formData.workplace_suburb.trim() || null,
        workplace_state: formData.workplace_state.trim().toUpperCase() || null,
        workplace_postcode: formData.workplace_postcode.trim() || null,
        workplace_country: formData.workplace_country.trim() || null,
        work_arrangement: formData.work_arrangement || null,
      };

      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: editingId ? 'update' : 'create',
        table: 'client_employment',
        clientId,
        recordId: editingId || undefined,
        data: payload,
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to save employment');
      return data.result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-employment', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client-income-sources', clientId] });
      queryClient.invalidateQueries({ queryKey: ['borrowing-capacity-client-data', clientId] });
      toast.success(editingId ? 'Employment updated' : 'Employment added');
      resetForm();
    },
    onError: (error: any) => {
      toast.error('Failed to save employment: ' + error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_employment',
        clientId,
        recordId: id,
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to delete employment');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-employment', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client-income-sources', clientId] });
      queryClient.invalidateQueries({ queryKey: ['borrowing-capacity-client-data', clientId] });
      toast.success('Employment deleted');
      if (editingId) resetForm();
    },
    onError: (error: any) => {
      toast.error('Failed to delete: ' + error.message);
    },
  });

  const handleSubmit = () => {
    if (!formData.employer_name.trim()) {
      toast.error('Employer name is required');
      return;
    }
    const workplaceValues = [
      formData.workplace_address_line_1,
      formData.workplace_suburb,
      formData.workplace_state,
      formData.workplace_postcode,
      formData.workplace_country,
      formData.work_arrangement,
    ];
    if (workplaceValues.some(value => value.trim()) && !formData.workplace_address_line_1.trim()) {
      toast.error('Workplace address is required when employer location details are entered');
      return;
    }
    saveMutation.mutate();
  };

  const getEmploymentIncome = (emp: any) => {
    const gross = emp.gross_annual_salary || convertToAnnual(emp.salary_amount || 0, emp.salary_frequency || 'annual');
    return gross + (emp.bonus || 0) + (emp.commission || 0) + 
      (emp.overtime_essential || 0) + (emp.overtime_non_essential || 0) + 
      (emp.allowance || 0) + (emp.other_taxable_income || 0);
  };

  const EmploymentCard = ({ employment }: { employment: any }) => {
    const totalIncome = getEmploymentIncome(employment);
    return (
      <Card className="mb-2">
        <CardContent className="pt-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">{employment.employer_name || 'Unknown Employer'}</span>
                {employment.is_current && (
                  <span className="text-xs bg-success/15 text-success px-2 py-0.5 rounded">Current</span>
                )}
                {!employment.is_current && (
                  <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded">Previous</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{employment.occupation_role}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {employment.employment_type} • Started: {employment.start_date || 'N/A'}
              </p>
              {totalIncome > 0 && (
                <div className="flex items-center gap-1 mt-1.5">
                  <DollarSign className="h-3 w-3 text-success" />
                  <span className="text-sm font-medium text-success">{formatCurrency(totalIncome)}/yr</span>
                </div>
              )}
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(employment)}>
                <Edit className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate(employment.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // Determine dynamic tab list: all contacts + "Previous"
  const tabItems = useMemo(() => {
    return [
      ...contacts.map(c => ({ value: c.id, label: getContactTabLabel(c), contact: c })),
      { value: 'previous', label: 'Previous', contact: null },
    ];
  }, [contacts]);

  return (
    <div className="space-y-4">
      <ThreeYearCoverageWarning coverage={primaryCoverage} label="Employment History" />

      {existingEmployment.length > 0 ? (
        <div className="space-y-2">
          {existingEmployment.map((emp: any) => {
            const totalIncome = getEmploymentIncome(emp);
            return (
              <Card key={emp.id} className="group mb-2">
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{emp.employer_name || 'Unknown Employer'}</span>
                        {emp.is_current && (
                          <span className="text-xs bg-success/15 text-success px-2 py-0.5 rounded">Current</span>
                        )}
                        {!emp.is_current && (
                          <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded">Previous</span>
                        )}
                        <span className="text-xs text-muted-foreground capitalize">({emp.contact_type})</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{emp.occupation_role}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {emp.employment_type} • Started: {emp.start_date || 'N/A'}
                      </p>
                      {totalIncome > 0 && (
                        <div className="flex items-center gap-1 mt-1.5">
                          <DollarSign className="h-3 w-3 text-success" />
                          <span className="text-sm font-medium text-success">{formatCurrency(totalIncome)}/yr</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { startEdit(emp); setOpen(true); }}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate(emp.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-4 text-muted-foreground">
          <Briefcase className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No employment records</p>
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            {existingEmployment.length > 0 ? 'Edit Employment' : 'Add Employment'}
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              Employment Details
            </SheetTitle>
            <SheetDescription>
              Manage employment records and income for each contact
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-180px)] pr-4 mt-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className={`grid w-full`} style={{ gridTemplateColumns: `repeat(${tabItems.length}, 1fr)` }}>
                {tabItems.map(tab => (
                  <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* Dynamic contact tabs */}
              {contacts.map(contact => {
                const contactEmployment = getEmploymentForContact(contact);
                const currentEmployment = contactEmployment.filter((e: any) => e.is_current);
                const contactCoverage = calculateCoverage(contactEmployment);
                return (
                  <TabsContent key={contact.id} value={contact.id} className="space-y-4 mt-4">
                    <ThreeYearCoverageWarning coverage={contactCoverage} label={`${contact.name} Employment`} />
                    {currentEmployment.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Current Employment — {contact.name}</Label>
                        {currentEmployment.map((emp: any) => (
                          <EmploymentCard key={emp.id} employment={emp} />
                        ))}
                      </div>
                    )}
                    <EmploymentFormFields
                      formData={formData}
                      updateField={updateField}
                      onSubmit={handleSubmit}
                      onCancel={resetForm}
                      isPending={saveMutation.isPending}
                      isEditing={!!editingId}
                    />
                  </TabsContent>
                );
              })}

              {/* Previous tab */}
              <TabsContent value="previous" className="space-y-4 mt-4">
                {previousEmployment.length > 0 ? (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Previous Employment Records</Label>
                    {previousEmployment.map((emp: any) => (
                      <EmploymentCard key={emp.id} employment={emp} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    <Briefcase className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No previous employment records</p>
                    <p className="text-xs mt-1">Toggle off "Current Employer" when adding to mark as previous</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </ScrollArea>

          <SheetFooter className="pt-4">
            <Button variant="outline" onClick={() => { setOpen(false); onComplete(); }}>
              Done
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
