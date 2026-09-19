/**
 * Shared DocuSign free-form (positional) tagging helper.
 *
 * Used by both `manage-agency-agreements` and `manage-generated-documents`
 * for the in-app visual tagger ("Prepare for Signing" modal).
 *
 * Coordinates: DocuSign uses POINTS (72/inch), top-left origin per page.
 * The frontend renders the PDF with pdf.js and records tab positions in
 * PDF points directly so we don't have to convert here.
 */

export type FreeformRecipient = {
  id: string;
  name: string;
  email: string;
  roleLabel?: string; // e.g. "Primary Buyer"
  routingOrder?: number; // 1-based; default 1 → parallel
};

export type FreeformTabType =
  | 'signature'
  | 'initial'
  | 'dateSigned'
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'emailAddress'
  | 'title'
  | 'company'
  | 'text'
  | 'number'
  | 'checkbox'
  | 'note'
  | 'approve'
  | 'decline';

export type FreeformTab = {
  id: string;
  recipientId: string;
  type: FreeformTabType;
  page: number; // 1-based
  x: number; // PDF points, top-left origin
  y: number; // PDF points, top-left origin
  width?: number; // points; required for text/number/checkbox/etc
  height?: number; // points
  required?: boolean;
  label?: string; // tooltip
  defaultValue?: string;
  locked?: boolean;
};

const TAB_KEY: Record<FreeformTabType, string> = {
  signature: 'signHereTabs',
  initial: 'initialHereTabs',
  dateSigned: 'dateSignedTabs',
  fullName: 'fullNameTabs',
  firstName: 'firstNameTabs',
  lastName: 'lastNameTabs',
  emailAddress: 'emailAddressTabs',
  title: 'titleTabs',
  company: 'companyTabs',
  text: 'textTabs',
  number: 'numberTabs',
  checkbox: 'checkboxTabs',
  note: 'noteTabs',
  approve: 'approveTabs',
  decline: 'declineTabs',
};

function buildTabPayload(tab: FreeformTab) {
  const payload: Record<string, unknown> = {
    documentId: '1',
    pageNumber: String(tab.page),
    xPosition: String(Math.round(tab.x)),
    yPosition: String(Math.round(tab.y)),
    tabLabel: tab.label || `${tab.type}_${tab.id.slice(0, 6)}`,
  };
  if (tab.width) payload.width = String(Math.round(tab.width));
  if (tab.height) payload.height = String(Math.round(tab.height));
  if (tab.required !== undefined) payload.required = String(tab.required);
  if (tab.locked) payload.locked = 'true';
  if (tab.defaultValue !== undefined) payload.value = String(tab.defaultValue);
  if (tab.type === 'text' || tab.type === 'number') {
    payload.font = 'Helvetica';
    payload.fontSize = 'Size10';
  }
  return payload;
}

function buildRecipientTabs(tabs: FreeformTab[]): Record<string, unknown[]> {
  const grouped: Record<string, unknown[]> = {};
  for (const t of tabs) {
    const key = TAB_KEY[t.type];
    if (!key) continue;
    (grouped[key] ||= []).push(buildTabPayload(t));
  }
  return grouped;
}

export function buildFreeformEnvelope(opts: {
  pdfBase64: string;
  documentName: string;
  recipients: FreeformRecipient[];
  tabs: FreeformTab[];
  emailSubject: string;
  emailBlurb?: string;
}) {
  const signers = opts.recipients.map((r, idx) => {
    const recipientTabs = opts.tabs.filter((t) => t.recipientId === r.id);
    return {
      email: r.email,
      name: r.name,
      recipientId: String(idx + 1),
      // Map our internal recipient ID stably onto position so tabs link up
      clientUserId: undefined,
      routingOrder: String(r.routingOrder ?? 1),
      tabs: buildRecipientTabs(recipientTabs),
    };
  });

  return {
    emailSubject: opts.emailSubject,
    emailBlurb: opts.emailBlurb || '',
    documents: [
      {
        documentBase64: opts.pdfBase64,
        name: opts.documentName,
        fileExtension: 'pdf',
        documentId: '1',
      },
    ],
    recipients: { signers },
    status: 'sent',
  };
}

export function pdfBytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(bin);
}
