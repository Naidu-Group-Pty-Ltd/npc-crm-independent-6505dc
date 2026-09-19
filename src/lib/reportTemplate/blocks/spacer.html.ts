import type { Block } from '../templateSchema';
import type { HtmlBlockContext } from './_shared.html';

export function renderSpacerHtml(_block: Block, _ctx: HtmlBlockContext): string {
  // Spacer is invisible in production output.
  return '';
}
