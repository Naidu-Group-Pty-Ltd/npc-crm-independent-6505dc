import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Factory, Pencil, FileDown, Loader2, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { industrialApi, useIndustrialFinancing, type IndustrialProperty } from '@/hooks/useIndustrialProperties';
import { IndustrialPropertyFormModal } from '@/components/industrial/IndustrialPropertyFormModal';
import { IndustrialRentRollTable } from '@/components/industrial/IndustrialRentRollTable';
import { IndustrialCapexTable } from '@/components/industrial/IndustrialCapexTable';
import { IndustrialFinancialSnapshot } from '@/components/industrial/IndustrialFinancialSnapshot';
import { PropertyFinancingPanel } from '@/components/property/PropertyFinancingPanel';
import { generateIndustrialInvestmentReport } from '@/utils/industrial/industrialReportPdf';

const SUBTYPE_LABEL: Record<string, string> = {
  warehouse: 'Warehouse', logistics: 'Logistics', manufacturing: 'Manufacturing',
  cold_storage: 'Cold Storage', flex: 'Flex / Estate', data_centre: 'Data Centre',
  transport_yard: 'Transport Yard', other: 'Other',
};

export default function IndustrialPropertyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [property, setProperty] = useState<IndustrialProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleGenerateReport = async () => {
    if (!id) return;
    setGenerating(true);
    try {
      await generateIndustrialInvestmentReport(id);
      toast.success('Industrial investment report generated');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const res = await industrialApi.getProperty(id);
    if (res.data) setProperty(res.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="container mx-auto p-6">Loading…</div>;
  if (!property) return <div className="container mx-auto p-6">Property not found.</div>;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/industrial')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Factory className="h-6 w-6 text-primary" />
              {property.property_name || property.street}
            </h1>
            <div className="text-muted-foreground text-sm mt-1 flex items-center gap-2 flex-wrap">
              {property.suburb && <span>{property.street}, {property.suburb}, {property.state} {property.postcode}</span>}
              <Badge variant="secondary">{SUBTYPE_LABEL[property.asset_subtype]}</Badge>
              <Badge variant="outline" className="capitalize">{property.status.replace('_', ' ')}</Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => navigate(`/calculators?domain=industrial&propertyId=${property.id}`)}>
            <Calculator className="h-4 w-4 mr-2" /> Send to Calculators
          </Button>
          <Button onClick={handleGenerateReport} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
            Generate Report
          </Button>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-2" /> Edit Details
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="rent-roll">Rent Roll</TabsTrigger>
          <TabsTrigger value="capex">Capex</TabsTrigger>
          <TabsTrigger value="financing">Financing</TabsTrigger>
          <TabsTrigger value="financials">Financials</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardContent className="pt-6 grid gap-4 md:grid-cols-3 text-sm">
              <Info label="GLA" value={property.gla_sqm ? `${property.gla_sqm.toLocaleString('en-AU')} m²` : '—'} />
              <Info label="Site Area" value={property.site_area_sqm ? `${property.site_area_sqm.toLocaleString('en-AU')} m²` : '—'} />
              <Info label="Site Cover" value={property.site_cover_pct ? `${property.site_cover_pct}%` : '—'} />
              <Info label="Office %" value={property.office_pct ? `${property.office_pct}%` : '—'} />
              <Info label="Hardstand" value={property.hardstand_sqm ? `${property.hardstand_sqm.toLocaleString('en-AU')} m²` : '—'} />
              <Info label="Clearance" value={property.clearance_metres ? `${property.clearance_metres} m` : '—'} />
              <Info label="Power" value={property.power_kva ? `${property.power_kva} kVA` : '—'} />
              <Info label="Dock Doors" value={property.dock_doors ?? '—'} />
              <Info label="Floor Load" value={property.ground_floor_load_kpa ? `${property.ground_floor_load_kpa} kPa` : '—'} />
              <Info label="Zoning" value={property.zoning ?? '—'} />
              <Info label="Year Built" value={property.year_built ?? '—'} />
              <Info label="Condition" value={property.condition_rating ?? '—'} />
            </CardContent>
          </Card>
          {property.notes && (
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs uppercase text-muted-foreground mb-2">Notes</div>
                <p className="whitespace-pre-wrap text-sm">{property.notes}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="rent-roll">
          <IndustrialRentRollTable propertyId={property.id} />
        </TabsContent>

        <TabsContent value="capex">
          <IndustrialCapexTable propertyId={property.id} />
        </TabsContent>

        <TabsContent value="financing">
          <IndustrialFinancingTab propertyId={property.id} />
        </TabsContent>

        <TabsContent value="financials">
          <IndustrialFinancialSnapshot property={property} />
        </TabsContent>
      </Tabs>

      {editOpen && (
        <IndustrialPropertyFormModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          property={property}
          onSaved={load}
        />
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium mt-0.5">{value}</div>
    </div>
  );
}

function IndustrialFinancingTab({ propertyId }: { propertyId: string }) {
  const { financing, loading, refresh } = useIndustrialFinancing(propertyId);
  const handleSave = async (data: any) => {
    const res = financing?.id
      ? await industrialApi.updateFinancing(financing.id, data)
      : await industrialApi.createFinancing(data);
    if (!res.error) refresh();
    return res;
  };
  return (
    <PropertyFinancingPanel
      propertyId={propertyId}
      value={financing}
      loading={loading}
      onSave={handleSave}
      title="Industrial Loan & Financing"
    />
  );
}
