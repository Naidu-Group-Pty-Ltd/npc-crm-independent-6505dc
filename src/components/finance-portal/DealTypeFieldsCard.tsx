import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * Chunk 12 — Deal-type adaptive finance layer.
 * Renders different structured fields depending on `purchase_type`.
 *
 *  • existing_property / off_the_plan / refinance_equity / smsf  →  no extra layer (returns null)
 *  • house_and_land / land_only / build_only / dual_occupancy    →  Construction & Land block
 *  • commercial / industrial                                     →  Commercial / Industrial block
 */
export function DealTypeFieldsCard({
  file,
  onSave,
}: {
  file: any;
  onSave: (key: string, value: any) => void;
}) {
  const type = file.purchase_type as string;
  const isConstruction = ['house_and_land', 'land_only', 'build_only', 'dual_occupancy'].includes(type);
  const isCommercial = ['commercial', 'industrial'].includes(type);

  if (!isConstruction && !isCommercial) return null;

  return (
    <Card className="md:col-span-2 border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">
          {isConstruction ? 'Construction & Land Details' : 'Commercial / Industrial Details'}
        </CardTitle>
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
          {type.replace(/_/g, ' ')}
        </Badge>
      </CardHeader>
      <CardContent>
        {isConstruction ? <ConstructionFields file={file} onSave={onSave} /> : null}
        {isCommercial ? <CommercialFields file={file} onSave={onSave} /> : null}
      </CardContent>
    </Card>
  );
}

/* ───────── Construction / H&L ───────── */
function ConstructionFields({ file, onSave }: { file: any; onSave: (k: string, v: any) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <NumField label="Land Price (AUD)" value={file.land_price} onSave={(v) => onSave('land_price', v)} />
      <NumField label="Build Price (AUD)" value={file.build_price} onSave={(v) => onSave('build_price', v)} />
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Construction Stage</Label>
        <Select
          value={file.construction_stage || '__unassigned__'}
          onValueChange={(v) => onSave('construction_stage', v === '__unassigned__' ? null : v)}
        >
          <SelectTrigger className="h-9"><SelectValue placeholder="Select stage" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__unassigned__">Not set</SelectItem>
            <SelectItem value="land_settlement">Land Settlement</SelectItem>
            <SelectItem value="slab">Slab Down</SelectItem>
            <SelectItem value="frame">Frame</SelectItem>
            <SelectItem value="lockup">Lock-up</SelectItem>
            <SelectItem value="fixing">Fixing</SelectItem>
            <SelectItem value="practical_completion">Practical Completion</SelectItem>
            <SelectItem value="handover">Handover</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DateField label="Land Settlement Date" value={file.land_settlement_date} onSave={(v) => onSave('land_settlement_date', v)} />
      <DateField label="Construction Start" value={file.construction_start_date} onSave={(v) => onSave('construction_start_date', v)} />
      <DateField label="Completion Estimate" value={file.construction_completion_estimate} onSave={(v) => onSave('construction_completion_estimate', v)} />
    </div>
  );
}

/* ───────── Commercial / Industrial ───────── */
function CommercialFields({ file, onSave }: { file: any; onSave: (k: string, v: any) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Commercial Loan Type</Label>
        <Select
          value={file.commercial_loan_type || '__unassigned__'}
          onValueChange={(v) => onSave('commercial_loan_type', v === '__unassigned__' ? null : v)}
        >
          <SelectTrigger className="h-9"><SelectValue placeholder="Select type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__unassigned__">Not set</SelectItem>
            <SelectItem value="full_doc">Full Doc</SelectItem>
            <SelectItem value="lease_doc">Lease Doc</SelectItem>
            <SelectItem value="low_doc">Low Doc</SelectItem>
            <SelectItem value="smsf_commercial">SMSF Commercial</SelectItem>
            <SelectItem value="development_finance">Development Finance</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">GST Treatment</Label>
        <Select
          value={file.gst_treatment || '__unassigned__'}
          onValueChange={(v) => onSave('gst_treatment', v === '__unassigned__' ? null : v)}
        >
          <SelectTrigger className="h-9"><SelectValue placeholder="Select treatment" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__unassigned__">Not set</SelectItem>
            <SelectItem value="going_concern">Going Concern (GST-free)</SelectItem>
            <SelectItem value="margin_scheme">Margin Scheme</SelectItem>
            <SelectItem value="standard_gst">Standard GST (10%)</SelectItem>
            <SelectItem value="input_taxed">Input Taxed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Lease In Place</Label>
        <Select
          value={file.lease_in_place == null ? '__unassigned__' : file.lease_in_place ? 'yes' : 'no'}
          onValueChange={(v) =>
            onSave('lease_in_place', v === '__unassigned__' ? null : v === 'yes')
          }
        >
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__unassigned__">Not set</SelectItem>
            <SelectItem value="yes">Yes</SelectItem>
            <SelectItem value="no">No / Vacant Possession</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <NumField label="Lease Term (months)" value={file.lease_term_months} onSave={(v) => onSave('lease_term_months', v)} />
      <NumField label="Net Rental Yield (%)" value={file.net_rental_yield} onSave={(v) => onSave('net_rental_yield', v)} step="0.01" />
    </div>
  );
}

/* ───────── Field primitives ───────── */
function NumField({
  label, value, onSave, step,
}: { label: string; value: any; onSave: (v: number | null) => void; step?: string }) {
  const [local, setLocal] = useState<string>(value != null ? String(value) : '');
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const next = local === '' ? null : Number(local);
          if ((value ?? null) !== next) onSave(next);
        }}
      />
    </div>
  );
}

function DateField({
  label, value, onSave,
}: { label: string; value: any; onSave: (v: string | null) => void }) {
  const [local, setLocal] = useState<string>(value ?? '');
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="date"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const next = local || null;
          if ((value ?? null) !== next) onSave(next);
        }}
      />
    </div>
  );
}
