export const aiEstimatePromptTemplates = {
  marketRent: 'Estimate commercial/industrial market rent from verified property, lease and market evidence. Return structured JSON only.',
  vacancy: 'Estimate vacancy allowance using asset class, location and lease status. Return structured JSON only.',
  capRateRange: 'Research benchmark cap-rate range. Label as benchmark only and require valuer confirmation.',
  gstClauseExtraction: 'Extract likely GST treatment from contract clauses. Require solicitor/accountant confirmation.',
  dcfExitRisk: 'Estimate DCF exit risk assumptions while keeping all formulas deterministic and editable.',
} as const;
