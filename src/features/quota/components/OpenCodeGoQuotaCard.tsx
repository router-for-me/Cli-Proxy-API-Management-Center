import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useNow } from '@/hooks/useNow';
import { openCodeGoQuotaApi, type OpenCodeGoQuotaResponse } from '@/services/api';
import styles from './OpenCodeGoQuotaCard.module.scss';

interface OpenCodeGoQuotaCardProps {
  refreshToken: number;
  disabled?: boolean;
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));

const relativeReset = (iso: string, now: number): string => {
  const remaining = new Date(iso).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return 'now';
  const minutes = Math.ceil(remaining / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${mins}m`].filter(Boolean).join(' ');
};

export function OpenCodeGoQuotaCard({ refreshToken, disabled = false }: OpenCodeGoQuotaCardProps) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<OpenCodeGoQuotaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false);
  const now = useNow(true);

  const load = useCallback(async () => {
    if (disabled) return;
    setLoading(true);
    setError('');
    try {
      const response = await openCodeGoQuotaApi.get();
      setData(response);
      setHidden(false);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 404 || status === 503) {
        setHidden(true);
      } else {
        setHidden(false);
        setError(err instanceof Error ? err.message : t('quota_management.opencode_error'));
      }
    } finally {
      setLoading(false);
    }
  }, [disabled, t]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);


  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language]
  );

  if (hidden) return null;

  return (
    <section className={styles.card} aria-label={t('quota_management.opencode_title')}>
      <div className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.mark} aria-hidden="true">GO</span>
          <div>
            <div className={styles.titleRow}>
              <h2>{t('quota_management.opencode_title')}</h2>
              <span className={styles.plan}>{t('quota_management.opencode_plan')}</span>
            </div>
            <p>{t('quota_management.opencode_description')}</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" loading={loading} disabled={disabled} onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
      </div>

      {error ? (
        <div className={styles.error} role="alert">{error}</div>
      ) : (
        <div className={styles.windows} aria-busy={loading}>
          {(data?.windows ?? []).map((window) => {
            const remaining = clamp(window.remaining_percent);
            const tone = remaining < 15 ? styles.critical : remaining < 40 ? styles.warning : styles.healthy;
            const reset = new Date(window.resets_at);
            return (
              <article className={styles.window} key={window.id}>
                <div className={styles.windowHead}>
                  <div>
                    <span className={styles.windowName}>
                      {t(`quota_management.opencode_window_${window.id}`)}
                    </span>
                    <span className={styles.limit}>${window.limit_usd}</span>
                  </div>
                  <strong>{Math.round(remaining)}%</strong>
                </div>
                <div className={styles.track}>
                  <span className={`${styles.fill} ${tone}`} style={{ width: `${remaining}%` }} />
                </div>
                <div className={styles.meta}>
                  <span>{t('quota_management.opencode_remaining')}</span>
                  <span>
                    {Number.isNaN(reset.getTime()) ? window.resets_at : dateFormatter.format(reset)} ·{' '}
                    {relativeReset(window.resets_at, now)}
                  </span>
                </div>
              </article>
            );
          })}
          {loading && !data && <div className={styles.loading}>{t('common.loading')}</div>}
        </div>
      )}
    </section>
  );
}
