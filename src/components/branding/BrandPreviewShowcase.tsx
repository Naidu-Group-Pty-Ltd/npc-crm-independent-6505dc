import type { CSSProperties } from 'react';
import { LayoutPanelLeft, Globe, Shield } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import type { BrandConfig, BrandTokenMap } from '@/branding/brand-types';
import { resolveBrandTokens } from '@/branding/token-resolver';
import { getBrandAssetSrc } from '@/branding/brand-assets';
import { BrandFavicon, BrandLogo, BrandMark } from './BrandAssets';

interface BrandPreviewShowcaseProps {
  settings: BrandConfig;
}

function tokenStyle(tokenMap: BrandTokenMap): CSSProperties {
  return tokenMap as CSSProperties;
}

export function BrandPreviewShowcase({ settings }: BrandPreviewShowcaseProps) {
  const tokens = resolveBrandTokens(settings);
  const faviconSrc = getBrandAssetSrc(settings, 'favicon');

  return (
    <Tabs defaultValue="dashboard-light" className="min-w-0 space-y-5">
      <TabsList className="grid h-auto w-full min-w-0 grid-cols-2 gap-2 rounded-[1.35rem] border border-border/70 bg-background/70 p-1.5 shadow-inner shadow-background/10 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ['dashboard-light', 'Dashboard Light'],
          ['dashboard-dark', 'Dashboard Dark'],
          ['client', 'Client Portal'],
          ['finance', 'Finance Portal'],
          ['browser', 'Browser Identity'],
          ['email', 'Email Signature'],
        ].map(([surface, label]) => (
          <TabsTrigger
            key={surface}
            className="min-w-0 rounded-2xl px-3 py-2.5 text-xs font-semibold capitalize text-muted-foreground transition-all hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 data-[state=active]:border data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/25 sm:text-sm"
            value={surface}
          >
            <span className="block min-w-0 truncate">{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="dashboard-light" className="space-y-4">
        <div style={tokenStyle(tokens.light)} className="min-w-0 overflow-hidden rounded-[2rem] border border-border/70 bg-[radial-gradient(circle_at_20%_0%,hsl(var(--dashboard-primary-soft)/0.62),transparent_30%),radial-gradient(circle_at_90%_20%,hsl(var(--primary)/0.12),transparent_26%),linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--dashboard-surface-elevated))_48%,hsl(var(--dashboard-surface-muted))_100%)] p-3 shadow-2xl shadow-background/15 ring-1 ring-primary/10 sm:p-4">
          <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Dashboard Light</p>
              <p className="mt-1 break-words text-xs text-muted-foreground">Luxury light shell preview generated from the current draft tokens.</p>
            </div>
            <Badge className="w-fit shrink-0 rounded-full border border-primary/30 bg-primary px-3 py-1 text-primary-foreground shadow-md shadow-primary/25">Primary active state</Badge>
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="min-w-0 overflow-hidden rounded-[1.75rem] border border-sidebar-border/70 bg-[linear-gradient(180deg,hsl(var(--dashboard-surface)/0.96),hsl(var(--sidebar-surface)/0.96))] p-4 text-sidebar-foreground shadow-[18px_0_42px_hsl(35_43%_20%/0.10)] ring-1 ring-primary/5">
              <div className="flex min-w-0 items-center gap-3 border-b border-sidebar-border/70 pb-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-sidebar-border/60 bg-sidebar-accent/10 p-1 shadow-inner">
                  <BrandLogo settings={settings} slot="sidebar" className="max-h-10 max-w-[120px] object-contain" fallbackClassName="h-10 w-10" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{settings.companyName}</p>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/65">Internal dashboard</p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {['Overview', 'Clients', 'Reports', 'Automation'].map((item, index) => (
                  <div
                    key={item}
                    className={`flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-2.5 text-sm transition-colors ${index === 0 ? 'border-primary/35 bg-primary text-primary-foreground shadow-lg shadow-primary/25' : 'border-transparent bg-sidebar-accent/10 text-sidebar-foreground/80'}`}
                  >
                    <LayoutPanelLeft className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item}</span>
                  </div>
                ))}
              </div>
            </aside>

            <section className="min-w-0 overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/95 shadow-[0_18px_44px_hsl(35_43%_20%/0.10)] ring-1 ring-primary/5">
              <div className="flex min-w-0 flex-col gap-3 border-b border-border/70 bg-[rgba(255,252,247,0.82)] px-4 py-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Executive workspace</p>
                  <p className="break-words text-xs text-muted-foreground">Porcelain topbar, champagne surfaces, and antique-gold actions.</p>
                </div>
                <div className="flex min-w-0 flex-wrap gap-2">
                  <span className="rounded-full border border-success/25 bg-success-light px-3 py-1.5 text-xs font-semibold text-success">Ready</span>
                  <span className="rounded-full border border-warning/25 bg-warning-light px-3 py-1.5 text-xs font-semibold text-warning">Review</span>
                  <span className="rounded-full border border-info/25 bg-info-light px-3 py-1.5 text-xs font-semibold text-info">Synced</span>
                </div>
              </div>

              <div className="grid gap-4 p-4 md:grid-cols-3">
                {['Pipeline health', 'Client momentum', 'Report velocity'].map((item, index) => (
                  <div key={item} className="min-w-0 rounded-2xl border border-border/70 bg-[linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--dashboard-surface-elevated))_100%)] px-4 py-3 shadow-[0_12px_30px_hsl(35_43%_20%/0.08)]">
                    <p className="truncate text-xs uppercase tracking-[0.18em] text-muted-foreground">{item}</p>
                    <p className="mt-3 text-2xl font-semibold text-foreground">{['82%', '14', '36h'][index]}</p>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">Luxury light card, border, and elevation token preview.</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 border-t border-border/60 bg-muted/20 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="min-w-0 rounded-2xl border border-primary/40 bg-background/85 px-3 py-2 text-sm text-muted-foreground shadow-inner ring-2 ring-primary/20">
                  Focused search / input preview with gold focus ring
                </div>
                <div className="flex min-w-0 flex-wrap gap-2">
                  <button className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 ring-1 ring-primary/30">Primary action</button>
                  <button className="rounded-xl border border-border bg-background/80 px-4 py-2 text-sm font-semibold text-foreground shadow-sm">Secondary</button>
                  <button className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary shadow-sm shadow-primary/10">Soft accent</button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </TabsContent>


      <TabsContent value="dashboard-dark" className="space-y-4">
        <div style={tokenStyle(tokens.dark)} className="grid min-w-0 gap-4 overflow-hidden rounded-[1.75rem] border border-border/60 bg-background p-4 shadow-2xl shadow-background/15 md:grid-cols-[260px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-sidebar-border/70 bg-sidebar p-4 text-sidebar-foreground">
            <p className="text-xs uppercase tracking-[0.18em] text-sidebar-foreground/60">Dark dashboard</p>
            <div className="mt-4 rounded-xl bg-sidebar-primary px-3 py-2 text-sm font-semibold text-sidebar-primary-foreground">Active navigation</div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-card p-4">
            <p className="font-semibold text-foreground">Dark mode reference</p>
            <p className="mt-2 text-sm text-muted-foreground">Dark tokens remain available for comparison and are not changed by the luxury light-mode refresh.</p>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="client">
        <div style={tokenStyle(tokens.light)} className="min-w-0 overflow-hidden rounded-[1.75rem] border border-border/60 bg-background p-3 shadow-2xl shadow-background/15 sm:p-4">
          <div className="min-w-0 rounded-[28px] border border-border/70 bg-card/95 p-4 shadow-xl ring-1 ring-primary/5">
            <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/60 pb-4">
              <div className="flex min-w-0 items-center gap-3">
                <BrandLogo settings={settings} slot="auth" className="h-10 max-w-[180px] shrink-0 object-contain" fallbackClassName="h-10 w-10 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{settings.companyName}</p>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Client portal</p>
                </div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Shield className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="min-w-0 rounded-2xl border border-primary/20 bg-primary/10 p-4 shadow-sm">
                <p className="text-sm font-semibold text-foreground">Deal Progress</p>
                <p className="mt-1 text-sm text-muted-foreground">Portal hero, card, and active navigation emphasis preview.</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm">
                <p className="text-sm font-semibold text-foreground">Secure Documents</p>
                <p className="mt-1 text-sm text-muted-foreground">See how client-facing surfaces inherit your chosen palette.</p>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="finance">
        <div style={tokenStyle(tokens.light)} className="min-w-0 overflow-hidden rounded-[1.75rem] border border-border/60 bg-background p-3 shadow-2xl shadow-background/15 sm:p-4">
          <div className="min-w-0 rounded-[28px] border border-border/70 bg-card/95 p-5 shadow-xl ring-1 ring-primary/5">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-3">
                  <BrandLogo settings={settings} slot="auth" className="h-10 max-w-[180px] shrink-0 object-contain" fallbackClassName="h-10 w-10 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">Finance Portal</p>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Partner access</p>
                  </div>
                </div>
                <p className="mt-4 max-w-md break-words text-sm text-muted-foreground">Previewing partner-facing auth and shell surfaces with your current brand tokens.</p>
              </div>
              <button className="w-fit max-w-full shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 ring-1 ring-primary/30"><span className="block truncate">Primary action</span></button>
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="browser">
        <div style={tokenStyle(tokens.light)} className="min-w-0 rounded-[1.75rem] border border-border/60 bg-card p-3 shadow-xl shadow-background/10 ring-1 ring-primary/5 sm:p-4">
          <div className="min-w-0 rounded-2xl border border-border/60 bg-background p-4">
            <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-border/60 bg-muted/30 px-3 py-2 shadow-inner">
               {faviconSrc ? <BrandFavicon settings={settings} alt={`${settings.companyName} favicon`} /> : (
                 <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                   <Globe className="h-4 w-4" />
                 </div>
               )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{settings.companyName} Dashboard</p>
                <p className="truncate text-xs text-muted-foreground">Browser tab + favicon auto-fill preview</p>
              </div>
            </div>
            <div className="mt-4 min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
               <div className="mb-2"><BrandMark settings={settings} slot="sidebar-icon" className="h-4 w-4 object-contain" fallbackClassName="h-4 w-4 rounded" /></div>
              The favicon slot falls back to your sidebar icon or primary logo if a dedicated favicon has not been uploaded yet.
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="email">
        <div style={tokenStyle(tokens.light)} className="min-w-0 rounded-[1.75rem] border border-border/60 bg-card p-4 shadow-xl shadow-background/10 ring-1 ring-primary/5">
          <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Email signature</p>
            <p className="mt-2 font-semibold text-foreground">{settings.emailSignature?.name || settings.companyName}</p>
            <p className="text-sm text-muted-foreground">{settings.emailSignature?.title || 'Property advisory team'}</p>
            <div className="mt-4 rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm text-foreground">Champagne banner, brand logo, and contact details inherit saved brand tokens.</div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}
