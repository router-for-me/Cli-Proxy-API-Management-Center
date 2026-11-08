/** Each lab window has its own volatile storage, even when served on the app's origin. */
export class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(String(key)) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(String(key));
  }
  setItem(key: string, value: string) {
    this.values.set(String(key), String(value));
  }
}
export function isolateStorage(target: Window) {
  Object.defineProperty(target, 'localStorage', { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(target, 'sessionStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
}
