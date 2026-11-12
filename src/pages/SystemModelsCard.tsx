import { useId, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconDownload, IconRefreshCw } from '@/components/ui/icons';
import { useAuthStore } from '@/stores';
import { useModelCatalogSync } from '@/hooks/useModelCatalogSync';
import styles from './SystemPage.module.scss';

export type ModelListStatus =
  | { kind: 'loading' }
  | { kind: 'loaded' }
  | { kind: 'disconnected' }
  | { kind: 'error'; detail: string; retained: boolean };

export function ModelListFeedback({ status }: { status?: ModelListStatus }) {
  const { t } = useTranslation();
  if (!status || status.kind === 'loaded') return null;
  let message: string;
  if (status.kind === 'error') {
    message = t(status.retained ? 'system_info.models_error_retained' : 'system_info.models_error');
  } else {
    message = t(
      status.kind === 'loading' ? 'system_info.models_loading' : 'notification.connection_required'
    );
  }

  return (
    <div
      className={`${styles.modelsFeedback} ${status.kind === 'error' ? styles.modelsFeedbackError : ''}`}
      role={status.kind === 'error' ? 'alert' : 'status'}
      aria-live={status.kind === 'error' ? undefined : 'polite'}
      aria-atomic="true"
    >
      {status.kind === 'loading' && <span className="loading-spinner" aria-hidden="true" />}
      <span>{message}</span>
      {status.kind === 'error' && status.detail && <span>{status.detail}</span>}
    </div>
  );
}

interface SystemModelsCardProps {
  modelsLoading: boolean;
  onRefreshModels: () => Promise<void>;
  onCatalogsRefreshed: () => Promise<void>;
}

export function SystemModelsCard({
  children,
  modelsLoading,
  onRefreshModels,
  onCatalogsRefreshed,
}: PropsWithChildren<SystemModelsCardProps>) {
  const { t } = useTranslation();
  const reloadHintId = useId();
  const syncHintId = useId();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const { syncingModelCatalog: loading, syncModelCatalog } =
    useModelCatalogSync(onCatalogsRefreshed);

  return (
    <Card
      title={t('system_info.models_title')}
      extra={
        <div className={styles.modelsActions}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!connected || loading}
            loading={modelsLoading}
            aria-busy={modelsLoading}
            aria-describedby={reloadHintId}
            title={t('system_info.models_refresh_hint')}
            onClick={() => void onRefreshModels()}
          >
            <span className={styles.modelsActionLabel}>
              {!modelsLoading && <IconRefreshCw size={16} />}
              {t('system_info.models_refresh_button')}
            </span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!connected || modelsLoading}
            loading={loading}
            aria-busy={loading}
            aria-describedby={syncHintId}
            title={t('model_catalog.hint')}
            onClick={() => void syncModelCatalog()}
          >
            <span className={styles.modelsActionLabel}>
              {!loading && <IconDownload size={16} />}
              {t('model_catalog.button')}
            </span>
          </Button>
        </div>
      }
    >
      <p className={styles.sectionDescription}>{t('system_info.models_desc')}</p>
      <span id={reloadHintId} className={styles.visuallyHidden}>
        {t('system_info.models_refresh_hint')}
      </span>
      <span id={syncHintId} className={styles.visuallyHidden}>
        {t('model_catalog.hint')}
      </span>
      {children}
    </Card>
  );
}
