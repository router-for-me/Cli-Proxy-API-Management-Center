import { Fact, FactSection } from '@/components/ui/FactPanel';
import { IconAlertTriangle } from '@/components/ui/icons';
import { Fragment, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PoolAccount, PoolProviderId } from '@/domain/quotaPool/types';
import type { AuthFileItem } from '@/types';
import { sourceOwnerKey, type SourceSession } from '@/services/api/sourceSession';
import { useProviderSources } from '@/stores/useProviderSources';
import { useCredentialInventoryStore, useSourceFiles } from '@/stores/useCredentialInventoryStore';
import { sourceQuotaStore } from '@/stores/sourceQuotaStores';
import { useSourceLease } from '@/hooks/useSourceLease';
import { useServedByServer } from './useServerQuota';
import { useQuotaActions } from '@/features/quota/hooks/useQuotaActions';
import { createQuotaAdapters } from '@/features/quota/providers';
import { useClaudeResetGrants } from '@/features/quota/providers/claude/ClaudeResetGrants';
import { createSourceResetGrants } from '@/features/quota/providers/claude/resetGrantScope';
import { useNow } from '@/hooks/useNow';
import { resetAccountName } from '@/features/quota/logic';
import { formatRelativeInstant } from '@/utils/quota';
import type { AccountResets } from '@/domain/quotaPool/types';
import {
  findPoolResetFile,
  groupHeldResets,
  heldExpiries,
  heldResetKinds,
  heldResets,
  poolResetStatus,
  markSpent,
  wasSpent,
  type ResetKindCount,
} from './resetAccounts';
import { formatPoolDate } from './presentation';
import { useLastResetEvent } from './resetEvents';
import styles from './QuotaPoolPage.module.scss';

type Props = {
  account: PoolAccount;
  name: string;
  instanceId?: string;
  provider: PoolProviderId;
  onRefresh: (accountId?: string) => void;
};

type FactProps = Props & {
  spent: boolean;
  reason?: string;
  /** A live provider answer that supersedes the server's status (Claude found none usable). */
  live?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** The action's label when it isn't "Use reset", e.g. Claude's "Use reset…" for a choice. */
  actionLabel?: string;
};

/** "2 weekly · 3 Fable": held resets per kind, Fable in its own colour. */
export function ResetKindCounts({ kinds }: { kinds: ResetKindCount[] }) {
  const { t } = useTranslation();
  return kinds.map(({ kind, count }, index) => (
    <Fragment key={kind}>
      {index > 0 && ' · '}
      <span data-kind={kind}>{t(`quota_pool.reset_count_${kind}`, { count })}</span>
    </Fragment>
  ));
}

/**
 * Each held reset's expiry, soonest first, with the time left, so the operator can see how long
 * each one lasts before it lapses. Claude readings lead each line with the reset's kind, so a
 * Fable reset reads apart from a standard one, and resets of one kind that end together share a
 * line ("Fable reset × 2"). No line is marked as the one spent next: Claude's dialog lets the
 * operator pick, and Codex's redeem call names no credit.
 */
function ResetExpiries({ resets }: { resets: AccountResets }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const expiries = heldResets(resets, now);
  if (!expiries.length) return null;
  const undated = resets.available - expiries.length;
  return (
    <Fact
      label={t('quota_pool.reset_expiries_label', { count: expiries.length })}
      state="known"
      value={
        <ol className={styles.resetExpiries} data-kinds={expiries[0]!.kind ? '' : undefined}>
          {groupHeldResets(expiries).map(({ at, kind, count, first }) => {
            const times = count > 1 ? ` × ${count}` : '';
            return (
              <li key={`${at}-${first}`}>
                {kind && (
                  <span className={styles.resetKind} data-kind={kind}>
                    {t(`claude_reset.kind_${kind}`)}
                    {times}
                  </span>
                )}
                <span className={styles.resetExpiryWhen}>
                  <span>
                    {formatPoolDate(at, i18n.language)}
                    {!kind && times}
                  </span>
                  <span className={styles.resetExpiryLeft}>
                    {formatRelativeInstant(at, now, i18n.language)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      }
      aside={undated > 0 ? t('quota_pool.reset_expiry_undated', { count: undated }) : undefined}
    />
  );
}

function ResetFact({
  account,
  name,
  provider,
  spent,
  reason,
  live = false,
  disabled = true,
  onClick,
  actionLabel,
}: FactProps) {
  const { t } = useTranslation();
  const now = useNow();
  const resets = account.resets;
  const status = poolResetStatus(resets, provider, spent);
  const kinds = resets && !spent ? heldResetKinds(resets, now) : null;
  if (!resets || !status)
    return (
      <FactSection title={t('quota_pool.resets')} tone="accent">
        <Fact
          label={t('quota_pool.reset_held_label')}
          state="notReported"
          reason={t('quota_pool.reset_not_reported_reason')}
        />
      </FactSection>
    );
  const aside = [
    !live && status.statusKey && t(status.statusKey, { usable: resets.usable }),
    !spent && reason,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <FactSection
      title={t('quota_pool.resets')}
      tone="accent"
      {...(resets.available > 0 || spent
        ? {
            action: {
              label: actionLabel ?? t('quota_pool.use_reset'),
              context: t('quota_pool.reset_action_context', { name }),
              disabled,
              onClick: onClick ?? (() => {}),
            },
            note: aside || t('quota_pool.reset_unavailable'),
          }
        : { action: undefined })}
    >
      <Fact
        label={t('quota_pool.reset_held_label')}
        state="known"
        value={
          <>
            {t(status.valueKey, { count: resets.available })}
            {kinds && (
              <span className={styles.resetKindTotals}>
                {' · '}
                <ResetKindCounts kinds={kinds} />
              </span>
            )}
          </>
        }
      />
      {/* Its own fact, so the dates read as values instead of wrapping inside the status. */}
      {!spent && resets.available > 0 && <ResetExpiries resets={resets} />}
      <LastResetUsed provider={provider} accountId={account.id} />
    </FactSection>
  );
}

const APPLIED = new Set(['reset', 'already_used', 'already_redeemed']);

/** The newest reset recorded for this account by the server, from any page, with its result. */
function LastResetUsed({ provider, accountId }: { provider: Props['provider']; accountId: string }) {
  const { t, i18n } = useTranslation();
  const event = useLastResetEvent(provider, accountId);
  if (!event) return null;
  const kind = ['session', 'weekly', 'fable', 'full'].includes(event.kind)
    ? t(`claude_reset.kind_${event.kind}`)
    : t('quota_pool.reset_last_used_generic');
  return (
    <Fact
      label={t('quota_pool.reset_last_used_label')}
      state="known"
      value={
        <span data-reset-outcome={event.outcome}>
          {kind} · {formatPoolDate(event.requestedAtMs, i18n.language)}
          {!APPLIED.has(event.outcome) &&
            ` · ${t('quota_pool.reset_last_not_applied', { outcome: event.outcome })}`}
        </span>
      }
    />
  );
}

/** Pool readings stay server-owned; credentials load only on disclosure. */
export function PoolAccountResets(props: Props) {
  const { t } = useTranslation();
  const registry = useProviderSources();
  const resets = props.account.resets;
  if (!resets) return <ResetFact {...props} spent={false} />;
  const source = registry.sources.find((view) => view.source.instanceId === props.instanceId);
  const spent = wasSpent(props.account.id, resets.observedAtMs);
  const status = poolResetStatus(resets, props.provider, spent)!;
  if (
    resets.available > 0 &&
    (resets.usable > 0 || spent || status.early) &&
    source?.session &&
    source.status === 'ready'
  ) {
    return (
      <SourceResetAction
        key={sourceOwnerKey(source.session.owner)}
        {...props}
        owner={source.session}
        spent={spent}
        early={status.early}
      />
    );
  }
  return (
    <ResetFact
      {...props}
      spent={spent}
      reason={
        resets.available > 0 && !spent && (resets.usable > 0 || status.early)
          ? t('quota_pool.reset_source_unavailable')
          : undefined
      }
    />
  );
}

function SourceResetAction({
  owner,
  name,
  account,
  provider,
  onRefresh,
  spent,
  early,
}: Props & { owner: SourceSession; spent: boolean; early: boolean }) {
  const { session } = useSourceLease(owner);
  const { t } = useTranslation();
  // The credential files come from the one inventory store, so a removed or disabled credential
  // stops offering its reset in the same step every other screen drops it.
  const files = useSourceFiles(session.owner);
  const status = useCredentialInventoryStore((state) => state.status);
  useEffect(() => {
    void useCredentialInventoryStore.getState().ensureLoaded(session.owner);
  }, [session.owner]);
  const match = useMemo(
    () =>
      files
        ? findPoolResetFile(files, session.owner.instanceId, provider, account.sourceAccountId)
        : undefined,
    [files, session.owner.instanceId, provider, account.sourceAccountId]
  );
  const file: AuthFileItem | null = match && !match.disabled ? match : null;
  const error = files ? !file : status === 'error';
  const fact = { account, name, provider, onRefresh, spent };
  if (!file)
    return (
      <ResetFact
        {...fact}
        reason={t(error ? 'quota_pool.reset_lookup_failed' : 'quota_pool.reset_loading')}
      />
    );
  return provider === 'claude' ? (
    <ClaudeResetAction
      {...fact}
      file={file}
      session={session}
      source={owner}
      accountId={account.id}
    />
  ) : (
    <CodexResetAction
      {...fact}
      file={file}
      session={session}
      accountId={account.id}
      early={early}
    />
  );
}

type ActionProps = Props & {
  file: AuthFileItem;
  session: SourceSession;
  onRefresh: (accountId?: string) => void;
  accountId: string;
  /** A spend from this tab is newer than the server's reading. */
  spent: boolean;
};
function ClaudeResetAction({
  file,
  session,
  source,
  accountId,
  spent,
  ...fact
}: ActionProps & { source: SourceSession }) {
  const { t } = useTranslation();
  const scope = useMemo(() => {
    const shared = createSourceResetGrants(session);
    const run = shared.operations.run;
    return {
      ...shared,
      operations: {
        ...shared.operations,
        run: async (...args: Parameters<typeof run>) => {
          const answer = await run(...args);
          if (answer.code === 'reset' && !answer.unresolved) markSpent(accountId);
          return answer;
        },
      },
    };
  }, [session, accountId]);
  // The hook re-reads once when a claim finishes. That read goes into the source's shared quota
  // store, so Auth Files and the Quota page show the claim too; the claim itself already had the
  // history server re-read this one account (accountSync.ts), never the whole fleet. The read is
  // bound to the source session, not this panel's lease: the refreshed pool can drop the panel
  // (no resets left) while the read is still running, and the other pages still need its result.
  const store = sourceQuotaStore(source.owner);
  const adapters = useMemo(() => createQuotaAdapters(source, store), [source, store]);
  const { refreshQuota } = useQuotaActions(false, store, source);
  const readQuota = useCallback(
    (options?: { force?: boolean }) => void refreshQuota(file, adapters.claude, options),
    [refreshQuota, file, adapters]
  );
  // The pool row is already the history server's reading of this account: when the server serves
  // it, its held resets are shown from that and the hub is read for grants only when the claim
  // dialog opens (src/features/quota/RULES.md).
  const served = useServedByServer(source.owner.instanceId, 'claude');
  const reset = useClaudeResetGrants(
    file,
    true,
    false,
    null,
    readQuota,
    scope,
    false,
    served ? { resets: fact.account.resets } : undefined
  );
  return (
    <ResetFact
      {...fact}
      spent={spent}
      disabled={reset.blocked || spent}
      onClick={reset.confirm}
      actionLabel={t(
        reset.buttonLabel === 'retry'
          ? 'claude_reset.retry'
          : reset.buttonLabel === 'choose'
            ? 'claude_reset.choose_button'
            : 'quota_pool.use_reset'
      )}
      live={!spent && !reset.message && reset.blocked && !reset.busy && reset.count !== null}
      reason={
        spent && !reset.busy
          ? undefined
          : reset.message
            ? t(`claude_reset.${reset.message}`)
            : reset.blocked && !reset.busy
              ? // A finished read with nothing usable is not still loading; a running claim is neither.
                t(
                  reset.count === null
                    ? 'quota_pool.reset_loading'
                    : 'quota_pool.reset_claude_unavailable'
                )
              : undefined
      }
    />
  );
}
function CodexResetAction({
  file,
  session,
  accountId,
  spent,
  early,
  name,
  ...fact
}: ActionProps & { early: boolean }) {
  const { t, i18n } = useTranslation();
  const store = sourceQuotaStore(session.owner);
  const adapter = useMemo(() => {
    const codex = createQuotaAdapters(session, store).codex;
    const reset = codex.resetQuota!;
    return {
      ...codex,
      resetQuota: async (...args: Parameters<typeof reset>) => {
        try {
          return await reset(...args);
        } finally {
          // A confirmed attempt may have consumed the credit even if its cooldown clear or
          // follow-up read failed, so the row waits for the next reading either way. The adapter
          // already had the history server re-read this account.
          markSpent(accountId);
        }
      },
    };
  }, [session, store, accountId]);
  const actions = useQuotaActions(false, store, session);
  // Both confirmations name the soonest expiry the account holds when the dialog opens.
  const soonestFact = () => {
    const soonest = fact.account.resets
      ? heldExpiries(fact.account.resets, Date.now())[0]
      : undefined;
    return (
      soonest !== undefined && (
        <Fact
          label={t('quota_pool.reset_dialog_soonest')}
          state="known"
          value={formatPoolDate(soonest, i18n.language)}
        />
      )
    );
  };
  return (
    <ResetFact
      {...fact}
      name={name}
      spent={spent}
      disabled={actions.resettingQuotaName !== null || spent}
      onClick={() => {
        const soonest = soonestFact();
        // The dialog names the masked account even while the pool shows full addresses.
        const account = resetAccountName(file);
        actions.resetQuota(file, adapter, {
          title: t(early ? 'quota_pool.reset_early_title' : 'quota_pool.reset_confirm_title'),
          confirmText: t('quota_pool.use_reset'),
          variant: early ? 'danger' : 'primary',
          pill: true,
          message: early ? (
            <div className={styles.resetDialog}>
              <p>{t('quota_pool.reset_early_intro', { name: account })}</p>
              {soonest && <dl className={styles.resetFacts}>{soonest}</dl>}
              <section>
                <h4>{t('quota_pool.reset_usage_left')}</h4>
                <dl>
                  {fact.account.windows
                    .filter((limit) => limit.remainingPercent !== null)
                    .map((limit) => (
                      <div key={limit.id}>
                        <dt>{t(limit.labelKey, limit.labelParams)}</dt>
                        <dd>{limit.remainingPercent!.toFixed(1)}%</dd>
                      </div>
                    ))}
                </dl>
                {fact.account.windows.every((limit) => limit.remainingPercent === null) && (
                  <p>{t('quota_pool.reset_left_unknown')}</p>
                )}
              </section>
              <p>{t('quota_pool.reset_early_outcome')}</p>
            </div>
          ) : (
            <div>
              <dl className={styles.resetFacts}>
                <Fact label={t('codex_quota.reset_dialog_account')} state="known" value={account} />
                <Fact
                  label={t('codex_quota.reset_dialog_used')}
                  state="known"
                  value={
                    fact.account.resets
                      ? t('codex_quota.reset_dialog_used_of', {
                          held: fact.account.resets.available,
                        })
                      : '1'
                  }
                />
                {soonest}
                {/* The reset lifts Codex's rate limits (credit type codex_rate_limits); the credit
                    doesn't list windows, so the dialog names the limits this account reports. */}
                <Fact
                  label={t('codex_quota.reset_dialog_limits')}
                  state="known"
                  value={
                    fact.account.windows.length > 0
                      ? fact.account.windows
                          .map((limit) => t(limit.labelKey, limit.labelParams))
                          .join(' · ')
                      : t('codex_quota.reset_dialog_limits_unknown')
                  }
                />
              </dl>
              <p className={styles.resetWarning}>
                <IconAlertTriangle size={14} aria-hidden="true" />
                {t('codex_quota.reset_dialog_irreversible')}
              </p>
            </div>
          ),
        });
      }}
    />
  );
}
