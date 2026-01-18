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

interface ChannelStatsProps {
  data: UsageData | null;
  loading: boolean;
  providerMap: Record<string, string>;
  providerModels: Record<string, Set<string>>;
}

interface ModelStat {
  requests: number;
  success: number;
  failed: number;
  successRate: number;
  recentRequests: { failed: boolean; timestamp: number }[];
  lastTimestamp: number;
}

interface ChannelStat {
  source: string;
  displayName: string;
  providerName: string | null;
  maskedKey: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  successRate: number;
  lastRequestTime: number;
  recentRequests: { failed: boolean; timestamp: number }[];
  models: Record<string, ModelStat>;
}

export function ChannelStats({ data, loading, providerMap, providerModels }: ChannelStatsProps) {
  const { t } = useTranslation();
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [filterChannel, setFilterChannel] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | 'success' | 'failed'>('');

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

  // 计算渠道统计数据
  const channelStats = useMemo(() => {
    if (!timeFilteredData?.apis) return [];

    const stats: Record<string, ChannelStat> = {};

    Object.values(timeFilteredData.apis).forEach((apiData) => {
      Object.entries(apiData.models).forEach(([modelName, modelData]) => {
        modelData.details.forEach((detail) => {
          const source = detail.source || 'unknown';
          // 获取渠道显示信息
          const { provider, masked } = getProviderDisplayParts(source, providerMap);
          // 只统计在 providerMap 中存在的渠道
          if (!provider) return;

          const displayName = `${provider} (${masked})`;
          const timestamp = detail.timestamp ? new Date(detail.timestamp).getTime() : 0;

          if (!stats[displayName]) {
            stats[displayName] = {
              source,
              displayName,
              providerName: provider,
              maskedKey: masked,
              totalRequests: 0,
              successRequests: 0,
              failedRequests: 0,
              successRate: 0,
              lastRequestTime: 0,
              recentRequests: [],
              models: {},
            };
          }

          stats[displayName].totalRequests++;
          if (detail.failed) {
            stats[displayName].failedRequests++;
          } else {
            stats[displayName].successRequests++;
          }

          // 更新最近请求时间
          if (timestamp > stats[displayName].lastRequestTime) {
            stats[displayName].lastRequestTime = timestamp;
          }

          // 收集请求状态
          stats[displayName].recentRequests.push({ failed: detail.failed, timestamp });

          // 模型统计
          if (!stats[displayName].models[modelName]) {
            stats[displayName].models[modelName] = {
              requests: 0,
              success: 0,
              failed: 0,
              successRate: 0,
              recentRequests: [],
              lastTimestamp: 0,
            };
          }
          stats[displayName].models[modelName].requests++;
          if (detail.failed) {
            stats[displayName].models[modelName].failed++;
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
      stat.successRate = stat.totalRequests > 0
        ? (stat.successRequests / stat.totalRequests) * 100
        : 0;
      // 按时间排序，取最近12个
      stat.recentRequests.sort((a, b) => a.timestamp - b.timestamp);
      stat.recentRequests = stat.recentRequests.slice(-12);

      Object.values(stat.models).forEach((model) => {
        model.successRate = model.requests > 0
          ? (model.success / model.requests) * 100
          : 0;
        model.recentRequests.sort((a, b) => a.timestamp - b.timestamp);
        model.recentRequests = model.recentRequests.slice(-12);
      });
    });

    return Object.values(stats)
      .filter((stat) => stat.totalRequests > 0)
      .sort((a, b) => b.totalRequests - a.totalRequests)
      .slice(0, 10);
  }, [timeFilteredData, providerMap]);

  // 获取所有渠道和模型列表
  const { channels, models } = useMemo(() => {
    const channelSet = new Set<string>();
    const modelSet = new Set<string>();

    channelStats.forEach((stat) => {
      channelSet.add(stat.displayName);
      Object.keys(stat.models).forEach((model) => modelSet.add(model));
    });

    return {
      channels: Array.from(channelSet).sort(),
      models: Array.from(modelSet).sort(),
    };
  }, [channelStats]);

  // 过滤后的数据
  const filteredStats = useMemo(() => {
    return channelStats.filter((stat) => {
      if (filterChannel && stat.displayName !== filterChannel) return false;
      if (filterModel && !stat.models[filterModel]) return false;
      if (filterStatus === 'success' && stat.failedRequests > 0) return false;
      if (filterStatus === 'failed' && stat.failedRequests === 0) return false;
      return true;
    });
  }, [channelStats, filterChannel, filterModel, filterStatus]);

  // 切换展开状态
  const toggleExpand = (displayName: string) => {
    setExpandedChannel(expandedChannel === displayName ? null : displayName);
  };

  // 开始禁用流程（阻止事件冒泡）
  const handleDisableClick = (source: string, model: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onDisableClick(source, model);
  };

  return (
    <>
      <Card
        title={t('monitor.channel.title')}
        subtitle={
          <span>
            {formatTimeRangeCaption(timeRange, customRange, t)} · {t('monitor.channel.subtitle')}
            <span style={{ color: 'var(--text-tertiary)' }}> · {t('monitor.channel.click_hint')}</span>
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
          <select
            className={styles.logSelect}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as '' | 'success' | 'failed')}
          >
            <option value="">{t('monitor.channel.all_status')}</option>
            <option value="success">{t('monitor.channel.only_success')}</option>
            <option value="failed">{t('monitor.channel.only_failed')}</option>
          </select>
        </div>

        {/* 表格 */}
        <div className={styles.tableWrapper}>
          {loading ? (
            <div className={styles.emptyState}>{t('common.loading')}</div>
          ) : filteredStats.length === 0 ? (
            <div className={styles.emptyState}>{t('monitor.no_data')}</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('monitor.channel.header_name')}</th>
                  <th>{t('monitor.channel.header_count')}</th>
                  <th>{t('monitor.channel.header_rate')}</th>
                  <th>{t('monitor.channel.header_recent')}</th>
                  <th>{t('monitor.channel.header_time')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.map((stat) => (
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
                      <td>{stat.totalRequests.toLocaleString()}</td>
                      <td className={getRateClassName(stat.successRate, styles)}>
                        {stat.successRate.toFixed(1)}%
                      </td>
                      <td>
                        <div className={styles.statusBars}>
                          {stat.recentRequests.map((req, i) => (
                            <div
                              key={i}
                              className={`${styles.statusBar} ${req.failed ? styles.failure : styles.success}`}
                            />
                          ))}
                        </div>
                      </td>
                      <td>{formatTimestamp(stat.lastRequestTime)}</td>
                    </tr>
                    {expandedChannel === stat.displayName && (
                      <tr key={`${stat.displayName}-detail`}>
                        <td colSpan={5} className={styles.expandDetail}>
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
                                .sort((a, b) => {
                                  const aDisabled = isModelDisabled(stat.source, a[0]);
                                  const bDisabled = isModelDisabled(stat.source, b[0]);
                                  // 已禁用的排在后面
                                  if (aDisabled !== bDisabled) {
                                    return aDisabled ? 1 : -1;
                                  }
                                  // 然后按请求数降序
                                  return b[1].requests - a[1].requests;
                                })
                                .map(([modelName, modelStat]) => {
                                  const disabled = isModelDisabled(stat.source, modelName);
                                  return (
                                    <tr key={modelName} className={disabled ? styles.modelDisabled : ''}>
                                      <td>{modelName}</td>
                                      <td>{modelStat.requests.toLocaleString()}</td>
                                      <td className={getRateClassName(modelStat.successRate, styles)}>
                                        {modelStat.successRate.toFixed(1)}%
                                      </td>
                                      <td>
                                        <span className={styles.kpiSuccess}>{modelStat.success}</span>
                                        {' / '}
                                        <span className={styles.kpiFailure}>{modelStat.failed}</span>
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
                ))}
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
