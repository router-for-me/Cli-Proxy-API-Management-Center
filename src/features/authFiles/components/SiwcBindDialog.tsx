import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { captureSiwcBindingApi, oauthApi, type SiwcBindResponse } from '@/services/api/oauth';
import { useAuthStore } from '@/stores/useAuthStore';
import { copyToClipboard } from '@/utils/clipboard';
import { createOAuthAttempts, type OAuthAttempt } from '@/features/oauth/oauthAttempts';
import { notifyAuthFilesChanged } from '../authFilesEvents';
import { createSiwcStart, isSiwcCallbackValid } from '../siwcBinding';
import styles from './SiwcBindDialog.module.scss';

type Phase = 'idle' | 'starting' | 'wait' | 'ok' | 'error' | 'unsupported' | 'expired';

export function SiwcBindDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [session, setSession] = useState<SiwcBindResponse>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [callback, setCallback] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const attemptRef = useRef<OAuthAttempt | null>(null);
  const startRef = useRef<ReturnType<typeof createSiwcStart<SiwcBindResponse>> | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const connection = useAuthStore.getState();
    const sameConnection = () => {
      const current = useAuthStore.getState();
      return (
        current.isAuthenticated === connection.isAuthenticated &&
        current.apiBase === connection.apiBase &&
        current.managementKey === connection.managementKey
      );
    };
    const attempts = createOAuthAttempts({
      setTimeout: (fn, delay) => window.setTimeout(fn, delay),
      clearTimeout: (timer) => window.clearTimeout(timer),
    });
    const attempt = attempts.begin(name);
    attemptRef.current = attempt;
    const api = captureSiwcBindingApi();
    const unsubscribe = useAuthStore.subscribe(() => {
      if (!sameConnection()) {
        attempt.invalidate();
        startRef.current?.close();
        closeRef.current();
      }
    });
    const startup = createSiwcStart({
      start: () => {
        setPhase('starting');
        return api.start(name);
      },
      cancel: api.cancel,
      onResult: (result) => {
        if (!attempt.isCurrent()) return;
        const state = result.state;
        const url = new URL(result.url);
        if (
          result.status !== 'ok' ||
          result.flow !== 'siwc_bind' ||
          !state ||
          !['https:', 'http:'].includes(url.protocol) ||
          !(result.expires_in > 0)
        ) {
          throw new Error('Invalid binding session');
        }
        setSession(result);
        setPhase('wait');
        const expiresAt = Date.now() + result.expires_in * 1000;
        attempt.poll<{ status: 'wait' | 'ok' | 'error' | 'expired' }>(
          () =>
            Date.now() >= expiresAt
              ? Promise.resolve({ status: 'expired' as const })
              : oauthApi.getAuthStatus(state, attempt.signal),
          (result) => {
            setPhase(result.status);
            if (result.status === 'ok') {
              startup.complete();
              notifyAuthFilesChanged();
            }
            return result.status === 'wait';
          },
          () => setPhase('error'),
          2000
        );
      },
      onError: (error: unknown) => {
        if (!attempt.isCurrent()) return;
        setPhase(
          typeof error === 'object' && error !== null && 'status' in error && error.status === 404
            ? 'unsupported'
            : 'error'
        );
      },
    });
    startRef.current = startup;
    return () => {
      attempt.invalidate();
      unsubscribe();
      startup.close();
    };
  }, [name]);

  const close = () => {
    attemptRef.current?.invalidate();
    startRef.current?.close();
    onClose();
  };

  const submit = async () => {
    const attempt = attemptRef.current;
    if (!session || !attempt?.isCurrent() || phase !== 'wait' || submitting) return;
    if (!isSiwcCallbackValid(callback, session.state)) {
      setMessage('invalid_callback');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      await oauthApi.submitCallback('codex', callback, attempt.signal);
      if (attempt.isCurrent()) setMessage('submitted');
    } catch {
      if (attempt.isCurrent()) setMessage('callback_failed');
    } finally {
      if (attempt.isCurrent()) setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      title={t('siwc.title')}
      onClose={close}
      footer={
        <Button variant="secondary" onClick={close}>
          {t(phase === 'starting' || phase === 'wait' ? 'siwc.cancel' : 'siwc.close')}
        </Button>
      }
    >
      <Input label={t('siwc.target')} value={name} readOnly />
      <p role="status">{t(`siwc.${phase}`)}</p>
      {phase === 'idle' && (
        <Button onClick={() => void startRef.current?.start()}>{t('siwc.start')}</Button>
      )}
      {session && phase === 'wait' && (
        <>
          <Input label={t('siwc.url')} value={session.url} readOnly />
          <div className={styles.urlActions}>
            <Button onClick={() => window.open(session.url, '_blank', 'noopener,noreferrer')}>
              {t('siwc.open')}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                const attempt = attemptRef.current;
                const copied = await copyToClipboard(session.url);
                if (attempt?.isCurrent()) setMessage(copied ? 'copied' : 'copy_failed');
              }}
            >
              {t('siwc.copy')}
            </Button>
          </div>
          <Input
            label={t('siwc.callback')}
            hint={t('siwc.hint')}
            value={callback}
            onChange={(event) => setCallback(event.target.value)}
            autoComplete="off"
          />
          <Button onClick={() => void submit()} disabled={submitting || !callback}>
            {t('siwc.submit')}
          </Button>
        </>
      )}
      {message && <p role="status">{t(`siwc.${message}`)}</p>}
    </Modal>
  );
}
