/**
 * 额度页纯逻辑：文件归类、tab 过滤、计数、分页。
 * React-free —— 由 tests/quotaPageLogic.test.ts 直接消费。
 */

import type { AuthFileItem, OpenAIProviderConfig } from '@/types';
import { ANTIGRAVITY_CONFIG } from './providers/antigravity/data';
import { CLAUDE_CONFIG } from './providers/claude/data';
import { CODEX_CONFIG } from './providers/codex/data';
import { GLM_CONFIG } from './providers/glm/data';
import { KIMI_CONFIG } from './providers/kimi/data';
import { XAI_CONFIG } from './providers/xai/data';
import type { QuotaProviderType } from './providers/types';
import { QUOTA_TAB_ORDER, type QuotaSortMode, type QuotaTabId } from './constants';

const QUOTA_FILTER_MAP: Record<QuotaProviderType, (file: AuthFileItem) => boolean> = {
  antigravity: ANTIGRAVITY_CONFIG.filterFn,
  claude: CLAUDE_CONFIG.filterFn,
  codex: CODEX_CONFIG.filterFn,
  glm: GLM_CONFIG.filterFn,
  kimi: KIMI_CONFIG.filterFn,
  xai: XAI_CONFIG.filterFn,
};

export interface QuotaFileEntry {
  file: AuthFileItem;
  type: QuotaProviderType;
}

const normalizeProviderIdentity = (value: string | undefined): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');

const normalizeQuotaAuthIndex = (value: unknown): string => String(value ?? '').trim();

export function isGlmOpenAICompatibleProvider(provider: OpenAIProviderConfig): boolean {
  const name = normalizeProviderIdentity(provider.name);
  if (['glm', 'zai', 'z-ai', 'zhipu', 'bigmodel'].includes(name)) return true;

  try {
    const hostname = new URL(provider.baseUrl).hostname.toLowerCase();
    return hostname === 'api.z.ai' || hostname === 'open.bigmodel.cn';
  } catch {
    return false;
  }
}

/**
 * Config-based OpenAI-compatible credentials do not necessarily appear in
 * `/auth-files`. Build quota-only items from `/config` without retaining API keys.
 */
export function mergeGlmConfigQuotaFiles(
  authFiles: AuthFileItem[],
  providers: OpenAIProviderConfig[] = []
): AuthFileItem[] {
  const merged = [...authFiles];
  const seenAuthIndexes = new Set(
    authFiles
      .map((file) => normalizeQuotaAuthIndex(file.authIndex ?? file['auth_index']))
      .filter(Boolean)
  );
  const usedNames = new Set(authFiles.map((file) => file.name));

  providers.forEach((provider, providerIndex) => {
    if (!isGlmOpenAICompatibleProvider(provider)) return;

    const credentials =
      provider.apiKeyEntries.length > 0
        ? provider.apiKeyEntries.map((entry) => entry.authIndex)
        : [provider.authIndex];

    credentials.forEach((rawAuthIndex, keyIndex) => {
      const authIndex = normalizeQuotaAuthIndex(rawAuthIndex);
      if (!authIndex || seenAuthIndexes.has(authIndex)) return;

      const providerName = provider.name.trim() || 'GLM';
      const baseName = `${providerName} #${keyIndex + 1}`;
      let name = baseName;
      if (usedNames.has(name)) {
        name = `${baseName} (${(provider.sourceIndex ?? providerIndex) + 1})`;
      }

      usedNames.add(name);
      seenAuthIndexes.add(authIndex);
      merged.push({
        name,
        provider: 'openai-compatible-glm',
        type: 'openai-compatible-glm',
        authIndex,
        runtimeOnly: true,
        disabled: provider.disabled,
      });
    });
  });

  return merged;
}

export const resolveQuotaProviderType = (file: AuthFileItem): QuotaProviderType | null =>
  QUOTA_TAB_ORDER.find((type) => QUOTA_FILTER_MAP[type](file)) ?? null;

/**
 * 把文件列表归类为额度条目：不支持额度或已停用的文件被过滤，
 * 结果按 QUOTA_TAB_ORDER 分组排列（'全部' tab 的卡片顺序即由此决定）。
 */
export function classifyQuotaFiles(files: AuthFileItem[]): QuotaFileEntry[] {
  const groups = new Map<QuotaProviderType, QuotaFileEntry[]>(
    QUOTA_TAB_ORDER.map((type) => [type, []])
  );
  for (const file of files) {
    const type = resolveQuotaProviderType(file);
    if (!type) continue;
    groups.get(type)?.push({ file, type });
  }
  return QUOTA_TAB_ORDER.flatMap((type) => groups.get(type) ?? []);
}

export function filterEntriesByTab(entries: QuotaFileEntry[], tab: QuotaTabId): QuotaFileEntry[] {
  if (tab === 'all') return entries;
  return entries.filter((entry) => entry.type === tab);
}

/**
 * Order the grid by whichever credential recovers first.
 *
 * The instant is injected rather than read here: quota lives in the store and
 * arrives asynchronously, and keeping this function store-free is what makes
 * the ordering rules directly testable.
 *
 * Credentials with no instant — not loaded yet, failed, or reporting no
 * upcoming reset — sink to the bottom rather than sorting as "now". They keep
 * their incoming provider-grouped order, so the unloaded tail still reads like
 * the default view instead of an arbitrary shuffle. Because loading is
 * click-to-fetch, that tail is most of the list until the user asks for data.
 *
 * The original index is the final tiebreak, making stability an asserted
 * property rather than an assumption about the engine's sort.
 */
export function sortQuotaEntries(
  entries: QuotaFileEntry[],
  mode: QuotaSortMode,
  resolveNextRecoveryMs: (entry: QuotaFileEntry) => number | null
): QuotaFileEntry[] {
  if (mode !== 'soonest') return [...entries];

  // Decorate once — resolving pokes at provider-shaped state per entry.
  return entries
    .map((entry, index) => ({ entry, index, atMs: resolveNextRecoveryMs(entry) }))
    .sort((a, b) => {
      if (a.atMs === null && b.atMs === null) return a.index - b.index;
      if (a.atMs === null) return 1;
      if (b.atMs === null) return -1;
      return a.atMs - b.atMs || a.index - b.index;
    })
    .map((decorated) => decorated.entry);
}

export function buildTabCounts(entries: QuotaFileEntry[]): Record<string, number> {
  const counts: Record<string, number> = { all: entries.length };
  for (const type of QUOTA_TAB_ORDER) {
    counts[type] = 0;
  }
  for (const entry of entries) {
    counts[entry.type] += 1;
  }
  return counts;
}

export const isQuotaRefreshDisabled = (
  canRefresh: boolean,
  loading: boolean,
  resetting: boolean
): boolean => !canRefresh || loading || resetting;

export interface QuotaPagination<T> {
  pageItems: T[];
  currentPage: number;
  totalPages: number;
}

/** 页码越界时收敛到有效区间（列表缩短后停留在最后一页而不是空页）。 */
export function paginate<T>(items: T[], page: number, pageSize: number): QuotaPagination<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    pageItems: items.slice(start, start + pageSize),
    currentPage,
    totalPages,
  };
}
