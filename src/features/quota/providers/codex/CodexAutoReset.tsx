import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import { codexResetPolicyApi, type CodexResetPolicy } from '@/services/api/codexResetPolicy';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { AuthFileItem } from '@/types';

export function CodexAutoReset({
  file,
  disabled,
  onRefresh,
}: {
  file: AuthFileItem;
  disabled: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const revision = apiClient.getConnectionRevision();
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  const [policy, setPolicy] = useState<CodexResetPolicy | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const saving = useRef(false);
  const lastReset = useRef(0);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  useEffect(() => {
    let active = true;
    const counter = generation;
    counter.current++;
    lastReset.current = 0;
    setPolicy(null);
    setError(false);
    setBusy(false);
    if (!authIndex || connectionStatus !== 'connected') return;
    let unsupported = false;
    let sequence = 0;
    const read = () => {
      if (unsupported || saving.current) return;
      const version = counter.current;
      const request = ++sequence;
      const current = () => active && version === counter.current && request === sequence;
      void codexResetPolicyApi.read(authIndex).then(
        (value) => {
          if (current()) {
            setPolicy(value);
            setError(false);
          }
        },
        (failure: unknown) => {
          if (!current()) return;
          unsupported = Boolean(
            typeof failure === 'object' &&
            failure &&
            'status' in failure &&
            (failure.status === 404 || failure.status === 501)
          );
          setPolicy(null);
          setError(!unsupported);
        }
      );
    };
    read();
    const timer = setInterval(read, 60000);
    return () => {
      active = false;
      counter.current++;
      clearInterval(timer);
    };
  }, [authIndex, file.name, connectionStatus, revision]);

  useEffect(() => {
    if (policy && policy.last_reset_at > lastReset.current) {
      lastReset.current = policy.last_reset_at;
      onRefresh();
    }
  }, [policy, onRefresh]);

  if (!policy) return error ? <div role="status">{t('codex_auto_reset.unavailable')}</div> : null;
  const change = (seconds: string) => {
    let version = generation.current;
    const current = () =>
      version === generation.current &&
      revision === apiClient.getConnectionRevision() &&
      useAuthStore.getState().connectionStatus === 'connected';
    const save = async () => {
      if (!authIndex || !current() || saving.current) return;
      version = ++generation.current;
      saving.current = true;
      setBusy(true);
      try {
        const next = await codexResetPolicyApi.save(authIndex, policy, Number(seconds));
        if (current()) {
          setPolicy(next);
          setError(false);
        }
      } catch {
        if (current()) setError(true);
      } finally {
        saving.current = false;
        if (current()) setBusy(false);
      }
    };
    if (seconds === '0') {
      void save();
      return;
    }
    showConfirmation({
      title: t('codex_auto_reset.title'),
      message: t('codex_auto_reset.confirm'),
      confirmText: t('common.confirm'),
      variant: 'primary',
      onConfirm: save,
    });
  };
  const choices = [0, 900, 3600, 21600, 86400];
  if (!choices.includes(policy.before_expiry_seconds)) choices.push(policy.before_expiry_seconds);
  return (
    <div>
      <div>{t('codex_auto_reset.title')}</div>
      <Select
        ariaLabel={t('codex_auto_reset.title')}
        value={String(policy.enabled ? policy.before_expiry_seconds : 0)}
        options={choices.map((seconds) => ({
          value: String(seconds),
          label:
            seconds === 0
              ? t('codex_auto_reset.disabled')
              : t('codex_auto_reset.before', { minutes: seconds / 60 }),
        }))}
        disabled={disabled || busy || (policy.pending && !policy.enabled)}
        onChange={change}
        size="sm"
      />
      <div role="status">
        {t(
          error
            ? 'codex_auto_reset.unavailable'
            : policy.pending
              ? 'codex_auto_reset.unknown'
              : `codex_auto_reset.${policy.result}`,
          {
            defaultValue: t('codex_auto_reset.waiting'),
          }
        )}
      </div>
    </div>
  );
}
