import { useTranslation } from 'react-i18next';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconEye,
  IconPencil,
  IconTrash2,
} from '@/components/ui/icons';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import type { ProviderResource } from '../types';
import styles from './ProviderResourceTable.module.scss';

interface ProviderResourceTableProps {
  resources: ProviderResource[];
  selectedId?: string | null;
  disableMutations?: boolean;
  onView: (resource: ProviderResource) => void;
  onEdit: (resource: ProviderResource) => void;
  onDelete: (resource: ProviderResource) => void;
}

const columnWidths = ['20%', '22%', '9%', '14%', '9%', '26%'];

export function ProviderResourceTable({
  resources,
  selectedId,
  disableMutations,
  onView,
  onEdit,
  onDelete,
}: ProviderResourceTableProps) {
  const { t } = useTranslation();

  const renderModelsSummary = (r: ProviderResource) => {
    if (r.brand === 'openaiCompatibility') {
      return t('providersPage.table.openaiModelSummary', {
        models: r.modelCount,
        keys: r.apiKeyEntryCount,
        headers: r.headerCount,
      });
    }
    if (r.brand === 'ampcode') {
      return t('providersPage.table.ampcodeSummary', {
        mappings: r.modelCount,
        keys: r.apiKeyEntryCount,
      });
    }
    let label = t('providersPage.table.modelSummary', {
      models: r.modelCount,
      headers: r.headerCount,
    });
    if (r.brand === 'codex' && r.flags.websockets) {
      label += ` · ${t('providersPage.table.websocketsTag')}`;
    }
    if (r.brand === 'claude' && r.flags.cloakEnabled) {
      label += ` · ${t('providersPage.table.cloakTag')}`;
    }
    return label;
  };

  const renderStatus = (r: ProviderResource) => {
    if (r.brand === 'ampcode' && r.flags.isPlaceholder) {
      return (
        <span className={`${styles.statusBadge} ${styles.statusDisabled}`}>
          <IconAlertTriangle size={12} />
          {t('providersPage.status.notConfigured')}
        </span>
      );
    }
    if (r.disabled) {
      return (
        <span className={`${styles.statusBadge} ${styles.statusDisabled}`}>
          <IconAlertTriangle size={12} />
          {t('providersPage.status.disabled')}
        </span>
      );
    }
    return (
      <span className={`${styles.statusBadge} ${styles.statusActive}`}>
        <IconCheckCircle2 size={12} />
        {t('providersPage.status.active')}
      </span>
    );
  };

  const renderPrimary = (r: ProviderResource) => {
    if (r.brand === 'openaiCompatibility') {
      const extra = r.apiKeyEntryCount > 1 ? ` · +${r.apiKeyEntryCount - 1}` : '';
      return (
        <div className={styles.primaryCell}>
          <span className={styles.primaryName}>{r.name ?? r.identifier}</span>
          <span className={styles.primarySub}>
            {(r.apiKeyPreview ?? '—') + extra}
          </span>
        </div>
      );
    }
    if (r.brand === 'ampcode') {
      return (
        <div className={styles.primaryCell}>
          <span className={styles.primaryName}>Amp CLI</span>
          <span className={styles.primarySub}>
            {r.apiKeyPreview ?? t('providersPage.table.noFallbackKey')}
          </span>
        </div>
      );
    }
    return (
      <div className={styles.primaryCell}>
        <span className={styles.primaryName}>{r.apiKeyPreview ?? '—'}</span>
        {r.authIndex ? (
          <span className={styles.primarySub}>auth: {r.authIndex}</span>
        ) : null}
      </div>
    );
  };

  const renderBaseUrl = (r: ProviderResource) => {
    if (r.brand === 'claude' && !r.baseUrl) {
      return (
        <span className={styles.baseUrl}>
          https://api.anthropic.com {t('providersPage.status.defaultSuffix')}
        </span>
      );
    }
    if (r.brand === 'ampcode' && !r.baseUrl) {
      return <span className={styles.baseUrl}>{t('providersPage.status.notConfigured')}</span>;
    }
    return (
      <span className={styles.baseUrl}>
        {r.baseUrl ?? t('providersPage.status.notSet')}
      </span>
    );
  };

  return (
    <Table
      cols={columnWidths.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    >
      <TableHeader>
        <TableRow>
          <TableHead>{t('providersPage.table.key')}</TableHead>
          <TableHead>{t('providersPage.table.baseUrl')}</TableHead>
          <TableHead>{t('providersPage.table.prefix')}</TableHead>
          <TableHead>{t('providersPage.table.models')}</TableHead>
          <TableHead>{t('providersPage.table.status')}</TableHead>
          <TableHead alignRight>{t('providersPage.table.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {resources.map((resource) => {
          const isAmpcode = resource.brand === 'ampcode';
          return (
            <TableRow key={resource.id} selected={resource.id === selectedId}>
              <TableCell>{renderPrimary(resource)}</TableCell>
              <TableCell>{renderBaseUrl(resource)}</TableCell>
              <TableCell>
                {resource.brand === 'ampcode' ? (
                  <span className={styles.baseUrl}>—</span>
                ) : resource.prefix ? (
                  <span className={styles.chip}>{resource.prefix}</span>
                ) : (
                  <span className={styles.baseUrl}>{t('providersPage.status.none')}</span>
                )}
              </TableCell>
              <TableCell>
                <span className={styles.modelsCell}>{renderModelsSummary(resource)}</span>
              </TableCell>
              <TableCell>{renderStatus(resource)}</TableCell>
              <TableCell alignRight>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label={t('providersPage.actions.view')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onView(resource);
                    }}
                  >
                    <IconEye size={14} />
                    <span>{t('providersPage.actions.view')}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label={t('providersPage.actions.edit')}
                    disabled={disableMutations}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(resource);
                    }}
                  >
                    <IconPencil size={14} />
                    <span>{t('providersPage.actions.edit')}</span>
                  </button>
                  {isAmpcode ? (
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      aria-label={t('providersPage.actions.clear')}
                      disabled={disableMutations || resource.flags.isPlaceholder}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(resource);
                      }}
                    >
                      <IconTrash2 size={14} />
                      <span>{t('providersPage.actions.clear')}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      aria-label={t('providersPage.actions.delete')}
                      disabled={disableMutations}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(resource);
                      }}
                    >
                      <IconTrash2 size={14} />
                      <span>{t('providersPage.actions.delete')}</span>
                    </button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
