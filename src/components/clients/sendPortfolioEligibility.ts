export interface PortfolioPublicationCandidate {
  id: string;
  client_id: string;
  created_at: string;
  status: string;
  pdf_file_path: string | null;
}

/** Only completed, saved portfolio-analysis records are eligible for portal publication. */
export function eligiblePortfolioReports(records: PortfolioPublicationCandidate[], clientId: string) {
  return records
    .filter(record => record.client_id === clientId && record.status === 'completed')
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}
