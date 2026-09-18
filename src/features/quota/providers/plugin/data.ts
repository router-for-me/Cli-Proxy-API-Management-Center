/**
 * 通用插件额度数据层。
 *
 * 内置六个 provider 各有一套上游接口；插件 provider 由宿主按 provider 解析额度
 * 实现，并经 `/quota/fetch` 回同一套归一化形状。因此这一层只做「取数 + 折算行」，
 * 不关心具体上游。
 *
 * React-free / SCSS-free —— 可被纯逻辑测试直接消费。
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, PluginQuotaState } from '@/types';
import { pluginQuotaApi } from '@/services/api/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isDisabledAuthFile } from '@/utils/quota';
import {
  buildPluginQuotaRows,
  hasPluginQuotaContent,
  isPluginQuotaAuthFile,
} from '@/utils/quota/pluginQuota';
import type { QuotaProviderData } from '../types';

const fetchPluginQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<PluginQuotaState['rows']> => {
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  if (!authIndex) {
    throw new Error(t('plugin_quota.missing_auth_index'));
  }

  const payload = await pluginQuotaApi.fetch(authIndex);
  if (!hasPluginQuotaContent(payload)) {
    throw new Error(t('plugin_quota.empty_data'));
  }

  return buildPluginQuotaRows(payload, {
    total: t('plugin_quota.total_label'),
    group: t('plugin_quota.group_label'),
  });
};

export const PLUGIN_CONFIG: QuotaProviderData<PluginQuotaState, PluginQuotaState['rows']> =
  {
    type: 'plugin',
    i18nPrefix: 'plugin_quota',
    filterFn: (file) => isPluginQuotaAuthFile(file) && !isDisabledAuthFile(file),
    fetchQuota: fetchPluginQuota,
    storeSelector: (state) => state.pluginQuota,
    storeSetter: 'setPluginQuota',
    buildLoadingState: () => ({ status: 'loading', rows: [] }),
    buildSuccessState: (rows) => ({ status: 'success', rows }),
    buildErrorState: (message, status) => ({
      status: 'error',
      rows: [],
      error: message,
      errorStatus: status,
    }),
  };
