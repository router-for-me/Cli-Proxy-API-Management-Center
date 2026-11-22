import type { ProviderKeyConfig } from '@/types';
import { isRecord } from '@/utils/helpers';
import type { NativeProviderFamily } from '@/services/api/providers';
import { normalizeConnectionPool } from '@/services/api/connectionPool';
import { buildNativeGroupSettings, readNativeGroupSettings } from './nativeGroupSettings';
import type { ProviderEntryFormInput, ProviderResource } from './types';

export interface NativeConnectionFormOutput {
  group: Record<string, unknown>;
  /** Group-wide on/off switch; omitted when the user did not touch it. */
  allDisabled?: boolean;
  keys: Array<{
    resource: ProviderResource | null;
    input: ProviderEntryFormInput;
    unchanged?: boolean;
    initialInput?: ProviderEntryFormInput;
    /** Per-key on/off switch; omitted when the user did not touch it. */
    disabled?: boolean;
  }>;
}

/** Probes must follow the chosen credential's overrides, including an explicit direct proxy. */
export function memberProbeSettings(
  shared: ProviderEntryFormInput,
  row?: {
    resource: ProviderResource | null;
    initial: ProviderEntryFormInput;
    input: ProviderEntryFormInput;
  }
) {
  if (!row) return { probeProxyUrl: shared.proxyUrl, probeHeaders: shared.headers };
  const source = (row.resource?.raw as ProviderKeyConfig | undefined)?.source;
  const keys = source?.group.keys;
  const original =
    Array.isArray(keys) && source?.keyIndex !== undefined ? keys[source.keyIndex] : undefined;
  const raw = isRecord(original) ? original : {};
  const proxyOverride = row.input.proxyUrl !== row.initial.proxyUrl || raw['proxy-url'] != null;
  const headersOverride = row.input.headers !== row.initial.headers || raw.headers != null;
  return {
    probeProxyUrl: proxyOverride ? row.input.proxyUrl || shared.proxyUrl : shared.proxyUrl,
    probeHeaders:
      headersOverride && row.input.headers.some((h) => h.key.trim())
        ? row.input.headers
        : shared.headers,
  };
}

export function readSharedForm(
  group: Record<string, unknown>,
  defaults: ProviderEntryFormInput
): ProviderEntryFormInput {
  const shared = readNativeGroupSettings(group);
  return {
    ...defaults,
    name: shared.name,
    baseUrl: shared.baseUrl,
    prefix: shared.prefix,
    proxyUrl: shared.proxyUrl,
    priority: shared.priority ? Number(shared.priority) : undefined,
    headers: Object.entries(group.headers ?? {}).map(([key, value]) => ({
      key,
      value: String(value),
    })),
    models: shared.models,
    runtimePolicy: shared.policy,
    connectionPool: normalizeConnectionPool(group['connection-pool']),
    disabled: shared.excludedModels.split('\n').includes('*'),
    excludedModelsText: shared.excludedModels
      .split('\n')
      .filter((rule) => rule !== '*')
      .join('\n'),
  };
}

/** Only project controls the user changed; untouched raw defaults can contain future metadata. */
export function buildSharedSettings(
  family: NativeProviderFamily,
  group: Record<string, unknown>,
  initial: ProviderEntryFormInput,
  form: ProviderEntryFormInput
) {
  const draft = readNativeGroupSettings(group);
  for (const field of ['name', 'baseUrl', 'prefix', 'proxyUrl'] as const)
    draft[field] = form[field];
  if (form.priority !== initial.priority) draft.priority = String(form.priority ?? '');
  if (form.headers !== initial.headers)
    draft.headers = JSON.stringify(
      Object.fromEntries(
        form.headers
          .filter((entry) => entry.key.trim())
          .map((entry) => [entry.key.trim(), entry.value])
      )
    );
  if (form.models !== initial.models)
    draft.models = form.models.filter((entry) => entry.name.trim() || entry.alias?.trim());
  if (form.disabled !== initial.disabled || form.excludedModelsText !== initial.excludedModelsText)
    draft.excludedModels = [form.excludedModelsText, form.disabled ? '*' : '']
      .filter(Boolean)
      .join('\n');
  if (form.runtimePolicy) draft.policy = form.runtimePolicy;
  if (form.connectionPool !== initial.connectionPool) {
    const pool = form.connectionPool;
    draft.poolPresent = !!pool;
    draft.poolEnabled = String(pool?.enabled ?? '');
    draft.poolTimeout = pool?.idleConnTimeout ?? '';
    draft.poolLimit = String(pool?.maxIdleConnsPerHost ?? '');
  }
  return buildNativeGroupSettings(group, draft, family);
}
