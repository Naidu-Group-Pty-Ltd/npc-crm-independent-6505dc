import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Building2, Pencil, FileDown, Loader2, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { commercialApi, useCommercialFinancing, type CommercialProperty } from '@/hooks/useCommercialProperties';
import { CommercialPropertyFormModal } from '@/components/commercial/CommercialPropertyFormModal';
import { RentRollTable } from '@/components/commercial/RentRollTable';
import { FinancialSnapshot } from '@/components/commercial/FinancialSnapshot';
import { CommercialCapexTable } from '@/components/commercial/CommercialCapexTable';
import { PropertyFinancingPanel } from '@/components/property/PropertyFinancingPanel';
import { generateCommercialInvestmentReport } from '@/utils/commercial/commercialReportPdf';


const ASSET_LABEL: Record<string, string> = {
  office: 'Office', retail: 'Retail', industrial: 'Industrial', mixed_use: 'Mixed Use',
  medical: 'Medical', childcare: 'Childcare', hospitality: 'Hospitality', other: 'Other',
};

export default function CommercialPropertyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [property, setProperty] = useState<CommercialProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleGenerateReport = async () => {
    if (!id) return;
    setGenerating(true);
    try {
      await generateCommercialInvestmentReport(id);
      toast.success('Commercial investment report generated');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };


  const load = async () => {
    if (!id) return;
    setLoading(true);
    const res = await commercialApi.getProperty(id);
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
          <Button variant="ghost" size="icon" onClick={() => navigate('/commercial')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" />
              {property.address}
            </h1>
            <div className="text-muted-foreground text-sm mt-1 flex items-center gap-2">
              {property.suburb && <span>{property.suburb}, {property.state} {property.postcode}</span>}
              <Badge variant="secondary">{ASSET_LABEL[property.asset_class]}</Badge>
              <Badge variant="outline" className="capitalize">{property.tenure}</Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => navigate(`/calculators?domain=commercial&propertyId=${property.id}`)}>
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
              <Info label="GFA" value={property.gfa_sqm ? `${property.gfa_sqm.toLocaleString('en-AU')} m²` : '—'} />
              <Info label="NLA" value={property.nla_sqm ? `${property.nla_sqm.toLocaleString('en-AU')} m²` : '—'} />
              <Info label="Site Area" value={property.site_area_sqm ? `${property.site_area_sqm.toLocaleString('en-AU')} m²` : '—'} />
              <Info label="Parking Bays" value={property.parking_bays ?? '—'} />
              <Info label="Year Built" value={property.year_built ?? '—'} />
              <Info label="Zoning" value={property.zoning ?? '—'} />
              <Info label="Acquisition Date" value={property.acquisition_date ?? '—'} />
              <Info label="GST Treatment" value={property.gst_treatment.replace('_', ' ')} />
              <Info label="Valuer" value={property.valuer ?? '—'} />
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
          <RentRollTable propertyId={property.id} />
        </TabsContent>

        <TabsContent value="capex">
          <CommercialCapexTable propertyId={property.id} />
        </TabsContent>

        <TabsContent value="financing">
          <CommercialFinancingTab propertyId={property.id} />
        </TabsContent>

        <TabsContent value="financials">
          <FinancialSnapshot property={property} />
        </TabsContent>
      </Tabs>

      {editOpen && (
        <CommercialPropertyFormModal
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
      <div className="font-medium mt-0.5 capitalize">{value}</div>
    </div>
  );
}

function CommercialFinancingTab({ propertyId }: { propertyId: string }) {
  const { financing, loading, refresh } = useCommercialFinancing(propertyId);
  const handleSave = async (data: any) => {
    const res = financing?.id
      ? await commercialApi.updateFinancing(financing.id, data)
      : await commercialApi.createFinancing(data);
    if (!res.error) refresh();
    return res;
  };
  return (
    <PropertyFinancingPanel
      propertyId={propertyId}
      value={financing}
      loading={loading}
      onSave={handleSave}
      title="Commercial Loan & Financing"
    />
  );
}

