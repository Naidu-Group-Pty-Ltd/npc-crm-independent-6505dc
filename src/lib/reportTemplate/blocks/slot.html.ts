import type { Block } from '../templateSchema';
import { evalConditional } from '../bindingResolver';
import { renderOverlay, type HtmlBlockContext } from './_shared.html';
import { getHtmlBlockRenderer } from './html';

export function renderSlotHtml(block: Block, ctx: HtmlBlockContext): string {
  const slotKey = String(block.props?.slotKey ?? '');
  if (!slotKey) return '';
  const slot = ctx.slots?.[slotKey];
  if (!slot) return '';
  if (!evalConditional(slot.conditional, ctx)) return '';
  const renderer = getHtmlBlockRenderer(slot.type);
  const body = renderer ? renderer(slot, ctx) : '';
  const overlays = slot.overlays.map((o) => renderOverlay(o, ctx)).join('');
  return body + overlays;
}
