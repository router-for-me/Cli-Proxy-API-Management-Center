import { useEffect, useState } from 'react';
import type { PluginListEntry } from '@/types';
import { pluginsApi } from '@/services/api';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores';
import { PLUGIN_RESOURCES_REFRESH_EVENT } from '@/features/plugins/pluginResources';
import { getQuotaPluginLogo } from '../providers/plugin/identity';
import type { QuotaFileEntry } from '../logic';

export function useQuotaPluginLogos(entries: QuotaFileEntry[]) {
  const apiBase = useAuthStore((state) => state.apiBase);
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);
  const revision = apiClient.getConnectionRevision();
  const [metadata, setMetadata] = useState<{
    revision: number;
    plugins: PluginListEntry[];
  } | null>(null);

  useEffect(() => {
    if (!connected || !supportsPlugin || !entries.some((entry) => entry.type === 'plugin')) {
      return;
    }
    let cancelled = false;
    let requestId = 0;
    const load = async () => {
      const currentRequest = ++requestId;
      const isCurrent = () =>
        !cancelled &&
        currentRequest === requestId &&
        revision === apiClient.getConnectionRevision();
      try {
        const response = await pluginsApi.list();
        if (isCurrent()) setMetadata({ revision, plugins: response.plugins });
      } catch {
        if (isCurrent()) setMetadata(null);
      }
    };
    void load();
    window.addEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, load);
    };
  }, [apiBase, connected, entries, revision, supportsPlugin]);

  return (entry: QuotaFileEntry) =>
    entry.type === 'plugin' && connected && supportsPlugin && metadata?.revision === revision
      ? getQuotaPluginLogo(entry.file, metadata.plugins, apiBase)
      : '';
}
