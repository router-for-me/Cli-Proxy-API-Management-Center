import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { authFilesApi } from '@/services/api';

interface XiaomiVerificationModalProps {
  open: boolean;
  sessionId: string;
  email?: string;
  message?: string;
  onVerified: () => void;
  onCancel: () => void;
}

export function XiaomiVerificationModal({
  open,
  sessionId,
  email,
  message,
  onVerified,
  onCancel,
}: XiaomiVerificationModalProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await authFilesApi.verifyXiaomiCode(sessionId, code.trim());
      setSuccess(true);
      setTimeout(() => {
        onVerified();
      }, 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknown_error');
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }, [code, sessionId, submitting, onVerified, t]);

  const handleClose = useCallback(() => {
    if (!submitting) {
      setCode('');
      setError('');
      setSuccess(false);
      onCancel();
    }
  }, [submitting, onCancel]);

  return (
    <Modal
      open={open}
      title={t('xiaomi_verification.title', { defaultValue: '小米邮箱验证' })}
      onClose={handleClose}
      closeDisabled={submitting}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={submitting || !code.trim()}>
            {success ? t('common.done', { defaultValue: '完成' }) : t('common.submit', { defaultValue: '提交' })}
          </Button>
        </div>
      }
    >
      {email && (
        <p style={{ margin: '0 0 4px 0', fontSize: 14, color: 'var(--text-secondary, #666)' }}>
          {t('xiaomi_verification.email_label', { defaultValue: '验证邮箱' })}：<strong>{email}</strong>
        </p>
      )}
      <p style={{ margin: '0 0 12px 0' }}>
        {message || t('xiaomi_verification.prompt', { defaultValue: '请输入发送到您邮箱的验证码。' })}
      </p>
      {!success ? (
        <>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={t('xiaomi_verification.code_placeholder', { defaultValue: '6 位验证码' })}
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
            disabled={submitting}
            autoFocus
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: '18px',
              letterSpacing: '8px',
              textAlign: 'center',
              borderRadius: 6,
              border: '1px solid var(--border-color, #d9d9d9)',
              background: 'var(--input-bg, #fff)',
              color: 'var(--text-color, #333)',
              boxSizing: 'border-box',
            }}
          />
          {error && (
            <p style={{ color: 'var(--error-color, #e74c3c)', marginTop: 8, fontSize: 13 }}>{error}</p>
          )}
        </>
      ) : (
        <p style={{ color: 'var(--success-color, #27ae60)', marginTop: 12 }}>
          {t('xiaomi_verification.verified', { defaultValue: '验证成功，正在刷新余额...' })}
        </p>
      )}
    </Modal>
  );
}
