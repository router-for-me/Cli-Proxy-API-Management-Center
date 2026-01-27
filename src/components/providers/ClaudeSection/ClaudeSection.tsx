import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import iconClaude from '@/assets/icons/claude.svg';
import type { ProviderKeyConfig } from '@/types';
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
import { getStatsBySource, hasDisableAllModelsRule } from '../utils';
import type { ProviderFormState } from '../types';
import { ClaudeModal } from './ClaudeModal';

// 健康检查结果类型
interface ModelHealthResult {
  status: 'healthy' | 'unhealthy';
  message?: string;
  latency_ms?: number;
}

interface ClaudeSectionProps {
  configs: ProviderKeyConfig[];
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  loading: boolean;
  disableControls: boolean;
  isSaving: boolean;
  isSwitching: boolean;
  isModalOpen: boolean;
  modalIndex: number | null;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
  onCloseModal: () => void;
  onSave: (data: ProviderFormState, index: number | null) => Promise<void>;
}

export function ClaudeSection({
  configs,
  keyStats,
  usageDetails,
  loading,
  disableControls,
  isSaving,
  isSwitching,
  isModalOpen,
  modalIndex,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  onCloseModal,
  onSave,
}: ClaudeSectionProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const actionsDisabled = disableControls || isSaving || isSwitching;
  const toggleDisabled = disableControls || loading || isSaving || isSwitching;

  // 健康检查状态: apiKey -> modelName -> result
  const [healthResults, setHealthResults] = useState<Record<string, Record<string, ModelHealthResult>>>({});
  // 正在检查的模型: "apiKey:modelName"
  const [checkingModel, setCheckingModel] = useState<string | null>(null);
  // 正在检查的 Provider (用 apiKey 标识)
  const [checkingProvider, setCheckingProvider] = useState<string | null>(null);

  // 单个模型健康检查
  const handleModelHealthCheck = async (apiKey: string, prefix: string | undefined, modelName: string, event: React.MouseEvent) => {
    event.stopPropagation();

    const checkKey = `${apiKey}:${modelName}`;
    if (checkingModel) return;

    setCheckingModel(checkKey);

    try {
      // 使用 prefix 或 API Key 前缀作为标识符
      const providerName = prefix || apiKey.substring(0, 20);
      const result = await providersApi.checkProvidersHealth({
        type: 'claude-api-key',
        name: providerName,
        model: modelName,
        timeout: 20,
      });

      if (result.providers.length > 0) {
        const providerResult = result.providers[0];
        setHealthResults((prev) => ({
          ...prev,
          [apiKey]: {
            ...prev[apiKey],
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
  const handleProviderHealthCheck = async (config: ProviderKeyConfig, event: React.MouseEvent) => {
    event.stopPropagation();

    if (checkingProvider || checkingModel) return;
    if (!config.models?.length) {
      showNotification(t('ai_providers.health_check_no_models', { defaultValue: '该提供商没有配置模型' }), 'warning');
      return;
    }

    setCheckingProvider(config.apiKey);

    try {
      // 使用 prefix 或 API Key 前缀作为标识符
      const providerName = config.prefix || config.apiKey.substring(0, 20);
      const modelNames = config.models.map(m => m.name).join(',');
      const result = await providersApi.checkProvidersHealth({
        type: 'claude-api-key',
        name: providerName,
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
        [config.apiKey]: {
          ...prev[config.apiKey],
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

    configs.forEach((config) => {
      if (!config.apiKey) return;
      const candidates = buildCandidateUsageSourceIds({
        apiKey: config.apiKey,
        prefix: config.prefix,
      });
      if (!candidates.length) return;
      const candidateSet = new Set(candidates);
      const filteredDetails = usageDetails.filter((detail) => candidateSet.has(detail.source));
      cache.set(config.apiKey, calculateStatusBarData(filteredDetails));
    });

    return cache;
  }, [configs, usageDetails]);

  const initialData = modalIndex !== null ? configs[modalIndex] : undefined;

  return (
    <>
      <Card
        title={
          <span className={styles.cardTitle}>
            <img src={iconClaude} alt="" className={styles.cardTitleIcon} />
            {t('ai_providers.claude_title')}
          </span>
        }
        extra={
          <Button size="sm" onClick={onAdd} disabled={actionsDisabled}>
            {t('ai_providers.claude_add_button')}
          </Button>
        }
      >
        <ProviderList<ProviderKeyConfig>
          items={configs}
          loading={loading}
          keyField={(item) => item.apiKey}
          emptyTitle={t('ai_providers.claude_empty_title')}
          emptyDescription={t('ai_providers.claude_empty_desc')}
          onEdit={onEdit}
          onDelete={onDelete}
          actionsDisabled={actionsDisabled}
          getRowDisabled={(item) => hasDisableAllModelsRule(item.excludedModels)}
          renderExtraActions={(item, index) => (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => void handleProviderHealthCheck(item, e)}
                disabled={checkingProvider !== null || checkingModel !== null}
                className={styles.providerHealthCheckButton}
              >
                {checkingProvider === item.apiKey ? (
                  <LoadingSpinner size={14} />
                ) : (
                  t('ai_providers.health_check_button', { defaultValue: '健康检查' })
                )}
              </Button>
              <ToggleSwitch
                label={t('ai_providers.config_toggle_label')}
                checked={!hasDisableAllModelsRule(item.excludedModels)}
                disabled={toggleDisabled}
                onChange={(value) => void onToggle(index, value)}
              />
            </>
          )}
          renderContent={(item) => {
            const stats = getStatsBySource(item.apiKey, keyStats, item.prefix);
            const headerEntries = Object.entries(item.headers || {});
            const configDisabled = hasDisableAllModelsRule(item.excludedModels);
            const excludedModels = item.excludedModels ?? [];
            const statusData = statusBarCache.get(item.apiKey) || calculateStatusBarData([]);

            return (
              <Fragment>
                <div className="item-title">{t('ai_providers.claude_item_title')}</div>
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>{t('common.api_key')}:</span>
                  <span className={styles.fieldValue}>{maskApiKey(item.apiKey)}</span>
                </div>
                {item.prefix && (
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{t('common.prefix')}:</span>
                    <span className={styles.fieldValue}>{item.prefix}</span>
                  </div>
                )}
                {item.baseUrl && (
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{t('common.base_url')}:</span>
                    <span className={styles.fieldValue}>{item.baseUrl}</span>
                  </div>
                )}
                {item.proxyUrl && (
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{t('common.proxy_url')}:</span>
                    <span className={styles.fieldValue}>{item.proxyUrl}</span>
                  </div>
                )}
                {headerEntries.length > 0 && (
                  <div className={styles.headerBadgeList}>
                    {headerEntries.map(([key, value]) => (
                      <span key={key} className={styles.headerBadge}>
                        <strong>{key}:</strong> {value}
                      </span>
                    ))}
                  </div>
                )}
                {configDisabled && (
                  <div className="status-badge warning" style={{ marginTop: 8, marginBottom: 0 }}>
                    {t('ai_providers.config_disabled_badge')}
                  </div>
                )}
                {item.models?.length ? (
                  <div className={styles.modelTagList}>
                    <span className={styles.modelCountLabel}>
                      {t('ai_providers.claude_models_count')}: {item.models.length}
                    </span>
                    {item.models.map((model) => {
                      const healthResult = healthResults[item.apiKey]?.[model.name];
                      const isChecking = checkingModel === `${item.apiKey}:${model.name}`;
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
                            onClick={(e) => void handleModelHealthCheck(item.apiKey, item.prefix, model.name, e)}
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
                {excludedModels.length ? (
                  <div className={styles.excludedModelsSection}>
                    <div className={styles.excludedModelsLabel}>
                      {t('ai_providers.excluded_models_count', { count: excludedModels.length })}
                    </div>
                    <div className={styles.modelTagList}>
                      {excludedModels.map((model) => (
                        <span key={model} className={`${styles.modelTag} ${styles.excludedModelTag}`}>
                          <span className={styles.modelName}>{model}</span>
                        </span>
                      ))}
                    </div>
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

      <ClaudeModal
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
