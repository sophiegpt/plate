// Photos: shrink a camera image for Claude, and keep a small thumbnail per entry in
// IndexedDB (localStorage is too small for images). Full photos are never stored.

const DB_NAME = 'plate';
const STORE = 'thumbs';
let dbPromise = null;
const urlCache = new Map();

export async function prepareImage(file, maxEdge = 1600, quality = 0.85) {
  if (!file) throw new Error('No photo was chosen.');
  const src = URL.createObjectURL(file);
  try {
    // The load event, not img.decode(): decode() can stall in background pages and has
    // been unreliable in Safari with large camera photos.
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      const timer = setTimeout(() => reject(new Error('That photo took too long to open. Try again.')), 20000);
      im.onload = () => { clearTimeout(timer); resolve(im); };
      im.onerror = () => { clearTimeout(timer); reject(new Error('Couldn\'t read that photo. Try another one, or a screenshot.')); };
      im.src = src;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error('Couldn\'t read that photo.');
    const big = await draw(img, w, h, maxEdge, quality);
    const thumb = await draw(img, w, h, 320, 0.72);
    return { base64: await toBase64(big), mediaType: 'image/jpeg', thumb, url: URL.createObjectURL(thumb) };
  } finally {
    URL.revokeObjectURL(src);
  }
}

function draw(img, w, h, maxEdge, quality) {
  const k = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Couldn\'t process that photo.'))), 'image/jpeg', quality));
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// ---------- thumbnails ----------

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  if (!d) return null;
  return new Promise(resolve => {
    try {
      const t = d.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out?.result ?? null);
      t.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export const putThumb = (id, blob) => (id && blob ? tx('readwrite', s => s.put(blob, id)) : null);

export function deleteThumb(id) {
  if (!id) return null;
  const u = urlCache.get(id);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(id); }
  return tx('readwrite', s => s.delete(id));
}

export async function thumbURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await tx('readonly', s => s.get(id));
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urlCache.set(id, u);
  return u;
}

export const clearThumbs = () => tx('readwrite', s => s.clear());

// Delete thumbnails no entry points to any more (run at start-up, so Undo always works).
export async function pruneThumbs(keep) {
  const keys = await tx('readonly', s => s.getAllKeys());
  for (const k of keys || []) if (!keep.has(k)) deleteThumb(k);
}

// Fill every <img data-thumb="id"> inside root; drop the ones with no stored photo.
export function hydrateThumbs(root = document) {
  for (const img of root.querySelectorAll('img[data-thumb]')) {
    thumbURL(img.dataset.thumb).then(u => {
      if (u) img.src = u;
      else img.replaceWith(Object.assign(document.createElement('span'), { className: img.className.replace('thumb', 'thumb ph') }));
    });
  }
}
