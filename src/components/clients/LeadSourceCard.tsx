import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Megaphone, Save, X, Plus, Trash2, Globe, Target, ExternalLink,
  Layers, ChevronDown, ChevronUp, MousePointerClick, Monitor,
  MapPin, Calendar, Hash, Image as ImageIcon, Link2, Sparkles,
} from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Attribution {
  id: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  meta_campaign_id: string | null;
  meta_campaign_name: string | null;
  meta_adset_id: string | null;
  meta_adset_name: string | null;
  meta_ad_id: string | null;
  meta_ad_name: string | null;
  meta_ad_creative_url?: string | null;
  meta_campaign_objective?: string | null;
  source_type: 'webhook_auto' | 'manual' | 'csv_import' | 'backfill';
  landing_page_url: string | null;
  referrer_url: string | null;
  conversion_page_url?: string | null;
  ghl_contact_id: string | null;
  ghl_attribution_source?: string | null;
  attributed_at: string;
  enrichment_status?: string | null;
  notes: string | null;
  fbclid: string | null;
  gclid: string | null;
  device_type: string | null;
  geo_location: string | null;
}

interface LeadSourceCardProps {
  clientId: string;
  attributions: Attribution[];
  onRefresh: () => void;
}

const SOURCE_TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  webhook_auto: { label: 'Auto', color: 'bg-success/10 text-success border-success/20', icon: '⚡' },
  manual: { label: 'Manual', color: 'bg-info/10 text-info border-info/20', icon: '✏️' },
  csv_import: { label: 'CSV', color: 'bg-brand-500/10 text-brand-700 border-brand-500/20', icon: '📄' },
  backfill: { label: 'Backfill', color: 'bg-accent/10 text-accent border-accent/20', icon: '🔄' },
};

function getSourceEmoji(source: string) {
  const s = source.toLowerCase();
  if (s.includes('facebook') || s.includes('meta') || s.includes('fb')) return '📘';
  if (s.includes('google')) return '🔍';
  if (s.includes('email')) return '📧';
  if (s.includes('referral')) return '🤝';
  if (s.includes('tiktok')) return '🎵';
  if (s.includes('instagram')) return '📸';
  return '🌐';
}

function AttributionItem({ attr, onDelete }: { attr: Attribution; onDelete: (id: string) => void }) {
  const [showTechnical, setShowTechnical] = useState(false);

  const campaignName = attr.meta_campaign_name || attr.utm_campaign;
  const adsetName = attr.meta_adset_name || attr.utm_medium;
  const adName = attr.meta_ad_name || attr.utm_content;
  const source = attr.utm_source || 'Unknown';
  const sourceConfig = SOURCE_TYPE_CONFIG[attr.source_type];
  const hasFunnelData = campaignName || adsetName || adName;
  const hasTechnicalData = attr.meta_campaign_id || attr.meta_adset_id || attr.meta_ad_id ||
    attr.fbclid || attr.gclid || attr.device_type || attr.geo_location ||
    attr.landing_page_url || attr.conversion_page_url;

  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      {/* Source Header */}
      <div className="px-3 py-2.5 bg-muted/30 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-base">{getSourceEmoji(source)}</span>
            <span className="text-xs font-semibold text-foreground">{source}</span>
            <Badge variant="outline" className={`text-[9px] ${sourceConfig?.color || ''}`}>
              {sourceConfig?.label || attr.source_type}
            </Badge>
            {attr.enrichment_status === 'enriched' && (
              <Badge variant="outline" className="text-[9px] bg-primary/5 text-primary border-primary/20">
                <Sparkles className="h-2 w-2 mr-0.5" />
                Enriched
              </Badge>
            )}
            {attr.meta_campaign_objective && (
              <Badge variant="secondary" className="text-[8px] uppercase">
                {attr.meta_campaign_objective}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0" onClick={() => onDelete(attr.id)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
          <Calendar className="h-2.5 w-2.5" />
          Attributed {format(new Date(attr.attributed_at), 'dd MMM yyyy, h:mm a')}
        </p>
      </div>

      {/* Campaign Funnel Hierarchy */}
      {hasFunnelData && (
        <div className="px-3 py-2.5 space-y-0">
          {/* Campaign Level */}
          {campaignName && (
            <div className="flex items-start gap-2 py-1.5">
              <div className="flex items-center gap-1 shrink-0 mt-0.5">
                <Target className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Campaign</p>
                <p className="text-xs font-medium text-foreground break-words leading-snug">{campaignName}</p>
              </div>
            </div>
          )}

          {/* Ad Set Level */}
          {adsetName && (
            <div className="flex items-start gap-2 py-1.5 ml-4 border-l-2 border-primary/20 pl-3">
              <div className="flex items-center gap-1 shrink-0 mt-0.5">
                <Layers className="h-3 w-3 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Ad Set</p>
                <p className="text-[11px] font-medium text-foreground break-words leading-snug">{adsetName}</p>
              </div>
            </div>
          )}

          {/* Ad Level */}
          {adName && (
            <div className="flex items-start gap-2 py-1.5 ml-8 border-l-2 border-muted-foreground/20 pl-3">
              <div className="flex items-center gap-1 shrink-0 mt-0.5">
                {attr.meta_ad_creative_url ? (
                  <img src={attr.meta_ad_creative_url} alt="" className="h-5 w-5 rounded object-cover" />
                ) : (
                  <ImageIcon className="h-3 w-3 text-muted-foreground/60" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Ad</p>
                <p className="text-[11px] font-medium text-foreground break-words leading-snug">{adName}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No funnel data fallback */}
      {!hasFunnelData && (
        <div className="px-3 py-2.5 text-center">
          <p className="text-[11px] text-muted-foreground italic">No campaign funnel data available — only source-level attribution captured.</p>
        </div>
      )}

      {/* Click IDs quick indicator */}
      {(attr.fbclid || attr.gclid) && (
        <div className="px-3 py-1.5 border-t border-border/30 bg-muted/10">
          <div className="flex items-center gap-2">
            <MousePointerClick className="h-3 w-3 text-primary/60" />
            <span className="text-[10px] text-muted-foreground">
              {attr.fbclid ? 'Facebook Click ID captured' : 'Google Click ID captured'} ✓
            </span>
          </div>
        </div>
      )}

      {/* Technical Details Toggle */}
      {hasTechnicalData && (
        <>
          <button
            className="w-full px-3 py-1.5 border-t border-border/30 flex items-center justify-between text-[10px] text-muted-foreground hover:bg-muted/20 transition-colors"
            onClick={() => setShowTechnical(!showTechnical)}
          >
            <span className="font-medium">Technical Details</span>
            {showTechnical ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {showTechnical && (
            <div className="px-3 py-2.5 border-t border-border/20 bg-muted/5 space-y-2">
              {/* Meta IDs */}
              {(attr.meta_campaign_id || attr.meta_adset_id || attr.meta_ad_id) && (
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
                    <Hash className="h-2.5 w-2.5" /> Meta IDs
                  </p>
                  <div className="grid gap-0.5 text-[10px]">
                    {attr.meta_campaign_id && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground w-16 shrink-0">Campaign:</span>
                        <code className="font-mono text-foreground/80 truncate">{attr.meta_campaign_id}</code>
                      </div>
                    )}
                    {attr.meta_adset_id && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground w-16 shrink-0">Ad Set:</span>
                        <code className="font-mono text-foreground/80 truncate">{attr.meta_adset_id}</code>
                      </div>
                    )}
                    {attr.meta_ad_id && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground w-16 shrink-0">Ad:</span>
                        <code className="font-mono text-foreground/80 truncate">{attr.meta_ad_id}</code>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* UTM Parameters */}
              {(attr.utm_source || attr.utm_medium || attr.utm_campaign || attr.utm_content || attr.utm_term) && (
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
                    <Link2 className="h-2.5 w-2.5" /> UTM Parameters
                  </p>
                  <div className="grid gap-0.5 text-[10px]">
                    {attr.utm_source && (
                      <div><span className="text-muted-foreground">source: </span><span className="font-mono">{attr.utm_source}</span></div>
                    )}
                    {attr.utm_medium && (
                      <div><span className="text-muted-foreground">medium: </span><span className="font-mono">{attr.utm_medium}</span></div>
                    )}
                    {attr.utm_campaign && (
                      <div><span className="text-muted-foreground">campaign: </span><span className="font-mono">{attr.utm_campaign}</span></div>
                    )}
                    {attr.utm_content && (
                      <div><span className="text-muted-foreground">content: </span><span className="font-mono">{attr.utm_content}</span></div>
                    )}
                    {attr.utm_term && (
                      <div><span className="text-muted-foreground">term: </span><span className="font-mono">{attr.utm_term}</span></div>
                    )}
                  </div>
                </div>
              )}

              {/* Click IDs */}
              {(attr.fbclid || attr.gclid) && (
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
                    <MousePointerClick className="h-2.5 w-2.5" /> Click Tracking
                  </p>
                  {attr.fbclid && (
                    <div className="text-[10px] truncate">
                      <span className="text-muted-foreground">fbclid: </span>
                      <code className="font-mono text-foreground/70">{attr.fbclid}</code>
                    </div>
                  )}
                  {attr.gclid && (
                    <div className="text-[10px] truncate">
                      <span className="text-muted-foreground">gclid: </span>
                      <code className="font-mono text-foreground/70">{attr.gclid}</code>
                    </div>
                  )}
                </div>
              )}

              {/* Device & Location */}
              {(attr.device_type || attr.geo_location) && (
                <div className="flex items-center gap-4 text-[10px]">
                  {attr.device_type && (
                    <div className="flex items-center gap-1">
                      <Monitor className="h-2.5 w-2.5 text-muted-foreground" />
                      <span>{attr.device_type}</span>
                    </div>
                  )}
                  {attr.geo_location && (
                    <div className="flex items-center gap-1">
                      <MapPin className="h-2.5 w-2.5 text-muted-foreground" />
                      <span>{attr.geo_location}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Landing / Conversion Pages */}
              {(attr.landing_page_url || attr.conversion_page_url) && (
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
                    <ExternalLink className="h-2.5 w-2.5" /> Pages
                  </p>
                  {attr.landing_page_url && (
                    <div className="text-[10px] truncate text-muted-foreground">
                      Landing: <span className="text-foreground/70">{attr.landing_page_url}</span>
                    </div>
                  )}
                  {attr.conversion_page_url && (
                    <div className="text-[10px] truncate text-muted-foreground">
                      Conversion: <span className="text-foreground/70">{attr.conversion_page_url}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Notes */}
      {attr.notes && (
        <div className="px-3 py-1.5 border-t border-border/30">
          <p className="text-[11px] text-muted-foreground italic">{attr.notes}</p>
        </div>
      )}
    </div>
  );
}

export function LeadSourceCard({ clientId, attributions, onRefresh }: LeadSourceCardProps) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newAttribution, setNewAttribution] = useState({
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_content: '',
    utm_term: '',
    meta_campaign_id: '',
    landing_page_url: '',
    notes: '',
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'create',
        table: 'lead_source_attributions',
        clientId,
        data: {
          ...newAttribution,
          source_type: 'manual',
          attributed_at: new Date().toISOString(),
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to save');
      toast.success('Lead source attribution saved');
      setAdding(false);
      setNewAttribution({ utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '', meta_campaign_id: '', landing_page_url: '', notes: '' });
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save attribution');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'lead_source_attributions',
        clientId,
        recordId: id,
      });
      if (error) throw error;
      toast.success('Attribution removed');
      onRefresh();
    } catch {
      toast.error('Failed to remove attribution');
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-primary" />
            How They Found Us
            {attributions.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {attributions.length} source{attributions.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            {!adding && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAdding(true)}>
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {attributions.length === 0 && !adding ? (
          <div className="text-center py-4 text-muted-foreground">
            <Globe className="h-6 w-6 mx-auto mb-1.5 opacity-40" />
            <p className="text-xs">No lead source recorded</p>
            <p className="text-[10px] mt-0.5">Run a backfill or add a source manually</p>
            <Button variant="outline" size="sm" className="mt-2 text-xs" onClick={() => setAdding(true)}>
              <Plus className="h-3 w-3 mr-1" /> Add Lead Source
            </Button>
          </div>
        ) : (
          <ScrollArea className={attributions.length > 2 ? 'h-[380px]' : ''}>
            <div className="space-y-3 pr-1">
              {attributions.map((attr) => (
                <AttributionItem key={attr.id} attr={attr} onDelete={handleDelete} />
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Add new attribution form */}
        {adding && (
          <>
            <Separator className="my-3" />
            <div className="rounded-lg border border-primary/20 bg-primary/[0.02] p-3 space-y-3">
              <p className="text-xs font-semibold text-foreground">Add Lead Source</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">Source</Label>
                  <Input
                    className="h-7 text-xs"
                    placeholder="e.g. meta, google, referral"
                    value={newAttribution.utm_source}
                    onChange={(e) => setNewAttribution(prev => ({ ...prev, utm_source: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Medium</Label>
                  <Input
                    className="h-7 text-xs"
                    placeholder="e.g. cpc, organic, email"
                    value={newAttribution.utm_medium}
                    onChange={(e) => setNewAttribution(prev => ({ ...prev, utm_medium: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Campaign</Label>
                  <Input
                    className="h-7 text-xs"
                    placeholder="Campaign name"
                    value={newAttribution.utm_campaign}
                    onChange={(e) => setNewAttribution(prev => ({ ...prev, utm_campaign: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Content / Ad</Label>
                  <Input
                    className="h-7 text-xs"
                    placeholder="Ad name or ID"
                    value={newAttribution.utm_content}
                    onChange={(e) => setNewAttribution(prev => ({ ...prev, utm_content: e.target.value }))}
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-[10px]">Landing Page URL</Label>
                  <Input
                    className="h-7 text-xs"
                    placeholder="https://..."
                    value={newAttribution.landing_page_url}
                    onChange={(e) => setNewAttribution(prev => ({ ...prev, landing_page_url: e.target.value }))}
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-[10px]">Notes</Label>
                  <Textarea
                    className="text-xs min-h-[40px]"
                    placeholder="Optional notes..."
                    value={newAttribution.notes}
                    onChange={(e) => setNewAttribution(prev => ({ ...prev, notes: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAdding(false)}>
                  <X className="h-3 w-3 mr-1" /> Cancel
                </Button>
                <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving}>
                  <Save className="h-3 w-3 mr-1" /> {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
