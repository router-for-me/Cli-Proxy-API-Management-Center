// Panel-specific quota configs for openai-compatibility entries.
// These are intentionally lightweight: they bypass the global QuotaStore
// (which is keyed by AuthFileItem.name) since the AI Providers panel holds
// per-(provider, entry) state locally — there is no auth-file name to key on.
//
// For ollama/deepseek we re-export the existing QuotaConfig from @/components/quota
// so the renderQuotaItems / buildSuccessState logic stays single-sourced.

import React from 'react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type { QuotaRenderHelpers } from '@/components/quota/QuotaCard';
import { OLLAMA_CONFIG, DEEPSEEK_CONFIG } from '@/components/quota';
import type {
  AnyrouterBalancePayload,
  AnyrouterQuotaState,
  XiaomiBalancePayload,
  XiaomiQuotaState,
} from '@/types';

const QUOTA_PROGRESS_HIGH_THRESHOLD = 50;
const QUOTA_PROGRESS_MEDIUM_THRESHOLD = 20;

const toFiniteOrNull = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
};

const toTrimmedOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export interface OpenAICompatPanelConfig<TState, TData> {
  i18nPrefix: string;
  buildSuccessState: (data: TData) => TState;
  renderQuotaItems: (quota: TState, t: TFunction, helpers: QuotaRenderHelpers) => ReactNode;
}

// -----------------------------------------------------------------------------
// Xiaomi (platform.xiaomimimo.com)
// -----------------------------------------------------------------------------

const xiaomiStateFromPayload = (payload: XiaomiBalancePayload): XiaomiQuotaState => ({
  status: 'success',
  monthUsed: toFiniteOrNull(payload?.month_used),
  monthLimit: toFiniteOrNull(payload?.month_limit),
  monthPercent: toFiniteOrNull(payload?.month_percent),
  planUsed: toFiniteOrNull(payload?.plan_used),
  planLimit: toFiniteOrNull(payload?.plan_limit),
  planPercent: toFiniteOrNull(payload?.plan_percent),
  compensationUsed: toFiniteOrNull(payload?.compensation_used),
  compensationLimit: toFiniteOrNull(payload?.compensation_limit),
  source: toTrimmedOrNull(payload?.source),
  fetchedAt: toTrimmedOrNull(payload?.fetched_at),
});

export const formatTokenCount = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return String(Math.round(value));
};

const renderXiaomiItems = (
  quota: XiaomiQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const nodes: ReactNode[] = [];

  type Row = {
    id: string;
    labelKey: string;
    used: number | null;
    limit: number | null;
    percent: number | null;
  };
  const rows: Row[] = [
    {
      id: 'month',
      labelKey: 'xiaomi_quota.month_label',
      used: quota.monthUsed,
      limit: quota.monthLimit,
      percent: quota.monthPercent,
    },
    {
      id: 'plan',
      labelKey: 'xiaomi_quota.plan_label',
      used: quota.planUsed,
      limit: quota.planLimit,
      percent: quota.planPercent,
    },
  ];
  if ((quota.compensationLimit ?? 0) > 0 || (quota.compensationUsed ?? 0) > 0) {
    rows.push({
      id: 'compensation',
      labelKey: 'xiaomi_quota.compensation_label',
      used: quota.compensationUsed,
      limit: quota.compensationLimit,
      percent: null,
    });
  }

  const hasAny = rows.some((row) => row.used !== null || row.limit !== null);
  if (!hasAny) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('xiaomi_quota.empty'))
    );
    return h(Fragment, null, ...nodes);
  }

  rows.forEach((row) => {
    const used = row.used ?? 0;
    const limit = row.limit ?? 0;
    const remainingPct =
      limit > 0
        ? Math.max(0, Math.min(100, ((limit - used) / limit) * 100))
        : null;
    const percentLabel =
      remainingPct === null ? '--' : `${Math.round(remainingPct)}%`;

    nodes.push(
      h(
        'div',
        { key: row.id, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel }, t(row.labelKey)),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h('span', { className: styleMap.quotaPercent }, percentLabel),
            h(
              'span',
              { className: styleMap.quotaAmount },
              `${formatTokenCount(used)} / ${formatTokenCount(limit)}`
            )
          )
        ),
        h(QuotaProgressBar, {
          percent: remainingPct,
          highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
          mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
        })
      )
    );
  });

  return h(Fragment, null, ...nodes);
};

export const XIAOMI_PANEL_CONFIG: OpenAICompatPanelConfig<
  XiaomiQuotaState,
  XiaomiBalancePayload
> = {
  i18nPrefix: 'xiaomi_quota',
  buildSuccessState: (payload) => xiaomiStateFromPayload(payload),
  renderQuotaItems: renderXiaomiItems,
};

// -----------------------------------------------------------------------------
// Anyrouter (anyrouter.top)
// -----------------------------------------------------------------------------

const anyrouterStateFromPayload = (payload: AnyrouterBalancePayload): AnyrouterQuotaState => ({
  status: 'success',
  userId: toFiniteOrNull(payload?.user_id),
  username: toTrimmedOrNull(payload?.username),
  displayName: toTrimmedOrNull(payload?.display_name),
  group: toTrimmedOrNull(payload?.group),
  quota: toFiniteOrNull(payload?.quota),
  usedQuota: toFiniteOrNull(payload?.used_quota),
  requestCount: toFiniteOrNull(payload?.request_count),
  affCode: toTrimmedOrNull(payload?.aff_code),
  affCount: toFiniteOrNull(payload?.aff_count),
  affQuota: toFiniteOrNull(payload?.aff_quota),
  affHistoryQuota: toFiniteOrNull(payload?.aff_history_quota),
  source: toTrimmedOrNull(payload?.source),
  fetchedAt: toTrimmedOrNull(payload?.fetched_at),
});

const formatPoints = (value: number): string => value.toLocaleString('en-US');

const renderAnyrouterItems = (
  quota: AnyrouterQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap } = helpers;
  const { createElement: h, Fragment } = React;
  const nodes: ReactNode[] = [];

  if (quota.group) {
    nodes.push(
      h(
        'div',
        { key: 'group', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('anyrouter_quota.group_label')),
        h('span', { className: styleMap.codexPlanValue }, quota.group)
      )
    );
  }

  type Row = { id: string; labelKey: string; primary: string; secondary?: string | null };
  const rows: Row[] = [];

  if (quota.quota !== null) {
    rows.push({
      id: 'remaining',
      labelKey: 'anyrouter_quota.quota_label',
      primary: formatPoints(quota.quota),
    });
  }
  if (quota.usedQuota !== null) {
    rows.push({
      id: 'used',
      labelKey: 'anyrouter_quota.used_label',
      primary: formatPoints(quota.usedQuota),
    });
  }
  if (quota.requestCount !== null) {
    rows.push({
      id: 'requests',
      labelKey: 'anyrouter_quota.request_count_label',
      primary: formatPoints(quota.requestCount),
    });
  }
  if (quota.affQuota !== null && quota.affQuota > 0) {
    rows.push({
      id: 'aff',
      labelKey: 'anyrouter_quota.aff_quota_label',
      primary: formatPoints(quota.affQuota),
      secondary: quota.affCode ? `#${quota.affCode}` : null,
    });
  }

  if (rows.length === 0) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('anyrouter_quota.empty'))
    );
    return h(Fragment, null, ...nodes);
  }

  rows.forEach((row) => {
    nodes.push(
      h(
        'div',
        { key: row.id, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel }, t(row.labelKey)),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h('span', { className: styleMap.quotaPercent }, row.primary),
            row.secondary ? h('span', { className: styleMap.quotaAmount }, row.secondary) : null
          )
        )
      )
    );
  });

  return h(Fragment, null, ...nodes);
};

export const ANYROUTER_PANEL_CONFIG: OpenAICompatPanelConfig<
  AnyrouterQuotaState,
  AnyrouterBalancePayload
> = {
  i18nPrefix: 'anyrouter_quota',
  buildSuccessState: (payload) => anyrouterStateFromPayload(payload),
  renderQuotaItems: renderAnyrouterItems,
};

// -----------------------------------------------------------------------------
// Re-exported ollama / deepseek (use the same QuotaConfig — it satisfies the
// minimal panel interface).
// -----------------------------------------------------------------------------

export const OLLAMA_PANEL_CONFIG: OpenAICompatPanelConfig<unknown, unknown> = {
  i18nPrefix: OLLAMA_CONFIG.i18nPrefix,
  buildSuccessState: OLLAMA_CONFIG.buildSuccessState as (data: unknown) => unknown,
  renderQuotaItems: OLLAMA_CONFIG.renderQuotaItems as (
    quota: unknown,
    t: TFunction,
    helpers: QuotaRenderHelpers
  ) => ReactNode,
};

export const DEEPSEEK_PANEL_CONFIG: OpenAICompatPanelConfig<unknown, unknown> = {
  i18nPrefix: DEEPSEEK_CONFIG.i18nPrefix,
  buildSuccessState: DEEPSEEK_CONFIG.buildSuccessState as (data: unknown) => unknown,
  renderQuotaItems: DEEPSEEK_CONFIG.renderQuotaItems as (
    quota: unknown,
    t: TFunction,
    helpers: QuotaRenderHelpers
  ) => ReactNode,
};
