// Getting images in and documents out: import (paste, drop, picker), open and
// save through the File System Access API, recent files, and the local API
// that packs and unpacks .mmsc archives.

import { decodeImage, renderSprites, toPngBlob } from './raster.js';

const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));

const MMSC_TYPES = [{ description: 'Mosaic composition', accept: { 'application/x-mosaic': ['.mmsc'] } }];
const PNG_TYPES = [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }];
const IMAGE_TYPES = [{ description: 'Images', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'] } }];

const IMPORT_OFFSET = 20;
const RECENT_LIMIT = 10;

export function supportsFileSystemAccess() {
  return typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';
}

function requireFileSystemAccess() {
  if (!supportsFileSystemAccess()) throw new Error('Opening and saving files needs Chrome or Edge');
}

// ---- import ----

export function imageFilesFromDataTransfer(dt) {
  const out = [];
  for (const item of dt?.items || []) {
    if (item.kind !== 'file') continue;
    const f = item.getAsFile();
    if (f && f.type.startsWith('image/')) out.push(f);
  }
  return out;
}

// Decode blobs and add one sprite each, centered on `at` and staggered.
// Returns the names that failed to decode.
export async function importBlobs(doc, blobs, at) {
  const added = [], failed = [];
  for (const blob of blobs) {
    const ext = EXT_BY_MIME[blob.type];
    if (!ext) { failed.push(blob.name || blob.type || 'image'); continue; }
    try {
      const d = await decodeImage(blob);
      const image = doc.addImage({ ext, width: d.width, height: d.height, blob, drawable: d.drawable });
      added.push({ image, w: d.width, h: d.height });
    } catch {
      failed.push(blob.name || 'pasted image');
    }
  }
  if (added.length) {
    doc.commit(() => {
      const ids = added.map((a, i) => doc.addSprite({
        image: a.image,
        x: Math.round(at.x - a.w / 2) + i * IMPORT_OFFSET,
        y: Math.round(at.y - a.h / 2) + i * IMPORT_OFFSET,
        w: a.w, h: a.h,
      }).id);
      doc.setSelection(ids);
    });
  }
  return failed;
}

export async function pickImages() {
  if (supportsFileSystemAccess()) {
    const handles = await window.showOpenFilePicker({ multiple: true, types: IMAGE_TYPES });
    return Promise.all(handles.map(h => h.getFile()));
  }
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

// ---- open / save ----

const stripExt = name => name.replace(/\.mmsc$/i, '');

async function ensurePermission(handle, mode) {
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

async function writeHandle(handle, blob) {
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function openFile(doc, handle = null) {
  requireFileSystemAccess();
  if (!handle) [handle] = await window.showOpenFilePicker({ types: MMSC_TYPES, multiple: false });
  if (!(await ensurePermission(handle, 'readwrite'))) throw new Error('Permission to read the file was not granted');
  const file = await handle.getFile();

  const res = await fetch('/api/unpack', { method: 'POST', body: file });
  if (!res.ok) throw new Error(await res.text());
  const { document: d, images } = await res.json();

  const decoded = [];
  for (const im of d.images) {
    const name = `${im.id}.${im.ext}`;
    const blob = new Blob([base64ToBytes(images[name])], { type: MIME_BY_EXT[im.ext] || 'application/octet-stream' });
    const dec = await decodeImage(blob);
    decoded.push({ id: im.id, ext: im.ext, width: dec.width, height: dec.height, blob, drawable: dec.drawable });
  }
  doc.load({ images: decoded, sprites: d.sprites, view: d.view, name: stripExt(handle.name), handle });
  await addRecent(handle);
}

async function packDocument(doc) {
  const d = doc.serialize();
  const fd = new FormData();
  fd.append('document', JSON.stringify(d));
  // A just-cropped image's blob may still be encoding.
  for (const im of d.images) fd.append('image', await doc.images.get(im.id).blob, `${im.id}.${im.ext}`);
  const res = await fetch('/api/pack', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}

export async function saveFile(doc, { as = false } = {}) {
  requireFileSystemAccess();
  let handle = doc.handle;
  if (as || !handle) {
    handle = await window.showSaveFilePicker({ types: MMSC_TYPES, suggestedName: doc.name + '.mmsc' });
  } else if (!(await ensurePermission(handle, 'readwrite'))) {
    throw new Error('Permission to write the file was not granted');
  }
  const blob = await packDocument(doc);
  await writeHandle(handle, blob);
  doc.name = stripExt(handle.name);
  doc.handle = handle;
  doc.markClean();
  await addRecent(handle);
}

export async function exportPng(doc, sprites, suggestedName) {
  requireFileSystemAccess();
  const rendered = renderSprites(doc, sprites);
  if (!rendered) throw new Error('Nothing to export');
  const blob = await toPngBlob(rendered.canvas);
  const handle = await window.showSaveFilePicker({ types: PNG_TYPES, suggestedName });
  await writeHandle(handle, blob);
}

// ---- recent files (IndexedDB holds the file handles) ----

const DB_NAME = 'mosaic', STORE = 'recent', KEY = 'list';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listRecent() {
  try {
    const db = await openDb();
    const list = await request(db.transaction(STORE).objectStore(STORE).get(KEY));
    return list || [];
  } catch {
    return [];
  }
}

export async function addRecent(handle) {
  try {
    const existing = await listRecent();
    const kept = [];
    for (const r of existing) {
      if (!(await handle.isSameEntry(r.handle).catch(() => false))) kept.push(r);
    }
    const list = [{ name: handle.name, handle, time: Date.now() }, ...kept].slice(0, RECENT_LIMIT);
    const db = await openDb();
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(list, KEY));
  } catch (err) {
    console.warn('recent files:', err);
  }
}
