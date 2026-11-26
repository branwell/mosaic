// Wiring: creates the document, view and tools, defines every action once,
// and maps menus and keyboard shortcuts onto those actions.

import { Document, PALETTE_SIZE } from './document.js';
import { View } from './view.js';
import { attachTools } from './tools.js';
import * as arrange from './arrange.js';
import * as files from './files.js';
import * as region from './region.js';
import { decodeImage, renderSprites, toPngBlob } from './raster.js';
import { attachTextEditor } from './text.js';
import { createMenuBar, createContextMenu, createStatusBar, createSaveDialog } from './menu.js';
import { buildKeymap, eventKeyName, formatKey, stripModifiers } from './keys.js';

const doc = new Document();
const canvas = document.getElementById('editor');
const stage = document.getElementById('stage');
const palette = document.getElementById('palette');
const view = new View(canvas, doc);
const tools = attachTools(canvas, doc, view, {
  onContextMenu: p => contextMenu.open(p.x, p.y),
  background: () => background,
  // A press while a text box is open only places its text.
  onText: cp => { if (text.isOpen) text.commit(); else text.open(cp); },
});
// Placed text is selected; switch to Select so it can be moved at once.
const text = attachTextEditor({ doc, view, onPlaced: () => tools.setTool('select') });
const status = createStatusBar({
  zoomValue: document.getElementById('zoom-value'),
  selectionInfo: document.getElementById('selection-info'),
  message: document.getElementById('message'),
});
const saveDialog = createSaveDialog(document.getElementById('save-dialog'));

// Internal clipboard: {kind: 'sprites', records} or {kind: 'pixels', image,
// rect} (see region.copyRegion), or null.
let clipboard = null;
// Size of the last image Mosaic put on the system clipboard, to recognise it
// when it comes back in a paste event.
let lastPixelWrite = null;

// Background color: what Cut and Delete leave in a region. A CSS hex color,
// or null for transparent. An editor setting kept in this browser, not in the
// document; the custom colors to choose it from are in the document's palette.
const BACKGROUND_KEY = 'mosaic.background';
let background = loadBackground();

function loadBackground() {
  try {
    const v = localStorage.getItem(BACKGROUND_KEY);
    return v && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
  } catch { return null; }
}

function setBackground(color) {
  background = color;
  try { if (color) localStorage.setItem(BACKGROUND_KEY, color); else localStorage.removeItem(BACKGROUND_KEY); } catch { /* not remembered */ }
  showBackground();
}

// ---- document change → UI ----

doc.onChange(() => {
  view.render();
  status.setZoom(doc.view.zoom);
  for (const b of palette.querySelectorAll('button[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tools.tool));
  const n = doc.selection.size;
  status.setSelection(tools.region ? `region ${tools.region.w}×${tools.region.h} at ${tools.region.x}, ${tools.region.y}` : n === 0 ? `${doc.sprites.length} sprite${doc.sprites.length === 1 ? '' : 's'}`
    : n === 1 ? spriteSummary(doc.selectedSprites()[0]) : `${n} selected`);
  document.title = `${doc.dirty ? '• ' : ''}${doc.name}.mmsc — Mosaic`;
});

function spriteSummary(s) {
  const r = `${Math.round(s.w)}×${Math.round(s.h)} at ${Math.round(s.x)}, ${Math.round(s.y)}`;
  return s.crop ? `${r} (cropped)` : r;
}

// ---- actions ----

// Before replacing a dirty document, offer to save it. Resolves true when it
// is safe to go on. Cancelling the dialog or the Save As picker stops here.
async function confirmDiscard() {
  if (!doc.dirty) return true;
  const answer = await saveDialog.ask(doc.name);
  if (answer === 'cancel') return false;
  if (answer === 'save') await files.saveFile(doc);
  return true;
}

async function importFromPicker() {
  const blobs = await files.pickImages();
  await reportImport(blobs, view.center());
}

async function reportImport(blobs, at) {
  if (blobs.length === 0) return;
  const failed = await files.importBlobs(doc, blobs, at);
  if (failed.length) status.message(`Could not import: ${failed.join(', ')}`, { error: true });
}

const singleUngrouped = () => {
  const sel = doc.selectedSprites();
  return sel.length === 1 && !sel[0].group ? sel[0] : null;
};

const actions = {
  new: async () => { if (await confirmDiscard()) doc.reset(); },
  open: async () => { if (await confirmDiscard()) await files.openFile(doc); },
  save: () => files.saveFile(doc),
  saveAs: () => files.saveFile(doc, { as: true }),
  import: importFromPicker,
  exportPng: () => files.exportPng(doc, doc.sprites, doc.name + '.png'),
  exportSelection: () => files.exportPng(doc, doc.selectedSprites(), doc.name + '-selection.png'),

  undo: () => { tools.exitCrop(true); doc.undo(); },
  redo: () => { tools.exitCrop(true); doc.redo(); },
  copy: () => {
    if (tools.region) { copyRegion(); return; }
    if (!hasSelection()) return;
    const sel = doc.selectedSprites();
    clipboard = { kind: 'sprites', records: sel.map(s => ({ ...s, crop: s.crop && { ...s.crop } })) };
    // Other applications get the selection as one PNG; pasting it back into
    // Mosaic is recognised and pastes the sprite records instead.
    const rendered = renderSprites(doc, sel);
    if (rendered) writeSystemImage(toPngBlob(rendered.canvas), rendered.box.w, rendered.box.h);
  },
  cut: () => {
    const r = tools.region;
    if (!r) return;
    copyRegion();
    region.clearRegion(doc, doc.sprite(r.id), r, background);
  },
  paste: () => {
    if (clipboard?.kind === 'sprites') arrange.pasteRecords(doc, clipboard.records);
    else if (clipboard?.kind === 'pixels') { tools.setTool('select'); region.pastePixels(doc, clipboard); }
  },
  duplicate: () => arrange.duplicateSelected(doc),
  delete: () => {
    tools.exitCrop(true);
    const r = tools.region;
    if (r) region.clearRegion(doc, doc.sprite(r.id), r, background);
    else arrange.deleteSelected(doc);
  },
  selectAll: () => { tools.exitCrop(true); doc.selectAll(); },
  crop: () => { const s = singleUngrouped(); if (s) tools.enterCrop(s.id); },

  group: () => arrange.groupSelected(doc),
  ungroup: () => arrange.ungroupSelected(doc),
  front: () => arrange.bringToFront(doc),
  back: () => arrange.sendToBack(doc),
  alignLeft: () => arrange.align(doc, 'left'),
  alignRight: () => arrange.align(doc, 'right'),
  alignTop: () => arrange.align(doc, 'top'),
  alignBottom: () => arrange.align(doc, 'bottom'),
  alignHCenter: () => arrange.align(doc, 'hcenter'),
  alignVCenter: () => arrange.align(doc, 'vcenter'),
  sideBySide: () => arrange.pack(doc, 'x'),
  stack: () => arrange.pack(doc, 'y'),
  flatten: () => arrange.flattenSelected(doc),

  zoomIn: () => view.setZoomCentered(doc.view.zoom * 1.25),
  zoomOut: () => view.setZoomCentered(doc.view.zoom / 1.25),
  zoomReset: () => view.setZoomCentered(1),
  fitAll: () => view.fitAll(),

  nudgeLeft: () => nudge(-1, 0), nudgeRight: () => nudge(1, 0), nudgeUp: () => nudge(0, -1), nudgeDown: () => nudge(0, 1),
  nudgeLeftBig: () => nudge(-10, 0), nudgeRightBig: () => nudge(10, 0), nudgeUpBig: () => nudge(0, -10), nudgeDownBig: () => nudge(0, 10),

  toolSelect: () => tools.setTool('select'),
  toolRegion: () => tools.setTool('region'),
  toolText: () => tools.setTool('text'),

  escape: () => {
    if (tools.cropping) tools.exitCrop(false);
    else if (!tools.clearRegion()) doc.clearSelection();
  },
  enter: () => { if (tools.cropping) tools.exitCrop(true); },
};

// Put the region's pixels on the internal clipboard and, as PNG, on the
// system clipboard. The write must start inside the key or click handler.
function copyRegion() {
  const s = doc.sprite(tools.region.id);
  clipboard = { kind: 'pixels', ...region.copyRegion(doc, s, tools.region) };
  const { image } = clipboard;
  writeSystemImage(image.blob, image.width, image.height);
}

// Put a PNG (a Blob or a promise of one) on the system clipboard and remember
// its size so a later paste can recognise it as Mosaic's own copy.
function writeSystemImage(blob, w, h) {
  lastPixelWrite = { w, h };
  navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(err => {
    lastPixelWrite = null;
    status.message('Could not write to the system clipboard: ' + err.message, { error: true });
  });
}

function nudge(dx, dy) { if (!tools.cropping) arrange.nudgeSelected(doc, dx, dy); }

async function run(action) {
  const fn = typeof action === 'function' ? action : actions[action];
  if (!fn) return;
  try {
    await fn();
  } catch (err) {
    if (err && err.name === 'AbortError') return; // user cancelled a dialog
    console.error(err);
    status.message(err.message || String(err), { error: true });
  }
}

// ---- menus ----

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const keys = buildKeymap(Object.keys(actions));
const formatShortcut = key => formatKey(key, isMac);
const item = (label, action, enabled) => ({ label, action, shortcut: keys.primary.get(action) || '', enabled });

const hasSelection = () => doc.selection.size > 0;
const multiUnit = () => doc.selectionUnits().length >= 2;

const arrangeItems = [
  item('Group', 'group', multiUnit),
  item('Ungroup', 'ungroup', () => doc.selectedSprites().some(s => s.group)),
  'sep',
  item('Bring to Front', 'front', hasSelection),
  item('Send to Back', 'back', hasSelection),
  'sep',
  item('Align Left', 'alignLeft', multiUnit),
  item('Align Right', 'alignRight', multiUnit),
  item('Align Top', 'alignTop', multiUnit),
  item('Align Bottom', 'alignBottom', multiUnit),
  item('Align Horizontal Centers', 'alignHCenter', multiUnit),
  item('Align Vertical Centers', 'alignVCenter', multiUnit),
  'sep',
  item('Side by Side', 'sideBySide', multiUnit),
  item('Stack', 'stack', multiUnit),
  'sep',
  item('Flatten', 'flatten', () => doc.selection.size >= 2),
];

const menus = [
  { label: 'File', items: [
    item('New', 'new'), // browsers reserve Ctrl/Cmd+N for a new window
    item('Open…', 'open'),
    { label: 'Open Recent', submenu: async () => (await files.listRecent()).map(r => ({
      label: r.name, action: async () => { if (await confirmDiscard()) await files.openFile(doc, r.handle); },
    })) },
    'sep',
    item('Save', 'save'),
    item('Save As…', 'saveAs'),
    'sep',
    item('Import Images…', 'import'),
    'sep',
    item('Export PNG…', 'exportPng', () => doc.sprites.length > 0),
    item('Export Selection as PNG…', 'exportSelection', hasSelection),
  ] },
  { label: 'Edit', items: [
    item('Undo', 'undo', () => doc.canUndo()),
    item('Redo', 'redo', () => doc.canRedo()),
    'sep',
    item('Cut', 'cut', () => !!tools.region),
    item('Copy', 'copy', hasSelection),
    item('Paste', 'paste', () => !!clipboard),
    item('Duplicate', 'duplicate', hasSelection),
    item('Delete', 'delete', hasSelection),
    'sep',
    item('Select All', 'selectAll', () => doc.sprites.length > 0),
    'sep',
    item('Crop', 'crop', () => !!singleUngrouped() && !tools.cropping),
  ] },
  { label: 'Arrange', items: arrangeItems },
  { label: 'View', items: [
    item('Zoom In', 'zoomIn'),
    item('Zoom Out', 'zoomOut'),
    item('Actual Size', 'zoomReset'),
    item('Fit All', 'fitAll'),
  ] },
];

createMenuBar(document.getElementById('menubar'), menus, run, { formatShortcut });

// Right-click on the canvas: the Arrange items, plus the per-sprite basics.
const contextMenu = createContextMenu(() => [
  item('Cut', 'cut', () => !!tools.region),
  item('Copy', 'copy', hasSelection),
  'sep',
  item('Crop', 'crop', () => !!singleUngrouped()),
  item('Duplicate', 'duplicate', hasSelection),
  item('Delete', 'delete', hasSelection),
  'sep',
  ...arrangeItems,
], run, { formatShortcut });
for (const b of palette.querySelectorAll('button[data-tool]')) {
  const action = 'tool' + b.dataset.tool[0].toUpperCase() + b.dataset.tool.slice(1);
  const key = keys.primary.get(action);
  b.title = b.getAttribute('aria-label') + (key ? ` (${formatShortcut(key)})` : '');
  b.addEventListener('click', () => { run(action); canvas.focus(); });
}
// ---- background swatch ----

const bgButton = document.getElementById('background');
const bgPanel = document.getElementById('background-panel');
const bgSlots = document.getElementById('background-slots');
const bgPicker = document.getElementById('background-custom');
// Clicks within this long of each other are a double-click; a click on a
// filled slot waits this long before closing the panel so a second click can
// still land and edit the slot instead.
const DOUBLE_CLICK_MS = 300;
let editingSlot = -1;   // palette slot the color picker is filling, or -1
let closeTimer = 0;

for (let i = 0; i < PALETTE_SIZE; i++) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.dataset.slot = String(i);
  bgSlots.append(b);
}

function showBackground() {
  bgButton.style.setProperty('--swatch', background || 'transparent');
  bgButton.dataset.transparent = String(!background);
  bgButton.title = `Background: ${background || 'transparent'} (fills areas left by Cut and Delete)`;
  for (const b of bgPanel.querySelectorAll('[data-color]')) {
    const c = b.dataset.color === 'transparent' ? null : b.dataset.color;
    if (c) b.style.setProperty('--swatch', c);
    b.setAttribute('aria-checked', String(c === background));
  }
  for (const b of bgSlots.children) {
    const c = doc.palette[Number(b.dataset.slot)];
    b.dataset.empty = String(!c);
    if (c) b.style.setProperty('--swatch', c); else b.style.removeProperty('--swatch');
    b.setAttribute('aria-checked', String(c !== null && c === background));
    b.title = c ? `${c}: click to use, double-click to change` : 'Empty: click to choose a color';
  }
}

function closeBackgroundPanel() {
  clearTimeout(closeTimer);
  bgPanel.hidden = true;
}

// Open the browser's color picker to fill a palette slot. The picker input
// moves into the slot so the picker opens beside it.
function editSlot(i, slot) {
  editingSlot = i;
  bgPicker.value = doc.palette[i] || background || '#808080';
  slot.append(bgPicker);
  try { bgPicker.showPicker(); } catch { bgPicker.click(); }
}

bgButton.addEventListener('click', () => {
  bgPanel.hidden = !bgPanel.hidden;
  if (!bgPanel.hidden) bgPanel.style.top = bgButton.offsetTop + 'px';
});
for (const b of bgPanel.querySelectorAll('[data-color]')) {
  b.addEventListener('click', () => {
    setBackground(b.dataset.color === 'transparent' ? null : b.dataset.color);
    closeBackgroundPanel();
    canvas.focus();
  });
}
bgSlots.addEventListener('click', e => {
  const slot = e.target.closest('[data-slot]');
  if (!slot || e.target === bgPicker) return;
  const i = Number(slot.dataset.slot);
  clearTimeout(closeTimer);
  if (!doc.palette[i]) { editSlot(i, slot); return; }
  if (e.detail >= 2) { editSlot(i, slot); return; }
  setBackground(doc.palette[i]);
  closeTimer = setTimeout(() => { closeBackgroundPanel(); canvas.focus(); }, DOUBLE_CLICK_MS);
});
bgPicker.addEventListener('input', () => {
  if (editingSlot < 0) return;
  doc.setPaletteColor(editingSlot, bgPicker.value);
  setBackground(bgPicker.value);
});
bgPicker.addEventListener('change', () => { editingSlot = -1; });
document.getElementById('palette-save').addEventListener('click', () =>
  run(() => files.savePalette(doc.palette, doc.name + '.mmscpal')));
document.getElementById('palette-load').addEventListener('click', () => run(async () => {
  const { palette, skipped } = await files.loadPalette();
  doc.setPalette(palette);
  if (skipped) status.message(`${skipped} palette entr${skipped === 1 ? 'y was' : 'ies were'} not loaded (only ${PALETTE_SIZE} #rrggbb colors fit)`);
}));
document.addEventListener('pointerdown', e => {
  if (!bgPanel.hidden && !bgPanel.contains(e.target) && e.target !== bgButton) closeBackgroundPanel();
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !bgPanel.hidden) { closeBackgroundPanel(); canvas.focus(); e.stopImmediatePropagation(); }
}, true);
// The palette belongs to the document: New and Open replace it.
doc.onChange(showBackground);
showBackground();

document.getElementById('zoom-reset').addEventListener('click', () => run('zoomReset'));
document.getElementById('zoom-fit').addEventListener('click', () => run('fitAll'));

// ---- keyboard ----

const panKey = keys.held.get('pan') || null;

// Shortcuts that edit text keep their usual meaning inside a text field.
const TEXT_FIELD_ACTIONS = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'delete']);
const isField = el => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

const dialogOpen = () => !!document.querySelector('dialog[open]');

window.addEventListener('keydown', e => {
  if (dialogOpen()) return; // the dialog handles its own keys
  const name = eventKeyName(e);
  if (isField(e.target)) {
    // In the text box, other Ctrl shortcuts (Save, Export…) place the text
    // first and then run, rather than reaching the browser.
    const action = name && keys.bindings.get(name);
    if (!text.contains(e.target) || !name?.startsWith('Ctrl+') || !action || TEXT_FIELD_ACTIONS.has(action)) return;
    text.commit();
    canvas.focus();
  }
  if (!name) return;
  if (name === panKey) { if (!e.repeat) tools.setSpace(true); e.preventDefault(); return; }
  const action = keys.bindings.get(name);
  if (!action) return;
  // The browser's own paste shortcut must reach the paste event, which is
  // the only way to receive images from the system clipboard.
  if (action === 'paste' && name === 'Ctrl+V') return;
  e.preventDefault();
  run(action);
});

window.addEventListener('keyup', e => {
  const name = eventKeyName(e);
  if (panKey && name && stripModifiers(name) === stripModifiers(panKey)) tools.setSpace(false);
});
window.addEventListener('blur', () => tools.setSpace(false));

// ---- clipboard and drag-drop import ----

document.addEventListener('paste', e => {
  if (isField(e.target) || dialogOpen()) return; // plain text pasted into the text box
  const images = files.imageFilesFromDataTransfer(e.clipboardData);
  if (images.length) {
    e.preventDefault();
    run(async () => {
      if (await isOwnClipboardImage(images)) await run('paste');
      else await reportImport(images, view.center());
    });
  } else if (clipboard) {
    e.preventDefault();
    run('paste');
  }
});

// Chrome re-encodes images it puts on the clipboard, so the bytes differ;
// matching size is the available signal that the image is our own copy.
async function isOwnClipboardImage(images) {
  if (!lastPixelWrite || !clipboard || images.length !== 1) return false;
  try {
    const d = await decodeImage(images[0]);
    return d.width === lastPixelWrite.w && d.height === lastPixelWrite.h;
  } catch {
    return false;
  }
}

stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('dragover'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
stage.addEventListener('drop', e => {
  e.preventDefault();
  stage.classList.remove('dragover');
  const images = files.imageFilesFromDataTransfer(e.dataTransfer);
  const sp = view.pointerPos(e);
  run(() => reportImport(images, view.toCanvas(sp.x, sp.y)));
});

window.addEventListener('beforeunload', e => {
  if (doc.dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ---- startup ----

// Exposed for debugging and for automated checks from the DevTools console.
window.mosaic = { doc, view, tools, run, arrange, files };

doc.emit();
canvas.focus();
if (keys.problems.length) {
  console.warn('keymap.js:', keys.problems);
  status.message('keymap.js: ' + keys.problems.join('; '), { error: true, ms: 15000 });
}
if (!files.supportsFileSystemAccess()) {
  status.message('Open and Save need Chrome or Edge; import and export still work partially', { error: true, ms: 10000 });
}
