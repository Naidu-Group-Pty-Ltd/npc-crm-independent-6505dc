/**
 * The stages of an analysis, in the order the data depends on itself.
 *
 * This is the whole navigation model. The page it replaces had four competing
 * ones — a hero with actions, a domain panel, a grouped calculator tab strip
 * and a set of overview panels that each opened another surface — so "what do
 * I do next" had no answer the interface could give. One ordered list does,
 * and it is ordered by dependency rather than by taste: a yield needs a net
 * operating income, which needs the lease, which needs the property.
 *
 * `section` maps a stage to the validation section the assessment engine
 * reports issues against, so an error can name the stage that fixes it. The
 * two analysis stages have no lending validation of their own — their gaps are
 * reported by `analysisEngine`'s `missing` lists, which are about a model
 * being incomplete rather than a field being wrong.
 */

export type WorkspaceStageKey =
  | 'context' | 'property' | 'income' | 'ownership' | 'lending'
  | 'valuation' | 'forecast' | 'results' | 'report';

export interface WorkspaceStageDefinition {
  key: WorkspaceStageKey;
  label: string;
  /** The validation section this stage owns, where it owns one. */
  section?: string;
  /** One line stating what the stage is for. Shown as the panel description. */
  purpose: string;
}

export const WORKSPACE_STAGES: readonly WorkspaceStageDefinition[] = [
  {
    key: 'context',
    label: 'Context',
    purpose: 'Who the analysis is for, which property it concerns, and what kind of transaction it is.',
  },
  {
    key: 'property',
    label: 'Property',
    section: 'property',
    purpose: 'The asset, the transaction and what it costs to acquire.',
  },
  {
    key: 'income',
    label: 'Income & lease',
    section: 'lease',
    purpose: 'What the property earns, what it costs to run, and who is paying the rent.',
  },
  {
    key: 'ownership',
    label: 'Ownership & portfolio',
    section: 'ownership',
    purpose: 'The borrowing entities, their existing assets and their existing debt.',
  },
  {
    key: 'lending',
    label: 'Lending',
    section: 'loan',
    purpose: 'The facility being sought and the policy it is tested against.',
  },
  {
    key: 'valuation',
    label: 'Valuation',
    purpose: 'What the asset is worth on the income it produces, and how that compares to the price.',
  },
  {
    key: 'forecast',
    label: 'Forecast',
    purpose: 'What holding the asset returns over the investment period.',
  },
  {
    key: 'results',
    label: 'Results',
    purpose: 'The lending position, the investment position and the risks in one place.',
  },
  {
    key: 'report',
    label: 'Report',
    purpose: 'The document, the template it uses, and where it is filed.',
  },
];

export function stageIndex(key: WorkspaceStageKey): number {
  const index = WORKSPACE_STAGES.findIndex((stage) => stage.key === key);
  return index < 0 ? 0 : index;
}

export function isWorkspaceStage(value: string | null | undefined): value is WorkspaceStageKey {
  return !!value && WORKSPACE_STAGES.some((stage) => stage.key === value);
}

/**
 * The stage a validation issue belongs to.
 *
 * Issues carry the assessment's own section keys; several of them land on one
 * stage here, because this workspace merges steps the assessment kept apart
 * (income and lease; ownership and portfolio).
 */
export function stageForSection(section: string): WorkspaceStageKey {
  switch (section) {
    case 'property': return 'property';
    case 'income':
    case 'lease': return 'income';
    case 'ownership':
    case 'portfolio': return 'ownership';
    case 'loan': return 'lending';
    case 'results': return 'results';
    default: return 'context';
  }
}
