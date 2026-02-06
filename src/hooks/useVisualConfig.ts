import { useCallback, useMemo, useRef, useState } from 'react';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  PayloadFilterRule,
  PayloadParamValueType,
  PayloadRule,
  VisualConfigValues,
} from '@/types/visualConfig';
import { DEFAULT_VISUAL_VALUES } from '@/types/visualConfig';

function hasOwn(obj: unknown, key: string): obj is Record<string, unknown> {
  return obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
}

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

function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = asRecord(parent[key]);
  if (existing) return existing;
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function deleteIfEmpty(parent: Record<string, unknown>, key: string): void {
  const value = asRecord(parent[key]);
  if (!value) return;
  if (Object.keys(value).length === 0) delete parent[key];
}

function setBoolean(obj: Record<string, unknown>, key: string, value: boolean): void {
  if (value) {
    obj[key] = true;
    return;
  }
  if (hasOwn(obj, key)) obj[key] = false;
}

function setString(obj: Record<string, unknown>, key: string, value: unknown): void {
  const safe = typeof value === 'string' ? value : '';
  const trimmed = safe.trim();
  if (trimmed !== '') {
    obj[key] = safe;
    return;
  }
  if (hasOwn(obj, key)) delete obj[key];
}

function setIntFromString(obj: Record<string, unknown>, key: string, value: unknown): void {
  const safe = typeof value === 'string' ? value : '';
  const trimmed = safe.trim();
  if (trimmed === '') {
    if (hasOwn(obj, key)) delete obj[key];
    return;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isFinite(parsed)) {
    obj[key] = parsed;
    return;
  }

  if (hasOwn(obj, key)) delete obj[key];
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

function parsePayloadRules(rules: unknown): PayloadRule[] {
  if (!Array.isArray(rules)) return [];

  return rules.map((rule, index) => ({
    id: `payload-rule-${index}`,
    models: Array.isArray((rule as any)?.models)
      ? ((rule as any).models as unknown[]).map((model: any, modelIndex: number) => ({
          id: `model-${index}-${modelIndex}`,
          name: typeof model === 'string' ? model : model?.name || '',
          protocol: typeof model === 'object' ? (model?.protocol as any) : undefined,
        }))
      : [],
    params: (rule as any)?.params
      ? Object.entries((rule as any).params as Record<string, unknown>).map(([path, value], pIndex) => {
          const parsedValue = parsePayloadParamValue(value);
          return {
            id: `param-${index}-${pIndex}`,
            path,
            valueType: parsedValue.valueType,
            value: parsedValue.value,
          };
        })
      : [],
  }));
}

function parsePayloadFilterRules(rules: unknown): PayloadFilterRule[] {
  if (!Array.isArray(rules)) return [];

  return rules.map((rule, index) => ({
    id: `payload-filter-rule-${index}`,
    models: Array.isArray((rule as any)?.models)
      ? ((rule as any).models as unknown[]).map((model: any, modelIndex: number) => ({
          id: `filter-model-${index}-${modelIndex}`,
          name: typeof model === 'string' ? model : model?.name || '',
          protocol: typeof model === 'object' ? (model?.protocol as any) : undefined,
        }))
      : [],
    params: Array.isArray((rule as any)?.params) ? ((rule as any).params as unknown[]).map(String) : [],
  }));
}

function serializePayloadRulesForYaml(rules: PayloadRule[]): any[] {
  return rules
    .map((rule) => {
      const models = (rule.models || [])
        .filter((m) => m.name?.trim())
        .map((m) => {
          const obj: Record<string, any> = { name: m.name.trim() };
          if (m.protocol) obj.protocol = m.protocol;
          return obj;
        });

      const params: Record<string, any> = {};
      for (const param of rule.params || []) {
        if (!param.path?.trim()) continue;
        let value: any = param.value;
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

function serializePayloadFilterRulesForYaml(rules: PayloadFilterRule[]): any[] {
  return rules
    .map((rule) => {
      const models = (rule.models || [])
        .filter((m) => m.name?.trim())
        .map((m) => {
          const obj: Record<string, any> = { name: m.name.trim() };
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

  const baselineValues = useRef<VisualConfigValues>({ ...DEFAULT_VISUAL_VALUES });

  const visualDirty = useMemo(() => {
    return JSON.stringify(visualValues) !== JSON.stringify(baselineValues.current);
  }, [visualValues]);

  const loadVisualValuesFromYaml = useCallback((yamlContent: string) => {
    try {
      const parsed: any = parseYaml(yamlContent) || {};

      const newValues: VisualConfigValues = {
        host: parsed.host || '',
        port: String(parsed.port ?? ''),

        tlsEnable: Boolean(parsed.tls?.enable),
        tlsCert: parsed.tls?.cert || '',
        tlsKey: parsed.tls?.key || '',

        rmAllowRemote: Boolean(parsed['remote-management']?.['allow-remote']),
        rmSecretKey: parsed['remote-management']?.['secret-key'] || '',
        rmDisableControlPanel: Boolean(parsed['remote-management']?.['disable-control-panel']),
        rmPanelRepo:
          parsed['remote-management']?.['panel-github-repository'] ??
          parsed['remote-management']?.['panel-repo'] ??
          '',

        authDir: parsed['auth-dir'] || '',
        apiKeysText: parseApiKeysText(parsed['api-keys']),

        debug: Boolean(parsed.debug),
        commercialMode: Boolean(parsed['commercial-mode']),
        loggingToFile: Boolean(parsed['logging-to-file']),
        logsMaxTotalSizeMb: String(parsed['logs-max-total-size-mb'] ?? ''),
        usageStatisticsEnabled: Boolean(parsed['usage-statistics-enabled']),

        proxyUrl: parsed['proxy-url'] || '',
        forceModelPrefix: Boolean(parsed['force-model-prefix']),
        requestRetry: String(parsed['request-retry'] ?? ''),
        maxRetryInterval: String(parsed['max-retry-interval'] ?? ''),
        wsAuth: Boolean(parsed['ws-auth']),

        quotaSwitchProject: Boolean(parsed['quota-exceeded']?.['switch-project'] ?? true),
        quotaSwitchPreviewModel: Boolean(
          parsed['quota-exceeded']?.['switch-preview-model'] ?? true
        ),

        routingStrategy: (parsed.routing?.strategy || 'round-robin') as 'round-robin' | 'fill-first',

        payloadDefaultRules: parsePayloadRules(parsed.payload?.default),
        payloadOverrideRules: parsePayloadRules(parsed.payload?.override),
        payloadFilterRules: parsePayloadFilterRules(parsed.payload?.filter),

        streaming: {
          keepaliveSeconds: String(parsed.streaming?.['keepalive-seconds'] ?? ''),
          bootstrapRetries: String(parsed.streaming?.['bootstrap-retries'] ?? ''),
          nonstreamKeepaliveInterval: String(parsed['nonstream-keepalive-interval'] ?? ''),
        },
      };

      setVisualValuesState(newValues);
      baselineValues.current = deepClone(newValues);
    } catch {
      setVisualValuesState({ ...DEFAULT_VISUAL_VALUES });
      baselineValues.current = deepClone(DEFAULT_VISUAL_VALUES);
    }
  }, []);

  const applyVisualChangesToYaml = useCallback(
    (currentYaml: string): string => {
      try {
        const parsed = (parseYaml(currentYaml) || {}) as Record<string, unknown>;
        const values = visualValues;

        setString(parsed, 'host', values.host);
        setIntFromString(parsed, 'port', values.port);

        if (
          hasOwn(parsed, 'tls') ||
          values.tlsEnable ||
          values.tlsCert.trim() ||
          values.tlsKey.trim()
        ) {
          const tls = ensureRecord(parsed, 'tls');
          setBoolean(tls, 'enable', values.tlsEnable);
          setString(tls, 'cert', values.tlsCert);
          setString(tls, 'key', values.tlsKey);
          deleteIfEmpty(parsed, 'tls');
        }

        if (
          hasOwn(parsed, 'remote-management') ||
          values.rmAllowRemote ||
          values.rmSecretKey.trim() ||
          values.rmDisableControlPanel ||
          values.rmPanelRepo.trim()
        ) {
          const rm = ensureRecord(parsed, 'remote-management');
          setBoolean(rm, 'allow-remote', values.rmAllowRemote);
          setString(rm, 'secret-key', values.rmSecretKey);
          setBoolean(rm, 'disable-control-panel', values.rmDisableControlPanel);
          setString(rm, 'panel-github-repository', values.rmPanelRepo);
          if (hasOwn(rm, 'panel-repo')) delete rm['panel-repo'];
          deleteIfEmpty(parsed, 'remote-management');
        }

        setString(parsed, 'auth-dir', values.authDir);
        if (values.apiKeysText !== baselineValues.current.apiKeysText) {
          const apiKeys = values.apiKeysText
            .split('\n')
            .map((key) => key.trim())
            .filter(Boolean);
          if (apiKeys.length > 0) {
            parsed['api-keys'] = apiKeys;
          } else if (hasOwn(parsed, 'api-keys')) {
            delete parsed['api-keys'];
          }
        }

        setBoolean(parsed, 'debug', values.debug);

        setBoolean(parsed, 'commercial-mode', values.commercialMode);
        setBoolean(parsed, 'logging-to-file', values.loggingToFile);
        setIntFromString(parsed, 'logs-max-total-size-mb', values.logsMaxTotalSizeMb);
        setBoolean(parsed, 'usage-statistics-enabled', values.usageStatisticsEnabled);

        setString(parsed, 'proxy-url', values.proxyUrl);
        setBoolean(parsed, 'force-model-prefix', values.forceModelPrefix);
        setIntFromString(parsed, 'request-retry', values.requestRetry);
        setIntFromString(parsed, 'max-retry-interval', values.maxRetryInterval);
        setBoolean(parsed, 'ws-auth', values.wsAuth);

        if (hasOwn(parsed, 'quota-exceeded') || !values.quotaSwitchProject || !values.quotaSwitchPreviewModel) {
          const quota = ensureRecord(parsed, 'quota-exceeded');
          quota['switch-project'] = values.quotaSwitchProject;
          quota['switch-preview-model'] = values.quotaSwitchPreviewModel;
          deleteIfEmpty(parsed, 'quota-exceeded');
        }

        if (hasOwn(parsed, 'routing') || values.routingStrategy !== 'round-robin') {
          const routing = ensureRecord(parsed, 'routing');
          routing.strategy = values.routingStrategy;
          deleteIfEmpty(parsed, 'routing');
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
          hasOwn(parsed, 'streaming') || keepaliveSeconds.trim() || bootstrapRetries.trim();
        if (streamingDefined) {
          const streaming = ensureRecord(parsed, 'streaming');
          setIntFromString(streaming, 'keepalive-seconds', keepaliveSeconds);
          setIntFromString(streaming, 'bootstrap-retries', bootstrapRetries);
          deleteIfEmpty(parsed, 'streaming');
        }

        setIntFromString(parsed, 'nonstream-keepalive-interval', nonstreamKeepaliveInterval);

        if (
          hasOwn(parsed, 'payload') ||
          values.payloadDefaultRules.length > 0 ||
          values.payloadOverrideRules.length > 0 ||
          values.payloadFilterRules.length > 0
        ) {
          const payload = ensureRecord(parsed, 'payload');
          if (values.payloadDefaultRules.length > 0) {
            payload.default = serializePayloadRulesForYaml(values.payloadDefaultRules);
          } else if (hasOwn(payload, 'default')) {
            delete payload.default;
          }
          if (values.payloadOverrideRules.length > 0) {
            payload.override = serializePayloadRulesForYaml(values.payloadOverrideRules);
          } else if (hasOwn(payload, 'override')) {
            delete payload.override;
          }
          if (values.payloadFilterRules.length > 0) {
            payload.filter = serializePayloadFilterRulesForYaml(values.payloadFilterRules);
          } else if (hasOwn(payload, 'filter')) {
            delete payload.filter;
          }
          deleteIfEmpty(parsed, 'payload');
        }

        return stringifyYaml(parsed, { indent: 2, lineWidth: 120, minContentWidth: 0 });
      } catch {
        return currentYaml;
      }
    },
    [visualValues]
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
    loadVisualValuesFromYaml,
    applyVisualChangesToYaml,
    setVisualValues,
  };
}

export const VISUAL_CONFIG_PROTOCOL_OPTIONS = [
  { value: '', label: '默认' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'antigravity', label: 'Antigravity' },
] as const;

export const VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS = [
  { value: 'string', label: '字符串' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
  { value: 'json', label: 'JSON' },
] as const satisfies ReadonlyArray<{ value: PayloadParamValueType; label: string }>;
