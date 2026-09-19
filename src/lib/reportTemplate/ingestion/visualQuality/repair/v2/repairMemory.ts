/**
 * E8 — deterministic repair memory + loop/oscillation prevention (pure).
 *
 * Tracks attempted / rejected / selected candidate hashes, operation
 * fingerprints, unresolved defect fingerprints and the pass index. An identical
 * candidate is never retried against an identical baseline, and an A→B→A
 * oscillation of selected states stops the cascade. Bounded + deterministic.
 */
export interface RepairMemoryState {
  attemptedCandidateIds: Set<string>;
  rejectedCandidateIds: Set<string>;
  selectedCandidateIds: string[];
  /** ordered selected (baseline template hash) sequence, for oscillation. */
  selectedTemplateHashes: string[];
  operationFingerprints: Set<string>;
  unresolvedDefectFingerprints: Set<string>;
  passIndex: number;
}

export function createRepairMemory(): RepairMemoryState {
  return {
    attemptedCandidateIds: new Set(), rejectedCandidateIds: new Set(), selectedCandidateIds: [],
    selectedTemplateHashes: [], operationFingerprints: new Set(),
    unresolvedDefectFingerprints: new Set(), passIndex: 0,
  };
}

export function recordAttempt(mem: RepairMemoryState, candidateId: string, operationIds: string[]): void {
  mem.attemptedCandidateIds.add(candidateId);
  for (const id of operationIds) mem.operationFingerprints.add(id);
}
export function recordRejected(mem: RepairMemoryState, candidateId: string): void { mem.rejectedCandidateIds.add(candidateId); }
export function recordSelected(mem: RepairMemoryState, candidateId: string, resultingTemplateHash: string): void {
  mem.selectedCandidateIds.push(candidateId);
  mem.selectedTemplateHashes.push(resultingTemplateHash);
}

/** true when this candidate was already attempted against the current baseline. */
export function alreadyAttempted(mem: RepairMemoryState, candidateId: string): boolean {
  return mem.attemptedCandidateIds.has(candidateId);
}

/** Detect an A→B→A oscillation in the selected template-hash sequence. */
export function isOscillating(mem: RepairMemoryState, nextTemplateHash: string): boolean {
  const seq = [...mem.selectedTemplateHashes, nextTemplateHash];
  if (seq.length < 3) return false;
  const n = seq.length;
  return seq[n - 1] === seq[n - 3] && seq[n - 1] !== seq[n - 2];
}
