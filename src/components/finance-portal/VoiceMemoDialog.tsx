/**
 * Batch 4 #26 — Voice Memo capture + AI transcription.
 * Records up to 90s of audio via the browser MediaRecorder API, base64-encodes,
 * and posts to the AI Copilot for transcription + summary.
 */
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Mic, Square, Loader2, Sparkles } from 'lucide-react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { toast } from 'sonner';

export function VoiceMemoDialog({
  open, onOpenChange, purchaseFileId, clientId,
}: { open: boolean; onOpenChange: (v: boolean) => void; purchaseFileId?: string; clientId?: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState('');
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) { stop(); setTranscript(''); setSummary(''); setElapsed(0); }
  }, [open]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => stream.getTracks().forEach(t => t.stop());
      rec.start();
      setRecording(true); setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed(e => {
        if (e >= 89) { stop(); return 90; }
        return e + 1;
      }), 1000);
    } catch {
      toast.error('Microphone access denied');
    }
  };

  const stop = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop();
    setRecording(false);
  };

  const transcribe = async () => {
    if (chunksRef.current.length === 0) { toast.error('No audio captured'); return; }
    setTranscribing(true);
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const buf = await blob.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const { data, error } = await invokeFinanceFunction('finance-portal-ai-copilot', {
      action: 'transcribe_voice', audio_base64: b64, duration_seconds: elapsed,
      purchase_file_id: purchaseFileId ?? null, client_id: clientId ?? null,
    });
    setTranscribing(false);
    if (error) toast.error(error.message || 'Transcription failed');
    else {
      setTranscript(data.memo?.transcript ?? '');
      setSummary(data.memo?.summary ?? '');
      toast.success('Voice note transcribed & saved');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="inline-flex items-center gap-2"><Mic className="h-4 w-4 text-primary" /> Voice Memo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-center py-4">
            {!recording && !transcript ? (
              <Button size="lg" onClick={start} className="h-16 w-16 rounded-full"><Mic className="h-6 w-6" /></Button>
            ) : recording ? (
              <Button size="lg" onClick={stop} variant="destructive" className="h-16 w-16 rounded-full"><Square className="h-6 w-6" /></Button>
            ) : null}
          </div>
          {(recording || elapsed > 0) && (
            <div className="text-center text-sm tabular-nums text-muted-foreground">
              {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')} / 01:30
            </div>
          )}
          {!recording && elapsed > 0 && !transcript && (
            <Button onClick={transcribe} disabled={transcribing} className="w-full">
              {transcribing ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
              Transcribe & save
            </Button>
          )}
          {transcript && (
            <div className="space-y-2">
              {summary && <div className="text-xs italic text-muted-foreground border-l-2 border-primary/50 pl-2">{summary}</div>}
              <Textarea value={transcript} onChange={e => setTranscript(e.target.value)} rows={6} />
              <Button onClick={() => onOpenChange(false)} className="w-full">Done</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
