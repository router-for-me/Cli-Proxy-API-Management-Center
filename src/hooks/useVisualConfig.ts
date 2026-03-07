import { useCallback, useMemo, useState } from 'react';
import { isMap, parse as parseYaml, parseDocument } from 'yaml';
import type {
  PayloadFilterRule,
  PayloadParamEntry,
  PayloadParamValueType,
  PayloadRule,
  VisualConfigValues,
  VisualConfigValidationErrors,
  PayloadParamValidationErrorCode,
} from '@/types/visualConfig';
import { DEFAULT_VISUAL_VALUES } from '@/types/visualConfig';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractApiKeyValue(raw: unknown): string | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }

  const record = asRecord(raw);
  if (!record) return null;

  const candidates = [record['api-key'], record.apiKey, record.key, record.Key];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }

  return null;
}

function parseApiKeysText(raw: unknown): string {
  if (!Array.isArray(raw)) return '';

  const keys: string[] = [];
  for (const item of raw) {
    const key = extractApiKeyValue(item);
    if (key) keys.push(key);
  }
  return keys.join('\n');
}

function replaceApiKeyValue(entry: unknown, apiKey: string): unknown {
  const record = asRecord(entry);
  if (!record) return apiKey;

  if ('api-key' in record) return { ...record, 'api-key': apiKey };
  if ('apiKey' in record) return { ...record, apiKey };
  if ('key' in record) return { ...record, key: apiKey };
  if ('Key' in record) return { ...record, Key: apiKey };

  return { ...record, 'api-key': apiKey };
}

function buildApiKeyEntries(
  apiKeys: string[],
  metadata: ApiKeysStorageMetadata
): Array<string | Record<string, unknown>> {
  return apiKeys.map((apiKey, index) => {
    const originalEntry = metadata.originalEntries[index];
    if (metadata.entryMode === 'object') {
      const replaced = replaceApiKeyValue(originalEntry, apiKey);
      return asRecord(replaced) ?? { 'api-key': apiKey };
    }

    const record = asRecord(originalEntry);
    return record ? ({ ...record, ...(replaceApiKeyValue(record, apiKey) as Record<string, unknown>) }) : apiKey;
  });
}

function resolveApiKeysStorage(parsed: Record<string, unknown>): {
  text: string;
  metadata: ApiKeysStorageMetadata;
} {
  const legacyEntries = Array.isArray(parsed['api-keys']) ? parsed['api-keys'] : [];
  const auth = asRecord(parsed.auth);
  const providers = asRecord(auth?.providers);
  const configApiKeyProvider = asRecord(providers?.['config-api-key']);

  if (configApiKeyProvider) {
    const providerEntries = Array.isArray(configApiKeyProvider['api-key-entries'])
      ? configApiKeyProvider['api-key-entries']
      : Array.isArray(configApiKeyProvider['api-keys'])
        ? configApiKeyProvider['api-keys']
        : [];
    const providerListKey = Array.isArray(configApiKeyProvider['api-key-entries'])
      ? 'api-key-entries'
      : 'api-keys';

    return {
      text: parseApiKeysText(providerEntries),
      metadata: {
        source: 'auth-provider',
        providerListKey,
        entryMode:
          providerListKey === 'api-key-entries' || providerEntries.some((entry) => Boolean(asRecord(entry)))
            ? 'object'
            : 'string',
        originalEntries: providerEntries,
        syncLegacy: legacyEntries.length > 0,
      },
    };
  }

  return {
    text: parseApiKeysText(legacyEntries),
    metadata: {
      source: 'legacy',
      entryMode: legacyEntries.some((entry) => Boolean(asRecord(entry))) ? 'object' : 'string',
      originalEntries: legacyEntries,
      syncLegacy: false,
    },
  };
}

type YamlDocument = ReturnType<typeof parseDocument>;
type YamlPath = string[];

type ApiKeysStorageMode = 'legacy' | 'auth-provider';
type ApiKeysEntryMode = 'string' | 'object';

type ApiKeysStorageMetadata = {
  source: ApiKeysStorageMode;
  providerListKey?: 'api-keys' | 'api-key-entries';
  entryMode: ApiKeysEntryMode;
  originalEntries: unknown[];
  syncLegacy: boolean;
};

const DEFAULT_API_KEYS_STORAGE_METADATA: ApiKeysStorageMetadata = {
  source: 'legacy',
  entryMode: 'string',
  originalEntries: [],
  syncLegacy: false,
};

function docHas(doc: YamlDocument, path: YamlPath): boolean {
  return doc.hasIn(path);
}

function ensureMapInDoc(doc: YamlDocument, path: YamlPath): void {
  const existing = doc.getIn(path, true);
  if (isMap(existing)) return;
  doc.setIn(path, {});
}

function deleteIfMapEmpty(doc: YamlDocument, path: YamlPath): void {
  const value = doc.getIn(path, true);
  if (!isMap(value)) return;
  if (value.items.length === 0) doc.deleteIn(path);
}

function setBooleanInDoc(doc: YamlDocument, path: YamlPath, value: boolean): void {
  if (value) {
    doc.setIn(path, true);
    return;
  }
  if (docHas(doc, path)) doc.setIn(path, false);
}

function setStringInDoc(doc: YamlDocument, path: YamlPath, value: unknown): void {
  const safe = typeof value === 'string' ? value : '';
  const trimmed = safe.trim();
  if (trimmed !== '') {
    doc.setIn(path, safe);
    return;
  }
  // Preserve existing empty-string keys to avoid dropping template blocks/comments.
  // Only keep the key when it already exists in the YAML.
  if (docHas(doc, path)) {
    doc.setIn(path, '');
  }
}

function setIntFromStringInDoc(doc: YamlDocument, path: YamlPath, value: unknown): void {
  const safe = typeof value === 'string' ? value : '';
  const trimmed = safe.trim();
  if (trimmed === '') {
    if (docHas(doc, path)) doc.deleteIn(path);
    return;
  }

  if (!/^-?\d+$/.test(trimmed)) {
    return;
  }

  const parsed = Number(trimmed);
  if (Number.isFinite(parsed)) {
    doc.setIn(path, parsed);
    return;
  }
}

function getNonNegativeIntegerError(value: string): 'non_negative_integer' | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^-?\d+$/.test(trimmed)) return 'non_negative_integer';
  return Number(trimmed) >= 0 ? undefined : 'non_negative_integer';
}

function getPortError(value: string): 'port_range' | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) return 'port_range';
  const parsed = Number(trimmed);
  return parsed >= 1 && parsed <= 65535 ? undefined : 'port_range';
}

export function getVisualConfigValidationErrors(
  values: VisualConfigValues
): VisualConfigValidationErrors {
  return {
    port: getPortError(values.port),
    logsMaxTotalSizeMb: getNonNegativeIntegerError(values.logsMaxTotalSizeMb),
    requestRetry: getNonNegativeIntegerError(values.requestRetry),
    maxRetryInterval: getNonNegativeIntegerError(values.maxRetryInterval),
    'streaming.keepaliveSeconds': getNonNegativeIntegerError(values.streaming.keepaliveSeconds),
    'streaming.bootstrapRetries': getNonNegativeIntegerError(values.streaming.bootstrapRetries),
    'streaming.nonstreamKeepaliveInterval': getNonNegativeIntegerError(
      values.streaming.nonstreamKeepaliveInterval
    ),
  };
}

export function getPayloadParamValidationError(
  param: PayloadParamEntry
): PayloadParamValidationErrorCode | undefined {
  const trimmedValue = param.value.trim();

  switch (param.valueType) {
    case 'number': {
      if (!trimmedValue) return 'payload_invalid_number';
      const parsed = Number(trimmedValue);
      return Number.isFinite(parsed) ? undefined : 'payload_invalid_number';
    }
    case 'boolean': {
      const normalized = trimmedValue.toLowerCase();
      return normalized === 'true' || normalized === 'false'
        ? undefined
        : 'payload_invalid_boolean';
    }
    case 'json': {
      if (!trimmedValue) return 'payload_invalid_json';
      try {
        JSON.parse(param.value);
        return undefined;
      } catch {
        return 'payload_invalid_json';
      }
    }
    default:
      return undefined;
  }
}

function hasPayloadParamValidationErrors(rules: PayloadRule[]): boolean {
  return rules.some((rule) => rule.params.some((param) => Boolean(getPayloadParamValidationError(param))));
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function parsePayloadParamValue(raw: unknown): { valueType: PayloadParamValueType; value: string } {
  if (typeof raw === 'number') {
    return { valueType: 'number', value: String(raw) };
  }

  if (typeof raw === 'boolean') {
    return { valueType: 'boolean', value: String(raw) };
  }

  if (raw === null || typeof raw === 'object') {
    try {
      const json = JSON.stringify(raw, null, 2);
      return { valueType: 'json', value: json ?? 'null' };
    } catch {
      return { valueType: 'json', value: String(raw) };
    }
  }

  return { valueType: 'string', value: String(raw ?? '') };
}

const PAYLOAD_PROTOCOL_VALUES = [
  'openai',
  'openai-response',
  'gemini',
  'claude',
  'codex',
  'antigravity',
] as const;
type PayloadProtocol = (typeof PAYLOAD_PROTOCOL_VALUES)[number];

function parsePayloadProtocol(raw: unknown): PayloadProtocol | undefined {
  if (typeof raw !== 'string') return undefined;
  return PAYLOAD_PROTOCOL_VALUES.includes(raw as PayloadProtocol)
    ? (raw as PayloadProtocol)
    : undefined;
}

function parsePayloadRules(rules: unknown): PayloadRule[] {
  if (!Array.isArray(rules)) return [];

  return rules.map((rule, index) => {
    const record = asRecord(rule) ?? {};

    const modelsRaw = record.models;
    const models = Array.isArray(modelsRaw)
      ? modelsRaw.map((model, modelIndex) => {
          const modelRecord = asRecord(model);
          const nameRaw =
            typeof model === 'string' ? model : (modelRecord?.name ?? modelRecord?.id ?? '');
          const name = typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? '');
          return {
            id: `model-${index}-${modelIndex}`,
            name,
            protocol: parsePayloadProtocol(modelRecord?.protocol),
          };
        })
      : [];

    const paramsRecord = asRecord(record.params);
    const params = paramsRecord
      ? Object.entries(paramsRecord).map(([path, value], pIndex) => {
          const parsedValue = parsePayloadParamValue(value);
          return {
            id: `param-${index}-${pIndex}`,
            path,
            valueType: parsedValue.valueType,
            value: parsedValue.value,
          };
        })
      : [];

    return { id: `payload-rule-${index}`, models, params };
  });
}

function parsePayloadFilterRules(rules: unknown): PayloadFilterRule[] {
  if (!Array.isArray(rules)) return [];

  return rules.map((rule, index) => {
    const record = asRecord(rule) ?? {};

    const modelsRaw = record.models;
    const models = Array.isArray(modelsRaw)
      ? modelsRaw.map((model, modelIndex) => {
          const modelRecord = asRecord(model);
          const nameRaw =
            typeof model === 'string' ? model : (modelRecord?.name ?? modelRecord?.id ?? '');
          const name = typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? '');
          return {
            id: `filter-model-${index}-${modelIndex}`,
            name,
            protocol: parsePayloadProtocol(modelRecord?.protocol),
          };
        })
      : [];

    const paramsRaw = record.params;
    const params = Array.isArray(paramsRaw) ? paramsRaw.map(String) : [];

    return { id: `payload-filter-rule-${index}`, models, params };
  });
}

function serializePayloadRulesForYaml(rules: PayloadRule[]): Array<Record<string, unknown>> {
  return rules
    .map((rule) => {
      const models = (rule.models || [])
        .filter((m) => m.name?.trim())
        .map((m) => {
          const obj: Record<string, unknown> = { name: m.name.trim() };
          if (m.protocol) obj.protocol = m.protocol;
          return obj;
        });

      const params: Record<string, unknown> = {};
      for (const param of rule.params || []) {
        if (!param.path?.trim()) continue;
        let value: unknown = param.value;
        if (param.valueType === 'number') {
          const num = Number(param.value);
          value = Number.isFinite(num) ? num : param.value;
        } else if (param.valueType === 'boolean') {
          value = param.value === 'true';
        } else if (param.valueType === 'json') {
          try {
            value = JSON.parse(param.value);
          } catch {
            value = param.value;
          }
        }
        params[param.path.trim()] = value;
      }

      return { models, params };
    })
    .filter((rule) => rule.models.length > 0);
}

function serializePayloadFilterRulesForYaml(
  rules: PayloadFilterRule[]
): Array<Record<string, unknown>> {
  return rules
    .map((rule) => {
      const models = (rule.models || [])
        .filter((m) => m.name?.trim())
        .map((m) => {
          const obj: Record<string, unknown> = { name: m.name.trim() };
          if (m.protocol) obj.protocol = m.protocol;
          return obj;
        });

      const params = (Array.isArray(rule.params) ? rule.params : [])
        .map((path) => String(path).trim())
        .filter(Boolean);

      return { models, params };
    })
    .filter((rule) => rule.models.length > 0);
}

export function useVisualConfig() {
  const [visualValues, setVisualValuesState] = useState<VisualConfigValues>({
    ...DEFAULT_VISUAL_VALUES,
  });

  const [baselineValues, setBaselineValues] = useState<VisualConfigValues>({
    ...DEFAULT_VISUAL_VALUES,
  });
  const [visualParseError, setVisualParseError] = useState<string | null>(null);
  const [apiKeysStorageMetadata, setApiKeysStorageMetadata] =
    useState<ApiKeysStorageMetadata>(DEFAULT_API_KEYS_STORAGE_METADATA);
  const visualValidationErrors = useMemo(
    () => getVisualConfigValidationErrors(visualValues),
    [visualValues]
  );
  const visualHasPayloadValidationErrors = useMemo(
    () =>
      hasPayloadParamValidationErrors(visualValues.payloadDefaultRules) ||
      hasPayloadParamValidationErrors(visualValues.payloadOverrideRules),
    [visualValues.payloadDefaultRules, visualValues.payloadOverrideRules]
  );

  const visualDirty = useMemo(() => {
    return JSON.stringify(visualValues) !== JSON.stringify(baselineValues);
  }, [baselineValues, visualValues]);

  const loadVisualValuesFromYaml = useCallback((yamlContent: string) => {
    try {
      const document = parseDocument(yamlContent);
      if (document.errors.length > 0) {
        throw new Error(document.errors[0]?.message ?? 'Invalid YAML');
      }

      const parsedRaw: unknown = parseYaml(yamlContent) || {};
      const parsed = asRecord(parsedRaw) ?? {};
      const tls = asRecord(parsed.tls);
      const remoteManagement = asRecord(parsed['remote-management']);
      const quotaExceeded = asRecord(parsed['quota-exceeded']);
      const routing = asRecord(parsed.routing);
      const payload = asRecord(parsed.payload);
      const streaming = asRecord(parsed.streaming);
      const apiKeysStorage = resolveApiKeysStorage(parsed);

      const newValues: VisualConfigValues = {
        host: typeof parsed.host === 'string' ? parsed.host : '',
        port: String(parsed.port ?? ''),

        tlsEnable: Boolean(tls?.enable),
        tlsCert: typeof tls?.cert === 'string' ? tls.cert : '',
        tlsKey: typeof tls?.key === 'string' ? tls.key : '',

        rmAllowRemote: Boolean(remoteManagement?.['allow-remote']),
        rmSecretKey:
          typeof remoteManagement?.['secret-key'] === 'string' ? remoteManagement['secret-key'] : '',
        rmDisableControlPanel: Boolean(remoteManagement?.['disable-control-panel']),
        rmPanelRepo:
          typeof remoteManagement?.['panel-github-repository'] === 'string'
            ? remoteManagement['panel-github-repository']
            : typeof remoteManagement?.['panel-repo'] === 'string'
              ? remoteManagement['panel-repo']
              : '',

        authDir: typeof parsed['auth-dir'] === 'string' ? parsed['auth-dir'] : '',
        apiKeysText: apiKeysStorage.text,

        debug: Boolean(parsed.debug),
        commercialMode: Boolean(parsed['commercial-mode']),
        loggingToFile: Boolean(parsed['logging-to-file']),
        logsMaxTotalSizeMb: String(parsed['logs-max-total-size-mb'] ?? ''),
        usageStatisticsEnabled: Boolean(parsed['usage-statistics-enabled']),

        proxyUrl: typeof parsed['proxy-url'] === 'string' ? parsed['proxy-url'] : '',
        forceModelPrefix: Boolean(parsed['force-model-prefix']),
        requestRetry: String(parsed['request-retry'] ?? ''),
        maxRetryInterval: String(parsed['max-retry-interval'] ?? ''),
        wsAuth: Boolean(parsed['ws-auth']),

        quotaSwitchProject: Boolean(quotaExceeded?.['switch-project'] ?? true),
        quotaSwitchPreviewModel: Boolean(
          quotaExceeded?.['switch-preview-model'] ?? true
        ),

        routingStrategy:
          routing?.strategy === 'fill-first' ? 'fill-first' : 'round-robin',

        payloadDefaultRules: parsePayloadRules(payload?.default),
        payloadOverrideRules: parsePayloadRules(payload?.override),
        payloadFilterRules: parsePayloadFilterRules(payload?.filter),

        streaming: {
          keepaliveSeconds: String(streaming?.['keepalive-seconds'] ?? ''),
          bootstrapRetries: String(streaming?.['bootstrap-retries'] ?? ''),
          nonstreamKeepaliveInterval: String(parsed['nonstream-keepalive-interval'] ?? ''),
        },
      };

      setVisualValuesState(newValues);
      setBaselineValues(deepClone(newValues));
      setApiKeysStorageMetadata(apiKeysStorage.metadata);
      setVisualParseError(null);
      return { ok: true as const };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid YAML';
      setVisualParseError(message);
      return { ok: false as const, error: message };
    }
  }, []);

  const applyVisualChangesToYaml = useCallback(
    (currentYaml: string): string => {
      try {
        const doc = parseDocument(currentYaml);
        if (doc.errors.length > 0) return currentYaml;
        if (!isMap(doc.contents)) {
          doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
        }
        const values = visualValues;

        setStringInDoc(doc, ['host'], values.host);
        setIntFromStringInDoc(doc, ['port'], values.port);

        if (
          docHas(doc, ['tls']) ||
          values.tlsEnable ||
          values.tlsCert.trim() ||
          values.tlsKey.trim()
        ) {
          ensureMapInDoc(doc, ['tls']);
          setBooleanInDoc(doc, ['tls', 'enable'], values.tlsEnable);
          setStringInDoc(doc, ['tls', 'cert'], values.tlsCert);
          setStringInDoc(doc, ['tls', 'key'], values.tlsKey);
          deleteIfMapEmpty(doc, ['tls']);
        }

        if (
          docHas(doc, ['remote-management']) ||
          values.rmAllowRemote ||
          values.rmSecretKey.trim() ||
          values.rmDisableControlPanel ||
          values.rmPanelRepo.trim()
        ) {
          ensureMapInDoc(doc, ['remote-management']);
          setBooleanInDoc(doc, ['remote-management', 'allow-remote'], values.rmAllowRemote);
          setStringInDoc(doc, ['remote-management', 'secret-key'], values.rmSecretKey);
          setBooleanInDoc(
            doc,
            ['remote-management', 'disable-control-panel'],
            values.rmDisableControlPanel
          );
          setStringInDoc(doc, ['remote-management', 'panel-github-repository'], values.rmPanelRepo);
          if (docHas(doc, ['remote-management', 'panel-repo'])) {
            doc.deleteIn(['remote-management', 'panel-repo']);
          }
          deleteIfMapEmpty(doc, ['remote-management']);
        }

        setStringInDoc(doc, ['auth-dir'], values.authDir);
        if (values.apiKeysText !== baselineValues.apiKeysText) {
          const apiKeys = values.apiKeysText
            .split('\n')
            .map((key) => key.trim())
            .filter(Boolean);
          const apiKeyEntries = buildApiKeyEntries(apiKeys, apiKeysStorageMetadata);

          if (apiKeysStorageMetadata.source === 'auth-provider') {
            ensureMapInDoc(doc, ['auth']);
            ensureMapInDoc(doc, ['auth', 'providers']);
            ensureMapInDoc(doc, ['auth', 'providers', 'config-api-key']);

            const providerListKey = apiKeysStorageMetadata.providerListKey ?? 'api-key-entries';
            const providerPath = ['auth', 'providers', 'config-api-key', providerListKey];

            if (apiKeys.length > 0) {
              doc.setIn(providerPath, apiKeyEntries);
            } else if (docHas(doc, providerPath)) {
              doc.deleteIn(providerPath);
            }

            deleteIfMapEmpty(doc, ['auth', 'providers', 'config-api-key']);
            deleteIfMapEmpty(doc, ['auth', 'providers']);
            deleteIfMapEmpty(doc, ['auth']);

            if (apiKeysStorageMetadata.syncLegacy) {
              if (apiKeys.length > 0) {
                doc.setIn(['api-keys'], apiKeys);
              } else if (docHas(doc, ['api-keys'])) {
                doc.deleteIn(['api-keys']);
              }
            }
          } else if (apiKeys.length > 0) {
            doc.setIn(['api-keys'], apiKeyEntries);
          } else if (docHas(doc, ['api-keys'])) {
            doc.deleteIn(['api-keys']);
          }
        }

        setBooleanInDoc(doc, ['debug'], values.debug);

        setBooleanInDoc(doc, ['commercial-mode'], values.commercialMode);
        setBooleanInDoc(doc, ['logging-to-file'], values.loggingToFile);
        setIntFromStringInDoc(doc, ['logs-max-total-size-mb'], values.logsMaxTotalSizeMb);
        setBooleanInDoc(doc, ['usage-statistics-enabled'], values.usageStatisticsEnabled);

        setStringInDoc(doc, ['proxy-url'], values.proxyUrl);
        setBooleanInDoc(doc, ['force-model-prefix'], values.forceModelPrefix);
        setIntFromStringInDoc(doc, ['request-retry'], values.requestRetry);
        setIntFromStringInDoc(doc, ['max-retry-interval'], values.maxRetryInterval);
        setBooleanInDoc(doc, ['ws-auth'], values.wsAuth);

        if (
          docHas(doc, ['quota-exceeded']) ||
          !values.quotaSwitchProject ||
          !values.quotaSwitchPreviewModel
        ) {
          ensureMapInDoc(doc, ['quota-exceeded']);
          doc.setIn(['quota-exceeded', 'switch-project'], values.quotaSwitchProject);
          doc.setIn(
            ['quota-exceeded', 'switch-preview-model'],
            values.quotaSwitchPreviewModel
          );
          deleteIfMapEmpty(doc, ['quota-exceeded']);
        }

        if (docHas(doc, ['routing']) || values.routingStrategy !== 'round-robin') {
          ensureMapInDoc(doc, ['routing']);
          doc.setIn(['routing', 'strategy'], values.routingStrategy);
          deleteIfMapEmpty(doc, ['routing']);
        }

        const keepaliveSeconds =
          typeof values.streaming?.keepaliveSeconds === 'string' ? values.streaming.keepaliveSeconds : '';
        const bootstrapRetries =
          typeof values.streaming?.bootstrapRetries === 'string' ? values.streaming.bootstrapRetries : '';
        const nonstreamKeepaliveInterval =
          typeof values.streaming?.nonstreamKeepaliveInterval === 'string'
            ? values.streaming.nonstreamKeepaliveInterval
            : '';

        const streamingDefined =
          docHas(doc, ['streaming']) || keepaliveSeconds.trim() || bootstrapRetries.trim();
        if (streamingDefined) {
          ensureMapInDoc(doc, ['streaming']);
          setIntFromStringInDoc(doc, ['streaming', 'keepalive-seconds'], keepaliveSeconds);
          setIntFromStringInDoc(doc, ['streaming', 'bootstrap-retries'], bootstrapRetries);
          deleteIfMapEmpty(doc, ['streaming']);
        }

        setIntFromStringInDoc(
          doc,
          ['nonstream-keepalive-interval'],
          nonstreamKeepaliveInterval
        );

        if (
          docHas(doc, ['payload']) ||
          values.payloadDefaultRules.length > 0 ||
          values.payloadOverrideRules.length > 0 ||
          values.payloadFilterRules.length > 0
        ) {
          ensureMapInDoc(doc, ['payload']);
          if (values.payloadDefaultRules.length > 0) {
            doc.setIn(
              ['payload', 'default'],
              serializePayloadRulesForYaml(values.payloadDefaultRules)
            );
          } else if (docHas(doc, ['payload', 'default'])) {
            doc.deleteIn(['payload', 'default']);
          }
          if (values.payloadOverrideRules.length > 0) {
            doc.setIn(
              ['payload', 'override'],
              serializePayloadRulesForYaml(values.payloadOverrideRules)
            );
          } else if (docHas(doc, ['payload', 'override'])) {
            doc.deleteIn(['payload', 'override']);
          }
          if (values.payloadFilterRules.length > 0) {
            doc.setIn(
              ['payload', 'filter'],
              serializePayloadFilterRulesForYaml(values.payloadFilterRules)
            );
          } else if (docHas(doc, ['payload', 'filter'])) {
            doc.deleteIn(['payload', 'filter']);
          }
          deleteIfMapEmpty(doc, ['payload']);
        }

        return doc.toString({ indent: 2, lineWidth: 120, minContentWidth: 0 });
      } catch {
        return currentYaml;
      }
    },
    [apiKeysStorageMetadata, baselineValues, visualValues]
  );

  const setVisualValues = useCallback((newValues: Partial<VisualConfigValues>) => {
    setVisualValuesState((prev) => {
      const next: VisualConfigValues = { ...prev, ...newValues } as VisualConfigValues;
      if (newValues.streaming) {
        next.streaming = { ...prev.streaming, ...newValues.streaming };
      }
      return next;
    });
  }, []);

  return {
    visualValues,
    visualDirty,
    visualParseError,
    visualValidationErrors,
    visualHasPayloadValidationErrors,
    loadVisualValuesFromYaml,
    applyVisualChangesToYaml,
    setVisualValues,
  };
}

export const VISUAL_CONFIG_PROTOCOL_OPTIONS = [
  {
    value: '',
    labelKey: 'config_management.visual.payload_rules.provider_default',
    defaultLabel: 'Default',
  },
  {
    value: 'openai',
    labelKey: 'config_management.visual.payload_rules.provider_openai',
    defaultLabel: 'OpenAI',
  },
  {
    value: 'openai-response',
    labelKey: 'config_management.visual.payload_rules.provider_openai_response',
    defaultLabel: 'OpenAI Response',
  },
  {
    value: 'gemini',
    labelKey: 'config_management.visual.payload_rules.provider_gemini',
    defaultLabel: 'Gemini',
  },
  {
    value: 'claude',
    labelKey: 'config_management.visual.payload_rules.provider_claude',
    defaultLabel: 'Claude',
  },
  {
    value: 'codex',
    labelKey: 'config_management.visual.payload_rules.provider_codex',
    defaultLabel: 'Codex',
  },
  {
    value: 'antigravity',
    labelKey: 'config_management.visual.payload_rules.provider_antigravity',
    defaultLabel: 'Antigravity',
  },
] as const;

export const VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS = [
  {
    value: 'string',
    labelKey: 'config_management.visual.payload_rules.value_type_string',
    defaultLabel: 'String',
  },
  {
    value: 'number',
    labelKey: 'config_management.visual.payload_rules.value_type_number',
    defaultLabel: 'Number',
  },
  {
    value: 'boolean',
    labelKey: 'config_management.visual.payload_rules.value_type_boolean',
    defaultLabel: 'Boolean',
  },
  {
    value: 'json',
    labelKey: 'config_management.visual.payload_rules.value_type_json',
    defaultLabel: 'JSON',
  },
] as const satisfies ReadonlyArray<{
  value: PayloadParamValueType;
  labelKey: string;
  defaultLabel: string;
}>;
