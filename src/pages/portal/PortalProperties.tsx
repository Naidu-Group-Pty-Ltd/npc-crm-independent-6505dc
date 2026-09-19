import { useState } from 'react';
import { usePortalPropertiesData, usePortalUpdateData } from '@/hooks/usePortalData';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Building2, Loader2, Home, Plus, Edit, Trash2, Calendar,
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { format } from 'date-fns';
import { PortalPropertyForm } from '@/components/portal/PortalPropertyForm';
import { toast } from 'sonner';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { PortalPanel, PortalPanelContent, portalStatCardClassName } from '@/components/portal/PortalSurface';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

function fmt(val?: number | null): string {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value || value === '—') return null;
  return (
    <div className="flex justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground text-right">{value}</span>
    </div>
  );
}

export default function PortalProperties() {
  const { data, isLoading, refetch } = usePortalPropertiesData();
  const mutation = usePortalUpdateData();
  const properties = data?.properties || [];
  const [showForm, setShowForm] = useState(false);
  const [editingProperty, setEditingProperty] = useState<any>(null);

  const handleDelete = async (id: string) => {
    try {
      await mutation.mutateAsync({ operation: 'delete', table: 'client_properties', id });
      toast.success('Property deleted');
      refetch();
    } catch (err: any) {
      toast.error('Failed to delete: ' + (err.message || 'Unknown error'));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show form for add or edit
  if (showForm || editingProperty) {
    return (
      <div className="space-y-6">
        <div className="client-portal-page-header">
          <h1 className="text-2xl font-bold text-foreground">{editingProperty ? 'Edit Property' : 'Add Property'}</h1>
          <p className="text-muted-foreground mt-1">Enter all property details below</p>
        </div>
        <PortalPropertyForm
          existingProperty={editingProperty}
          onComplete={() => { setShowForm(false); setEditingProperty(null); refetch(); }}
          onCancel={() => { setShowForm(false); setEditingProperty(null); }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="client-portal-page-header flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Properties</h1>
          <p className="text-muted-foreground mt-1">Your investment property portfolio</p>
        </div>
        <Button onClick={() => setShowForm(true)} size="sm" className="rounded-xl shadow-lg shadow-primary/10">
          <Plus className="h-4 w-4 mr-1.5" />
          Add Property
        </Button>
      </div>

      {/* Summary Stats */}
      {properties.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className={portalStatCardClassName()}>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Properties</p>
              <p className="text-2xl font-bold text-foreground">{properties.length}</p>
            </CardContent>
          </Card>
          <Card className={portalStatCardClassName()}>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Portfolio Value</p>
              <p className="text-2xl font-bold text-foreground">
                {fmt(properties.reduce((sum: number, p: any) => sum + (p.value || 0), 0))}
              </p>
            </CardContent>
          </Card>
          <Card className={portalStatCardClassName()}>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Monthly Income</p>
              <p className="text-2xl font-bold text-primary">
                {fmt(properties.reduce((sum: number, p: any) => sum + (p.monthly_rental_income || 0), 0))}
              </p>
            </CardContent>
          </Card>
          <Card className={portalStatCardClassName()}>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Loans</p>
              <p className="text-2xl font-bold text-foreground">
                {fmt(properties.reduce((sum: number, p: any) => sum + (p.loan_remaining || 0), 0))}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Property Cards */}
      {properties.length === 0 ? (
        <PortalEmptyState
          className="client-portal-soft-panel"
          icon={<Home className="h-8 w-8" />}
          title="No properties in your portfolio yet"
          description="Add your first property to start tracking values, loans, rental income, and cash flow in one place."
          actionLabel="Add Your First Property"
          onAction={() => setShowForm(true)}
        />
      ) : (
        <Accordion type="multiple" className="space-y-3">
          {properties.map((prop: any) => (
            <AccordionItem key={prop.id} value={prop.id} className="rounded-2xl border border-border/60 bg-card/85 shadow-lg shadow-primary/5">
              <AccordionTrigger className="px-5 py-4 hover:no-underline">
                <div className="flex items-center gap-4 text-left w-full pr-4">
                  <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">{prop.address}</p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <Badge variant="secondary" className="capitalize text-xs">
                        {prop.property_type?.replace(/_/g, ' ') || 'Property'}
                      </Badge>
                      {prop.value > 0 && <span className="text-xs text-muted-foreground">{fmt(prop.value)}</span>}
                    </div>
                  </div>
                  {prop.net_monthly_cashflow != null && (
                      <div className={`text-right shrink-0 ${prop.net_monthly_cashflow >= 0 ? 'text-primary' : 'text-destructive'}`}>
                      <p className="text-sm font-bold">{fmt(prop.net_monthly_cashflow)}</p>
                      <p className="text-xs text-muted-foreground">net/mo</p>
                    </div>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-5 pb-5">
                <Separator className="mb-4" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Financials</p>
                    <DetailRow label="Purchase Price" value={fmt(prop.purchase_price)} />
                    <DetailRow label="Current Value" value={fmt(prop.value)} />
                    <DetailRow label="Loan Remaining" value={fmt(prop.loan_remaining)} />
                    <DetailRow label="Interest Rate" value={prop.interest_rate ? `${prop.interest_rate}%` : '—'} />
                    <DetailRow label="Monthly Repayment" value={fmt(prop.monthly_interest_repayment)} />
                    <DetailRow label="Ownership" value={prop.ownership_percentage ? `${prop.ownership_percentage}%` : '—'} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Income & Expenses</p>
                    <DetailRow label="Weekly Rent" value={fmt(prop.weekly_rental_income)} />
                    <DetailRow label="Monthly Rent" value={fmt(prop.monthly_rental_income)} />
                    <DetailRow label="Council Rates" value={fmt(prop.monthly_council_rates)} />
                    <DetailRow label="Water Rates" value={fmt(prop.monthly_water_rates)} />
                    <DetailRow label="Body Corporate" value={fmt(prop.monthly_body_corporate)} />
                    <DetailRow label="Insurance" value={fmt(prop.monthly_building_insurance)} />
                    <DetailRow label="Landlord Insurance" value={fmt(prop.monthly_landlord_insurance)} />
                    <DetailRow label="Property Mgmt" value={fmt(prop.monthly_property_management)} />
                    <DetailRow label="Repairs" value={fmt(prop.monthly_repairs_maintenance)} />
                  </div>
                </div>
                {(prop.purchase_date || prop.deal_closed_at) && (
                  <div className="mt-4 pt-3 border-t border-border/50">
                    <div className="flex gap-6 text-xs text-muted-foreground">
                      {prop.purchase_date && (
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          Purchased {format(new Date(prop.purchase_date), 'dd MMM yyyy')}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {/* Edit / Delete actions */}
                <div className="flex gap-2 mt-4 pt-3 border-t border-border/50">
                  <Button variant="outline" size="sm" onClick={() => setEditingProperty(prop)}>
                    <Edit className="h-3.5 w-3.5 mr-1.5" />
                    Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10">
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Property</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this property? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(prop.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
