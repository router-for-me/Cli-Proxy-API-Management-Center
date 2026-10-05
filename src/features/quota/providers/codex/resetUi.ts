import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import { apiClient } from '@/services/api/client';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores/useQuotaStore';
import { cleanupCodexReset, getCodexResetView, recheckCodexReset } from './reset';

type ResetView = ReturnType<typeof getCodexResetView>;

export const codexResetSuccessKey = {
  quota: 'codex_quota.reset_success',
  recheck: 'codex_quota.reset_recheck_success',
  cleanup: 'codex_quota.reset_cleanup_success',
} as const;

const actionMessages = {
  new: {
    button: 'reset_button',
    confirmButton: 'reset_confirm_button',
    title: 'reset_confirm_title',
    confirmation: 'reset_confirm_message',
  },
  retry: {
    button: 'reset_retry_button',
    title: 'reset_retry_title',
    confirmation: 'reset_retry_message',
    description: 'reset_unknown_notice',
  },
  cooldown: {
    button: 'reset_cooldown_button',
    title: 'reset_cooldown_title',
    confirmation: 'reset_cooldown_message',
    description: 'reset_cooldown_notice',
  },
  refresh: {
    button: 'reset_refresh_button',
    title: 'reset_refresh_title',
    confirmation: 'reset_refresh_message',
    description: 'reset_refresh_notice',
  },
  recheck: {
    button: 'reset_recheck_button',
    title: 'reset_recheck_title',
    confirmation: 'reset_recheck_message',
    description: 'reset_paused_notice',
  },
  cleanup: {
    button: 'reset_cleanup_button',
    title: 'reset_cleanup_title',
    confirmation: 'reset_cleanup_message',
    description: 'reset_terminal_notice',
  },
} as const;

/** Recovery visibility is independent of quota loading and remaining credits. */
export function getCodexResetPresentation(view: ResetView, canStart: boolean) {
  const messages = actionMessages[view.action];
  return {
    show: view.action !== 'new' || Boolean(view.operation) || view.busy || view.blocked || canStart,
    disabled: view.busy || view.blocked,
    buttonKey: `codex_quota.${view.busy ? 'reset_busy_button' : messages.button}`,
    titleKey: `codex_quota.${messages.title}`,
    confirmationKey: `codex_quota.${messages.confirmation}`,
    confirmButtonKey: `codex_quota.${'confirmButton' in messages ? messages.confirmButton : messages.button}`,
    descriptionKey: view.busy
      ? 'codex_quota.reset_in_progress'
      : !view.blocked && 'description' in messages
        ? `codex_quota.${messages.description}`
        : undefined,
    reasonKey:
      view.operation?.terminal && view.operation.terminal !== 'completed'
        ? `codex_quota.reset_${view.operation.terminal}`
        : view.reason,
    reasonParams: view.reasonParams,
  };
}

/** Defaults for adapters that supply resetQuota without a Codex recovery journal. */
export const getDefaultResetPresentation = (canStart: boolean) => ({
  show: canStart,
  disabled: false,
  buttonKey: 'codex_quota.reset_button',
  titleKey: 'codex_quota.reset_confirm_title',
  confirmationKey: 'codex_quota.reset_confirm_message',
  confirmButtonKey: 'codex_quota.reset_confirm_button',
  descriptionKey: undefined,
  reasonKey: undefined,
  reasonParams: undefined,
});

/** Disabled credentials still permit inspecting or cleaning their saved operation. */
export const isCodexResetReadOnlyRecovery = (view: ResetView): boolean =>
  Boolean(view.operation) && (view.action === 'recheck' || view.action === 'cleanup');

export const canRunCodexResetAction = (file: AuthFileItem, view: ResetView): boolean =>
  !file.disabled || isCodexResetReadOnlyRecovery(view);

/** A dialog never authorizes a different operation or a newly available next step. */
export function isCodexResetActionCurrent(file: AuthFileItem, expected: ResetView): boolean {
  const current = getCodexResetView(file);
  return (
    !current.busy &&
    !current.blocked &&
    current.action === expected.action &&
    current.operation === expected.operation
  );
}

/** Rechecks and terminal cleanup cannot accidentally enter the redemption pipeline. */
export async function performCodexResetAction(
  view: ResetView,
  file: AuthFileItem,
  t: TFunction,
  reset: () => Promise<unknown>
): Promise<{ kind: 'quota'; data: unknown } | { kind: 'recheck' | 'cleanup' } | undefined> {
  if (!canRunCodexResetAction(file, view) || !isCodexResetActionCurrent(file, view)) return;
  if (view.action === 'recheck') {
    await recheckCodexReset(file, t);
    return { kind: 'recheck' };
  }
  if (view.action === 'cleanup') {
    await cleanupCodexReset(file, t);
    return { kind: 'cleanup' };
  }
  return { kind: 'quota', data: await reset() };
}

/** Cache generations alone do not identify the active management connection. */
export function commitIfCodexResetCurrent(
  revision: number,
  generation: ReturnType<typeof captureQuotaCacheGeneration>,
  commit: () => void
): boolean {
  return (
    revision === apiClient.getConnectionRevision() && commitIfQuotaCacheCurrent(generation, commit)
  );
}
