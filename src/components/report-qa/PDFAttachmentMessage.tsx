import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Download, Mail, FileText, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PDFAttachment {
  url: string;
  fileName: string;
  fileSize: number;
  createdAt: string;
  conversationId?: string;
}

interface PDFAttachmentMessageProps {
  attachment: PDFAttachment;
  onSendViaEmail: (attachment: PDFAttachment) => void;
  className?: string;
}

export const PDFAttachmentMessage: React.FC<PDFAttachmentMessageProps> = ({
  attachment,
  onSendViaEmail,
  className,
}) => {
  const [isDownloading, setIsDownloading] = React.useState(false);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(attachment.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenInNewTab = () => {
    window.open(attachment.url, '_blank');
  };

  return (
    <Card className={cn("bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20", className)}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* PDF Icon */}
          <div className="flex-shrink-0 p-3 bg-primary/10 rounded-lg">
            <FileText className="h-8 w-8 text-primary" />
          </div>
          
          {/* File Info */}
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-foreground truncate">
              {attachment.fileName}
            </h4>
            <p className="text-sm text-muted-foreground mt-0.5">
              {formatFileSize(attachment.fileSize)} • Generated {new Date(attachment.createdAt).toLocaleString('en-AU')}
            </p>
            
            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                disabled={isDownloading}
                className="gap-1.5"
              >
                {isDownloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Download
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenInNewTab}
                className="gap-1.5"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </Button>
              
              <Button
                variant="default"
                size="sm"
                onClick={() => onSendViaEmail(attachment)}
                className="gap-1.5 bg-primary hover:bg-primary/90"
              >
                <Mail className="h-3.5 w-3.5" />
                Send via Email Copilot
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PDFAttachmentMessage;
