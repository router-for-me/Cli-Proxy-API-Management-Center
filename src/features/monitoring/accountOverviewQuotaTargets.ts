import type { AuthFileItem } from '@/types';
import {
  isAntigravityFile,
  isClaudeFile,
  isCodexFile,
  isDisabledAuthFile,
  isGeminiCliFile,
  isKimiFile,
  isRuntimeOnlyAuthFile,
  isXaiFile,
  normalizeAuthIndex,
  resolveCodexChatgptAccountId,
  resolveCodexPlanType,
} from '@/utils/quota';
import type { QuotaType } from '@/components/quota';
import type { MonitoringAccountAuthState } from './accountOverviewState';
import type { MonitoringAccountRow } from './hooks/useMonitoringData';

export type MonitoringAccountQuotaTarget = {
  key: string;
  provider: QuotaType;
  authIndex: string;
  authLabel: string;
  fileName: string;
  accountId: string | null;
  planType: string | null;
};

const readAuthFileQuotaLabel = (file: AuthFileItem, authIndex: string) => {
  const candidates = [file.label, file.name, file.email, file.account, authIndex];
  for (const candidate of candidates) {
    const text =
      typeof candidate === 'string'
        ? candidate.trim()
        : candidate === null || candidate === undefined
          ? ''
          : String(candidate).trim();
    if (text) return text;
  }
  return authIndex;
};

const resolveQuotaProvider = (file: AuthFileItem): QuotaType | null => {
  if (isCodexFile(file)) return 'codex';
  if (isClaudeFile(file)) return 'claude';
  if (isAntigravityFile(file)) return 'antigravity';
  if (isGeminiCliFile(file)) return 'gemini-cli';
  if (isKimiFile(file)) return 'kimi';
  if (isXaiFile(file)) return 'xai';
  return null;
};

const isProviderTargetable = (file: AuthFileItem, provider: QuotaType) => {
  if (isDisabledAuthFile(file)) return false;
  if (provider === 'gemini-cli' && isRuntimeOnlyAuthFile(file)) return false;
  return true;
};

/**
 * Derive the set of quota providers this account actually exercised by
 * walking the row's request-path auth indices and resolving each matching
 * file's provider. Accounts that share an email across providers (e.g.
 * antigravity + codex) should only surface quotas for the providers the
 * account actually used in monitored traffic.
 */
const resolveActiveProvidersForRow = (
  row: MonitoringAccountRow,
  authState: MonitoringAccountAuthState | undefined
): Set<QuotaType> => {
  const active = new Set<QuotaType>();
  if (!authState) return active;

  const rowAuthIndices = new Set(
    row.authIndices
      .map((value) => normalizeAuthIndex(value))
      .filter((value): value is string => Boolean(value))
  );
  if (rowAuthIndices.size === 0) return active;

  authState.files.forEach((file) => {
    const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
    if (!authIndex || !rowAuthIndices.has(authIndex)) return;

    const provider = resolveQuotaProvider(file);
    if (provider) active.add(provider);
  });

  return active;
};

export const buildMonitoringAccountQuotaTargetsByAccount = (
  rows: MonitoringAccountRow[],
  authStateByRowId: Map<string, MonitoringAccountAuthState>
) =>
  new Map(
    rows.map((row) => {
      const bucket = new Map<string, MonitoringAccountQuotaTarget>();
      const authState = authStateByRowId.get(row.id);
      const activeProviders = resolveActiveProvidersForRow(row, authState);

      if (activeProviders.size > 0) {
        authState?.files.forEach((file) => {
          const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
          if (!authIndex) return;

          const provider = resolveQuotaProvider(file);
          if (!provider || !activeProviders.has(provider)) return;
          if (!isProviderTargetable(file, provider)) return;

          const dedupeKey = `${authIndex}::${file.name}`;
          if (bucket.has(dedupeKey)) return;

          bucket.set(dedupeKey, {
            key: dedupeKey,
            provider,
            authIndex,
            authLabel: readAuthFileQuotaLabel(file, authIndex),
            fileName: file.name,
            accountId: provider === 'codex' ? resolveCodexChatgptAccountId(file) : null,
            planType: provider === 'codex' ? resolveCodexPlanType(file) : null,
          });
        });
      }

      return [
        row.account,
        Array.from(bucket.values()).sort((left, right) =>
          left.authLabel.localeCompare(right.authLabel)
        ),
      ] as const;
    })
  );
