import { parseTemplate, type ReportTemplate } from '../../templateSchema';
import type { TemplateImportPatch } from './types';
import { validateReconciliationOverlay } from './validatePlan';

export interface PatchApplyResult {
  template: ReportTemplate;
  applied: number;
  rejected: Array<{ patch: TemplateImportPatch; reason: string }>;
}

function reject(patch: TemplateImportPatch, reason: string) {
  return { patch, reason };
}

/** Apply bounded AI repair operations without letting AI rewrite the whole template. */
export function applyTemplateImportPatches(template: ReportTemplate, patches: TemplateImportPatch[]): PatchApplyResult {
  const draft: any = JSON.parse(JSON.stringify(template));
  const rejected: PatchApplyResult['rejected'] = [];
  let applied = 0;

  for (const patch of patches) {
    const page = draft.pages?.find((p: any) => p.id === patch.pageId);
    if (!page) {
      rejected.push(reject(patch, `Unknown page ${patch.pageId}.`));
      continue;
    }

    if (patch.operation === 'updatePageBackground') {
      if (patch.changes.imageUrl === '') {
        rejected.push(reject(patch, 'Cannot remove the preserved reference background image.'));
        continue;
      }
      page.background = { ...(page.background ?? {}), ...patch.changes };
      applied += 1;
      continue;
    }

    const block = page.blocks?.find((b: any) => b.id === patch.blockId);
    if (!block) {
      rejected.push(reject(patch, `Unknown block ${patch.blockId}.`));
      continue;
    }
    block.overlays = Array.isArray(block.overlays) ? block.overlays : [];

    if (patch.operation === 'addOverlay') {
      const overlay = validateReconciliationOverlay(patch.overlay);
      if (!overlay) {
        rejected.push(reject(patch, 'Added overlay is not schema-valid.'));
        continue;
      }
      block.overlays.push(overlay);
      applied += 1;
      continue;
    }

    const index = block.overlays.findIndex((o: any) => o.id === patch.overlayId);
    if (index < 0) {
      rejected.push(reject(patch, `Unknown overlay ${patch.overlayId}.`));
      continue;
    }

    if (patch.operation === 'removeOverlay') {
      block.overlays.splice(index, 1);
      applied += 1;
      continue;
    }

    const current = block.overlays[index];
    const updated = { ...current, ...patch.changes, id: current.id, type: current.type };
    const overlay = validateReconciliationOverlay(updated);
    if (!overlay) {
      rejected.push(reject(patch, `Updated overlay ${patch.overlayId} is not schema-valid.`));
      continue;
    }
    block.overlays[index] = overlay;
    applied += 1;
  }

  return { template: parseTemplate(draft), applied, rejected };
}
