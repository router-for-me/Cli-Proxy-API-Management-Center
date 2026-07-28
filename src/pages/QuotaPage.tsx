/**
 * Quota management page - coordinates the provider quota sections.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useQuotaStore, useThemeStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import {
  QuotaSection,
  QuotaSummaryTiles,
  QuotaDensityPicker,
  readStoredDensity,
  storeDensity,
  summarizeProvider,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
} from '@/components/quota';
import type { QuotaDensity, QuotaProviderKey } from '@/components/quota';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import styles from './QuotaPage.module.scss';

/**
 * Section order preserved from before. Each entry keeps its own QuotaSection
 * instance — the per-provider fetch loop, store slice and (destructive) pruning
 * effect are deliberately untouched; only *which* sections render is filtered.
 *
 * Declared at module scope so the config identities stay stable: they sit in
 * QuotaSection's memo/effect dependency lists, and fresh identities each render
 * would re-run the pruning effect.
 */
const PROVIDERS: { key: QuotaProviderKey; filterFn: (file: AuthFileItem) => boolean }[] = [
  { key: 'claude', filterFn: CLAUDE_CONFIG.filterFn },
  { key: 'antigravity', filterFn: ANTIGRAVITY_CONFIG.filterFn },
  { key: 'codex', filterFn: CODEX_CONFIG.filterFn },
  { key: 'xai', filterFn: XAI_CONFIG.filterFn },
  { key: 'kimi', filterFn: KIMI_CONFIG.filterFn },
];

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeProvider, setActiveProvider] = useState<QuotaProviderKey | 'all'>('all');
  const [density, setDensity] = useState<QuotaDensity>(() => readStoredDensity());

  const disableControls = connectionStatus !== 'connected';

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useHeaderRefresh(loadFiles);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleDensityChange = useCallback((value: QuotaDensity) => {
    setDensity(value);
    storeDensity(value);
  }, []);

  // Read-only view over the slices the sections already populate — no fetching,
  // no extra requests, no change to concurrency.
  const summaries = useMemo(() => {
    const slices: Record<QuotaProviderKey, Record<string, { status?: string }>> = {
      claude: claudeQuota,
      antigravity: antigravityQuota,
      codex: codexQuota,
      kimi: kimiQuota,
      xai: xaiQuota,
    };
    return PROVIDERS.map(({ key, filterFn }) =>
      summarizeProvider(
        key,
        files.filter((file) => filterFn(file)).map((file) => file.name),
        slices[key]
      )
    );
  }, [files, claudeQuota, antigravityQuota, codexQuota, kimiQuota, xaiQuota]);

  const labelFor = useCallback(
    (provider: QuotaProviderKey) => {
      const key = `auth_files.filter_${provider}`;
      const translated = t(key);
      if (translated !== key) return translated;
      return provider.charAt(0).toUpperCase() + provider.slice(1);
    },
    [t]
  );

  const shows = useCallback(
    (provider: QuotaProviderKey) => activeProvider === 'all' || activeProvider === provider,
    [activeProvider]
  );
  const sectionProps = { files, loading, disabled: disableControls };

  return (
    <div
      className={`${styles.container} ${styles.densityScope}`}
      style={{ '--quota-columns': density } as CSSProperties}
    >
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
        <p className={styles.description}>{t('quota_management.description')}</p>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <QuotaSummaryTiles
        summaries={summaries}
        activeProvider={activeProvider}
        onSelect={setActiveProvider}
        resolvedTheme={resolvedTheme}
        labelFor={labelFor}
      />

      <div className={styles.boardControls}>
        <span className={styles.stripSpacer} />
        <QuotaDensityPicker value={density} onChange={handleDensityChange} />
      </div>

      {shows('claude') && <QuotaSection config={CLAUDE_CONFIG} {...sectionProps} />}
      {shows('antigravity') && <QuotaSection config={ANTIGRAVITY_CONFIG} {...sectionProps} />}
      {shows('codex') && <QuotaSection config={CODEX_CONFIG} {...sectionProps} />}
      {shows('xai') && <QuotaSection config={XAI_CONFIG} {...sectionProps} />}
      {shows('kimi') && <QuotaSection config={KIMI_CONFIG} {...sectionProps} />}
    </div>
  );
}
