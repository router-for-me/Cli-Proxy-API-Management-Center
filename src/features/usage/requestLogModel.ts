/** Pure helpers for the request log table. */
import type { ApiKeyRequestEntry } from '@/services/api/apiKeyPolicyUsage';

/** Output tokens per second after the first token; 0 when it cannot be derived. */
export function tokensPerSecond(entry: ApiKeyRequestEntry): number {
  const seconds = (entry.latencyMs - entry.ttftMs) / 1000;
  return entry.outputTokens > 0 && seconds > 0 ? entry.outputTokens / seconds : 0;
}

export function filterRequests(
  entries: ApiKeyRequestEntry[],
  filter: { key: string; model: string; account: string; status: string; search: string }
): ApiKeyRequestEntry[] {
  const needle = filter.search.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter.key && entry.key !== filter.key) return false;
    if (filter.model && entry.model !== filter.model) return false;
    if (filter.account && entry.authId !== filter.account) return false;
    if (filter.status === 'ok' && entry.failed) return false;
    if (filter.status === 'error' && !entry.failed) return false;
    if (!needle) return true;
    return [entry.requestId, entry.accountName, entry.keyName, entry.model, entry.effort]
      .concat(entry.statusCode ? String(entry.statusCode) : [])
      .some((value) => value.toLowerCase().includes(needle));
  });
}
