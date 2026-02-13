import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import {
  computeKeyStats,
  collectUsageDetails,
  buildCandidateUsageSourceIds,
  formatCompactNumber
} from '@/utils/usage';
import { authFilesApi } from '@/services/api/authFiles';
import type { GeminiKeyConfig, ProviderKeyConfig, OpenAIProviderConfig } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

export interface CredentialStatsCardProps {
  usage: UsagePayload | null;
  loading: boolean;
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
}

interface CredentialInfo {
  name: string;
  type: string;
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

interface CredentialBucket {
  success: number;
  failure: number;
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

export function CredentialStatsCard({
  usage,
  loading,
  geminiKeys,
  claudeConfigs,
  codexConfigs,
  vertexConfigs,
  openaiProviders,
}: CredentialStatsCardProps) {
  const { t } = useTranslation();
  const [authFileMap, setAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map());

  // Fetch auth files for auth_index-based matching
  useEffect(() => {
    let cancelled = false;
    authFilesApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files;
        if (!Array.isArray(files)) return;
        const map = new Map<string, CredentialInfo>();
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
        setAuthFileMap(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Aggregate rows: all from bySource only (no separate byAuthIndex rows to avoid duplicates).
  // Auth files are used purely for name resolution of unmatched source IDs.
  const rows = useMemo((): CredentialRow[] => {
    if (!usage) return [];
    const { bySource } = computeKeyStats(usage);
    const details = collectUsageDetails(usage);
    const result: CredentialRow[] = [];
    const consumedSourceIds = new Set<string>();
    const authIndexToRowIndex = new Map<string, number>();
    const sourceToAuthIndex = new Map<string, string>();
    const fallbackByAuthIndex = new Map<string, CredentialBucket>();

    const mergeBucketToRow = (index: number, bucket: CredentialBucket) => {
      const target = result[index];
      if (!target) return;
      target.success += bucket.success;
      target.failure += bucket.failure;
      target.total = target.success + target.failure;
      target.successRate = target.total > 0 ? (target.success / target.total) * 100 : 100;
    };

    // Aggregate all candidate source IDs for one provider config into a single row
    const addConfigRow = (
      apiKey: string,
      prefix: string | undefined,
      name: string,
      type: string,
      rowKey: string,
    ) => {
      const candidates = buildCandidateUsageSourceIds({ apiKey, prefix });
      let success = 0;
      let failure = 0;
      candidates.forEach((id) => {
        const bucket = bySource[id];
        if (bucket) {
          success += bucket.success;
          failure += bucket.failure;
          consumedSourceIds.add(id);
        }
      });
      const total = success + failure;
      if (total > 0) {
        result.push({
          key: rowKey,
          displayName: name,
          type,
          success,
          failure,
          total,
          successRate: (success / total) * 100,
        });
      }
    };

    // Provider rows — one row per config, stats merged across all its candidate source IDs
    geminiKeys.forEach((c, i) =>
      addConfigRow(c.apiKey, c.prefix, c.prefix?.trim() || `Gemini #${i + 1}`, 'gemini', `gemini:${i}`));
    claudeConfigs.forEach((c, i) =>
      addConfigRow(c.apiKey, c.prefix, c.prefix?.trim() || `Claude #${i + 1}`, 'claude', `claude:${i}`));
    codexConfigs.forEach((c, i) =>
      addConfigRow(c.apiKey, c.prefix, c.prefix?.trim() || `Codex #${i + 1}`, 'codex', `codex:${i}`));
    vertexConfigs.forEach((c, i) =>
      addConfigRow(c.apiKey, c.prefix, c.prefix?.trim() || `Vertex #${i + 1}`, 'vertex', `vertex:${i}`));
    // OpenAI compatibility providers — one row per provider, merged across all apiKey entries (prefix counted once).
    openaiProviders.forEach((provider, providerIndex) => {
      const prefix = provider.prefix;
      const displayName = prefix?.trim() || provider.name || `OpenAI #${providerIndex + 1}`;

      const candidates = new Set<string>();
      buildCandidateUsageSourceIds({ prefix }).forEach((id) => candidates.add(id));
      (provider.apiKeyEntries || []).forEach((entry) => {
        buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => candidates.add(id));
      });

      let success = 0;
      let failure = 0;
      candidates.forEach((id) => {
        const bucket = bySource[id];
        if (bucket) {
          success += bucket.success;
          failure += bucket.failure;
          consumedSourceIds.add(id);
        }
      });

      const total = success + failure;
      if (total > 0) {
        result.push({
          key: `openai:${providerIndex}`,
          displayName,
          type: 'openai',
          success,
          failure,
          total,
          successRate: (success / total) * 100,
        });
      }
    });

    // Build source → auth file name mapping for remaining unmatched entries.
    // Also collect fallback stats for details without source but with auth_index.
    const sourceToAuthFile = new Map<string, CredentialInfo>();
    details.forEach((d) => {
      const authIdx = normalizeAuthIndexValue(d.auth_index);
      if (!d.source) {
        if (!authIdx) return;
        const fallback = fallbackByAuthIndex.get(authIdx) ?? { success: 0, failure: 0 };
        if (d.failed === true) {
          fallback.failure += 1;
        } else {
          fallback.success += 1;
        }
        fallbackByAuthIndex.set(authIdx, fallback);
        return;
      }

      if (!authIdx || consumedSourceIds.has(d.source)) return;
      if (!sourceToAuthIndex.has(d.source)) {
        sourceToAuthIndex.set(d.source, authIdx);
      }
      if (!sourceToAuthFile.has(d.source)) {
        const mapped = authFileMap.get(authIdx);
        if (mapped) sourceToAuthFile.set(d.source, mapped);
      }
    });

    // Remaining unmatched bySource entries — resolve name from auth files if possible
    Object.entries(bySource).forEach(([key, bucket]) => {
      if (consumedSourceIds.has(key)) return;
      const total = bucket.success + bucket.failure;
      const authFile = sourceToAuthFile.get(key);
      const row = {
        key,
        displayName: authFile?.name || (key.startsWith('t:') ? key.slice(2) : key),
        type: authFile?.type || '',
        success: bucket.success,
        failure: bucket.failure,
        total,
        successRate: total > 0 ? (bucket.success / total) * 100 : 100,
      };
      const rowIndex = result.push(row) - 1;
      const authIdx = sourceToAuthIndex.get(key);
      if (authIdx && !authIndexToRowIndex.has(authIdx)) {
        authIndexToRowIndex.set(authIdx, rowIndex);
      }
    });

    // Include requests that have auth_index but missing source.
    fallbackByAuthIndex.forEach((bucket, authIdx) => {
      if (bucket.success + bucket.failure === 0) return;

      const mapped = authFileMap.get(authIdx);
      let targetRowIndex = authIndexToRowIndex.get(authIdx);
      if (targetRowIndex === undefined && mapped) {
        const matchedIndex = result.findIndex(
          (row) => row.displayName === mapped.name && row.type === mapped.type
        );
        if (matchedIndex >= 0) {
          targetRowIndex = matchedIndex;
          authIndexToRowIndex.set(authIdx, matchedIndex);
        }
      }

      if (targetRowIndex !== undefined) {
        mergeBucketToRow(targetRowIndex, bucket);
        return;
      }

      const total = bucket.success + bucket.failure;
      const rowIndex = result.push({
        key: `auth:${authIdx}`,
        displayName: mapped?.name || authIdx,
        type: mapped?.type || '',
        success: bucket.success,
        failure: bucket.failure,
        total,
        successRate: (bucket.success / total) * 100
      }) - 1;
      authIndexToRowIndex.set(authIdx, rowIndex);
    });

    return result.sort((a, b) => b.total - a.total);
  }, [usage, geminiKeys, claudeConfigs, codexConfigs, vertexConfigs, openaiProviders, authFileMap]);

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
