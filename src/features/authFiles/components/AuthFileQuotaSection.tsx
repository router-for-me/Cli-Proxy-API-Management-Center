import { AccountDetails } from '@/features/quota/components/AccountDetails';
import { useClaudeResetGrants } from '@/features/quota/providers/claude/ClaudeResetGrants';
import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';
import { getStatusFromError, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { isRuntimeOnlyAuthFile, type QuotaProviderType } from '@/features/authFiles/constants';
import { isCredentialDisabled } from '@/features/authFiles/credentialFacts';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { bindQuotaClasses } from '@/features/quota/types';
import { resetAccountName } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import { useAuthFilesSource, useAuthFilesNotifications } from '../AuthFilesSourceContext';
import { hasClaudeUsageData } from '@/features/quota/providers/claude/data';
import { QuotaFreshness } from '@/features/quota/components/QuotaFreshness';
import { beginLoading } from '@/features/quota/quotaLoading';
import { isQuotaFresh } from '@/features/quota/quotaFreshness';
import { providerSources } from '@/stores/useProviderSources';
import { useServerAccountsStore } from '@/stores/useServerAccountsStore';
import { refreshServedFile, serverReadNotice } from '@/features/quotaPool/serverQuota';
import { useServedByServer, useServerAccount } from '@/features/quotaPool/useServerQuota';
import {
  selectQuotaSlotState,
  type QuotaSlotState,
  type QuotaUnavailableReason,
} from '@/features/authFiles/quotaSlot';
import styles from './AuthFileQuota.module.scss';

/** Bind the auth-file host's compact styles to the quota rendering contract. */
const compactQuotaClasses = bindQuotaClasses(styles, 'AuthFileQuota.module.scss');

const assertNever = (value: never): never => {
  throw new Error(`Unsupported quota type: ${value}`);
};

type QuotaMapUpdater = (
  updater: (prev: Record<string, QuotaCardState>) => Record<string, QuotaCardState>
) => void;

export type AuthFileQuotaSectionProps = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  disableControls: boolean;
};

export function AuthFileQuotaSection(props: AuthFileQuotaSectionProps) {
  const { file, quotaType, disableControls } = props;
  const { t, i18n } = useTranslation();
  const sourceScope = useAuthFilesSource();
  const useQuotaStore = sourceScope.quotaStore;
  const { showNotification, showConfirmation } = useAuthFilesNotifications();
  const [resettingQuota, setResettingQuota] = useState(false);
  const adapter = sourceScope.quotaAdapters[quotaType];
  const cacheKey = getQuotaCacheKey(file);
  // Switched off: its quota is still read, but it serves nothing and its resets stay unspent.
  const accountOff = isCredentialDisabled(file);
  // Claude and Codex accounts of a source the history server covers are read there, not on the
  // hub; a switched-off one is the named exception: its explicit Refresh is the live hub read.
  const instanceId = sourceScope.session.owner.instanceId;
  const served = useServedByServer(instanceId, quotaType) && !isRuntimeOnlyAuthFile(file);
  const serverAccount = useServerAccount(instanceId, quotaType, file);
  const [serverReading, setServerReading] = useState(false);

  const quota = useQuotaStore((state) => {
    if (quotaType === 'antigravity')
      return state.antigravityQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'claude') return state.claudeQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'codex') return state.codexQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'devin') return state.devinQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'kimi') return state.kimiQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'meta') return state.metaQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'plugin') return state.pluginQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'xai') return state.xaiQuota[cacheKey] as QuotaCardState | undefined;
    return assertNever(quotaType);
  });
  const retainedClaudeUsage =
    quotaType === 'claude' && hasClaudeUsageData(quota as ClaudeQuotaState | undefined);
  const fetchedAt = useQuotaStore((state) => state.fetchedAt[cacheKey]);
  const nextReadAt = useQuotaStore((state) => state.nextReadAt[cacheKey]);

  const updateQuotaState = useQuotaStore(
    (state) => state[adapter.storeSetter] as unknown as QuotaMapUpdater
  );

  const readQuotaForFile = useCallback(async () => {
    if (disableControls || !sourceScope.isCurrent()) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (quota?.status === 'loading' || resettingQuota) return;

    const cacheGeneration = captureQuotaCacheGeneration(file.name, sourceScope.quotaStore);

    const release = beginLoading(adapter, sourceScope.quotaStore, [cacheKey]);

    try {
      const data = await adapter.fetchQuota(file, t);
      sourceScope.assertCurrent();
      commitIfQuotaCacheCurrent(cacheGeneration, () => {
        updateQuotaState((prev) => ({
          ...prev,
          [cacheKey]: adapter.buildSuccessState(data),
        }));
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      });
    } catch (err: unknown) {
      if (!sourceScope.isCurrent()) return release();
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      commitIfQuotaCacheCurrent(cacheGeneration, () => {
        updateQuotaState((prev) => ({
          ...prev,
          [cacheKey]: adapter.buildErrorState(message, status),
        }));
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message }),
          'error'
        );
      });
    }
  }, [
    adapter,
    cacheKey,
    disableControls,
    file,
    quota?.status,
    resettingQuota,
    showNotification,
    sourceScope,
    t,
    updateQuotaState,
  ]);

  // A reading under a minute old is kept (quotaFreshness.ts); force: after a reset claim, which
  // changed the quota the last reading shows.
  const refreshQuotaForFile = useCallback(
    (options?: { force?: boolean }) => {
      if (served && !accountOff) {
        // After a claim the server has already been asked (accountSync.ts): read its numbers.
        if (options?.force) return void useServerAccountsStore.getState().pollFresh();
        if (serverReading || disableControls || !sourceScope.isCurrent()) return;
        setServerReading(true);
        void refreshServedFile({
          owner: sourceScope.session.owner,
          file,
          store: sourceScope.quotaStore,
        })
          .then((outcome) => {
            if (!sourceScope.isCurrent()) return;
            const notice = serverReadNotice(outcome, {
              name: file.name,
              t,
              language: i18n.language,
              readAtMs: sourceScope.quotaStore.getState().fetchedAt[cacheKey],
              nowMs: Date.now(),
            });
            showNotification(notice.text, notice.type);
          })
          .finally(() => setServerReading(false));
        return;
      }
      const readAt = sourceScope.quotaStore.getState().fetchedAt[cacheKey];
      if (!options?.force && isQuotaFresh(readAt, Date.now())) {
        showNotification(t('auth_files.quota_reused', { name: file.name }), 'info');
        return;
      }
      // A card's read can be several requests (Claude: usage and profile); the hub proves the
      // key with the first (services/api/authGate.ts).
      providerSources.armAuthProbes();
      void readQuotaForFile();
    },
    [
      accountOff,
      cacheKey,
      disableControls,
      file,
      i18n.language,
      readQuotaForFile,
      served,
      serverReading,
      showNotification,
      sourceScope,
      t,
    ]
  );

  const resetQuotaForFile = useCallback(() => {
    if (disableControls || !sourceScope.isCurrent()) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (accountOff) return;
    if (quota?.status === 'loading') return;
    if (resettingQuota) return;

    const resetQuota = adapter.resetQuota;
    if (!resetQuota) return;

    const name = resetAccountName(file);
    showConfirmation({
      title: t('quota_pool.reset_confirm_title'),
      message: t('codex_quota.reset_confirm_message', { name }),
      confirmText: t('quota_pool.use_reset'),
      variant: 'primary',
      onConfirm: async () => {
        const cacheGeneration = captureQuotaCacheGeneration(file.name, sourceScope.quotaStore);
        setResettingQuota(true);
        try {
          const data = await resetQuota(file, t);
          sourceScope.assertCurrent();
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            updateQuotaState((prev) => ({
              ...prev,
              [cacheKey]: adapter.buildSuccessState(data),
            }));
            showNotification(t('codex_quota.reset_success', { name }), 'success');
          });
        } catch (err: unknown) {
          if (!sourceScope.isCurrent()) return;
          const message = err instanceof Error ? err.message : t('common.unknown_error');
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            showNotification(t('codex_quota.reset_failed', { name, message }), 'error');
          });
        } finally {
          setResettingQuota(false);
        }
      },
    });
  }, [
    accountOff,
    adapter,
    cacheKey,
    disableControls,
    file,
    quota?.status,
    resettingQuota,
    showConfirmation,
    showNotification,
    sourceScope,
    t,
    updateQuotaState,
  ]);

  const quotaStatus = quota?.status ?? 'idle';
  const canRefreshQuota = !disableControls && !resettingQuota;
  const claudeReset = useClaudeResetGrants(
    file,
    quotaType === 'claude' && quotaStatus !== 'idle',
    !canRefreshQuota || quotaStatus === 'loading',
    quota,
    refreshQuotaForFile,
    adapter.resetGrants,
    accountOff,
    // Served from the history server: its reading shows the held resets, and the hub is read
    // for the grants only when the claim dialog opens (a named exception).
    served && quotaType === 'claude' ? { resets: serverAccount?.resets ?? null } : undefined
  );
  // A plain boolean: handing the store-derived value on directly costs the compiler's memoization.
  const hasQuotaData = quotaStatus === 'success' || retainedClaudeUsage === true;
  const slot = selectQuotaSlotState({ reason: null, status: quotaStatus, hasData: hasQuotaData });
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );
  const failureText = t(`${adapter.i18nPrefix}.load_failed`, { message: quotaErrorMessage });
  // A refresh mid-claim would drop the claim's result and its follow-up refresh.
  const refreshDisabled =
    !canRefreshQuota || quotaStatus === 'loading' || serverReading || claudeReset.busy;
  const refresh = () => {
    if (!claudeReset.busy) void refreshQuotaForFile();
  };
  const reading = slot.kind === 'loading' || (slot.kind === 'loaded' && slot.refreshing);
  // Account details belong to read quota; Claude's reset grants are read even after a failure.
  const showDetails = slot.kind === 'loaded' || (slot.kind === 'failed' && quotaType === 'claude');

  return (
    <QuotaSlotFrame
      state={slot.kind}
      stateText={
        slot.kind === 'idle'
          ? t('auth_files.quota_not_loaded')
          : reading
            ? t('common.loading')
            : slot.kind === 'failed' || (slot.kind === 'loaded' && slot.stale)
              ? t('auth_files.quota_failed')
              : slot.kind === 'loaded' && (
                  <QuotaFreshness fetchedAt={fetchedAt} nextReadAtMs={nextReadAt} />
                )
      }
      stateTitle={slot.kind === 'failed' || slot.kind === 'loaded' ? failureText : undefined}
      danger={slot.kind === 'failed' || (slot.kind === 'loaded' && slot.stale)}
      accountOff={accountOff}
      withDetails={showDetails}
      refresh={{
        disabled: refreshDisabled,
        spinning: quotaStatus === 'loading' || serverReading,
        title: t('auth_files.quota_refresh_hint'),
        onClick: refresh,
      }}
    >
      {slot.kind === 'idle' && <QuotaPlaceholderRows />}
      {slot.kind === 'loading' && <QuotaPlaceholderRows loading />}
      {slot.kind === 'failed' && (
        <div className={styles.quotaFailure} role="alert">
          <p className={styles.quotaError} title={failureText}>
            {failureText}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={refresh}
            disabled={refreshDisabled}
          >
            {t('auth_files.retry')}
          </Button>
        </div>
      )}
      {slot.kind === 'loaded' && quota && (
        <div className={styles.quotaBody}>
          <adapter.Body quota={quota} classes={compactQuotaClasses} factsInPanel fixedSlots />
        </div>
      )}
      {showDetails && (
        <AccountDetails
          provider={quotaType}
          quota={slot.kind === 'loaded' ? quota : undefined}
          name={file.name}
          defaultOpen
          rows
          compact
          accountOff={accountOff}
          claudeReset={quotaType === 'claude' ? claudeReset : undefined}
          reset={
            quotaType === 'codex' && adapter.resetQuota
              ? {
                  disabled:
                    !canRefreshQuota ||
                    accountOff ||
                    quotaStatus === 'loading' ||
                    !quota ||
                    !adapter.canResetQuota?.(quota),
                  onClick: resetQuotaForFile,
                }
              : undefined
          }
        />
      )}
    </QuotaSlotFrame>
  );
}

/** "No quota for this credential": the same frame and size as every other quota state. */
export function AuthFileQuotaUnavailable({ reason }: { reason: QuotaUnavailableReason }) {
  const { t } = useTranslation();
  const why = t(`auth_files.quota_none_${reason}`);
  return (
    <QuotaSlotFrame
      state="unavailable"
      stateText=""
      refresh={{ disabled: true, spinning: false, title: why, onClick: () => {} }}
    >
      <div className={styles.quotaUnavailable}>
        <p className={styles.quotaUnavailableTitle}>{t('auth_files.quota_none')}</p>
        <p className={styles.quotaUnavailableReason}>{why}</p>
      </div>
    </QuotaSlotFrame>
  );
}

/** The quota slot of a loading card skeleton. */
export function AuthFileQuotaSkeleton() {
  return (
    <QuotaSlotFrame
      state="loading"
      stateText=""
      refresh={{ disabled: true, spinning: false, title: '', onClick: () => {} }}
    >
      <QuotaPlaceholderRows loading />
    </QuotaSlotFrame>
  );
}

/** The fixed header of the quota slot: label, state, and the card's own refresh icon. */
function QuotaSlotFrame({
  state,
  stateText,
  stateTitle,
  danger = false,
  accountOff = false,
  withDetails = false,
  refresh,
  children,
}: {
  state: QuotaSlotState['kind'];
  stateText: ReactNode;
  stateTitle?: string;
  danger?: boolean;
  /** The credential is switched off: the header says so beside the quota it still reads. */
  accountOff?: boolean;
  /** Account details follow; without them the state's message takes the rest of the frame. */
  withDetails?: boolean;
  refresh: { disabled: boolean; spinning: boolean; title: string; onClick: () => void };
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section
      className={styles.quotaSection}
      data-quota-state={state}
      aria-label={t('auth_files.quota_slot_label')}
      aria-busy={state === 'loading' || undefined}
      data-details={withDetails}
    >
      <div className={styles.quotaHead}>
        <span className={styles.quotaEyebrow}>{t('auth_files.quota_slot_label')}</span>
        {accountOff && (
          <span className={styles.quotaOff} title={t('quota_management.account_off_hint')}>
            {t('quota_management.account_off')}
          </span>
        )}
        <span
          className={`${styles.quotaState} ${danger ? styles.quotaStateDanger : ''}`}
          title={stateTitle}
        >
          {stateText}
        </span>
        <button
          type="button"
          className={styles.quotaRefreshIcon}
          onClick={refresh.onClick}
          disabled={refresh.disabled}
          title={refresh.title}
          aria-label={t('auth_files.quota_refresh_hint')}
        >
          <IconRefreshCw
            size={13}
            aria-hidden="true"
            className={refresh.spinning ? styles.quotaRefreshSpin : undefined}
          />
        </button>
      </div>
      {children}
    </section>
  );
}

/** Empty tracks (not loaded) or shimmering ones (loading), in the shape of read quota. */
function QuotaPlaceholderRows({ loading = false }: { loading?: boolean }) {
  return (
    <div
      className={`${styles.quotaPlaceholder} ${loading ? styles.quotaPlaceholderLoading : ''}`}
      aria-hidden="true"
    >
      <span className={styles.placeholderChip} />
      {[0, 1, 2].map((row) => (
        <span key={row} className={styles.placeholderRow}>
          <span className={styles.placeholderLabel} />
          <span className={styles.placeholderTrack} />
        </span>
      ))}
    </div>
  );
}
