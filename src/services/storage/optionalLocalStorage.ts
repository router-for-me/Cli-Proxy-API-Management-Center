// Browser policy can deny either the localStorage getter or an individual operation.
function withLocalStorage<T>(operation: (storage: Storage) => T, unavailable: T): T {
  try {
    const storage = globalThis.localStorage;
    return storage ? operation(storage) : unavailable;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') return unavailable;
    throw error;
  }
}

export const optionalLocalStorage = {
  getItem: (key: string) => withLocalStorage((storage) => storage.getItem(key), null),
  setItem: (key: string, value: string) =>
    withLocalStorage((storage) => storage.setItem(key, value), undefined),
  removeItem: (key: string) => withLocalStorage((storage) => storage.removeItem(key), undefined),
};
