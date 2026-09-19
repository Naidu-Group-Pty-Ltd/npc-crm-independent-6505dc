import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ArrowRight, Loader2, Database } from 'lucide-react';

type AssetClass = 'residential' | 'commercial' | 'industrial';

interface PropertyList {
  residential: any[];
  commercial: any[];
  industrial: any[];
}

export default function ReclassifyPropertyAdmin() {
  const [clientId, setClientId] = useState('');
  const [list, setList] = useState<PropertyList | null>(null);
  const [source, setSource] = useState<AssetClass>('residential');
  const [target, setTarget] = useState<AssetClass>('commercial');
  const [propertyId, setPropertyId] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const invoke = async (body: any) => {
    const { data, error } = await supabase.functions.invoke('reclassify-property', { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const handleLoad = async () => {
    if (!clientId) return toast.error('Enter a client_id');
    setBusy(true);
    try {
      const data = await invoke({ action: 'list', clientId });
      setList(data);
      toast.success(`Loaded ${data.residential.length + data.commercial.length + data.industrial.length} properties`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const handlePreview = async () => {
    if (!propertyId) return toast.error('Pick a property');
    setBusy(true);
    try {
      const data = await invoke({ action: 'preview', source, target, propertyId });
      setPreview(data);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const handleExecute = async () => {
    if (!preview) return toast.error('Preview first');
    if (!confirm(`Move property from ${source} → ${target}? Source row will be deleted.`)) return;
    setBusy(true);
    try {
      const data = await invoke({ action: 'execute', source, target, propertyId });
      toast.success(`Migrated — new id ${data.newId?.slice(0, 8)}…`);
      setPreview(null); setPropertyId('');
      await handleLoad();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const rows = list?.[source] ?? [];

  return (
    <div className="container max-w-5xl py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Database className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Reclassify Property</h1>
          <p className="text-sm text-muted-foreground">Move a property between residential, commercial and industrial tables. Superadmin only — every action is audit-logged in <code>property_reclassification_log</code>.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Load client portfolio</CardTitle>
          <CardDescription>Paste a client UUID to list its properties across all three asset classes.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="client_id (UUID)" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <Button onClick={handleLoad} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}</Button>
        </CardContent>
      </Card>

      {list && (
        <Card>
          <CardHeader>
            <CardTitle>2. Choose source → target</CardTitle>
            <CardDescription>
              <Badge variant="outline" className="mr-1">R: {list.residential.length}</Badge>
              <Badge variant="outline" className="mr-1">C: {list.commercial.length}</Badge>
              <Badge variant="outline">I: {list.industrial.length}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
              <div>
                <Label>Source</Label>
                <Select value={source} onValueChange={(v) => { setSource(v as AssetClass); setPropertyId(''); setPreview(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="residential">Residential</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="industrial">Industrial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground mb-2" />
              <div>
                <Label>Target</Label>
                <Select value={target} onValueChange={(v) => { setTarget(v as AssetClass); setPreview(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="residential" disabled={source === 'residential'}>Residential</SelectItem>
                    <SelectItem value="commercial" disabled={source === 'commercial'}>Commercial</SelectItem>
                    <SelectItem value="industrial" disabled={source === 'industrial'}>Industrial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Property</Label>
              <Select value={propertyId || '__none__'} onValueChange={(v) => { setPropertyId(v === '__none__' ? '' : v); setPreview(null); }}>
                <SelectTrigger><SelectValue placeholder="Select source property" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" disabled>Select a property</SelectItem>
                  {rows.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {(r.address || r.property_name || r.street || r.id).toString().slice(0, 80)} — {r.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handlePreview} disabled={busy || !propertyId}>Preview mapping</Button>
              <Button onClick={handleExecute} disabled={busy || !preview} variant="destructive">Execute migration</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>3. Preview</CardTitle>
            <CardDescription>Fields below will be inserted into <code>{target}</code>. Unmapped fields stay on the source snapshot in the audit log.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-96">{JSON.stringify(preview.payload, null, 2)}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
