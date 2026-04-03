import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { copyToClipboard } from '@/utils/clipboard';
import { copilotQuotaApi } from '@/services/api';
import modalStyles from './CopilotQuotaSection.module.scss';

interface CopilotDeviceCodeModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (email: string) => void;
}

type AuthState = 'idle' | 'loading' | 'code_shown' | 'polling' | 'success' | 'error';

export function CopilotDeviceCodeModal({ open, onClose, onSuccess }: CopilotDeviceCodeModalProps) {
  const { t } = useTranslation();
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [userCode, setUserCode] = useState('');
  const [verificationUri, setVerificationUri] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successEmail, setSuccessEmail] = useState('');
  const [copied, setCopied] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiresAtRef = useRef<number>(0);
  const deviceCodeRef = useRef('');
  const intervalSecsRef = useRef(5);

  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const resetState = useCallback(() => {
    clearPolling();
    setAuthState('idle');
    setUserCode('');
    setVerificationUri('');
    setErrorMessage('');
    setSuccessEmail('');
    setCopied(false);
    deviceCodeRef.current = '';
    expiresAtRef.current = 0;
  }, [clearPolling]);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const startPolling = useCallback(() => {
    clearPolling();
    setAuthState('polling');

    pollIntervalRef.current = setInterval(async () => {
      if (Date.now() > expiresAtRef.current) {
        clearPolling();
        setAuthState('error');
        setErrorMessage(t('copilot_quota.device_code_expired'));
        return;
      }

      try {
        const pollRes = await copilotQuotaApi.pollAuth(deviceCodeRef.current, intervalSecsRef.current);
        if (pollRes.status === 'complete') {
          clearPolling();
          const email = 'email' in pollRes ? pollRes.email : '';
          setSuccessEmail(email);
          setAuthState('success');
          setTimeout(() => {
            onSuccess(email);
          }, 1500);
        } else if (pollRes.status === 'error') {
          const msg = 'message' in pollRes ? pollRes.message : '';
          if (msg !== 'authorization_pending') {
            clearPolling();
            setAuthState('error');
            setErrorMessage(msg || t('common.unknown_error'));
          }
        }
      } catch {
        // Network errors during polling are transient — keep polling
      }
    }, intervalSecsRef.current * 1000);
  }, [clearPolling, onSuccess, t]);

  useEffect(() => {
    if (!open || authState !== 'idle') return;

    let cancelled = false;

    const initAuth = async () => {
      setAuthState('loading');
      try {
        const res = await copilotQuotaApi.startAuth();
        if (cancelled) return;
        deviceCodeRef.current = res.device_code;
        intervalSecsRef.current = res.interval || 5;
        expiresAtRef.current = Date.now() + res.expires_in * 1000;
        setUserCode(res.user_code);
        setVerificationUri(res.verification_uri);
        setAuthState('code_shown');
      } catch (err: unknown) {
        if (cancelled) return;
        setAuthState('error');
        setErrorMessage(err instanceof Error ? err.message : t('common.unknown_error'));
      }
    };

    initAuth();

    return () => {
      cancelled = true;
    };
  }, [open, authState, t]);

  useEffect(() => {
    if (authState === 'code_shown') {
      startPolling();
    }
  }, [authState, startPolling]);

  useEffect(() => {
    if (!open) {
      clearPolling();
      // Delay state reset so close animation plays
      const timer = setTimeout(() => {
        setAuthState('idle');
      }, 400);
      return () => clearTimeout(timer);
    }
    return clearPolling;
  }, [open, clearPolling]);

  const handleCopyCode = async () => {
    const ok = await copyToClipboard(userCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isPolling = authState === 'code_shown' || authState === 'polling';

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('copilot_quota.device_code_title')}
      closeDisabled={authState === 'loading'}
    >
      {authState === 'loading' && (
        <div className={modalStyles.deviceCodeStatus}>
          {t('common.loading')}
        </div>
      )}

      {isPolling && (
        <>
          <p className={modalStyles.deviceCodeInstructions}>
            {t('copilot_quota.device_code_instruction')}
          </p>

          <div className={modalStyles.deviceCode}>
            {userCode}
          </div>

          <div className={modalStyles.deviceCodeActions}>
            <Button variant="secondary" onClick={handleCopyCode}>
              {copied ? t('copilot_quota.device_code_copied') : t('copilot_quota.device_code_copy')}
            </Button>
            <Button
              variant="primary"
              onClick={() => window.open(verificationUri, '_blank', 'noopener,noreferrer')}
            >
              {t('copilot_quota.device_code_open_github')}
            </Button>
          </div>

          <div className={modalStyles.deviceCodeStatus}>
            {t('copilot_quota.device_code_waiting')}
          </div>
        </>
      )}

      {authState === 'success' && (
        <div className={`${modalStyles.deviceCodeStatus} ${modalStyles.deviceCodeStatusSuccess}`}>
          {t('copilot_quota.account_added', { email: successEmail })}
        </div>
      )}

      {authState === 'error' && (
        <>
          <div className={`${modalStyles.deviceCodeStatus} ${modalStyles.deviceCodeStatusError}`}>
            {t('copilot_quota.device_code_error', { message: errorMessage })}
          </div>
          <div className={modalStyles.deviceCodeActions}>
            <Button variant="secondary" onClick={handleClose}>
              {t('common.close')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
