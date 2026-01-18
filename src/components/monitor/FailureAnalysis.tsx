import { useMemo, useState, useCallback, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { useDisableModel } from '@/hooks';
import { TimeRangeSelector, formatTimeRangeCaption, type TimeRange } from './TimeRangeSelector';
import { DisableModelModal } from './DisableModelModal';
import {
  formatTimestamp,
  getRateClassName,
  filterDataByTimeRange,
  getProviderDisplayParts,
  type DateRange,
} from '@/utils/monitor';
import type { UsageData } from '@/pages/MonitorPage';
import styles from '@/pages/MonitorPage.module.scss';

interface FailureAnalysisProps {
  data: UsageData | null;
  loading: boolean;
  providerMap: Record<string, string>;
  providerModels: Record<string, Set<string>>;
}

interface ModelFailureStat {
  success: number;
  failure: number;
  total: number;
  successRate: number;
  recentRequests: { failed: boolean; timestamp: number }[];
  lastTimestamp: number;
}

interface FailureStat {
  source: string;
  displayName: string;
  providerName: string | null;
  maskedKey: string;
  failedCount: number;
  lastFailTime: number;
  models: Record<string, ModelFailureStat>;
}

export function FailureAnalysis({ data, loading, providerMap, providerModels }: FailureAnalysisProps) {
  const { t } = useTranslation();
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [filterChannel, setFilterChannel] = useState('');
  const [filterModel, setFilterModel] = useState('');

  // 时间范围状态
  const [timeRange, setTimeRange] = useState<TimeRange>(7);
  const [customRange, setCustomRange] = useState<DateRange | undefined>();

  // 使用禁用模型 Hook
  const {
    disableState,
    disabling,
    isModelDisabled,
    handleDisableClick: onDisableClick,
    handleConfirmDisable,
    handleCancelDisable,
  } = useDisableModel({ providerMap, providerModels });

  // 处理时间范围变化
  const handleTimeRangeChange = useCallback((range: TimeRange, custom?: DateRange) => {
    setTimeRange(range);
    if (custom) {
      setCustomRange(custom);
    }
  }, []);

  // 根据时间范围过滤数据
  const timeFilteredData = useMemo(() => {
    return filterDataByTimeRange(data, timeRange, customRange);
  }, [data, timeRange, customRange]);

  // 计算失败统计数据
  const failureStats = useMemo(() => {
    if (!timeFilteredData?.apis) return [];

    // 首先收集有失败记录的渠道
    const failedSources = new Set<string>();
    Object.values(timeFilteredData.apis).forEach((apiData) => {
      Object.values(apiData.models).forEach((modelData) => {
        modelData.details.forEach((detail) => {
          if (detail.failed) {
            const source = detail.source || 'unknown';
            const { provider } = getProviderDisplayParts(source, providerMap);
            if (provider) {
              failedSources.add(source);
            }
          }
        });
      });
    });

    // 统计这些渠道的所有请求
    const stats: Record<string, FailureStat> = {};

    Object.values(timeFilteredData.apis).forEach((apiData) => {
      Object.entries(apiData.models).forEach(([modelName, modelData]) => {
        modelData.details.forEach((detail) => {
          const source = detail.source || 'unknown';
          // 只统计有失败记录的渠道
          if (!failedSources.has(source)) return;

          const { provider, masked } = getProviderDisplayParts(source, providerMap);
          const displayName = provider ? `${provider} (${masked})` : masked;
          const timestamp = detail.timestamp ? new Date(detail.timestamp).getTime() : 0;

          if (!stats[displayName]) {
            stats[displayName] = {
              source,
              displayName,
              providerName: provider,
              maskedKey: masked,
              failedCount: 0,
              lastFailTime: 0,
              models: {},
            };
          }

          if (detail.failed) {
            stats[displayName].failedCount++;
            if (timestamp > stats[displayName].lastFailTime) {
              stats[displayName].lastFailTime = timestamp;
            }
          }

          // 按模型统计
          if (!stats[displayName].models[modelName]) {
            stats[displayName].models[modelName] = {
              success: 0,
              failure: 0,
              total: 0,
              successRate: 0,
              recentRequests: [],
              lastTimestamp: 0,
            };
          }
          stats[displayName].models[modelName].total++;
          if (detail.failed) {
            stats[displayName].models[modelName].failure++;
          } else {
            stats[displayName].models[modelName].success++;
          }
          stats[displayName].models[modelName].recentRequests.push({ failed: detail.failed, timestamp });
          if (timestamp > stats[displayName].models[modelName].lastTimestamp) {
            stats[displayName].models[modelName].lastTimestamp = timestamp;
          }
        });
      });
    });

    // 计算成功率并排序请求
    Object.values(stats).forEach((stat) => {
      Object.values(stat.models).forEach((model) => {
        model.successRate = model.total > 0
          ? (model.success / model.total) * 100
          : 0;
        model.recentRequests.sort((a, b) => a.timestamp - b.timestamp);
        model.recentRequests = model.recentRequests.slice(-12);
      });
    });

    return Object.values(stats)
      .filter((stat) => stat.failedCount > 0)
      .sort((a, b) => b.failedCount - a.failedCount)
      .slice(0, 10);
  }, [timeFilteredData, providerMap]);

  // 获取所有渠道和模型列表
  const { channels, models } = useMemo(() => {
    const channelSet = new Set<string>();
    const modelSet = new Set<string>();

    failureStats.forEach((stat) => {
      channelSet.add(stat.displayName);
      Object.keys(stat.models).forEach((model) => modelSet.add(model));
    });

    return {
      channels: Array.from(channelSet).sort(),
      models: Array.from(modelSet).sort(),
    };
  }, [failureStats]);

  // 过滤后的数据
  const filteredStats = useMemo(() => {
    return failureStats.filter((stat) => {
      if (filterChannel && stat.displayName !== filterChannel) return false;
      if (filterModel && !stat.models[filterModel]) return false;
      return true;
    });
  }, [failureStats, filterChannel, filterModel]);

  // 切换展开状态
  const toggleExpand = (displayName: string) => {
    setExpandedChannel(expandedChannel === displayName ? null : displayName);
  };

  // 获取主要失败模型（前2个，已禁用的排在后面）
  const getTopFailedModels = (source: string, modelsMap: Record<string, ModelFailureStat>) => {
    return Object.entries(modelsMap)
      .filter(([, stat]) => stat.failure > 0)
      .sort((a, b) => {
        const aDisabled = isModelDisabled(source, a[0]);
        const bDisabled = isModelDisabled(source, b[0]);
        // 已禁用的排在后面
        if (aDisabled !== bDisabled) {
          return aDisabled ? 1 : -1;
        }
        // 然后按失败数降序
        return b[1].failure - a[1].failure;
      })
      .slice(0, 2);
  };

  // 开始禁用流程（阻止事件冒泡）
  const handleDisableClick = (source: string, model: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDisableClick(source, model);
  };

  return (
    <>
      <Card
        title={t('monitor.failure.title')}
        subtitle={
          <span>
            {formatTimeRangeCaption(timeRange, customRange, t)} · {t('monitor.failure.subtitle')}
            <span style={{ color: 'var(--text-tertiary)' }}> · {t('monitor.failure.click_hint')}</span>
          </span>
        }
        extra={
          <TimeRangeSelector
            value={timeRange}
            onChange={handleTimeRangeChange}
            customRange={customRange}
          />
        }
      >
        {/* 筛选器 */}
        <div className={styles.logFilters}>
          <select
            className={styles.logSelect}
            value={filterChannel}
            onChange={(e) => setFilterChannel(e.target.value)}
          >
            <option value="">{t('monitor.channel.all_channels')}</option>
            {channels.map((channel) => (
              <option key={channel} value={channel}>{channel}</option>
            ))}
          </select>
          <select
            className={styles.logSelect}
            value={filterModel}
            onChange={(e) => setFilterModel(e.target.value)}
          >
            <option value="">{t('monitor.channel.all_models')}</option>
            {models.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </div>

        {/* 表格 */}
        <div className={styles.tableWrapper}>
          {loading ? (
            <div className={styles.emptyState}>{t('common.loading')}</div>
          ) : filteredStats.length === 0 ? (
            <div className={styles.emptyState}>{t('monitor.failure.no_failures')}</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('monitor.failure.header_name')}</th>
                  <th>{t('monitor.failure.header_count')}</th>
                  <th>{t('monitor.failure.header_time')}</th>
                  <th>{t('monitor.failure.header_models')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.map((stat) => {
                  const topModels = getTopFailedModels(stat.source, stat.models);
                  const totalFailedModels = Object.values(stat.models).filter(m => m.failure > 0).length;

                  return (
                    <Fragment key={stat.displayName}>
                      <tr
                        className={styles.expandable}
                        onClick={() => toggleExpand(stat.displayName)}
                      >
                        <td>
                          {stat.providerName ? (
                            <>
                              <span className={styles.channelName}>{stat.providerName}</span>
                              <span className={styles.channelSecret}> ({stat.maskedKey})</span>
                            </>
                          ) : (
                            stat.maskedKey
                          )}
                        </td>
                        <td className={styles.kpiFailure}>{stat.failedCount.toLocaleString()}</td>
                        <td>{formatTimestamp(stat.lastFailTime)}</td>
                        <td>
                          {topModels.map(([model, modelStat]) => {
                            const percent = ((modelStat.failure / stat.failedCount) * 100).toFixed(0);
                            const shortModel = model.length > 16 ? model.slice(0, 13) + '...' : model;
                            const disabled = isModelDisabled(stat.source, model);
                            return (
                              <span
                                key={model}
                                className={`${styles.failureModelTag} ${disabled ? styles.modelDisabled : ''}`}
                                title={`${model}: ${modelStat.failure} (${percent}%)${disabled ? ` - ${t('monitor.logs.removed')}` : ''}`}
                              >
                                {shortModel}
                              </span>
                            );
                          })}
                          {totalFailedModels > 2 && (
                            <span className={styles.moreModelsHint}>
                              +{totalFailedModels - 2}
                            </span>
                          )}
                        </td>
                      </tr>
                      {expandedChannel === stat.displayName && (
                        <tr key={`${stat.displayName}-detail`}>
                          <td colSpan={4} className={styles.expandDetail}>
                            <div className={styles.expandTableWrapper}>
                            <table className={styles.table}>
                              <thead>
                                <tr>
                                  <th>{t('monitor.channel.model')}</th>
                                  <th>{t('monitor.channel.header_count')}</th>
                                  <th>{t('monitor.channel.header_rate')}</th>
                                  <th>{t('monitor.channel.success')}/{t('monitor.channel.failed')}</th>
                                  <th>{t('monitor.channel.header_recent')}</th>
                                  <th>{t('monitor.channel.header_time')}</th>
                                  <th>{t('monitor.logs.header_actions')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(stat.models)
                                  .filter(([, m]) => m.failure > 0)
                                  .sort((a, b) => {
                                    const aDisabled = isModelDisabled(stat.source, a[0]);
                                    const bDisabled = isModelDisabled(stat.source, b[0]);
                                    // 已禁用的排在后面
                                    if (aDisabled !== bDisabled) {
                                      return aDisabled ? 1 : -1;
                                    }
                                    // 然后按失败数降序
                                    return b[1].failure - a[1].failure;
                                  })
                                  .map(([modelName, modelStat]) => {
                                    const disabled = isModelDisabled(stat.source, modelName);
                                    return (
                                      <tr key={modelName} className={disabled ? styles.modelDisabled : ''}>
                                        <td>{modelName}</td>
                                        <td>{modelStat.total.toLocaleString()}</td>
                                        <td className={getRateClassName(modelStat.successRate, styles)}>
                                          {modelStat.successRate.toFixed(1)}%
                                        </td>
                                        <td>
                                          <span className={styles.kpiSuccess}>{modelStat.success}</span>
                                          {' / '}
                                          <span className={styles.kpiFailure}>{modelStat.failure}</span>
                                        </td>
                                        <td>
                                          <div className={styles.statusBars}>
                                            {modelStat.recentRequests.map((req, i) => (
                                              <div
                                                key={i}
                                                className={`${styles.statusBar} ${req.failed ? styles.failure : styles.success}`}
                                              />
                                            ))}
                                          </div>
                                        </td>
                                        <td>{formatTimestamp(modelStat.lastTimestamp)}</td>
                                        <td>
                                          {disabled ? (
                                            <span className={styles.disabledLabel}>{t('monitor.logs.removed')}</span>
                                          ) : stat.source && stat.source !== '-' && stat.source !== 'unknown' ? (
                                            <button
                                              className={styles.disableBtn}
                                              onClick={(e) => handleDisableClick(stat.source, modelName, e)}
                                            >
                                              {t('monitor.logs.disable')}
                                            </button>
                                          ) : '-'}
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* 禁用确认弹窗 */}
      <DisableModelModal
        disableState={disableState}
        disabling={disabling}
        onConfirm={handleConfirmDisable}
        onCancel={handleCancelDisable}
      />
    </>
  );
}
