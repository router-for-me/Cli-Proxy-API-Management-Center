import type { TFunction } from 'i18next';
import { CODEX_CONFIG } from '@/components/quota/quotaConfigs';
import { useQuotaStore } from '@/stores';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { collectUsageDetails, extractTotalTokens, normalizeAuthIndex } from '@/utils/usage';

export const CODEX_QUOTA_AUTO_REFRESH_INTERVAL_SECONDS = 10;

export interface CodexUsageStats {
  requests: number;
  success: number;
  failed: number;
  tokens: number;
}

const codexQuotaRefreshInFlight = new Map<string, Promise<void>>();

const getQuotaScopeKey = () => {
  const { apiBase = '', managementKey = '' } = useAuthStore.getState();
  return `${apiBase}::${managementKey}`;
};

export const getCodexAuthIndex = (file?: Partial<AuthFileItem> | null) =>
  normalizeAuthIndex(file?.['auth_index'] ?? file?.authIndex);

export const isCodexAuthFile = (file?: AuthFileItem | null) =>
  Boolean(file && CODEX_CONFIG.filterFn(file));

export async function refreshCodexQuotaFiles(
  files: AuthFileItem[],
  t: TFunction,
  options: { silent?: boolean } = {}
) {
  const setCodexQuota = useQuotaStore.getState().setCodexQuota;
  const scopeKey = getQuotaScopeKey();
  const codexFiles = Array.from(
    new Map(
      (Array.isArray(files) ? files : [])
        .filter((file) => isCodexAuthFile(file))
        .map((file) => [file.name || getCodexAuthIndex(file) || '', file])
    ).values()
  ).filter((file) => file && (file.name || getCodexAuthIndex(file)));

  await Promise.all(
    codexFiles.map(async (file) => {
      const fileKey = file.name || getCodexAuthIndex(file);
      if (!fileKey) {
        return;
      }

      const scopedFileKey = `${scopeKey}::${fileKey}`;
      const existingTask = codexQuotaRefreshInFlight.get(scopedFileKey);
      if (existingTask) {
        await existingTask;
        return;
      }

      const task = (async () => {
        try {
          const payload = await CODEX_CONFIG.fetchQuota(file, t);
          if (getQuotaScopeKey() !== scopeKey) {
            return;
          }
          setCodexQuota((current) => ({
            ...current,
            [fileKey]: CODEX_CONFIG.buildSuccessState(payload),
          }));
        } catch (error: unknown) {
          if (getQuotaScopeKey() !== scopeKey) {
            return;
          }
          if (options.silent) {
            return;
          }

          const message =
            error instanceof Error ? error.message : String(error ?? t('common.unknown_error'));
          setCodexQuota((current) => ({
            ...current,
            [fileKey]: CODEX_CONFIG.buildErrorState(message, getStatusFromError(error)),
          }));
        } finally {
          codexQuotaRefreshInFlight.delete(scopedFileKey);
        }
      })();

      codexQuotaRefreshInFlight.set(scopedFileKey, task);
      await task;
    })
  );
}

export function buildCodexUsageByAuthIndex(usage: unknown): Map<string, CodexUsageStats> {
  const usageMap = new Map<string, CodexUsageStats>();

  collectUsageDetails(usage).forEach((detail) => {
    const authIndex = normalizeAuthIndex(detail.auth_index);
    if (!authIndex) {
      return;
    }

    const bucket = usageMap.get(authIndex) ?? {
      requests: 0,
      success: 0,
      failed: 0,
      tokens: 0,
    };

    bucket.requests += 1;
    bucket.tokens += Math.max(Number(detail.tokens?.total_tokens) || 0, extractTotalTokens(detail));
    if (detail.failed) {
      bucket.failed += 1;
    } else {
      bucket.success += 1;
    }

    usageMap.set(authIndex, bucket);
  });

  return usageMap;
}
