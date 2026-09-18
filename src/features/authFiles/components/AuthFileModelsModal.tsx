import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi, type AuthFileModelTestResult } from '@/services/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { isModelExcluded } from '@/features/authFiles/constants';
import styles from './AuthFileModelsModal.module.scss';

export type AuthFileModelsModalProps = {
  open: boolean;
  fileName: string;
  authIndex: string;
  disabled?: boolean;
  fileType: string;
  loading: boolean;
  error: 'unsupported' | null;
  models: AuthFileModelItem[];
  excluded: Record<string, string[]>;
  onClose: () => void;
  onCopyText: (text: string) => void;
};

export function AuthFileModelsModal(props: AuthFileModelsModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={`${t('auth_files.models_title')} - ${props.fileName}`}
      footer={
        <Button variant="secondary" onClick={props.onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {props.open && <ModelsModalContent key={`${props.fileName}:${props.authIndex}`} {...props} />}
    </Modal>
  );
}

function ModelsModalContent(props: AuthFileModelsModalProps) {
  const { t } = useTranslation();
  const {
    authIndex,
    fileType,
    loading,
    error,
    models,
    excluded,
    onCopyText,
    disabled = false,
  } = props;
  const [testingModels, setTestingModels] = useState<Set<string>>(new Set());
  const [testResults, setTestResults] = useState<Record<string, AuthFileModelTestResult>>({});
  const requestsRef = useRef(new Map<string, AbortController>());
  useEffect(
    () => () => {
      requestsRef.current.forEach((controller) => controller.abort());
      requestsRef.current.clear();
    },
    []
  );

  const testModel = async (model: AuthFileModelItem) => {
    if (
      !authIndex ||
      disabled ||
      !model.testKind ||
      model.testKind === 'unsupported' ||
      requestsRef.current.has(model.id)
    )
      return;
    const controller = new AbortController();
    requestsRef.current.set(model.id, controller);
    setTestingModels((current) => new Set(current).add(model.id));
    setTestResults((current) => {
      const next = { ...current };
      delete next[model.id];
      return next;
    });
    try {
      const result = await authFilesApi.testModelForAuthFile(
        authIndex,
        model.id,
        controller.signal
      );
      if (!controller.signal.aborted)
        setTestResults((current) => ({ ...current, [model.id]: result }));
    } catch (error) {
      if (!controller.signal.aborted) {
        const status = (error as { status?: number })?.status;
        setTestResults((current) => ({
          ...current,
          [model.id]: {
            success: false,
            model: model.id,
            kind: model.testKind === 'image' ? 'image' : 'text',
            latencyMs: 0,
            error: {
              code: 'request_failed',
              message:
                status === 404 || status === 405
                  ? t('auth_files.model_test_upgrade')
                  : error instanceof Error
                    ? error.message
                    : t('auth_files.model_test_failed'),
            },
          },
        }));
      }
    } finally {
      if (requestsRef.current.get(model.id) === controller) {
        requestsRef.current.delete(model.id);
        if (!controller.signal.aborted) {
          setTestingModels((current) => {
            const next = new Set(current);
            next.delete(model.id);
            return next;
          });
        }
      }
    }
  };
  return (
    <>
      {loading ? (
        <div className="hint">
          {t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}
        </div>
      ) : error === 'unsupported' ? (
        <EmptyState
          title={t('auth_files.models_unsupported', { defaultValue: '当前版本不支持此功能' })}
          description={t('auth_files.models_unsupported_desc', {
            defaultValue: '请更新 CLI Proxy API 到最新版本后重试',
          })}
        />
      ) : models.length === 0 ? (
        <EmptyState
          title={t('auth_files.models_empty', { defaultValue: '该凭证暂无可用模型' })}
          description={t('auth_files.models_empty_desc', {
            defaultValue: '该认证凭证可能尚未被服务器加载或没有绑定任何模型',
          })}
        />
      ) : (
        <>
          <p className="hint">{t('auth_files.model_test_hint')}</p>
          <div className={styles.list}>
            {models.map((model) => {
              const excludedModel = isModelExcluded(model.id, fileType, excluded);
              const result = testResults[model.id];
              const testing = testingModels.has(model.id);
              const unavailable = !model.testKind
                ? t('auth_files.model_test_upgrade')
                : model.testKind === 'unsupported'
                  ? t('auth_files.model_test_unsupported')
                  : !authIndex || disabled
                    ? t('auth_files.model_test_disabled')
                    : excludedModel
                      ? t('auth_files.models_excluded_hint')
                      : '';
              return (
                <div
                  key={model.id}
                  className={`${styles.item} ${excludedModel ? styles.itemExcluded : ''}`}
                >
                  <div className={styles.modelRow}>
                    <button
                      type="button"
                      className={styles.copyButton}
                      onClick={() => onCopyText(model.id)}
                      title={t('common.copy')}
                    >
                      <span className={styles.modelId}>{model.id}</span>
                      {model.display_name && model.display_name !== model.id && (
                        <span className={styles.modelDisplayName}>{model.display_name}</span>
                      )}
                      {model.type && <span className={styles.modelType}>{model.type}</span>}
                    </button>
                    {excludedModel && (
                      <span className={styles.excludedBadge}>
                        {t('auth_files.models_excluded_badge')}
                      </span>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={Boolean(unavailable) || testing}
                      loading={testing}
                      onClick={() => void testModel(model)}
                      aria-label={t('auth_files.model_test_button', { model: model.id })}
                    >
                      {testing ? t('auth_files.model_testing') : t('auth_files.model_test')}
                    </Button>
                  </div>
                  {unavailable && <span className={styles.imageHint}>{unavailable}</span>}
                  <div
                    role="status"
                    aria-live="polite"
                    className={result?.success ? styles.testSuccess : styles.testFailure}
                  >
                    {testing
                      ? t('auth_files.model_testing')
                      : result && (
                          <>
                            <span>
                              {result.success
                                ? t('auth_files.model_test_success')
                                : t('auth_files.model_test_failed')}{' '}
                              · {t('auth_files.model_test_latency', { ms: result.latencyMs })}
                            </span>
                            <div>
                              {result.success
                                ? result.kind === 'image'
                                  ? t('auth_files.model_test_images', {
                                      count: result.imageCount ?? 0,
                                    })
                                  : result.message
                                : `${result.error?.statusCode ? `HTTP ${result.error.statusCode}: ` : ''}${result.error?.message || t('auth_files.model_test_failed')}`}
                            </div>
                          </>
                        )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
