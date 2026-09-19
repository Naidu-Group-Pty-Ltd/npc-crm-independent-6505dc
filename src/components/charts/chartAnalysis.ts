import { normaliseChartConfig, type NormalisedChartModel } from './kernel';
import type { ChartData } from './ChartCard';

export interface ChartInsight {
  summary: string;
  keyFinding: string;
  evidence: string[];
  implication: string;
  consideration: string;
  fullAnalysis: string;
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1 }).format(n);
}

function pct(n: number, d: number) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a';
}

function getValues(model: NormalisedChartModel) {
  const key = model.series[0]?.key;
  if (!key) return [] as Array<{ name: string; value: number }>;
  return model.data.map((row) => ({ name: row.name, value: Number(row[key]) || 0 })).filter((p) => Number.isFinite(p.value));
}

export function isUsefulAnalysis(text?: string | null) {
  if (!text) return false;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words >= 80 && /key finding|evidence|implication|consideration/i.test(text);
}

export function buildChartInsight(chart: ChartData): ChartInsight | null {
  const model = normaliseChartConfig(chart);
  if (!model || !model.data.length || !model.series.length) return null;

  const values = getValues(model);
  const total = values.reduce((sum, p) => sum + p.value, 0);
  const sorted = [...values].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const second = sorted[1];
  const last = values[values.length - 1];
  const first = values[0];
  const kind = model.kind.replace('-', ' ');
  const source = chart.generated_reports?.display_title ?? chart.generated_reports?.title ?? 'the linked report';
  const date = chart.report_date || chart.generated_at || chart.created_at;

  let keyFinding = `${chart.title} is a ${kind} view with ${values.length} plotted categories or periods.`;
  let evidence = top ? [`${top.name} records the highest value at ${fmt(top.value)}${total ? ` (${pct(top.value, total)} of the displayed total)` : ''}.`] : [];
  let implication = 'This data-based summary supports a faster read of market concentration, coverage balance and operational focus without changing the underlying report values.';
  let consideration = 'Interpretation is limited to the structured values saved with this chart; missing records are not treated as zero and causal claims are intentionally avoided.';

  if (model.kind.includes('line') || model.kind.includes('area')) {
    const delta = first && last ? last.value - first.value : 0;
    const direction = delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'remained broadly unchanged';
    keyFinding = `${chart.title} ${direction} across the displayed sequence from ${first?.name ?? 'the first point'} to ${last?.name ?? 'the last point'}.`;
    evidence = [`The first value is ${fmt(first?.value ?? 0)} and the final value is ${fmt(last?.value ?? 0)}, a net movement of ${fmt(Math.abs(delta))}.`, ...(top ? [`The peak point is ${top.name} at ${fmt(top.value)}.`] : [])];
    implication = 'The movement helps identify whether listing activity, pricing or confidence is strengthening, softening or staying stable across the reported period.';
  } else if (model.kind === 'pie' || model.kind === 'donut') {
    keyFinding = top ? `${top.name} is the largest segment in ${chart.title}.` : keyFinding;
    evidence = [top ? `${top.name} contributes ${fmt(top.value)}${total ? `, equal to ${pct(top.value, total)} of the displayed total` : ''}.` : '', second ? `${second.name} is the next largest segment at ${fmt(second.value)}${total ? ` (${pct(second.value, total)})` : ''}.` : ''].filter(Boolean);
    implication = 'The segment mix indicates where market exposure is concentrated and where smaller categories may need further validation before commercial decisions are made.';
  } else if (model.kind.includes('bar')) {
    keyFinding = top ? `${top.name} leads ${chart.title}, showing the strongest displayed contribution.` : keyFinding;
    evidence = [top ? `${top.name} records ${fmt(top.value)}` : '', second ? `The next highest category is ${second.name} at ${fmt(second.value)}, a gap of ${fmt(top.value - second.value)}.` : '', total ? `The displayed categories sum to ${fmt(total)}.` : ''].filter(Boolean);
    implication = 'This ranking highlights where activity or coverage is concentrated, helping prioritise review of high-volume suburbs, agencies, price bands or operational segments.';
  } else if (model.kind === 'scatter') {
    keyFinding = `${chart.title} plots ${values.length} points for comparison across the saved x/y structure.`;
    evidence = top ? [`The highest plotted value is ${top.name} at ${fmt(top.value)}.`, second ? `${second.name} follows at ${fmt(second.value)}.` : ''] .filter(Boolean) : [];
    implication = 'The spread is useful for spotting clusters and outliers that may warrant closer commercial review.';
  }

  const fullAnalysis = `Key finding: ${keyFinding}\n\nEvidence: ${evidence.join(' ')}\n\nImplication: ${implication}\n\nConsideration: ${consideration} Source: ${source}${date ? `, reporting date ${new Date(date).toLocaleDateString('en-AU')}` : ''}.`;
  return { summary: keyFinding, keyFinding, evidence, implication, consideration, fullAnalysis };
}

export function getDisplayAnalysis(chart: ChartData): string | null {
  if (isUsefulAnalysis(chart.analysis_text)) return chart.analysis_text!;
  const insight = buildChartInsight(chart);
  return insight?.fullAnalysis ?? chart.analysis_text ?? chart.summary_text ?? null;
}
