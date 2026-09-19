export function hasAmlInvestigateCapability(hasWriteRole: boolean, isSuperadmin: boolean): boolean {
  return hasWriteRole || isSuperadmin;
}

export type CounterpartyRequestScope =
  | { column: "counterparty_case_id" | "case_id"; value: string }
  | null;

export function getCounterpartyRequestScope(body: Record<string, unknown>): CounterpartyRequestScope {
  const counterpartyCaseId = String(body.counterparty_case_id ?? "").trim();
  if (counterpartyCaseId) return { column: "counterparty_case_id", value: counterpartyCaseId };

  const caseId = String(body.case_id ?? "").trim();
  if (caseId) return { column: "case_id", value: caseId };

  return null;
}
