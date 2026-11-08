import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore, useQuotaStore } from '@/stores';
import { apiClient } from '@/services/api';
import type { AuthFileItem, CodexQuotaState } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import {
  applyCodexCreditOverage,
  buildCodexCreditOverageContext,
  codexCreditOverageKey,
  codexCreditOverageDisplayEntry,
  isCodexCreditOverageContextCurrent,
  describeCodexCreditOverageError,
  type CodexCreditOverageContext,
} from './creditOverage';
import { resolveCodexChatgptAccountId } from '@/utils/quota';

export interface CodexCreditOverageFeedback {
  tone: 'error' | 'warning';
  message: string;
}

/**
 * Card-owned controller for the account-level credit overage setting. Nothing is sent
 * until the operator picks a value in the dialog; the store holds the account state.
 */
export function useCodexCreditOverage(
  file: AuthFileItem,
  quota: CodexQuotaState | undefined,
  disabled: boolean
) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [context, setContext] = useState<CodexCreditOverageContext | null>(null);
  const [open, setOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState<CodexCreditOverageFeedback | null>(null);
  const inFlight = useRef(false);

  const key = quota?.status === 'success' ? codexCreditOverageKey(file) : null;
  const visible = key !== null && normalizeAuthIndex(file['auth_index'] ?? file.authIndex) !== null;
  // While the dialog is open it keeps following the account it was opened for.
  const activeKey = open && context ? context.key : key;
  const accountId = open && context ? context.accountId : resolveCodexChatgptAccountId(file);
  const snapshot = useQuotaStore((state) =>
    activeKey ? state.codexCreditOverage[activeKey] : undefined
  );
  const operation = useQuotaStore((state) =>
    accountId ? state.codexCreditOverageOperations[accountId] : undefined
  );
  const generation = useQuotaStore((state) => state.cacheGeneration);
  const entry = codexCreditOverageDisplayEntry(snapshot, operation);
  const contextCurrent =
    !context ||
    (context.cacheGeneration === generation &&
      context.connectionRevision === apiClient.getConnectionRevision() &&
      context.key === codexCreditOverageKey(file));
  const writeDisabled = disabled || !visible || !contextCurrent;
  const blocked = disabled || !visible || operation?.status === 'writing';

  const openDialog = () => {
    if (blocked) return;
    const next = buildCodexCreditOverageContext(file, quota);
    if (!next) return;
    setContext(next);
    setFeedback(null);
    setOpen(true);
  };

  const closeDialog = () => {
    if (inFlight.current) return;
    setOpen(false);
  };

  const apply = async (value: boolean) => {
    if (inFlight.current || !context || !open) return;
    // A list refresh may have replaced this credential while the dialog was open.
    if (!isCodexCreditOverageContextCurrent(file, context)) {
      setFeedback({ tone: 'warning', message: t('codex_quota.credit_overage_stale') });
      return;
    }
    if (disabled || !visible) return;
    inFlight.current = true;
    setPendingTarget(value);
    setFeedback(null);
    try {
      const outcome = await applyCodexCreditOverage(file, value);
      if (outcome.kind === 'applied') {
        setOpen(false);
        showNotification(
          t(
            outcome.value
              ? 'codex_quota.credit_overage_success_allowed'
              : 'codex_quota.credit_overage_success_blocked',
            { name: context.accountLabel }
          ),
          'success'
        );
      } else if (outcome.kind === 'unconfirmed') {
        // A same-value retry cannot settle an earlier request still in flight.
        setFeedback(null);
      } else if (outcome.kind === 'failed') {
        if (outcome.error.code === 'unconfirmed' || outcome.error.code === 'opposite_pending') {
          setFeedback(null);
          return;
        }
        setFeedback({
          tone: 'error',
          message: describeCodexCreditOverageError(t, outcome.error),
        });
      } else if (outcome.kind === 'busy') {
        setFeedback({ tone: 'warning', message: t('codex_quota.credit_overage_busy') });
      } else {
        // The connection changed underneath; the old session's answer is discarded.
        setOpen(false);
      }
    } finally {
      inFlight.current = false;
      setPendingTarget(null);
    }
  };

  return {
    visible,
    entry,
    operation,
    blocked,
    writeDisabled,
    contextCurrent,
    context,
    open,
    pendingTarget,
    feedback,
    openDialog,
    closeDialog,
    apply,
  };
}
