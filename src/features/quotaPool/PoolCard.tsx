import { Fact, FactPanel, FactSection } from '@/components/ui/FactPanel';
import { BillingFacts } from '@/components/ui/FactPanel/BillingFacts';
import { billingFacts } from '@/domain/accountBilling';
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconCircleHalf,
  IconClock,
  IconHistory,
  IconInfo,
  IconTimer,
  IconX,
} from '@/components/ui/icons';
import type { PoolDashboard, QuotaPool } from '@/domain/quotaPool/types';
import { metricField, type ChartMode } from './chartGeometry';
import { DAY_MS } from '@/utils/time/durations';
import { useNow } from '@/hooks/useNow';
import type { AccountResetKind, AccountResets } from '@/domain/quotaPool/types';
import { laneOf, poolWindowId } from '@/domain/quotaWindows/lanes';
import type { TFunction } from 'i18next';
import { heldResetKinds, sumResetKinds, wasSpent, type ResetKindCount } from './resetAccounts';
import { PoolAccountResets, ResetKindCounts } from './PoolAccountResets';
import { PoolChart } from './PoolChart';
import { PoolGraph } from './PoolGraph';
import { PoolGraphToggle } from './PoolGraphToggle';
import { PoolProviderMark } from './PoolProviderMark';
import { poolChip, type PoolChipIcon } from './model/poolChip';
import { sortAccounts, type AccountSort } from './model/accountOrder';
import { formatPoolDate, formatPoolNumber, formatPoolPercent, isLowQuota } from './presentation';
import styles from './QuotaPoolPage.module.scss';

/** Rosters longer than this get a search box and a sort, so one account can be found. */
const ROSTER_CONTROLS_MIN = 8;
/** Rows shown before "Show all", so a long roster doesn't bury the next pool. */
const ROSTER_PAGE = 25;
/** This page says only "from start date" beside each estimate; one caveat per Accounts section carries the rest. */
const ESTIMATE_BASIS_OVERRIDES = { billing_estimate_basis: 'billing_estimate_from_start' };
const CHIP_ICONS: Record<PoolChipIcon, typeof IconCheck> = {
  check: IconCheck,
  partial: IconCircleHalf,
  stale: IconClock,
  saved: IconHistory,
  collecting: IconTimer,
  info: IconInfo,
};

/** The row chip's parts; each stays whole, so a narrow column breaks it only between parts. */
function resetChipParts(
  resets: AccountResets,
  kinds: ResetKindCount[] | null,
  t: TFunction
): { text: string; kind?: AccountResetKind }[] {
  if (kinds)
    return [
      ...kinds.map(({ kind, count }) => ({
        text: t(`quota_pool.reset_count_${kind}`, { count }),
        kind,
      })),
      ...(resets.usable > 0
        ? [{ text: t('quota_pool.reset_usable_part', { usable: resets.usable }) }]
        : []),
    ];
  return (
    resets.usable > 0
      ? t('quota_pool.reset_chip_usable', { count: resets.available, usable: resets.usable })
      : t('quota_pool.reset_chip', { count: resets.available })
  )
    .split(' · ')
    .map((text) => ({ text }));
}

function ResetChip({ resets, now }: { resets: AccountResets; now: number }) {
  const { t } = useTranslation();
  const kinds = heldResetKinds(resets, now);
  const parts = resetChipParts(resets, kinds, t);
  return (
    <>
      {/* Kind counts drop the "Manual resets" word so the chip fits the Account column. */}
      {kinds && <span className={styles.resetChipLabel}>{t('quota_pool.resets')}: </span>}
      {parts.map((part, index) => (
        <Fragment key={index}>
          <span className={styles.resetChipPart}>
            <span data-kind={part.kind}>{part.text}</span>
            {index < parts.length - 1 && ' ·'}
          </span>
          {index < parts.length - 1 && ' '}
        </Fragment>
      ))}
    </>
  );
}

/** One label/value pair of the Accounts summary; the pair wraps as a unit, never inside. */
function SummaryFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className={styles.summaryFact}>
      <span className={styles.summaryLabel}>{label}</span>{' '}
      <b className={styles.summaryValue}>{children}</b>
    </span>
  );
}

const STACKED_FACTS = '(max-width: 900px)';
/** At 900px and below an opened row reads: limits, Manual resets, Usage, Billing. Rendered on the server, rows are wide. */
function useStackedFacts() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(STACKED_FACTS);
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => window.matchMedia(STACKED_FACTS).matches,
    () => false
  );
}

export function PoolCard({
  pool,
  dashboard,
  mode,
  reveal,
  savedData = false,
  move,
  onRefresh = () => {},
}: {
  onRefresh?: (accountId?: string) => void;
  pool: QuotaPool;
  dashboard: PoolDashboard;
  mode: ChartMode;
  reveal: boolean;
  savedData?: boolean;
  /** Reorder controls; a missing direction (first or last card) is not drawn. */
  move?: { up?: () => void; down?: () => void };
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const stackedFacts = useStackedFacts();
  const [minimized, setMinimized] = useState(false);
  const [rosterQuery, setRosterQuery] = useState('');
  const [rosterSort, setRosterSort] = useState<AccountSort>('name');
  const [lowOnly, setLowOnly] = useState(false);
  const [affectedOnly, setAffectedOnly] = useState(false);
  // Bumped by the notice's action; the effect then brings the first affected row into focus.
  const [affectedFocus, setAffectedFocus] = useState(0);
  const accountsRef = useRef<HTMLElement>(null);
  const accountsHeadingRef = useRef<HTMLHeadingElement>(null);
  const [showAll, setShowAll] = useState(false);
  // Opening a row reveals reset details.
  const [openAccounts, setOpenAccounts] = useState<ReadonlySet<string>>(() => new Set());
  const allOpen = pool.accounts.length > 0 && pool.accounts.every((a) => openAccounts.has(a.id));
  const setAccountOpen = (accountId: string, open: boolean) =>
    setOpenAccounts((current) => {
      if (current.has(accountId) === open) return current;
      const next = new Set(current);
      if (open) next.add(accountId);
      else next.delete(accountId);
      return next;
    });
  const number = (value: number | null) => formatPoolNumber(value, i18n.language);
  const percent = (value: number) => formatPoolPercent(value, i18n.language);
  const date = (value: number | null) => formatPoolDate(value, i18n.language);
  // The visible word is the accessible text; the red icon and bar carry the colour. Meaning never
  // rests on colour alone, and the percentage keeps the normal value colour.
  const lowMark = (
    <span className={styles.lowMark}>
      <span className={styles.limitWarning} aria-hidden="true">
        <IconAlertTriangle size={14} aria-hidden="true" />
      </span>
      <span className={styles.lowWord}>{t('quota_pool.limit_low')}</span>
    </span>
  );
  const forecastDate = (value: number | null, available = pool.forecastState === 'ready') =>
    value === null ? (
      available ? (
        // Not reached before the server's forecast horizon (server/quota/domain.ts projects to
        // the later of the range end and 14 days out), whatever the chart shows.
        t('quota_pool.after_range', {
          date: formatPoolDate(
            Math.max(dashboard.toMs, dashboard.nowMs + 14 * DAY_MS),
            i18n.language,
            true
          ),
        })
      ) : (
        <>
          <span aria-hidden="true">—</span>
          <span className={styles.srOnly}>{t('quota_pool.forecast_unavailable')}</span>
        </>
      )
    ) : (
      date(value)
    );
  const windowLabel = t(`quota_pool.${dashboard.window === 'weekly' ? 'weekly' : 'five_hour'}`);
  const balanceLabel = t('quota_pool.window_remaining', { window: windowLabel });
  const showRosterControls = pool.accounts.length > ROSTER_CONTROLS_MIN;
  const accountName = (account: (typeof pool.accounts)[number]) =>
    reveal && account.email ? account.email : (account.identifier ?? account.label);
  const missingAccounts = pool.accounts.filter(
    (account) => account.status === 'error' || account.status === 'missing-window'
  );
  const staleAccounts = pool.accounts.filter((account) => account.status === 'stale');
  // The accounts holding the total back. The notice counts them and its action shows them in
  // the list, instead of naming masked addresses that wrap badly.
  const affectedAccounts =
    pool.forecastState === 'partial'
      ? missingAccounts
      : pool.forecastState === 'stale'
        ? staleAccounts
        : [];
  const affectedIds = new Set(affectedAccounts.map((account) => account.id));
  const stateNote =
    pool.forecastState === 'partial' && missingAccounts.length
      ? t('quota_pool.unavailable_count', {
          count: missingAccounts.length,
          total: pool.accountCount,
        })
      : pool.forecastState === 'stale' && staleAccounts.length
        ? t('quota_pool.stale_count', { count: staleAccounts.length, total: pool.accountCount })
        : t(`quota_pool.state_note.${pool.forecastState}`, { window: windowLabel });
  const showAffected = () => {
    setAffectedOnly(true);
    setLowOnly(false);
    setRosterQuery('');
    setShowAll(false);
    setAffectedFocus((value) => value + 1);
  };
  useEffect(() => {
    if (!affectedFocus) return;
    accountsRef.current?.scrollIntoView({ block: 'start' });
    accountsRef.current?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  }, [affectedFocus]);
  // The header's "N accounts" jumps past the chart to the roster. Focus goes to the Accounts heading, not
  // the search box, so a phone's keyboard stays closed.
  const jumpToAccounts = () => {
    accountsRef.current?.scrollIntoView({ block: 'start' });
    accountsHeadingRef.current?.focus({ preventScroll: true });
  };
  const forecastWithheld = pool.forecastState !== 'ready' && pool.forecastState !== 'no-limit';
  // A withheld forecast with no burn rate has nothing measured to add beside the headline.
  const showNow = mode !== 'remaining' || !(forecastWithheld && pool.burnPointsPerHour === null);
  // Claude names its weekly windows "7-day"; the page calls that window Weekly everywhere.
  // The columns show remaining percentages, so the headings say "remaining", not "limit".
  const limitLabel = (limit: (typeof pool.accounts)[number]['windows'][number]) =>
    laneOf(pool.provider, limit.id) === 'five-hour'
      ? t('quota_pool.five_hour_remaining')
      : laneOf(pool.provider, limit.id) === 'weekly'
        ? t('quota_pool.weekly_remaining')
        : limit.id === 'seven-day-opus'
          ? t('quota_pool.weekly_opus_remaining')
          : t(limit.labelKey, limit.labelParams);
  const query = rosterQuery.trim().toLowerCase();
  const matchingAccounts = pool.accounts.filter(
    (account) => !query || accountName(account).toLowerCase().includes(query)
  );
  // Counted within the search, so the chip's number is what the filter will show.
  const lowAccountCount = matchingAccounts.filter((account) =>
    account.windows.some((limit) => isLowQuota(limit.remainingPercent))
  ).length;
  const visibleAccounts = sortAccounts(
    matchingAccounts.filter(
      (account) =>
        (!lowOnly || account.windows.some((limit) => isLowQuota(limit.remainingPercent))) &&
        (!affectedOnly || affectedIds.has(account.id))
    ),
    rosterSort,
    accountName,
    i18n.language
  );
  // One column per limit the roster reports, so every account's bars line up under one heading.
  const limitColumns = pool.accounts.reduce<
    Array<(typeof pool.accounts)[number]['windows'][number]>
  >((columns, account) => {
    account.windows.forEach((limit) => {
      if (!columns.some((column) => column.id === limit.id)) columns.push(limit);
    });
    return columns;
  }, []);
  // The pool balance is the sample of one limit (server/quota/collector.ts): the 5-hour
  // limit, or the provider's weekly one. Mark that column instead of repeating it.
  const countedLimitId = poolWindowId(pool.provider, dashboard.window);
  const balanceHasColumn = limitColumns.some((column) => column.id === countedLimitId);
  // A wide column that shows a Low mark or "Unavailable" on any row reserves a status slot, as wide as
  // its widest mark, on every row, so the values and bars of the whole column start at one x.
  const columnStatus = new Map<string, { low: boolean; unavailable: boolean }>();
  pool.accounts.forEach((account) =>
    account.windows.forEach((limit) => {
      const low = isLowQuota(limit.remainingPercent);
      const unavailable = limit.remainingPercent === null;
      if (!low && !unavailable) return;
      const seen = columnStatus.get(limit.id) ?? { low: false, unavailable: false };
      columnStatus.set(limit.id, {
        low: seen.low || low,
        unavailable: seen.unavailable || unavailable,
      });
    })
  );
  const resetSection = (account: (typeof pool.accounts)[number]) =>
    openAccounts.has(account.id) && (
      <PoolAccountResets
        key="resets"
        account={account}
        name={accountName(account)}
        provider={pool.provider}
        instanceId={pool.instanceId}
        onRefresh={onRefresh}
      />
    );
  // At 900px and below a row reads as blocks: the active window leads the limit list instead of
  // being the bold figure in the header. An account that reports no windows (or a pool with no column
  // for the active one) keeps the figure.
  const phoneBlocks = (account: (typeof pool.accounts)[number]) =>
    balanceHasColumn && account.windows.length > 0;
  const missingLimit = (
    account: (typeof pool.accounts)[number],
    column: (typeof limitColumns)[number]
  ) => (
    <li
      key={`missing-${column.id}`}
      data-limit-id={column.id}
      data-missing="true"
      data-counted={column.id === countedLimitId || undefined}
      data-low="false"
      style={
        {
          '--col': limitColumns.findIndex((other) => other.id === column.id) + 1,
        } as CSSProperties
      }
    >
      <span>{limitLabel(column)}</span>
      {/* The reason fills the cell, so the column still says why it is empty. */}
      <em>
        {account.noFiveHourLimit && column.id === 'five-hour'
          ? t('quota_pool.no_window_limit', {
              window: t('quota_pool.five_hour'),
            })
          : t('quota_pool.not_reported')}
      </em>
    </li>
  );
  // Every account counts, not only those shown, so search, filters and paging never hide the caveat.
  const hasEstimatedRenewal = pool.accounts.some((account) =>
    billingFacts(account.billing ?? null, dashboard.nowMs).some(
      (fact) => fact.state === 'estimated' && fact.labelKey === 'billing_renews'
    )
  );
  const pageAccounts = showAll ? visibleAccounts : visibleAccounts.slice(0, ROSTER_PAGE);
  const noLimitCount =
    dashboard.window === 'five-hour'
      ? pool.accounts.filter((account) => account.noFiveHourLimit).length
      : 0;
  const now = useNow();
  // Accounts whose resets count toward the totals: not spent from this tab since the reading.
  const resetAccounts = pool.accounts.filter(
    (account) =>
      account.resets &&
      account.resets.available > 0 &&
      !wasSpent(account.id, account.resets.observedAtMs)
  );
  const resetKindTotals = sumResetKinds(
    resetAccounts.map((account) => heldResetKinds(account.resets!, now))
  );
  const resetTotals = pool.accounts.reduce(
    (sum, account) =>
      account.resets && wasSpent(account.id, account.resets.observedAtMs)
        ? sum
        : {
            available: sum.available + (account.resets?.available ?? 0),
            usable: sum.usable + (account.resets?.usable ?? 0),
          },
    { available: 0, usable: 0 }
  );
  const coverageMissing =
    pool.loadedCount !== pool.accountCount || pool.eligibleCount !== pool.accountCount;
  const chip = poolChip(pool.forecastState, savedData);
  const ChipIcon = CHIP_ICONS[chip.icon];
  const headlineContext = (
    <div className={styles.headlineContext}>
      <p className={styles.metricLabel}>
        {mode !== 'remaining'
          ? t('quota_pool.recorded_rate', {
              rate: t(`quota_pool.${mode}`),
              hours: dashboard.lookbackHours,
            })
          : balanceLabel}
      </p>
      {/* Remaining adds its scale on a second line; rates keep their unit beside the number. */}
      {mode === 'remaining' && (
        <span>{t('quota_pool.of_capacity', { capacity: number(pool.capacityPoints) })}</span>
      )}
    </div>
  );
  return (
    <article
      className={`${styles.pool} ${styles[pool.provider]}`}
      aria-labelledby={`${id}-title`}
      data-forecast-state={pool.forecastState}
      data-chart-mode={mode}
      data-minimized={minimized}
      data-saved={savedData}
    >
      <div className={styles.poolHeader}>
        <div className={styles.poolIdentity}>
          <div className={styles.poolTitle}>
            <PoolProviderMark provider={pool.provider} />
            <h2 id={`${id}-title`}>
              {t(`quota_pool.${pool.provider}`)}
              {pool.sourceLabel && <small> · {pool.sourceLabel}</small>}
            </h2>
            <div className={styles.poolMeta}>
              <button
                type="button"
                className={styles.accountsJump}
                aria-describedby={`${id}-accounts-jump`}
                onClick={jumpToAccounts}
              >
                {t('quota_pool.account_count', { count: pool.accountCount })}
              </button>
              <span id={`${id}-accounts-jump`} className={styles.srOnly}>
                {t('quota_pool.accounts_jump')}
              </span>
              <span
                className={styles.badge}
                data-state={chip.state}
                data-chip-icon={chip.icon}
                data-tone={chip.tone}
              >
                <ChipIcon size={13} aria-hidden="true" />
                {savedData
                  ? t('quota_pool.saved_forecast')
                  : t('quota_pool.forecast_status', {
                      state: t(`quota_pool.state.${pool.forecastState}`).toLocaleLowerCase(
                        i18n.language
                      ),
                    })}
              </span>
            </div>
          </div>
          <span className={styles.reorder}>
            <PoolGraphToggle
              minimized={minimized}
              onToggle={() => setMinimized((value) => !value)}
              label={`${t(`quota_pool.${pool.provider}`)}${pool.sourceLabel ? ` · ${pool.sourceLabel}` : ''}`}
              controls={`${id}-plot`}
            />
            {/* A move that can't happen (first or last card) isn't drawn. */}
            {move?.up && (
              <button
                type="button"
                onClick={move.up}
                aria-label={t('quota_pool.move_up', { pool: t(`quota_pool.${pool.provider}`) })}
                title={t('quota_pool.move_up', { pool: t(`quota_pool.${pool.provider}`) })}
              >
                <IconArrowUp size={16} aria-hidden="true" />
                {t('quota_pool.move_up_short')}
              </button>
            )}
            {move?.down && (
              <button
                type="button"
                onClick={move.down}
                aria-label={t('quota_pool.move_down', { pool: t(`quota_pool.${pool.provider}`) })}
                title={t('quota_pool.move_down', { pool: t(`quota_pool.${pool.provider}`) })}
              >
                <IconArrowDown size={16} aria-hidden="true" />
                {t('quota_pool.move_down_short')}
              </button>
            )}
          </span>
        </div>
        <div
          className={styles.headline}
          data-unavailable={pool[metricField[mode]] === null}
          data-rate={mode !== 'remaining'}
          data-no-limit={pool.forecastState === 'no-limit'}
        >
          {/* Rate views read label, then number; Remaining keeps its caption beside the number. */}
          {mode !== 'remaining' && headlineContext}
          <strong>
            {pool.forecastState === 'no-limit' ? (
              <span className={styles.unavailableValue}>
                {t('quota_pool.no_window_limit', { window: windowLabel })}
              </span>
            ) : pool[metricField[mode]] === null ? (
              // A muted word in the number slot, so a withheld total never passes for a value.
              <span className={styles.unavailableValue}>{t('quota_pool.value_withheld')}</span>
            ) : (
              <>
                {number(pool[metricField[mode]])}
                {/* Rates carry their unit on the number line. */}
                {mode !== 'remaining' && <small> {t('quota_pool.points_hour')}</small>}
              </>
            )}
          </strong>
          {mode === 'remaining' && headlineContext}
        </div>
        {/* Every view has the same two groups: "Now" holds the one measured fact the headline
            doesn't show (the burn rate, or in rate views the balance), "Forecast" the projections. */}
        <div className={styles.statsBlock} data-split={showNow || undefined}>
          {showNow && (
            <div className={styles.statsGroup}>
              <p className={styles.statsHeading}>{t('quota_pool.now_group')}</p>
              <dl className={styles.stats}>
                {mode === 'remaining' ? (
                  <div>
                    <dt>{t('quota_pool.burn_last', { hours: dashboard.lookbackHours })}</dt>
                    <dd>
                      {number(pool.burnPointsPerHour)}
                      {pool.burnPointsPerHour !== null && ` ${t('quota_pool.points_hour')}`}
                    </dd>
                  </div>
                ) : (
                  <div>
                    <dt>{t('quota_pool.account_remaining', { window: windowLabel })}</dt>
                    {/* The number takes the value style; "of 300 points" the headline unit's muted style. */}
                    <dd>
                      {number(pool.remainingPoints)}{' '}
                      <small>
                        {t('quota_pool.of_capacity', { capacity: number(pool.capacityPoints) })}
                      </small>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          <div className={styles.statsGroup}>
            <p className={styles.statsHeading}>{t('quota_pool.remaining_forecast')}</p>
            <dl className={styles.stats}>
              {/* A withheld forecast is explained by the notice; its empty facts aren't repeated. */}
              {!(forecastWithheld && pool.poolEmptyAtMs === null) && (
                <div>
                  <dt>{t('quota_pool.pool_empty')}</dt>
                  <dd>{forecastDate(pool.poolEmptyAtMs)}</dd>
                </div>
              )}
              {!(forecastWithheld && pool.firstEmptyAtMs === null) && (
                <div>
                  <dt>{t('quota_pool.first_empty')}</dt>
                  <dd>{forecastDate(pool.firstEmptyAtMs)}</dd>
                </div>
              )}
              <div>
                <dt>{t('quota_pool.next_reset')}</dt>
                <dd>{date(pool.nextResetAtMs)}</dd>
                {pool.nextResetGainPoints !== null && (
                  <small>
                    +{number(pool.nextResetGainPoints)} {t('quota_pool.points')}
                  </small>
                )}
              </div>
            </dl>
          </div>
        </div>
      </div>
      {/* Why the forecast or total is limited, across the card under its summary. */}
      {pool.forecastState !== 'ready' && (
        <p className={styles.stateNote} role="status" data-state={pool.forecastState}>
          {/* The page's one "Refresh now" sits in the combined card's notice above. */}
          <span>{stateNote}</span>
          {affectedAccounts.length > 0 && (
            // Once the list is filtered, the same button puts every account back.
            <button
              type="button"
              className={styles.noteAction}
              onClick={affectedOnly ? () => setAffectedOnly(false) : showAffected}
            >
              {t(affectedOnly ? 'quota_pool.show_all_accounts' : 'quota_pool.show_affected')}
            </button>
          )}
        </p>
      )}
      <PoolGraph title={t('quota_pool.history_forecast')} id={`${id}-plot`} minimized={minimized}>
        <PoolChart
          key={`${mode}-${dashboard.fromMs}`}
          pool={pool}
          dashboard={dashboard}
          mode={mode}
          savedData={savedData}
          minimized={minimized}
        />
      </PoolGraph>
      <section ref={accountsRef} className={styles.accounts} aria-labelledby={`${id}-accounts`}>
        <h3 id={`${id}-accounts`} ref={accountsHeadingRef} tabIndex={-1}>
          <span className={styles.accountsHeading}>
            <span>
              <b className={styles.accountHeadingLabel}>{t('quota_pool.accounts')}</b>
            </span>
            {/* Reset facts and data-reporting facts are one wrapping group of label/value pairs. */}
            {(resetTotals.available > 0 || coverageMissing) && (
              <span className={styles.accountSummary}>
                {resetTotals.available > 0 && (
                  <SummaryFact label={t('quota_pool.resets')}>
                    {resetTotals.available}
                    {resetKindTotals && (
                      <span className={styles.resetKindTotals}>
                        {' · '}
                        <ResetKindCounts kinds={resetKindTotals} />
                      </span>
                    )}
                  </SummaryFact>
                )}
                {resetTotals.available > 0 && resetTotals.usable > 0 && (
                  <SummaryFact label={t('quota_pool.reset_usable_summary')}>
                    {resetTotals.usable}
                  </SummaryFact>
                )}
                {/* The card header already counts the accounts; say coverage only when some are missing.
                    In the 5-hour view an account without that limit is excluded, not missing. */}
                {coverageMissing && staleAccounts.length > 0 ? (
                  <>
                    <SummaryFact label={t('quota_pool.summary_current')}>
                      {pool.loadedCount}
                    </SummaryFact>
                    <SummaryFact label={t('quota_pool.summary_stale')}>
                      {staleAccounts.length}
                    </SummaryFact>
                  </>
                ) : coverageMissing && noLimitCount > 0 ? (
                  <>
                    <SummaryFact label={t('quota_pool.summary_five_hour_limit')}>
                      {t('quota_pool.summary_x_of_y', {
                        x: pool.eligibleCount,
                        y: pool.accountCount,
                      })}
                    </SummaryFact>
                    {pool.loadedCount < pool.eligibleCount && (
                      <SummaryFact label={t('quota_pool.summary_reporting')}>
                        {t('quota_pool.summary_x_of_y', {
                          x: pool.loadedCount,
                          y: pool.eligibleCount,
                        })}
                      </SummaryFact>
                    )}
                  </>
                ) : (
                  coverageMissing && (
                    <SummaryFact label={t('quota_pool.summary_reporting')}>
                      {t('quota_pool.summary_x_of_y', {
                        x: pool.loadedCount,
                        y: pool.eligibleCount,
                      })}
                    </SummaryFact>
                  )
                )}
              </span>
            )}
          </span>
          {pool.accounts.length > 0 && (
            <button
              type="button"
              className={styles.expandAccounts}
              aria-expanded={allOpen}
              onClick={() =>
                setOpenAccounts(allOpen ? new Set() : new Set(pool.accounts.map((a) => a.id)))
              }
            >
              {t(allOpen ? 'quota_pool.collapse_accounts' : 'quota_pool.expand_accounts')}
            </button>
          )}
        </h3>
        {(showRosterControls || affectedOnly) && (
          <div className={styles.rosterTools}>
            {showRosterControls && (
              <>
                {/* The label stays in view whatever is typed; it is the field's accessible name, so a
                    placeholder would only repeat it. */}
                <label className={styles.rosterSearch}>
                  <span className={styles.rosterSearchLabel}>{t('quota_pool.account_search')}</span>
                  <input
                    type="search"
                    value={rosterQuery}
                    onChange={(event) => setRosterQuery(event.target.value)}
                  />
                </label>
                {/* Like the search field, the pill carries a visible prefix; the select inside keeps the
                    accessible name "Sort accounts", which starts with it. */}
                <label className={styles.rosterSort}>
                  <span className={styles.rosterSearchLabel}>
                    {t('quota_pool.account_sort_label')}
                  </span>
                  <select
                    value={rosterSort}
                    onChange={(event) => setRosterSort(event.target.value as AccountSort)}
                    aria-label={t('quota_pool.account_sort')}
                  >
                    <option value="name">{t('quota_pool.sort_name')}</option>
                    <option value="lowest">{t('quota_pool.sort_lowest')}</option>
                  </select>
                </label>
              </>
            )}
            {(affectedOnly || (showRosterControls && affectedAccounts.length > 0)) && (
              <button
                type="button"
                className={styles.rosterLow}
                aria-pressed={affectedOnly}
                onClick={() => {
                  setAffectedOnly((value) => !value);
                  setLowOnly(false);
                }}
              >
                {affectedOnly ? (
                  <IconCheck size={14} aria-hidden="true" />
                ) : (
                  <IconAlertTriangle size={14} aria-hidden="true" />
                )}
                {t('quota_pool.accounts_affected', { count: affectedAccounts.length })}
              </button>
            )}
            {showRosterControls && (lowAccountCount > 0 || lowOnly) && (
              <button
                type="button"
                className={styles.rosterLow}
                aria-pressed={lowOnly}
                onClick={() => {
                  setLowOnly((value) => !value);
                  setAffectedOnly(false);
                }}
              >
                {lowOnly ? (
                  <IconCheck size={14} aria-hidden="true" />
                ) : (
                  <IconAlertTriangle size={14} aria-hidden="true" />
                )}
                {/* Off says what pressing does and what the count counts ("Show 40 …"); on says it is
                    filtering, and the × says a second press clears it (the blind A/B kept these words). */}
                {t(lowOnly ? 'quota_pool.accounts_low_on' : 'quota_pool.accounts_low', {
                  count: lowAccountCount,
                })}
                {lowOnly && <IconX size={14} aria-hidden="true" className={styles.rosterClear} />}
              </button>
            )}
            {/* Always the last item: D of T shown; while filtering, D of F matches shown · T total.
                When every match is on screen (D = F) it says "F of T match" once; no match says so. */}
            <span className={styles.rosterCount} role="status">
              {!(query || lowOnly || affectedOnly)
                ? t('quota_pool.accounts_shown', {
                    shown: pageAccounts.length,
                    total: pool.accounts.length,
                  })
                : visibleAccounts.length === 0
                  ? t('quota_pool.accounts_no_match', { count: 0, total: pool.accounts.length })
                  : pageAccounts.length < visibleAccounts.length
                    ? t('quota_pool.accounts_matches_shown', {
                        shown: pageAccounts.length,
                        count: visibleAccounts.length,
                        total: pool.accounts.length,
                      })
                    : t('quota_pool.accounts_match_only', {
                        count: visibleAccounts.length,
                        total: pool.accounts.length,
                      })}
            </span>
          </div>
        )}
        <div
          className={styles.accountGrid}
          data-large={showRosterControls}
          data-balance-column={!balanceHasColumn}
          data-slots={limitColumns.filter((column) => columnStatus.has(column.id)).length}
          style={
            {
              '--limit-cols': Math.max(1, limitColumns.length),
              // A column with a status slot is that much wider than one without, so every bar is as long.
              '--slotted-cols': limitColumns.filter((column) => columnStatus.has(column.id)).length,
              '--limit-tracks': limitColumns
                .map((column) =>
                  columnStatus.has(column.id) ? 'var(--limit-slotted)' : 'var(--limit-plain)'
                )
                .join(' '),
            } as CSSProperties
          }
        >
          {/* Phones have no column heading, so one line per card says what the bold limit is. */}
          {visibleAccounts.length > 0 && (
            <p className={styles.phoneCountsNote}>
              {t('quota_pool.counts_toward_total_phone', { window: windowLabel })}
            </p>
          )}
          {visibleAccounts.length > 0 && (
            <div className={styles.accountHead} aria-hidden="true">
              <span />
              <span>{t('quota_pool.account_column')}</span>
              <span>{t('quota_pool.plan_column')}</span>
              {limitColumns.map((limit) => (
                <span key={limit.id} data-counted={limit.id === countedLimitId || undefined}>
                  {limitLabel(limit)}
                  {limit.id === countedLimitId && (
                    <small>{t('quota_pool.counts_toward_total')}</small>
                  )}
                </span>
              ))}
              {!balanceHasColumn && (
                <span>{t('quota_pool.account_remaining', { window: windowLabel })}</span>
              )}
            </div>
          )}
          {pool.accounts.length === 0 ? (
            <p className={styles.stateNote}>{t('quota_pool.state_note.no-accounts')}</p>
          ) : visibleAccounts.length === 0 ? (
            <p className={styles.stateNote} role="status">
              {t('quota_pool.no_account_matches')}
            </p>
          ) : (
            pageAccounts.map((account) => (
              <details
                key={account.id}
                className={styles.account}
                data-status={account.status}
                data-phone-blocks={phoneBlocks(account) || undefined}
                data-unavailable-cell={
                  account.windows.some((limit) => limit.remainingPercent === null) || undefined
                }
                open={openAccounts.has(account.id)}
                onToggle={(event) => setAccountOpen(account.id, event.currentTarget.open)}
              >
                <summary aria-expanded={openAccounts.has(account.id)}>
                  <IconChevronDown
                    className={styles.accountDisclosure}
                    size={20}
                    aria-hidden="true"
                  />
                  <span className={styles.accountName}>
                    <span className={styles.accountLabel}>
                      <span className={styles.accountText}>{accountName(account)}</span>
                      {/* One compact badge beside the name, so the Plan cell holds only the plan. */}
                      {account.resets &&
                        account.resets.available > 0 &&
                        !wasSpent(account.id, account.resets.observedAtMs) && (
                          <span
                            className={styles.accountResetMarker}
                            data-usable={account.resets.usable > 0 || undefined}
                          >
                            <ResetChip resets={account.resets} now={now} />
                          </span>
                        )}
                    </span>
                    <small className={styles.accountPlan}>
                      {account.plan.known && account.plan.label
                        ? t('quota_pool.account_plan', {
                            plan: account.plan.label,
                            points: number(account.plan.capacityPoints),
                          })
                        : t('quota_pool.account_plan_unknown', {
                            points: number(account.plan.capacityPoints),
                          })}
                    </small>
                  </span>
                  <span className={styles.accountStatus}>
                    {account.status === 'stale' ? (
                      <>
                        <span className={styles.staleWord}>
                          <IconClock className={styles.staleIcon} size={14} aria-hidden="true" />
                          {t('quota_pool.account_status.stale')}
                        </span>{' '}
                        {/* "Last reading …" wraps as one unit, never between its words. */}
                        <span className={styles.staleSince}>
                          <span className={styles.staleDot}>· </span>
                          {t('quota_pool.observed')}{' '}
                          <span className={styles.nowrap}>{date(account.observedAtMs)}</span>
                        </span>
                      </>
                    ) : account.status === 'no-limit' ? (
                      t('quota_pool.no_window_limit', { window: windowLabel })
                    ) : account.status === 'missing-window' || account.status === 'error' ? (
                      t('quota_pool.window_unavailable', { window: windowLabel })
                    ) : (
                      t(`quota_pool.account_status.${account.status}`)
                    )}
                  </span>
                  <strong data-low={isLowQuota(account.remainingPercent) || undefined}>
                    <span className={styles.valueAmount}>
                      {isLowQuota(account.remainingPercent) && lowMark}
                      {/* An account without this limit says so in the value slot, once. */}
                      {account.status === 'no-limit' ? (
                        <span className={styles.noLimitValue}>
                          {t('quota_pool.no_window_limit', { window: windowLabel })}
                        </span>
                      ) : account.remainingPercent === null ? (
                        '—'
                      ) : (
                        percent(account.remainingPercent)
                      )}
                    </span>
                    {/* Phones have no column heading over this value, so it names its limit. */}
                    {account.status !== 'no-limit' && (
                      <span className={styles.valueCaption}>{windowLabel}</span>
                    )}
                  </strong>
                  {account.windows.length > 0 && (
                    <ul className={styles.limits} aria-label={t('quota_pool.limits')}>
                      {/* Wide screens keep one column per limit, so a limit this account lacks is a visible gap.
                          Phones show only the active window's gap, as its block, ahead of the other limits. */}
                      {limitColumns
                        .filter(
                          (column) =>
                            column.id === countedLimitId &&
                            !account.windows.some((limit) => limit.id === column.id)
                        )
                        .map((column) => missingLimit(account, column))}
                      {[...account.windows]
                        .sort(
                          (a, b) =>
                            Number(b.id === countedLimitId) - Number(a.id === countedLimitId)
                        )
                        .map((limit) => (
                          <li
                            key={limit.id}
                            data-limit-id={limit.id}
                            data-low={isLowQuota(limit.remainingPercent)}
                            data-counted={limit.id === countedLimitId || undefined}
                            style={
                              {
                                '--col':
                                  limitColumns.findIndex((column) => column.id === limit.id) + 1,
                              } as CSSProperties
                            }
                          >
                            <span>{limitLabel(limit)}</span>
                            <strong>
                              {/* The slot holds this row's mark; the hidden ghosts size it to the column's widest. */}
                              {columnStatus.get(limit.id) && (
                                <span className={styles.limitStatus}>
                                  {isLowQuota(limit.remainingPercent) && lowMark}
                                  {limit.remainingPercent === null && (
                                    <span className={styles.unavailableWord}>
                                      <IconAlertTriangle size={14} aria-hidden="true" />
                                      {t('quota_pool.value_unavailable')}
                                    </span>
                                  )}
                                  {columnStatus.get(limit.id)?.low && (
                                    <span
                                      className={styles.statusGhost}
                                      data-word={t('quota_pool.limit_low')}
                                      aria-hidden="true"
                                    />
                                  )}
                                  {columnStatus.get(limit.id)?.unavailable && (
                                    <span
                                      className={`${styles.statusGhost} ${styles.unavailableGhost}`}
                                      data-word={t('quota_pool.value_unavailable')}
                                      aria-hidden="true"
                                    />
                                  )}
                                </span>
                              )}
                              {limit.remainingPercent !== null && (
                                <span className={styles.limitValue}>
                                  {percent(limit.remainingPercent)}
                                </span>
                              )}
                            </strong>
                            {/* A missing value gets an empty dashed track (phones), so it can't read as 0%. */}
                            <span
                              className={styles.limitBar}
                              data-empty={limit.remainingPercent === null || undefined}
                              aria-hidden="true"
                            >
                              {limit.remainingPercent !== null && (
                                <span style={{ width: `${limit.remainingPercent}%` }} />
                              )}
                            </span>
                            {limit.resetAtMs !== null && (
                              <small>
                                {t('quota_pool.limit_resets', { date: date(limit.resetAtMs) })}
                              </small>
                            )}
                          </li>
                        ))}
                      {limitColumns
                        .filter(
                          (column) =>
                            column.id !== countedLimitId &&
                            !account.windows.some((limit) => limit.id === column.id)
                        )
                        .map((column) => missingLimit(account, column))}
                    </ul>
                  )}
                </summary>
                <div className={styles.accountFacts}>
                  <FactPanel>
                    {/* One reset section per open row; the keys let it move without remounting. */}
                    {stackedFacts && resetSection(account)}
                    <FactSection key="usage" title={t('quota_pool.facts_usage')}>
                      <Fact
                        label={t('quota_pool.observed')}
                        {...(account.observedAtMs !== null
                          ? { state: 'known' as const, value: date(account.observedAtMs) }
                          : {
                              state: 'notReported' as const,
                              reason: t('quota_pool.usage_not_reported_reason'),
                            })}
                      />
                      {!account.windows.some((limit) => limit.resetAtMs === account.resetAtMs) && (
                        <Fact
                          label={t('quota_pool.account_reset', { window: windowLabel })}
                          {...(account.resetAtMs !== null
                            ? { state: 'known' as const, value: date(account.resetAtMs) }
                            : {
                                state: 'notReported' as const,
                                reason: t('quota_pool.reset_time_not_reported_reason'),
                              })}
                        />
                      )}
                      <Fact
                        label={t(
                          dashboard.window === 'weekly'
                            ? 'quota_pool.predicted_empty_weekly'
                            : 'quota_pool.predicted_empty_five_hour'
                        )}
                        {...(pool.forecastState === 'ready' && account.status === 'ok'
                          ? {
                              state: 'known' as const,
                              value: forecastDate(account.emptyAtMs, true),
                            }
                          : {
                              state: 'notReported' as const,
                              reason: t('quota_pool.forecast_not_reported_reason'),
                            })}
                      />
                      <Fact
                        label={t('quota_pool.burn_last', { hours: dashboard.lookbackHours })}
                        {...(account.burnPointsPerHour !== null
                          ? {
                              state: 'known' as const,
                              value: `${number(account.burnPointsPerHour)} ${t('quota_pool.points_hour')}`,
                            }
                          : {
                              state: 'notReported' as const,
                              reason: t('quota_pool.forecast_not_reported_reason'),
                            })}
                      />
                    </FactSection>
                    <FactSection key="billing" title={t('quota_pool.facts_billing')}>
                      <BillingFacts
                        billing={account.billing ?? null}
                        nowMs={dashboard.nowMs}
                        formatDate={date}
                        basisOverrides={ESTIMATE_BASIS_OVERRIDES}
                      />
                    </FactSection>
                    {!stackedFacts && resetSection(account)}
                  </FactPanel>
                </div>
              </details>
            ))
          )}
        </div>
        {pageAccounts.length < visibleAccounts.length && (
          <div className={styles.rosterFooter}>
            <button
              type="button"
              className={`${styles.expandAccounts} ${styles.showAll}`}
              onClick={() => setShowAll(true)}
            >
              {t('quota_pool.show_more_accounts', {
                count: visibleAccounts.length - pageAccounts.length,
              })}
            </button>
          </div>
        )}
        {/* After the list and its Show more footer, never inside a row or a disclosure. */}
        {hasEstimatedRenewal && (
          <p className={styles.renewalCaveat}>{t('quota_pool.billing_estimate_caveat')}</p>
        )}
      </section>
    </article>
  );
}
