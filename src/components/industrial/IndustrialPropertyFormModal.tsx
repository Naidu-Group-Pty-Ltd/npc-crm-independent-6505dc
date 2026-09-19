import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import { industrialApi, type IndustrialProperty } from '@/hooks/useIndustrialProperties';
import { PropertyImportPanel, type ImportedPropertyData } from '@/components/property-import/PropertyImportPanel';

interface Props {
  open: boolean;
  onClose: () => void;
  property?: IndustrialProperty | null;
  onSaved: () => void;
}

const SUBTYPES = [
  { value: 'warehouse', label: 'Warehouse / Distribution' },
  { value: 'logistics', label: 'Logistics / Fulfilment' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'cold_storage', label: 'Cold Storage' },
  { value: 'flex', label: 'Flex / Industrial Estate' },
  { value: 'data_centre', label: 'Data Centre' },
  { value: 'transport_yard', label: 'Transport / Yard' },
  { value: 'other', label: 'Other' },
];

const STATUS = [
  { value: 'active', label: 'Active' },
  { value: 'on_market', label: 'On Market' },
  { value: 'under_offer', label: 'Under Offer' },
  { value: 'sold', label: 'Sold' },
  { value: 'inactive', label: 'Inactive' },
];

const CONDITION = [
  { value: 'A', label: 'A — Prime' },
  { value: 'B', label: 'B — Good' },
  { value: 'C', label: 'C — Average' },
  { value: 'D', label: 'D — Refurb required' },
];


function normalizeIndustrialSubtype(value: string | undefined, fallback: any) {
  if (!value) return fallback;
  const normalized = value.toLowerCase().replace(/[\s-]+/g, '_');
  const match = SUBTYPES.find(option => option.value === normalized || option.label.toLowerCase().includes(value.toLowerCase()));
  if (match) return match.value;
  if (normalized.includes('logistics') || normalized.includes('fulfil')) return 'logistics';
  if (normalized.includes('manufact')) return 'manufacturing';
  if (normalized.includes('cold')) return 'cold_storage';
  if (normalized.includes('data')) return 'data_centre';
  if (normalized.includes('yard') || normalized.includes('transport')) return 'transport_yard';
  if (normalized.includes('flex')) return 'flex';
  if (normalized.includes('warehouse') || normalized.includes('distribution')) return 'warehouse';
  return fallback;
}

export function IndustrialPropertyFormModal({ open, onClose, property, onSaved }: Props) {
  const isEdit = !!property;
  const initial = useMemo(() => ({
    property_name: property?.property_name ?? '',
    street: property?.street ?? '',
    suburb: property?.suburb ?? '',
    state: property?.state ?? '',
    postcode: property?.postcode ?? '',
    asset_subtype: property?.asset_subtype ?? 'warehouse',
    status: property?.status ?? 'active',
    purchase_price: property?.purchase_price ?? '',
    purchase_date: property?.purchase_date ?? '',
    current_valuation: property?.current_valuation ?? '',
    valuation_date: property?.valuation_date ?? '',
    gla_sqm: property?.gla_sqm ?? '',
    site_area_sqm: property?.site_area_sqm ?? '',
    site_cover_pct: property?.site_cover_pct ?? '',
    office_pct: property?.office_pct ?? '',
    hardstand_sqm: property?.hardstand_sqm ?? '',
    clearance_metres: property?.clearance_metres ?? '',
    power_kva: property?.power_kva ?? '',
    dock_doors: property?.dock_doors ?? '',
    ground_floor_load_kpa: property?.ground_floor_load_kpa ?? '',
    zoning: property?.zoning ?? '',
    year_built: property?.year_built ?? '',
    condition_rating: property?.condition_rating ?? '',
    notes: property?.notes ?? '',
  }), [property]);

  const [form, setForm] = useState<any>(initial);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  const applyImportedData = (data: ImportedPropertyData) => {
    setForm((prev: any) => ({
      ...prev,
      property_name: data.propertyName ?? prev.property_name,
      street: data.address ?? prev.street,
      suburb: data.suburb ?? prev.suburb,
      state: data.state ?? prev.state,
      postcode: data.postcode ?? prev.postcode,
      asset_subtype: normalizeIndustrialSubtype(data.assetSubType || data.assetClass, prev.asset_subtype),
      purchase_price: data.price ?? prev.purchase_price,
      current_valuation: data.valuation ?? prev.current_valuation,
      gla_sqm: data.glaSqm ?? data.nlaSqm ?? data.gfaSqm ?? prev.gla_sqm,
      site_area_sqm: data.siteAreaSqm ?? prev.site_area_sqm,
      site_cover_pct: data.siteCoverPct ?? prev.site_cover_pct,
      office_pct: data.officePct ?? prev.office_pct,
      hardstand_sqm: data.hardstandSqm ?? prev.hardstand_sqm,
      clearance_metres: data.clearanceMetres ?? prev.clearance_metres,
      power_kva: data.powerKva ?? prev.power_kva,
      dock_doors: data.dockDoors ?? prev.dock_doors,
      ground_floor_load_kpa: data.groundFloorLoadKpa ?? prev.ground_floor_load_kpa,
      zoning: data.zoning ?? prev.zoning,
      year_built: data.yearBuilt ?? prev.year_built,
      condition_rating: data.conditionRating ?? prev.condition_rating,
      notes: [prev.notes, data.notes, data.sourceUrl ? `Source: ${data.sourceUrl}` : ''].filter(Boolean).join('\n\n'),
    }));
  };
  const num = (v: any) => v === '' || v == null ? null : Number(v);

  const handleSave = async () => {
    if (!form.street?.trim()) {
      toast({ title: 'Street address required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload: any = {
      ...form,
      purchase_price: num(form.purchase_price),
      current_valuation: num(form.current_valuation),
      gla_sqm: num(form.gla_sqm),
      site_area_sqm: num(form.site_area_sqm),
      site_cover_pct: num(form.site_cover_pct),
      office_pct: num(form.office_pct),
      hardstand_sqm: num(form.hardstand_sqm),
      clearance_metres: num(form.clearance_metres),
      power_kva: num(form.power_kva),
      dock_doors: num(form.dock_doors),
      ground_floor_load_kpa: num(form.ground_floor_load_kpa),
      year_built: num(form.year_built),
      purchase_date: form.purchase_date || null,
      valuation_date: form.valuation_date || null,
      condition_rating: form.condition_rating || null,
    };
    const res = isEdit
      ? await industrialApi.updateProperty(property!.id, payload)
      : await industrialApi.createProperty(payload);
    setSaving(false);
    if (res.error) {
      toast({ title: 'Save failed', description: res.error.message, variant: 'destructive' });
      return;
    }
    toast({ title: isEdit ? 'Property updated' : 'Property created' });
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{isEdit ? 'Edit Industrial Property' : 'New Industrial Property'}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 px-6">
          <div className="grid grid-cols-2 gap-4 py-4">
            <PropertyImportPanel category="industrial" onImported={applyImportedData} />
            <div className="col-span-2 space-y-2">
              <Label>Property Name</Label>
              <Input value={form.property_name} onChange={e => set('property_name', e.target.value)} placeholder="e.g. M7 Logistics Hub" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Street *</Label>
              <Input value={form.street} onChange={e => set('street', e.target.value)} placeholder="12 Industrial Way" />
            </div>
            <div className="space-y-2"><Label>Suburb</Label><Input value={form.suburb} onChange={e => set('suburb', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2"><Label>State</Label><Input value={form.state} onChange={e => set('state', e.target.value.toUpperCase())} placeholder="NSW" /></div>
              <div className="space-y-2"><Label>Postcode</Label><Input value={form.postcode} onChange={e => set('postcode', e.target.value)} /></div>
            </div>

            <div className="space-y-2">
              <Label>Asset Sub-type</Label>
              <Select value={form.asset_subtype} onValueChange={v => set('asset_subtype', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SUBTYPES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => set('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-2"><Label>Purchase Price ($)</Label><Input type="number" value={form.purchase_price} onChange={e => set('purchase_price', e.target.value)} /></div>
            <div className="space-y-2"><Label>Purchase Date</Label><Input type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} /></div>
            <div className="space-y-2"><Label>Current Valuation ($)</Label><Input type="number" value={form.current_valuation} onChange={e => set('current_valuation', e.target.value)} /></div>
            <div className="space-y-2"><Label>Valuation Date</Label><Input type="date" value={form.valuation_date} onChange={e => set('valuation_date', e.target.value)} /></div>

            <div className="space-y-2"><Label>GLA (m²)</Label><Input type="number" value={form.gla_sqm} onChange={e => set('gla_sqm', e.target.value)} /></div>
            <div className="space-y-2"><Label>Site Area (m²)</Label><Input type="number" value={form.site_area_sqm} onChange={e => set('site_area_sqm', e.target.value)} /></div>
            <div className="space-y-2"><Label>Site Cover %</Label><Input type="number" step="0.01" value={form.site_cover_pct} onChange={e => set('site_cover_pct', e.target.value)} /></div>
            <div className="space-y-2"><Label>Office %</Label><Input type="number" step="0.01" value={form.office_pct} onChange={e => set('office_pct', e.target.value)} /></div>
            <div className="space-y-2"><Label>Hardstand (m²)</Label><Input type="number" value={form.hardstand_sqm} onChange={e => set('hardstand_sqm', e.target.value)} /></div>
            <div className="space-y-2"><Label>Clearance (m)</Label><Input type="number" step="0.1" value={form.clearance_metres} onChange={e => set('clearance_metres', e.target.value)} /></div>
            <div className="space-y-2"><Label>Power (kVA)</Label><Input type="number" value={form.power_kva} onChange={e => set('power_kva', e.target.value)} /></div>
            <div className="space-y-2"><Label>Dock Doors</Label><Input type="number" value={form.dock_doors} onChange={e => set('dock_doors', e.target.value)} /></div>
            <div className="space-y-2"><Label>Floor Load (kPa)</Label><Input type="number" value={form.ground_floor_load_kpa} onChange={e => set('ground_floor_load_kpa', e.target.value)} /></div>

            <div className="space-y-2"><Label>Zoning</Label><Input value={form.zoning} onChange={e => set('zoning', e.target.value)} placeholder="e.g. IN1, IN3" /></div>
            <div className="space-y-2"><Label>Year Built</Label><Input type="number" value={form.year_built} onChange={e => set('year_built', e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Condition Rating</Label>
              <Select value={form.condition_rating || '__none__'} onValueChange={v => set('condition_rating', v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {CONDITION.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} />
            </div>
          </div>
        </ScrollArea>
        <DialogFooter className="px-6 pb-6">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Property'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
