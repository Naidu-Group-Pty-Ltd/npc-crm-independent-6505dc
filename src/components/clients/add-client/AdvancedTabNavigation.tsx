import { ClipboardList, FileSpreadsheet, FileText, ReceiptText } from 'lucide-react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
export type AdvancedTab = 'excel'|'fact-find'|'expenses'|'output';
const ADVANCED_TABS=[{value:'excel',label:'Excel Import',icon:FileSpreadsheet},{value:'fact-find',label:'Client Fact Find',icon:ClipboardList},{value:'expenses',label:'Living Expenses',icon:ReceiptText},{value:'output',label:'Client Form Output',icon:FileText}] as const;
const STEP_PREFIX=['before:content-[\'01\']','before:content-[\'02\']','before:content-[\'03\']','before:content-[\'04\']'] as const;
export function AdvancedTabNavigation(){return <nav data-testid="advanced-navigation" aria-label="Advanced client workflow" className="relative shrink-0 border-b border-border/50 bg-card/95 px-3 py-3 sm:px-6">
  <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-300/50 to-transparent"/>
  <TabsList aria-label="Advanced client form sections" className="mx-auto grid h-auto w-full max-w-[1400px] grid-cols-2 gap-2 overflow-visible bg-transparent p-0 lg:grid-cols-4">{ADVANCED_TABS.map((tab,index)=>{const Icon=tab.icon;return <TabsTrigger key={tab.value} value={tab.value} aria-label={tab.label} className="group relative min-h-[52px] justify-start gap-3 overflow-hidden rounded-xl border border-border/55 bg-background/45 px-3 text-left text-muted-foreground transition-[background-color,border-color,color,box-shadow] duration-150 hover:border-border hover:bg-background/75 hover:text-foreground motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=active]:border-brand-300/45 data-[state=active]:bg-primary/12 data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_1px_0_hsl(var(--foreground)/0.05)]">
    <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand-300 opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-data-[state=active]:opacity-100"/>
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground transition-colors duration-150 motion-reduce:transition-none group-hover:text-foreground group-data-[state=active]:border-brand-300/40 group-data-[state=active]:bg-primary/15 group-data-[state=active]:text-brand-200"><Icon data-testid={`advanced-tab-icon-${tab.value}`} className="h-4 w-4"/></span>
    <span className="min-w-0 flex-1">
      <span className="block min-w-0 truncate text-xs font-semibold leading-4 text-foreground sm:text-[13px]">{tab.label}</span>
      <span aria-hidden="true" className={`mt-0.5 hidden truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:block before:mr-1.5 before:font-bold before:tabular-nums before:text-brand-200/70 ${STEP_PREFIX[index]}`}/>
    </span>
  </TabsTrigger>})}</TabsList>
</nav>}
