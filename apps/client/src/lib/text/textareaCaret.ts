// Caret pixel position inside a <textarea>, via a hidden mirror element that
// copies the textarea's box + text metrics. Used to anchor the "/" menu.
const COPIED = [
  'box-sizing',
  'width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'line-height',
  'text-transform',
  'word-spacing',
  'white-space',
  'word-break',
  'overflow-wrap',
];

export interface CaretXY {
  top: number;
  left: number;
  height: number;
}

/** Caret coordinates relative to the textarea's own top-left (pre-scroll). */
export function caretCoords(el: HTMLTextAreaElement): CaretXY {
  const computed = getComputedStyle(el);
  const mirror = document.createElement('div');
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  for (const prop of COPIED) mirror.style.setProperty(prop, computed.getPropertyValue(prop));

  mirror.textContent = el.value.slice(0, el.selectionStart ?? 0);
  const marker = document.createElement('span');
  marker.textContent = el.value.slice(el.selectionStart ?? 0) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const height = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.3;
  const top = marker.offsetTop - el.scrollTop;
  const left = marker.offsetLeft - el.scrollLeft;
  document.body.removeChild(mirror);
  return { top, left, height };
}
