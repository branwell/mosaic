// The document model: images, sprites, groups, selection and undo.
// This module knows nothing about the DOM or the canvas.

export const DOCUMENT_VERSION = 1;

export function newId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}

export function rectOf(sprite) {
  return { x: sprite.x, y: sprite.y, w: sprite.w, h: sprite.h };
}

export function unionRect(rects) {
  if (rects.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export class Document {
  constructor() {
    this._listeners = new Set();
    this.reset();
  }

  reset() {
    /** @type {Map<string, {id:string, ext:string, width:number, height:number, blob:Blob|Promise<Blob>, drawable:CanvasImageSource}>} */
    this.images = new Map();
    /** @type {Array<{id:string, image:string, x:number, y:number, w:number, h:number, crop?:{x:number,y:number,w:number,h:number}, group?:string}>} */
    this.sprites = [];
    this.view = { zoom: 1, panX: 0, panY: 0 };
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.name = 'Untitled';
    this.handle = null;
    this.selection = new Set(); // sprite ids in selection order; first is the reference
    this._edit = null;
    this.emit();
  }

  // ---- change notification ----

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  emit() { for (const fn of this._listeners) fn(this); }

  // ---- images ----

  addImage({ id = newId(), ext, width, height, blob, drawable }) {
    this.images.set(id, { id, ext, width, height, blob, drawable });
    return id;
  }

  // ---- sprites ----

  sprite(id) { return this.sprites.find(s => s.id === id) || null; }
  indexOf(id) { return this.sprites.findIndex(s => s.id === id); }

  addSprite(fields) {
    const sprite = { id: newId(), ...fields };
    this.sprites.push(sprite);
    return sprite;
  }

  removeSprites(ids) {
    const gone = new Set(ids);
    this.sprites = this.sprites.filter(s => !gone.has(s.id));
    this.dissolveSmallGroups();
    for (const id of gone) this.selection.delete(id);
  }

  groupMembers(groupId) {
    return this.sprites.filter(s => s.group === groupId).map(s => s.id);
  }

  // A group with fewer than two members is not a group.
  dissolveSmallGroups() {
    const counts = new Map();
    for (const s of this.sprites) if (s.group) counts.set(s.group, (counts.get(s.group) || 0) + 1);
    for (const s of this.sprites) if (s.group && counts.get(s.group) < 2) delete s.group;
  }

  // ---- undo ----

  _snapshot() { return JSON.stringify(this.sprites); }
  _restore(snapshot) { this.sprites = JSON.parse(snapshot); this._pruneSelection(); }

  // beginEdit/endEdit bracket an interactive change (a drag) so it becomes
  // one undo step. commit() wraps a one-shot change.
  beginEdit() { if (this._edit === null) this._edit = this._snapshot(); }

  endEdit() {
    const before = this._edit;
    this._edit = null;
    if (before === null) return false;
    const after = this._snapshot();
    if (after === before) { this.emit(); return false; }
    this.undoStack.push(before);
    this.redoStack = [];
    this.dirty = true;
    this.emit();
    return true;
  }

  cancelEdit() {
    if (this._edit === null) return;
    this._restore(this._edit);
    this._edit = null;
    this.emit();
  }

  commit(fn) { this.beginEdit(); fn(); return this.endEdit(); }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    if (!this.canUndo()) return;
    this.redoStack.push(this._snapshot());
    this._restore(this.undoStack.pop());
    this.dirty = true;
    this.emit();
  }

  redo() {
    if (!this.canRedo()) return;
    this.undoStack.push(this._snapshot());
    this._restore(this.redoStack.pop());
    this.dirty = true;
    this.emit();
  }

  // ---- selection ----

  _pruneSelection() {
    for (const id of [...this.selection]) if (!this.sprite(id)) this.selection.delete(id);
  }

  // The selectable unit containing a sprite: its whole group, or itself.
  unitOf(id) {
    const s = this.sprite(id);
    if (!s) return [];
    return s.group ? [id, ...this.groupMembers(s.group).filter(m => m !== id)] : [id];
  }

  isSelected(id) { return this.selection.has(id); }

  // Click semantics. Returns true if the clicked sprite is selected afterwards.
  selectHit(id, additive) {
    const unit = this.unitOf(id);
    const allIn = unit.every(m => this.selection.has(m));
    if (additive) {
      if (allIn) unit.forEach(m => this.selection.delete(m));
      else unit.forEach(m => this.selection.add(m));
    } else if (!allIn) {
      this.selection = new Set(unit);
    }
    this.emit();
    return this.selection.has(id);
  }

  setSelection(ids) {
    this.selection = new Set();
    for (const id of ids) for (const m of this.unitOf(id)) this.selection.add(m);
    this.emit();
  }

  addToSelection(ids) {
    for (const id of ids) for (const m of this.unitOf(id)) this.selection.add(m);
    this.emit();
  }

  clearSelection() { if (this.selection.size) { this.selection.clear(); this.emit(); } }
  selectAll() { this.selection = new Set(this.sprites.map(s => s.id)); this.emit(); }

  referenceId() { return this.selection.values().next().value ?? null; }

  // Selected sprites in z order (bottom first).
  selectedSprites() { return this.sprites.filter(s => this.selection.has(s.id)); }

  selectionRect() { return unionRect(this.selectedSprites().map(rectOf)); }

  // Units of the selection for arranging: each group as one unit, each
  // ungrouped sprite as its own. The reference unit comes first.
  selectionUnits() {
    const units = new Map();
    for (const s of this.selectedSprites()) {
      const key = s.group ? 'g:' + s.group : 's:' + s.id;
      if (!units.has(key)) units.set(key, { key, sprites: [] });
      units.get(key).sprites.push(s);
    }
    const list = [...units.values()].map(u => ({ ...u, rect: unionRect(u.sprites.map(rectOf)) }));
    const ref = this.referenceId();
    list.sort((a, b) => (a.sprites.some(s => s.id === ref) ? -1 : 0) - (b.sprites.some(s => s.id === ref) ? -1 : 0));
    return list;
  }

  // Single sprite (ungrouped) or single whole group selected?
  singleUnitSelected() {
    const units = this.selectionUnits();
    return units.length === 1 ? units[0] : null;
  }

  // ---- whole-document state ----

  contentRect() { return unionRect(this.sprites.map(rectOf)); }

  referencedImageIds() { return new Set(this.sprites.map(s => s.image)); }

  serialize() {
    const used = this.referencedImageIds();
    return {
      version: DOCUMENT_VERSION,
      view: { ...this.view },
      images: [...this.images.values()].filter(im => used.has(im.id))
        .map(im => ({ id: im.id, ext: im.ext, width: im.width, height: im.height })),
      sprites: this.sprites.map(s => ({ ...s })),
    };
  }

  // Replace the whole document (after New or Open). images: array of image
  // records already decoded; sprites: plain records; view: optional.
  load({ images = [], sprites = [], view = null, name = 'Untitled', handle = null }) {
    this.reset();
    for (const im of images) this.addImage(im);
    this.sprites = sprites.map(s => ({ ...s }));
    this.dissolveSmallGroups();
    if (view) this.view = { zoom: view.zoom || 1, panX: view.panX || 0, panY: view.panY || 0 };
    this.name = name;
    this.handle = handle;
    this.emit();
  }

  markClean() { this.dirty = false; this.emit(); }
}
