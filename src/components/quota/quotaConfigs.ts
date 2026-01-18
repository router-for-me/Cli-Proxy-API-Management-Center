/**
 * Quota configuration definitions.
 */

import React from 'react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaGroup,
  AntigravityModelsPayload,
  AntigravityQuotaState,
  AuthFileItem,
  CodexQuotaState,
  CodexUsageWindow,
  CodexQuotaWindow,
  CodexUsagePayload,
  GeminiCliParsedBucket,
  GeminiCliQuotaBucketState,
  GeminiCliQuotaState,
  GithubCopilotQuotaState
} from '@/types';
import { apiCallApi, authFilesApi, getApiCallErrorMessage } from '@/services/api';
import {
  ANTIGRAVITY_QUOTA_URLS,
  ANTIGRAVITY_REQUEST_HEADERS,
  CODEX_USAGE_URL,
  CODEX_REQUEST_HEADERS,
  GEMINI_CLI_QUOTA_URL,
  GEMINI_CLI_REQUEST_HEADERS,
  normalizeAuthIndexValue,
  normalizeNumberValue,
  normalizePlanType,
  normalizeQuotaFraction,
  normalizeStringValue,
  parseAntigravityPayload,
  parseCodexUsagePayload,
  parseGeminiCliQuotaPayload,
  resolveCodexChatgptAccountId,
  resolveCodexPlanType,
  resolveGeminiCliProjectId,
  formatCodexResetLabel,
  formatQuotaResetTime,
  buildAntigravityQuotaGroups,
  buildGeminiCliQuotaBuckets,
  createStatusError,
  getStatusFromError,
  isAntigravityFile,
  isCodexFile,
  isGeminiCliFile,
  isGithubCopilotFile,
  isRuntimeOnlyAuthFile,
  GITHUB_COPILOT_TOKEN_URL,
  GITHUB_COPILOT_USER_URL,
  GITHUB_COPILOT_REQUEST_HEADERS
} from '@/utils/quota';
import type { QuotaRenderHelpers } from './QuotaCard';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaType = 'antigravity' | 'codex' | 'gemini-cli' | 'github-copilot';

const DEFAULT_ANTIGRAVITY_PROJECT_ID = 'bamboo-precept-lgxtn';

export interface QuotaStore {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  geminiCliQuota: Record<string, GeminiCliQuotaState>;
  githubCopilotQuota: Record<string, GithubCopilotQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setGeminiCliQuota: (updater: QuotaUpdater<Record<string, GeminiCliQuotaState>>) => void;
  setGithubCopilotQuota: (updater: QuotaUpdater<Record<string, GithubCopilotQuotaState>>) => void;
  clearQuotaCache: () => void;
}

export interface QuotaConfig<TState, TData> {
  type: QuotaType;
  i18nPrefix: string;
  filterFn: (file: AuthFileItem) => boolean;
  fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<TData>;
  storeSelector: (state: QuotaStore) => Record<string, TState>;
  storeSetter: keyof QuotaStore;
  buildLoadingState: () => TState;
  buildSuccessState: (data: TData) => TState;
  buildErrorState: (message: string, status?: number) => TState;
  cardClassName: string;
  controlsClassName: string;
  controlClassName: string;
  gridClassName: string;
  renderQuotaItems: (quota: TState, t: TFunction, helpers: QuotaRenderHelpers) => ReactNode;
}

const resolveAntigravityProjectId = async (file: AuthFileItem): Promise<string> => {
  try {
    const text = await authFilesApi.downloadText(file.name);
    const trimmed = text.trim();
    if (!trimmed) return DEFAULT_ANTIGRAVITY_PROJECT_ID;

    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const topLevel = normalizeStringValue(parsed.project_id ?? parsed.projectId);
    if (topLevel) return topLevel;

    const installed =
      parsed.installed && typeof parsed.installed === 'object' && parsed.installed !== null
        ? (parsed.installed as Record<string, unknown>)
        : null;
    const installedProjectId = installed
      ? normalizeStringValue(installed.project_id ?? installed.projectId)
      : null;
    if (installedProjectId) return installedProjectId;

    const web =
      parsed.web && typeof parsed.web === 'object' && parsed.web !== null
        ? (parsed.web as Record<string, unknown>)
        : null;
    const webProjectId = web ? normalizeStringValue(web.project_id ?? web.projectId) : null;
    if (webProjectId) return webProjectId;
  } catch {
    return DEFAULT_ANTIGRAVITY_PROJECT_ID;
  }

  return DEFAULT_ANTIGRAVITY_PROJECT_ID;
};

const isAntigravityUnknownFieldError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return normalized.includes('unknown name') && normalized.includes('cannot find field');
};

const fetchAntigravityQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<AntigravityQuotaGroup[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndexValue(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('antigravity_quota.missing_auth_index'));
  }

  const projectId = await resolveAntigravityProjectId(file);
  const requestBodies = [JSON.stringify({ projectId }), JSON.stringify({ project: projectId })];

  let lastError = '';
  let lastStatus: number | undefined;
  let priorityStatus: number | undefined;
  let hadSuccess = false;

  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    for (let attempt = 0; attempt < requestBodies.length; attempt++) {
      try {
        const result = await apiCallApi.request({
          authIndex,
          method: 'POST',
          url,
          header: { ...ANTIGRAVITY_REQUEST_HEADERS },
          data: requestBodies[attempt]
        });

        if (result.statusCode < 200 || result.statusCode >= 300) {
          lastError = getApiCallErrorMessage(result);
          lastStatus = result.statusCode;
          if (result.statusCode === 403 || result.statusCode === 404) {
            priorityStatus ??= result.statusCode;
          }
          if (
            result.statusCode === 400 &&
            isAntigravityUnknownFieldError(lastError) &&
            attempt < requestBodies.length - 1
          ) {
            continue;
          }
          break;
        }

        hadSuccess = true;
        const payload = parseAntigravityPayload(result.body ?? result.bodyText);
        const models = payload?.models;
        if (!models || typeof models !== 'object' || Array.isArray(models)) {
          lastError = t('antigravity_quota.empty_models');
          continue;
        }

        const groups = buildAntigravityQuotaGroups(models as AntigravityModelsPayload);
        if (groups.length === 0) {
          lastError = t('antigravity_quota.empty_models');
          continue;
        }

        return groups;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        if (status) {
          lastStatus = status;
          if (status === 403 || status === 404) {
            priorityStatus ??= status;
          }
        }
      }
    }
  }

  if (hadSuccess) {
    return [];
  }

  throw createStatusError(lastError || t('common.unknown_error'), priorityStatus ?? lastStatus);
};

const buildCodexQuotaWindows = (payload: CodexUsagePayload, t: TFunction): CodexQuotaWindow[] => {
  const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
  const codeReviewLimit = payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
  const windows: CodexQuotaWindow[] = [];

  const addWindow = (
    id: string,
    labelKey: string,
    window?: CodexUsageWindow | null,
    limitReached?: boolean,
    allowed?: boolean
  ) => {
    if (!window) return;
    const resetLabel = formatCodexResetLabel(window);
    const usedPercentRaw = normalizeNumberValue(window.used_percent ?? window.usedPercent);
    const isLimitReached = Boolean(limitReached) || allowed === false;
    const usedPercent = usedPercentRaw ?? (isLimitReached && resetLabel !== '-' ? 100 : null);
    windows.push({
      id,
      label: t(labelKey),
      labelKey,
      usedPercent,
      resetLabel
    });
  };

  addWindow(
    'primary',
    'codex_quota.primary_window',
    rateLimit?.primary_window ?? rateLimit?.primaryWindow,
    rateLimit?.limit_reached ?? rateLimit?.limitReached,
    rateLimit?.allowed
  );
  addWindow(
    'secondary',
    'codex_quota.secondary_window',
    rateLimit?.secondary_window ?? rateLimit?.secondaryWindow,
    rateLimit?.limit_reached ?? rateLimit?.limitReached,
    rateLimit?.allowed
  );
  addWindow(
    'code-review',
    'codex_quota.code_review_window',
    codeReviewLimit?.primary_window ?? codeReviewLimit?.primaryWindow,
    codeReviewLimit?.limit_reached ?? codeReviewLimit?.limitReached,
    codeReviewLimit?.allowed
  );

  return windows;
};

const fetchCodexQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<{ planType: string | null; windows: CodexQuotaWindow[] }> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndexValue(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codex_quota.missing_auth_index'));
  }

  const planTypeFromFile = resolveCodexPlanType(file);
  const accountId = resolveCodexChatgptAccountId(file);
  if (!accountId) {
    throw new Error(t('codex_quota.missing_account_id'));
  }

  const requestHeader: Record<string, string> = {
    ...CODEX_REQUEST_HEADERS,
    'Chatgpt-Account-Id': accountId
  };

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: CODEX_USAGE_URL,
    header: requestHeader
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseCodexUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('codex_quota.empty_windows'));
  }

  const planTypeFromUsage = normalizePlanType(payload.plan_type ?? payload.planType);
  const windows = buildCodexQuotaWindows(payload, t);
  return { planType: planTypeFromUsage ?? planTypeFromFile, windows };
};

const fetchGeminiCliQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<GeminiCliQuotaBucketState[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndexValue(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('gemini_cli_quota.missing_auth_index'));
  }

  const projectId = resolveGeminiCliProjectId(file);
  if (!projectId) {
    throw new Error(t('gemini_cli_quota.missing_project_id'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url: GEMINI_CLI_QUOTA_URL,
    header: { ...GEMINI_CLI_REQUEST_HEADERS },
    data: JSON.stringify({ project: projectId })
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseGeminiCliQuotaPayload(result.body ?? result.bodyText);
  const buckets = Array.isArray(payload?.buckets) ? payload?.buckets : [];
  if (buckets.length === 0) return [];

  const parsedBuckets = buckets
    .map((bucket) => {
      const modelId = normalizeStringValue(bucket.modelId ?? bucket.model_id);
      if (!modelId) return null;
      const tokenType = normalizeStringValue(bucket.tokenType ?? bucket.token_type);
      const remainingFractionRaw = normalizeQuotaFraction(
        bucket.remainingFraction ?? bucket.remaining_fraction
      );
      const remainingAmount = normalizeNumberValue(bucket.remainingAmount ?? bucket.remaining_amount);
      const resetTime = normalizeStringValue(bucket.resetTime ?? bucket.reset_time) ?? undefined;
      let fallbackFraction: number | null = null;
      if (remainingAmount !== null) {
        fallbackFraction = remainingAmount <= 0 ? 0 : null;
      } else if (resetTime) {
        fallbackFraction = 0;
      }
      const remainingFraction = remainingFractionRaw ?? fallbackFraction;
      return {
        modelId,
        tokenType,
        remainingFraction,
        remainingAmount,
        resetTime
      };
    })
    .filter((bucket): bucket is GeminiCliParsedBucket => bucket !== null);

  return buildGeminiCliQuotaBuckets(parsedBuckets);
};

const fetchGithubCopilotQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<GithubCopilotQuotaState> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndexValue(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('github_copilot_quota.missing_auth_index'));
  }

  // 1. Fetch Token (verify auth & get expiry)
  const tokenResult = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: GITHUB_COPILOT_TOKEN_URL,
    header: GITHUB_COPILOT_REQUEST_HEADERS
  });

  if (tokenResult.statusCode < 200 || tokenResult.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(tokenResult), tokenResult.statusCode);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tokenData: any = tokenResult.body;
  if (typeof tokenData === 'string') {
    try {
      tokenData = JSON.parse(tokenData);
    } catch {
      throw new Error(t('common.unknown_error'));
    }
  }

  if (!tokenData || typeof tokenData !== 'object') {
    throw new Error(t('common.unknown_error'));
  }

  // 2. Fetch User Usage (optional, for quota details)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snapshots: any;
  try {
    const userResult = await apiCallApi.request({
      authIndex,
      method: 'GET',
      url: GITHUB_COPILOT_USER_URL,
      header: GITHUB_COPILOT_REQUEST_HEADERS
    });

    if (userResult.statusCode === 200) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let userData: any = userResult.body;
      if (typeof userData === 'string') {
        try {
          userData = JSON.parse(userData);
        } catch {
          // ignore parsing error for optional data
        }
      }
      if (userData && typeof userData === 'object') {
        snapshots = userData.quota_snapshots;
      }
    }
  } catch {
    // Ignore usage fetch errors
  }

  return {
    status: 'success',
    user: tokenData.user,
    expiresAt: tokenData.expires_at ? new Date(tokenData.expires_at * 1000).toISOString() : undefined,
    sku: tokenData.sku,
    snapshots
  };
};

const renderAntigravityItems = (
  quota: AntigravityQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h } = React;
  const groups = quota.groups ?? [];

  if (groups.length === 0) {
    return h('div', { className: styleMap.quotaMessage }, t('antigravity_quota.empty_models'));
  }

  return groups.map((group) => {
    const clamped = Math.max(0, Math.min(1, group.remainingFraction));
    const percent = Math.round(clamped * 100);
    const resetLabel = formatQuotaResetTime(group.resetTime);

    return h(
      'div',
      { key: group.id, className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h(
          'span',
          { className: styleMap.quotaModel, title: group.models.join(', ') },
          group.label
        ),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, `${percent}%`),
          h('span', { className: styleMap.quotaReset }, resetLabel)
        )
      ),
      h(QuotaProgressBar, { percent, highThreshold: 60, mediumThreshold: 20 })
    );
  });
};

const renderCodexItems = (
  quota: CodexQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const windows = quota.windows ?? [];
  const planType = quota.planType ?? null;

  const getPlanLabel = (pt?: string | null): string | null => {
    const normalized = normalizePlanType(pt);
    if (!normalized) return null;
    if (normalized === 'plus') return t('codex_quota.plan_plus');
    if (normalized === 'team') return t('codex_quota.plan_team');
    if (normalized === 'free') return t('codex_quota.plan_free');
    return pt || normalized;
  };

  const planLabel = getPlanLabel(planType);
  const isFreePlan = normalizePlanType(planType) === 'free';
  const nodes: ReactNode[] = [];

  if (planLabel) {
    nodes.push(
      h(
        'div',
        { key: 'plan', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('codex_quota.plan_label')),
        h('span', { className: styleMap.codexPlanValue }, planLabel)
      )
    );
  }

  if (isFreePlan) {
    nodes.push(
      h(
        'div',
        { key: 'warning', className: styleMap.quotaWarning },
        t('codex_quota.no_access')
      )
    );
    return h(Fragment, null, ...nodes);
  }

  if (windows.length === 0) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('codex_quota.empty_windows'))
    );
    return h(Fragment, null, ...nodes);
  }

  nodes.push(
    ...windows.map((window) => {
      const used = window.usedPercent;
      const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
      const remaining = clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
      const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
      const windowLabel = window.labelKey ? t(window.labelKey) : window.label;

      return h(
        'div',
        { key: window.id, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel }, windowLabel),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h('span', { className: styleMap.quotaPercent }, percentLabel),
            h('span', { className: styleMap.quotaReset }, window.resetLabel)
          )
        ),
        h(QuotaProgressBar, { percent: remaining, highThreshold: 80, mediumThreshold: 50 })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

const renderGeminiCliItems = (
  quota: GeminiCliQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h } = React;
  const buckets = quota.buckets ?? [];

  if (buckets.length === 0) {
    return h('div', { className: styleMap.quotaMessage }, t('gemini_cli_quota.empty_buckets'));
  }

  return buckets.map((bucket) => {
    const fraction = bucket.remainingFraction;
    const clamped = fraction === null ? null : Math.max(0, Math.min(1, fraction));
    const percent = clamped === null ? null : Math.round(clamped * 100);
    const percentLabel = percent === null ? '--' : `${percent}%`;
    const remainingAmountLabel =
      bucket.remainingAmount === null || bucket.remainingAmount === undefined
        ? null
        : t('gemini_cli_quota.remaining_amount', {
            count: bucket.remainingAmount
          });
    const titleBase =
      bucket.modelIds && bucket.modelIds.length > 0 ? bucket.modelIds.join(', ') : bucket.label;
    const title = bucket.tokenType ? `${titleBase} (${bucket.tokenType})` : titleBase;

    const resetLabel = formatQuotaResetTime(bucket.resetTime);

    return h(
      'div',
      { key: bucket.id, className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h('span', { className: styleMap.quotaModel, title }, bucket.label),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, percentLabel),
          remainingAmountLabel
            ? h('span', { className: styleMap.quotaAmount }, remainingAmountLabel)
            : null,
          h('span', { className: styleMap.quotaReset }, resetLabel)
        )
      ),
      h(QuotaProgressBar, { percent, highThreshold: 60, mediumThreshold: 20 })
    );
  });
};

const renderGithubCopilotItems = (
  quota: GithubCopilotQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap } = helpers;
  const { createElement: h } = React;

  if (quota.status === 'error') {
     return h('div', { className: styleMap.quotaMessage }, quota.error);
  }

  // We don't really have quota info for GitHub Copilot, just subscription status
  // So we display a simple status message based on whether we successfully fetched the token
  
  const statusLabel = t('github_copilot_quota.access_granted');
  const expiresLabel = quota.expiresAt ? t('github_copilot_quota.expires_at', { time: new Date(quota.expiresAt).toLocaleString() }) : '';
  const skuLabel = quota.sku ? t('github_copilot_quota.plan_label', { sku: quota.sku }) : '';

  return h(
    'div',
    { className: styleMap.quotaRow },
    h(
        'div',
        { className: styleMap.quotaRowHeader },
        h('span', { className: styleMap.quotaModel }, statusLabel),
        h(
          'div',
          { className: styleMap.quotaMeta },
           skuLabel ? h('span', { className: styleMap.quotaAmount, style: { marginRight: '8px' } }, skuLabel) : null,
           h('span', { className: styleMap.quotaReset }, expiresLabel)
        )
    ),
    // Render usage bars if snapshots exist
    quota.snapshots ? (
      h(React.Fragment, null, 
        ['chat', 'completions', 'premium_interactions'].map(key => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const detail = (quota.snapshots as any)[key];
          if (!detail) return null;
          
          const labelRaw = key === 'premium_interactions' ? 'Premium' : key;
          const label = labelRaw.charAt(0).toUpperCase() + labelRaw.slice(1);

          if (detail.unlimited) {
             return h('div', { key, className: styleMap.quotaSubRow, style: { marginTop: 8 } },
                h('div', { className: styleMap.quotaRowHeader, style: { fontSize: '0.9em', marginBottom: 2 } },
                  h('span', { className: styleMap.quotaModel }, label),
                  h('span', { className: styleMap.quotaPercent }, "Unlimited")
                ),
                h('div', { className: styleMap.quotaBar },
                  h('div', {
                    className: `${styleMap.quotaBarFill} ${styleMap.quotaBarFillHigh}`,
                    style: { width: '100%' }
                  })
                )
             );
          }
          
          const percentRemaining = detail.percent_remaining !== undefined 
            ? Math.round(detail.percent_remaining)
            : 0;
          const percentUsed = 100 - percentRemaining;
          
          let fillClass = styleMap.quotaBarFillHigh;
          if (percentUsed >= 80) fillClass = styleMap.quotaBarFillLow;
          else if (percentUsed >= 50) fillClass = styleMap.quotaBarFillMedium;
            
          return h('div', { key, className: styleMap.quotaSubRow, style: { marginTop: 8 } },
            h('div', { className: styleMap.quotaRowHeader, style: { fontSize: '0.9em', marginBottom: 2 } },
              h('span', { className: styleMap.quotaModel }, label),
              h('span', { className: styleMap.quotaPercent }, `${percentUsed}% Used`)
            ),
            h('div', { className: styleMap.quotaBar },
              h('div', {
                className: `${styleMap.quotaBarFill} ${fillClass}`,
                style: { width: `${percentUsed}%` }
              })
            )
          );
        })
      )
    ) : (
      // Dummy progress bar full to indicate active if no snapshots
      h('div', { className: styleMap.quotaProgressBar }, 
          h('div', { className: styleMap.quotaProgressFill, style: { width: '100%', backgroundColor: '#4caf50' } })
      )
    )
  );
};

export const ANTIGRAVITY_CONFIG: QuotaConfig<AntigravityQuotaState, AntigravityQuotaGroup[]> = {
  type: 'antigravity',
  i18nPrefix: 'antigravity_quota',
  filterFn: (file) => isAntigravityFile(file),
  fetchQuota: fetchAntigravityQuota,
  storeSelector: (state) => state.antigravityQuota,
  storeSetter: 'setAntigravityQuota',
  buildLoadingState: () => ({ status: 'loading', groups: [] }),
  buildSuccessState: (groups) => ({ status: 'success', groups }),
  buildErrorState: (message, status) => ({
    status: 'error',
    groups: [],
    error: message,
    errorStatus: status
  }),
  cardClassName: styles.antigravityCard,
  controlsClassName: styles.antigravityControls,
  controlClassName: styles.antigravityControl,
  gridClassName: styles.antigravityGrid,
  renderQuotaItems: renderAntigravityItems
};

export const CODEX_CONFIG: QuotaConfig<
  CodexQuotaState,
  { planType: string | null; windows: CodexQuotaWindow[] }
> = {
  type: 'codex',
  i18nPrefix: 'codex_quota',
  filterFn: (file) => isCodexFile(file),
  fetchQuota: fetchCodexQuota,
  storeSelector: (state) => state.codexQuota,
  storeSetter: 'setCodexQuota',
  buildLoadingState: () => ({ status: 'loading', windows: [] }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    planType: data.planType
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    error: message,
    errorStatus: status
  }),
  cardClassName: styles.codexCard,
  controlsClassName: styles.codexControls,
  controlClassName: styles.codexControl,
  gridClassName: styles.codexGrid,
  renderQuotaItems: renderCodexItems
};

export const GEMINI_CLI_CONFIG: QuotaConfig<GeminiCliQuotaState, GeminiCliQuotaBucketState[]> = {
  type: 'gemini-cli',
  i18nPrefix: 'gemini_cli_quota',
  filterFn: (file) => isGeminiCliFile(file) && !isRuntimeOnlyAuthFile(file),
  fetchQuota: fetchGeminiCliQuota,
  storeSelector: (state) => state.geminiCliQuota,
  storeSetter: 'setGeminiCliQuota',
  buildLoadingState: () => ({ status: 'loading', buckets: [] }),
  buildSuccessState: (buckets) => ({ status: 'success', buckets }),
  buildErrorState: (message, status) => ({
    status: 'error',
    buckets: [],
    error: message,
    errorStatus: status
  }),
  cardClassName: styles.geminiCliCard,
  controlsClassName: styles.geminiCliControls,
  controlClassName: styles.geminiCliControl,
  gridClassName: styles.geminiCliGrid,
  renderQuotaItems: renderGeminiCliItems
};

export const GITHUB_COPILOT_CONFIG: QuotaConfig<GithubCopilotQuotaState, GithubCopilotQuotaState> = {
  type: 'github-copilot',
  i18nPrefix: 'github_copilot_quota',
  filterFn: (file) => isGithubCopilotFile(file),
  fetchQuota: fetchGithubCopilotQuota,
  storeSelector: (state) => state.githubCopilotQuota,
  storeSetter: 'setGithubCopilotQuota',
  buildLoadingState: () => ({ status: 'loading' }),
  buildSuccessState: (state) => state,
  buildErrorState: (message, status) => ({
    status: 'error',
    error: message,
    errorStatus: status
  }),
  cardClassName: styles.githubCopilotCard,
  controlsClassName: styles.githubCopilotControls,
  controlClassName: styles.githubCopilotControl,
  gridClassName: styles.githubCopilotGrid,
  renderQuotaItems: renderGithubCopilotItems
};
