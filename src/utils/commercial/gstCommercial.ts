/**
 * GST treatment for Australian commercial property acquisitions.
 *
 *  - going_concern  : GST-free if both parties registered & supply meets ATO conditions
 *  - margin_scheme  : GST = 1/11th of MARGIN (sale price - prior acquisition cost)
 *  - plus_gst       : GST = 10% on top of the stated purchase price
 *  - standard       : GST = 1/11th of sale price (typically claimable as input credit)
 *  - input_taxed    : Rare for CRE (residential-style treatment)
 */

export type GstTreatment = 'going_concern' | 'margin_scheme' | 'plus_gst' | 'standard' | 'input_taxed';

export interface GstInputs {
  purchasePrice: number;
  treatment: GstTreatment;
  /** For margin scheme — prior owner's acquisition cost or pre-GST market value */
  priorCost?: number;
  /** Whether purchaser is GST-registered (can claim back) */
  purchaserRegistered?: boolean;
}

export interface GstResult {
  treatment: GstTreatment;
  gstAmount: number;
  gstClaimable: number;
  netAcquisitionCost: number;
  notes: string;
}

export function calculateCommercialGst(inputs: GstInputs): GstResult {
  const { purchasePrice, treatment, priorCost = 0, purchaserRegistered = true } = inputs;
  let gst = 0;
  let claimable = 0;
  let notes = '';

  switch (treatment) {
    case 'going_concern':
      gst = 0;
      notes = 'GST-free supply — both parties must be GST-registered and supply must qualify as a going concern.';
      break;
    case 'margin_scheme': {
      const margin = Math.max(0, purchasePrice - priorCost);
      gst = margin / 11;
      claimable = 0; // input credits not available under margin scheme
      notes = 'GST = 1/11 of margin. No input tax credit available to purchaser.';
      break;
    }
    case 'standard':
      gst = purchasePrice / 11;
      claimable = purchaserRegistered ? gst : 0;
      notes = purchaserRegistered
        ? 'GST included in price; recoverable as input tax credit.'
        : 'GST included in price; not recoverable (purchaser not registered).';
      break;
    case 'plus_gst':
      gst = purchasePrice * 0.1;
      claimable = purchaserRegistered ? gst : 0;
      notes = purchaserRegistered
        ? 'GST payable in addition to price; recoverable as input tax credit.'
        : 'GST payable in addition to price; not recoverable (purchaser not registered).';
      break;
    case 'input_taxed':
      gst = 0;
      notes = 'Input-taxed supply (uncommon for CRE).';
      break;
  }

  const netCost = purchasePrice + gst - claimable - (treatment === 'standard' ? gst : 0);
  // For standard treatment the price already includes GST; net = price - claimable
  const finalNet = treatment === 'standard' ? purchasePrice - claimable : purchasePrice + gst;

  return {
    treatment,
    gstAmount: Number(gst.toFixed(2)),
    gstClaimable: Number(claimable.toFixed(2)),
    netAcquisitionCost: Number(finalNet.toFixed(2)),
    notes,
  };
}
