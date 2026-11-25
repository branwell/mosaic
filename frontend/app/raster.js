// Rendering sprites to pixels. Used by the on-screen view, by flatten and by
// the PNG exports, so every path draws a sprite the same way.

import { rectOf, unionRect } from './document.js';

export function drawSprite(ctx, doc, sprite) {
  const image = doc.images.get(sprite.image);
  if (!image) return;
  const c = sprite.crop;
  if (c) ctx.drawImage(image.drawable, c.x, c.y, c.w, c.h, sprite.x, sprite.y, sprite.w, sprite.h);
  else ctx.drawImage(image.drawable, sprite.x, sprite.y, sprite.w, sprite.h);
}

// Integer bounding box that fully contains the sprites.
export function pixelBox(sprites) {
  const r = unionRect(sprites.map(rectOf));
  if (!r) return null;
  const x = Math.floor(r.x), y = Math.floor(r.y);
  return { x, y, w: Math.max(1, Math.ceil(r.x + r.w) - x), h: Math.max(1, Math.ceil(r.y + r.h) - y) };
}

// Render the given sprites (in the order given, which should be z order) at
// true pixel size onto a transparent canvas the size of their bounding box.
export function renderSprites(doc, sprites) {
  const box = pixelBox(sprites);
  if (!box) return null;
  const canvas = new OffscreenCanvas(box.w, box.h);
  const ctx = canvas.getContext('2d');
  ctx.translate(-box.x, -box.y);
  for (const s of sprites) drawSprite(ctx, doc, s);
  return { canvas, box };
}

// Cut a source-pixel rectangle out of an image at its natural resolution.
// The pixels are drawn synchronously, so the canvas can be used as a drawable
// at once; the PNG bytes follow as a promise.
export function cropPixels(image, c) {
  const canvas = new OffscreenCanvas(c.w, c.h);
  canvas.getContext('2d').drawImage(image.drawable, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
  return { canvas, blob: toPngBlob(canvas) };
}

// The visible source rectangle `base` of an image, with rectangle `r`
// (relative to base) made transparent, or filled with `fill` (a CSS color)
// when one is given.
export function clearPixels(image, base, r, fill = null) {
  const canvas = clearedCanvas(image, base, r, fill);
  return { canvas, blob: toPngBlob(canvas) };
}

// As clearPixels, without encoding: for previews.
export function clearedCanvas(image, base, r, fill = null) {
  const canvas = new OffscreenCanvas(base.w, base.h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image.drawable, base.x, base.y, base.w, base.h, 0, 0, base.w, base.h);
  ctx.clearRect(r.x, r.y, r.w, r.h);
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(r.x, r.y, r.w, r.h); }
  return canvas;
}

// As clearPixels, then the region's original pixels drawn over the result at
// offset dx, dy (source pixels). Pixels moved past the edge are clipped.
export function movePixels(image, base, r, dx, dy, fill = null) {
  const canvas = clearedCanvas(image, base, r, fill);
  canvas.getContext('2d').drawImage(image.drawable, base.x + r.x, base.y + r.y, r.w, r.h, r.x + dx, r.y + dy, r.w, r.h);
  return { canvas, blob: toPngBlob(canvas) };
}

// Draw text in one style onto a canvas fitted to its ink, plus a pixel of
// margin for antialiasing. The text's layout starts at (0, 0): line i fills
// y from i * size * lineHeight, with the glyphs centered in the line as CSS
// places them, so the result lands where the text box showed it. Returns the
// canvas, its PNG bytes, and the canvas's offset (x, y) from the layout
// origin; null if nothing would be drawn.
export function renderText(text, { font, size, color }, lineHeight) {
  const spec = `${size}px ${font}`;
  const probe = new OffscreenCanvas(1, 1).getContext('2d');
  probe.font = spec;
  const lh = size * lineHeight;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const lines = text.split('\n').map((line, i) => {
    const m = probe.measureText(line);
    const baseline = i * lh + (lh - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent;
    if (line.trim()) {
      x1 = Math.min(x1, -m.actualBoundingBoxLeft);
      x2 = Math.max(x2, m.actualBoundingBoxRight);
      y1 = Math.min(y1, baseline - m.actualBoundingBoxAscent);
      y2 = Math.max(y2, baseline + m.actualBoundingBoxDescent);
    }
    return { line, baseline };
  });
  if (x1 === Infinity) return null;
  const x = Math.floor(x1) - 1, y = Math.floor(y1) - 1;
  const canvas = new OffscreenCanvas(Math.ceil(x2) + 1 - x, Math.ceil(y2) + 1 - y);
  const ctx = canvas.getContext('2d');
  ctx.font = spec;
  ctx.fillStyle = color;
  for (const l of lines) ctx.fillText(l.line, -x, l.baseline - y);
  return { canvas, blob: toPngBlob(canvas), x, y };
}

export function toPngBlob(canvas) {
  return canvas.convertToBlob({ type: 'image/png' });
}

// Decode image bytes into something drawImage accepts, plus its natural size.
// Goes through an <img> so every format the browser knows (including SVG)
// works the same way.
export function decodeImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth === 0 || img.naturalHeight === 0) reject(new Error('image has no size'));
      else resolve({ drawable: img, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('cannot decode image')); };
    img.src = url;
  });
}
