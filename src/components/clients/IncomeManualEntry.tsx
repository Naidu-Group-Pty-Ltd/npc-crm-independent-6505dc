import { useState, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetDescription, SheetFooter,
  SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, DollarSign, Briefcase } from 'lucide-react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { IncomeSourceForm } from './income/IncomeSourceForm';
import { IncomeSourceCard } from './income/IncomeSourceCard';
import {
  IncomeSource,
  getSourceTotalAnnual,
  formatCurrency,
} from './income/incomeSourceTypes';
import { ContactInfo, getContactTabLabel } from './hooks/useClientContacts';

interface IncomeManualEntryProps {
  clientId: string;
  contacts: ContactInfo[];
  onComplete: () => void;
}

export function IncomeManualEntry({ clientId, contacts, onComplete }: IncomeManualEntryProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(contacts[0]?.id || 'primary');
  const [editingSource, setEditingSource] = useState<IncomeSource | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const queryClient = useQueryClient();

  const { data: incomeSources = [] } = useQuery<IncomeSource[]>({
    queryKey: ['client-income-sources', clientId],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        clientId,
        include: { incomeSources: true, client: false, properties: false, employment: false, income: false, assets: false, liabilities: false, expenses: false },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error('Failed to fetch income sources');
      return data.incomeSources || [];
    },
  });

  // Helper to get sources for a specific contact
  const getSourcesForContact = (contact: ContactInfo) => {
    return incomeSources.filter((s: any) => {
      if (contact.contactType === 'primary') return s.contact_type === 'primary' && !s.additional_contact_id;
      if (contact.contactType === 'secondary') return s.contact_type === 'secondary' && !s.additional_contact_id;
      return s.additional_contact_id === contact.additionalContactId;
    });
  };

  const combinedTotal = useMemo(() => incomeSources.reduce((sum, s) => sum + getSourceTotalAnnual(s), 0), [incomeSources]);
  const employmentSources = useMemo(() => incomeSources.filter((s: any) => s.employment_id), [incomeSources]);

  // Current tab sources
  const activeContact = contacts.find(c => c.id === activeTab);
  const currentSources = activeContact ? getSourcesForContact(activeContact) : [];
  const currentEmploymentSources = currentSources.filter((s: any) => s.employment_id);
  const currentStandaloneSources = currentSources.filter((s: any) => !s.employment_id);

  const saveMutation = useMutation({
    mutationFn: async (source: IncomeSource) => {
      const { id, client_id, ...payload } = source;
      // Set correct contact attribution
      if (activeContact) {
        (payload as any).contact_type = activeContact.contactType === 'additional' ? 'additional' : activeContact.contactType;
        (payload as any).additional_contact_id = activeContact.additionalContactId || null;
      }
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: id ? 'update' : 'create',
        table: 'client_income_sources',
        clientId,
        recordId: id,
        data: payload,
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to save');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-income-sources', clientId] });
      queryClient.invalidateQueries({ queryKey: ['borrowing-capacity-client-data', clientId] });
      setEditingSource(null);
      setIsAdding(false);
      toast.success('Income source saved');
    },
    onError: (err: any) => toast.error('Failed to save: ' + err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_income_sources',
        clientId,
        recordId: sourceId,
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to delete');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-income-sources', clientId] });
      queryClient.invalidateQueries({ queryKey: ['borrowing-capacity-client-data', clientId] });
      toast.success('Income source removed');
    },
    onError: (err: any) => toast.error('Failed to delete: ' + err.message),
  });

  const showForm = isAdding || editingSource !== null;

  // Build per-contact summary for display
  const contactSummaries = useMemo(() => {
    return contacts.map(c => {
      const sources = getSourcesForContact(c);
      const total = sources.reduce((sum, s) => sum + getSourceTotalAnnual(s), 0);
      return { contact: c, count: sources.length, total };
    }).filter(s => s.count > 0);
  }, [contacts, incomeSources]);

  return (
    <div className="space-y-4">
      {incomeSources.length > 0 ? (
        <div className="space-y-2">
          <Card className="bg-success/10 border-success/20">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-success" />
                <span className="font-medium text-success">Total Household Income</span>
              </div>
              <p className="text-2xl font-bold text-success">{formatCurrency(combinedTotal)}/year</p>
              <p className="text-sm text-muted-foreground">
                {formatCurrency(combinedTotal / 12)}/month • {incomeSources.length} source{incomeSources.length !== 1 ? 's' : ''}
                {employmentSources.length > 0 && (
                  <span className="ml-1">({employmentSources.length} from employment)</span>
                )}
              </p>
            </CardContent>
          </Card>
          
          {contactSummaries.length > 1 && (
            <div className="grid grid-cols-2 gap-2">
              {contactSummaries.map(({ contact, count, total }) => (
                <Card key={contact.id}>
                  <CardContent className="pt-3">
                    <p className="text-xs text-muted-foreground">{getContactTabLabel(contact)} ({count})</p>
                    <p className="font-medium">{formatCurrency(total)}/yr</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-4 text-muted-foreground">
          <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No income sources</p>
        </div>
      )}

      <Sheet open={open} onOpenChange={(v) => {
        setOpen(v);
        if (!v) { setEditingSource(null); setIsAdding(false); }
      }}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            {incomeSources.length > 0 ? 'Manage Income Sources' : 'Add Income Sources'}
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Income Sources
            </SheetTitle>
            <SheetDescription>
              Employment income is managed from the Employment tab. Add other income sources here.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-180px)] pr-4 mt-4">
            {showForm ? (
              <IncomeSourceForm
                source={editingSource || undefined}
                contactType={activeContact?.contactType === 'secondary' ? 'secondary' : 'primary'}
                onSave={(source) => saveMutation.mutate(source)}
                onCancel={() => { setEditingSource(null); setIsAdding(false); }}
                isPending={saveMutation.isPending}
                hideEmploymentCategory
              />
            ) : (
              <Tabs value={activeTab} onValueChange={v => setActiveTab(v)}>
                <div className="overflow-x-auto -mx-1 px-1 scrollbar-hide">
                  <TabsList className="inline-flex w-auto min-w-max">
                    {contacts.map(c => (
                      <TabsTrigger key={c.id} value={c.id} className="text-xs sm:text-sm whitespace-nowrap">
                        {getContactTabLabel(c)} ({getSourcesForContact(c).length})
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>

                {contacts.map(contact => {
                  const empSources = getSourcesForContact(contact).filter((s: any) => s.employment_id);
                  const standSources = getSourcesForContact(contact).filter((s: any) => !s.employment_id);
                  
                  return (
                    <TabsContent key={contact.id} value={contact.id} className="mt-4 space-y-3">
                      {empSources.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">From Employment</p>
                          </div>
                          {empSources.map((source: any) => (
                            <IncomeSourceCard
                              key={source.id}
                              source={source}
                              onEdit={() => {}}
                              onDelete={() => {}}
                              isLinkedToEmployment
                            />
                          ))}
                        </div>
                      )}

                      {standSources.length > 0 && (
                        <div className="space-y-2">
                          {empSources.length > 0 && (
                            <div className="flex items-center gap-2 mt-4">
                              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Other Income</p>
                            </div>
                          )}
                          {standSources.map((source: any) => (
                            <IncomeSourceCard
                              key={source.id}
                              source={source}
                              onEdit={() => setEditingSource(source)}
                              onDelete={() => source.id && deleteMutation.mutate(source.id)}
                            />
                          ))}
                        </div>
                      )}

                      {empSources.length === 0 && standSources.length === 0 && (
                        <div className="text-center py-6 text-muted-foreground">
                          <p className="text-sm">No income sources for {contact.name}</p>
                        </div>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => setIsAdding(true)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Income Source
                      </Button>
                    </TabsContent>
                  );
                })}
              </Tabs>
            )}
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
