const records = new Map();
const listeners = new Set();
let revision = 0;

export function loadTagPromptSuggestions(key, loader) {
  const cached = records.get(key);
  if (cached?.revision === revision) {
    if (cached.value) return Promise.resolve(cached.value);
    if (cached.promise) return cached.promise;
  }

  const requestedRevision = revision;
  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      if (revision === requestedRevision) {
        records.set(key, { revision, value });
      }
      return value;
    })
    .catch((error) => {
      if (records.get(key)?.promise === promise) records.delete(key);
      throw error;
    });

  records.set(key, { revision, promise });
  return promise;
}

export function invalidateTagPromptSuggestions() {
  records.clear();
  revision += 1;
  listeners.forEach((listener) => listener());
}

export function subscribeToTagPromptSuggestions(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTagPromptSuggestionRevision() {
  return revision;
}
