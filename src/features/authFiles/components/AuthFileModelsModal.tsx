import { useAuthFilesSource } from '../AuthFilesSourceContext';
import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconCopy } from '@/components/ui/icons';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import {
  accountRefOf,
  buildMatrix,
  deriveInventoryLoad,
  IDLE_LOAD,
  loadData,
  providerOfFile,
  type CellState,
} from '@/features/authFiles/modelAccess';
import {
  accountListKind,
  cellDrift,
  cellLabelKey,
  cellRule,
} from '@/features/authFiles/models/matrixView';
import { modelsScreenPath } from '@/features/authFiles/unifiedList';
import { useSourceModelAccess } from '@/stores/useModelAccessStore';
import type { AuthFileItem } from '@/types';
import styles from './AuthFileModelsModal.module.scss';

export type AuthFileModelsModalProps = {
  open: boolean;
  file: AuthFileItem | null;
  onClose: () => void;
  onRetry: () => void;
  onCopyText: (text: string) => void;
};

const servedKinds: ReadonlySet<CellState['kind']> = new Set(['served']);

/**
 * One credential's models with the effective state of each, read from the shared model-access
 * store and resolved by the same function as the Models matrix. An excluded model is listed
 * with the list and rule that exclude it instead of silently missing.
 */
export function AuthFileModelsModal(props: AuthFileModelsModalProps) {
  const { source, session } = useAuthFilesSource();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { open, file, onClose, onRetry, onCopyText } = props;
  const access = useSourceModelAccess(session.owner);

  const provider = file ? providerOfFile(file) : '';
  const accountLabel = file ? accountRefOf(file).label : '';
  const view = useMemo(() => {
    if (!file) return null;
    const ref = accountRefOf(file);
    const load = deriveInventoryLoad({ access, provider, accounts: [ref] });
    const inventory = loadData(load);
    const models = access?.accountModels[ref.name] ?? IDLE_LOAD;
    const details = new Map<string, AuthFileModelItem>();
    [...(loadData(access?.catalogs[provider] ?? IDLE_LOAD) ?? []), ...(loadData(models) ?? [])]
      .filter((item) => item.id)
      .forEach((item) => details.set(item.id.toLowerCase(), item));
    return {
      status: load.status,
      message:
        load.status === 'error' ? load.message : models.status === 'error' ? models.message : '',
      unsupported: models.status === 'error' && models.unsupported,
      modelsFailed: !ref.disabled && models.status === 'error' && loadData(models) === null,
      account: inventory?.accounts[0] ?? null,
      rows: inventory ? buildMatrix(inventory) : [],
      details,
    };
  }, [access, file, provider]);

  const stateText = (cell: CellState) => {
    const base = t(`model_access.${cellLabelKey(cell)}`, { rule: cellRule(cell) ?? '' });
    return cellDrift(cell) ? `${base} · ${t('model_access.cell_drift')}` : base;
  };

  let body: ReactNode = null;
  if (view) {
    if (view.status === 'loading' || view.status === 'idle') {
      body = (
        <div className="hint" role="status">
          {t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}
        </div>
      );
    } else if (view.unsupported) {
      body = (
        <EmptyState
          title={t('auth_files.models_unsupported', { defaultValue: '当前版本不支持此功能' })}
          description={t('auth_files.models_unsupported_desc', {
            defaultValue: '请更新 ProxD 到最新版本后重试',
          })}
        />
      );
    } else if ((view.status === 'error' && !view.account) || view.modelsFailed) {
      body = (
        <EmptyState
          title={t('model_access.error_title')}
          description={view.message}
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('model_access.retry_load')}
            </Button>
          }
        />
      );
    } else if (view.rows.length === 0) {
      body = (
        <EmptyState
          title={t('auth_files.models_empty', { defaultValue: '该凭证暂无可用模型' })}
          description={t('auth_files.models_empty_desc', {
            defaultValue: '该认证凭证可能尚未被服务器加载或没有绑定任何模型',
          })}
        />
      );
    } else {
      const account = view.account;
      body = (
        <>
          {account && (
            <p className={styles.listSource}>
              {account.disabled
                ? t('model_access.badge_disabled')
                : accountListKind(account) === 'own'
                  ? t('auth_files.models_own_list')
                  : accountListKind(account) === 'inherits'
                    ? t('auth_files.models_follows_provider')
                    : t(`model_access.badge_${accountListKind(account)}`)}
            </p>
          )}
          <div className={styles.list}>
            {view.rows.map((row) => {
              const cell: CellState = (account && row.cells[account.name]) || { kind: 'unknown' };
              const detail = view.details.get(row.model.toLowerCase());
              const served = servedKinds.has(cell.kind);
              return (
                <button
                  type="button"
                  key={row.model}
                  className={`${styles.item} ${served ? '' : styles.itemExcluded}`}
                  data-state={cell.kind}
                  onClick={() => onCopyText(row.model)}
                  title={t('common.copy')}
                >
                  {/* Three columns shared by every row: name, type, state. */}
                  <span className={styles.modelName}>
                    <span className={styles.modelId}>{row.model}</span>
                    <IconCopy className={styles.copyIcon} size={13} aria-hidden="true" />
                    {detail?.display_name && detail.display_name !== row.model && (
                      <span className={styles.modelDisplayName}>{detail.display_name}</span>
                    )}
                  </span>
                  <span className={styles.modelTypeCell}>
                    {detail?.type && <span className={styles.modelType}>{detail.type}</span>}
                  </span>
                  <span className={served ? styles.servedBadge : styles.excludedBadge}>
                    {stateText(cell)}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      );
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className={styles.title}>
          <span>{t('auth_files.models_title', { account: accountLabel })}</span>
          <span className={styles.subtitle}>{source.label}</span>
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          {file && (
            <Button
              variant="secondary"
              onClick={() => {
                onClose();
                navigate(modelsScreenPath(source.instanceId, provider, file.name), {
                  state: { fromAuthFiles: true, sourceOwner: session.owner },
                });
              }}
            >
              {t('auth_files.edit_in_models')}
            </Button>
          )}
        </>
      }
    >
      <div data-machine="model-inventory" data-state={view?.status ?? 'idle'}>
        {body}
      </div>
    </Modal>
  );
}
