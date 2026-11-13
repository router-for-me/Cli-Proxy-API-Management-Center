/**
 * OpenCode Go subscription quota data layer (React-free / SCSS-free).
 *
 * These legs are config api-key credentials, not auth files, so the quota page
 * cannot list them from /credentials: it synthesises entries from CLIProxyAPI's
 * /quota/opencode report (buildOpenCodeQuotaFiles) and fetchQuota re-reads that
 * report, asking the server to poll the console usage endpoint now.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, OpenCodeQuotaData, OpenCodeQuotaState } from '@/types';
import { opencodeUsageApi, type OpenCodeUsageSubscription } from '@/services/api/opencodeQuota';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores/useQuotaStore';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { parseIsoToMs } from '@/utils/quota';
import { isDisabledAuthFile, isOpenCodeFile } from '@/utils/quota/validators';
import type { QuotaProviderData } from '../types';

/** Display order: shortest window first. Unknown names follow alphabetically. */
const WINDOW_ORDER = ['rolling', 'weekly', 'monthly'];

/** Nominal window lengths in hours for the timeline chart. The endpoint reports resets,
 *  not periods; the rolling window's period is not published upstream, so it never anchors
 *  a lane (a guessed length would draw a bar of the wrong width). */
const WINDOW_PERIOD_HOURS: Record<string, number | null> = {
  rolling: null,
  weekly: 24 * 7,
  monthly: 24 * 30,
};

/** Human label for one subscription: `opencode-go (382cb79f4bf7)`, from the auth id's
 *  trailing segment, which is unique per configured key. */
export function buildOpenCodeDisplayName(subscription: OpenCodeUsageSubscription): string {
  const segments = subscription.auth_id.split(':').filter(Boolean);
  const short = segments.length > 1 ? segments[segments.length - 1] : subscription.auth_id;
  const label = subscription.label?.trim() || 'opencode-go';
  return `${label} (${short})`;
}

/**
 * Quota-page entries for every subscription in a report. Disabled legs are included here
 * and dropped by the provider filter, exactly like disabled auth files.
 */
export function buildOpenCodeQuotaFiles(
  subscriptions: OpenCodeUsageSubscription[]
): AuthFileItem[] {
  return subscriptions.map((subscription) => ({
    name: buildOpenCodeDisplayName(subscription),
    provider: 'opencode',
    type: 'opencode',
    // The auth id doubles as the card's identity: fetchQuota matches the report on it.
    auth_index: subscription.auth_id,
    disabled: subscription.disabled === true,
  }));
}

const sortWindows = <T extends { id: string }>(windows: T[]): T[] =>
  [...windows].sort((a, b) => {
    const orderA = WINDOW_ORDER.indexOf(a.id);
    const orderB = WINDOW_ORDER.indexOf(b.id);
    return (orderA === -1 ? WINDOW_ORDER.length : orderA) - (orderB === -1 ? WINDOW_ORDER.length : orderB) ||
      a.id.localeCompare(b.id);
  });

/** Map one report subscription onto the card's state data. */
export function openCodeQuotaDataFromSubscription(
  subscription: OpenCodeUsageSubscription
): OpenCodeQuotaData {
  const windows = sortWindows(
    (subscription.windows ?? []).map((window) => ({
      id: window.name,
      status: window.status,
      usedPercent: typeof window.percent === 'number' && Number.isFinite(window.percent)
        ? window.percent
        : null,
      resetAtMs: parseIsoToMs(window.resets_at),
      periodHours: WINDOW_PERIOD_HOURS[window.name] ?? null,
    }))
  );
  return {
    state: subscription.state || 'unknown',
    windows,
    fetchedAtMs: parseIsoToMs(subscription.fetched_at),
    lastError: subscription.last_error ?? null,
  };
}

export const emptyOpenCodeQuotaData = (): OpenCodeQuotaData => ({
  state: 'pending',
  windows: [],
  fetchedAtMs: null,
  lastError: null,
});

const fetchOpenCodeQuota = async (file: AuthFileItem, t: TFunction): Promise<OpenCodeQuotaData> => {
  const authId = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  if (!authId) {
    throw new Error(t('opencode_quota.missing_identity'));
  }

  const generation = captureQuotaCacheGeneration(file.name);
  const subscriptions = await opencodeUsageApi.refresh();
  if (!commitIfQuotaCacheCurrent(generation, () => {})) {
    throw new Error(t('opencode_quota.stale_request'));
  }
  const subscription = subscriptions.find((item) => item.auth_id === authId);
  if (!subscription) {
    throw new Error(t('opencode_quota.removed'));
  }
  return openCodeQuotaDataFromSubscription(subscription);
};

export const OPENCODE_CONFIG: QuotaProviderData<OpenCodeQuotaState, OpenCodeQuotaData> = {
  type: 'opencode',
  i18nPrefix: 'opencode_quota',
  filterFn: (file) => isOpenCodeFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchOpenCodeQuota,
  storeSelector: (state) => state.opencodeQuota,
  storeSetter: 'setOpenCodeQuota',
  buildLoadingState: () => ({ status: 'loading', ...emptyOpenCodeQuotaData() }),
  buildSuccessState: (data) => ({ status: 'success', ...data }),
  buildErrorState: (message, status) => ({
    status: 'error',
    ...emptyOpenCodeQuotaData(),
    error: message,
    errorStatus: status,
  }),
};
