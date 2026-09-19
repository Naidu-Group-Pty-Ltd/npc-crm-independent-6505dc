/**
 * Phase 4 — Advanced inspector panels (style, visibility, repeat, alignment).
 * Drop-in sections used by PropertiesInspector below the per-block field editor.
 */
import { useMemo } from 'react';
import { AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignStartVertical, AlignCenterVertical, AlignEndVertical, Lock, Unlock, Eye, EyeOff } from 'lucide-react';
import type { Block, Page } from '@/lib/reportTemplate/templateSchema';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { SpacingBox } from './SpacingBox';
import { CornerRadiusBox } from './CornerRadiusBox';
import { ShadowStudio, type ShadowPreset } from './ShadowStudio';

type StyleObj = NonNullable<Block['style']>;
type RepeatObj = NonNullable<Block['repeat']>;
type VisibilityObj = NonNullable<Block['visibility']>;

const SHADOW_OPTS = ['none', 'sm', 'md', 'lg', 'xl'] as const;
const BORDER_STYLES = ['solid', 'dashed', 'dotted'] as const;

function numOr(v: unknown, fb: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h4>
  );
}

function MiniNum({ label, value, onChange, min = 0, max = 999 }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        onChange={(e) => onChange(numOr(e.target.value, 0))}
        className="h-7 text-xs px-2"
      />
    </label>
  );
}

function ColorBox({ value, onChange, placeholder = 'transparent' }: { value?: string; onChange: (v: string | undefined) => void; placeholder?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? (value as string) : '#cccccc'}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-8 cursor-pointer rounded border bg-card"
      />
      <Input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder={placeholder}
        className="h-7 text-xs font-mono px-2"
      />
      {value ? (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => onChange(undefined)}>Clear</Button>
      ) : null}
    </div>
  );
}

// ─── Appearance + layout ────────────────────────────────────────────────────
export function BlockStylePanel({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const s: StyleObj = (block.style ?? {}) as StyleObj;
  const update = (patch: Partial<StyleObj>) => {
    const next: StyleObj = { ...s, ...patch };
    // strip empty values to keep schema tidy
    Object.keys(next).forEach((k) => {
      const v = (next as any)[k];
      if (v === '' || v == null) delete (next as any)[k];
    });
    onChange({ ...block, style: Object.keys(next).length ? next : undefined });
  };

  return (
    <div className="space-y-3">
      <SectionHeading>Appearance</SectionHeading>

      <div className="space-y-1">
        <Label className="text-[11px]">Background</Label>
        <ColorBox value={s.backgroundColor} onChange={(v) => update({ backgroundColor: v })} placeholder="token:bg or #hex" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-1">
          <Label className="text-[11px]">Border</Label>
          <ColorBox value={s.borderColor} onChange={(v) => update({ borderColor: v })} />
        </div>
        <MiniNum label="Width (pt)" value={numOr(s.borderWidth, 0)} onChange={(n) => update({ borderWidth: n || undefined })} min={0} max={8} />
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">Border style</Label>
        <Select value={s.borderStyle ?? 'solid'} onValueChange={(v) => update({ borderStyle: v as any })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{BORDER_STYLES.map((o) => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <CornerRadiusBox
        value={numOr(s.borderRadius, 0)}
        onChange={(n) => update({ borderRadius: n || undefined })}
        max={48}
      />

      <ShadowStudio
        value={(s.shadow as ShadowPreset) ?? 'none'}
        onChange={(v) => update({ shadow: v })}
      />

      <Separator />
      <SpacingBox
        label="Padding (backdrop)"
        value={{ top: s.paddingTop, right: s.paddingRight, bottom: s.paddingBottom, left: s.paddingLeft }}
        onChange={(p) => update({
          paddingTop: p.top, paddingRight: p.right, paddingBottom: p.bottom, paddingLeft: p.left,
        })}
        max={96}
      />

      <Separator />
      <SectionHeading>Transform</SectionHeading>
      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-[11px]">Opacity</Label>
            <span className="text-[10px] text-muted-foreground">{Math.round((s.opacity ?? 1) * 100)}%</span>
          </div>
          <Slider value={[Math.round((s.opacity ?? 1) * 100)]} min={0} max={100} step={1} onValueChange={([v]) => update({ opacity: v / 100 })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniNum label="Rotation (°)" value={numOr(s.rotation, 0)} onChange={(n) => update({ rotation: n || undefined })} min={-360} max={360} />
          <MiniNum label="z-index" value={numOr(s.zIndex, 0)} onChange={(n) => update({ zIndex: n || undefined })} min={-100} max={100} />
        </div>
      </div>
    </div>
  );
}

// ─── Visibility ─────────────────────────────────────────────────────────────
export function BlockVisibilityPanel({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const v: VisibilityObj = (block.visibility ?? { mode: 'always' }) as VisibilityObj;
  const update = (patch: Partial<VisibilityObj>) => onChange({ ...block, visibility: { ...v, ...patch } });

  return (
    <div className="space-y-3">
      <SectionHeading>Visibility</SectionHeading>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {block.locked ? <Lock className="h-3.5 w-3.5 text-brand-500" /> : <Unlock className="h-3.5 w-3.5 text-muted-foreground" />}
          <Label className="text-xs">Lock (editor only)</Label>
        </div>
        <Switch checked={!!block.locked} onCheckedChange={(c) => onChange({ ...block, locked: c || undefined })} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {block.hidden ? <EyeOff className="h-3.5 w-3.5 text-destructive" /> : <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
          <Label className="text-xs">Hide from output</Label>
        </div>
        <Switch checked={!!block.hidden} onCheckedChange={(c) => onChange({ ...block, hidden: c || undefined })} />
      </div>

      <Separator />

      <div className="space-y-1">
        <Label className="text-[11px]">Rule</Label>
        <Select value={v.mode ?? 'always'} onValueChange={(m) => update({ mode: m as any })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="always" className="text-xs">Always show</SelectItem>
            <SelectItem value="when" className="text-xs">Show when…</SelectItem>
            <SelectItem value="unless" className="text-xs">Hide when…</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {v.mode !== 'always' && (
        <div className="space-y-1">
          <Label className="text-[11px]">Expression</Label>
          <Input
            value={v.expr ?? ''}
            placeholder="e.g. tier === 'compass'"
            onChange={(e) => update({ expr: e.target.value || undefined })}
            className="text-xs font-mono h-7"
          />
          <p className="text-[10px] text-muted-foreground">Supports comparisons (===, !==, &gt;, &lt;), &amp;&amp; / ||, and data paths.</p>
        </div>
      )}
    </div>
  );
}

// ─── Repeat from binding ────────────────────────────────────────────────────
export function BlockRepeatPanel({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const r: RepeatObj = (block.repeat ?? { path: '' }) as RepeatObj;
  const enabled = !!block.repeat?.path;
  const update = (patch: Partial<RepeatObj>) => onChange({ ...block, repeat: { ...r, ...patch } });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionHeading>Repeat from data</SectionHeading>
        <Switch
          checked={enabled}
          onCheckedChange={(c) => onChange({ ...block, repeat: c ? { path: r.path || 'items', alias: r.alias || 'item', spacing: r.spacing ?? 0 } : undefined })}
        />
      </div>

      {enabled && (
        <>
          <div className="space-y-1">
            <Label className="text-[11px]">Data path</Label>
            <Input value={r.path} onChange={(e) => update({ path: e.target.value })} placeholder="properties" className="h-7 text-xs font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Alias</Label>
              <Input value={r.alias ?? 'item'} onChange={(e) => update({ alias: e.target.value })} placeholder="item" className="h-7 text-xs font-mono" />
            </div>
            <MiniNum label="Max" value={numOr(r.max, 0)} onChange={(n) => update({ max: n || undefined })} min={1} max={50} />
          </div>
          <MiniNum label="Vertical spacing (pt)" value={numOr(r.spacing, 0)} onChange={(n) => update({ spacing: n || undefined })} min={0} max={400} />
          <p className="text-[10px] text-muted-foreground">
            Inside the repeated block, reference each item via{' '}
            <code className="font-mono">{`{{${r.alias || 'item'}.field}}`}</code>.
          </p>
        </>
      )}
    </div>
  );
}

// ─── Align / distribute (vs current page) ───────────────────────────────────
export function BlockAlignmentPanel({ block, page, onChange }: { block: Block; page: Page | null; onChange: (b: Block) => void }) {
  const p = useMemo(() => (block.props ?? {}) as Record<string, any>, [block]);
  if (!page) return null;
  const x = numOr(p.x, 0);
  const y = numOr(p.y, 0);
  const w = numOr(p.width, 200);
  const h = numOr(p.height, 100);
  const pageW = page.size.width;
  const pageH = page.size.height;
  const inset = numOr(page.safeArea ?? 24, 24);
  const set = (patch: Record<string, number>) => onChange({ ...block, props: { ...p, ...patch } });

  return (
    <div className="space-y-3">
      <SectionHeading>Align to page</SectionHeading>
      <div className="grid grid-cols-3 gap-1">
        <Button size="sm" variant="outline" className="h-8 px-0" title="Left" onClick={() => set({ x: inset })}>
          <AlignStartHorizontal className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" className="h-8 px-0" title="Center H" onClick={() => set({ x: Math.round((pageW - w) / 2) })}>
          <AlignCenterHorizontal className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" className="h-8 px-0" title="Right" onClick={() => set({ x: Math.max(0, pageW - w - inset) })}>
          <AlignEndHorizontal className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" className="h-8 px-0" title="Top" onClick={() => set({ y: inset })}>
          <AlignStartVertical className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" className="h-8 px-0" title="Middle V" onClick={() => set({ y: Math.round((pageH - h) / 2) })}>
          <AlignCenterVertical className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" className="h-8 px-0" title="Bottom" onClick={() => set({ y: Math.max(0, pageH - h - inset) })}>
          <AlignEndVertical className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => set({ width: pageW - inset * 2, x: inset })}>
          Fit width
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => set({ x: Math.round(x / 8) * 8, y: Math.round(y / 8) * 8 })}>
          Snap to 8pt
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <MiniNum label="X" value={x} onChange={(n) => set({ x: n })} min={-200} max={2000} />
        <MiniNum label="Y" value={y} onChange={(n) => set({ y: n })} min={-200} max={4000} />
        <MiniNum label="W" value={w} onChange={(n) => set({ width: n })} min={1} max={2000} />
        <MiniNum label="H" value={h} onChange={(n) => set({ height: n })} min={1} max={4000} />
      </div>
    </div>
  );
}

// ─── Phase 8 — Interactions (link + bookmark) ────────────────────────────────
export function BlockInteractionsPanel({
  block, onChange, pages,
}: {
  block: Block;
  onChange: (next: Block) => void;
  pages: Array<{ id: string; name: string }>;
}) {
  const link = (block.link ?? {}) as any;
  const bm = (block.bookmark ?? {}) as any;
  const setLink = (patch: any) => onChange({ ...block, link: patch });
  const setBm = (patch: any) => onChange({ ...block, bookmark: patch });

  const href: string = link?.href ?? '';
  const linkKind: 'none' | 'url' | 'page' | 'anchor' =
    !href ? 'none'
    : href.startsWith('page:') ? 'page'
    : href.startsWith('anchor:') ? 'anchor'
    : 'url';

  return (
    <div className="space-y-3">
      <SectionHeading>Link</SectionHeading>
      <div className="grid grid-cols-3 gap-1.5">
        {(['none','url','page','anchor'] as const).map((k) => (
          <Button
            key={k}
            size="sm" variant={linkKind === k ? 'default' : 'outline'} className="h-7 text-[11px] capitalize"
            onClick={() => {
              if (k === 'none') return onChange({ ...block, link: undefined });
              if (k === 'url') return setLink({ ...link, href: 'https://' });
              if (k === 'page') return setLink({ ...link, href: `page:${pages[0]?.id ?? ''}` });
              return setLink({ ...link, href: 'anchor:' });
            }}
          >
            {k}
          </Button>
        ))}
      </div>

      {linkKind === 'url' && (
        <Input
          value={href}
          onChange={(e) => setLink({ ...link, href: e.target.value })}
          placeholder="https://example.com"
          className="text-xs font-mono"
        />
      )}
      {linkKind === 'page' && (
        <Select
          value={href.slice(5)}
          onValueChange={(v) => setLink({ ...link, href: `page:${v}` })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick page…" /></SelectTrigger>
          <SelectContent>
            {pages.map((p, i) => (
              <SelectItem key={p.id} value={p.id}>{i + 1}. {p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {linkKind === 'anchor' && (
        <Input
          value={href.replace(/^anchor:/, '')}
          onChange={(e) => setLink({ ...link, href: `anchor:${e.target.value}` })}
          placeholder="bookmark-name"
          className="text-xs font-mono"
        />
      )}

      {linkKind !== 'none' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2 text-[11px]">
            <Switch
              checked={link.target === '_blank'}
              onCheckedChange={(v) => setLink({ ...link, target: v ? '_blank' : '_self' })}
            />
            Open in new tab
          </label>
          <Input
            value={link.title ?? ''}
            onChange={(e) => setLink({ ...link, title: e.target.value || undefined })}
            placeholder="Tooltip…"
            className="text-xs"
          />
        </div>
      )}

      <Separator />
      <SectionHeading>Bookmark / Outline</SectionHeading>
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={bm.name ?? ''}
          onChange={(e) => {
            const name = e.target.value;
            if (!name) return onChange({ ...block, bookmark: undefined });
            setBm({ ...bm, name });
          }}
          placeholder="anchor-name"
          className="text-xs font-mono"
        />
        <Input
          value={bm.label ?? ''}
          onChange={(e) => setBm({ ...bm, name: bm.name || e.target.value, label: e.target.value || undefined })}
          placeholder="Display label (TOC)"
          className="text-xs"
          disabled={!bm.name}
        />
      </div>
      {bm.name && (
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={String(bm.level ?? 2)}
            onValueChange={(v) => setBm({ ...bm, level: Number(v) })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1,2,3,4,5,6].map((n) => <SelectItem key={n} value={String(n)}>Level {n}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-[11px]">
            <Switch
              checked={bm.includeInToc !== false}
              onCheckedChange={(v) => setBm({ ...bm, includeInToc: v })}
            />
            Include in TOC
          </label>
        </div>
      )}
    </div>
  );
}
