import { useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FileCheck2, Loader2, UserPlus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { advancedClientCreationSchema } from '@/lib/client-fact-find/schema';
import type { AdvancedClientCreationPayload } from '@/lib/client-fact-find/types';
import type { ParsedExcelImport } from '@/lib/client-fact-find/excelImport';
import { saveAdvancedViewClientData } from '@/lib/client-fact-find/viewClientMapping';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { AdvancedTabNavigation, type AdvancedTab } from './AdvancedTabNavigation';
import { ClientFactFindTab } from './ClientFactFindTab';
import { ClientFormOutputTab } from './ClientFormOutputTab';
import { createAdvancedDefaults } from './defaults';
import { ExcelImportTab } from './ExcelImportTab';
import { LivingExpensesTab } from './LivingExpensesTab';
import type { ClientFactFindSection } from './ClientFactFindSectionNavigation';

export function AdvancedClientForm({ onCancel }: { active: boolean; onCancel: () => void }) {
  const methods = useForm<AdvancedClientCreationPayload>({resolver:zodResolver(advancedClientCreationSchema) as never,defaultValues:createAdvancedDefaults(),mode:'onBlur',shouldUnregister:false});
  const [tab,setTab]=useState<AdvancedTab>('excel'),[previousEditableTab,setPreviousEditableTab]=useState<Exclude<AdvancedTab,'output'>>('excel');
  const [factFindSection,setFactFindSection]=useState<ClientFactFindSection>('applicants'),[workbook,setWorkbook]=useState<File|null>(null),[creating,setCreating]=useState(false);
  const contentRef=useRef<HTMLDivElement>(null),createdClientId=useRef<string|null>(null),savedSections=useRef(new Set<string>()),queryClient=useQueryClient();
  const changeFactFindSection=(section:ClientFactFindSection)=>{setFactFindSection(section);if(contentRef.current)contentRef.current.scrollTop=0};
  const changeTab=(next:AdvancedTab)=>{if(next==='output'&&tab!=='output')setPreviousEditableTab(tab);setTab(next)};
  const reviewOutput=()=>{if(tab!=='output')setPreviousEditableTab(tab);setTab('output')};
  const applyImport=(parsed:ParsedExcelImport)=>{methods.reset(parsed.payload);setFactFindSection('applicants');setPreviousEditableTab('fact-find');setTab('fact-find');requestAnimationFrame(()=>{if(contentRef.current)contentRef.current.scrollTop=0});toast.success('Workbook values imported. Review and edit them before creating the client.')};
  const createClient=async()=>{
    if(creating)return;
    const validation=advancedClientCreationSchema.safeParse(methods.getValues());
    if(!validation.success){await methods.trigger();const issue=validation.error.issues[0],path=issue?.path,area=String(path?.[0]??'applicants');if(area==='applicants'){setTab('fact-find');setFactFindSection('applicants');const name=path?.join('.');if(name)requestAnimationFrame(()=>methods.setFocus(name as never))}else if(['addresses','employment','assets','liabilities'].includes(area)){setTab('fact-find');setFactFindSection(area==='addresses'?'addresses':area==='employment'?'employment':area==='assets'?'assets':'liabilities')}else if(area==='expenses')setTab('expenses');else {setTab('fact-find');setFactFindSection('applicants')};toast.error(area==='employment'&&issue?.message?issue.message:'Review the highlighted Advanced form fields.');return}
    setCreating(true);
    try{
      const payload=methods.getValues();
      if(!createdClientId.current){const primary=payload.applicants[0],result=await invokeSecureFunction('manage-client-data',{operation:'create',table:'clients',clientId:'',data:{primary_first_name:primary.firstName.trim(),primary_surname:primary.surname.trim(),primary_email:primary.email||null,primary_mobile:primary.mobile||null,total_portfolio_value:0,total_debt:0,net_monthly_cash_flow:0}});const client=result.data?.result;if(result.error||!result.data?.success||!client?.id)throw new Error();createdClientId.current=client.id}
      const clientId=createdClientId.current;
      const saveResult=await saveAdvancedViewClientData(clientId,payload,invokeSecureFunction,savedSections.current);savedSections.current=saveResult.completed;
      await Promise.all([['clients'],['client-details',clientId],['secure-client-data',clientId],['client-address-history',clientId],['client-employment',clientId],['client-properties',clientId],['client-assets',clientId],['client-liabilities',clientId],['client-expenses',clientId]].map(queryKey=>queryClient.invalidateQueries({queryKey})));
      if(saveResult.failures.length){const details=[...new Map(saveResult.failures.map(failure=>[failure.label,failure.reason])).entries()].map(([label,reason])=>`${label} could not be saved: ${reason}`).join(' ');toast.error(`Client created, but ${details} Review the information and try again.`);return}
      toast.success('Client created successfully.');
      methods.reset(createAdvancedDefaults());setWorkbook(null);createdClientId.current=null;savedSections.current.clear();onCancel();
    }catch{toast.error('The client could not be created. Review the form and try again.')}finally{setCreating(false)}
  };
  return <FormProvider {...methods}><form onSubmit={event=>event.preventDefault()} className="flex min-h-0 flex-1 flex-col"><Tabs value={tab} onValueChange={value=>changeTab(value as AdvancedTab)} className="flex min-h-0 flex-1 flex-col"><AdvancedTabNavigation/><div ref={contentRef} data-testid="advanced-content-scroll" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-background [scrollbar-gutter:stable]"><div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
    <TabsContent value="excel" className="m-0"><ExcelImportTab file={workbook} onFileChange={setWorkbook} hasFormValues={methods.formState.isDirty} onApply={applyImport}/></TabsContent>
    <TabsContent value="fact-find" className="m-0"><ClientFactFindTab section={factFindSection} onSectionChange={changeFactFindSection}/></TabsContent><TabsContent value="expenses" className="m-0"><LivingExpensesTab/></TabsContent><TabsContent value="output" className="m-0"><ClientFormOutputTab onBack={()=>setTab(previousEditableTab)}/></TabsContent>
  </div></div></Tabs><footer data-testid="advanced-footer" className="relative z-30 shrink-0 border-t border-border/50 bg-card px-3 py-3 shadow-[0_-14px_30px_-20px_hsl(var(--background))] sm:px-6"><div className="mx-auto flex max-w-[1400px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><p className="hidden text-xs text-muted-foreground md:block">Create a client after reviewing all Advanced form sections.</p><div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto sm:justify-end"><Button type="button" variant="outline" className="min-h-11 rounded-lg border-border/60 text-muted-foreground hover:text-foreground" onClick={onCancel} disabled={creating}>Cancel</Button>{tab!=='output'&&<Button type="button" variant="outline" className="min-h-11 rounded-lg border-brand-300/30 font-semibold hover:bg-primary/10" onClick={reviewOutput} disabled={creating}><FileCheck2 className="mr-2 h-4 w-4"/>Review Output</Button>}<Button type="button" className="dashboard-luxury-primary-cta col-span-2 min-h-11 rounded-lg px-5 font-bold transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none sm:col-auto" onClick={createClient} disabled={creating}>{creating?<Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none"/>:<UserPlus className="mr-2 h-4 w-4"/>}{creating?'Creating Client…':'Create Client'}</Button></div></div></footer></form></FormProvider>;
}
