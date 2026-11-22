// Region: a rectangle of pixels inside one sprite, chosen with the Region
// tool. Its coordinates are source pixels relative to the sprite's visible
// part (the top-left visible pixel is 0,0). The region is UI state, not part
// of the document, and is never saved or undone.
//
// Copy produces a new image from the region; cut and delete give the sprite a
// new image with the region made transparent or filled with the background
// color. Originals are never modified.

import { newId } from './document.js';
import { cropPixels, clearPixels, movePixels } from './raster.js';

// The part of the image a sprite shows, in source pixels.
export function visibleSource(doc, s) {
  const image = doc.images.get(s.image);
  return s.crop || { x: 0, y: 0, w: image.width, h: image.height };
}

// Canvas rect covered by a region of sprite s.
export function regionToCanvas(doc, s, r) {
  const b = visibleSource(doc, s);
  const kx = s.w / b.w, ky = s.h / b.h;
  return { x: s.x + r.x * kx, y: s.y + r.y * ky, w: r.w * kx, h: r.h * ky };
}

// Canvas point -> region pixel coordinate of sprite s, clamped to its bounds.
export function canvasToRegionPoint(doc, s, p) {
  const b = visibleSource(doc, s);
  const clampTo = (v, hi) => Math.min(hi, Math.max(0, Math.round(v)));
  return { x: clampTo((p.x - s.x) * b.w / s.w, b.w), y: clampTo((p.y - s.y) * b.h / s.h, b.h) };
}

// Is the region still meaningful for the sprite (exists, fits inside it)?
export function regionFits(doc, s, r) {
  if (!s) return false;
  const b = visibleSource(doc, s);
  return r.w >= 1 && r.h >= 1 && r.x >= 0 && r.y >= 0 && r.x + r.w <= b.w && r.y + r.h <= b.h;
}

// The region's pixels as a new image record (not yet added to the document)
// plus the canvas rect it came from, for pasting in place.
export function copyRegion(doc, s, r) {
  const b = visibleSource(doc, s);
  const { canvas, blob } = cropPixels(doc.images.get(s.image), { x: b.x + r.x, y: b.y + r.y, w: r.w, h: r.h });
  return {
    image: { id: newId(), ext: 'png', width: r.w, height: r.h, blob, drawable: canvas },
    rect: regionToCanvas(doc, s, r),
  };
}

// Clear the region to `fill` (a CSS color, or null for transparent): one undo step.
export function clearRegion(doc, s, r, fill = null) {
  const b = visibleSource(doc, s);
  const { canvas, blob } = clearPixels(doc.images.get(s.image), b, r, fill);
  const imageId = doc.addImage({ ext: 'png', width: b.w, height: b.h, blob, drawable: canvas });
  doc.commit(() => { s.image = imageId; delete s.crop; });
}

// Where region r lands after moving dx, dy, clipped to the sprite; null if
// nothing of it remains inside.
export function movedRegion(doc, s, r, dx, dy) {
  const b = visibleSource(doc, s);
  const x1 = Math.max(0, r.x + dx), y1 = Math.max(0, r.y + dy);
  const x2 = Math.min(b.w, r.x + dx + r.w), y2 = Math.min(b.h, r.y + dy + r.h);
  return x2 > x1 && y2 > y1 ? { id: r.id, x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}

// Move the region's pixels by dx, dy within the sprite, filling the space
// left behind with `fill` (or transparent): one undo step.
export function moveRegion(doc, s, r, dx, dy, fill = null) {
  const b = visibleSource(doc, s);
  const { canvas, blob } = movePixels(doc.images.get(s.image), b, r, dx, dy, fill);
  const imageId = doc.addImage({ ext: 'png', width: b.w, height: b.h, blob, drawable: canvas });
  doc.commit(() => { s.image = imageId; delete s.crop; });
}

// Paste copied pixels as a new sprite where they were copied from.
export function pastePixels(doc, clip) {
  if (!doc.images.has(clip.image.id)) doc.addImage(clip.image);
  doc.commit(() => {
    const { x, y, w, h } = clip.rect;
    const s = doc.addSprite({ image: clip.image.id, x, y, w, h });
    doc.selection = new Set([s.id]);
  });
}
