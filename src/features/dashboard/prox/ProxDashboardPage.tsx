/**
 * Dashboard (fork): connection line, request totals over the recent window,
 * traffic by provider and outcome, and the accounts behind it.
 * Replaces the upstream dashboard route; see FORK.md.
 */

import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForecastPrefs } from '@/features/quota/forecast/prefs';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { useAuthStore, useThemeStore } from '@/stores';
import { formatPercent } from '@/utils/format';
import { AccountsCard } from './AccountsCard';
import { buildAccountRows } from './model';
import { TrafficChart } from './TrafficChart';
import { useProxDashboard } from './useProxDashboard';
import styles from './ProxDashboard.module.scss';

const DASH = '—';

/** Validated categorical steps per theme (see the dataviz checks in FORK.md). */
const PROVIDER_COLORS: Record<string, { dark: string; light: string }> = {
  claude: { dark: '#d4734d', light: '#c2603d' },
  codex: { dark: '#5b88d6', light: '#3f68b5' },
};
const OTHER_COLOR = { dark: '#8f8f8f', light: '#5c5c5c' };

/** "host:port" of the API base, with the scheme's default port spelled out. */
const endpointOf = (apiBase: string): string => {
  try {
    const url = new URL(apiBase);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return `${url.hostname}:${port}`;
  } catch {
    return apiBase;
  }
};

export function ProxDashboardPage() {
  const { t } = useTranslation();
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const apiBase = useAuthStore((state) => state.apiBase);
  const theme = useThemeStore((state) => state.resolvedTheme);
  const [prefs, updatePrefs] = useForecastPrefs();
  const now = useNow();
  const { connectionStatus, connected, routingStrategy, files, history, traffic, refresh } =
    useProxDashboard();

  useHeaderRefresh(refresh, connected);

  const colorOf = useCallback(
    (provider: string) => {
      const palette = PROVIDER_COLORS[provider] ?? OTHER_COLOR;
      return theme === 'dark' ? palette.dark : palette.light;
    },
    [theme]
  );

  const rows = useMemo(
    () => (files ? buildAccountRows(files, history, routingStrategy, now) : null),
    [files, history, routingStrategy, now]
  );

  const version = serverVersion ? `v${serverVersion.trim().replace(/^[vV]+/, '')}` : null;
  const connectionLabel = t(
    connectionStatus === 'connected'
      ? 'common.connected'
      : connectionStatus === 'connecting'
        ? 'common.connecting'
        : 'common.disconnected'
  );

  const stats = [
    { key: 'total', label: t('prox.requests_handled'), value: traffic.total },
    { key: 'success', label: t('prox.succeeded'), value: traffic.success, swatch: 'success' },
    { key: 'failed', label: t('prox.failed'), value: traffic.failed, swatch: 'failure' },
  ] as const;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h1 className={styles.title}>{t('nav.dashboard')}</h1>
          <p className={styles.meta}>
            {version && <span>{version}</span>}
            {apiBase && <span>{endpointOf(apiBase)}</span>}
            <span className={styles.connection} data-status={connectionStatus}>
              <i aria-hidden="true" />
              {connectionLabel}
            </span>
          </p>
        </div>
        <div className={styles.actions}>
          <Link to="/logs" className={styles.secondaryAction}>
            {t('dashboard.cta_inspect_logs')}
          </Link>
          <Link to="/quota" className={styles.primaryAction}>
            {t('prox.view_quota')}
          </Link>
        </div>
      </header>

      <section className={styles.card} aria-label={t('prox.requests_handled')}>
        <dl className={styles.stats}>
          {stats.map((stat) => (
            <div key={stat.key} className={styles.stat}>
              <dt>
                {'swatch' in stat && (
                  <i
                    className={
                      stat.swatch === 'success' ? styles.swatchSuccess : styles.swatchFailure
                    }
                    aria-hidden="true"
                  />
                )}
                {stat.label}
              </dt>
              <dd>{connected ? stat.value.toLocaleString() : DASH}</dd>
            </div>
          ))}
          <div className={`${styles.stat} ${styles.statRate}`}>
            <dt>{t('dashboard.success_rate')}</dt>
            <dd>
              {connected && traffic.successRate !== null
                ? formatPercent(traffic.successRate)
                : DASH}
            </dd>
          </div>
        </dl>
        <TrafficChart traffic={traffic} colorOf={colorOf} />
      </section>

      <AccountsCard
        rows={rows}
        totalRequests={traffic.total}
        routingStrategy={routingStrategy}
        showEmails={prefs.showEmails}
        onToggleEmails={() => updatePrefs({ showEmails: !prefs.showEmails })}
        colorOf={colorOf}
        theme={theme}
        now={now}
      />
    </div>
  );
}
