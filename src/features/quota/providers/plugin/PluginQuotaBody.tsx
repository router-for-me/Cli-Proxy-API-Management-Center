/**
 * 通用插件额度渲染体：整体额度 + 每个套餐一行水位条。
 *
 * 与内置 provider 共用同一套行语法（QuotaMeter / QuotaResetLabel），这样插件凭证
 * 在额度页和认证文件卡片里看起来与内置 provider 完全一致。
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginQuotaState } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

export function PluginQuotaBody({ quota, classes }: QuotaBodyProps<PluginQuotaState>) {
  const { t, i18n } = useTranslation();
  // Ahead of the early return below — hooks cannot be conditional.
  const now = useNow();
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('plugin', quota), now),
    [quota, now]
  );

  const rows = quota.rows ?? [];
  if (rows.length === 0) {
    return <div className={classes.quotaMessage}>{t('plugin_quota.empty_data')}</div>;
  }

  return (
    <>
      {rows.map((row, index) => {
        const percentLabel = row.percent === null ? '--' : `${Math.round(row.percent)}%`;
        const resetDisplay = buildResetDisplay(
          null,
          row.resetAtMs,
          now,
          i18n.resolvedLanguage
        );
        const soon = row.id === soonestRowId;

        return (
          <div
            key={row.id}
            className={classes.quotaRow}
            title={soon ? t('quota_management.soonest_row_hint') : undefined}
          >
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{row.label}</span>
              <div className={classes.quotaMeta}>
                {row.amount && <span className={classes.quotaAmount}>{row.amount}</span>}
                <span className={classes.quotaPercent}>{percentLabel}</span>
                {resetDisplay && (
                  <QuotaResetLabel display={resetDisplay} classes={classes} soon={soon} />
                )}
              </div>
            </div>
            <QuotaMeter percent={row.percent} classes={classes} index={index} />
          </div>
        );
      })}
    </>
  );
}
