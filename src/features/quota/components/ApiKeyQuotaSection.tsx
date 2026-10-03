import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import {
  openaiCompatQuotaApi,
  type ApiKeyQuotaAccount,
  type ApiKeyQuotaResponse,
} from '@/services/api/openaiCompatQuota';
import { QuotaMeter } from './QuotaMeter';
import { bindQuotaClasses } from '../types';
import bodyStyles from './QuotaBody.module.scss';
import openrouterIcon from '@/assets/icons/openrouter.svg';
import glmIcon from '@/assets/icons/glm.svg';
import styles from './ApiKeyQuotaSection.module.scss';

/** Provider name → lobe icon; unknown providers fall back to the plain dot. */
const PROVIDER_ICONS: Record<string, string> = {
  openrouter: openrouterIcon,
  zai: glmIcon,
  zhipu: glmIcon,
};

/** 额度页全页外衣：与各 provider Body 共用同一套行/水位条视觉资产。 */
const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

/**
 * Per-API-key quota section (OpenRouter accounts etc.), rendered below the
 * OAuth credential grid. Data comes from the server's quota.json snapshot
 * (written by bin/sync_providers.js), not from auth files, so it lives
 * outside the adapter/batch-loader machinery that assumes AuthFileItem.
 *
 * Visual language mirrors the OAuth side: provider summary cards with a big
 * remaining figure + segmented bar, then one meter row per account.
 */

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: ApiKeyQuotaResponse };

interface AccountMetric {
  row: ApiKeyQuotaAccount;
  /** % of the paid cap left; null when the account has no cap. */
  capPercentLeft: number | null;
  /** The cap total capPercentLeft was derived from — segment widths must use
   * the same source, or mixed-unit bars size segments inconsistently. */
  capTotal: number;
  /** % of the daily free allowance already used; null when not reported. */
  freePercentUsed: number | null;
}

interface ProviderGroup {
  provider: string;
  accounts: AccountMetric[];
  /** Worst capped-account remaining %, for the summary card figure. */
  worstCapPercentLeft: number | null;
  /** Cap-bearing accounts, for the segmented summary bar. */
  capped: AccountMetric[];
}

const maskAccount = (name: string): string =>
  name.length <= 3 ? `${name.slice(0, 1)}•••` : `${name.slice(0, 3)}•••${name.slice(-2)}`;

const fillClassFor = (percent: number | null): string => {
  if (percent === null) return quotaClasses.quotaBarFillMedium;
  if (percent >= 70) return quotaClasses.quotaBarFillHigh;
  if (percent >= 30) return quotaClasses.quotaBarFillMedium;
  return quotaClasses.quotaBarFillLow;
};

const toMetric = (row: ApiKeyQuotaAccount): AccountMetric => {
  // OpenRouter 的 /key 与 /credits 两个端点给的额度上限可能不一致（key=50、credits=$15）。
  // 有真实 credits 上限时以它为准，避免一行里 100% 配 "$2.60 / $15.00" 自相矛盾。
  const credits = row.credits;
  const capPercentLeft =
    credits?.total != null && credits.total > 0 && credits.remaining != null
      ? Math.max(0, Math.min(100, (credits.remaining / credits.total) * 100))
      : row.limit != null && row.remaining != null && row.limit > 0
        ? Math.max(0, Math.min(100, (row.remaining / row.limit) * 100))
        : null;
  // Same precedence as capPercentLeft: summary-bar segment widths are sized by
  // capTotal so the bar proportions always match the percentages shown.
  const capTotal =
    credits?.total != null && credits.total > 0 ? credits.total : row.limit ?? 1;
  return {
    row,
    capPercentLeft,
    capTotal: Math.max(capTotal, 0.01),
    freePercentUsed:
      row.free_model_requests?.limit != null && row.free_model_requests.limit > 0
        ? Math.max(0, Math.min(100, ((row.free_model_requests.used ?? 0) / row.free_model_requests.limit) * 100))
        : null,
  };
};

const groupByProvider = (accounts: ApiKeyQuotaAccount[]): ProviderGroup[] => {
  const groups = new Map<string, ProviderGroup>();
  for (const row of accounts) {
    const metric = toMetric(row);
    let group = groups.get(row.provider);
    if (!group) {
      group = { provider: row.provider, accounts: [], worstCapPercentLeft: null, capped: [] };
      groups.set(row.provider, group);
    }
    group.accounts.push(metric);
    if (metric.capPercentLeft !== null) {
      group.capped.push(metric);
    }
  }
  for (const group of groups.values()) {
    const worst = group.capped.reduce<number | null>(
      (acc, m) => (acc === null || m.capPercentLeft! < acc ? m.capPercentLeft : acc),
      null
    );
    group.worstCapPercentLeft = worst;
    group.capped.sort((a, b) => (b.capPercentLeft ?? -1) - (a.capPercentLeft ?? -1));
  }
  return [...groups.values()].sort((a, b) => a.provider.localeCompare(b.provider));
};

const formatMoney = (value: number | null | undefined): string =>
  value == null ? '—' : `$${value.toFixed(2)}`;

/** Stable identity for the "no data yet" case; see the accounts useMemo. */
const EMPTY_ACCOUNTS: ApiKeyQuotaAccount[] = [];

export function ApiKeyQuotaSection() {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const data = await openaiCompatQuotaApi.get();
      setState({ kind: 'ready', data });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Memoized so groupByProvider only reruns on real data changes; a bare
  // `?? []` fallback here would hand useMemo a fresh array every render.
  const accounts = useMemo(
    () => (state.kind === 'ready' ? state.data.accounts ?? [] : EMPTY_ACCOUNTS),
    [state]
  );
  const groups = useMemo(() => groupByProvider(accounts), [accounts]);
  const updatedAt =
    state.kind === 'ready' ? state.data.served_at ?? state.data.updated_at : undefined;
  const accountCount = accounts.length;

  const nameFor = (account: string | null, keyId: string): string =>
    revealed ? account ?? keyId : maskAccount(account ?? keyId);

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t('quota_management.api_keys_title')}</h2>
        <div className={styles.actions}>
          <span className={styles.meta}>
            {t('quota_management.api_keys_count', { count: accountCount })}
            {updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ''}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setRevealed((v) => !v)}>
            {revealed
              ? t('quota_management.api_keys_hide')
              : t('quota_management.api_keys_show')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            disabled={state.kind === 'loading'}
          >
            <IconRefreshCw />
            {t('quota_management.api_keys_refresh')}
          </Button>
        </div>
      </div>

      {state.kind === 'error' ? <p className={styles.note}>{state.message}</p> : null}
      {state.kind === 'ready' && accounts.length === 0 ? (
        <p className={styles.note}>{state.data.note ?? t('quota_management.api_keys_empty')}</p>
      ) : null}

      {groups.length > 0 ? (
        <>
          {/* 摘要卡：每 provider 一张，大数字 = 最紧张账户的剩余百分比，分段条 = 各有上限账户 */}
          <div className={styles.cardGrid}>
            {groups.map((group) => (
              <article key={group.provider} className={styles.card}>
                <header className={styles.cardHead}>
                  {Object.prototype.hasOwnProperty.call(PROVIDER_ICONS, group.provider.toLowerCase()) ? (
                    <img
                      src={PROVIDER_ICONS[group.provider.toLowerCase()]}
                      alt=""
                      className={styles.cardIcon}
                    />
                  ) : (
                    <span className={styles.cardDot} aria-hidden />
                  )}
                  <span className={styles.cardProvider}>{group.provider}</span>
                  <span className={styles.cardCount}>
                    {t('quota_management.api_keys_accounts', { count: group.accounts.length })}
                  </span>
                </header>
                <div className={styles.cardMetric}>
                  <span className={styles.cardBig}>
                    {group.worstCapPercentLeft === null ? '--' : `${Math.round(group.worstCapPercentLeft)}%`}
                  </span>
                  <span className={styles.cardOf}>{t('quota_management.api_keys_of_total', { total: 100 })}</span>
                </div>
                <div className={styles.cardLabel}>{t('quota_management.api_keys_worst')}</div>
                <div
                  className={`${quotaClasses.quotaBar} ${styles.segmented}`}
                  role="img"
                  aria-label={group.provider}
                >
                  {group.capped.length > 0 ? (
                    group.capped.map((m) => (
                      <div
                        key={m.row.key_id}
                        className={`${styles.segment} ${fillClassFor(m.capPercentLeft)}`}
                        style={{ flex: m.capTotal }}
                        title={`${m.row.account ?? m.row.key_id}: ${m.capPercentLeft?.toFixed(1)}%`}
                      />
                    ))
                  ) : (
                    <div className={`${styles.segment} ${quotaClasses.quotaBarFillMedium}`} style={{ flex: 1 }} />
                  )}
                </div>
                <div className={styles.cardMeta}>
                  {t('quota_management.api_keys_credits_total', {
                    used: group.accounts.reduce((s, m) => s + (m.row.credits?.used ?? 0), 0).toFixed(2),
                  })}
                </div>
              </article>
            ))}
          </div>

          {/* 分组行：每账户一组，Credits + Free daily 两条水位线 */}
          {groups.map((group) => (
            <div key={group.provider} className={styles.group}>
              <div className={styles.groupTitle}>
                {PROVIDER_ICONS[group.provider.toLowerCase()] ? (
                  <img
                    src={PROVIDER_ICONS[group.provider.toLowerCase()]}
                    alt=""
                    className={styles.groupIcon}
                  />
                ) : null}
                {group.provider}
                <span className={styles.groupCount}>{group.accounts.length}</span>
              </div>
              {group.accounts.map((metric) => {
                const { row } = metric;
                const credits = row.credits;
                return (
                  <div key={row.key_id} className={styles.accountRow}>
                    <div className={styles.accountId}>
                      <span className={styles.accountName} title={revealed ? row.account ?? row.key_id : undefined}>
                        {nameFor(row.account, row.key_id)}
                      </span>
                      <span className={`${styles.stateChip} ${stateClassFor(row.state)}`}>{row.state}</span>
                      {row.plan ? <span className={styles.planChip}>{row.plan}</span> : null}
                    </div>
                    <div className={styles.meterGrid}>
                      {row.meters ? (
                        // Provider-declared meters (z.ai windows etc.) — labels come from the data.
                        row.meters.map((m) => (
                          <div key={m.label} className={quotaClasses.quotaRow}>
                            <div className={quotaClasses.quotaRowHeader}>
                              <span className={quotaClasses.quotaModel}>{m.label}</span>
                              <div className={quotaClasses.quotaMeta}>
                                <span className={quotaClasses.quotaPercent}>
                                  {m.percent_left == null ? '--' : `${Math.round(m.percent_left)}%`}
                                </span>
                                {m.text ? (
                                  <span className={quotaClasses.quotaAmount}>{m.text}</span>
                                ) : null}
                              </div>
                            </div>
                            <QuotaMeter percent={m.percent_left} classes={quotaClasses} />
                          </div>
                        ))
                      ) : (
                        <>
                        <div className={quotaClasses.quotaRow}>
                        <div className={quotaClasses.quotaRowHeader}>
                          <span className={quotaClasses.quotaModel}>
                            {t('quota_management.api_keys_credits')}
                          </span>
                          <div className={quotaClasses.quotaMeta}>
                            <span className={quotaClasses.quotaPercent}>
                              {metric.capPercentLeft === null ? '--' : `${Math.round(metric.capPercentLeft)}%`}
                            </span>
                            <span className={quotaClasses.quotaAmount}>
                              {/* 免费账户 credits.total 常为 0，显示 "$x / $0.00" 无意义，退回 limit/remaining。 */}
                              {credits?.total != null && credits.total > 0
                                ? `${formatMoney(credits.used)} / ${formatMoney(credits.total)}`
                                : row.limit != null && row.limit > 0
                                  ? `${formatMoney(row.remaining)} left of ${formatMoney(row.limit)}`
                                  : credits?.used != null
                                    ? `${formatMoney(credits.used)} used`
                                    : '—'}
                            </span>
                          </div>
                        </div>
                        <QuotaMeter percent={metric.capPercentLeft} classes={quotaClasses} />
                      </div>
                      {metric.freePercentUsed !== null ? (
                        <div className={quotaClasses.quotaRow}>
                          <div className={quotaClasses.quotaRowHeader}>
                            <span className={quotaClasses.quotaModel}>
                              {t('quota_management.api_keys_free')}
                            </span>
                            <div className={quotaClasses.quotaMeta}>
                              <span className={quotaClasses.quotaPercent}>
                                {Math.round(metric.freePercentUsed)}%
                              </span>
                              <span className={quotaClasses.quotaAmount}>
                                {row.free_model_requests?.used ?? 0}/{row.free_model_requests?.limit}
                              </span>
                            </div>
                          </div>
                          <QuotaMeter percent={metric.freePercentUsed} classes={quotaClasses} />
                        </div>
                      ) : null}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}

const stateClassFor = (state: string): string => {
  if (state === 'ok') return styles.stateOk;
  if (state === 'stale') return styles.stateStale;
  return styles.stateBad;
};
