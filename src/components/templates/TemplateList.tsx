import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, Trash2, RefreshCw, Download, Eye, Loader2, FileCode, CheckCircle, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { secureStorageDownload } from '@/hooks/useSecureStorage';

interface Template {
  id: string;
  name: string;
  description: string | null;
  template_type: string;
  report_tier: string | null;
  report_category: string | null;
  file_name: string;
  file_path: string;
  file_size: number | null;
  is_active: boolean | null;
  priority: number | null;
  parsed_content: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface TemplateListProps {
  templates: Template[];
  isLoading: boolean;
  templateType: string;
}

// Check if parsed content is valid markdown (not binary PDF data)
function isValidMarkdown(content: string | null): boolean {
  if (!content || content.length < 50) return false;
  
  // Binary PDF data contains these patterns
  const binaryPatterns = [
    'endstream',
    'endobj',
    '/Type /XObject',
    '/FlateDecode',
    'stream\n',
  ];
  
  for (const pattern of binaryPatterns) {
    if (content.includes(pattern)) return false;
  }
  
  // Valid markdown should have readable text
  const printableRatio = (content.match(/[\x20-\x7E\n]/g)?.length || 0) / content.length;
  return printableRatio > 0.9;
}

export function TemplateList({ templates, isLoading, templateType }: TemplateListProps) {
  const [parsingId, setParsingId] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Toggle active status
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await invokeSecureFunction('manage-templates', {
        operation: 'update',
        table: 'report_structure_templates',
        recordId: id,
        data: { is_active: isActive, updated_at: new Date().toISOString() },
      });

      if (error) throw new Error(error.message || 'Failed to update template');
    },
    onMutate: async ({ id, isActive }) => {
      await queryClient.cancelQueries({ queryKey: ['report-structure-templates'] });
      const previous = queryClient.getQueryData<Template[]>(['report-structure-templates']);

      // Optimistically update UI so Switch flips immediately
      queryClient.setQueryData<Template[]>(['report-structure-templates'], (old) =>
        (old || []).map((t) => (t.id === id ? { ...t, is_active: isActive } : t))
      );

      return { previous };
    },
    onError: (error: any, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['report-structure-templates'], context.previous);
      }
      toast({
        title: 'Update failed',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSuccess: () => {
      toast({ title: 'Template status updated' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['report-structure-templates'] });
    },
  });

  // Delete template
  const deleteMutation = useMutation({
    mutationFn: async (template: Template) => {
      // Delete from storage
      await supabase.storage
        .from('report-templates')
        .remove([template.file_path]);

      // Delete document chunks (for AI templates)
      await supabase
        .from('document_chunks')
        .delete()
        .eq('document_name', `template:${template.id}`);

      // Delete from database
      const { error } = await supabase
        .from('report_structure_templates')
        .delete()
        .eq('id', template.id);
      
      if (error) throw error;
      return template;
    },
    onSuccess: (template) => {
      queryClient.invalidateQueries({ queryKey: ['report-structure-templates'] });
      toast({ title: 'Template deleted' });
      
      // Log activity
      logActivityDirect({
        actionType: 'template_deleted',
        entityType: 'template',
        entityId: template.id,
        entityName: template.name,
        metadata: {
          template_type: template.template_type,
          file_name: template.file_name,
        },
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Delete failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Convert PDF to Markdown using AI
  const handleConvertToMarkdown = async (template: Template) => {
    setParsingId(template.id);
    
    toast({
      title: 'Converting PDF to Markdown...',
      description: 'Using AI to extract structured content. This may take 30-60 seconds.',
    });
    
    try {
      const { data, error } = await invokeSecureFunction('parse-template-document', {
        templateId: template.id,
        filePath: template.file_path,
        templateType: template.template_type,
        reportTier: template.report_tier,
        reportCategory: template.report_category,
        useAIExtraction: true,
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Conversion failed');
      }

      toast({
        title: 'Conversion complete!',
        description: `Extracted ${data.extractedLength.toLocaleString('en-AU')} characters, created ${data.chunksCreated} embeddings`,
      });
      
      queryClient.invalidateQueries({ queryKey: ['report-structure-templates'] });
    } catch (error: any) {
      console.error('Conversion error:', error);
      toast({
        title: 'Conversion failed',
        description: error.message || 'Failed to convert PDF to Markdown',
        variant: 'destructive',
      });
    } finally {
      setParsingId(null);
    }
  };

  // Download template via secure storage
  const handleDownload = async (template: Template) => {
    try {
      const result = await secureStorageDownload('report-templates', template.file_path);

      if (!result.success || !result.blob) {
        throw new Error(result.error || 'Download failed');
      }

      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = template.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({
        title: 'Download failed',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  // Download extracted markdown
  const handleDownloadMarkdown = (template: Template) => {
    if (!template.parsed_content) return;
    
    const blob = new Blob([template.parsed_content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.name.replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getTierBadge = (tier: string | null) => {
    if (!tier) return null;
    const colors: Record<string, string> = {
      compass: 'bg-info/10 text-info',
      executive: 'bg-accent/10 text-accent',
      snapshot: 'bg-success/10 text-success',
    };
    return (
      <Badge variant="outline" className={colors[tier] || ''}>
        {tier}
      </Badge>
    );
  };

  const getCategoryBadge = (category: string | null) => {
    if (!category) return null;
    const labels: Record<string, string> = {
      investment: 'Investment',
      comparison: 'Comparison',
      cash_flow: 'Cash Flow',
      suburb_snapshot: 'Suburb',
    };
    return (
      <Badge variant="secondary">
        {labels[category] || category}
      </Badge>
    );
  };

  const getParseStatusBadge = (template: Template) => {
    const hasContent = template.parsed_content && template.parsed_content.length > 0;
    const isValid = isValidMarkdown(template.parsed_content);
    
    if (!hasContent) {
      return (
        <Badge variant="outline" className="bg-brand-500/10 text-brand-500">
          Not parsed
        </Badge>
      );
    }
    
    if (!isValid) {
      return (
        <Badge variant="outline" className="bg-destructive/10 text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Binary data
        </Badge>
      );
    }
    
    return (
      <Badge variant="outline" className="bg-success/10 text-success flex items-center gap-1">
        <CheckCircle className="h-3 w-3" />
        {(template.parsed_content!.length / 1000).toFixed(1)}k chars
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No templates uploaded yet</p>
        <p className="text-sm">Upload a template using the form above</p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Template</TableHead>
            <TableHead>Tier</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Active</TableHead>
            <TableHead>Content Status</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.map((template) => {
            const hasValidContent = isValidMarkdown(template.parsed_content);
            const needsConversion = template.file_name.toLowerCase().endsWith('.pdf') && !hasValidContent;
            
            return (
              <TableRow key={template.id}>
                <TableCell>
                  <div>
                    <p className="font-medium">{template.name}</p>
                    <p className="text-xs text-muted-foreground">{template.file_name}</p>
                  </div>
                </TableCell>
                <TableCell>{getTierBadge(template.report_tier)}</TableCell>
                <TableCell>{getCategoryBadge(template.report_category)}</TableCell>
                <TableCell>
                  <Switch
                    checked={template.is_active || false}
                    onCheckedChange={(checked) =>
                      toggleActiveMutation.mutate({ id: template.id, isActive: checked })
                    }
                  />
                </TableCell>
                <TableCell>{getParseStatusBadge(template)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {template.updated_at
                    ? format(new Date(template.updated_at), 'MMM d, yyyy')
                    : '-'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {/* Convert to Markdown button - show prominently if needed */}
                    {templateType === 'ai_structure' && needsConversion && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleConvertToMarkdown(template)}
                        disabled={parsingId === template.id}
                        className="mr-2"
                      >
                        {parsingId === template.id ? (
                          <>
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            Converting...
                          </>
                        ) : (
                          <>
                            <FileCode className="mr-1 h-3 w-3" />
                            Convert to MD
                          </>
                        )}
                      </Button>
                    )}
                    
                    {/* Re-convert button for already converted templates */}
                    {templateType === 'ai_structure' && !needsConversion && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleConvertToMarkdown(template)}
                        disabled={parsingId === template.id}
                        title="Re-convert to Markdown"
                      >
                        {parsingId === template.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    
                    {/* Preview extracted content */}
                    {hasValidContent && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setPreviewTemplate(template)}
                        title="Preview extracted content"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                    
                    {/* Download original */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDownload(template)}
                      title="Download original"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    
                    {/* Download as Markdown */}
                    {hasValidContent && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownloadMarkdown(template)}
                        title="Download as Markdown"
                      >
                        <FileCode className="h-4 w-4" />
                      </Button>
                    )}
                    
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={`Delete template ${template.name}`}
                          aria-label={`Delete template ${template.name}`}
                          className="rounded-full text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/40"
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
                            <span className="block">
                              The template file and all associated embeddings will be removed. This cannot be undone.
                            </span>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="gap-2 sm:gap-0">
                          <AlertDialogCancel className="border-border bg-background text-foreground hover:bg-muted">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMutation.mutate(template)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/40"
                          >
                            Delete template
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Content Preview Dialog */}
      <Dialog open={!!previewTemplate} onOpenChange={() => setPreviewTemplate(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] w-[95vw] sm:w-auto">
          <DialogHeader>
            <DialogTitle>
              Extracted Content: {previewTemplate?.name}
            </DialogTitle>
            <DialogDescription>
              {previewTemplate?.parsed_content?.length.toLocaleString('en-AU')} characters of Markdown content
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[50vh] sm:h-[60vh] w-full rounded-md border p-3 sm:p-4">
            <pre className="text-xs sm:text-sm whitespace-pre-wrap font-mono break-words">
              {previewTemplate?.parsed_content}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
