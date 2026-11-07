import type { AuthFileItem, PluginListEntry } from '@/types';
import { getPluginLogo } from '@/features/plugins/pluginLogo';
import { resolvePluginAssetURL } from '@/features/plugins/pluginResources';
import { resolveQuotaPluginId } from './data';

export const getQuotaPluginLogo = (
  file: AuthFileItem,
  plugins: readonly PluginListEntry[],
  apiBase: string
): string => {
  const provider = String(
    file.quotaProvider ?? file['quota_provider'] ?? file.provider ?? file.type ?? ''
  );
  const pluginId = file.quotaPluginId ?? resolveQuotaPluginId(plugins, provider);
  const plugin = plugins.find((candidate) => candidate.id === pluginId);
  return plugin ? resolvePluginAssetURL(getPluginLogo(plugin, []), apiBase) : '';
};
