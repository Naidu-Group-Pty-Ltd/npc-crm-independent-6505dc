/**
 * StyleClipboardButtons — header-level copy/paste-style buttons for an
 * overlay. Designed to live next to Duplicate/Delete in OverlayEditor.
 */
import { Clipboard, ClipboardCopy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { Overlay } from '@/lib/reportTemplate/templateSchema';
import {
  copyOverlayStyle,
  pasteOverlayStyle,
  hasOverlayStyle,
} from '@/lib/reportTemplate/styleClipboard';

interface Props {
  overlay: Overlay;
  onChange: (next: Overlay) => void;
}

export function StyleClipboardButtons({ overlay, onChange }: Props) {
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        title="Copy style"
        onClick={() => {
          copyOverlayStyle(overlay);
          toast.success('Style copied');
        }}
      >
        <ClipboardCopy className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        title="Paste style"
        disabled={!hasOverlayStyle()}
        onClick={() => {
          const next = pasteOverlayStyle(overlay);
          onChange(next);
          toast.success('Style pasted');
        }}
      >
        <Clipboard className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}
