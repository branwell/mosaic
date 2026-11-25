// The Text tool's editor: a text box over the canvas with font, size and
// color options. When the box loses focus the text is drawn into a new PNG
// image and placed as an ordinary sprite; text is never kept as text.

import { renderText } from './raster.js';

// Fonts installed on the machine, each with a generic fallback. The pixels
// are baked in on placing, so a font missing elsewhere does not matter.
const FONTS = [
  ['Sans-serif', 'system-ui, sans-serif'],
  ['Serif', 'serif'],
  ['Monospace', 'ui-monospace, monospace'],
  ['Arial', 'Arial, sans-serif'],
  ['Helvetica', 'Helvetica, Arial, sans-serif'],
  ['Verdana', 'Verdana, sans-serif'],
  ['Trebuchet MS', '"Trebuchet MS", sans-serif'],
  ['Georgia', 'Georgia, serif'],
  ['Times New Roman', '"Times New Roman", Times, serif'],
  ['Courier New', '"Courier New", monospace'],
  ['Impact', 'Impact, sans-serif'],
];
const STYLE_KEY = 'mosaic.text';
const DEFAULT_STYLE = { font: FONTS[0][1], size: 32, color: '#ffffff' };
const MIN_SIZE = 4, MAX_SIZE = 1000;
const LINE_HEIGHT = 1.25; // multiple of the size; the box and the raster use the same value

export function attachTextEditor({ doc, view, onPlaced = () => {} }) {
  const box = document.getElementById('text-editor');
  const input = document.getElementById('text-input');
  const fontSel = document.getElementById('text-font');
  const sizeIn = document.getElementById('text-size');
  const colorIn = document.getElementById('text-color');

  let style = loadStyle();
  let at = null; // canvas point of the text's top-left while the box is open

  for (const [label, family] of FONTS) fontSel.add(new Option(label, family));
  sizeIn.min = MIN_SIZE;
  sizeIn.max = MAX_SIZE;
  fontSel.value = style.font;
  sizeIn.value = style.size;
  colorIn.value = style.color;

  function setStyle(patch) {
    style = { ...style, ...patch };
    try { localStorage.setItem(STYLE_KEY, JSON.stringify(style)); } catch { /* not remembered */ }
    layout();
  }

  fontSel.addEventListener('change', () => { setStyle({ font: fontSel.value }); input.focus(); });
  sizeIn.addEventListener('input', () => {
    const v = Math.round(Number(sizeIn.value));
    if (v >= MIN_SIZE && v <= MAX_SIZE) setStyle({ size: v });
  });
  sizeIn.addEventListener('change', () => { sizeIn.value = style.size; });
  colorIn.addEventListener('input', () => setStyle({ color: colorIn.value }));

  // Follow zoom and pan while the box is open.
  doc.onChange(() => layout());

  function layout() {
    if (!at) return;
    const p = view.toScreen(at.x, at.y);
    box.style.setProperty('--x', p.x + 'px');
    box.style.setProperty('--y', p.y + 'px');
    box.style.setProperty('--text-font', style.font);
    box.style.setProperty('--text-size', style.size * view.zoom + 'px');
    box.style.setProperty('--text-line', String(LINE_HEIGHT));
    box.style.setProperty('--text-color', style.color);
    box.classList.toggle('options-below', p.y < 40);
    fit();
  }

  // Grow the box to its content, with room for the caret.
  function fit() {
    input.style.width = '0';
    input.style.height = '0';
    input.style.width = input.scrollWidth + Math.ceil(style.size * view.zoom * 0.3) + 'px';
    input.style.height = input.scrollHeight + 'px';
  }
  input.addEventListener('input', fit);

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      e.stopPropagation();
      commit();
      view.canvas.focus();
    }
  });

  // Focus leaving the box and its options places the text. Leaving the
  // browser window does not: focus comes back to the box on return.
  box.addEventListener('focusout', () => {
    setTimeout(() => {
      if (at && document.hasFocus() && !box.contains(document.activeElement)) commit();
    }, 0);
  });

  function open(cp) {
    at = { x: Math.round(cp.x), y: Math.round(cp.y) };
    input.value = '';
    box.hidden = false;
    layout();
    input.focus();
  }

  function commit() {
    if (!at) return;
    const origin = at, text = input.value;
    at = null;
    input.value = '';
    box.hidden = true;
    if (text.trim()) place(text, origin);
  }

  function place(text, origin) {
    const r = renderText(text, style, LINE_HEIGHT);
    if (!r) return;
    const { canvas, blob } = r;
    const imageId = doc.addImage({ ext: 'png', width: canvas.width, height: canvas.height, blob, drawable: canvas });
    doc.commit(() => {
      const s = doc.addSprite({ image: imageId, x: origin.x + r.x, y: origin.y + r.y, w: canvas.width, h: canvas.height });
      doc.setSelection([s.id]);
    });
    onPlaced();
  }

  return {
    get isOpen() { return at !== null; },
    contains: el => box.contains(el),
    open,
    commit,
  };
}

function loadStyle() {
  try {
    const v = JSON.parse(localStorage.getItem(STYLE_KEY));
    const font = FONTS.some(f => f[1] === v?.font) ? v.font : DEFAULT_STYLE.font;
    const size = Number.isInteger(v?.size) && v.size >= MIN_SIZE && v.size <= MAX_SIZE ? v.size : DEFAULT_STYLE.size;
    const color = /^#[0-9a-f]{6}$/i.test(v?.color) ? v.color : DEFAULT_STYLE.color;
    return { font, size, color };
  } catch { return { ...DEFAULT_STYLE }; }
}
