import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { advPanelHeader, advSurface } from './advancedTheme';

export const premiumSectionClass = advSurface;

export function AdvancedSectionHeader({ icon: Icon, title, description, trailing, className }: { icon: LucideIcon; title: string; description?: string; trailing?: React.ReactNode; className?: string }) {
  return <header className={cn('flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5', advPanelHeader, className)}><div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand-300/25 bg-primary/10 text-brand-200"><Icon className="h-4 w-4" aria-hidden="true"/></span><div className="min-w-0"><h3 className="text-[15px] font-semibold leading-5 tracking-tight text-foreground">{title}</h3>{description&&<p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>}</div></div>{trailing}</header>;
}

