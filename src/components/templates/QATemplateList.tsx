import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  FileText, 
  Trash2, 
  Download, 
  Calendar,
  CheckCircle,
  Circle,
  AlertCircle
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { logActivityDirect } from '@/hooks/useActivityLogger';
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

interface QATemplate {
  id: string;
  name: string;
  description: string | null;
  file_name: string;
  file_path: string;
  file_size: number | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export function QATemplateList() {
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: templates, isLoading } = useQuery({
    queryKey: ['qa-export-templates'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'report_structure_templates',
        listOptions: {
          orderBy: 'created_at',
          orderAsc: false,
          filters: { template_type: 'qa_export' },
        },
      });

      if (error) throw new Error(error.message);
      return ((data as any)?.records || []) as QATemplate[];
    },
  });

  const handleToggleActive = async (template: QATemplate) => {
    setActivatingId(template.id);
    let previous: QATemplate[] | undefined;
    try {
      // Optimistic UI update so the Switch flips immediately
      previous = queryClient.getQueryData<QATemplate[]>(['qa-export-templates']);
      queryClient.setQueryData<QATemplate[]>(['qa-export-templates'], (old) => {
        const current = old || [];
        if (template.is_active) {
          return current.map((t) => (t.id === template.id ? { ...t, is_active: false } : t));
        }
        // Activating one template deactivates the rest
        return current.map((t) => ({ ...t, is_active: t.id === template.id }));
      });

      if (!template.is_active) {
        const otherActiveTemplates = (templates || []).filter((t) => t.is_active && t.id !== template.id);
        const results = await Promise.all(
          otherActiveTemplates.map((t) =>
            invokeSecureFunction('manage-templates', {
              operation: 'update',
              table: 'report_structure_templates',
              recordId: t.id,
              data: { is_active: false },
            })
          )
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);
      }

      const { error } = await invokeSecureFunction('manage-templates', {
        operation: 'update',
        table: 'report_structure_templates',
        recordId: template.id,
        data: { is_active: !template.is_active },
      });

      if (error) throw new Error(error.message || 'Failed to update template');

      toast({
        title: template.is_active ? 'Template deactivated' : 'Template activated',
        description: template.is_active
          ? 'The default template will be used for Q&A exports'
          : `"${template.name}" will now be used for Q&A exports`,
      });

      logActivityDirect({
        actionType: template.is_active ? 'template_deactivated' : 'template_activated',
        entityType: 'template',
        entityId: template.id,
        entityName: template.name,
        metadata: { template_type: 'qa_export' },
      });

      queryClient.invalidateQueries({ queryKey: ['qa-export-templates'] });
    } catch (error: any) {
      if (previous) {
        queryClient.setQueryData(['qa-export-templates'], previous);
      }
      toast({
        title: 'Error',
        description: error.message || 'Failed to update template status',
        variant: 'destructive',
      });
    } finally {
      setActivatingId(null);
    }
  };

  const handleDelete = async (template: QATemplate) => {
    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('report-templates')
        .remove([template.file_path]);

      if (storageError) {
        console.warn('Storage delete warning:', storageError);
      }

      // Delete from database
      const { error: dbError } = await supabase
        .from('report_structure_templates')
        .delete()
        .eq('id', template.id);

      if (dbError) throw dbError;

      toast({
        title: 'Template deleted',
        description: `"${template.name}" has been removed`,
      });

      logActivityDirect({
        actionType: 'template_deleted',
        entityType: 'template',
        entityId: template.id,
        entityName: template.name,
        metadata: { template_type: 'qa_export' },
      });

      queryClient.invalidateQueries({ queryKey: ['qa-export-templates'] });
    } catch (error: any) {
      toast({
        title: 'Delete failed',
        description: error.message || 'Failed to delete template',
        variant: 'destructive',
      });
    }
  };

  const handleDownload = async (template: QATemplate) => {
    try {
      const { data, error } = await supabase.storage
        .from('report-templates')
        .download(template.file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = template.file_name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: 'Downloaded',
        description: `"${template.file_name}" downloaded successfully`,
      });
    } catch (error: any) {
      toast({
        title: 'Download failed',
        description: error.message || 'Failed to download template',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (!templates || templates.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Q&A Export Templates</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Upload a PDF template to customize how Q&A conversations are exported. 
            The default hardcoded template will be used until you upload and activate a custom one.
          </p>
        </CardContent>
      </Card>
    );
  }

  const activeTemplate = templates.find(t => t.is_active);

  return (
    <div className="space-y-4">
      {/* Active template indicator */}
      {activeTemplate ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
          <CheckCircle className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">
            Active template: <span className="text-primary">{activeTemplate.name}</span>
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted border">
          <AlertCircle className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            No active template - using default styling for Q&A exports
          </span>
        </div>
      )}

      {/* Template list */}
      <div className="space-y-3">
        {templates.map((template) => (
          <Card 
            key={template.id} 
            className={template.is_active ? 'border-primary/50 bg-primary/5' : ''}
          >
            <CardContent className="py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="p-2 rounded-lg bg-muted">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold truncate">{template.name}</h4>
                      {template.is_active && (
                        <Badge variant="default" className="shrink-0">Active</Badge>
                      )}
                    </div>
                    {template.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                        {template.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {template.file_name}
                      </span>
                      {template.file_size && (
                        <span>{(template.file_size / 1024).toFixed(1)} KB</span>
                      )}
                      {template.created_at && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDistanceToNow(new Date(template.created_at), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {/* Active toggle */}
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`active-${template.id}`}
                      checked={template.is_active ?? false}
                      onCheckedChange={() => handleToggleActive(template)}
                      disabled={activatingId === template.id}
                    />
                    <Label 
                      htmlFor={`active-${template.id}`} 
                      className="text-xs text-muted-foreground cursor-pointer"
                    >
                      {template.is_active ? 'Active' : 'Inactive'}
                    </Label>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDownload(template)}
                      title="Download template"
                    >
                      <Download className="h-4 w-4" />
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="rounded-full text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/40"
                          title={`Delete template ${template.name}`}
                          aria-label={`Delete template ${template.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="border-destructive/25 bg-background text-foreground shadow-2xl shadow-destructive/10 sm:max-w-md">
                        <AlertDialogHeader className="space-y-3">
                          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive sm:mx-0">
                            <Trash2 className="h-5 w-5" />
                          </div>
                          <AlertDialogTitle className="text-destructive">Delete template?</AlertDialogTitle>
                          <AlertDialogDescription className="space-y-2 text-left text-muted-foreground">
                            <span className="block">
                              This will permanently delete <span className="font-medium text-foreground">{template.name}</span>.
                            </span>
                            <span className="block">This action cannot be undone.</span>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="gap-2 sm:gap-0">
                          <AlertDialogCancel className="border-border bg-background text-foreground hover:bg-muted">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(template)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/40"
                          >
                            Delete template
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
