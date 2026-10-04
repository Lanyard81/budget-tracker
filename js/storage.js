// Storage behind a small interface: get() / set(data) / export(). `backend` is anything with getItem/setItem
// (localStorage by default), so a cloud-sync backend could be swapped in later.
import { STORAGE_KEY, SCHEMA_VERSION } from './constants.js';
import { normaliseItem, normalisePriceChange, normaliseSettings, seedItems } from './model.js';

// Migration hook: bring any older saved shape up to SCHEMA_VERSION. Throws if the data is unusable.
export function migrate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Saved data is not an object');
  const v = Number(data.schema) || 0;
  // v0/v1 -> v2: items gained category/type/share/active/dates/notes/link, plus priceChanges and richer settings.
  // normaliseItem()/normaliseSettings() fill those defaults, so no per-field transform is needed.
  // if (v < 3) { ...future steps here... }
  if (v > SCHEMA_VERSION) console.warn('Data was saved by a newer version of the app');
  return {
    schema: SCHEMA_VERSION,
    items: (Array.isArray(data.items) ? data.items : []).map(normaliseItem).filter((r) => r.item).map((r) => r.item),
    priceChanges: (Array.isArray(data.priceChanges) ? data.priceChanges : []).map(normalisePriceChange).filter(Boolean),
    settings: normaliseSettings(data.settings),
  };
}

export function emptyData() {
  return { schema: SCHEMA_VERSION, items: [], priceChanges: [], settings: normaliseSettings({}) };
}

export function createStorage(backend, key = STORAGE_KEY) {
  return {
    // status: 'ok' | 'missing' (first run: seeded) | 'corrupt' (unreadable: reset, raw copy kept) | 'unavailable'
    get() {
      let raw = null;
      try { raw = backend.getItem(key); } catch (e) { return { data: { ...emptyData(), items: seedItems() }, status: 'unavailable' }; }
      if (raw === null || raw === undefined) return { data: { ...emptyData(), items: seedItems() }, status: 'missing' };
      try { return { data: migrate(JSON.parse(raw)), status: 'ok' }; } catch (e) {
        try { backend.setItem(key + ':corrupt', raw); } catch (_) { /* ignore */ }
        return { data: emptyData(), status: 'corrupt' };
      }
    },
    set(data) {
      try {
        backend.setItem(key, JSON.stringify({ schema: SCHEMA_VERSION, items: data.items, priceChanges: data.priceChanges, settings: data.settings }));
        return true;
      } catch (e) { return false; }
    },
    export(data) { return JSON.stringify({ schema: SCHEMA_VERSION, items: data.items, priceChanges: data.priceChanges, settings: data.settings }, null, 2); },
  };
}
