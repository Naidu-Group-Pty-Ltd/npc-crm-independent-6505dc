/**
 * PDF to Images Conversion Utility
 * Uses PDF.js to render PDF pages as PNG images for GPT-4o Vision analysis.
 * 
 * Supports documents of any size (100+ pages) with adaptive rendering:
 * - Small docs (≤20 pages): render all at high quality
 * - Medium docs (21-50 pages): render all at medium quality  
 * - Large docs (51-100 pages): smart sample ~50 pages at compressed quality
 * - Very large docs (100+ pages): strategic sampling with aggressive compression
 */

import { loadPdfjs as getPdfJs } from '@/lib/pdf/pdfjs';

export interface PdfPageImage {
  pageNumber: number;
  base64: string;
  width: number;
  height: number;
  /** Actual encoding of `base64` — 'image/png' or 'image/jpeg'. */
  mimeType: 'image/png' | 'image/jpeg';
}

export interface PdfConversionResult {
  success: boolean;
  images: PdfPageImage[];
  totalPages: number;
  error?: string;
}

// ============= RENDERING CONFIGURATION =============

/** Absolute maximum pages we'll ever render (memory safety) */
const ABSOLUTE_MAX_PAGES = 60;

/** Thresholds for adaptive quality */
const SMALL_DOC_THRESHOLD = 20;
const MEDIUM_DOC_THRESHOLD = 50;

/** Render scales by document size tier */
const SCALE_HIGH = 2.0;       // Small docs: crisp text
const SCALE_MEDIUM = 1.5;     // Medium docs: good balance
const SCALE_COMPRESSED = 1.2; // Large docs: save memory

/** Max pixel dimension per page to avoid memory blowouts */
const MAX_DIMENSION = 2048;

/** Image format settings per tier */
interface RenderConfig {
  scale: number;
  format: 'image/png' | 'image/jpeg';
  quality: number | undefined;
  maxPages: number;
}

function getRenderConfig(totalPages: number): RenderConfig {
  if (totalPages <= SMALL_DOC_THRESHOLD) {
    return { scale: SCALE_HIGH, format: 'image/png', quality: undefined, maxPages: totalPages };
  }
  if (totalPages <= MEDIUM_DOC_THRESHOLD) {
    return { scale: SCALE_MEDIUM, format: 'image/jpeg', quality: 0.85, maxPages: totalPages };
  }
  // Large docs: sample strategically
  return { scale: SCALE_COMPRESSED, format: 'image/jpeg', quality: 0.75, maxPages: ABSOLUTE_MAX_PAGES };
}

/**
 * Convert a PDF file to an array of base64 PNG/JPEG images.
 * Automatically adapts quality and page selection based on document size.
 */
export async function convertPdfToImages(
  pdfFile: File,
  onProgress?: (current: number, total: number) => void
): Promise<PdfConversionResult> {
  try {
    console.log('🔄 Starting PDF to image conversion:', pdfFile.name, `(${(pdfFile.size / 1024 / 1024).toFixed(1)}MB)`);
    
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdfjs = await getPdfJs();

    const loadingTask = pdfjs.getDocument({
      data: arrayBuffer,
      useSystemFonts: true,
    });
    
    const pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages;
    
    const config = getRenderConfig(totalPages);
    const pagesToRender = selectPagesToRender(totalPages, config.maxPages);
    
    console.log(`📄 PDF loaded: ${totalPages} pages total, rendering ${pagesToRender.length} pages (scale: ${config.scale}, format: ${config.format})`);
    
    const images: PdfPageImage[] = [];
    
    for (let i = 0; i < pagesToRender.length; i++) {
      const pageNum = pagesToRender[i];
      try {
        onProgress?.(i + 1, pagesToRender.length);
        
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: config.scale });
        
        // Calculate dimensions with max-dimension cap
        let width = Math.floor(viewport.width);
        let height = Math.floor(viewport.height);
        let scale = config.scale;
        
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
          scale = config.scale * ratio;
        }
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        if (!context) {
          throw new Error('Failed to get canvas context');
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // White background
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        
        const renderViewport = page.getViewport({ scale });
        await page.render({
          canvasContext: context,
          viewport: renderViewport,
        }).promise;
        
        const dataUrl = config.quality 
          ? canvas.toDataURL(config.format, config.quality)
          : canvas.toDataURL(config.format);
        const base64 = dataUrl.split(',')[1];
        
        images.push({
          pageNumber: pageNum,
          base64,
          width,
          height,
          // The real encoding matters downstream: OCR callers used to hardcode
          // `image/png` for what was often a JPEG, and the vision provider
          // rejected the mislabelled data URL.
          mimeType: config.format,
        });
        
        // Free memory immediately
        canvas.width = 0;
        canvas.height = 0;
        
      } catch (pageError) {
        console.error(`❌ Failed to render page ${pageNum}:`, pageError);
        // Continue with other pages
      }
    }
    
    if (images.length === 0) {
      return {
        success: false,
        images: [],
        totalPages,
        error: 'Failed to render any pages from the PDF',
      };
    }
    
    console.log(`✅ PDF conversion complete: ${images.length}/${totalPages} pages rendered`);
    
    return {
      success: true,
      images,
      totalPages,
    };
    
  } catch (error) {
    console.error('❌ PDF conversion failed:', error);
    return {
      success: false,
      images: [],
      totalPages: 0,
      error: error instanceof Error ? error.message : 'Unknown error during PDF conversion',
    };
  }
}

/**
 * Strategically select which pages to render based on document size.
 * For property brochures, key info is typically on:
 * - First pages (cover, key details, specs, pricing)
 * - Middle pages (floorplans, site plans, inclusions)
 * - Last pages (financials, disclaimers, cost breakdowns)
 * 
 * @param totalPages Total number of pages in the document
 * @param maxPages Maximum pages to render (from RenderConfig)
 */
function selectPagesToRender(totalPages: number, maxPages: number): number[] {
  if (totalPages <= maxPages) {
    // Render ALL pages when within the limit
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  
  // Strategic sampling for very large documents
  const selected = new Set<number>();
  
  // Priority 1: First 10 pages (cover, key details, specs, pricing)
  const firstPagesCount = Math.min(10, totalPages);
  for (let i = 1; i <= firstPagesCount; i++) {
    selected.add(i);
  }
  
  // Priority 2: Last 6 pages (financial summaries, disclaimers, cost breakdowns)
  const lastPagesCount = Math.min(6, totalPages);
  for (let i = Math.max(totalPages - lastPagesCount + 1, 1); i <= totalPages; i++) {
    selected.add(i);
  }
  
  // Priority 3: Evenly sample the middle section to fill remaining slots
  const middleStart = firstPagesCount + 1;
  const middleEnd = totalPages - lastPagesCount;
  
  if (middleEnd > middleStart) {
    const remainingSlots = maxPages - selected.size;
    const middlePages = middleEnd - middleStart + 1;
    const samplesToTake = Math.min(remainingSlots, middlePages);
    
    if (samplesToTake > 0 && samplesToTake < middlePages) {
      // Even distribution across the middle
      const step = middlePages / samplesToTake;
      for (let i = 0; i < samplesToTake; i++) {
        const pageNum = Math.round(middleStart + i * step);
        if (pageNum >= 1 && pageNum <= totalPages) {
          selected.add(pageNum);
        }
      }
    } else if (samplesToTake >= middlePages) {
      // Include all middle pages
      for (let p = middleStart; p <= middleEnd; p++) {
        selected.add(p);
      }
    }
  }
  
  // Sort and enforce absolute max
  const sorted = Array.from(selected).sort((a, b) => a - b);
  return sorted.slice(0, maxPages);
}

/**
 * Check if a file is a PDF
 */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/**
 * Check if a file is an image
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(file.name);
}

/**
 * Convert an image file to base64
 */
export async function imageFileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
