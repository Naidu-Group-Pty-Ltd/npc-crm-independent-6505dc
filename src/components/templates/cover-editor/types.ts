export interface OverlayElement {
  id: string;
  type: 'text' | 'image';
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  width: number; // percentage
  height: number; // percentage
  rotation: number;
  opacity: number;
  // Text props
  content?: string;
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  fontWeight?: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline' | 'line-through';
  textAlign?: 'left' | 'center' | 'right';
  letterSpacing?: number; // px
  lineHeight?: number; // multiplier e.g. 1.2
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textShadow?: string;
  backgroundColor?: string;
  borderRadius?: number;
  padding?: number;
  // Image props
  imageUrl?: string;
  objectFit?: 'cover' | 'contain' | 'fill';
  borderWidth?: number;
  borderColor?: string;
}

export interface CoverPageOverlay {
  id: string;
  name: string;
  report_type: string;
  background_image_url: string | null;
  canvas_width: number;
  canvas_height: number;
  overlay_elements: OverlayElement[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export const REPORT_TYPE_OPTIONS = [
  { value: 'investment', label: 'Investment Report' },
  { value: 'qa', label: 'Q&A Export' },
  { value: 'cashflow', label: 'Cash Flow' },
  { value: 'portfolio', label: 'Portfolio Analysis' },
  { value: 'borrowing_capacity', label: 'Borrowing Capacity' },
  { value: 'formara', label: 'Formara / Client Form' },
  { value: 'suburb', label: 'Suburb Analysis' },
  { value: 'postcode', label: 'Postcode Analysis' },
  { value: 'statewide', label: 'Statewide Analysis' },
  { value: 'comparison', label: 'Comparison Report' },
] as const;

export const BUILTIN_FONTS = [
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Arial',
  'Courier New',
] as const;

export const FONT_WEIGHT_OPTIONS = [
  { value: '100', label: 'Thin (100)' },
  { value: '200', label: 'Extra Light (200)' },
  { value: '300', label: 'Light (300)' },
  { value: 'normal', label: 'Regular (400)' },
  { value: '500', label: 'Medium (500)' },
  { value: '600', label: 'Semi Bold (600)' },
  { value: 'bold', label: 'Bold (700)' },
  { value: '800', label: 'Extra Bold (800)' },
  { value: '900', label: 'Black (900)' },
] as const;

// Keep FONT_FAMILIES for backward compatibility
export const FONT_FAMILIES = [
  ...BUILTIN_FONTS,
  'Playfair Display',
  'Cinzel',
  'Montserrat',
  'Open Sans',
  'Roboto',
] as const;

// Use the same primary cover page for all report types by default
const PRIMARY_COVER = '/templates/npc-portfolio-cover-new.jpg';

export const DEFAULT_BACKGROUND_IMAGES: Record<string, string> = {
  investment: PRIMARY_COVER,
  qa: PRIMARY_COVER,
  cashflow: PRIMARY_COVER,
  portfolio: PRIMARY_COVER,
  borrowing_capacity: PRIMARY_COVER,
  formara: PRIMARY_COVER,
  suburb: PRIMARY_COVER,
  postcode: PRIMARY_COVER,
  statewide: PRIMARY_COVER,
  comparison: PRIMARY_COVER,
};
