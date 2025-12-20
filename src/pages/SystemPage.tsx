import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { IconGithub, IconBookOpen, IconExternalLink, IconCode, IconRefreshCw, IconCircleArrowUp } from '@/components/ui/icons';
import { useAuthStore, useConfigStore, useNotificationStore, useModelsStore } from '@/stores';
import { apiKeysApi } from '@/services/api/apiKeys';
import { versionApi } from '@/services/api';
import { classifyModels } from '@/utils/models';

const parseVersionSegments = (version?: string | null) => {
  if (!version) return null;
  const cleaned = version.trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
  return parts.length ? parts : null;
};

const compareVersions = (latest?: string | null, current?: string | null) => {
  const latestParts = parseVersionSegments(latest);
  const currentParts = parseVersionSegments(current);
  if (!latestParts || !currentParts) return null;
  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return 1;
    if (l < c) return -1;
  }
  return 0;
};

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const { showNotification } = useNotificationStore();
  const auth = useAuthStore();
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [modelStatus, setModelStatus] = useState<{ type: 'success' | 'warning' | 'error' | 'muted'; message: string }>();
  const [checkingVersion, setCheckingVersion] = useState(false);

  const apiKeysCache = useRef<string[]>([]);

  const handleVersionCheck = async () => {
    setCheckingVersion(true);
    try {
      const data = await versionApi.checkLatest();
      const latest = data?.['latest-version'] ?? data?.latest_version ?? data?.latest ?? '';
      const comparison = compareVersions(latest, auth.serverVersion);
      if (!latest) {
        showNotification(t('system_info.version_check_error'), 'error');
        return;
      }
      if (comparison === null) {
        showNotification(t('system_info.version_current_missing'), 'warning');
        return;
      }
      if (comparison > 0) {
        showNotification(t('system_info.version_update_available', { version: latest }), 'warning');
      } else {
        showNotification(t('system_info.version_is_latest'), 'success');
      }
    } catch (error: any) {
      showNotification(`${t('system_info.version_check_error')}: ${error?.message || ''}`, 'error');
    } finally {
      setCheckingVersion(false);
    }
  };

  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '其他' : 'Other'),
    [i18n.language]
  );
  const groupedModels = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);

  const normalizeApiKeyList = (input: any): string[] => {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const keys: string[] = [];

    input.forEach((item) => {
      const value = typeof item === 'string' ? item : item?.['api-key'] ?? item?.apiKey ?? '';
      const trimmed = String(value || '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      keys.push(trimmed);
    });

    return keys;
  };

  const resolveApiKeysForModels = useCallback(async () => {
    if (apiKeysCache.current.length) {
      return apiKeysCache.current;
    }

    const configKeys = normalizeApiKeyList(config?.apiKeys);
    if (configKeys.length) {
      apiKeysCache.current = configKeys;
      return configKeys;
    }

    try {
      const list = await apiKeysApi.list();
      const normalized = normalizeApiKeyList(list);
      if (normalized.length) {
        apiKeysCache.current = normalized;
      }
      return normalized;
    } catch (err) {
      console.warn('Auto loading API keys for models failed:', err);
      return [];
    }
  }, [config?.apiKeys]);

  const fetchModels = async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
    if (auth.connectionStatus !== 'connected') {
      setModelStatus({
        type: 'warning',
        message: t('notification.connection_required')
      });
      return;
    }

    if (!auth.apiBase) {
      showNotification(t('notification.connection_required'), 'warning');
      return;
    }

    if (forceRefresh) {
      apiKeysCache.current = [];
    }

    setModelStatus({ type: 'muted', message: t('system_info.models_loading') });
    try {
      const apiKeys = await resolveApiKeysForModels();
      const primaryKey = apiKeys[0];
      const list = await fetchModelsFromStore(auth.apiBase, primaryKey, forceRefresh);
      const hasModels = list.length > 0;
      setModelStatus({
        type: hasModels ? 'success' : 'warning',
        message: hasModels ? t('system_info.models_count', { count: list.length }) : t('system_info.models_empty')
      });
    } catch (err: any) {
      const message = `${t('system_info.models_error')}: ${err?.message || ''}`;
      setModelStatus({ type: 'error', message });
    }
  };

  useEffect(() => {
    fetchConfig().catch(() => {
      // ignore
    });
  }, [fetchConfig]);

  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.connectionStatus, auth.apiBase]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-1">
        <Button variant="secondary" size="sm" onClick={() => fetchConfig(undefined, true)} title={t('common.refresh')}>
          <IconRefreshCw size={16} />
        </Button>
      </div>
      <div className="space-y-4">
      <Card title={t('system_info.connection_status_title')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-muted/30 p-3 rounded">
            <div className="text-xs text-muted-foreground mb-1">{t('connection.server_address')}</div>
            <div className="text-sm font-medium truncate">{auth.apiBase || '-'}</div>
          </div>
          <div className="bg-muted/30 p-3 rounded">
            <div className="text-xs text-muted-foreground mb-1">{t('footer.api_version')}</div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{auth.serverVersion || t('system_info.version_unknown')}</span>
              <Button variant="secondary" size="sm" onClick={handleVersionCheck} loading={checkingVersion} title={t('system_info.version_check_button')}>
                <IconCircleArrowUp size={14} />
              </Button>
            </div>
          </div>
          <div className="bg-muted/30 p-3 rounded">
            <div className="text-xs text-muted-foreground mb-1">{t('footer.build_date')}</div>
            <div className="text-sm font-medium">
              {auth.serverBuildDate ? new Date(auth.serverBuildDate).toLocaleString() : t('system_info.version_unknown')}
            </div>
          </div>
          <div className="bg-muted/30 p-3 rounded">
            <div className="text-xs text-muted-foreground mb-1">{t('connection.status')}</div>
            <div className="text-sm font-medium">{t(`common.${auth.connectionStatus}_status` as any)}</div>
          </div>
        </div>
      </Card>

      <Card title={t('system_info.quick_links_title')}>
        <p className="text-sm text-muted-foreground mb-4">{t('system_info.quick_links_desc')}</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <a
            href="https://github.com/router-for-me/CLIProxyAPI"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 p-3 border border-border rounded hover:bg-muted/50 transition-colors"
          >
            <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-muted-foreground shrink-0">
              <IconGithub size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium flex items-center gap-1">
                {t('system_info.link_main_repo')}
                <IconExternalLink size={14} />
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{t('system_info.link_main_repo_desc')}</div>
            </div>
          </a>

          <a
            href="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 p-3 border border-border rounded hover:bg-muted/50 transition-colors"
          >
            <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-muted-foreground shrink-0">
              <IconCode size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium flex items-center gap-1">
                {t('system_info.link_webui_repo')}
                <IconExternalLink size={14} />
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{t('system_info.link_webui_repo_desc')}</div>
            </div>
          </a>

          <a
            href="https://help.router-for.me/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 p-3 border border-border rounded hover:bg-muted/50 transition-colors"
          >
            <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-muted-foreground shrink-0">
              <IconBookOpen size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium flex items-center gap-1">
                {t('system_info.link_docs')}
                <IconExternalLink size={14} />
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{t('system_info.link_docs_desc')}</div>
            </div>
          </a>
        </div>
      </Card>

      <Card
        title={t('system_info.models_title')}
        extra={
          <Button variant="secondary" size="sm" onClick={() => fetchModels({ forceRefresh: true })} loading={modelsLoading} title={t('common.refresh')}>
            <IconRefreshCw size={16} />
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground mb-3">{t('system_info.models_desc')}</p>
        {modelStatus && <div className={`text-xs px-2 py-1 rounded mb-3 ${modelStatus.type === 'success' ? 'bg-green-500/20 text-green-600' : modelStatus.type === 'error' ? 'bg-red-500/20 text-red-600' : modelStatus.type === 'warning' ? 'bg-amber-500/20 text-amber-600' : 'bg-muted text-muted-foreground'}`}>{modelStatus.message}</div>}
        {modelsError && <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded mb-3">{modelsError}</div>}
        {modelsLoading ? (
          <div className="text-sm text-muted-foreground py-4 text-center">{t('common.loading')}</div>
        ) : models.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">{t('system_info.models_empty')}</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {groupedModels.map((group) => (
              <div key={group.id} className="bg-muted/30 p-3 rounded">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium">{group.label}</span>
                  <span className="text-[10px] text-muted-foreground">{group.items.length}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {group.items.slice(0, 8).map((model) => (
                    <span
                      key={`${model.name}-${model.alias ?? 'default'}`}
                      className="px-1.5 py-0.5 bg-background border border-border text-[10px] truncate max-w-[120px] cursor-default"
                      title={model.alias ? `${model.name} (${model.alias})` : model.name}
                    >
                      {model.name}
                    </span>
                  ))}
                  {group.items.length > 8 && (
                    <span className="px-1.5 py-0.5 text-[10px] text-muted-foreground">+{group.items.length - 8}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      </div>
    </div>
  );
}
