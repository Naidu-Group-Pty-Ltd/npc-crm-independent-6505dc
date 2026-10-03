/**
 * Greeting — the first sentence Aurixa says when the panel opens.
 *
 * A greeting by name at the right time of day is the cheapest thing that
 * makes an assistant feel like it knows who it is working with. Usernames
 * here arrive in every shape ("ravi.naidu", "Ravi Naidu", "rnaidu@…"), so the
 * first name is read conservatively: a token that does not look like a name
 * produces no name at all rather than a wrong one.
 */

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'late';

export function partOfDay(date: Date): PartOfDay {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'late';
}

export function firstNameFrom(username: string | null | undefined): string | null {
  if (!username) return null;
  const local = username.split('@')[0];
  const token = local.split(/[\s._-]+/).filter(Boolean)[0];
  if (!token) return null;
  if (!/^[A-Za-z][A-Za-z']{1,23}$/.test(token)) return null;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

export function greetingFor(date: Date, username?: string | null): string {
  const name = firstNameFrom(username);
  const part = partOfDay(date);
  if (part === 'late') return name ? `Working late, ${name}?` : 'Working late?';
  const base = part === 'morning' ? 'Good morning' : part === 'afternoon' ? 'Good afternoon' : 'Good evening';
  return name ? `${base}, ${name}` : base;
}
