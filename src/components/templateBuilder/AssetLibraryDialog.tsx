/**
 * AssetLibraryDialog — image picker for the template editor.
 *
 * Sources surfaced:
 *   1. Brand kit logos (primary / secondary / mark) from `useBrandKits`.
 *   2. Recent uploads (per-browser, persisted in localStorage so designers can
 *      re-grab the same image across sessions without re-uploading).
 *   3. Ad-hoc upload — pushed to the `report-templates` bucket via
 *      `secureStorageUpload`, becomes a public URL and is auto-added to
 *      recents.
 *
 * On `Insert` the dialog hands back `{ src, width, height }` (image natural
 * dimensions, capped at half the page width) so the parent can splice a fresh
 * `ImageOverlay` into the active page at its centre.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Upload, Loader2, Trash2, Link as LinkIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { secureStorageUpload } from '@/hooks/useSecureStorage';
import { useBrandKits } from '@/hooks/useBrandKits';

const RECENTS_KEY = 'tplb.asset-library.recents.v1';
const MAX_RECENTS = 24;

interface RecentAsset {
  url: string;
  label?: string;
  width?: number;
  height?: number;
  addedAt: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId?: string;
  pageWidth: number;
  pageHeight: number;
  onInsert: (asset: { src: string; width: number; height: number }) => void;
}

const loadRecents = (): RecentAsset[] => {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch { return []; }
};
const saveRecents = (list: RecentAsset[]) => {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS))); } catch { /* noop */ }
};

const readDims = (url: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 320, height: 240 });
    img.src = url;
  });

export function AssetLibraryDialog({ open, onOpenChange, templateId, pageWidth, pageHeight, onInsert }: Props) {
  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL ?? '';
  const { kits, loading: kitsLoading } = useBrandKits();
  const [recents, setRecents] = useState<RecentAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [urlField, setUrlField] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (open) setRecents(loadRecents()); }, [open]);

  const brandLogos = useMemo(() => {
    const out: Array<{ url: string; label: string; kit: string }> = [];
    for (const k of kits) {
      if (k.logo_primary_url)   out.push({ url: k.logo_primary_url,   label: 'Primary',   kit: k.name });
      if (k.logo_secondary_url) out.push({ url: k.logo_secondary_url, label: 'Secondary', kit: k.name });
      if (k.logo_mark_url)      out.push({ url: k.logo_mark_url,      label: 'Mark',      kit: k.name });
    }
    return out;
  }, [kits]);

  const insert = useCallback(async (url: string, label?: string) => {
    if (!url) return;
    const dims = await readDims(url);
    const maxW = Math.round(pageWidth * 0.5);
    const ratio = dims.width / Math.max(dims.height, 1);
    const width = Math.min(dims.width, maxW);
    const height = Math.round(width / ratio);
    onInsert({ src: url, width, height });
    // Update recents
    const next: RecentAsset[] = [
      { url, label, width: dims.width, height: dims.height, addedAt: Date.now() },
      ...recents.filter((r) => r.url !== url),
    ];
    setRecents(next);
    saveRecents(next);
    onOpenChange(false);
  }, [onInsert, onOpenChange, pageWidth, recents]);

  const onUpload = useCallback(async (file: File) => {
    if (!/^image\//.test(file.type)) {
      toast.error('Only image files are supported');
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const folder = templateId ?? 'asset-library';
      const path = `${folder}/lib-${Date.now()}.${ext}`;
      const result = await secureStorageUpload('report-templates', path, file, {
        resourceId: templateId,
        contentType: file.type,
        upsert: true,
      });
      if (!result.success) {
        toast.error(`Upload failed: ${result.error ?? 'unknown error'}`);
        return;
      }
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/report-templates/${result.path ?? path}`;
      toast.success('Uploaded · inserting…');
      await insert(publicUrl, file.name);
    } finally {
      setBusy(false);
    }
  }, [templateId, supabaseUrl, insert]);

  const removeRecent = (url: string) => {
    const next = recents.filter((r) => r.url !== url);
    setRecents(next); saveRecents(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" /> Asset library
          </DialogTitle>
          <DialogDescription>
            Insert an image at the centre of the active page ({Math.round(pageWidth)}×{Math.round(pageHeight)}pt).
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="brand">
          <TabsList>
            <TabsTrigger value="brand">Brand kits ({brandLogos.length})</TabsTrigger>
            <TabsTrigger value="recent">Recents ({recents.length})</TabsTrigger>
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="url">From URL</TabsTrigger>
          </TabsList>

          <TabsContent value="brand" className="mt-3">
            <ScrollArea className="h-72 rounded-md border bg-muted/20 p-2">
              {kitsLoading ? (
                <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading brand kits…
                </div>
              ) : brandLogos.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">
                  No brand-kit logos found. Add them in the <span className="font-medium">Brand kit</span> tab.
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {brandLogos.map((b, i) => (
                    <AssetTile
                      key={`b-${i}-${b.url}`}
                      url={b.url}
                      caption={`${b.kit} · ${b.label}`}
                      onInsert={() => void insert(b.url, b.label)}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="recent" className="mt-3">
            <ScrollArea className="h-72 rounded-md border bg-muted/20 p-2">
              {recents.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">
                  Nothing here yet — upload or pick a brand asset and it'll show up here next time.
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {recents.map((r) => (
                    <AssetTile
                      key={r.url}
                      url={r.url}
                      caption={r.label ?? new URL(r.url).pathname.split('/').pop()}
                      onInsert={() => void insert(r.url, r.label)}
                      onRemove={() => removeRecent(r.url)}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="upload" className="mt-3 space-y-3">
            <Label className="text-xs">Upload from your computer</Label>
            <div
              className="rounded-md border-2 border-dashed border-input bg-muted/10 p-8 text-center"
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void onUpload(file);
              }}
              onDragOver={(e) => e.preventDefault()}
            >
              <Upload className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Drop an image here, or</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                {busy ? ' Uploading…' : ' Choose file'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUpload(f);
                  e.currentTarget.value = '';
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              PNG, JPG, SVG, or WebP. Uploaded files are stored publicly on the <code>report-templates</code> bucket
              and re-usable across templates.
            </p>
          </TabsContent>

          <TabsContent value="url" className="mt-3 space-y-3">
            <Label className="text-xs">Paste an image URL</Label>
            <div className="flex gap-2">
              <Input
                value={urlField}
                onChange={(e) => setUrlField(e.target.value)}
                placeholder="https://…/image.png"
              />
              <Button
                size="sm"
                disabled={!urlField || busy}
                onClick={() => void insert(urlField.trim())}
              >
                <LinkIcon className="h-3 w-3 mr-1" /> Insert
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Must be an absolute URL the renderer can fetch (CORS-permissive or whitelisted host).
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function AssetTile({
  url, caption, onInsert, onRemove,
}: { url: string; caption?: string; onInsert: () => void; onRemove?: () => void }) {
  return (
    <div className="group relative overflow-hidden rounded-md border bg-background">
      <button
        type="button"
        onClick={onInsert}
        className="block aspect-square w-full bg-[conic-gradient(at_50%_50%,_#f5f5f5_0deg,_#fafafa_90deg,_#f5f5f5_180deg,_#fafafa_270deg)]"
        title="Insert at page centre"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={caption ?? ''}
          className="h-full w-full object-contain p-2 transition-transform group-hover:scale-105"
          loading="lazy"
        />
      </button>
      {caption && (
        <div className="truncate border-t bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground" title={caption}>
          {caption}
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label="Remove from recents"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute right-1 top-1 rounded bg-background/90 p-1 opacity-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
