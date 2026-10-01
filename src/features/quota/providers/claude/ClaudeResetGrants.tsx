import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useNow } from '@/hooks/useNow';
import { useAuthStore } from '@/stores/useAuthStore';
import { apiClient } from '@/services/api/client';
import {
  anthropicResetGrantBlocker,
  readClaudeResetGrants,
  type AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';
import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/quota';
import { resetGrantOperations, RETRY_WINDOW_MS } from './resetGrantOperations';

export function ClaudeResetGrants({
  file,
  disabled: externallyDisabled,
  onRefresh,
}: {
  file: AuthFileItem;
  disabled: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [session] = useState(() => apiClient.getConnectionRevision());
  const sessionActive =
    connectionStatus === 'connected' && session === apiClient.getConnectionRevision();
  const disabled = externallyDisabled || !sessionActive;
  const now = useNow();
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AnthropicResetGrantStatus | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [authIndex, file.name]
  );
  const key = JSON.stringify([file.name, authIndex]);
  const operation = resetGrantOperations.inspect(key);
  const pending = operation && !operation.code ? operation : undefined;
  const expired = pending && now - pending.createdAt >= RETRY_WINDOW_MS;

  const load = async () => {
    if (!authIndex || disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    setOpen(true);
    setStatus(null);
    setSelected(null);
    setMessage('');
    const revision = apiClient.getConnectionRevision();
    const version = generation.current;
    const current = () =>
      revision === apiClient.getConnectionRevision() && version === generation.current;
    try {
      const result = await readClaudeResetGrants(authIndex);
      if (current()) setStatus(result);
    } catch {
      if (current()) setMessage('read_error');
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };

  const consume = async () => {
    if (!authIndex || !selected || disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    const revision = apiClient.getConnectionRevision();
    const version = generation.current;
    const current = () =>
      revision === apiClient.getConnectionRevision() && version === generation.current;
    try {
      const answer = await resetGrantOperations.run(key, authIndex, selected);
      if (!current()) return;
      setMessage(answer.unresolved ? 'unknown' : answer.code);
      setSelected(null);
      setStatus(null);
      onRefresh();
    } catch {
      if (current()) {
        const unresolved = resetGrantOperations.inspect(key);
        setMessage(unresolved && !unresolved.code ? 'unknown' : 'blocked');
        setSelected(null);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled || !authIndex || busy}
        onClick={() => void load()}
      >
        {t('claude_reset.title')}
      </Button>
      <Modal
        open={open && sessionActive}
        title={t('claude_reset.title')}
        onClose={() => setOpen(false)}
        closeDisabled={busy}
        footer={
          selected ? (
            <Button disabled={disabled || busy} loading={busy} onClick={() => void consume()}>
              {t('claude_reset.confirm')}
            </Button>
          ) : undefined
        }
      >
        <p>{t('claude_reset.scope')}</p>
        <div role="status" aria-live="polite">
          {busy && <p>{t('claude_reset.loading')}</p>}
          {message && <p>{t(`claude_reset.${message}`)}</p>}
        </div>
        {pending ? (
          <>
            <p>{t(expired ? 'claude_reset.expired' : 'claude_reset.unknown')}</p>
            <Button
              variant="secondary"
              disabled={Boolean(expired) || busy || disabled}
              onClick={() => setSelected(pending.grantId)}
            >
              {t('claude_reset.retry')}
            </Button>
          </>
        ) : (
          status && (
            <>
              {!status.eligible && <p>{t('claude_reset.ineligible')}</p>}
              {status.grants.length === 0 && <p>{t('claude_reset.empty')}</p>}
              {status.grants.map((grant) => (
                <div key={grant.id}>
                  <p>
                    {grant.label || grant.id} —{' '}
                    {t('claude_reset.count', { left: grant.resetsLeft, total: grant.resetsTotal })}
                  </p>
                  {grant.endsAt && (
                    <p>
                      {t('claude_reset.ends', { date: new Date(grant.endsAt).toLocaleString() })}
                    </p>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={
                      busy || disabled || Boolean(anthropicResetGrantBlocker(status, grant.id))
                    }
                    onClick={() => setSelected(grant.id)}
                  >
                    {t('claude_reset.use')}
                  </Button>
                </div>
              ))}
            </>
          )
        )}
        {selected && (
          <p>
            {t('claude_reset.confirm_text', {
              grant: status?.grants.find((grant) => grant.id === selected)?.label || selected,
            })}
          </p>
        )}
      </Modal>
    </>
  );
}
