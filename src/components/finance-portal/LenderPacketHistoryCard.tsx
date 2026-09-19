import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Package, Download, AlertTriangle, FileCheck2, Loader2 } from 'lucide-react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { formatDistanceToNow } from 'date-fns';

interface PacketRow {
  id: string;
  lender_name: string | null;
  filename: string;
  file_count: number;
  total_size_bytes: number | null;
  missing_required_count: number;
  download_count: number;
  last_downloaded_at: string | null;
  generated_by_email: string | null;
  created_at: string;
}

export function LenderPacketHistoryCard({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [rows, setRows] = useState<PacketRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await invokeFinanceFunction('finance-portal-lender-packet', {
        operation: 'list_packets', purchase_file_id: fileId,
      });
      setRows((data as any)?.packets || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fileId]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Package className="h-4 w-4" /> Lender Packet History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No packets generated yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map(r => (
              <li key={r.id} className="flex items-start justify-between gap-3 rounded-md border p-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.filename}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {r.lender_name || 'Lender'} · {r.file_count} files · {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    {r.generated_by_email && ` · ${r.generated_by_email}`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {r.missing_required_count > 0 ? (
                    <Badge variant="outline" className="text-brand-500 border-brand-500/30">
                      <AlertTriangle className="h-3 w-3 mr-1" /> {r.missing_required_count} gap{r.missing_required_count === 1 ? '' : 's'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-success border-success/30">
                      <FileCheck2 className="h-3 w-3 mr-1" /> Complete
                    </Badge>
                  )}
                  {r.download_count > 0 && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Download className="h-3 w-3" /> {r.download_count}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button size="sm" variant="ghost" className="mt-3" onClick={load}>Refresh</Button>
      </CardContent>
    </Card>
  );
}
