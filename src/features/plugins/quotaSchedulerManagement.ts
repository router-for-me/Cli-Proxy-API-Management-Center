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

export interface QuotaSchedulerStatus {
  enabled: boolean | null;
  generationActive: boolean | null;
  generationManaged: boolean | null;
  serialActive: boolean;
  schedulerMode: string;
  runtimeGeneration: number | null;
  warmupCandidates: number | null;
  warmupEnabled: boolean | null;
  warmupExecutionMode: string;
  warmups: number | null;
  freshSnapshots: number | null;
  activeBans: number | null;
  total429s: number | null;
  lastRefresh: string;
}

export const normalizeQuotaSchedulerStatus = (
  quotaValue: unknown,
  bansValue: unknown
): QuotaSchedulerStatus => {
  const quota = isRecord(quotaValue) ? quotaValue : {};
  const bans = isRecord(bansValue) ? bansValue : {};

  return {
    enabled: readBoolean(quota.enabled),
    generationActive: readBoolean(quota.generation_active),
    generationManaged: readBoolean(quota.generation_managed),
    serialActive: readString(quota.serial_active_auth_id) !== '',
    schedulerMode: readString(quota.scheduler_mode),
    runtimeGeneration: readNumber(quota.runtime_generation),
    warmupCandidates: readNumber(quota.warmup_candidates),
    warmupEnabled: readBoolean(quota.warmup_enabled),
    warmupExecutionMode: readString(quota.warmup_execution_mode),
    warmups: readCount(quota.warmups),
    freshSnapshots: readNumber(quota.fresh_snapshots),
    activeBans: readNumber(bans.count) ?? (Array.isArray(bans.bans) ? bans.bans.length : null),
    total429s: readNumber(bans.total_429s),
    lastRefresh: readString(quota.last_refresh),
  };
};
