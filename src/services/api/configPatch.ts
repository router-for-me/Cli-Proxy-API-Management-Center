import { parseDocument } from 'yaml';
import { apiClient } from './client';

export interface ConfigPatchPlan {
  patch: Record<string, unknown>;
  deletions: string[][];
  /** Explicit empty maps require PUT at that map, since DELETE prunes empty ancestors. */
  emptyMaps?: string[][];
}

const isMap = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// Null-prototype records preserve literal keys such as __proto__ and constructor.
const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const record = (): Record<string, unknown> => Object.create(null);

function parseConfig(source: string): Record<string, unknown> {
  const doc = parseDocument(source, { intAsBigInt: true });
  if (doc.errors.length || doc.warnings.length) {
    throw new Error(`Invalid configuration YAML: ${[...doc.errors, ...doc.warnings][0].message}`);
  }
  const active = new Set<object>();
  function convert(value: unknown): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new Error('Configuration integer is not JSON-safe');
      return number;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || value === null || active.has(value)) {
      throw new Error('Configuration must contain only JSON-representable values');
    }
    active.add(value);
    try {
      if (Array.isArray(value)) return value.map(convert);
      if (value instanceof Map) {
        const result = record();
        for (const [key, child] of value) {
          if (typeof key !== 'string') throw new Error('Configuration map keys must be strings');
          result[key] = convert(child);
        }
        return result;
      }
      throw new Error('Configuration must contain only JSON-representable values');
    } finally {
      active.delete(value);
    }
  }
  const result = convert(doc.toJS({ mapAsMap: true, maxAliasCount: 100 }));
  if (!isMap(result)) throw new Error('Configuration root must be a map');
  return result;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  }
  if (isMap(a) && isMap(b)) {
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((key) => hasOwn(b, key) && equal(a[key], b[key]))
    );
  }
  return false;
}

function fieldUrl(path: string[]): string {
  // Gin splits decoded paths on '/'; encoding a slash cannot make it a literal key.
  // Dot segments are normalized by URL clients before the request reaches the server.
  if (
    !path.length ||
    path.some(
      (key) =>
        !key ||
        key === '.' ||
        key === '..' ||
        key.includes('/') ||
        key.includes('\\') ||
        Array.from(key).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
  ) {
    throw new Error('Configuration field path cannot be safely represented');
  }
  return `/config/${path.map((key) => encodeURIComponent(key)).join('/')}`;
}

export function buildConfigPatch(beforeYaml: string, afterYaml: string): ConfigPatchPlan {
  const before = parseConfig(beforeYaml);
  const after = parseConfig(afterYaml);
  const deletions: string[][] = [];
  const emptyMaps: string[][] = [];
  function remove(value: unknown, path: string[]): void {
    if (isMap(value) && Object.keys(value).length) {
      for (const key of Object.keys(value)) remove(value[key], [...path, key]);
    } else {
      fieldUrl(path);
      deletions.push(path);
    }
  }
  function diff(old: Record<string, unknown>, next: Record<string, unknown>, path: string[]) {
    const patch = record();
    for (const key of Object.keys(old)) {
      if (!hasOwn(next, key)) remove(old[key], [...path, key]);
    }
    for (const key of Object.keys(next)) {
      if (hasOwn(old, key) && equal(old[key], next[key])) continue;
      if (hasOwn(old, key) && isMap(old[key]) && isMap(next[key])) {
        if (Object.keys(next[key]).length === 0) {
          // This is an intentional reset of the entire map, not deletion of the map.
          const target = [...path, key];
          fieldUrl(target);
          emptyMaps.push(target);
          continue;
        }
        const child = diff(old[key], next[key], [...path, key]);
        if (Object.keys(child).length) patch[key] = child;
      } else {
        patch[key] = next[key];
      }
    }
    return patch;
  }
  const patch = diff(before, after, []);
  return { patch, deletions, ...(emptyMaps.length ? { emptyMaps } : {}) };
}

export function hasConfigPatchChanges(plan: ConfigPatchPlan): boolean {
  return (
    Object.keys(plan.patch).length > 0 ||
    plan.deletions.length > 0 ||
    Boolean(plan.emptyMaps?.length)
  );
}

export async function applyConfigPatch(
  plan: ConfigPatchPlan,
  connectionRevision: number
): Promise<void> {
  const checkConnection = () => {
    if (apiClient.getConnectionRevision() !== connectionRevision) {
      throw new Error('Connection changed while saving configuration');
    }
  };
  // Validate every path before performing any mutations, including for caller-built plans.
  const urls = plan.deletions.map(fieldUrl);
  const emptyMapUrls = (plan.emptyMaps ?? []).map(fieldUrl);
  checkConnection();
  if (Object.keys(plan.patch).length) {
    try {
      await apiClient.patch('/config', plan.patch);
    } finally {
      checkConnection();
    }
  }
  for (const url of emptyMapUrls) {
    checkConnection();
    try {
      await apiClient.put(url, {});
    } finally {
      checkConnection();
    }
  }
  for (const url of urls) {
    checkConnection();
    try {
      await apiClient.delete(url);
    } catch (error: unknown) {
      if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 404) {
        throw error;
      }
    } finally {
      checkConnection();
    }
  }
}
