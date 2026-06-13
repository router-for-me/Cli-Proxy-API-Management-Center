export type PluginConfigFieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'enum'
  | 'array'
  | 'object';

export interface PluginConfigField {
  name: string;
  type: PluginConfigFieldType | string;
  enumValues: string[];
  description: string;
}

export type PluginConfigObject = Record<string, unknown>;

export interface PluginMetadata {
  name: string;
  version: string;
  author: string;
  githubRepository: string;
  logo: string;
  configFields: PluginConfigField[];
}

export interface PluginMenu {
  path: string;
  menu: string;
  description: string;
}

export interface PluginListEntry {
  id: string;
  path: string;
  configured: boolean;
  registered: boolean;
  enabled: boolean;
  effectiveEnabled: boolean;
  supportsOAuth: boolean;
  logo: string;
  configFields: PluginConfigField[];
  menus: PluginMenu[];
  metadata: PluginMetadata | null;
}

export interface PluginListResponse {
  pluginsEnabled: boolean;
  pluginsDir: string;
  plugins: PluginListEntry[];
}

export interface PluginDeleteResult {
  status: string;
  id: string;
  path: string;
  fileDeleted: boolean;
  configuredRemoved: boolean;
  restartRequired: boolean;
}

export interface PluginStoreEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  repository: string;
  logo: string;
  homepage: string;
  license: string;
  tags: string[];
  installed: boolean;
  installedVersion: string;
  path: string;
  configured: boolean;
  registered: boolean;
  enabled: boolean;
  effectiveEnabled: boolean;
  updateAvailable: boolean;
}

export interface PluginStoreResponse {
  pluginsEnabled: boolean;
  pluginsDir: string;
  plugins: PluginStoreEntry[];
}

export interface PluginStoreInstallResult {
  status: string;
  id: string;
  version: string;
  path: string;
  pluginsEnabled: boolean;
  restartRequired: boolean;
}
