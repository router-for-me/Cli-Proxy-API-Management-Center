import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconCheck, IconX } from '@/components/ui/icons';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import type { OpenAIProviderConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import {
  buildCandidateUsageSourceIds,
  calculateStatusBarData,
  type KeyStats,
  type UsageDetail,
} from '@/utils/usage';
import { providersApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import styles from '@/pages/AiProvidersPage.module.scss';
import { ProviderList } from '../ProviderList';
import { ProviderStatusBar } from '../ProviderStatusBar';
import { getOpenAIProviderStats, getStatsBySource } from '../utils';
import type { OpenAIFormState } from '../types';
import { OpenAIModal } from './OpenAIModal';

// 健康检查结果类型
interface ModelHealthResult {
  status: 'healthy' | 'unhealthy';
  message?: string;
  latency_ms?: number;
}

interface OpenAISectionProps {
  configs: OpenAIProviderConfig[];
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  loading: boolean;
  disableControls: boolean;
  isSaving: boolean;
  isSwitching: boolean;
  resolvedTheme: string;
  isModalOpen: boolean;
  modalIndex: number | null;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onCloseModal: () => void;
  onSave: (data: OpenAIFormState, index: number | null) => Promise<void>;
}

export function OpenAISection({
  configs,
  keyStats,
  usageDetails,
  loading,
  disableControls,
  isSaving,
  isSwitching,
  resolvedTheme,
  isModalOpen,
  modalIndex,
  onAdd,
  onEdit,
  onDelete,
  onCloseModal,
  onSave,
}: OpenAISectionProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const actionsDisabled = disableControls || isSaving || isSwitching;

  // 健康检查状态: providerName -> modelName -> result
  const [healthResults, setHealthResults] = useState<Record<string, Record<string, ModelHealthResult>>>({});
  // 正在检查的模型: "providerName:modelName"
  const [checkingModel, setCheckingModel] = useState<string | null>(null);
  // 正在检查的 Provider
  const [checkingProvider, setCheckingProvider] = useState<string | null>(null);

  // 单个模型健康检查
  const handleModelHealthCheck = async (providerName: string, modelName: string, event: React.MouseEvent) => {
    event.stopPropagation();

    const checkKey = `${providerName}:${modelName}`;
    if (checkingModel) return;

    setCheckingModel(checkKey);

    try {
      const result = await providersApi.checkProvidersHealth({
        name: providerName,
        model: modelName,
        timeout: 20,
      });

      if (result.providers.length > 0) {
        const providerResult = result.providers[0];
        setHealthResults((prev) => ({
          ...prev,
          [providerName]: {
            ...prev[providerName],
            [modelName]: {
              status: providerResult.status,
              message: providerResult.message,
              latency_ms: providerResult.latency_ms,
            },
          },
        }));

        if (providerResult.status === 'healthy') {
          showNotification(
            `${modelName}: ${t('ai_providers.health_status_healthy', { defaultValue: '健康' })}${providerResult.latency_ms ? ` (${providerResult.latency_ms}ms)` : ''}`,
            'success'
          );
        } else {
          showNotification(
            `${modelName}: ${t('ai_providers.health_status_unhealthy', { defaultValue: '异常' })} - ${providerResult.message || ''}`,
            'error'
          );
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      showNotification(
        `${modelName}: ${t('ai_providers.health_check_failed', { defaultValue: '健康检查失败' })} - ${errorMessage}`,
        'error'
      );
    } finally {
      setCheckingModel(null);
    }
  };

  // Provider 级别的健康检查（检查所有模型）
  const handleProviderHealthCheck = async (provider: OpenAIProviderConfig, event: React.MouseEvent) => {
    event.stopPropagation();

    if (checkingProvider || checkingModel) return;
    if (!provider.models?.length) {
      showNotification(t('ai_providers.health_check_no_models', { defaultValue: '该提供商没有配置模型' }), 'warning');
      return;
    }

    setCheckingProvider(provider.name);

    try {
      // 获取所有模型名称
      const modelNames = provider.models.map(m => m.name).join(',');
      const result = await providersApi.checkProvidersHealth({
        name: provider.name,
        models: modelNames,
        timeout: 30,
      });

      // 更新所有模型的健康检查结果
      const newResults: Record<string, ModelHealthResult> = {};
      result.providers.forEach((providerResult) => {
        if (providerResult.model_tested) {
          newResults[providerResult.model_tested] = {
            status: providerResult.status,
            message: providerResult.message,
            latency_ms: providerResult.latency_ms,
          };
        }
      });

      setHealthResults((prev) => ({
        ...prev,
        [provider.name]: {
          ...prev[provider.name],
          ...newResults,
        },
      }));

      // 显示汇总通知
      if (result.healthy_count === result.total_count) {
        showNotification(
          t('ai_providers.health_check_all_healthy', { count: result.total_count, defaultValue: `所有 ${result.total_count} 个模型健康` }),
          'success'
        );
      } else if (result.unhealthy_count === result.total_count) {
        showNotification(
          t('ai_providers.health_check_all_unhealthy', { count: result.total_count, defaultValue: `所有 ${result.total_count} 个模型异常` }),
          'error'
        );
      } else {
        showNotification(
          t('ai_providers.health_check_result', {
            healthy: result.healthy_count,
            unhealthy: result.unhealthy_count,
            defaultValue: `健康检查完成：${result.healthy_count} 个健康，${result.unhealthy_count} 个异常`,
          }),
          'warning'
        );
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      showNotification(
        `${t('ai_providers.health_check_failed', { defaultValue: '健康检查失败' })}: ${errorMessage}`,
        'error'
      );
    } finally {
      setCheckingProvider(null);
    }
  };

  const statusBarCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof calculateStatusBarData>>();

    configs.forEach((provider) => {
      const sourceIds = new Set<string>();
      buildCandidateUsageSourceIds({ prefix: provider.prefix }).forEach((id) => sourceIds.add(id));
      (provider.apiKeyEntries || []).forEach((entry) => {
        buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => sourceIds.add(id));
      });

      const filteredDetails = sourceIds.size
        ? usageDetails.filter((detail) => sourceIds.has(detail.source))
        : [];
      cache.set(provider.name, calculateStatusBarData(filteredDetails));
    });

    return cache;
  }, [configs, usageDetails]);

  const initialData = modalIndex !== null ? configs[modalIndex] : undefined;

  return (
    <>
      <Card
        title={
          <span className={styles.cardTitle}>
            <img
              src={resolvedTheme === 'dark' ? iconOpenaiDark : iconOpenaiLight}
              alt=""
              className={styles.cardTitleIcon}
            />
            {t('ai_providers.openai_title')}
          </span>
        }
        extra={
          <Button size="sm" onClick={onAdd} disabled={actionsDisabled}>
            {t('ai_providers.openai_add_button')}
          </Button>
        }
      >
        <ProviderList<OpenAIProviderConfig>
          items={configs}
          loading={loading}
          keyField={(item) => item.name}
          emptyTitle={t('ai_providers.openai_empty_title')}
          emptyDescription={t('ai_providers.openai_empty_desc')}
          onEdit={onEdit}
          onDelete={onDelete}
          actionsDisabled={actionsDisabled}
          renderExtraActions={(item) => (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => void handleProviderHealthCheck(item, e)}
              disabled={checkingProvider !== null || checkingModel !== null}
              className={styles.providerHealthCheckButton}
            >
              {checkingProvider === item.name ? (
                <LoadingSpinner size={14} />
              ) : (
                t('ai_providers.health_check_button', { defaultValue: '健康检查' })
              )}
            </Button>
          )}
          renderContent={(item) => {
            const stats = getOpenAIProviderStats(item.apiKeyEntries, keyStats, item.prefix);
            const headerEntries = Object.entries(item.headers || {});
            const apiKeyEntries = item.apiKeyEntries || [];
            const statusData = statusBarCache.get(item.name) || calculateStatusBarData([]);

            return (
              <Fragment>
                <div className="item-title">{item.name}</div>
                {item.prefix && (
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{t('common.prefix')}:</span>
                    <span className={styles.fieldValue}>{item.prefix}</span>
                  </div>
                )}
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>{t('common.base_url')}:</span>
                  <span className={styles.fieldValue}>{item.baseUrl}</span>
                </div>
                {headerEntries.length > 0 && (
                  <div className={styles.headerBadgeList}>
                    {headerEntries.map(([key, value]) => (
                      <span key={key} className={styles.headerBadge}>
                        <strong>{key}:</strong> {value}
                      </span>
                    ))}
                  </div>
                )}
                {apiKeyEntries.length > 0 && (
                  <div className={styles.apiKeyEntriesSection}>
                    <div className={styles.apiKeyEntriesLabel}>
                      {t('ai_providers.openai_keys_count')}: {apiKeyEntries.length}
                    </div>
                    <div className={styles.apiKeyEntryList}>
                      {apiKeyEntries.map((entry, entryIndex) => {
                        const entryStats = getStatsBySource(entry.apiKey, keyStats);
                        return (
                          <div key={entryIndex} className={styles.apiKeyEntryCard}>
                            <span className={styles.apiKeyEntryIndex}>{entryIndex + 1}</span>
                            <span className={styles.apiKeyEntryKey}>{maskApiKey(entry.apiKey)}</span>
                            {entry.proxyUrl && (
                              <span className={styles.apiKeyEntryProxy}>{entry.proxyUrl}</span>
                            )}
                            <div className={styles.apiKeyEntryStats}>
                              <span
                                className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}
                              >
                                <IconCheck size={12} /> {entryStats.success}
                              </span>
                              <span
                                className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}
                              >
                                <IconX size={12} /> {entryStats.failure}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className={styles.fieldRow} style={{ marginTop: '8px' }}>
                  <span className={styles.fieldLabel}>{t('ai_providers.openai_models_count')}:</span>
                  <span className={styles.fieldValue}>{item.models?.length || 0}</span>
                </div>
                {item.models?.length ? (
                  <div className={styles.modelTagList}>
                    {item.models.map((model) => {
                      const healthResult = healthResults[item.name]?.[model.name];
                      const isChecking = checkingModel === `${item.name}:${model.name}`;
                      return (
                        <span
                          key={model.name}
                          className={`${styles.modelTag} ${
                            healthResult
                              ? healthResult.status === 'healthy'
                                ? styles.modelTagHealthy
                                : styles.modelTagUnhealthy
                              : ''
                          }`}
                        >
                          <span className={styles.modelName}>{model.name}</span>
                          {model.alias && model.alias !== model.name && (
                            <span className={styles.modelAlias}>{model.alias}</span>
                          )}
                          {healthResult && (
                            <span
                              className={
                                healthResult.status === 'healthy'
                                  ? styles.modelHealthBadge
                                  : styles.modelHealthBadgeUnhealthy
                              }
                            >
                              {healthResult.status === 'healthy'
                                ? healthResult.latency_ms
                                  ? `${healthResult.latency_ms}ms`
                                  : '✓'
                                : '✗'}
                            </span>
                          )}
                          <button
                            type="button"
                            className={styles.modelCheckButton}
                            onClick={(e) => void handleModelHealthCheck(item.name, model.name, e)}
                            disabled={checkingModel !== null}
                            title={t('ai_providers.health_check_single', { defaultValue: '检查此模型' })}
                          >
                            {isChecking ? (
                              <LoadingSpinner size={12} />
                            ) : (
                              <span className={styles.checkIcon}>✓</span>
                            )}
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
                <div className={styles.cardStats}>
                  <span className={`${styles.statPill} ${styles.statSuccess}`}>
                    {t('stats.success')}: {stats.success}
                  </span>
                  <span className={`${styles.statPill} ${styles.statFailure}`}>
                    {t('stats.failure')}: {stats.failure}
                  </span>
                </div>
                <ProviderStatusBar statusData={statusData} />
              </Fragment>
            );
          }}
        />
      </Card>

      <OpenAIModal
        isOpen={isModalOpen}
        editIndex={modalIndex}
        initialData={initialData}
        onClose={onCloseModal}
        onSave={onSave}
        isSaving={isSaving}
      />
    </>
  );
}
