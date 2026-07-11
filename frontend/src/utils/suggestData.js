import { listTags, listPrompts } from '../api';

// Shared, cached loader for the combined tag + prompt suggestion list. Each
// entry is { text, types } where types is a subset of ['tag', 'prompt'].
let cache = null;
let promise = null;

export function loadMixedItems() {
  if (cache) return Promise.resolve(cache);
  if (promise) return promise;
  promise = Promise.all([listTags(), listPrompts()])
    .then(([tags, prompts]) => {
      const map = new Map();
      for (const tag of tags) map.set(tag, { types: ['tag'] });
      for (const p of prompts) {
        if (map.has(p)) map.get(p).types.push('prompt');
        else map.set(p, { types: ['prompt'] });
      }
      cache = [...map.entries()].map(([text, meta]) => ({ text, types: meta.types }));
      return cache;
    })
    .catch(() => {
      cache = [];
      return cache;
    })
    .finally(() => { promise = null; });
  return promise;
}
