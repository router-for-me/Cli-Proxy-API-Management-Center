import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';
import {
  isManagementOAuthProviderKey,
  normalizeManagementOAuthProviderKey,
} from '@/utils/providerKeys';
import type {
  PluginConfigField,
  PluginConfigObject,
  PluginDeleteResult,
  PluginListEntry,
  PluginListResponse,
  PluginMetadata,
  PluginMenu,
  PluginStoreEntry,
  PluginStoreInstallResult,
  PluginStoreResponse,
  PluginStoreSource,
} from '@/types';

const asString = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return String(value);
};

const asBoolean = (value: unknown): boolean => value === true;

const normalizePluginOAuthProvider = (value: unknown): string | undefined => {
  const provider = normalizeManagementOAuthProviderKey(asString(value));
  return isManagementOAuthProviderKey(provider) ? provider : undefined;
};

const hasOwn = (source: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(source, key);

const normalizeConfigField = (value: unknown): PluginConfigField | null => {
  if (!isRecord(value)) return null;
  const name = asString(value.name).trim();
  if (!name) return null;
  const enumValues = Array.isArray(value.enum_values)
    ? value.enum_values.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    name,
    type: asString(value.type).trim() || 'string',
    enumValues,
    description: asString(value.description).trim(),
  };
};

const normalizeConfigFields = (value: unknown): PluginConfigField[] =>
  Array.isArray(value)
    ? (value.map((item) => normalizeConfigField(item)).filter(Boolean) as PluginConfigField[])
    : [];

const normalizeMetadata = (value: unknown): PluginMetadata | null => {
  if (!isRecord(value)) return null;
  const name = asString(value.name).trim();
  const version = asString(value.version).trim();
  const author = asString(value.author).trim();
  const githubRepository = asString(value.github_repository).trim();
  const logo = asString(value.logo).trim();
  const configFields = normalizeConfigFields(value.config_fields);

  if (!name && !version && !author && !githubRepository && !logo && configFields.length === 0) {
    return null;
  }

  return {
    name,
    version,
    author,
    githubRepository,
    logo,
    configFields,
  };
};

const normalizeMenu = (value: unknown): PluginMenu | null => {
  if (!isRecord(value)) return null;
  const path = asString(value.path).trim();
  const menu = asString(value.menu).trim();
  if (!path && !menu) return null;
  return {
    path,
    menu,
    description: asString(value.description).trim(),
  };
};

const normalizeMenus = (value: unknown): PluginMenu[] =>
  Array.isArray(value)
    ? (value.map((item) => normalizeMenu(item)).filter(Boolean) as PluginMenu[])
    : [];

const normalizePluginEntry = (value: unknown): PluginListEntry | null => {
  if (!isRecord(value)) return null;
  const id = asString(value.id).trim();
  if (!id) return null;

  const metadata = normalizeMetadata(value.metadata);
  const configFields = normalizeConfigFields(value.config_fields);
  const supportsOAuth = asBoolean(value.supports_oauth);
  const oauthProvider = normalizePluginOAuthProvider(value.oauth_provider);
  const legacyOAuthProvider =
    supportsOAuth && !hasOwn(value, 'oauth_provider')
      ? normalizePluginOAuthProvider(id)
      : undefined;

  return {
    id,
    path: asString(value.path).trim(),
    configured: asBoolean(value.configured),
    registered: asBoolean(value.registered),
    enabled: value.enabled !== false,
    effectiveEnabled: asBoolean(value.effective_enabled),
    supportsOAuth,
    oauthProvider: oauthProvider ?? legacyOAuthProvider,
    logo: asString(value.logo || metadata?.logo).trim(),
    configFields: configFields.length > 0 ? configFields : (metadata?.configFields ?? []),
    menus: normalizeMenus(value.menus),
    metadata,
  };
};

const normalizePluginList = (value: unknown): PluginListResponse => {
  const source = isRecord(value) ? value : {};
  const plugins = Array.isArray(source.plugins)
    ? (source.plugins
        .map((item) => normalizePluginEntry(item))
        .filter(Boolean) as PluginListEntry[])
    : [];

  return {
    pluginsEnabled: asBoolean(source.plugins_enabled),
    pluginsDir: asString(source.plugins_dir).trim() || 'plugins',
    plugins,
  };
};

const normalizePluginConfig = (value: unknown): PluginConfigObject =>
  isRecord(value) ? { ...value } : {};

const normalizeDeleteResult = (value: unknown): PluginDeleteResult => {
  const source = isRecord(value) ? value : {};
  return {
    status: asString(source.status).trim(),
    id: asString(source.id).trim(),
    path: asString(source.path).trim(),
    fileDeleted: asBoolean(source.file_deleted),
    configuredRemoved: asBoolean(source.configured_removed),
    restartRequired: asBoolean(source.restart_required),
  };
};

const normalizeStoreEntry = (value: unknown): PluginStoreEntry | null => {
  if (!isRecord(value)) return null;
  const id = asString(value.id).trim();
  if (!id) return null;
  const sourceId = asString(value.source_id).trim();
  const storeId = asString(value.store_id).trim() || (sourceId ? `${sourceId}/${id}` : id);

  const tags = Array.isArray(value.tags)
    ? value.tags.map((item) => asString(item).trim()).filter(Boolean)
    : [];

  return {
    storeId,
    sourceId,
    sourceName: asString(value.source_name).trim(),
    sourceUrl: asString(value.source_url).trim(),
    id,
    name: asString(value.name).trim(),
    description: asString(value.description).trim(),
    author: asString(value.author).trim(),
    version: asString(value.version).trim(),
    repository: asString(value.repository).trim(),
    logo: asString(value.logo).trim(),
    homepage: asString(value.homepage).trim(),
    license: asString(value.license).trim(),
    tags,
    installed: asBoolean(value.installed),
    installedVersion: asString(value.installed_version).trim(),
    path: asString(value.path).trim(),
    configured: asBoolean(value.configured),
    registered: asBoolean(value.registered),
    enabled: asBoolean(value.enabled),
    effectiveEnabled: asBoolean(value.effective_enabled),
    updateAvailable: asBoolean(value.update_available),
  };
};

const normalizeStoreSource = (value: unknown): PluginStoreSource | null => {
  if (!isRecord(value)) return null;
  const id = asString(value.id).trim();
  const url = asString(value.url).trim();
  if (!id && !url) return null;
  return {
    id,
    name: asString(value.name).trim(),
    url,
  };
};

const normalizeStoreList = (value: unknown): PluginStoreResponse => {
  const source = isRecord(value) ? value : {};
  const plugins = Array.isArray(source.plugins)
    ? (source.plugins
        .map((item) => normalizeStoreEntry(item))
        .filter(Boolean) as PluginStoreEntry[])
    : [];
  const sources = Array.isArray(source.sources)
    ? (source.sources
        .map((item) => normalizeStoreSource(item))
        .filter(Boolean) as PluginStoreSource[])
    : [];

  return {
    pluginsEnabled: asBoolean(source.plugins_enabled),
    pluginsDir: asString(source.plugins_dir).trim() || 'plugins',
    sources,
    plugins,
  };
};

const normalizeInstallResult = (value: unknown): PluginStoreInstallResult => {
  const source = isRecord(value) ? value : {};
  return {
    status: asString(source.status).trim(),
    sourceId: asString(source.source_id).trim(),
    sourceName: asString(source.source_name).trim(),
    sourceUrl: asString(source.source_url).trim(),
    id: asString(source.id).trim(),
    version: asString(source.version).trim(),
    path: asString(source.path).trim(),
    pluginsEnabled: asBoolean(source.plugins_enabled),
    restartRequired: asBoolean(source.restart_required),
  };
};

export const pluginsApi = {
  async list(): Promise<PluginListResponse> {
    const data = await apiClient.get('/plugins');
    return normalizePluginList(data);
  },

  updateEnabled: (id: string, enabled: boolean) =>
    apiClient.patch(`/plugins/${encodeURIComponent(id)}/enabled`, { enabled }),

  async deletePlugin(id: string): Promise<PluginDeleteResult> {
    const data = await apiClient.delete(`/plugins/${encodeURIComponent(id)}`);
    return normalizeDeleteResult(data);
  },

  async getConfig(id: string): Promise<PluginConfigObject> {
    const data = await apiClient.get(`/plugins/${encodeURIComponent(id)}/config`);
    return normalizePluginConfig(data);
  },

  putConfig: (id: string, config: PluginConfigObject) =>
    apiClient.put(`/plugins/${encodeURIComponent(id)}/config`, config),

  patchConfig: (id: string, patch: PluginConfigObject) =>
    apiClient.patch(`/plugins/${encodeURIComponent(id)}/config`, patch),
};

export const pluginStoreApi = {
  async list(): Promise<PluginStoreResponse> {
    const data = await apiClient.get('/plugin-store');
    return normalizeStoreList(data);
  },

  async install(id: string, sourceId?: string): Promise<PluginStoreInstallResult> {
    const path = `/plugin-store/${encodeURIComponent(id)}/install`;
    const query = sourceId ? `?${new URLSearchParams({ source: sourceId }).toString()}` : '';
    const data = await apiClient.post(`${path}${query}`);
    return normalizeInstallResult(data);
  },
};
