import type { ClientProfile, ClientScenario, ClientScenarioAuditEvent } from './clientPortfolioTypes';

export type ClientProfileImportMode = 'replace' | 'keep' | 'scenario';
export type CalculatorFieldSnapshot = Record<string, string | number | null | undefined>;

export function isPopulatedCalculatorValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '' && Number(value) !== 0;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  return true;
}

export function countProfileImportConflicts(snapshot: CalculatorFieldSnapshot): number {
  return Object.values(snapshot).filter(isPopulatedCalculatorValue).length;
}

export function buildClientProfileImportAudit(field: string, previousValue: unknown, newValue: unknown, scenarioId?: string): ClientScenarioAuditEvent {
  return { timestamp: new Date().toISOString(), user: 'Calculator user', action: 'Client profile value imported', field, previousValue, newValue, source: 'Client Profile Source', scenarioId };
}

export function commitScenarioToClientProfile(client: ClientProfile, scenario: ClientScenario): ClientProfile {
  return { ...client, scenarios: [...client.scenarios.filter(s => s.scenarioId !== scenario.scenarioId), { ...scenario, status: 'Committed', auditLog: [...scenario.auditLog, { timestamp: new Date().toISOString(), user: 'Calculator user', action: 'Scenario committed to client profile', source: 'Commercial / Industrial calculator', scenarioId: scenario.scenarioId }] }], latestBorrowingCapacity: scenario.resultingPosition.borrowingCapacity };
}
