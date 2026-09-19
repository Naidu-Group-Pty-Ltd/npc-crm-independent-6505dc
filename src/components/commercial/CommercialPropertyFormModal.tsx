import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import { commercialApi, type CommercialProperty } from '@/hooks/useCommercialProperties';
import { PropertyImportPanel, type ImportedPropertyData } from '@/components/property-import/PropertyImportPanel';

interface Props {
  open: boolean;
  onClose: () => void;
  property?: CommercialProperty | null;
  onSaved: () => void;
}

const ASSET_CLASSES = [
  { value: 'office', label: 'Office' },
  { value: 'retail', label: 'Retail' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'mixed_use', label: 'Mixed Use' },
  { value: 'medical', label: 'Medical' },
  { value: 'childcare', label: 'Childcare' },
  { value: 'hospitality', label: 'Hospitality' },
  { value: 'other', label: 'Other' },
];

const GST_OPTIONS = [
  { value: 'going_concern', label: 'Going Concern (GST-free)' },
  { value: 'margin_scheme', label: 'Margin Scheme' },
  { value: 'standard', label: 'Standard (GST in price)' },
  { value: 'input_taxed', label: 'Input Taxed' },
];

const TENURE = [
  { value: 'freehold', label: 'Freehold' },
  { value: 'leasehold', label: 'Leasehold' },
  { value: 'strata', label: 'Strata' },
];


function normalizeCommercialAssetClass(value: string | undefined, fallback: any) {
  if (!value) return fallback;
  const normalized = value.toLowerCase().replace(/[\s-]+/g, '_');
  const match = ASSET_CLASSES.find(option => option.value === normalized || option.label.toLowerCase() === value.toLowerCase());
  if (match) return match.value;
  if (normalized.includes('retail')) return 'retail';
  if (normalized.includes('industrial') || normalized.includes('warehouse')) return 'industrial';
  if (normalized.includes('office')) return 'office';
  if (normalized.includes('medical')) return 'medical';
  if (normalized.includes('child')) return 'childcare';
  if (normalized.includes('hospitality') || normalized.includes('hotel')) return 'hospitality';
  if (normalized.includes('mixed')) return 'mixed_use';
  return fallback;
}

function normalizeTenure(value: string | undefined, fallback: any) {
  if (!value) return fallback;
  const normalized = value.toLowerCase().replace(/[\s-]+/g, '_');
  return TENURE.some(option => option.value === normalized) ? normalized : fallback;
}

export function CommercialPropertyFormModal({ open, onClose, property, onSaved }: Props) {
  const isEdit = !!property;
  const initial = useMemo(() => ({
    address: property?.address ?? '',
    suburb: property?.suburb ?? '',
    state: property?.state ?? '',
    postcode: property?.postcode ?? '',
    asset_class: property?.asset_class ?? 'office',
    asset_sub_type: property?.asset_sub_type ?? '',
    tenure: property?.tenure ?? 'freehold',
    zoning: property?.zoning ?? '',
    gfa_sqm: property?.gfa_sqm ?? '',
    nla_sqm: property?.nla_sqm ?? '',
    site_area_sqm: property?.site_area_sqm ?? '',
    parking_bays: property?.parking_bays ?? '',
    year_built: property?.year_built ?? '',
    purchase_price: property?.purchase_price ?? '',
    acquisition_date: property?.acquisition_date ?? '',
    gst_treatment: property?.gst_treatment ?? 'standard',
    valuation: property?.valuation ?? '',
    valuation_date: property?.valuation_date ?? '',
    valuer: property?.valuer ?? '',
    notes: property?.notes ?? '',
  }), [property]);

  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  const applyImportedData = (data: ImportedPropertyData) => {
    setForm(prev => ({
      ...prev,
      address: data.address ?? prev.address,
      suburb: data.suburb ?? prev.suburb,
      state: data.state ?? prev.state,
      postcode: data.postcode ?? prev.postcode,
      asset_class: normalizeCommercialAssetClass(data.assetClass, prev.asset_class),
      asset_sub_type: data.assetSubType ?? prev.asset_sub_type,
      tenure: normalizeTenure(data.tenure, prev.tenure),
      zoning: data.zoning ?? prev.zoning,
      gfa_sqm: data.gfaSqm ?? prev.gfa_sqm,
      nla_sqm: data.nlaSqm ?? data.glaSqm ?? data.gfaSqm ?? prev.nla_sqm,
      site_area_sqm: data.siteAreaSqm ?? prev.site_area_sqm,
      parking_bays: data.parkingBays ?? prev.parking_bays,
      year_built: data.yearBuilt ?? prev.year_built,
      purchase_price: data.price ?? prev.purchase_price,
      valuation: data.valuation ?? prev.valuation,
      gst_treatment: (data.gstTreatment as typeof prev.gst_treatment) ?? prev.gst_treatment,
      notes: [prev.notes, data.notes, data.sourceUrl ? `Source: ${data.sourceUrl}` : ''].filter(Boolean).join('\n\n'),
    }));
  };

  const handleSave = async () => {
    if (!form.address.trim()) {
      toast({ title: 'Address required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload: any = {
      ...form,
      gfa_sqm: form.gfa_sqm === '' ? null : Number(form.gfa_sqm),
      nla_sqm: form.nla_sqm === '' ? null : Number(form.nla_sqm),
      site_area_sqm: form.site_area_sqm === '' ? null : Number(form.site_area_sqm),
      parking_bays: form.parking_bays === '' ? null : Number(form.parking_bays),
      year_built: form.year_built === '' ? null : Number(form.year_built),
      purchase_price: form.purchase_price === '' ? null : Number(form.purchase_price),
      valuation: form.valuation === '' ? null : Number(form.valuation),
      acquisition_date: form.acquisition_date || null,
      valuation_date: form.valuation_date || null,
    };

    const res = isEdit
      ? await commercialApi.updateProperty(property!.id, payload)
      : await commercialApi.createProperty(payload);

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
          <DialogTitle>{isEdit ? 'Edit Commercial Property' : 'New Commercial Property'}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 px-6">
          <div className="grid grid-cols-2 gap-4 py-4">
            <PropertyImportPanel category="commercial" onImported={applyImportedData} />
            <div className="col-span-2 space-y-2">
              <Label>Address *</Label>
              <Input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="123 Main St" />
            </div>
            <div className="space-y-2">
              <Label>Suburb</Label>
              <Input value={form.suburb} onChange={(e) => set('suburb', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>State</Label>
                <Input value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase())} placeholder="NSW" />
              </div>
              <div className="space-y-2">
                <Label>Postcode</Label>
                <Input value={form.postcode} onChange={(e) => set('postcode', e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Asset Class</Label>
              <Select value={form.asset_class} onValueChange={(v) => set('asset_class', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSET_CLASSES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Sub-type</Label>
              <Input value={form.asset_sub_type} onChange={(e) => set('asset_sub_type', e.target.value)} placeholder="e.g. A-grade, Big-box, Cold-storage" />
            </div>

            <div className="space-y-2">
              <Label>Tenure</Label>
              <Select value={form.tenure} onValueChange={(v) => set('tenure', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TENURE.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Zoning</Label>
              <Input value={form.zoning} onChange={(e) => set('zoning', e.target.value)} placeholder="e.g. B4, IN1" />
            </div>

            <div className="space-y-2">
              <Label>GFA (m²)</Label>
              <Input type="number" value={form.gfa_sqm} onChange={(e) => set('gfa_sqm', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>NLA (m²)</Label>
              <Input type="number" value={form.nla_sqm} onChange={(e) => set('nla_sqm', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Site Area (m²)</Label>
              <Input type="number" value={form.site_area_sqm} onChange={(e) => set('site_area_sqm', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Parking Bays</Label>
              <Input type="number" value={form.parking_bays} onChange={(e) => set('parking_bays', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Year Built</Label>
              <Input type="number" value={form.year_built} onChange={(e) => set('year_built', e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Purchase Price ($)</Label>
              <Input type="number" value={form.purchase_price} onChange={(e) => set('purchase_price', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Acquisition Date</Label>
              <Input type="date" value={form.acquisition_date} onChange={(e) => set('acquisition_date', e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>GST Treatment</Label>
              <Select value={form.gst_treatment} onValueChange={(v) => set('gst_treatment', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GST_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Independent Valuation ($)</Label>
              <Input type="number" value={form.valuation} onChange={(e) => set('valuation', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Valuation Date</Label>
              <Input type="date" value={form.valuation_date} onChange={(e) => set('valuation_date', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Valuer</Label>
              <Input value={form.valuer} onChange={(e) => set('valuer', e.target.value)} />
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />
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
