import { isRecord } from '@/utils/helpers';

const readNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const readBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
};

const readCount = (value: unknown): number | null => {
  const numeric = readNumber(value);
  if (numeric !== null) return numeric;
  if (Array.isArray(value)) return value.length;
  if (isRecord(value)) return Object.keys(value).length;
  return null;
};

const readRecords = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const readIdentifier = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const readAuthFiles = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return readRecords(value);
  if (!isRecord(value)) return [];
  return readRecords(value.files);
};

const cleanAuthFileName = (value: unknown): string => {
  const rawName = readString(value);
  if (!rawName) return '';
  const fileName = rawName.split(/[\\/]/).pop() || rawName;
  return fileName.replace(/\.(json|ya?ml|toml)$/i, '').trim();
};

const formatAccountType = (value: unknown): string => {
  const rawType = readString(value);
  if (!rawType) return '';
  return rawType
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

const resolveActiveAuthLabel = (
  activeAuthId: string,
  activeSnapshot: Record<string, unknown> | undefined,
  authFilesValue: unknown
): string => {
  const authIndex = activeSnapshot
    ? readIdentifier(activeSnapshot.auth_index) || readIdentifier(activeSnapshot.authIndex)
    : '';
  if (!authIndex) return activeAuthId;

  const authFile = readAuthFiles(authFilesValue).find((entry) => {
    const entryAuthIndex = readIdentifier(entry.auth_index) || readIdentifier(entry.authIndex);
    return entryAuthIndex !== '' && entryAuthIndex.toLowerCase() === authIndex.toLowerCase();
  });
  if (!authFile) return authIndex || activeAuthId;

  const label =
    readString(authFile.label) ||
    readString(authFile.email) ||
    readString(authFile.account) ||
    cleanAuthFileName(authFile.name) ||
    authIndex ||
    activeAuthId;
  const accountType = formatAccountType(authFile.account_type ?? authFile.accountType);
  return accountType ? `${label} · ${accountType}` : label;
};

const readWarmupTimestamp = (warmup: Record<string, unknown>): string =>
  readString(warmup.activated_at) ||
  readString(warmup.completed_at) ||
  readString(warmup.attempted_at);

const readTimestampEpoch = (value: string): number => {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : Number.NEGATIVE_INFINITY;
};

export interface QuotaSchedulerWarmupSummary {
  confirmed: number;
  pending: number;
  failed: number;
  blocked: number;
  attempted: number;
  latestState: string;
  latestAt: string;
  latestWindow: string;
}

export interface QuotaSchedulerStatus {
  enabled: boolean | null;
  generationActive: boolean | null;
  generationManaged: boolean | null;
  serialActive: boolean;
  activeAuthId: string;
  activeAuthLabel: string;
  serialSelectedAt: string;
  serialSwitches: number | null;
  serialLastSwitchAt: string;
  serialSwitchReason: string;
  serialSwitchPercent: number | null;
  schedulerMode: string;
  configGeneration: number | null;
  runtimeGeneration: number | null;
  warmupCandidates: number | null;
  warmupEnabled: boolean | null;
  warmupExecutionMode: string;
  warmups: number | null;
  warmupSummary: QuotaSchedulerWarmupSummary;
  freshSnapshots: number | null;
  snapshotCount: number;
  eligibleSnapshots: number;
  activeBans: number | null;
  total429s: number | null;
  lastRefresh: string;
  lastError: string;
}

export const normalizeQuotaSchedulerStatus = (
  quotaValue: unknown,
  bansValue: unknown,
  authFilesValue?: unknown
): QuotaSchedulerStatus => {
  const quota = isRecord(quotaValue) ? quotaValue : {};
  const bans = isRecord(bansValue) ? bansValue : {};
  const activeAuthId = readString(quota.serial_active_auth_id);
  const snapshots = readRecords(quota.snapshots);
  const activeSnapshot = snapshots.find(
    (snapshot) => readString(snapshot.auth_id) === activeAuthId
  );
  const warmups = readRecords(quota.warmups);
  const warmupSummary: QuotaSchedulerWarmupSummary = {
    confirmed: 0,
    pending: 0,
    failed: 0,
    blocked: 0,
    attempted: 0,
    latestState: '',
    latestAt: '',
    latestWindow: '',
  };

  for (const warmup of warmups) {
    const state = readString(warmup.state);
    if (state === 'confirmed') warmupSummary.confirmed += 1;
    else if (state === 'pending_confirmation') warmupSummary.pending += 1;
    else if (state === 'failed') warmupSummary.failed += 1;
    else if (state === 'blocked') warmupSummary.blocked += 1;
    else warmupSummary.attempted += 1;

    const timestamp = readWarmupTimestamp(warmup);
    if (
      timestamp &&
      (!warmupSummary.latestAt ||
        readTimestampEpoch(timestamp) > readTimestampEpoch(warmupSummary.latestAt))
    ) {
      warmupSummary.latestAt = timestamp;
      warmupSummary.latestState = state;
      warmupSummary.latestWindow = readString(warmup.window);
    }
  }

  return {
    enabled: readBoolean(quota.enabled),
    generationActive: readBoolean(quota.generation_active),
    generationManaged: readBoolean(quota.generation_managed),
    serialActive: activeAuthId !== '',
    activeAuthId,
    activeAuthLabel: resolveActiveAuthLabel(activeAuthId, activeSnapshot, authFilesValue),
    serialSelectedAt: readString(quota.serial_selected_at),
    serialSwitches: readNumber(quota.serial_switches),
    serialLastSwitchAt: readString(quota.serial_last_switch_at),
    serialSwitchReason: readString(quota.serial_last_switch_reason),
    serialSwitchPercent: readNumber(quota.serial_switch_percent),
    schedulerMode: readString(quota.scheduler_mode),
    configGeneration: readNumber(quota.config_generation),
    runtimeGeneration: readNumber(quota.runtime_generation),
    warmupCandidates: readNumber(quota.warmup_candidates),
    warmupEnabled: readBoolean(quota.warmup_enabled),
    warmupExecutionMode: readString(quota.warmup_execution_mode),
    warmups: readCount(quota.warmups),
    warmupSummary,
    freshSnapshots: readNumber(quota.fresh_snapshots),
    snapshotCount: snapshots.length,
    eligibleSnapshots: snapshots.filter((snapshot) => readBoolean(snapshot.eligible) === true)
      .length,
    activeBans: readNumber(bans.count) ?? (Array.isArray(bans.bans) ? bans.bans.length : null),
    total429s: readNumber(bans.total_429s),
    lastRefresh: readString(quota.last_refresh),
    lastError: readString(quota.last_error),
  };
};
