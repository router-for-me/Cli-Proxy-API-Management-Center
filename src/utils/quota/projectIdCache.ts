/**
 * Antigravity Project ID 内存缓存
 * 仅在页面生命周期内有效,刷新后需重新获取
 */

interface ProjectIdCacheEntry {
  projectId: string;
  timestamp: number;
  authIndex: string;
}

const cache = new Map<string, ProjectIdCacheEntry>();
const CACHE_KEY_PREFIX = 'antigravity_project_id';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24小时

function buildCacheKey(authIndex: string): string {
  return `${CACHE_KEY_PREFIX}_${authIndex}`;
}

/**
 * 从缓存获取 project_id
 */
export function getProjectId(authIndex: string): string | null {
  const key = buildCacheKey(authIndex);
  const entry = cache.get(key);

  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_DURATION) {
    cache.delete(key);
    return null;
  }

  return entry.projectId;
}

/**
 * 缓存 project_id
 */
export function setProjectId(authIndex: string, projectId: string): void {
  const key = buildCacheKey(authIndex);
  cache.set(key, {
    projectId,
    timestamp: Date.now(),
    authIndex
  });
}

/**
 * 清除指定账户的缓存
 */
export function clearProjectId(authIndex: string): void {
  cache.delete(buildCacheKey(authIndex));
}

/**
 * 清空所有缓存
 */
export function clearAllProjectIds(): void {
  cache.clear();
}
