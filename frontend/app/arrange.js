// Commands that rearrange sprites: group, z-order, align, side by side,
// duplicate, delete and flatten. Each is one undo step.

import { newId } from './document.js';
import { renderSprites, toPngBlob, decodeImage } from './raster.js';

const DUPLICATE_OFFSET = 20;

export function groupSelected(doc) {
  if (doc.selectionUnits().length < 2) return;
  doc.commit(() => {
    const gid = newId();
    for (const s of doc.selectedSprites()) s.group = gid;
  });
}

export function ungroupSelected(doc) {
  if (!doc.selectedSprites().some(s => s.group)) return;
  doc.commit(() => { for (const s of doc.selectedSprites()) delete s.group; });
}

export function bringToFront(doc) {
  if (doc.selection.size === 0) return;
  doc.commit(() => {
    const sel = doc.selectedSprites();
    doc.sprites = [...doc.sprites.filter(s => !doc.selection.has(s.id)), ...sel];
  });
}

export function sendToBack(doc) {
  if (doc.selection.size === 0) return;
  doc.commit(() => {
    const sel = doc.selectedSprites();
    doc.sprites = [...sel, ...doc.sprites.filter(s => !doc.selection.has(s.id))];
  });
}

function moveUnit(unit, dx, dy) {
  for (const s of unit.sprites) { s.x += dx; s.y += dy; }
}

// mode: left | right | top | bottom | hcenter | vcenter. The first-selected
// sprite's unit is the reference and does not move.
export function align(doc, mode) {
  const units = doc.selectionUnits();
  if (units.length < 2) return;
  const ref = units[0].rect;
  doc.commit(() => {
    for (const u of units.slice(1)) {
      const r = u.rect;
      let dx = 0, dy = 0;
      switch (mode) {
        case 'left': dx = ref.x - r.x; break;
        case 'right': dx = (ref.x + ref.w) - (r.x + r.w); break;
        case 'top': dy = ref.y - r.y; break;
        case 'bottom': dy = (ref.y + ref.h) - (r.y + r.h); break;
        case 'hcenter': dx = (ref.x + ref.w / 2) - (r.x + r.w / 2); break;
        case 'vcenter': dy = (ref.y + ref.h / 2) - (r.y + r.h / 2); break;
      }
      moveUnit(u, Math.round(dx), Math.round(dy));
    }
  });
}

// axis 'x': side by side left to right; 'y': stacked top to bottom. Keeps the
// existing order, leaves the first unit in place, closes the gaps.
export function pack(doc, axis) {
  const units = doc.selectionUnits();
  if (units.length < 2) return;
  const size = axis === 'x' ? 'w' : 'h';
  const sorted = [...units].sort((a, b) => a.rect[axis] - b.rect[axis]);
  doc.commit(() => {
    let edge = sorted[0].rect[axis] + sorted[0].rect[size];
    for (const u of sorted.slice(1)) {
      const d = Math.round(edge - u.rect[axis]);
      moveUnit(u, axis === 'x' ? d : 0, axis === 'x' ? 0 : d);
      edge += u.rect[size];
    }
  });
}

// Insert copies of the given sprite records on top, offset, and select them.
// Groups are re-keyed so copies form their own groups.
export function pasteRecords(doc, records) {
  if (records.length === 0) return;
  doc.commit(() => {
    const groups = new Map();
    const ids = [];
    for (const r of records) {
      const copy = { ...r, id: newId(), x: r.x + DUPLICATE_OFFSET, y: r.y + DUPLICATE_OFFSET };
      if (copy.crop) copy.crop = { ...copy.crop };
      if (copy.group) {
        if (!groups.has(copy.group)) groups.set(copy.group, newId());
        copy.group = groups.get(copy.group);
      }
      doc.sprites.push(copy);
      ids.push(copy.id);
    }
    doc.dissolveSmallGroups();
    doc.selection = new Set(ids);
  });
}

export function duplicateSelected(doc) {
  pasteRecords(doc, doc.selectedSprites());
}

export function deleteSelected(doc) {
  if (doc.selection.size === 0) return;
  doc.commit(() => doc.removeSprites([...doc.selection]));
}

export function nudgeSelected(doc, dx, dy) {
  if (doc.selection.size === 0) return;
  doc.commit(() => { for (const s of doc.selectedSprites()) { s.x += dx; s.y += dy; } });
}

// Replace the selection with one sprite holding its rendered pixels.
export async function flattenSelected(doc) {
  const sel = doc.selectedSprites();
  if (sel.length < 2) return;
  const rendered = renderSprites(doc, sel);
  if (!rendered) return;
  const blob = await toPngBlob(rendered.canvas);
  const decoded = await decodeImage(blob);
  const imageId = doc.addImage({ ext: 'png', width: decoded.width, height: decoded.height, blob, drawable: decoded.drawable });
  const { box } = rendered;
  doc.commit(() => {
    const ids = new Set(sel.map(s => s.id));
    const topIndex = Math.max(...sel.map(s => doc.indexOf(s.id)));
    const sprite = { id: newId(), image: imageId, x: box.x, y: box.y, w: box.w, h: box.h };
    const below = doc.sprites.slice(0, topIndex).filter(s => !ids.has(s.id));
    const above = doc.sprites.slice(topIndex + 1).filter(s => !ids.has(s.id));
    doc.sprites = [...below, sprite, ...above];
    doc.dissolveSmallGroups();
    doc.selection = new Set([sprite.id]);
  });
}
