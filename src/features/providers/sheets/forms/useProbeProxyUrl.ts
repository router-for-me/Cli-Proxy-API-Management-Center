import { useConfigStore } from '@/stores/useConfigStore';

/** api-call resolves an omitted proxy through authIndex before trying the global proxy.
 * An empty effective form proxy means global (or direct), not the saved credential proxy.
 * Keep the index for $TOKEN$ while explicitly selecting that fallback transport.
 */
export function useProbeProxyUrl(proxyUrl?: string, authIndex?: string) {
  const globalProxy = useConfigStore(
    (state) => state.config && (state.config.proxyUrl?.trim() || 'direct')
  );
  if (proxyUrl !== undefined && !proxyUrl.trim() && authIndex?.trim()) {
    return globalProxy ?? undefined;
  }
  return proxyUrl;
}
