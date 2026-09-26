import type { BuilderStockImage } from '@/lib/builderStock';
import type { MarketplaceStockPhoto } from '@/lib/marketplaceBuilderStock';

/**
 * Which pictures a builder property's gallery holds — see `BuilderStockGallery`.
 *
 * The network's photographs, in the order sent, at most twelve. Where none
 * have arrived yet, the card's own picture stands in, so the page never shows
 * less than the card.
 */
export const MAX_GALLERY_PHOTOS = 12;

export interface GalleryPicture {
  id: string;
  /** Drawn by `StockPicture`: an external URL is used as it stands. */
  image: BuilderStockImage;
  /** A URL a thumbnail can draw directly, when there is one. */
  url: string | null;
}

function photoAsImage(photo: MarketplaceStockPhoto): BuilderStockImage {
  return {
    id: photo.id,
    stock_item_id: null,
    source_stage: 'uploaded_document',
    source_reference: null,
    source_provider: null,
    source_page_url: null,
    external_url: photo.url,
    storage_path: null,
    content_type: photo.content_type,
    verification_status: 'source_supplied',
    confidence: null,
    processing_status: 'ready',
    error_message: null,
    position: photo.position,
    source_detail: null,
    created_at: '',
  };
}

export function galleryPictures(
  photos: MarketplaceStockPhoto[] | null | undefined,
  fallback: BuilderStockImage | null | undefined,
): GalleryPicture[] {
  const list = (photos ?? []).slice(0, MAX_GALLERY_PHOTOS);
  if (list.length) {
    return list.map((photo) => ({ id: photo.id, image: photoAsImage(photo), url: photo.url }));
  }
  if (!fallback) return [];
  return [{
    id: fallback.id,
    image: fallback,
    url: fallback.external_url && !fallback.storage_path ? fallback.external_url : null,
  }];
}

