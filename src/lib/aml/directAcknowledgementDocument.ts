/**
 * The executed copy of a direct partner acknowledgement.
 *
 * Rendered and stored by `partner-agreement-records`, the one function that
 * builds executed-agreement PDFs — a second renderer would eventually
 * produce a second-looking document for the same instrument. The copy is
 * written once and never overwritten, so the bytes a partner holds are the
 * bytes the Command Centre holds.
 */
import { invokeSecureFunction } from "@/lib/secureInvoke";

export interface DirectAcknowledgementDownload {
  url: string;
  file_name: string;
  expires_in: number;
  /** The revision the FUNCTION is running — merging is not deploying. */
  document_revision?: number;
}

export async function downloadDirectAcknowledgement(
  acknowledgement_id: string,
): Promise<DirectAcknowledgementDownload> {
  const { data, error } = await invokeSecureFunction<DirectAcknowledgementDownload>(
    "partner-agreement-records",
    { operation: "download_direct_acknowledgement", acknowledgement_id },
  );
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error(String((data as any).error));
  return data as DirectAcknowledgementDownload;
}
