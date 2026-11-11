import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
} from '@/stores';
import {
  resolveCodexAccountTarget,
  setCodexPersonalCredits,
} from '@/services/api/codexAccountSettings';
import styles from './AuthFileDetailsSheet.module.scss';

export function CodexAccountSettings({
  fileInfoText,
  disabled,
}: {
  fileInfoText: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const target = useMemo(() => resolveCodexAccountTarget(fileInfoText), [fileInfoText]);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const active = useRef(false);
  const disabledRef = useRef(disabled);
  const { showConfirmation, showNotification } = useNotificationStore();

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const apply = (enabled: boolean) => {
    if (!target || disabled || busy.current) return;
    const generation = captureQuotaCacheGeneration();
    showConfirmation({
      title: t('codex_account_settings.title'),
      message: t('codex_account_settings.confirm', {
        action: t(`codex_account_settings.${enabled ? 'allow' : 'deny'}`),
        account: target.accountId,
      }),
      confirmText: t(`codex_account_settings.${enabled ? 'allow' : 'deny'}`),
      variant: enabled ? 'danger' : 'primary',
      onConfirm: async () => {
        if (!active.current || disabledRef.current || busy.current) return;
        if (!commitIfQuotaCacheCurrent(generation, () => {})) return;
        busy.current = true;
        setPending(true);
        try {
          await setCodexPersonalCredits(target, enabled);
          if (active.current) {
            commitIfQuotaCacheCurrent(generation, () => {
              showNotification(
                t('codex_account_settings.success', {
                  action: t(`codex_account_settings.${enabled ? 'allow' : 'deny'}`),
                }),
                'success'
              );
            });
          }
        } catch {
          if (active.current) {
            commitIfQuotaCacheCurrent(generation, () => {
              showNotification(t('codex_account_settings.failed'), 'error');
            });
          }
        } finally {
          busy.current = false;
          if (active.current) setPending(false);
        }
      },
    });
  };

  return (
    <section className={styles.accountCard} aria-label={t('codex_account_settings.title')}>
      <div className={styles.accountHeader}>
        <h3 className={styles.accountTitle}>{t('codex_account_settings.title')}</h3>
        <span className={styles.accountStatus}>{t('codex_account_settings.unknown')}</span>
      </div>
      <p className={styles.accountDescription}>{t('codex_account_settings.description')}</p>
      <div className={styles.accountFooter}>
        <span className={styles.accountNote}>{t('codex_account_settings.scope')}</span>
        <div className={styles.accountActions}>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || !target || pending}
            onClick={() => apply(true)}
          >
            {t('codex_account_settings.allow')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || !target || pending}
            onClick={() => apply(false)}
          >
            {t('codex_account_settings.deny')}
          </Button>
        </div>
      </div>
      {!target && <p className={styles.accountNote}>{t('codex_account_settings.unavailable')}</p>}
      {pending && (
        <div className={styles.accountNote} role="status">
          {t('codex_account_settings.saving')}
        </div>
      )}
    </section>
  );
}
