// Australian state abbreviations to full names mapping
export const STATE_MAPPING: Record<string, string> = {
  'NSW': 'New South Wales',
  'VIC': 'Victoria',
  'QLD': 'Queensland',
  'SA': 'South Australia',
  'WA': 'Western Australia',
  'TAS': 'Tasmania',
  'NT': 'Northern Territory',
  'ACT': 'Australian Capital Territory'
};

export function getFullStateName(abbreviation: string): string {
  if (!abbreviation) return '';
  const upperAbbr = abbreviation.toUpperCase();
  return STATE_MAPPING[upperAbbr] || abbreviation;
}

export function getStateAbbreviation(fullName: string): string {
  if (!fullName) return '';
  const entry = Object.entries(STATE_MAPPING).find(([_, name]) => 
    name.toLowerCase() === fullName.toLowerCase()
  );
  return entry ? entry[0] : fullName;
}