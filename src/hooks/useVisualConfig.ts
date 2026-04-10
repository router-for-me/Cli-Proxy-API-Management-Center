import { useCallback, useMemo, useReducer } from 'react';
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

function resolveApiKeysText(parsed: Record<string, unknown>): string {
  if (Object.prototype.hasOwnProperty.call(parsed, 'api-keys')) {
    return parseApiKeysText(parsed['api-keys']);
  }

  const auth = asRecord(parsed.auth);
  const providers = asRecord(auth?.providers);
  const configApiKeyProvider = asRecord(providers?.['config-api-key']);
  if (!configApiKeyProvider) return '';

  if (Object.prototype.hasOwnProperty.call(configApiKeyProvider, 'api-key-entries')) {
    return parseApiKeysText(configApiKeyProvider['api-key-entries']);
  }

  return parseApiKeysText(configApiKeyProvider['api-keys']);
}

type YamlDocument = ReturnType<typeof parseDocument>;
type YamlPath = string[];

function docHas(doc: YamlDocument, path: YamlPath): boolean {
  return doc.hasIn(path);
}

function ensureMapInDoc(doc: YamlDocument, path: YamlPath): void {
  const existing = doc.getIn(path, true);
  if (isMap(existing)) return;
  // Use a YAML node here; plain objects are not treated as collections by subsequent `setIn`.
  doc.setIn(path, doc.createNode({}));
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
    maxRetryCredentials: getNonNegativeIntegerError(values.maxRetryCredentials),
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
  return rules.some(
    (rule) =>
      !rule.disabled &&
      rule.params.some((param) => !param.disabled && Boolean(getPayloadParamValidationError(param)))
  );
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function arePayloadModelEntriesEqual(
  left: PayloadRule['models'],
  right: PayloadRule['models']
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (!a || !b) return false;
    if (a.id !== b.id || a.name !== b.name || a.protocol !== b.protocol) return false;
  }
  return true;
}

function arePayloadParamEntriesEqual(
  left: PayloadRule['params'],
  right: PayloadRule['params']
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (!a || !b) return false;
    if (
      a.id !== b.id ||
      a.path !== b.path ||
      a.valueType !== b.valueType ||
      a.value !== b.value ||
      Boolean(a.disabled) !== Boolean(b.disabled)
    ) {
      return false;
    }
  }
  return true;
}

function arePayloadRulesEqual(left: PayloadRule[], right: PayloadRule[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (!a || !b) return false;
    if (a.id !== b.id || Boolean(a.disabled) !== Boolean(b.disabled)) return false;
    if (!arePayloadModelEntriesEqual(a.models, b.models)) return false;
    if (!arePayloadParamEntriesEqual(a.params, b.params)) return false;
  }
  return true;
}

function arePayloadFilterRulesEqual(
  left: PayloadFilterRule[],
  right: PayloadFilterRule[]
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (!a || !b) return false;
    if (a.id !== b.id || Boolean(a.disabled) !== Boolean(b.disabled)) return false;
    if (!arePayloadModelEntriesEqual(a.models, b.models)) return false;
    if (a.params.length !== b.params.length) return false;
    for (let j = 0; j < a.params.length; j += 1) {
      if (a.params[j] !== b.params[j]) return false;
    }
  }
  return true;
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

function parseRawPayloadParamValue(raw: unknown): string {
  if (typeof raw === 'string') return raw;

  try {
    const json = JSON.stringify(raw, null, 2);
    return json ?? '';
  } catch {
    return String(raw ?? '');
  }
}

function parsePayloadProtocol(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  return raw.trim() ? raw : undefined;
}

function deleteLegacyApiKeysProvider(doc: YamlDocument): void {
  if (docHas(doc, ['auth', 'providers', 'config-api-key', 'api-key-entries'])) {
    doc.deleteIn(['auth', 'providers', 'config-api-key', 'api-key-entries']);
  }
  if (docHas(doc, ['auth', 'providers', 'config-api-key', 'api-keys'])) {
    doc.deleteIn(['auth', 'providers', 'config-api-key', 'api-keys']);
  }
  deleteIfMapEmpty(doc, ['auth', 'providers', 'config-api-key']);
  deleteIfMapEmpty(doc, ['auth', 'providers']);
  deleteIfMapEmpty(doc, ['auth']);
}

function parsePayloadRules(rules: unknown, disabled = false): PayloadRule[] {
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

    return { id: `payload-rule-${index}`, disabled, models, params };
  });
}

function parsePayloadFilterRules(rules: unknown, disabled = false): PayloadFilterRule[] {
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

    return { id: `payload-filter-rule-${index}`, disabled, models, params };
  });
}

function parseRawPayloadRules(rules: unknown, disabled = false): PayloadRule[] {
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
            id: `raw-model-${index}-${modelIndex}`,
            name,
            protocol: parsePayloadProtocol(modelRecord?.protocol),
          };
        })
      : [];

    const paramsRecord = asRecord(record.params);
    const params = paramsRecord
      ? Object.entries(paramsRecord).map(([path, value], pIndex) => ({
          id: `raw-param-${index}-${pIndex}`,
          path,
          valueType: 'json' as const,
          value: parseRawPayloadParamValue(value),
        }))
      : [];

    return { id: `payload-raw-rule-${index}`, disabled, models, params };
  });
}

const PAYLOAD_UI_STATE_ROOT = ['payload', 'ui-state'] as const;

type PayloadUiState = {
  disabledDefaultRules: PayloadRule[];
  disabledDefaultRawRules: PayloadRule[];
  disabledOverrideRules: PayloadRule[];
  disabledOverrideRawRules: PayloadRule[];
  disabledFilterRules: PayloadFilterRule[];
  disabledDefaultParamRules: PayloadRule[];
  disabledDefaultRawParamRules: PayloadRule[];
  disabledOverrideParamRules: PayloadRule[];
  disabledOverrideRawParamRules: PayloadRule[];
};

function splitPayloadRulesByDisabled(rules: PayloadRule[]): {
  enabled: PayloadRule[];
  disabled: PayloadRule[];
} {
  return {
    enabled: rules.filter((rule) => !rule.disabled),
    disabled: rules.filter((rule) => rule.disabled).map((rule) => ({ ...rule, disabled: true })),
  };
}

function splitPayloadFilterRulesByDisabled(rules: PayloadFilterRule[]): {
  enabled: PayloadFilterRule[];
  disabled: PayloadFilterRule[];
} {
  return {
    enabled: rules.filter((rule) => !rule.disabled),
    disabled: rules.filter((rule) => rule.disabled).map((rule) => ({ ...rule, disabled: true })),
  };
}

function parsePayloadUiRules(
  rules: unknown,
  options: { rawJsonValues?: boolean; ruleDisabled?: boolean } = {}
): PayloadRule[] {
  if (!Array.isArray(rules)) return [];

  const { rawJsonValues = false, ruleDisabled = true } = options;

  return rules.map((rule, index) => {
    const record = asRecord(rule) ?? {};

    const modelsRaw = Array.isArray(record.models) ? record.models : [];
    const models = modelsRaw.map((model, modelIndex) => {
      const modelRecord = asRecord(model) ?? {};
      const nameRaw = modelRecord.name ?? modelRecord.id ?? '';
      return {
        id: `ui-model-${index}-${modelIndex}`,
        name: typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? ''),
        protocol: parsePayloadProtocol(modelRecord.protocol),
      };
    });

    const paramsRaw = Array.isArray(record.params) ? record.params : [];
    const params = paramsRaw.map((param, paramIndex) => {
      const paramRecord = asRecord(param) ?? {};
      const pathRaw = paramRecord.path ?? '';
      const valueTypeRaw = paramRecord.valueType;
      const valueType: PayloadParamValueType =
        valueTypeRaw === 'number' ||
        valueTypeRaw === 'boolean' ||
        valueTypeRaw === 'json' ||
        valueTypeRaw === 'string'
          ? valueTypeRaw
          : rawJsonValues
            ? 'json'
            : 'string';
      const valueRaw = paramRecord.value ?? '';
      return {
        id: `ui-param-${index}-${paramIndex}`,
        path: typeof pathRaw === 'string' ? pathRaw : String(pathRaw ?? ''),
        valueType,
        value: typeof valueRaw === 'string' ? valueRaw : String(valueRaw ?? ''),
        disabled: Boolean(paramRecord.disabled),
      };
    });

    return {
      id: `ui-payload-rule-${index}`,
      disabled: ruleDisabled,
      models,
      params,
    };
  });
}

function parsePayloadUiFilterRules(rules: unknown): PayloadFilterRule[] {
  if (!Array.isArray(rules)) return [];

  return rules.map((rule, index) => {
    const record = asRecord(rule) ?? {};
    const modelsRaw = Array.isArray(record.models) ? record.models : [];
    const models = modelsRaw.map((model, modelIndex) => {
      const modelRecord = asRecord(model) ?? {};
      const nameRaw = modelRecord.name ?? modelRecord.id ?? '';
      return {
        id: `ui-filter-model-${index}-${modelIndex}`,
        name: typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? ''),
        protocol: parsePayloadProtocol(modelRecord.protocol),
      };
    });

    const params = Array.isArray(record.params)
      ? record.params.map((param) => (typeof param === 'string' ? param : String(param ?? '')))
      : [];

    return {
      id: `ui-payload-filter-rule-${index}`,
      disabled: true,
      models,
      params,
    };
  });
}

function parsePayloadUiState(payload: Record<string, unknown> | null): PayloadUiState {
  const uiState = asRecord(payload?.['ui-state']);
  return {
    disabledDefaultRules: parsePayloadUiRules(uiState?.['disabled-default']),
    disabledDefaultRawRules: parsePayloadUiRules(uiState?.['disabled-default-raw'], {
      rawJsonValues: true,
    }),
    disabledOverrideRules: parsePayloadUiRules(uiState?.['disabled-override']),
    disabledOverrideRawRules: parsePayloadUiRules(uiState?.['disabled-override-raw'], {
      rawJsonValues: true,
    }),
    disabledFilterRules: parsePayloadUiFilterRules(uiState?.['disabled-filter']),
    disabledDefaultParamRules: parsePayloadUiRules(uiState?.['disabled-default-params'], {
      ruleDisabled: false,
    }),
    disabledDefaultRawParamRules: parsePayloadUiRules(uiState?.['disabled-default-raw-params'], {
      rawJsonValues: true,
      ruleDisabled: false,
    }),
    disabledOverrideParamRules: parsePayloadUiRules(uiState?.['disabled-override-params'], {
      ruleDisabled: false,
    }),
    disabledOverrideRawParamRules: parsePayloadUiRules(uiState?.['disabled-override-raw-params'], {
      rawJsonValues: true,
      ruleDisabled: false,
    }),
  };
}

function getPayloadRuleModelSignature(models: PayloadRule['models']): string {
  return models
    .map((model) => `${model.name.trim()}::${model.protocol ?? ''}`)
    .join('|');
}

function mergePayloadRuleParamsFromUiState(
  enabledRule: PayloadRule,
  uiStateRule: PayloadRule
): PayloadParamEntry[] {
  const enabledParamsQueue = enabledRule.params.map((param) => ({ ...param, disabled: false }));
  const mergedParams: PayloadParamEntry[] = [];

  for (const uiParam of uiStateRule.params) {
    if (uiParam.disabled) {
      mergedParams.push({ ...uiParam, disabled: true });
      continue;
    }

    const nextEnabledParam = enabledParamsQueue.shift();
    if (nextEnabledParam) {
      mergedParams.push({ ...uiParam, ...nextEnabledParam, disabled: false });
    }
  }

  mergedParams.push(...enabledParamsQueue);
  return mergedParams;
}

function mergePayloadRulesWithDisabledParams(
  enabledRules: PayloadRule[],
  uiStateRules: PayloadRule[]
): PayloadRule[] {
  if (uiStateRules.length === 0) {
    return enabledRules.map((rule) => ({
      ...rule,
      disabled: false,
      params: rule.params.map((param) => ({ ...param, disabled: false })),
    }));
  }

  const rulesBySignature = new Map<string, PayloadRule[]>();
  for (const rule of uiStateRules) {
    const signature = getPayloadRuleModelSignature(rule.models);
    const bucket = rulesBySignature.get(signature);
    if (bucket) {
      bucket.push(rule);
    } else {
      rulesBySignature.set(signature, [rule]);
    }
  }

  return enabledRules.map((rule) => {
    const signature = getPayloadRuleModelSignature(rule.models);
    const bucket = rulesBySignature.get(signature);
    const matchedRule = bucket?.shift();

    if (!matchedRule) {
      return {
        ...rule,
        disabled: false,
        params: rule.params.map((param) => ({ ...param, disabled: false })),
      };
    }

    return {
      ...rule,
      disabled: false,
      params: mergePayloadRuleParamsFromUiState(rule, matchedRule),
    };
  });
}

function mergePayloadRules(
  enabledRules: PayloadRule[],
  disabledRules: PayloadRule[]
): PayloadRule[] {
  return [
    ...enabledRules.map((rule) => ({ ...rule, disabled: false })),
    ...disabledRules,
  ];
}

function mergePayloadFilterRules(
  enabledRules: PayloadFilterRule[],
  disabledRules: PayloadFilterRule[]
): PayloadFilterRule[] {
  return [
    ...enabledRules.map((rule) => ({ ...rule, disabled: false })),
    ...disabledRules,
  ];
}

function serializePayloadUiRules(rules: PayloadRule[]): Array<Record<string, unknown>> {
  return rules
    .map((rule) => {
      const models = rule.models
        .filter((model) => model.name.trim())
        .map((model) => {
          const nextModel: Record<string, unknown> = { name: model.name.trim() };
          if (model.protocol) nextModel.protocol = model.protocol;
          return nextModel;
        });

      const params = rule.params
        .filter((param) => param.path.trim())
        .map((param) => ({
          path: param.path.trim(),
          valueType: param.valueType,
          value: param.value,
          ...(param.disabled ? { disabled: true } : {}),
        }));

      return { models, params };
    })
    .filter((rule) => rule.models.length > 0);
}

function serializePayloadUiFilterRules(rules: PayloadFilterRule[]): Array<Record<string, unknown>> {
  return rules
    .map((rule) => {
      const models = rule.models
        .filter((model) => model.name.trim())
        .map((model) => {
          const nextModel: Record<string, unknown> = { name: model.name.trim() };
          if (model.protocol) nextModel.protocol = model.protocol;
          return nextModel;
        });

      const params = rule.params.map((param) => String(param).trim()).filter(Boolean);

      return { models, params };
    })
    .filter((rule) => rule.models.length > 0);
}

function splitPayloadRulesByDisabledParams(rules: PayloadRule[]): {
  enabled: PayloadRule[];
  disabledInUiState: PayloadRule[];
} {
  return {
    enabled: rules.map((rule) => ({
      ...rule,
      disabled: false,
      params: rule.params
        .filter((param) => !param.disabled)
        .map((param) => ({ ...param, disabled: false })),
    })),
    disabledInUiState: rules
      .filter((rule) => rule.params.some((param) => param.disabled))
      .map((rule) => ({
        ...rule,
        disabled: false,
        params: rule.params.map((param) => ({ ...param, disabled: Boolean(param.disabled) })),
      })),
  };
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
        if (!param.path?.trim() || param.disabled) continue;
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

function serializeRawPayloadRulesForYaml(rules: PayloadRule[]): Array<Record<string, unknown>> {
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
        if (!param.path?.trim() || param.disabled) continue;
        params[param.path.trim()] = param.value;
      }

      return { models, params };
    })
    .filter((rule) => rule.models.length > 0);
}

type VisualConfigState = {
  visualValues: VisualConfigValues;
  baselineValues: VisualConfigValues;
  dirtyFields: Set<string>;
  visualParseError: string | null;
};

type VisualConfigAction =
  | {
      type: 'load_success';
      values: VisualConfigValues;
    }
  | {
      type: 'load_error';
      error: string;
    }
  | {
      type: 'set_values';
      values: Partial<VisualConfigValues>;
    };

function createInitialVisualConfigState(): VisualConfigState {
  const initialValues = deepClone(DEFAULT_VISUAL_VALUES);
  return {
    visualValues: initialValues,
    baselineValues: deepClone(initialValues),
    dirtyFields: new Set(),
    visualParseError: null,
  };
}

function mergeVisualConfigValues(
  currentValues: VisualConfigValues,
  patch: Partial<VisualConfigValues>
): VisualConfigValues {
  const nextValues: VisualConfigValues = { ...currentValues, ...patch } as VisualConfigValues;
  if (patch.streaming) {
    nextValues.streaming = { ...currentValues.streaming, ...patch.streaming };
  }
  return nextValues;
}

function getNextDirtyFields(
  currentDirtyFields: Set<string>,
  patch: Partial<VisualConfigValues>,
  nextValues: VisualConfigValues,
  baselineValues: VisualConfigValues
): Set<string> {
  const nextDirtyFields = new Set(currentDirtyFields);
  const updateDirty = (key: string, isEqual: boolean) => {
    if (isEqual) {
      nextDirtyFields.delete(key);
    } else {
      nextDirtyFields.add(key);
    }
  };

  if (Object.prototype.hasOwnProperty.call(patch, 'host')) {
    updateDirty('host', nextValues.host === baselineValues.host);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'port')) {
    updateDirty('port', nextValues.port === baselineValues.port);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'tlsEnable')) {
    updateDirty('tlsEnable', nextValues.tlsEnable === baselineValues.tlsEnable);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'tlsCert')) {
    updateDirty('tlsCert', nextValues.tlsCert === baselineValues.tlsCert);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'tlsKey')) {
    updateDirty('tlsKey', nextValues.tlsKey === baselineValues.tlsKey);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'rmAllowRemote')) {
    updateDirty('rmAllowRemote', nextValues.rmAllowRemote === baselineValues.rmAllowRemote);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'rmSecretKey')) {
    updateDirty('rmSecretKey', nextValues.rmSecretKey === baselineValues.rmSecretKey);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'rmDisableControlPanel')) {
    updateDirty(
      'rmDisableControlPanel',
      nextValues.rmDisableControlPanel === baselineValues.rmDisableControlPanel
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'rmPanelRepo')) {
    updateDirty('rmPanelRepo', nextValues.rmPanelRepo === baselineValues.rmPanelRepo);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'authDir')) {
    updateDirty('authDir', nextValues.authDir === baselineValues.authDir);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'apiKeysText')) {
    updateDirty('apiKeysText', nextValues.apiKeysText === baselineValues.apiKeysText);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'debug')) {
    updateDirty('debug', nextValues.debug === baselineValues.debug);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'commercialMode')) {
    updateDirty('commercialMode', nextValues.commercialMode === baselineValues.commercialMode);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'loggingToFile')) {
    updateDirty('loggingToFile', nextValues.loggingToFile === baselineValues.loggingToFile);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'logsMaxTotalSizeMb')) {
    updateDirty(
      'logsMaxTotalSizeMb',
      nextValues.logsMaxTotalSizeMb === baselineValues.logsMaxTotalSizeMb
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'usageStatisticsEnabled')) {
    updateDirty(
      'usageStatisticsEnabled',
      nextValues.usageStatisticsEnabled === baselineValues.usageStatisticsEnabled
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'proxyUrl')) {
    updateDirty('proxyUrl', nextValues.proxyUrl === baselineValues.proxyUrl);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'forceModelPrefix')) {
    updateDirty(
      'forceModelPrefix',
      nextValues.forceModelPrefix === baselineValues.forceModelPrefix
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'requestRetry')) {
    updateDirty('requestRetry', nextValues.requestRetry === baselineValues.requestRetry);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'maxRetryCredentials')) {
    updateDirty(
      'maxRetryCredentials',
      nextValues.maxRetryCredentials === baselineValues.maxRetryCredentials
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'maxRetryInterval')) {
    updateDirty(
      'maxRetryInterval',
      nextValues.maxRetryInterval === baselineValues.maxRetryInterval
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'wsAuth')) {
    updateDirty('wsAuth', nextValues.wsAuth === baselineValues.wsAuth);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'quotaSwitchProject')) {
    updateDirty(
      'quotaSwitchProject',
      nextValues.quotaSwitchProject === baselineValues.quotaSwitchProject
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'quotaSwitchPreviewModel')) {
    updateDirty(
      'quotaSwitchPreviewModel',
      nextValues.quotaSwitchPreviewModel === baselineValues.quotaSwitchPreviewModel
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'routingStrategy')) {
    updateDirty('routingStrategy', nextValues.routingStrategy === baselineValues.routingStrategy);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'payloadDefaultRules')) {
    updateDirty(
      'payloadDefaultRules',
      arePayloadRulesEqual(nextValues.payloadDefaultRules, baselineValues.payloadDefaultRules)
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'payloadDefaultRawRules')) {
    updateDirty(
      'payloadDefaultRawRules',
      arePayloadRulesEqual(nextValues.payloadDefaultRawRules, baselineValues.payloadDefaultRawRules)
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'payloadOverrideRules')) {
    updateDirty(
      'payloadOverrideRules',
      arePayloadRulesEqual(nextValues.payloadOverrideRules, baselineValues.payloadOverrideRules)
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'payloadOverrideRawRules')) {
    updateDirty(
      'payloadOverrideRawRules',
      arePayloadRulesEqual(
        nextValues.payloadOverrideRawRules,
        baselineValues.payloadOverrideRawRules
      )
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'payloadFilterRules')) {
    updateDirty(
      'payloadFilterRules',
      arePayloadFilterRulesEqual(nextValues.payloadFilterRules, baselineValues.payloadFilterRules)
    );
  }
  if (patch.streaming) {
    const streamingPatch = patch.streaming;
    if (Object.prototype.hasOwnProperty.call(streamingPatch, 'keepaliveSeconds')) {
      updateDirty(
        'streaming.keepaliveSeconds',
        nextValues.streaming.keepaliveSeconds === baselineValues.streaming.keepaliveSeconds
      );
    }
    if (Object.prototype.hasOwnProperty.call(streamingPatch, 'bootstrapRetries')) {
      updateDirty(
        'streaming.bootstrapRetries',
        nextValues.streaming.bootstrapRetries === baselineValues.streaming.bootstrapRetries
      );
    }
    if (Object.prototype.hasOwnProperty.call(streamingPatch, 'nonstreamKeepaliveInterval')) {
      updateDirty(
        'streaming.nonstreamKeepaliveInterval',
        nextValues.streaming.nonstreamKeepaliveInterval ===
          baselineValues.streaming.nonstreamKeepaliveInterval
      );
    }
  }

  return nextDirtyFields;
}

function visualConfigReducer(
  state: VisualConfigState,
  action: VisualConfigAction
): VisualConfigState {
  switch (action.type) {
    case 'load_success':
      return {
        visualValues: action.values,
        baselineValues: deepClone(action.values),
        dirtyFields: new Set(),
        visualParseError: null,
      };
    case 'load_error':
      return {
        ...state,
        visualParseError: action.error,
      };
    case 'set_values': {
      const nextValues = mergeVisualConfigValues(state.visualValues, action.values);
      const nextDirtyFields = getNextDirtyFields(
        state.dirtyFields,
        action.values,
        nextValues,
        state.baselineValues
      );

      return {
        ...state,
        visualValues: nextValues,
        dirtyFields: nextDirtyFields,
      };
    }
    default:
      return state;
  }
}

export function useVisualConfig() {
  const [state, dispatch] = useReducer(
    visualConfigReducer,
    undefined,
    createInitialVisualConfigState
  );
  const { visualValues, visualParseError } = state;
  const visualDirty = state.dirtyFields.size > 0;
  const visualValidationErrors = useMemo(
    () => getVisualConfigValidationErrors(visualValues),
    [visualValues]
  );
  const visualHasPayloadValidationErrors = useMemo(
    () =>
      hasPayloadParamValidationErrors(visualValues.payloadDefaultRules) ||
      hasPayloadParamValidationErrors(visualValues.payloadDefaultRawRules) ||
      hasPayloadParamValidationErrors(visualValues.payloadOverrideRules) ||
      hasPayloadParamValidationErrors(visualValues.payloadOverrideRawRules),
    [
      visualValues.payloadDefaultRules,
      visualValues.payloadDefaultRawRules,
      visualValues.payloadOverrideRules,
      visualValues.payloadOverrideRawRules,
    ]
  );

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
      const payloadUiState = parsePayloadUiState(payload);
      const streaming = asRecord(parsed.streaming);

      const newValues: VisualConfigValues = {
        host: typeof parsed.host === 'string' ? parsed.host : '',
        port: String(parsed.port ?? ''),

        tlsEnable: Boolean(tls?.enable),
        tlsCert: typeof tls?.cert === 'string' ? tls.cert : '',
        tlsKey: typeof tls?.key === 'string' ? tls.key : '',

        rmAllowRemote: Boolean(remoteManagement?.['allow-remote']),
        rmSecretKey:
          typeof remoteManagement?.['secret-key'] === 'string'
            ? remoteManagement['secret-key']
            : '',
        rmDisableControlPanel: Boolean(remoteManagement?.['disable-control-panel']),
        rmPanelRepo:
          typeof remoteManagement?.['panel-github-repository'] === 'string'
            ? remoteManagement['panel-github-repository']
            : typeof remoteManagement?.['panel-repo'] === 'string'
              ? remoteManagement['panel-repo']
              : '',

        authDir: typeof parsed['auth-dir'] === 'string' ? parsed['auth-dir'] : '',
        apiKeysText: resolveApiKeysText(parsed),

        debug: Boolean(parsed.debug),
        commercialMode: Boolean(parsed['commercial-mode']),
        loggingToFile: Boolean(parsed['logging-to-file']),
        logsMaxTotalSizeMb: String(parsed['logs-max-total-size-mb'] ?? ''),
        usageStatisticsEnabled: Boolean(parsed['usage-statistics-enabled']),

        proxyUrl: typeof parsed['proxy-url'] === 'string' ? parsed['proxy-url'] : '',
        forceModelPrefix: Boolean(parsed['force-model-prefix']),
        requestRetry: String(parsed['request-retry'] ?? ''),
        maxRetryCredentials: String(parsed['max-retry-credentials'] ?? ''),
        maxRetryInterval: String(parsed['max-retry-interval'] ?? ''),
        wsAuth: Boolean(parsed['ws-auth']),

        quotaSwitchProject: Boolean(quotaExceeded?.['switch-project'] ?? true),
        quotaSwitchPreviewModel: Boolean(quotaExceeded?.['switch-preview-model'] ?? true),

        routingStrategy: routing?.strategy === 'fill-first' ? 'fill-first' : 'round-robin',

        payloadDefaultRules: mergePayloadRules(
          mergePayloadRulesWithDisabledParams(
            parsePayloadRules(payload?.default),
            payloadUiState.disabledDefaultParamRules
          ),
          payloadUiState.disabledDefaultRules
        ),
        payloadDefaultRawRules: mergePayloadRules(
          mergePayloadRulesWithDisabledParams(
            parseRawPayloadRules(payload?.['default-raw']),
            payloadUiState.disabledDefaultRawParamRules
          ),
          payloadUiState.disabledDefaultRawRules
        ),
        payloadOverrideRules: mergePayloadRules(
          mergePayloadRulesWithDisabledParams(
            parsePayloadRules(payload?.override),
            payloadUiState.disabledOverrideParamRules
          ),
          payloadUiState.disabledOverrideRules
        ),
        payloadOverrideRawRules: mergePayloadRules(
          mergePayloadRulesWithDisabledParams(
            parseRawPayloadRules(payload?.['override-raw']),
            payloadUiState.disabledOverrideRawParamRules
          ),
          payloadUiState.disabledOverrideRawRules
        ),
        payloadFilterRules: mergePayloadFilterRules(
          parsePayloadFilterRules(payload?.filter),
          payloadUiState.disabledFilterRules
        ),

        streaming: {
          keepaliveSeconds: String(streaming?.['keepalive-seconds'] ?? ''),
          bootstrapRetries: String(streaming?.['bootstrap-retries'] ?? ''),
          nonstreamKeepaliveInterval: String(parsed['nonstream-keepalive-interval'] ?? ''),
        },
      };

      dispatch({ type: 'load_success', values: newValues });
      return { ok: true as const };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid YAML';
      dispatch({ type: 'load_error', error: message });
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
        const apiKeys = values.apiKeysText
          .split('\n')
          .map((key) => key.trim())
          .filter(Boolean);
        if (apiKeys.length > 0) {
          doc.setIn(['api-keys'], apiKeys);
        } else if (docHas(doc, ['api-keys'])) {
          doc.deleteIn(['api-keys']);
        }
        deleteLegacyApiKeysProvider(doc);

        setBooleanInDoc(doc, ['debug'], values.debug);

        setBooleanInDoc(doc, ['commercial-mode'], values.commercialMode);
        setBooleanInDoc(doc, ['logging-to-file'], values.loggingToFile);
        setIntFromStringInDoc(doc, ['logs-max-total-size-mb'], values.logsMaxTotalSizeMb);
        setBooleanInDoc(doc, ['usage-statistics-enabled'], values.usageStatisticsEnabled);

        setStringInDoc(doc, ['proxy-url'], values.proxyUrl);
        setBooleanInDoc(doc, ['force-model-prefix'], values.forceModelPrefix);
        setIntFromStringInDoc(doc, ['request-retry'], values.requestRetry);
        setIntFromStringInDoc(doc, ['max-retry-credentials'], values.maxRetryCredentials);
        setIntFromStringInDoc(doc, ['max-retry-interval'], values.maxRetryInterval);
        setBooleanInDoc(doc, ['ws-auth'], values.wsAuth);

        if (
          docHas(doc, ['quota-exceeded']) ||
          !values.quotaSwitchProject ||
          !values.quotaSwitchPreviewModel
        ) {
          ensureMapInDoc(doc, ['quota-exceeded']);
          doc.setIn(['quota-exceeded', 'switch-project'], values.quotaSwitchProject);
          doc.setIn(['quota-exceeded', 'switch-preview-model'], values.quotaSwitchPreviewModel);
          deleteIfMapEmpty(doc, ['quota-exceeded']);
        }

        if (docHas(doc, ['routing']) || values.routingStrategy !== 'round-robin') {
          ensureMapInDoc(doc, ['routing']);
          doc.setIn(['routing', 'strategy'], values.routingStrategy);
          deleteIfMapEmpty(doc, ['routing']);
        }

        const keepaliveSeconds =
          typeof values.streaming?.keepaliveSeconds === 'string'
            ? values.streaming.keepaliveSeconds
            : '';
        const bootstrapRetries =
          typeof values.streaming?.bootstrapRetries === 'string'
            ? values.streaming.bootstrapRetries
            : '';
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

        setIntFromStringInDoc(doc, ['nonstream-keepalive-interval'], nonstreamKeepaliveInterval);

        const payloadDefaultSplit = splitPayloadRulesByDisabled(values.payloadDefaultRules);
        const payloadDefaultRawSplit = splitPayloadRulesByDisabled(values.payloadDefaultRawRules);
        const payloadOverrideSplit = splitPayloadRulesByDisabled(values.payloadOverrideRules);
        const payloadOverrideRawSplit = splitPayloadRulesByDisabled(values.payloadOverrideRawRules);
        const payloadFilterSplit = splitPayloadFilterRulesByDisabled(values.payloadFilterRules);
        const payloadDefaultParamSplit = splitPayloadRulesByDisabledParams(payloadDefaultSplit.enabled);
        const payloadDefaultRawParamSplit = splitPayloadRulesByDisabledParams(
          payloadDefaultRawSplit.enabled
        );
        const payloadOverrideParamSplit = splitPayloadRulesByDisabledParams(payloadOverrideSplit.enabled);
        const payloadOverrideRawParamSplit = splitPayloadRulesByDisabledParams(
          payloadOverrideRawSplit.enabled
        );
        const hasDisabledPayloadRules =
          payloadDefaultSplit.disabled.length > 0 ||
          payloadDefaultRawSplit.disabled.length > 0 ||
          payloadOverrideSplit.disabled.length > 0 ||
          payloadOverrideRawSplit.disabled.length > 0 ||
          payloadFilterSplit.disabled.length > 0 ||
          payloadDefaultParamSplit.disabledInUiState.length > 0 ||
          payloadDefaultRawParamSplit.disabledInUiState.length > 0 ||
          payloadOverrideParamSplit.disabledInUiState.length > 0 ||
          payloadOverrideRawParamSplit.disabledInUiState.length > 0;

        if (
          docHas(doc, ['payload']) ||
          values.payloadDefaultRules.length > 0 ||
          values.payloadDefaultRawRules.length > 0 ||
          values.payloadOverrideRules.length > 0 ||
          values.payloadOverrideRawRules.length > 0 ||
          values.payloadFilterRules.length > 0
        ) {
          ensureMapInDoc(doc, ['payload']);
          if (payloadDefaultParamSplit.enabled.length > 0) {
            doc.setIn(
              ['payload', 'default'],
              serializePayloadRulesForYaml(payloadDefaultParamSplit.enabled)
            );
          } else if (docHas(doc, ['payload', 'default'])) {
            doc.deleteIn(['payload', 'default']);
          }
          if (payloadDefaultRawParamSplit.enabled.length > 0) {
            doc.setIn(
              ['payload', 'default-raw'],
              serializeRawPayloadRulesForYaml(payloadDefaultRawParamSplit.enabled)
            );
          } else if (docHas(doc, ['payload', 'default-raw'])) {
            doc.deleteIn(['payload', 'default-raw']);
          }
          if (payloadOverrideParamSplit.enabled.length > 0) {
            doc.setIn(
              ['payload', 'override'],
              serializePayloadRulesForYaml(payloadOverrideParamSplit.enabled)
            );
          } else if (docHas(doc, ['payload', 'override'])) {
            doc.deleteIn(['payload', 'override']);
          }
          if (payloadOverrideRawParamSplit.enabled.length > 0) {
            doc.setIn(
              ['payload', 'override-raw'],
              serializeRawPayloadRulesForYaml(payloadOverrideRawParamSplit.enabled)
            );
          } else if (docHas(doc, ['payload', 'override-raw'])) {
            doc.deleteIn(['payload', 'override-raw']);
          }
          if (payloadFilterSplit.enabled.length > 0) {
            doc.setIn(
              ['payload', 'filter'],
              serializePayloadFilterRulesForYaml(payloadFilterSplit.enabled)
            );
          } else if (docHas(doc, ['payload', 'filter'])) {
            doc.deleteIn(['payload', 'filter']);
          }

          if (hasDisabledPayloadRules) {
            ensureMapInDoc(doc, [...PAYLOAD_UI_STATE_ROOT]);
            if (payloadDefaultSplit.disabled.length > 0) {
              doc.setIn(
                [...PAYLOAD_UI_STATE_ROOT, 'disabled-default'],
                serializePayloadUiRules(payloadDefaultSplit.disabled)
              );
            } else if (docHas(doc, [...PAYLOAD_UI_STATE_ROOT, 'disabled-default'])) {
              doc.deleteIn([...PAYLOAD_UI_STATE_ROOT, 'disabled-default']);
            }
            if (payloadDefaultRawSplit.disabled.length > 0) {
              doc.setIn(
                [...PAYLOAD_UI_STATE_ROOT, 'disabled-default-raw'],
                serializePayloadUiRules(payloadDefaultRawSplit.disabled)
              );
            } else if (docHas(doc, [...PAYLOAD_UI_STATE_ROOT, 'disabled-default-raw'])) {
              doc.deleteIn([...PAYLOAD_UI_STATE_ROOT, 'disabled-default-raw']);
            }
            if (payloadOverrideSplit.disabled.length > 0) {
              doc.setIn(
                [...PAYLOAD_UI_STATE_ROOT, 'disabled-override'],
                serializePayloadUiRules(payloadOverrideSplit.disabled)
              );
            } else if (docHas(doc, [...PAYLOAD_UI_STATE_ROOT, 'disabled-override'])) {
              doc.deleteIn([...PAYLOAD_UI_STATE_ROOT, 'disabled-override']);
            }
            if (payloadOverrideRawSplit.disabled.length > 0) {
              doc.setIn(
                [...PAYLOAD_UI_STATE_ROOT, 'disabled-override-raw'],
                serializePayloadUiRules(payloadOverrideRawSplit.disabled)
              );
            } else if (docHas(doc, [...PAYLOAD_UI_STATE_ROOT, 'disabled-override-raw'])) {
              doc.deleteIn([...PAYLOAD_UI_STATE_ROOT, 'disabled-override-raw']);
            }
            if (payloadFilterSplit.disabled.length > 0) {
              doc.setIn(
                [...PAYLOAD_UI_STATE_ROOT, 'disabled-filter'],
                serializePayloadUiFilterRules(payloadFilterSplit.disabled)
              );
            } else if (docHas(doc, [...PAYLOAD_UI_STATE_ROOT, 'disabled-filter'])) {
              doc.deleteIn([...PAYLOAD_UI_STATE_ROOT, 'disabled-filter']);
            }
            if (payloadDefaultParamSplit.disabledInUiState.length > 0) {
              doc.setIn(
                [...PAYLOAD_UI_STATE_ROOT, 'disabled-default-params'],
                serializePayloadUiRules(payloadDefaultParamSplit.disabledInUiState)
              );
            } else if (docHas(doc, [...PAYLOAD_UI_STATE_ROOT, 'disabled-default-params'])) {
              doc.deleteIn([...PAYLOAD_UI_STATE_ROOT, 'disabled-default-params']);
            }
            if (payloadDefaultRawParamSplit.disabledInUiState.length > 0) {
              doc.setIn(
                [...PAYLOAD_UI_STATE_ROOT, 'disabled-default-raw-params'],
                serializePayloadUiRules(payloadDefaultRawParamSplit.disabledInUiState)
              );
            } else if (docHas(doc, [...PAYLOAD_UI_STATE_ROOT, 'disabled-default-raw-params'])) {
              doc.deleteIn([...PAYLOAD_UI_STATE_ROOT, 'disabled-default-raw-params']);
            }
            if (payloadOverrideParamSplit.disabledInUiState.length > 0) {
              doc.setIn(
                [...PAYLOAD_UI_STATE_ROOT, 'disabled-override-params'],
                serializePayloadUiRules(payloadOverrideParamSplit.disabledInUiState)
              );
            } else if (docHas(doc, [...PAYLOAD_UI_STATE_ROOT, 'disabled-override-params'])) {
              doc.deleteIn([...PAYLOAD_UI_STATE_ROOT, 'disabled-override-params']);
            }
            if (payloadOverrideRawParamSplit.disabledInUiState.length > 0) {
              doc.setIn(
                [...PAYLOAD_UI_STATE_ROOT, 'disabled-override-raw-params'],
                serializePayloadUiRules(payloadOverrideRawParamSplit.disabledInUiState)
              );
            } else if (docHas(doc, [...PAYLOAD_UI_STATE_ROOT, 'disabled-override-raw-params'])) {
              doc.deleteIn([...PAYLOAD_UI_STATE_ROOT, 'disabled-override-raw-params']);
            }
            deleteIfMapEmpty(doc, [...PAYLOAD_UI_STATE_ROOT]);
          } else if (docHas(doc, [...PAYLOAD_UI_STATE_ROOT])) {
            doc.deleteIn([...PAYLOAD_UI_STATE_ROOT]);
          }

          deleteIfMapEmpty(doc, ['payload']);
        }

        return doc.toString({ indent: 2, lineWidth: 120, minContentWidth: 0 });
      } catch {
        return currentYaml;
      }
    },
    [visualValues]
  );

  const setVisualValues = useCallback((newValues: Partial<VisualConfigValues>) => {
    dispatch({ type: 'set_values', values: newValues });
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
