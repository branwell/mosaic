// Pointer interactions on the canvas: select, marquee, move, scale, crop,
// region, pan and wheel zoom. The active tool (select, region or text) decides what
// a left-drag does; panning, zoom and crop mode work the same in every tool. Keyboard handling lives in main.js and calls into the
// returned tools object.

import { rectOf, rectsIntersect } from './document.js';
import { cropPixels, clearedCanvas } from './raster.js';
import { canvasToRegionPoint, regionFits, regionToCanvas, visibleSource, movedRegion, moveRegion } from './region.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const CLICK_SLOP = 3; // screen px a right-button press may move and still count as a click

// background(): the current background color (CSS color, or null for transparent).
// onText(cp): a left press with the Text tool at canvas point cp.
export function attachTools(canvas, doc, view, { onContextMenu = () => {}, background = () => null, onText = () => {} } = {}) {
  const state = { drag: null, space: false, tool: 'select' };

  // Drop the region when its sprite is no longer the sole selection or it no
  // longer fits (undo, delete, crop).
  doc.onChange(() => {
    const r = view.overlay.region;
    if (!r) return;
    const sel = doc.selectedSprites();
    if (sel.length !== 1 || sel[0].id !== r.id || !regionFits(doc, sel[0], r)) view.overlay.region = null;
  });

  const setCursor = name => {
    if (name) canvas.dataset.cursor = name; else delete canvas.dataset.cursor;
  };

  const tools = {
    get cropping() { return view.overlay.crop; },
    get tool() { return state.tool; },
    get region() { return view.overlay.region; },

    setTool(name) {
      if (name === state.tool) return;
      state.tool = name;
      view.overlay.region = null;
      view.overlay.handles = name === 'select';
      doc.emit();
    },

    clearRegion() {
      if (!view.overlay.region) return false;
      view.overlay.region = null;
      doc.emit();
      return true;
    },

    setSpace(down) { state.space = down; if (!state.drag) setCursor(down ? 'grab' : null); },

    // Crop mode is one undo step from enter to exit. Leaving it with commit
    // replaces the sprite's image with a new PNG of only the kept pixels.
    enterCrop(id) {
      const s = doc.sprite(id);
      if (!s || s.group || view.overlay.crop) return false;
      view.overlay.region = null;
      const image = doc.images.get(s.image);
      const c = s.crop || { x: 0, y: 0, w: image.width, h: image.height };
      const kx = s.w / c.w, ky = s.h / c.h;
      doc.beginEdit();
      if (!s.crop) s.crop = { ...c };
      view.overlay.crop = {
        id, kx, ky, fullX: s.x - c.x * kx, fullY: s.y - c.y * ky, width: image.width, height: image.height,
      };
      doc.setSelection([id]);
      return true;
    },

    exitCrop(commit = true) {
      const crop = view.overlay.crop;
      if (!crop) return;
      view.overlay.crop = null;
      const s = doc.sprite(crop.id);
      if (commit && s) {
        const c = s.crop;
        const whole = c && c.x === 0 && c.y === 0 && c.w === crop.width && c.h === crop.height;
        if (c && !whole) {
          // The original image is left untouched for other sprites and for undo.
          const { canvas, blob } = cropPixels(doc.images.get(s.image), c);
          s.image = doc.addImage({ ext: 'png', width: c.w, height: c.h, blob, drawable: canvas });
        }
        delete s.crop;
        doc.endEdit();
      } else {
        doc.cancelEdit();
      }
    },
  };

  // ---- pointer down ----

  canvas.addEventListener('pointerdown', e => {
    canvas.focus();
    const sp = view.pointerPos(e);
    const cp = view.toCanvas(sp.x, sp.y);

    if (e.button === 1 || e.button === 2 || (e.button === 0 && state.space)) {
      begin(e, { kind: 'pan', last: sp, origin: sp, button: e.button, moved: false });
      setCursor('grabbing');
      return;
    }
    if (e.button !== 0) return;

    const crop = view.overlay.crop;
    if (crop) {
      const s = doc.sprite(crop.id);
      const h = view.handleAt(sp.x, sp.y, rectOf(s));
      if (h) { begin(e, { kind: 'crop', handle: h }); return; }
      if (contains(rectOf(s), cp)) return;
      tools.exitCrop(true);
    }

    if (state.tool === 'text') { onText(cp); return; }
    if (state.tool === 'region' && regionDown(e, cp)) return;

    const unit = doc.singleUnitSelected();
    if (unit) {
      const h = view.handleAt(sp.x, sp.y, unit.rect);
      if (h) {
        doc.beginEdit();
        begin(e, { kind: 'scale', handle: h, B: unit.rect, orig: unit.sprites.map(s => ({ id: s.id, ...rectOf(s) })) });
        return;
      }
    }

    // Shift on the one selected sprite: a click removes it from the selection
    // (as for any sprite); a drag draws a region and switches to the Region tool.
    const single = singleSprite();
    if (e.shiftKey && single && contains(rectOf(single), cp)) {
      begin(e, { kind: 'shiftPending', id: single.id, origin: sp, startCp: cp });
      return;
    }

    const hit = view.hitSprite(cp.x, cp.y);
    if (hit) {
      if (doc.selectHit(hit.id, e.shiftKey)) {
        doc.beginEdit();
        begin(e, { kind: 'move', start: cp, orig: doc.selectedSprites().map(s => ({ id: s.id, x: s.x, y: s.y })) });
        setCursor('move');
      }
      return;
    }

    if (!e.shiftKey) doc.clearSelection();
    begin(e, { kind: 'marquee', start: cp, additive: e.shiftKey });
    setCursor('crosshair');
  });

  // The one selected sprite, if exactly one ungrouped sprite is selected.
  function singleSprite() {
    const sel = doc.selectedSprites();
    return sel.length === 1 && !sel[0].group ? sel[0] : null;
  }

  // Region tool: a drag inside the region moves its pixels; a drag elsewhere
  // inside the selected sprite draws a new region. A press outside the
  // selected sprite switches back to the Select tool and returns false so the
  // press is handled as a Select-tool press.
  function regionDown(e, cp) {
    const target = singleSprite();
    const r = view.overlay.region;
    if (target && r && r.id === target.id && contains(regionToCanvas(doc, target, r), cp)) {
      // Preview: the sprite with the hole already filled, plus the moving pixels.
      const holed = clearedCanvas(doc.images.get(target.image), visibleSource(doc, target), r, background());
      view.overlay.regionMove = { id: target.id, holed, dx: 0, dy: 0 };
      begin(e, { kind: 'regionMove', id: target.id, start: cp });
      return true;
    }
    if (target && contains(rectOf(target), cp)) {
      view.overlay.region = null;
      begin(e, { kind: 'region', id: target.id, start: canvasToRegionPoint(doc, target, cp) });
      doc.emit();
      return true;
    }
    tools.setTool('select');
    return false;
  }

  function begin(e, drag) {
    state.drag = drag;
    canvas.setPointerCapture(e.pointerId);
  }

  // ---- pointer move ----

  canvas.addEventListener('pointermove', e => {
    const sp = view.pointerPos(e);
    const cp = view.toCanvas(sp.x, sp.y);
    const d = state.drag;
    if (!d) { hover(sp, cp); return; }
    switch (d.kind) {
      case 'pan':
        if (Math.hypot(sp.x - d.origin.x, sp.y - d.origin.y) > CLICK_SLOP) d.moved = true;
        view.panBy(sp.x - d.last.x, sp.y - d.last.y);
        d.last = sp;
        break;
      case 'move': {
        const dx = Math.round(cp.x - d.start.x), dy = Math.round(cp.y - d.start.y);
        for (const o of d.orig) { const s = doc.sprite(o.id); if (s) { s.x = o.x + dx; s.y = o.y + dy; } }
        doc.emit();
        break;
      }
      case 'marquee':
        view.overlay.marquee = normalize(d.start, cp);
        view.render();
        break;
      case 'scale':
        scaleTo(d, cp, e.shiftKey);
        break;
      case 'crop':
        cropTo(d, cp);
        break;
      case 'shiftPending': {
        if (Math.hypot(sp.x - d.origin.x, sp.y - d.origin.y) <= CLICK_SLOP) break;
        const s = doc.sprite(d.id);
        if (!s) break;
        tools.setTool('region');
        state.drag = { kind: 'region', id: d.id, start: canvasToRegionPoint(doc, s, d.startCp) };
        const r = normalize(state.drag.start, canvasToRegionPoint(doc, s, cp));
        view.overlay.region = r.w >= 1 && r.h >= 1 ? { id: d.id, ...r } : null;
        view.render();
        break;
      }
      case 'region': {
        const s = doc.sprite(d.id);
        if (!s) break;
        const r = normalize(d.start, canvasToRegionPoint(doc, s, cp));
        view.overlay.region = r.w >= 1 && r.h >= 1 ? { id: d.id, ...r } : null;
        view.render();
        break;
      }
      case 'regionMove': {
        const s = doc.sprite(d.id), m = view.overlay.regionMove;
        if (!s || !m) break;
        const b = visibleSource(doc, s);
        m.dx = Math.round((cp.x - d.start.x) * b.w / s.w);
        m.dy = Math.round((cp.y - d.start.y) * b.h / s.h);
        view.render();
        break;
      }
    }
  });

  function hover(sp, cp) {
    if (state.space) { setCursor('grab'); return; }
    const crop = view.overlay.crop;
    if (crop) {
      const s = doc.sprite(crop.id);
      setCursor(view.handleAt(sp.x, sp.y, rectOf(s)));
      return;
    }
    if (state.tool === 'text') { setCursor('text'); return; }
    if (state.tool === 'region') {
      const sel = doc.selectedSprites();
      const s = sel.length === 1 && !sel[0].group ? sel[0] : null;
      const r = view.overlay.region;
      if (s && r && r.id === s.id && contains(regionToCanvas(doc, s, r), cp)) setCursor('move');
      else setCursor(s && contains(rectOf(s), cp) ? 'crosshair' : null);
      return;
    }
    const unit = doc.singleUnitSelected();
    const h = unit && view.handleAt(sp.x, sp.y, unit.rect);
    if (h) { setCursor(h); return; }
    setCursor(view.hitSprite(cp.x, cp.y) ? 'move' : null);
  }

  // ---- pointer up ----

  canvas.addEventListener('pointerup', e => {
    const d = state.drag;
    if (!d) return;
    state.drag = null;
    canvas.releasePointerCapture(e.pointerId);
    setCursor(state.space ? 'grab' : null);
    switch (d.kind) {
      case 'pan':
        // A right-click that did not pan opens the context menu on the sprite under it.
        if (d.button === 2 && !d.moved && !view.overlay.crop) {
          const cp = view.toCanvas(d.origin.x, d.origin.y);
          const hit = view.hitSprite(cp.x, cp.y);
          if (hit && !doc.isSelected(hit.id)) doc.selectHit(hit.id, false);
          onContextMenu({ x: e.clientX, y: e.clientY });
        }
        break;
      case 'move':
      case 'scale':
        doc.endEdit();
        break;
      case 'marquee': {
        const m = view.overlay.marquee;
        view.overlay.marquee = null;
        if (m) {
          const ids = doc.sprites.filter(s => rectsIntersect(rectOf(s), m)).map(s => s.id);
          if (d.additive) doc.addToSelection(ids); else doc.setSelection(ids);
        } else {
          doc.emit();
        }
        break;
      }
      case 'crop':
      case 'region':
        doc.emit();
        break;
      case 'regionMove':
        finishRegionMove();
        break;
      case 'shiftPending':
        doc.selectHit(d.id, true);
        break;
    }
  });

  function finishRegionMove() {
    const m = view.overlay.regionMove, r = view.overlay.region;
    view.overlay.regionMove = null;
    const s = m && doc.sprite(m.id);
    if (!s || !r || (m.dx === 0 && m.dy === 0)) { doc.emit(); return; }
    // Set the region first so the change listener finds it fitting the new image.
    view.overlay.region = movedRegion(doc, s, r, m.dx, m.dy);
    moveRegion(doc, s, r, m.dx, m.dy, background());
  }

  canvas.addEventListener('lostpointercapture', () => {
    if (state.drag && (state.drag.kind === 'move' || state.drag.kind === 'scale')) doc.endEdit();
    if (state.drag && state.drag.kind === 'marquee') { view.overlay.marquee = null; doc.emit(); }
    if (state.drag && state.drag.kind === 'regionMove') { view.overlay.regionMove = null; doc.emit(); }
    state.drag = null;
  });

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // A press on the canvas focuses it after pointerdown has run, which would
  // take focus from a text box the press just opened and place it at once.
  canvas.addEventListener('mousedown', e => { if (state.tool === 'text' && e.button === 0) e.preventDefault(); });

  canvas.addEventListener('dblclick', e => {
    const sp = view.pointerPos(e);
    const cp = view.toCanvas(sp.x, sp.y);
    const hit = view.hitSprite(cp.x, cp.y);
    if (state.tool === 'select' && hit && !hit.group && !view.overlay.crop) tools.enterCrop(hit.id);
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const sp = view.pointerPos(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
    view.zoomAt(sp.x, sp.y, Math.pow(1.0015, -delta));
  }, { passive: false });

  // ---- scale math ----

  function scaleTo(d, cp, free) {
    const { B, handle: h } = d;
    const left = h.includes('w'), right = h.includes('e'), top = h.includes('n'), bottom = h.includes('s');
    const ax = left ? B.x + B.w : B.x;
    const ay = top ? B.y + B.h : B.y;
    let nx = B.x, ny = B.y, nw = B.w, nh = B.h;

    if ((left || right) && (top || bottom)) {
      if (free) {
        nw = Math.max(1, left ? ax - cp.x : cp.x - ax);
        nh = Math.max(1, top ? ay - cp.y : cp.y - ay);
      } else {
        // Project the pointer onto the diagonal from the anchor to the dragged corner.
        const cx = left ? B.x : B.x + B.w, cy = top ? B.y : B.y + B.h;
        const dx = cx - ax, dy = cy - ay;
        const s = ((cp.x - ax) * dx + (cp.y - ay) * dy) / (dx * dx + dy * dy);
        const sc = Math.max(Math.max(1 / B.w, 1 / B.h), s);
        nw = B.w * sc; nh = B.h * sc;
      }
      nx = left ? ax - nw : ax;
      ny = top ? ay - nh : ay;
    } else if (left || right) {
      nw = Math.max(1, left ? ax - cp.x : cp.x - ax);
      nx = left ? ax - nw : ax;
      if (!free) { nh = B.h * nw / B.w; ny = B.y + (B.h - nh) / 2; }
    } else {
      nh = Math.max(1, top ? ay - cp.y : cp.y - ay);
      ny = top ? ay - nh : ay;
      if (!free) { nw = B.w * nh / B.h; nx = B.x + (B.w - nw) / 2; }
    }

    for (const o of d.orig) {
      const s = doc.sprite(o.id);
      if (!s) continue;
      const x1 = nx + (o.x - B.x) * nw / B.w, y1 = ny + (o.y - B.y) * nh / B.h;
      const x2 = nx + (o.x + o.w - B.x) * nw / B.w, y2 = ny + (o.y + o.h - B.y) * nh / B.h;
      s.x = Math.round(x1); s.y = Math.round(y1);
      s.w = Math.max(1, Math.round(x2) - s.x); s.h = Math.max(1, Math.round(y2) - s.y);
    }
    doc.emit();
  }

  // ---- crop math ----

  function cropTo(d, cp) {
    const crop = view.overlay.crop;
    const s = doc.sprite(crop.id);
    if (!s || !s.crop) return;
    const c = s.crop, h = d.handle;
    const sx = (cp.x - crop.fullX) / crop.kx, sy = (cp.y - crop.fullY) / crop.ky;
    let x1 = c.x, y1 = c.y, x2 = c.x + c.w, y2 = c.y + c.h;
    if (h.includes('w')) x1 = clamp(Math.round(sx), 0, x2 - 1);
    if (h.includes('e')) x2 = clamp(Math.round(sx), x1 + 1, crop.width);
    if (h.includes('n')) y1 = clamp(Math.round(sy), 0, y2 - 1);
    if (h.includes('s')) y2 = clamp(Math.round(sy), y1 + 1, crop.height);
    s.crop = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    s.x = crop.fullX + x1 * crop.kx;
    s.y = crop.fullY + y1 * crop.ky;
    s.w = (x2 - x1) * crop.kx;
    s.h = (y2 - y1) * crop.ky;
    doc.emit();
  }

  return tools;
}

function contains(r, p) {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

function normalize(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
