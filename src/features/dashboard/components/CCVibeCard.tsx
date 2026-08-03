import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ccvibeApi, type CCVibeStatus } from '@/services/api';
import { useNotificationStore } from '@/stores';
import styles from './CCVibeCard.module.scss';

interface CCVibeCardProps {
  connected: boolean;
}

type CCVibeAction = 'start' | 'stop' | null;

const unavailableStatus: CCVibeStatus = {
  configured: false,
  state: 'unavailable',
  ready: false,
  model: 'ccvibe-vibe',
  endpoint: '',
};

export function CCVibeCard({ connected }: CCVibeCardProps) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [status, setStatus] = useState<CCVibeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<CCVibeAction>(null);

  const loadStatus = useCallback(async () => {
    if (!connected) {
      setStatus(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setStatus(await ccvibeApi.getStatus());
    } catch {
      setStatus(unavailableStatus);
    } finally {
      setLoading(false);
    }
  }, [connected]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const runAction = useCallback(
    async (nextAction: Exclude<CCVibeAction, null>) => {
      setAction(nextAction);
      try {
        const nextStatus =
          nextAction === 'start' ? await ccvibeApi.start() : await ccvibeApi.stop();
        setStatus(nextStatus);
        showNotification(
          t(nextAction === 'start' ? 'dashboard.ccvibe_started' : 'dashboard.ccvibe_stopped'),
          'success'
        );
      } catch {
        showNotification(t('dashboard.ccvibe_action_failed'), 'error');
        await loadStatus();
      } finally {
        setAction(null);
      }
    },
    [loadStatus, showNotification, t]
  );

  const statusKey = useMemo(() => {
    if (!connected) return 'disconnected';
    if (loading && !status) return 'checking';
    if (!status) return 'unavailable';
    return status.state;
  }, [connected, loading, status]);

  const statusLabel = t(`dashboard.ccvibe_state_${statusKey}`, {
    defaultValue: t('dashboard.ccvibe_state_unavailable'),
  });
  const detail = !connected
    ? t('dashboard.ccvibe_disconnected')
    : status?.state === 'unconfigured'
      ? t('dashboard.ccvibe_unconfigured')
      : status?.state === 'unavailable'
        ? t('dashboard.ccvibe_unavailable')
        : t('dashboard.ccvibe_reasoning_note');
  const canControl = connected && Boolean(status?.configured) && action === null;

  return (
    <section className={styles.card} aria-labelledby="ccvibe-heading">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{t('dashboard.ccvibe_eyebrow')}</span>
          <h2 id="ccvibe-heading" className={styles.title}>
            {t('dashboard.ccvibe_title')}
          </h2>
        </div>
        <span
          className={`${styles.badge} ${styles[`badge${statusKey}`] ?? styles.badgeunavailable}`}
        >
          <i aria-hidden="true" />
          {statusLabel}
        </span>
      </header>

      <div className={styles.content}>
        <div className={styles.copy}>
          <p className={styles.model}>{status?.model || 'ccvibe-vibe'}</p>
          <p className={styles.detail} aria-live="polite">
            {detail}
          </p>
        </div>
        <div className={styles.actions}>
          <Button
            type="button"
            size="sm"
            onClick={() => void runAction('start')}
            disabled={!canControl || Boolean(status?.ready)}
            loading={action === 'start'}
          >
            {t('dashboard.ccvibe_start')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="danger"
            onClick={() => void runAction('stop')}
            disabled={!canControl || !status?.ready}
            loading={action === 'stop'}
          >
            {t('dashboard.ccvibe_stop')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void loadStatus()}
            disabled={!connected || loading || action !== null}
            loading={loading}
          >
            {t('dashboard.ccvibe_refresh')}
          </Button>
        </div>
      </div>
    </section>
  );
}
