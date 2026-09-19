import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2, Check, Layers } from 'lucide-react';
import { useCoverPageOverlays } from '@/hooks/useCoverPageOverlays';
import { CoverPageEditor } from './CoverPageEditor';
import { REPORT_TYPE_OPTIONS } from './types';
import type { CoverPageOverlay } from './types';

export function CoverPageOverlayManager() {
  const { overlays, isLoading, saveMutation, deleteMutation } = useCoverPageOverlays();
  const [editingOverlay, setEditingOverlay] = useState<Partial<CoverPageOverlay> | null>(null);

  const getReportTypeLabel = (type: string) =>
    REPORT_TYPE_OPTIONS.find(o => o.value === type)?.label || type;

  if (editingOverlay) {
    return (
      <CoverPageEditor
        overlay={editingOverlay}
        onSave={(data) => {
          saveMutation.mutate(data as any, {
            onSuccess: () => setEditingOverlay(null),
          });
        }}
        onCancel={() => setEditingOverlay(null)}
        isSaving={saveMutation.isPending}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Cover Page Overlays
            </CardTitle>
            <CardDescription>
              Visual editor for configuring text and image overlays on report cover pages. 
              Existing cover pages will continue to work — these overlays are additive.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setEditingOverlay({ overlay_elements: [] })}>
            <Plus className="h-4 w-4 mr-1" /> New Overlay
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
        ) : overlays.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No cover page overlays configured yet. Click "New Overlay" to create one.
          </div>
        ) : (
          <div className="space-y-2">
            {overlays.map(overlay => (
              <div
                key={overlay.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div className="font-medium text-sm">{overlay.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {getReportTypeLabel(overlay.report_type)} · {(overlay.overlay_elements as any[])?.length || 0} elements
                    </div>
                  </div>
                  {overlay.is_active && (
                    <Badge variant="default" className="text-xs">
                      <Check className="h-3 w-3 mr-1" /> Active
                    </Badge>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingOverlay(overlay)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    onClick={() => {
                      if (confirm('Delete this overlay configuration?')) {
                        deleteMutation.mutate(overlay.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
