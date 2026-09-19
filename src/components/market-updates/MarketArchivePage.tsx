import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Archive, ArrowLeft, ExternalLink, Loader2, RotateCcw, Search, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchMarketUpdateArchive, restoreMarketUpdate } from '@/services/marketUpdatesService';
import type { ArchivedMarketUpdate, MarketUpdateArchivePage } from '@/types/marketUpdates';
import { useModulePermissions } from '@/hooks/useModulePermissions';

const EMPTY_PAGE:MarketUpdateArchivePage={items:[],count:0,page:1,pageSize:20,hasMore:false};
const ALL='all';
const dateLabel=(value?:string|null)=>value?new Date(value).toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short'}):'Not available';
const titleCase=(value:string)=>value.split('_').map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ');

interface Filters { source:string; category:string; geography:string; impact:string; audience:string; sort:'archived_desc'|'published_desc' }
const INITIAL_FILTERS:Filters={source:ALL,category:ALL,geography:ALL,impact:ALL,audience:ALL,sort:'archived_desc'};

export function MarketArchivePage() {
  const {canEdit:canRestore}=useModulePermissions('market_updates');
  const [archive,setArchive]=useState(EMPTY_PAGE);
  const [search,setSearch]=useState('');
  const [appliedSearch,setAppliedSearch]=useState('');
  const [filters,setFilters]=useState(INITIAL_FILTERS);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(false);
  const [restoringIds,setRestoringIds]=useState<Set<string>>(()=>new Set());
  const restoringRef=useRef(new Set<string>());

  const load=useCallback(async(page=1,query=appliedSearch,nextFilters=filters)=>{
    setLoading(true);
    try { setArchive(await fetchMarketUpdateArchive({page,pageSize:20,search:query,...nextFilters})); setError(false); }
    catch { setError(true); }
    finally { setLoading(false); }
  },[appliedSearch,filters]);
  useEffect(()=>{void load(1,'',INITIAL_FILTERS);},[]);

  const options=useMemo(()=>({
    sources:[...new Set(archive.items.map(item=>item.source_name))].sort(),
    categories:[...new Set(archive.items.map(item=>item.category))].sort(),
    geographies:[...new Set(archive.items.flatMap(item=>item.geography))].sort(),
    impacts:[...new Set(archive.items.map(item=>item.impact_level))].sort(),
    audiences:[...new Set(archive.items.flatMap(item=>item.audience_tags))].sort(),
  }),[archive.items]);
  const applyFilters=(patch:Partial<Filters>)=>{const next={...filters,...patch};setFilters(next);void load(1,appliedSearch,next);};
  const clearAll=()=>{setSearch('');setAppliedSearch('');setFilters(INITIAL_FILTERS);void load(1,'',INITIAL_FILTERS);};
  const hasFilters=Boolean(appliedSearch)||Object.entries(filters).some(([key,value])=>key!=='sort'&&value!==ALL)||filters.sort!=='archived_desc';
  const restore=async(item:ArchivedMarketUpdate)=>{
    if(restoringRef.current.has(item.id)||!canRestore||!item.id)return;
    restoringRef.current.add(item.id);
    setRestoringIds(current=>new Set(current).add(item.id));
    try { await restoreMarketUpdate(item.id); setArchive(current=>({...current,items:current.items.filter(row=>row.id!==item.id),count:Math.max(0,current.count-1)})); toast.success('News item restored.'); }
    catch { toast.error('Unable to restore this news item. Please try again.'); }
    finally { restoringRef.current.delete(item.id);setRestoringIds(current=>{const next=new Set(current);next.delete(item.id);return next;}); }
  };

  return <main className="mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-6 lg:p-8">
    <header className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <Button variant="ghost" size="sm" asChild className="mb-4"><Link to="/market-updates"><ArrowLeft className="mr-2 h-4 w-4" aria-hidden/>Market News Feed</Link></Button>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Archive className="h-5 w-5 text-primary" aria-hidden/><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Archived News</h1></div><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Archived articles are removed from the active feed but remain available here and can be restored.</p></div><Badge variant="secondary" aria-label={`${archive.count} archived articles`}>{archive.count} archived</Badge></div>
    </header>

    <Card className="p-4">
      <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={event=>{event.preventDefault();const next=search.trim();setAppliedSearch(next);void load(1,next);}}>
        <div className="relative md:col-span-2"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden/><Input value={search} onChange={event=>setSearch(event.target.value)} className="pl-9" placeholder="Search title, summary or source…" aria-label="Search archived news"/></div>
        <Filter label="Source" value={filters.source} values={options.sources} onChange={value=>applyFilters({source:value})}/>
        <Filter label="Category" value={filters.category} values={options.categories} onChange={value=>applyFilters({category:value})}/>
        <Filter label="Geography" value={filters.geography} values={options.geographies} onChange={value=>applyFilters({geography:value})}/>
        <Filter label="Impact" value={filters.impact} values={options.impacts} onChange={value=>applyFilters({impact:value})}/>
        <Filter label="Audience" value={filters.audience} values={options.audiences} onChange={value=>applyFilters({audience:value})}/>
        <Select value={filters.sort} onValueChange={value=>applyFilters({sort:value as Filters['sort']})}><SelectTrigger aria-label="Sort archived news"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="archived_desc">Recently archived</SelectItem><SelectItem value="published_desc">Newest publication</SelectItem></SelectContent></Select>
        <div className="flex flex-wrap gap-2 xl:col-span-4"><Button type="submit" disabled={loading}>Search</Button><Button type="button" variant="ghost" onClick={clearAll} disabled={!hasFilters||loading}>Clear All</Button></div>
      </form>
    </Card>

    {error&&<Card role="alert" className="p-6"><p className="font-semibold text-destructive">Archived News could not be loaded.</p><p className="mt-1 text-sm text-muted-foreground">Please retry the secure archive request.</p><Button className="mt-4" variant="outline" onClick={()=>void load(archive.page)}>Retry</Button></Card>}
    {loading&&archive.items.length===0&&<div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground" aria-live="polite"><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Loading archived news…</div>}
    {!loading&&!error&&archive.items.length===0&&<Card className="flex min-h-64 flex-col items-center justify-center border-dashed p-8 text-center"><Archive className="h-9 w-9 text-muted-foreground" aria-hidden/><h2 className="mt-3 font-semibold">{hasFilters?'No archived articles match your current filters.':'No archived articles'}</h2><p className="mt-1 text-sm text-muted-foreground">{hasFilters?'Clear the filters to see all archived news.':'Articles archived from the Market News Feed will appear here.'}</p><Button className="mt-4" variant="outline" asChild><Link to="/market-updates">Return to Market News Feed</Link></Button></Card>}
    <div className="space-y-4">{archive.items.map(item=><ArchivedCard key={item.id} item={item} canRestore={canRestore} restoring={restoringIds.has(item.id)} onRestore={event=>{event.preventDefault();event.stopPropagation();void restore(item);}}/>)}</div>
    {archive.count>archive.pageSize&&<nav className="flex items-center justify-between" aria-label="Archived news pagination"><Button variant="outline" onClick={()=>void load(archive.page-1)} disabled={loading||archive.page<=1}>Previous</Button><span className="text-sm text-muted-foreground">Page {archive.page} of {Math.ceil(archive.count/archive.pageSize)}</span><Button variant="outline" onClick={()=>void load(archive.page+1)} disabled={loading||!archive.hasMore}>Next</Button></nav>}
  </main>;
}

function Filter({label,value,values,onChange}:{label:string;value:string;values:string[];onChange:(value:string)=>void}) { return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={`Filter archived news by ${label.toLowerCase()}`}><SelectValue placeholder={label}/></SelectTrigger><SelectContent><SelectItem value={ALL}>All {label}</SelectItem>{values.map(option=><SelectItem key={option} value={option}>{titleCase(option)}</SelectItem>)}</SelectContent></Select>; }

function ArchivedCard({item,canRestore,restoring,onRestore}:{item:ArchivedMarketUpdate;canRestore:boolean;restoring:boolean;onRestore:(event:MouseEvent<HTMLButtonElement>)=>void}) { return <article className="rounded-xl border border-border bg-card p-5"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">Archived {dateLabel(item.archived_at)}</Badge><Badge variant="secondary">{titleCase(item.category)}</Badge><Badge variant="outline">{titleCase(item.impact_level)} impact</Badge>{item.geography.slice(0,2).map(value=><Badge key={value} variant="secondary">{value}</Badge>)}</div><h2 className="mt-3 text-lg font-semibold leading-snug">{item.title}</h2><p className="mt-1 text-xs text-muted-foreground">{item.source_name} · Published {dateLabel(item.source_published_at??item.ingested_at)}</p>{item.ai_summary&&<p className="mt-3 text-sm leading-relaxed">{item.ai_summary}</p>}{item.why_it_matters&&<div className="mt-3 rounded-lg border-l-2 border-primary/60 bg-primary/5 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-primary">Why it matters</p><p className="mt-1 text-sm">{item.why_it_matters}</p></div>}{item.property_implications&&<div className="mt-3 rounded-lg border-l-2 border-info/60 bg-info/5 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-info">Property impact</p><p className="mt-1 text-sm">{item.property_implications}</p></div>}<div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3"><Button size="default" className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20" variant="outline" asChild><a href={item.source_url} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" aria-hidden/>Open original source</a></Button>{item.ai_summary&&<Badge variant="outline" className="gap-1"><Sparkles className="h-3 w-3" aria-hidden/>Analysis retained</Badge>}{canRestore&&<Button type="button" size="sm" className="ml-auto" onClick={onRestore} disabled={restoring||!item.id} aria-label={`Restore ${item.title}`}>{restoring?<Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden/>:<RotateCcw className="mr-2 h-4 w-4" aria-hidden/>}{restoring?'Restoring…':'Restore'}</Button>}</div></article>; }
