import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { isModelExcluded } from '@/features/authFiles/constants';
import styles from './AuthFileModelsModal.module.scss';

export type AuthFileModelsPanelProps = {
  loading: boolean;
  error: 'unsupported' | null;
  models: AuthFileModelItem[];
  fileType: string;
  excluded: Record<string, string[]>;
  onCopyText: (text: string) => void;
};

/** Inline model catalog used by both the account drawer and the legacy modal. */
export function AuthFileModelsPanel({
  loading,
  error,
  models,
  fileType,
  excluded,
  onCopyText,
}: AuthFileModelsPanelProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className={styles.hint}>
        {t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}
      </div>
    );
  }

  if (error === 'unsupported') {
    return (
      <EmptyState
        title={t('auth_files.models_unsupported', { defaultValue: '当前版本不支持此功能' })}
        description={t('auth_files.models_unsupported_desc', {
          defaultValue: '请更新 CLI Proxy API 到最新版本后重试',
        })}
      />
    );
  }

  if (models.length === 0) {
    return (
      <EmptyState
        title={t('auth_files.models_empty', { defaultValue: '该凭证暂无可用模型' })}
        description={t('auth_files.models_empty_desc', {
          defaultValue: '该认证凭证可能尚未被服务器加载或没有绑定任何模型',
        })}
      />
    );
  }

  return (
    <div className={styles.list}>
      {models.map((model) => {
        const excludedModel = isModelExcluded(model.id, fileType, excluded);
        return (
          <div
            key={model.id}
            className={`${styles.item} ${excludedModel ? styles.itemExcluded : ''}`}
            onClick={() => onCopyText(model.id)}
            title={
              excludedModel
                ? t('auth_files.models_excluded_hint', {
                    defaultValue: '此 OAuth 模型已被禁用',
                  })
                : t('common.copy', { defaultValue: '点击复制' })
            }
          >
            <span className={styles.modelId}>{model.id}</span>
            {model.display_name && model.display_name !== model.id && (
              <span className={styles.modelDisplayName}>{model.display_name}</span>
            )}
            {model.type && <span className={styles.modelType}>{model.type}</span>}
            {excludedModel && (
              <span className={styles.excludedBadge}>
                {t('auth_files.models_excluded_badge', { defaultValue: '已禁用' })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
