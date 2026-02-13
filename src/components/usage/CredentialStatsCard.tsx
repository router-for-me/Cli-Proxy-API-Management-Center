import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { computeKeyStats, formatCompactNumber } from '@/utils/usage';
import { authFilesApi } from '@/services/api/authFiles';
import type { AuthFileItem } from '@/types/authFile';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

export interface CredentialStatsCardProps {
  usage: UsagePayload | null;
  loading: boolean;
}

interface CredentialRow {
  key: string;
  displayName: string;
  type: string;
  success: number;
  failure: number;
  total: number;
  successRate: number;
}

function normalizeAuthIndexValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
}

function buildAuthIndexMap(files: AuthFileItem[]): Map<string, { name: string; type: string }> {
  const map = new Map<string, { name: string; type: string }>();
  files.forEach((file) => {
    const rawAuthIndex = file['auth_index'] ?? file.authIndex;
    const key = normalizeAuthIndexValue(rawAuthIndex);
    if (key) {
      map.set(key, {
        name: file.name || key,
        type: (file.type || file.provider || '').toString(),
      });
    }
  });
  return map;
}

export function CredentialStatsCard({ usage, loading }: CredentialStatsCardProps) {
  const { t } = useTranslation();
  const [authFiles, setAuthFiles] = useState<AuthFileItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    authFilesApi.list().then((res) => {
      if (cancelled) return;
      const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files;
      if (Array.isArray(files)) {
        setAuthFiles(files);
      }
    }).catch(() => {
      // silently ignore - credential names will just show raw auth_index
    });
    return () => { cancelled = true; };
  }, []);

  const authIndexMap = useMemo(() => buildAuthIndexMap(authFiles), [authFiles]);

  const rows = useMemo((): CredentialRow[] => {
    if (!usage) return [];
    const { byAuthIndex } = computeKeyStats(usage);
    return Object.entries(byAuthIndex)
      .map(([key, bucket]) => {
        const total = bucket.success + bucket.failure;
        const mapped = authIndexMap.get(key);
        return {
          key,
          displayName: mapped?.name || key,
          type: mapped?.type || '',
          success: bucket.success,
          failure: bucket.failure,
          total,
          successRate: total > 0 ? (bucket.success / total) * 100 : 100,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [usage, authIndexMap]);

  return (
    <Card title={t('usage_stats.credential_stats')}>
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : rows.length > 0 ? (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('usage_stats.credential_name')}</th>
                <th>{t('usage_stats.requests_count')}</th>
                <th>{t('usage_stats.success_rate')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className={styles.modelCell}>
                    <span>{row.displayName}</span>
                    {row.type && (
                      <span className={styles.credentialType}>{row.type}</span>
                    )}
                  </td>
                  <td>
                    <span className={styles.requestCountCell}>
                      <span>{formatCompactNumber(row.total)}</span>
                      <span className={styles.requestBreakdown}>
                        (<span className={styles.statSuccess}>{row.success.toLocaleString()}</span>{' '}
                        <span className={styles.statFailure}>{row.failure.toLocaleString()}</span>)
                      </span>
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        row.successRate >= 95
                          ? styles.statSuccess
                          : row.successRate >= 80
                            ? styles.statNeutral
                            : styles.statFailure
                      }
                    >
                      {row.successRate.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
