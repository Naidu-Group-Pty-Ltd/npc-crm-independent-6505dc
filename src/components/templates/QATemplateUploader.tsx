import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, Loader2, FileText, CheckCircle, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { Badge } from '@/components/ui/badge';
import { secureStorageUpload } from '@/hooks/useSecureStorage';

interface QATemplateUploaderProps {
  onUploadComplete?: () => void;
}

export function QATemplateUploader({ onUploadComplete }: QATemplateUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === 'application/pdf') {
        setFile(droppedFile);
        // Create preview URL for PDF
        setPreviewUrl(URL.createObjectURL(droppedFile));
      } else {
        toast({
          title: 'Invalid file type',
          description: 'Please upload a PDF file',
          variant: 'destructive',
        });
      }
    }
  }, [toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type === 'application/pdf') {
        setFile(selectedFile);
        setPreviewUrl(URL.createObjectURL(selectedFile));
      } else {
        toast({
          title: 'Invalid file type',
          description: 'Please upload a PDF file',
          variant: 'destructive',
        });
      }
    }
  };

  const handlePreview = () => {
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    }
  };

  const handleUpload = async () => {
    if (!file || !name) {
      toast({
        title: 'Missing information',
        description: 'Please provide a name and select a PDF file',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);

    try {
      // Generate storage path
      const filePath = `qa_export/${Date.now()}-${file.name}`;

      // Upload file to secure storage
      const uploadResult = await secureStorageUpload('report-templates', filePath, file, {
        contentType: file.type
      });

      if (!uploadResult.success) throw new Error(uploadResult.error || 'Upload failed');

      // Create database record with qa_export template type
      const insertData = {
        name,
        description: description || null,
        template_type: 'qa_export' as const,
        report_tier: null,
        report_category: null,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type,
        is_active: false,
        priority: 0,
        metadata: {
          purpose: 'qa_export',
          uploadedAt: new Date().toISOString(),
        },
      };

      const { data: template, error: dbError } = await supabase
        .from('report_structure_templates')
        .insert(insertData)
        .select()
        .single();

      if (dbError) throw dbError;

      // Log activity
      logActivityDirect({
        actionType: 'template_uploaded',
        entityType: 'template',
        entityId: template.id,
        entityName: name,
        metadata: {
          template_type: 'qa_export',
          file_name: file.name,
          file_size: file.size,
        },
      });

      toast({
        title: 'Template uploaded',
        description: 'Q&A Export PDF template has been saved. You can now activate it for use.',
      });

      // Reset form
      setFile(null);
      setName('');
      setDescription('');
      setPreviewUrl(null);

      // Refresh templates list
      queryClient.invalidateQueries({ queryKey: ['report-structure-templates'] });
      queryClient.invalidateQueries({ queryKey: ['qa-export-templates'] });
      
      onUploadComplete?.();

    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload failed',
        description: error.message || 'Failed to upload template',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Upload Q&A Export Template
        </CardTitle>
        <CardDescription>
          Upload a PDF template that will be used as the visual framework for Q&A conversation exports.
          The template should have placeholder areas where conversation content will be inserted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Template requirements info */}
        <div className="rounded-lg bg-muted/50 p-4 space-y-2">
          <h4 className="text-sm font-semibold">Template Requirements:</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              <span>Upload a PDF document that serves as the visual template</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              <span>The cover page design, fonts, and colors will be extracted</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              <span>Content pages will maintain consistent styling and headers</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              <span>Supports bold, italic, underline, headers, and lists</span>
            </li>
          </ul>
        </div>

        {/* Drag and drop zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`
            relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
            ${dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
            ${file ? 'bg-primary/5 border-primary' : ''}
          `}
        >
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          
          {file ? (
            <div className="flex flex-col items-center gap-3">
              <CheckCircle className="h-10 w-10 text-primary" />
              <div className="text-center">
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <div className="flex gap-2">
                <Badge variant="secondary">PDF Template</Badge>
                {previewUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePreview}
                    className="gap-1"
                  >
                    <Eye className="h-3 w-3" />
                    Preview
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drag and drop or click to upload
              </p>
              <p className="text-xs text-muted-foreground">
                Accepted: PDF files only (.pdf)
              </p>
            </div>
          )}
        </div>

        {/* Template details */}
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="qa-template-name">Template Name *</Label>
            <Input
              id="qa-template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Q&A Export Template v1"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qa-template-description">Description</Label>
            <Textarea
              id="qa-template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this template's design and purpose..."
              rows={3}
            />
          </div>
        </div>

        <Button
          onClick={handleUpload}
          disabled={!file || !name || isUploading}
          className="w-full"
        >
          {isUploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading Template...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Upload Q&A Export Template
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
