import { useCallback, useMemo, useState } from 'react';
import {
  applyYamlPatches,
  applyYamlTemplatePatches,
  extractYamlCommentSection,
  extractYamlTopLevelBlock,
  getYamlObjectArrayAtPath,
  getYamlScalarAtPath,
  getYamlStringArrayAtPath,
  listYamlMapKeysAtPath,
  normalizeYamlSnippetToRoot,
} from '@/utils/yamlPatch';
import type { OauthChannelMappings, OauthModelMappingEntry, VisualConfigValues } from './types';
import { DEFAULT_VISUAL_VALUES, makeClientId } from './types';

const CONFIG_YAML_KEY_ORDER: Record<string, string[]> = {
  '': [
    'host',
    'port',
    'tls',
    'remote-management',
    'auth-dir',
    'api-keys',
    'debug',
    'commercial-mode',
    'logging-to-file',
    'logs-max-total-size-mb',
    'usage-statistics-enabled',
    'proxy-url',
    'force-model-prefix',
    'request-retry',
    'max-retry-interval',
    'quota-exceeded',
    'routing',
    'ws-auth',
    'ampcode',
    'oauth-model-mappings',
  ],
  tls: ['enable', 'cert', 'key'],
  'remote-management': [
    'allow-remote',
    'secret-key',
    'disable-control-panel',
    'panel-github-repository',
  ],
  'quota-exceeded': ['switch-project', 'switch-preview-model'],
  routing: ['strategy'],
  ampcode: [
    'upstream-url',
    'upstream-api-key',
    'restrict-management-to-localhost',
    'force-model-mappings',
    'model-mappings',
  ],
};

export function useVisualConfig() {
  const [visualValues, setVisualValues] = useState<VisualConfigValues>(DEFAULT_VISUAL_VALUES);
  const [visualInitial, setVisualInitial] = useState<VisualConfigValues>(DEFAULT_VISUAL_VALUES);

  const loadVisualValuesFromYaml = useCallback((yamlText: string) => {
    const next: VisualConfigValues = { ...DEFAULT_VISUAL_VALUES };

    const host = getYamlScalarAtPath(yamlText, ['host']);
    if (typeof host === 'string') next.host = host;

    const port = getYamlScalarAtPath(yamlText, ['port']);
    if (typeof port === 'number') next.port = String(port);
    else if (typeof port === 'string' && port.trim()) next.port = port.trim();

    const tlsEnable = getYamlScalarAtPath(yamlText, ['tls', 'enable']);
    if (typeof tlsEnable === 'boolean') next.tlsEnable = tlsEnable;
    const tlsCert = getYamlScalarAtPath(yamlText, ['tls', 'cert']);
    if (typeof tlsCert === 'string') next.tlsCert = tlsCert;
    const tlsKey = getYamlScalarAtPath(yamlText, ['tls', 'key']);
    if (typeof tlsKey === 'string') next.tlsKey = tlsKey;

    const rmAllowRemote = getYamlScalarAtPath(yamlText, ['remote-management', 'allow-remote']);
    if (typeof rmAllowRemote === 'boolean') next.rmAllowRemote = rmAllowRemote;
    const rmSecretKey = getYamlScalarAtPath(yamlText, ['remote-management', 'secret-key']);
    if (typeof rmSecretKey === 'string') next.rmSecretKey = rmSecretKey;
    const rmDisableControlPanel = getYamlScalarAtPath(yamlText, [
      'remote-management',
      'disable-control-panel',
    ]);
    if (typeof rmDisableControlPanel === 'boolean') next.rmDisableControlPanel = rmDisableControlPanel;
    const rmPanelRepo = getYamlScalarAtPath(yamlText, [
      'remote-management',
      'panel-github-repository',
    ]);
    if (typeof rmPanelRepo === 'string') next.rmPanelRepo = rmPanelRepo;

    const authDir = getYamlScalarAtPath(yamlText, ['auth-dir']);
    if (typeof authDir === 'string') next.authDir = authDir;
    const apiKeys = getYamlStringArrayAtPath(yamlText, ['api-keys']);
    if (Array.isArray(apiKeys)) next.apiKeysText = apiKeys.join('\n');

    const debug = getYamlScalarAtPath(yamlText, ['debug']);
    if (typeof debug === 'boolean') next.debug = debug;
    const commercialMode = getYamlScalarAtPath(yamlText, ['commercial-mode']);
    if (typeof commercialMode === 'boolean') next.commercialMode = commercialMode;
    const loggingToFile = getYamlScalarAtPath(yamlText, ['logging-to-file']);
    if (typeof loggingToFile === 'boolean') next.loggingToFile = loggingToFile;
    const logsMax = getYamlScalarAtPath(yamlText, ['logs-max-total-size-mb']);
    if (typeof logsMax === 'number') next.logsMaxTotalSizeMb = String(logsMax);
    else if (typeof logsMax === 'string' && logsMax.trim()) next.logsMaxTotalSizeMb = logsMax.trim();
    const usageEnabled = getYamlScalarAtPath(yamlText, ['usage-statistics-enabled']);
    if (typeof usageEnabled === 'boolean') next.usageStatisticsEnabled = usageEnabled;

    const proxyUrl = getYamlScalarAtPath(yamlText, ['proxy-url']);
    if (typeof proxyUrl === 'string') next.proxyUrl = proxyUrl;
    const forceModelPrefix = getYamlScalarAtPath(yamlText, ['force-model-prefix']);
    if (typeof forceModelPrefix === 'boolean') next.forceModelPrefix = forceModelPrefix;
    const requestRetry = getYamlScalarAtPath(yamlText, ['request-retry']);
    if (typeof requestRetry === 'number') next.requestRetry = String(requestRetry);
    else if (typeof requestRetry === 'string' && requestRetry.trim()) next.requestRetry = requestRetry.trim();
    const maxRetryInterval = getYamlScalarAtPath(yamlText, ['max-retry-interval']);
    if (typeof maxRetryInterval === 'number') next.maxRetryInterval = String(maxRetryInterval);
    else if (typeof maxRetryInterval === 'string' && maxRetryInterval.trim())
      next.maxRetryInterval = maxRetryInterval.trim();

    const quotaSwitchProject = getYamlScalarAtPath(yamlText, ['quota-exceeded', 'switch-project']);
    if (typeof quotaSwitchProject === 'boolean') next.quotaSwitchProject = quotaSwitchProject;
    const quotaSwitchPreviewModel = getYamlScalarAtPath(yamlText, [
      'quota-exceeded',
      'switch-preview-model',
    ]);
    if (typeof quotaSwitchPreviewModel === 'boolean')
      next.quotaSwitchPreviewModel = quotaSwitchPreviewModel;

    const routingStrategy = getYamlScalarAtPath(yamlText, ['routing', 'strategy']);
    if (routingStrategy === 'round-robin' || routingStrategy === 'fill-first')
      next.routingStrategy = routingStrategy;

    const wsAuth = getYamlScalarAtPath(yamlText, ['ws-auth']);
    if (typeof wsAuth === 'boolean') next.wsAuth = wsAuth;

    const ampTopLevel = extractYamlTopLevelBlock(yamlText, 'ampcode');
    const ampComment = extractYamlCommentSection(
      yamlText,
      '# Amp Integration',
      '# Global OAuth model name mappings (per channel)',
      { includeMarkers: false }
    );
    const ampSnippet = ampTopLevel || ampComment || '';
    if (ampSnippet.trim()) {
      const ampDoc = normalizeYamlSnippetToRoot(ampSnippet, 'ampcode');
      const upstreamUrl = getYamlScalarAtPath(ampDoc, ['ampcode', 'upstream-url']);
      if (typeof upstreamUrl === 'string') next.ampUpstreamUrl = upstreamUrl;
      const upstreamApiKey = getYamlScalarAtPath(ampDoc, ['ampcode', 'upstream-api-key']);
      if (typeof upstreamApiKey === 'string') next.ampUpstreamApiKey = upstreamApiKey;
      const restrictLocalhost = getYamlScalarAtPath(ampDoc, [
        'ampcode',
        'restrict-management-to-localhost',
      ]);
      if (typeof restrictLocalhost === 'boolean') next.ampRestrictManagementToLocalhost = restrictLocalhost;
      const forceMappings = getYamlScalarAtPath(ampDoc, ['ampcode', 'force-model-mappings']);
      if (typeof forceMappings === 'boolean') next.ampForceModelMappings = forceMappings;

      const modelMappings = getYamlObjectArrayAtPath(ampDoc, ['ampcode', 'model-mappings']) || [];
      const mappingEntries = modelMappings
        .map((item) => ({
          id: makeClientId(),
          from: typeof item?.from === 'string' ? item.from : '',
          to: typeof item?.to === 'string' ? item.to : '',
        }))
        .filter((m) => m.from.trim() || m.to.trim());
      if (mappingEntries.length) {
        next.ampModelMappings = mappingEntries;
      }
    }

    const oauthTopLevel = extractYamlTopLevelBlock(yamlText, 'oauth-model-mappings');
    const oauthComment = extractYamlCommentSection(
      yamlText,
      '# Global OAuth model name mappings (per channel)',
      '# OAuth provider excluded models',
      { includeMarkers: false }
    );
    const oauthSnippet = oauthTopLevel || oauthComment || '';
    if (oauthSnippet.trim()) {
      const oauthDoc = normalizeYamlSnippetToRoot(oauthSnippet, 'oauth-model-mappings');
      const channels = listYamlMapKeysAtPath(oauthDoc, ['oauth-model-mappings']);
      next.oauthModelMappings = channels.map((channel) => {
        const items = getYamlObjectArrayAtPath(oauthDoc, ['oauth-model-mappings', channel]) || [];
        const entries = items
          .map((item) => ({
            id: makeClientId(),
            name: typeof item?.name === 'string' ? item.name : '',
            alias: typeof item?.alias === 'string' ? item.alias : '',
            fork: typeof item?.fork === 'boolean' ? item.fork : false,
          }))
          .filter((m) => m.name.trim() || m.alias.trim());
        return {
          id: makeClientId(),
          channel,
          originalChannel: channel,
          entries: entries.length ? entries : [{ id: makeClientId(), name: '', alias: '', fork: false }],
        };
      });
    }

    setVisualValues(next);
    setVisualInitial(next);
  }, []);

  const buildVisualPatches = useCallback(
    (yamlText: string) => {
      const patches: Parameters<typeof applyYamlPatches>[1] = [];
      const templatePatches: Parameters<typeof applyYamlTemplatePatches>[1] = [];

      const pushString = (path: string[], current: string, initial: string, { force = false } = {}) => {
        if (!force && current === initial) return;
        patches.push({ path, type: 'string', value: current });
      };

      const pushNumber = (path: string[], current: string, initial: string, { force = false } = {}) => {
        if (!force && current === initial) return;
        const trimmed = current.trim();
        if (!trimmed) return;
        const num = Number(trimmed);
        if (!Number.isFinite(num)) return;
        patches.push({ path, type: 'number', value: num });
      };

      const pushBoolean = (path: string[], current: boolean, initial: boolean, { force = false } = {}) => {
        if (!force && current === initial) return;
        patches.push({ path, type: 'boolean', value: current });
      };

      const pushStringArrayText = (
        path: string[],
        currentText: string,
        initialText: string,
        { force = false } = {}
      ) => {
        if (!force && currentText === initialText) return;
        const list = String(currentText || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        patches.push({ path, type: 'stringArray', value: list });
      };

      const pushEnum = (
        path: string[],
        current: VisualConfigValues['routingStrategy'],
        initial: VisualConfigValues['routingStrategy']
      ) => {
        if (current === initial) return;
        patches.push({ path, type: 'enum', value: current });
      };

      pushString(['host'], visualValues.host, visualInitial.host);
      pushNumber(['port'], visualValues.port, visualInitial.port);

      pushBoolean(['tls', 'enable'], visualValues.tlsEnable, visualInitial.tlsEnable);
      pushString(['tls', 'cert'], visualValues.tlsCert, visualInitial.tlsCert);
      pushString(['tls', 'key'], visualValues.tlsKey, visualInitial.tlsKey);

      pushBoolean(
        ['remote-management', 'allow-remote'],
        visualValues.rmAllowRemote,
        visualInitial.rmAllowRemote
      );
      pushString(
        ['remote-management', 'secret-key'],
        visualValues.rmSecretKey,
        visualInitial.rmSecretKey
      );
      pushBoolean(
        ['remote-management', 'disable-control-panel'],
        visualValues.rmDisableControlPanel,
        visualInitial.rmDisableControlPanel
      );
      pushString(
        ['remote-management', 'panel-github-repository'],
        visualValues.rmPanelRepo,
        visualInitial.rmPanelRepo
      );

      pushString(['auth-dir'], visualValues.authDir, visualInitial.authDir);
      pushStringArrayText(['api-keys'], visualValues.apiKeysText, visualInitial.apiKeysText);

      pushBoolean(['debug'], visualValues.debug, visualInitial.debug);
      pushBoolean(['commercial-mode'], visualValues.commercialMode, visualInitial.commercialMode);
      pushBoolean(['logging-to-file'], visualValues.loggingToFile, visualInitial.loggingToFile);
      pushNumber(
        ['logs-max-total-size-mb'],
        visualValues.logsMaxTotalSizeMb,
        visualInitial.logsMaxTotalSizeMb
      );
      pushBoolean(
        ['usage-statistics-enabled'],
        visualValues.usageStatisticsEnabled,
        visualInitial.usageStatisticsEnabled
      );

      pushString(['proxy-url'], visualValues.proxyUrl, visualInitial.proxyUrl);
      pushBoolean(
        ['force-model-prefix'],
        visualValues.forceModelPrefix,
        visualInitial.forceModelPrefix
      );
      pushNumber(['request-retry'], visualValues.requestRetry, visualInitial.requestRetry);
      pushNumber(
        ['max-retry-interval'],
        visualValues.maxRetryInterval,
        visualInitial.maxRetryInterval
      );

      pushBoolean(
        ['quota-exceeded', 'switch-project'],
        visualValues.quotaSwitchProject,
        visualInitial.quotaSwitchProject
      );
      pushBoolean(
        ['quota-exceeded', 'switch-preview-model'],
        visualValues.quotaSwitchPreviewModel,
        visualInitial.quotaSwitchPreviewModel
      );

      pushEnum(['routing', 'strategy'], visualValues.routingStrategy, visualInitial.routingStrategy);
      pushBoolean(['ws-auth'], visualValues.wsAuth, visualInitial.wsAuth);

      const hasLine = (text: string, marker: string) =>
        String(text || '')
          .split(/\r?\n/)
          .some((line) => line.trim() === marker.trim());

      const ampMappingsNow = (visualValues.ampModelMappings || [])
        .map((m) => ({ from: m.from.trim(), to: m.to.trim() }))
        .filter((m) => m.from && m.to);
      const ampMappingsInitial = (visualInitial.ampModelMappings || [])
        .map((m) => ({ from: m.from.trim(), to: m.to.trim() }))
        .filter((m) => m.from && m.to);
      const ampMappingsChanged = JSON.stringify(ampMappingsNow) !== JSON.stringify(ampMappingsInitial);
      const ampUpstreamUrl = visualValues.ampUpstreamUrl.trim();
      const ampUpstreamApiKey = visualValues.ampUpstreamApiKey.trim();
      const ampHasContent =
        !!ampUpstreamUrl ||
        !!ampUpstreamApiKey ||
        visualValues.ampRestrictManagementToLocalhost ||
        visualValues.ampForceModelMappings ||
        ampMappingsNow.length > 0;

      if (ampHasContent) {
        const ampHasRoot = !!extractYamlTopLevelBlock(yamlText, 'ampcode').trim();
        const ampHasMarker = hasLine(yamlText, '# Amp Integration');

        const buildAmpSnippet = () => {
          const quote = (v: string) => JSON.stringify(String(v ?? ''));
          const lines: string[] = [];
          if (ampUpstreamUrl) lines.push(`upstream-url: ${quote(ampUpstreamUrl)}`);
          if (ampUpstreamApiKey) lines.push(`upstream-api-key: ${quote(ampUpstreamApiKey)}`);
          if (visualValues.ampRestrictManagementToLocalhost) {
            lines.push('restrict-management-to-localhost: true');
          }
          if (visualValues.ampForceModelMappings) {
            lines.push('force-model-mappings: true');
          }
          if (ampMappingsNow.length) {
            lines.push('model-mappings:');
            ampMappingsNow.forEach((m) => {
              lines.push(`  - from: ${quote(m.from)}`);
              lines.push(`    to: ${quote(m.to)}`);
            });
          }
          return lines.join('\n');
        };

        if (!ampHasRoot && ampHasMarker) {
          const snippet = buildAmpSnippet();
          if (snippet.trim()) {
            templatePatches.push({
              rootKey: 'ampcode',
              snippet,
              startMarker: '# Amp Integration',
              endMarker: '# Global OAuth model name mappings (per channel)',
            });
          }
        } else {
          pushString(['ampcode', 'upstream-url'], visualValues.ampUpstreamUrl, visualInitial.ampUpstreamUrl);
          pushString(
            ['ampcode', 'upstream-api-key'],
            visualValues.ampUpstreamApiKey,
            visualInitial.ampUpstreamApiKey
          );
          pushBoolean(
            ['ampcode', 'restrict-management-to-localhost'],
            visualValues.ampRestrictManagementToLocalhost,
            visualInitial.ampRestrictManagementToLocalhost
          );
          pushBoolean(
            ['ampcode', 'force-model-mappings'],
            visualValues.ampForceModelMappings,
            visualInitial.ampForceModelMappings
          );

          if (ampMappingsChanged) {
            patches.push({
              path: ['ampcode', 'model-mappings'],
              type: 'objectArray',
              value: ampMappingsNow.map((m) => ({ from: m.from, to: m.to })),
              itemKeyOrder: ['from', 'to'],
            });
          }
        }
      }

      const normalizeOauthEntries = (entries: OauthModelMappingEntry[]) =>
        (entries || [])
          .map((e) => ({ name: e.name.trim(), alias: e.alias.trim(), fork: !!e.fork }))
          .filter((e) => e.name);

      const oauthHasRoot = !!extractYamlTopLevelBlock(yamlText, 'oauth-model-mappings').trim();
      const oauthHasMarker = hasLine(yamlText, '# Global OAuth model name mappings (per channel)');

      const rows = (visualValues.oauthModelMappings || []).map((row) => {
        const currentChannel = row.channel.trim();
        const originalChannel = (row.originalChannel || row.channel).trim();
        return {
          currentChannel,
          originalChannel,
          currentKey: currentChannel.toLowerCase(),
          originalKey: originalChannel.toLowerCase(),
          entries: normalizeOauthEntries(row.entries),
        };
      });

      const initialRows = (visualInitial.oauthModelMappings || []).map((row) => {
        const originalChannel = (row.originalChannel || row.channel).trim();
        return {
          originalChannel,
          originalKey: originalChannel.toLowerCase(),
          entries: normalizeOauthEntries(row.entries),
        };
      });

      const initialHasAny = initialRows.some((r) => r.originalKey && r.entries.length > 0);
      const nowHasAny = rows.some((r) => r.currentKey && r.entries.length > 0);

      const toObjectArray = (entries: Array<{ name: string; alias: string; fork: boolean }>) =>
        entries.map((e) => {
          const obj: Record<string, unknown> = { name: e.name };
          if (e.alias && e.alias !== e.name) obj.alias = e.alias;
          if (e.fork) obj.fork = true;
          return obj;
        });

      const buildOauthSnippet = () => {
        const quote = (v: string) => JSON.stringify(String(v ?? ''));
        const lines: string[] = [];
        rows
          .filter((r) => r.currentChannel && r.entries.length > 0)
          .forEach((r) => {
            lines.push(`${r.currentChannel}:`);
            r.entries.forEach((entry) => {
              lines.push(`  - name: ${quote(entry.name)}`);
              if (entry.alias && entry.alias !== entry.name) {
                lines.push(`    alias: ${quote(entry.alias)}`);
              }
              if (entry.fork) {
                lines.push('    fork: true');
              }
            });
          });
        return lines.join('\n');
      };

      if (!oauthHasRoot && oauthHasMarker) {
        if (nowHasAny) {
          const snippet = buildOauthSnippet();
          if (snippet.trim()) {
            templatePatches.push({
              rootKey: 'oauth-model-mappings',
              snippet,
              startMarker: '# Global OAuth model name mappings (per channel)',
              endMarker: '# OAuth provider excluded models',
            });
          }
        }
      } else if (oauthHasRoot || initialHasAny) {
        const initialEntriesByKey = new Map(
          initialRows.map((r) => [r.originalKey, r.entries] as const).filter(([k]) => !!k)
        );

        const referencedOriginalKeys = new Set<string>();
        const writtenCurrentKeys = new Set<string>();

        rows.forEach((r) => {
          const initialEntries = initialEntriesByKey.get(r.originalKey) || [];
          const initialHadChannel = initialEntriesByKey.has(r.originalKey);
          const initialHadEntries = initialEntries.length > 0;
          const channelRenamed =
            initialHadChannel && !!r.currentKey && r.originalKey && r.originalKey !== r.currentKey;

          const keepInitialEmptyChannel =
            initialHadChannel &&
            !initialHadEntries &&
            !r.entries.length &&
            !!r.currentKey &&
            r.currentKey === r.originalKey;

          if (keepInitialEmptyChannel) {
            referencedOriginalKeys.add(r.originalKey);
            return;
          }

          if (!r.currentChannel) return;
          if (!r.entries.length) return;
          if (writtenCurrentKeys.has(r.currentKey)) {
            if (initialHadChannel) referencedOriginalKeys.add(r.originalKey);
            return;
          }
          writtenCurrentKeys.add(r.currentKey);

          if (initialHadChannel) referencedOriginalKeys.add(r.originalKey);
          const entriesChanged = JSON.stringify(r.entries) !== JSON.stringify(initialEntries);

          if (entriesChanged || channelRenamed || !oauthHasRoot) {
            patches.push({
              path: ['oauth-model-mappings', r.currentChannel],
              type: 'objectArray',
              value: toObjectArray(r.entries),
              itemKeyOrder: ['name', 'alias', 'fork'],
            });
          }

          if (channelRenamed) {
            patches.push({
              path: ['oauth-model-mappings', r.originalChannel],
              type: 'delete',
            });
          }
        });

        initialRows.forEach((r) => {
          if (!r.originalChannel) return;
          if (!r.originalKey) return;
          if (referencedOriginalKeys.has(r.originalKey)) return;
          patches.push({
            path: ['oauth-model-mappings', r.originalChannel],
            type: 'delete',
          });
        });

        if (!nowHasAny && initialHasAny && oauthHasRoot) {
          patches.push({ path: ['oauth-model-mappings'], type: 'delete' });
        }
      }

      return { patches, templatePatches };
    },
    [visualInitial, visualValues]
  );

  const applyVisualChangesToYaml = useCallback(
    (yamlText: string) => {
      const { patches, templatePatches } = buildVisualPatches(yamlText);
      if (!patches.length && !templatePatches.length) return yamlText;

      let updated = yamlText;
      if (patches.length) {
        updated = applyYamlPatches(updated, patches, { keyOrderMap: CONFIG_YAML_KEY_ORDER });
      }
      if (templatePatches.length) {
        updated = applyYamlTemplatePatches(updated, templatePatches);
      }
      return updated;
    },
    [buildVisualPatches]
  );

  const visualDirty = useMemo(() => {
    const a = visualValues;
    const b = visualInitial;
    if (a.host !== b.host) return true;
    if (a.port !== b.port) return true;
    if (a.tlsEnable !== b.tlsEnable) return true;
    if (a.tlsCert !== b.tlsCert) return true;
    if (a.tlsKey !== b.tlsKey) return true;
    if (a.rmAllowRemote !== b.rmAllowRemote) return true;
    if (a.rmSecretKey !== b.rmSecretKey) return true;
    if (a.rmDisableControlPanel !== b.rmDisableControlPanel) return true;
    if (a.rmPanelRepo !== b.rmPanelRepo) return true;
    if (a.authDir !== b.authDir) return true;
    if (a.apiKeysText !== b.apiKeysText) return true;
    if (a.debug !== b.debug) return true;
    if (a.commercialMode !== b.commercialMode) return true;
    if (a.loggingToFile !== b.loggingToFile) return true;
    if (a.logsMaxTotalSizeMb !== b.logsMaxTotalSizeMb) return true;
    if (a.usageStatisticsEnabled !== b.usageStatisticsEnabled) return true;
    if (a.proxyUrl !== b.proxyUrl) return true;
    if (a.forceModelPrefix !== b.forceModelPrefix) return true;
    if (a.requestRetry !== b.requestRetry) return true;
    if (a.maxRetryInterval !== b.maxRetryInterval) return true;
    if (a.quotaSwitchProject !== b.quotaSwitchProject) return true;
    if (a.quotaSwitchPreviewModel !== b.quotaSwitchPreviewModel) return true;
    if (a.routingStrategy !== b.routingStrategy) return true;
    if (a.wsAuth !== b.wsAuth) return true;

    const ampNow = (a.ampModelMappings || [])
      .map((m) => ({ from: m.from.trim(), to: m.to.trim() }))
      .filter((m) => m.from && m.to);
    const ampHasContent =
      !!a.ampUpstreamUrl.trim() ||
      !!a.ampUpstreamApiKey.trim() ||
      a.ampRestrictManagementToLocalhost ||
      a.ampForceModelMappings ||
      ampNow.length > 0;
    const ampInit = (b.ampModelMappings || [])
      .map((m) => ({ from: m.from.trim(), to: m.to.trim() }))
      .filter((m) => m.from && m.to);
    const ampInitHasContent =
      !!b.ampUpstreamUrl.trim() ||
      !!b.ampUpstreamApiKey.trim() ||
      b.ampRestrictManagementToLocalhost ||
      b.ampForceModelMappings ||
      ampInit.length > 0;
    if (ampHasContent || ampInitHasContent) {
      if (a.ampUpstreamUrl !== b.ampUpstreamUrl) return true;
      if (a.ampUpstreamApiKey !== b.ampUpstreamApiKey) return true;
      if (a.ampRestrictManagementToLocalhost !== b.ampRestrictManagementToLocalhost) return true;
      if (a.ampForceModelMappings !== b.ampForceModelMappings) return true;
      if (JSON.stringify(ampNow) !== JSON.stringify(ampInit)) return true;
    }

    const oauthInitialKeys = new Set(
      (b.oauthModelMappings || [])
        .map((ch) => (ch.originalChannel || ch.channel).trim().toLowerCase())
        .filter(Boolean)
    );

    const normalizeOauth = (channels: OauthChannelMappings[]) =>
      (channels || [])
        .map((ch) => {
          const channel = ch.channel.trim();
          const originalChannel = (ch.originalChannel || channel).trim();
          const entries = (ch.entries || [])
            .map((e) => ({ name: e.name.trim(), alias: e.alias.trim(), fork: !!e.fork }))
            .filter((e) => e.name);

          return {
            channel,
            originalChannel,
            originalKey: originalChannel.toLowerCase(),
            entries,
          };
        })
        .filter((ch) => {
          if (!ch.channel && !ch.originalChannel) return false;
          if (ch.entries.length) return !!ch.channel;
          if (!ch.originalKey) return false;
          return oauthInitialKeys.has(ch.originalKey);
        })
        .map(({ channel, originalChannel, entries }) => ({ channel, originalChannel, entries }));

    const oauthNow = normalizeOauth(a.oauthModelMappings);
    const oauthInit = normalizeOauth(b.oauthModelMappings);
    if (oauthNow.length || oauthInit.length) {
      if (JSON.stringify(oauthNow) !== JSON.stringify(oauthInit)) return true;
    }

    return false;
  }, [visualInitial, visualValues]);

  return {
    visualValues,
    setVisualValues,
    visualInitial,
    loadVisualValuesFromYaml,
    applyVisualChangesToYaml,
    visualDirty,
  };
}

