import { Link, Navigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, Landmark, Scale } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { clientLegalWorkspaceEnabled, useClientLegalCases } from '@/lib/clientLegalWorkspace';

const date=(value:string|null)=>value?new Date(value).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}):'Not scheduled';
export default function PortalLegal(){
 const {data:cases=[],isLoading,error}=useClientLegalCases();
 if(!clientLegalWorkspaceEnabled)return <Navigate to="/client" replace/>;
 return <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
  <header className="flex items-start gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><Scale className="h-5 w-5"/></div><div><h1 className="text-2xl font-semibold tracking-tight">Legal workspace</h1><p className="text-sm text-muted-foreground">Track conveyancing progress, documents, actions and messages with your legal team.</p></div></header>
  {isLoading?<div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-56"/><Skeleton className="h-56"/></div>:error?<Card><CardContent className="py-12 text-center"><p className="font-medium">Your legal workspace could not be loaded.</p><p className="mt-1 text-sm text-muted-foreground">Please refresh the page or contact your adviser if this continues.</p></CardContent></Card>:cases.length===0?<Card><CardContent className="py-14 text-center"><Landmark className="mx-auto h-8 w-8 text-muted-foreground"/><p className="mt-4 font-medium">No legal matter is connected yet</p><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Your legal workspace will appear after your adviser links an active transaction to your legal matter.</p></CardContent></Card>:<div className="grid gap-4 md:grid-cols-2">{cases.map(item=><Card key={item.case_id} className="flex flex-col"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-lg">{item.property_address||'Property transaction'}</CardTitle><CardDescription>{item.matter_reference||'Legal matter'}</CardDescription></div><Badge variant="secondary" className="capitalize">{item.friendly_status}</Badge></div></CardHeader><CardContent className="flex flex-1 flex-col gap-4"><p className="line-clamp-3 text-sm text-muted-foreground">{item.shared_summary||'Your legal team will add a shared progress summary here.'}</p><div className="grid gap-2 text-sm"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground"/><span>Settlement: {date(item.settlement_date)}</span></div><div className="flex items-center gap-2"><Scale className="h-4 w-4 text-muted-foreground"/><span>{item.solicitor_name||item.practice_name||'Legal team to be confirmed'}</span></div></div><Button asChild className="mt-auto w-full sm:w-fit"><Link to={`/client/legal/${item.case_id}`}>Open workspace<ArrowRight className="ml-2 h-4 w-4"/></Link></Button></CardContent></Card>)}</div>}
 </main>;
}
