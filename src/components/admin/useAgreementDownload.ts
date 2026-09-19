import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { agreementServiceState } from '@/lib/reports/partnerAgreement/revision.pure';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { deliverSignedDownload } from './deliverSignedDownload';


/**
 * Download a partner's executed agreement from wherever the Command Centre is
 * already looking at that partner.
 *
 * The dedicated Agreements section lists every executed agreement, which is the
 * right place to audit them — but it is the wrong place to be when a partner
 * rings up and asks for their copy. At that moment a staff user is looking at
 * the partner's row, and the answer should be one menu item away rather than a
 * tab away and a search away.
 *
 * So this asks by PORTAL USER, not by acceptance: a row knows who it is, not
 * which of that person's acceptances is current. The server resolves the most
 * recent acceptance for that user, generates the copy if it has not been
 * generated yet, and returns a short-lived signed URL.
 *
 * A partner who has not accepted anything has no copy, and the caller is told
 * that plainly rather than being handed an empty PDF.
 */
export function useAgreementDownload() {
  const [downloadingUserId, setDownloadingUserId] = useState<string | null>(null);

  const downloadForUser = useCallback(async (
    portal: 'solicitor' | 'builder' | 'finance',
    portalUserId: string,
    partnerLabel?: string,
  ) => {
    setDownloadingUserId(portalUserId);
    try {
      const { data, error } = await invokeSecureFunction('partner-agreement-records', {
        operation: 'download_record',
        portal,
        portal_user_id: portalUserId,
      });

      if ((data as any)?.code === 'NO_AGREEMENT_ON_RECORD') {
        toast.info(
          partnerLabel
            ? `${partnerLabel} has not accepted the agreement yet, so there is no copy to supply.`
            : 'This partner has not accepted the agreement yet, so there is no copy to supply.',
        );
        return;
      }
      if (error || !data?.success || !data?.url) {
        throw new Error((data as any)?.error || error?.message || 'The copy could not be produced');
      }

      await deliverSignedDownload(data.url as string, (data as any)?.file_name);

      // Which document did they just hand a partner? This action never calls
      // `list_records`, so the panel's banner cannot help here — and this is the
      // path a copy is most often supplied through, with a partner waiting on
      // the phone. A function older than this build renders the previous
      // format, and saying so afterwards is far better than not saying it.
      const revision = (data as any)?.document_revision;
      if (agreementServiceState(typeof revision === 'number' ? revision : 1) === 'behind') {
        toast.warning(
          'Downloaded in the previous document format — the agreement service has not been '
          + 'deployed yet. Re-issue from the Agreements section once it has.',
        );
      } else {
        toast.success('The executed agreement is downloading.');
      }
    } catch (e: any) {
      toast.error(e?.message || 'The copy could not be produced');
    } finally {
      setDownloadingUserId(null);
    }
  }, []);

  return { downloadForUser, downloadingUserId };
}
