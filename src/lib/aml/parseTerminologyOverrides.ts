export function parseTerminologyOverrides(jsonText: string): Record<string, string> | null {
  try {
    if (!jsonText.trim()) return {};

    const value: unknown = JSON.parse(jsonText);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return null;
  }
}
