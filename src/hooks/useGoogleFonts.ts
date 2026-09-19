import { useState, useEffect, useCallback, useRef } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface GoogleFont {
  family: string;
  variants: string[];
  category: string;
}

// Popular Google Fonts - curated list loaded instantly, then full list loaded async
const POPULAR_FONTS: GoogleFont[] = [
  { family: 'Roboto', variants: ['100','300','regular','500','700','900','100italic','300italic','italic','500italic','700italic','900italic'], category: 'sans-serif' },
  { family: 'Open Sans', variants: ['300','regular','500','600','700','800','300italic','italic','500italic','600italic','700italic','800italic'], category: 'sans-serif' },
  { family: 'Montserrat', variants: ['100','200','300','regular','500','600','700','800','900','100italic','200italic','300italic','italic','500italic','600italic','700italic','800italic','900italic'], category: 'sans-serif' },
  { family: 'Lato', variants: ['100','300','regular','700','900','100italic','300italic','italic','700italic','900italic'], category: 'sans-serif' },
  { family: 'Poppins', variants: ['100','200','300','regular','500','600','700','800','900','100italic','200italic','300italic','italic','500italic','600italic','700italic','800italic','900italic'], category: 'sans-serif' },
  { family: 'Inter', variants: ['100','200','300','regular','500','600','700','800','900'], category: 'sans-serif' },
  { family: 'Raleway', variants: ['100','200','300','regular','500','600','700','800','900','100italic','200italic','300italic','italic','500italic','600italic','700italic','800italic','900italic'], category: 'sans-serif' },
  { family: 'Playfair Display', variants: ['regular','500','600','700','800','900','italic','500italic','600italic','700italic','800italic','900italic'], category: 'serif' },
  { family: 'Cinzel', variants: ['regular','500','600','700','800','900'], category: 'serif' },
  { family: 'Merriweather', variants: ['300','regular','700','900','300italic','italic','700italic','900italic'], category: 'serif' },
  { family: 'Source Sans 3', variants: ['200','300','regular','500','600','700','800','900','200italic','300italic','italic','500italic','600italic','700italic','800italic','900italic'], category: 'sans-serif' },
  { family: 'Oswald', variants: ['200','300','regular','500','600','700'], category: 'sans-serif' },
  { family: 'Nunito', variants: ['200','300','regular','500','600','700','800','900','200italic','300italic','italic','500italic','600italic','700italic','800italic','900italic'], category: 'sans-serif' },
  { family: 'PT Serif', variants: ['regular','700','italic','700italic'], category: 'serif' },
  { family: 'Libre Baskerville', variants: ['regular','700','italic'], category: 'serif' },
  { family: 'Cormorant Garamond', variants: ['300','regular','500','600','700','300italic','italic','500italic','600italic','700italic'], category: 'serif' },
  { family: 'DM Sans', variants: ['100','200','300','regular','500','600','700','800','900','100italic','200italic','300italic','italic','500italic','600italic','700italic','800italic','900italic'], category: 'sans-serif' },
  { family: 'Quicksand', variants: ['300','regular','500','600','700'], category: 'sans-serif' },
  { family: 'Bebas Neue', variants: ['regular'], category: 'sans-serif' },
  { family: 'Crimson Text', variants: ['regular','600','700','italic','600italic','700italic'], category: 'serif' },
];

// Track which fonts have been loaded into the DOM
const loadedFontFamilies = new Set<string>();

function loadGoogleFontCSS(family: string, variants?: string[]) {
  if (loadedFontFamilies.has(family)) return;
  loadedFontFamilies.add(family);

  // Build weight+style list from variants
  const italicWeights: number[] = [];
  const normalWeights: number[] = [];

  const vlist = variants && variants.length > 0 ? variants : ['regular', '700'];
  for (const v of vlist) {
    const isItalic = v.includes('italic');
    const weightStr = v.replace('italic', '').trim();
    const weight = weightStr === '' || weightStr === 'regular' ? 400 : parseInt(weightStr, 10) || 400;
    if (isItalic) italicWeights.push(weight);
    else normalWeights.push(weight);
  }

  // Google Fonts API v2 axis format
  const allTuples: string[] = [];
  for (const w of normalWeights) allTuples.push(`0,${w}`);
  for (const w of italicWeights) allTuples.push(`1,${w}`);
  allTuples.sort();

  const spec = allTuples.length > 0
    ? `${family.replace(/ /g, '+')}:ital,wght@${allTuples.join(';')}`
    : family.replace(/ /g, '+');

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  document.head.appendChild(link);
}

export function useGoogleFonts() {
  const [fonts, setFonts] = useState<GoogleFont[]>(POPULAR_FONTS);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const fullListLoaded = useRef(false);

  // Load the full Google Fonts list on first search
  const loadFullList = useCallback(async () => {
    if (fullListLoaded.current || isLoading) return;
    setIsLoading(true);
    try {
      // The catalogue comes from the `google-fonts-catalog` edge function, which
      // holds the Google API key server-side. This used to call
      // googleapis.com directly with the key written into this file — which Vite
      // inlines into the bundle, so it shipped to every visitor. It is also a
      // billable key, and in a Mission Control workspace the account being
      // billed is the prime's, not this tenant's.
      const { data, error } = await invokeSecureFunction<{
        success: boolean;
        fonts?: GoogleFont[];
      }>('google-fonts-catalog', {});

      const items = data?.success && Array.isArray(data.fonts) ? data.fonts : [];
      if (!error && items.length > 0) {
        setFonts(items);
        fullListLoaded.current = true;
      }
      // Anything else keeps POPULAR_FONTS, which is a working picker rather
      // than an empty one.
    } catch {
      // Silently fall back to popular list
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const filteredFonts = searchQuery.trim()
    ? fonts.filter(f => f.family.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 50)
    : fonts.slice(0, 50);

  return {
    fonts: filteredFonts,
    allFonts: fonts,
    searchQuery,
    setSearchQuery,
    isLoading,
    loadFullList,
    loadFontCSS: loadGoogleFontCSS,
  };
}

// Helper to load a font immediately (for rendering saved overlays)
export function ensureFontLoaded(family: string, variants?: string[]) {
  loadGoogleFontCSS(family, variants);
}
