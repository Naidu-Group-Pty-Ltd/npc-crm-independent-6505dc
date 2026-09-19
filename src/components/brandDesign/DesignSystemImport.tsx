/**
 * Pulling a design system in from Claude Design.
 *
 * ## What "pull" means here, honestly
 *
 * The app cannot call claude.ai/design. `DesignSync` is a Claude Code tool
 * authenticated by a person's own claude.ai login; the browser holds an
 * anonymous key and the edge functions a service-role one, and neither is a
 * design-system credential. So this consumes what Claude Design *exports*
 * rather than pretending to reach it, and the panel says so rather than leaving
 * somebody looking for a Connect button that cannot exist.
 *
 * Two files work, and a person will have whichever they have:
 *
 * - **`_ds_manifest.json`** — the compiled index. Its `tokens[]` are already
 *   parsed, and it also carries the theme list, the brand fonts and the card
 *   index, so the review line can say how big the system is.
 * - **`tokens/colors.css`** — the same information one step further back, for
 *   somebody who copied a file out of the project.
 *
 * ## The parse happens on the route
 *
 * Not here, although `import.pure.ts` is bridged and this component could. The
 * audit that gates every other design system runs server-side on the modules
 * the renderer uses, so the verdict shown is the one the document will get —
 * and a browser-side parse would be a second place the derivation lives, which
 * is the drift this repo keeps finding.
 */
import { useRef, useState } from 'react';
import { FileJson, Loader2, Upload } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MAX_IMPORT_CHARS } from '@/lib/brandDesign/import.pure';

export interface DesignSystemImportProps {
  onImport: (source: string, name: string) => void;
  pending?: boolean;
  /** The refusal, when the route refused. */
  error?: string | null;
  disabled?: boolean;
}

const ACCEPT = '.json,.css,application/json,text/css';

export function DesignSystemImport({ onImport, pending, error, disabled }: DesignSystemImportProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [fileName, setFileName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const take = async (file: File) => {
    setReadError(null);
    if (file.size > MAX_IMPORT_CHARS) {
      setReadError(
        `"${file.name}" is ${Math.round(file.size / 1024)} KB and the limit is `
        + `${Math.round(MAX_IMPORT_CHARS / 1024)} KB — a design system's tokens are far smaller.`,
      );
      return;
    }
    try {
      const text = await file.text();
      setSource(text);
      setFileName(file.name);
      // The file's own name is the best first guess, and a person can change it
      // before saving. An untitled system in a picker helps nobody.
      if (!name.trim() && !/^_?ds[_-]?manifest/i.test(file.name)) {
        setName(file.name.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 80));
      }
    } catch {
      setReadError(`"${file.name}" could not be read.`);
    }
  };

  const ready = source.trim().length > 0 && !pending && !disabled;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Pull one in from Claude Design</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Export a design system from{' '}
          <span className="font-medium">claude.ai/design</span> and drop it here. Its paper, ink,
          hairline and accent become the document's — not just the accent.
        </p>
      </div>

      {/* A drop target, and a paste box beneath it. Not a "Connect to Claude
          Design" button: there is no credential the browser could hold, and an
          affordance that cannot work is worse than none. */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void take(file);
        }}
        className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
        }`}
      >
        <FileJson className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-sm">
          Drop <code className="font-mono text-xs">_ds_manifest.json</code> or{' '}
          <code className="font-mono text-xs">tokens/colors.css</code>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={disabled || pending}
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="mr-2 h-3.5 w-3.5" aria-hidden />
          Choose a file
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void take(file);
            e.target.value = '';
          }}
        />
        {fileName && (
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            {fileName} · {Math.max(1, Math.round(source.length / 1024))} KB
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ds-import-source">Or paste the file contents</Label>
        <Textarea
          id="ds-import-source"
          rows={5}
          value={source}
          onChange={(e) => { setSource(e.target.value.slice(0, MAX_IMPORT_CHARS)); setFileName(''); }}
          placeholder={'{ "namespace": "…", "tokens": [ { "name": "--background", … } ] }'}
          className="font-mono text-xs"
          disabled={disabled || pending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ds-import-name">Call it</Label>
        <Input
          id="ds-import-name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="Taken from the design system's own name if you leave this blank"
          disabled={disabled || pending}
        />
      </div>

      {(readError || error) && (
        <Alert variant="destructive">
          <AlertTitle>{readError ? 'That file could not be read' : 'That design system was refused'}</AlertTitle>
          <AlertDescription>{readError ?? error}</AlertDescription>
        </Alert>
      )}

      <Button type="button" onClick={() => onImport(source, name.trim())} disabled={!ready}>
        {pending
          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          : <FileJson className="mr-2 h-4 w-4" aria-hidden />}
        {pending ? 'Reading…' : 'Read the design system'}
      </Button>

      <p className="text-xs text-muted-foreground">
        Nothing is saved yet. The specimens on the right redraw in the imported system so you can
        see what it does to a document before you keep it.
      </p>
    </div>
  );
}
