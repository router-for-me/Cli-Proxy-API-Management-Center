import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { computeKeyStats, formatCompactNumber } from '@/utils/usage';
import { authFilesApi } from '@/services/api/authFiles';
import { providersApi } from '@/services/api/providers';
import type { AuthFileItem } from '@/types/authFile';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

export interface CredentialStatsCardProps {
  usage: UsagePayload | null;
  loading: boolean;
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

/**
 * Replicate backend stableAuthIndex: SHA-256 of seed, first 8 bytes as hex (16 chars)
 */
async function computeAuthIndex(seed: string): Promise<string> {
  const trimmed = seed.trim();
  if (!trimmed) return '';
  const data = new TextEncoder().encode(trimmed);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function buildAuthFileMap(files: AuthFileItem[]): Map<string, CredentialInfo> {
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
  return map;
}

interface ProviderKeyInfo {
  apiKey: string;
  providerType: string;
  label: string;
}

async function buildProviderMap(): Promise<Map<string, CredentialInfo>> {
  const map = new Map<string, CredentialInfo>();
  const allKeys: ProviderKeyInfo[] = [];

  const results = await Promise.allSettled([
    providersApi.getGeminiKeys().then((keys) =>
      keys.forEach((k, i) =>
        allKeys.push({ apiKey: k.apiKey, providerType: 'gemini', label: k.prefix?.trim() || `Gemini #${i + 1}` })
      )
    ),
    providersApi.getClaudeConfigs().then((keys) =>
      keys.forEach((k, i) =>
        allKeys.push({ apiKey: k.apiKey, providerType: 'claude', label: k.prefix?.trim() || `Claude #${i + 1}` })
      )
    ),
    providersApi.getCodexConfigs().then((keys) =>
      keys.forEach((k, i) =>
        allKeys.push({ apiKey: k.apiKey, providerType: 'codex', label: k.prefix?.trim() || `Codex #${i + 1}` })
      )
    ),
    providersApi.getVertexConfigs().then((keys) =>
      keys.forEach((k, i) =>
        allKeys.push({ apiKey: k.apiKey, providerType: 'vertex', label: k.prefix?.trim() || `Vertex #${i + 1}` })
      )
    ),
    providersApi.getOpenAIProviders().then((providers) =>
      providers.forEach((p) =>
        p.apiKeyEntries?.forEach((entry, i) =>
          allKeys.push({
            apiKey: entry.apiKey,
            providerType: 'openai',
            label: p.prefix?.trim() || (p.apiKeyEntries.length > 1 ? `${p.name} #${i + 1}` : p.name),
          })
        )
      )
    ),
  ]);

  // Ignore individual failures
  void results;

  await Promise.all(
    allKeys.map(async ({ apiKey, providerType, label }) => {
      const key = apiKey?.trim();
      if (!key) return;
      const authIndex = await computeAuthIndex(`api_key:${key}`);
      if (authIndex) {
        map.set(authIndex, { name: label, type: providerType });
      }
    })
  );

  return map;
}

export function CredentialStatsCard({ usage, loading }: CredentialStatsCardProps) {
  const { t } = useTranslation();
  const [credentialMap, setCredentialMap] = useState<Map<string, CredentialInfo>>(new Map());

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      authFilesApi.list().then((res) => {
        const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files;
        return Array.isArray(files) ? buildAuthFileMap(files) : new Map<string, CredentialInfo>();
      }),
      buildProviderMap(),
    ]).then(([authResult, providerResult]) => {
      if (cancelled) return;
      // Provider map as base, auth-files override (more authoritative)
      const merged = new Map<string, CredentialInfo>();
      if (providerResult.status === 'fulfilled') {
        providerResult.value.forEach((v, k) => merged.set(k, v));
      }
      if (authResult.status === 'fulfilled') {
        authResult.value.forEach((v, k) => merged.set(k, v));
      }
      setCredentialMap(merged);
    });

    return () => { cancelled = true; };
  }, []);

  const rows = useMemo((): CredentialRow[] => {
    if (!usage) return [];
    const { byAuthIndex } = computeKeyStats(usage);
    return Object.entries(byAuthIndex)
      .map(([key, bucket]) => {
        const total = bucket.success + bucket.failure;
        const mapped = credentialMap.get(key);
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
  }, [usage, credentialMap]);

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
