export const fmtPct = (value: number | null | undefined, decimalPlaces = 2) =>
  value != null && Number.isFinite(value) ? `${value.toFixed(decimalPlaces)}%` : '—';
