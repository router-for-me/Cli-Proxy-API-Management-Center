/**
 * Accounts grid: provider sections, one line per credential. Window columns are
 * shared within a section so meters line up down the page.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { useNow } from '@/hooks/useNow';
import type { QuotaHistory, QuotaHistoryAccount } from '@/services/api/quotaHistory';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { AccountRow } from './AccountRow';
import {
  historyWindowCells,
  liveWindowCells,
  sectionColumns,
  type AccountWindowCell,
} from './rowModel';
import styles from './AccountsTable.module.scss';

/** Provider identity colors, matching the pool charts. */
const PROVIDER_COLORS: Record<string, { dark: string; light: string }> = {
  claude: { dark: '#e2987f', light: '#c2603d' },
  codex: { dark: '#90aadb', light: '#3f68b5' },
};
const NEUTRAL_COLOR = { dark: '#c4c4c4', light: '#5c5c5c' };

export type AccountsTableProps = {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  nameFor: (entry: QuotaFileEntry) => string;
  history: QuotaHistory | null;
  priorityRouting: boolean;
  resolvedTheme: ResolvedTheme;
  canUseActions: boolean;
  resettingName: string | null;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
};

const historyFor = (
  history: QuotaHistory | null,
  entry: QuotaFileEntry
): QuotaHistoryAccount | undefined => {
  const name = String(entry.file.name ?? '');
  const authIndex = normalizeAuthIndex(entry.file['auth_index'] ?? entry.file.authIndex);
  return history?.accounts.find(
    (account) =>
      account.provider === entry.type &&
      (account.fileName === name ||
        account.authId === name ||
        (authIndex !== null && account.authIndex === authIndex))
  );
};

/** Plan label from the live state, else from the recorded history. */
const planOf = (
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined,
  recordedPlan: string | undefined,
  t: (key: string) => string
): string | null => {
  const translate = (key: string) => {
    const value = t(key);
    return value === key ? null : value;
  };
  const live = quota?.status === 'success' ? (quota as unknown as Record<string, unknown>) : null;
  if (entry.type === 'claude') {
    const planType = typeof live?.planType === 'string' ? live.planType : null;
    if (planType) return translate(`claude_quota.${planType}`);
    return recordedPlan ? translate(`claude_quota.plan_${recordedPlan}`) : null;
  }
  if (entry.type === 'codex') {
    const planType = typeof live?.planType === 'string' ? live.planType : recordedPlan;
    return planType ? (translate(`codex_quota.plan_${planType}`) ?? planType) : null;
  }
  if (entry.type === 'devin' && typeof live?.plan === 'string') return live.plan;
  if (entry.type === 'meta') {
    const data = live?.data as { planName?: string } | undefined;
    return data?.planName ?? null;
  }
  if (entry.type === 'antigravity') {
    const subscription = live?.subscription as { tierName?: string | null; plan?: string | null };
    return subscription?.tierName ?? subscription?.plan ?? null;
  }
  return null;
};

export function AccountsTable(props: AccountsTableProps) {
  const { entries, quotaFor, nameFor, history, priorityRouting, resolvedTheme } = props;
  const { canUseActions, resettingName, onRefresh, onReset } = props;
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const now = useNow();

  const sections = useMemo(() => {
    const groups = new Map<string, QuotaFileEntry[]>();
    entries.forEach((entry) => {
      const group = groups.get(entry.type) ?? [];
      group.push(entry);
      groups.set(entry.type, group);
    });
    return Array.from(groups.entries()).map(([type, group]) => {
      const rows = group.map((entry) => {
        const quota = quotaFor(entry);
        const recorded = historyFor(history, entry);
        const live = liveWindowCells(entry.type, quota, t);
        let cells: AccountWindowCell[] = live;
        let recordedAtMs: number | null = null;
        if (live.length === 0 && quota?.status !== 'success') {
          const fromHistory = historyWindowCells(recorded, now, t);
          cells = fromHistory.cells;
          recordedAtMs = fromHistory.cells.length > 0 ? fromHistory.observedAtMs : null;
        }
        return { entry, quota, cells, recordedAtMs, plan: planOf(entry, quota, recorded?.plan, t) };
      });
      const columns = sectionColumns(rows.map((row) => row.cells));
      const showBank = type === 'claude' || type === 'codex';
      const gridTemplate = [
        'minmax(210px, 1.35fr)',
        `repeat(${Math.max(1, columns.length)}, minmax(128px, 1fr))`,
        showBank ? 'minmax(140px, 0.8fr)' : '',
        'minmax(150px, auto)',
      ]
        .filter(Boolean)
        .join(' ');
      return { type, rows, columns, showBank, gridTemplate };
    });
  }, [entries, history, now, quotaFor, t]);

  return (
    <div className={styles.table}>
      {sections.map((section) => {
        const label = getTypeLabel(t, section.type);
        const icon = getAuthFileIcon(section.type, resolvedTheme);
        const palette = PROVIDER_COLORS[section.type] ?? NEUTRAL_COLOR;
        const color = resolvedTheme === 'dark' ? palette.dark : palette.light;
        return (
          <section key={section.type} className={styles.section} aria-label={label}>
            <header className={styles.sectionHeader}>
              {icon && (
                <span
                  className={styles.sectionIcon}
                  style={
                    isThemeSurfaceIconProvider(section.type)
                      ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                      : undefined
                  }
                >
                  <img src={icon} alt="" />
                </span>
              )}
              <h3 className={styles.sectionTitle}>{label}</h3>
              <span className={styles.sectionCount}>{section.rows.length}</span>
            </header>
            <div role="list">
              {section.rows.map((row) => (
                <AccountRow
                  key={getQuotaCacheKey(row.entry.file)}
                  entry={row.entry}
                  quota={row.quota}
                  name={nameFor(row.entry)}
                  plan={row.plan}
                  columns={section.columns}
                  cells={row.cells}
                  recordedAtMs={row.recordedAtMs}
                  showBank={section.showBank}
                  priorityRouting={priorityRouting}
                  color={color}
                  gridTemplate={section.gridTemplate}
                  now={now}
                  locale={locale}
                  canRefresh={canUseActions && !row.entry.file.disabled}
                  resetting={resettingName === getQuotaCacheKey(row.entry.file)}
                  onRefresh={() => onRefresh(row.entry)}
                  onReset={() => onReset(row.entry)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
