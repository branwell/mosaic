// The on-screen canvas: zoom/pan transform, drawing, hit-testing and handle
// geometry. Everything outside this module works in canvas (document) pixels.

import { rectOf } from './document.js';
import { drawSprite } from './raster.js';
import { regionToCanvas, visibleSource } from './region.js';

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_SIZE = 8;
const HANDLE_HIT = 7;
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 32;

export class View {
  constructor(canvas, doc) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.doc = doc;
    // UI state drawn over the document. region: {id, x, y, w, h} (see
    // region.js); handles: whether scale handles show (Select tool only).
    // regionMove: {id, holed, dx, dy} while region pixels are dragged.
    this.overlay = { marquee: null, crop: null, region: null, handles: true, regionMove: null };
    this._colors = null;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  // ---- geometry ----

  get zoom() { return this.doc.view.zoom; }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (w === 0 || h === 0) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.render();
  }

  width() { return this.canvas.clientWidth; }
  height() { return this.canvas.clientHeight; }

  toCanvas(sx, sy) {
    const v = this.doc.view;
    return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
  }

  toScreen(x, y) {
    const v = this.doc.view;
    return { x: x * v.zoom + v.panX, y: y * v.zoom + v.panY };
  }

  rectToScreen(r) {
    const p = this.toScreen(r.x, r.y);
    return { x: p.x, y: p.y, w: r.w * this.zoom, h: r.h * this.zoom };
  }

  pointerPos(e) {
    const b = this.canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  zoomAt(sx, sy, factor) {
    const v = this.doc.view;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
    const before = this.toCanvas(sx, sy);
    v.zoom = z;
    v.panX = sx - before.x * z;
    v.panY = sy - before.y * z;
    this.doc.emit();
  }

  setZoomCentered(z) {
    this.zoomAt(this.width() / 2, this.height() / 2, z / this.zoom);
  }

  panBy(dx, dy) {
    this.doc.view.panX += dx;
    this.doc.view.panY += dy;
    this.doc.emit();
  }

  fitAll() {
    const r = this.doc.contentRect();
    if (!r) { this.doc.view = { zoom: 1, panX: 0, panY: 0 }; this.doc.emit(); return; }
    const margin = 40;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM,
      Math.min((this.width() - 2 * margin) / r.w, (this.height() - 2 * margin) / r.h)));
    this.doc.view.zoom = z;
    this.doc.view.panX = (this.width() - r.w * z) / 2 - r.x * z;
    this.doc.view.panY = (this.height() - r.h * z) / 2 - r.y * z;
    this.doc.emit();
  }

  center() { return this.toCanvas(this.width() / 2, this.height() / 2); }

  // ---- hit testing ----

  hitSprite(cx, cy) {
    for (let i = this.doc.sprites.length - 1; i >= 0; i--) {
      const s = this.doc.sprites[i];
      if (cx >= s.x && cx < s.x + s.w && cy >= s.y && cy < s.y + s.h) return s;
    }
    return null;
  }

  // Screen positions of the eight handles of a canvas rect.
  handlePoints(rect) {
    const r = this.rectToScreen(rect);
    const mx = r.x + r.w / 2, my = r.y + r.h / 2, x2 = r.x + r.w, y2 = r.y + r.h;
    return {
      nw: { x: r.x, y: r.y }, n: { x: mx, y: r.y }, ne: { x: x2, y: r.y }, e: { x: x2, y: my },
      se: { x: x2, y: y2 }, s: { x: mx, y: y2 }, sw: { x: r.x, y: y2 }, w: { x: r.x, y: my },
    };
  }

  handleAt(sx, sy, rect) {
    if (!rect) return null;
    const pts = this.handlePoints(rect);
    for (const h of HANDLES) {
      const p = pts[h];
      if (Math.abs(sx - p.x) <= HANDLE_HIT && Math.abs(sy - p.y) <= HANDLE_HIT) return h;
    }
    return null;
  }

  // ---- drawing ----

  colors() {
    if (!this._colors) {
      const cs = getComputedStyle(this.canvas);
      const get = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
      this._colors = {
        bg: get('--canvas-bg', '#262626'),
        grid: get('--canvas-grid', '#3a3a3a'),
        accent: get('--accent', '#4ea1ff'),
        accentSoft: get('--accent-soft', 'rgba(78,161,255,0.15)'),
        handle: get('--handle', '#ffffff'),
        dim: get('--canvas-dim', 'rgba(0,0,0,0.6)'),
        regionShadow: get('--region-shadow', '#000000'),
      };
    }
    return this._colors;
  }

  render() {
    const { ctx, doc } = this;
    const c = this.colors();
    const v = doc.view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, this.width(), this.height());
    this.drawGrid(ctx, c);

    const crop = this.overlay.crop;

    ctx.save();
    ctx.setTransform(this.dpr * v.zoom, 0, 0, this.dpr * v.zoom, this.dpr * v.panX, this.dpr * v.panY);
    const move = this.overlay.regionMove;
    for (const s of doc.sprites) {
      if (crop && s.id === crop.id) this.drawCropped(ctx, s, crop);
      else if (move && s.id === move.id) this.drawRegionMove(ctx, s, move);
      else drawSprite(ctx, doc, s);
    }
    ctx.restore();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (crop) this.drawCropOverlay(ctx, c, crop);
    else this.drawSelection(ctx, c);
    if (this.overlay.region) this.drawRegion(ctx, c, this.overlay.region);
    if (this.overlay.marquee) this.drawMarquee(ctx, c, this.overlay.marquee);
  }

  drawGrid(ctx, c) {
    const v = this.doc.view;
    let step = 100;
    while (step * v.zoom < 24) step *= 2;
    while (step * v.zoom > 160) step /= 2;
    const sz = step * v.zoom;
    const x0 = ((v.panX % sz) + sz) % sz, y0 = ((v.panY % sz) + sz) % sz;
    ctx.fillStyle = c.grid;
    for (let x = x0; x < this.width(); x += sz)
      for (let y = y0; y < this.height(); y += sz) ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  drawSelection(ctx, c) {
    const doc = this.doc;
    if (doc.selection.size === 0) return;
    const ref = doc.referenceId();
    ctx.lineWidth = 1;
    for (const s of doc.selectedSprites()) {
      const r = this.rectToScreen(rectOf(s));
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = s.id === ref ? 3 : 1;
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    }
    // Group outlines
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const u of doc.selectionUnits()) {
      if (u.sprites.length < 2) continue;
      const r = this.rectToScreen(u.rect);
      ctx.strokeStyle = c.accent;
      ctx.strokeRect(Math.round(r.x) - 2.5, Math.round(r.y) - 2.5, Math.round(r.w) + 5, Math.round(r.h) + 5);
    }
    ctx.setLineDash([]);
    const unit = doc.singleUnitSelected();
    if (unit && this.overlay.handles) this.drawHandles(ctx, c, unit.rect);
  }

  drawHandles(ctx, c, rect) {
    const pts = this.handlePoints(rect);
    ctx.fillStyle = c.handle;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1;
    for (const h of HANDLES) {
      const p = pts[h];
      ctx.fillRect(Math.round(p.x) - HANDLE_SIZE / 2, Math.round(p.y) - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeRect(Math.round(p.x) - HANDLE_SIZE / 2 + 0.5, Math.round(p.y) - HANDLE_SIZE / 2 + 0.5, HANDLE_SIZE - 1, HANDLE_SIZE - 1);
    }
  }

  drawMarquee(ctx, c, m) {
    const r = this.rectToScreen(m);
    ctx.fillStyle = c.accentSoft;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    ctx.setLineDash([]);
  }

  // Dashed light line over a solid dark one, visible on any image.
  drawRegion(ctx, c, region) {
    const s = this.doc.sprite(region.id);
    if (!s) return;
    const m = this.overlay.regionMove;
    if (m) region = { ...region, x: region.x + m.dx, y: region.y + m.dy };
    const r = this.rectToScreen(regionToCanvas(this.doc, s, region));
    const x = Math.round(r.x) + 0.5, y = Math.round(r.y) + 0.5, w = Math.round(r.w), h = Math.round(r.h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.regionShadow;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = c.handle;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }

  // While region pixels are dragged: the sprite with its hole filled, and the
  // region's original pixels at the offset, clipped to the sprite.
  drawRegionMove(ctx, s, m) {
    const r = this.overlay.region, image = this.doc.images.get(s.image);
    if (!r || !image) return;
    ctx.drawImage(m.holed, s.x, s.y, s.w, s.h);
    const b = visibleSource(this.doc, s);
    const dest = regionToCanvas(this.doc, s, { x: r.x + m.dx, y: r.y + m.dy, w: r.w, h: r.h });
    ctx.save();
    ctx.beginPath();
    ctx.rect(s.x, s.y, s.w, s.h);
    ctx.clip();
    ctx.drawImage(image.drawable, b.x + r.x, b.y + r.y, r.w, r.h, dest.x, dest.y, dest.w, dest.h);
    ctx.restore();
  }

  // In crop mode the whole image is shown faintly, with the kept part on top.
  drawCropped(ctx, s, crop) {
    const image = this.doc.images.get(s.image);
    if (!image) return;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.drawImage(image.drawable, crop.fullX, crop.fullY, image.width * crop.kx, image.height * crop.ky);
    ctx.restore();
    drawSprite(ctx, this.doc, s);
  }

  drawCropOverlay(ctx, c, crop) {
    const s = this.doc.sprite(crop.id);
    if (!s) return;
    const r = this.rectToScreen(rectOf(s));
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    this.drawHandles(ctx, c, rectOf(s));
  }
}
