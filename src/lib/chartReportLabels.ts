import { format } from 'date-fns';

export interface ChartSourceReport {
  id: string;
  title: string;
  created_at: string;
  generated_at?: string | null;
  period_end?: string | null;
}

export interface ChartReportOption extends ChartSourceReport {
  label: string;
}

const cleanTitle = (title: string | null | undefined) => title?.trim() || 'Untitled report';
const labelDateSource = (report: ChartSourceReport) => report.period_end || report.generated_at || report.created_at;
const parseDate = (value: string | null | undefined) => {
  const d = new Date(value || '');
  return Number.isNaN(d.getTime()) ? null : d;
};
const formatDatePart = (report: ChartSourceReport) => {
  const d = parseDate(labelDateSource(report));
  return d ? format(d, 'd MMM yyyy') : null;
};
const formatTimePart = (report: ChartSourceReport) => {
  const d = parseDate(report.generated_at || report.created_at);
  return d ? format(d, 'h:mm a') : null;
};

/** Builds one deterministic filter option per authoritative report ID using date-based labels. */
export function buildChartReportOptions(reports: ChartSourceReport[]): ChartReportOption[] {
  const uniqueReports = Array.from(
    new Map(reports.filter(report => report.id).map(report => [report.id, report])).values(),
  );
  const dateCounts = uniqueReports.reduce((acc, report) => {
    const key = `${cleanTitle(report.title)}|${formatDatePart(report) || ''}`;
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map<string, number>());

  return uniqueReports.map(report => {
    const title = cleanTitle(report.title);
    const date = formatDatePart(report);
    const duplicate = dateCounts.get(`${title}|${date || ''}`) || 0;
    const time = duplicate > 1 ? formatTimePart(report) : null;
    return {
      ...report,
      label: [title, [date, time].filter(Boolean).join(' ')].filter(Boolean).join(' — '),
    };
  });
}
