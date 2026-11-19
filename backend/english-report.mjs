import {hasHan} from './english-ui.mjs';

// Reader packets can include a translation followed by the original model output.
// Only split at the documented standalone header, never by deleting individual characters.
export function englishReport(text) {
  if (typeof text!=='string') return '';
  const body=text.replace(/^\uFEFF/, '');
  const parts=body.split(/^[ \t]*英文原文[ \t]*\r?\n/gm);
  if (parts.length>2) return '';
  const original=parts.at(-1);
  return !hasHan(original) && /[a-z]/i.test(original) ? original : '';
}
