/**
 * Intelligently capitalizes names, handling edge cases like:
 * - All uppercase or all lowercase names (from GHL imports)
 * - Special prefixes: Mc, Mac, O'
 * - Hyphenated names
 * - Already properly capitalized names (left unchanged)
 */
export function smartCapitalize(name: string | null | undefined): string {
  if (!name) return '';
  
  // Handle already properly capitalized names
  if (name !== name.toLowerCase() && name !== name.toUpperCase()) {
    return name;
  }
  
  return name
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((part) => {
      // Keep separators as-is
      if (/^(\s+|-|')$/.test(part)) return part;
      
      // Handle special prefixes like Mc, Mac, O'
      if (part.startsWith('mc') && part.length > 2) {
        return 'Mc' + part.charAt(2).toUpperCase() + part.slice(3);
      }
      if (part.startsWith('mac') && part.length > 3) {
        return 'Mac' + part.charAt(3).toUpperCase() + part.slice(4);
      }
      
      // Standard capitalization
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

/**
 * Format a full name from first and last name parts
 */
export function formatFullName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const first = smartCapitalize(firstName);
  const last = smartCapitalize(lastName);
  return [first, last].filter(Boolean).join(' ');
}
