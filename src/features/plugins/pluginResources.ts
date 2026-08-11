import type { PluginListEntry, PluginMenu, PluginStoreEntry } from '@/types';
import { normalizeApiBase } from '@/utils/connection';

export const PLUGIN_RESOURCES_REFRESH_EVENT = 'plugin-resources-refresh';

export const notifyPluginResourcesChanged = () => {
  window.dispatchEvent(new Event(PLUGIN_RESOURCES_REFRESH_EVENT));
};

export interface PluginResourceEntry {
  pluginID: string;
  pluginTitle: string;
  pluginLogo: string;
  menuIndex: number;
  menu: PluginMenu;
  kind: PluginResourceKind;
  label: string;
  description: string;
  route: string;
}

export type PluginResourceKind =
  'resource' | 'agentIdentityManagement' | 'quotaSchedulerManagement';

export const AGENT_IDENTITY_PLUGIN_ID = 'codex-agent-identity';
export const QUOTA_SCHEDULER_PLUGIN_ID = 'codex-quota-scheduler';

interface ManagedPluginResourceDefinition {
  kind: Exclude<PluginResourceKind, 'resource'>;
  title: string;
  description: string;
}

const MANAGED_PLUGIN_RESOURCES: Record<string, ManagedPluginResourceDefinition> = {
  [AGENT_IDENTITY_PLUGIN_ID]: {
    kind: 'agentIdentityManagement',
    title: 'Codex Agent Identity',
    description: 'Identity management and credential import',
  },
  [QUOTA_SCHEDULER_PLUGIN_ID]: {
    kind: 'quotaSchedulerManagement',
    title: 'Codex Quota Scheduler',
    description: 'Quota scheduling and warmup status',
  },
};

export const getPluginTitle = (plugin: PluginListEntry) =>
  plugin.metadata?.name.trim() || plugin.id;

export const buildPluginResourceRoute = (pluginID: string, menuIndex: number) =>
  `/plugin-pages/${encodeURIComponent(pluginID)}/${menuIndex}`;

export const resolvePluginAssetURL = (value: string, apiBase: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  if (!trimmed.startsWith('/')) return trimmed;
  const base = normalizeApiBase(apiBase);
  return base ? `${base}${trimmed}` : trimmed;
};

// Registry entries usually carry an "owner/repo" slug rather than a full URL.
export const buildRepositoryURL = (repository: string) => {
  const trimmed = repository.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://github.com/${trimmed.replace(/^\/+/, '')}`;
};

// The exact, fully-qualified prefix every first-party repository lives under.
// Matching the whole URL (not just the extracted owner) prevents look-alike
// hosts like "https://github.com.evil.com/router-for-me/..." from being
// mistaken for the official org.
export const OFFICIAL_PLUGIN_REPO_PREFIX = 'https://github.com/router-for-me/';
export const DEFAULT_PLUGIN_STORE_SOURCE_ID = 'official';
const DEFAULT_PLUGIN_STORE_SOURCE_NAME = 'official';

// Normalize an "owner/repo" slug or repository URL to a bare "owner/repo".
export const getPluginRepositorySlug = (repository: string): string => {
  const trimmed = repository.trim();
  if (!trimmed) return '';
  const withoutHost = /^https?:\/\/[^/]+\/(.+)$/i.exec(trimmed)?.[1] ?? trimmed;
  const [owner = '', repo = ''] = withoutHost.replace(/^\/+/, '').split('/');
  if (!owner) return '';
  return repo ? `${owner}/${repo.replace(/\.git$/i, '')}` : owner;
};

// A repository is official only when its canonical github.com URL sits exactly
// under the router-for-me org prefix. Slugs ("router-for-me/repo") and full URLs
// are both normalized first; anything else (other hosts, look-alike domains,
// other owners) is untrusted.
export const isOfficialRepository = (repository: string): boolean =>
  buildRepositoryURL(repository).toLowerCase().startsWith(OFFICIAL_PLUGIN_REPO_PREFIX);

// Both the backend-assigned source identity and repository must be official.
// A third-party registry can copy repository metadata, so repository alone is
// insufficient to bypass the third-party installation gate.
export const isOfficialPlugin = (entry: PluginStoreEntry): boolean =>
  entry.sourceId.trim().toLowerCase() === DEFAULT_PLUGIN_STORE_SOURCE_ID &&
  isOfficialRepository(entry.repository);

export const isDefaultPluginStoreSource = (
  entry: Pick<PluginStoreEntry, 'sourceId' | 'sourceName'>
): boolean =>
  entry.sourceId.trim().toLowerCase() === DEFAULT_PLUGIN_STORE_SOURCE_ID ||
  entry.sourceName.trim().toLowerCase() === DEFAULT_PLUGIN_STORE_SOURCE_NAME;

// The string a user must retype to confirm a risky install: the repo slug when
// available (most faithful to the source), otherwise the plugin id.
export const getPluginConfirmToken = (entry: PluginStoreEntry): string =>
  getPluginRepositorySlug(entry.repository) || entry.id;

export const collectPluginResourceEntries = (plugins: PluginListEntry[]): PluginResourceEntry[] =>
  plugins.flatMap((plugin) => {
    if (!plugin.effectiveEnabled) return [];

    const pluginTitle = getPluginTitle(plugin);
    const pluginLogo = plugin.logo || plugin.metadata?.logo || '';

    // Dynamic and privileged plugin UIs must stay under authenticated Management
    // routes. These two integrations intentionally expose no /v0/resource menu,
    // so the WebUI supplies a local route only when the plugin declares no menu
    // at all. A future real static menu always wins and avoids a duplicate entry.
    if (plugin.menus.length === 0) {
      const managed = MANAGED_PLUGIN_RESOURCES[plugin.id];
      if (!managed) return [];

      return [
        {
          pluginID: plugin.id,
          pluginTitle: pluginTitle || managed.title,
          pluginLogo,
          menuIndex: 0,
          menu: { path: '', menu: managed.title, description: managed.description },
          kind: managed.kind,
          label: managed.title,
          description: managed.description,
          route: buildPluginResourceRoute(plugin.id, 0),
        },
      ];
    }

    return plugin.menus
      .map((menu, menuIndex): PluginResourceEntry | null => {
        const path = menu.path.trim();
        if (!path) return null;

        const menuLabel = menu.menu.trim();
        return {
          pluginID: plugin.id,
          pluginTitle,
          pluginLogo,
          menuIndex,
          menu: { ...menu, path },
          kind: 'resource',
          label: menuLabel || pluginTitle,
          description: menu.description.trim() || pluginTitle,
          route: buildPluginResourceRoute(plugin.id, menuIndex),
        };
      })
      .filter((entry): entry is PluginResourceEntry => Boolean(entry));
  });
