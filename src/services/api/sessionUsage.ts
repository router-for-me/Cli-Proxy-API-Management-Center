import { apiClient } from './client';
import type {
  CredentialSessionUsage,
  CredentialSessionUsagesResponse,
  CredentialSessionUsageItem,
  CredentialSessionSeatUsage,
  SessionRequestUsage,
} from '@/types';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readString = (record: Record<string, unknown>, ...keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const readNullableString = (record: Record<string, unknown>, ...keys: string[]): string | null => {
  const value = readString(record, ...keys);
  return value || null;
};

const readCount = (record: Record<string, unknown>, ...keys: string[]): number => {
  for (const key of keys) {
    const value = record[key];
    const parsed =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  return 0;
};

const readBoolean = (record: Record<string, unknown>, ...keys: string[]): boolean => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase())) return true;
      if (['false', '0', 'no', 'off'].includes(value.trim().toLowerCase())) return false;
    }
  }
  return false;
};

const normalizeRequest = (value: unknown): SessionRequestUsage | null => {
  const record = asRecord(value);
  if (!record) return null;
  return {
    leaseId: readString(record, 'lease_id', 'leaseId'),
    requestId: readString(record, 'request_id', 'requestId'),
    state: readString(record, 'state') || 'active',
    startedAt: readNullableString(record, 'started_at', 'startedAt'),
    lastHeartbeatAt: readNullableString(record, 'last_heartbeat_at', 'lastHeartbeatAt'),
    expiresAt: readNullableString(record, 'expires_at', 'expiresAt'),
  };
};

const normalizeSession = (value: unknown): CredentialSessionUsageItem | null => {
  const record = asRecord(value);
  if (!record) return null;
  const requests = Array.isArray(record.requests)
    ? record.requests
        .map(normalizeRequest)
        .filter((item): item is SessionRequestUsage => item !== null)
    : [];
  const parentHomeSessionId = readString(record, 'parent_home_session_id', 'parentHomeSessionId');
  return {
    protocol: readString(record, 'protocol') || 'unknown',
    sessionId: readString(record, 'session_id', 'sessionId'),
    homeSessionId: readString(record, 'home_session_id', 'homeSessionId'),
    seatId:
      readString(record, 'seat_id', 'seatId') ||
      readString(record, 'home_session_id', 'homeSessionId'),
    parentHomeSessionId,
    isSeat: readBoolean(record, 'is_seat', 'isSeat') || parentHomeSessionId === '',
    state: readString(record, 'state') || 'active',
    lastSeenAt: readNullableString(record, 'last_seen_at', 'lastSeenAt'),
    expiresAt: readNullableString(record, 'expires_at', 'expiresAt'),
    activeRequests: readCount(record, 'active_requests', 'activeRequests') || requests.length,
    requests,
  };
};

const normalizeSeat = (value: unknown): CredentialSessionSeatUsage | null => {
  const record = asRecord(value);
  if (!record) return null;
  const sessions = Array.isArray(record.sessions)
    ? record.sessions
        .map(normalizeSession)
        .filter((item): item is CredentialSessionUsageItem => item !== null)
    : [];
  const sessionHistory = Array.isArray(record.session_history)
    ? record.session_history
        .map(normalizeSession)
        .filter((item): item is CredentialSessionUsageItem => item !== null)
    : Array.isArray(record.sessionHistory)
      ? record.sessionHistory
          .map(normalizeSession)
          .filter((item): item is CredentialSessionUsageItem => item !== null)
      : [];
  return {
    seatId: readString(record, 'seat_id', 'seatId'),
    ordinal: readCount(record, 'ordinal'),
    // Available seats have no protocol until their first claim; keep that empty
    // instead of rendering a misleading "unknown" provider in the drawer.
    protocol: readString(record, 'protocol'),
    state: readString(record, 'state') || 'available',
    activeRequests: readCount(record, 'active_requests', 'activeRequests'),
    sessions,
    sessionHistory,
  };
};

const normalizeUsage = (value: unknown): CredentialSessionUsage | null => {
  const record = asRecord(value);
  if (!record) return null;
  const sessions = Array.isArray(record.sessions)
    ? record.sessions
        .map(normalizeSession)
        .filter((item): item is CredentialSessionUsageItem => item !== null)
    : [];
  const seats = Array.isArray(record.seats)
    ? record.seats
        .map(normalizeSeat)
        .filter((item): item is CredentialSessionSeatUsage => item !== null)
    : [];
  return {
    credentialId: readString(record, 'credential_id', 'credentialId'),
    maxSessions: readCount(record, 'seat_count', 'seatCount') || 10,
    maxRequestsPerSession: readCount(record, 'max_requests_per_seat', 'maxRequestsPerSeat'),
    maxRequestsPerSeat: readCount(record, 'max_requests_per_seat', 'maxRequestsPerSeat'),
    policyVersion: readCount(record, 'policy_version', 'policyVersion'),
    seatCount: readCount(record, 'seat_count', 'seatCount') || seats.length,
    claimedSeatCount: readCount(record, 'claimed_seat_count', 'claimedSeatCount'),
    availableSeatCount: readCount(record, 'available_seat_count', 'availableSeatCount'),
    retiringSeatCount: readCount(record, 'retiring_seat_count', 'retiringSeatCount'),
    frozenSeatCount: readCount(record, 'frozen_seat_count', 'frozenSeatCount'),
    remainingSessions: readCount(record, 'remaining_sessions', 'remainingSessions'),
    admittedSessions: readCount(record, 'admitted_sessions', 'admittedSessions'),
    observedSessions: readCount(record, 'observed_sessions', 'observedSessions') || sessions.length,
    activeRequestCount:
      readCount(record, 'active_request_count', 'activeRequestCount') ||
      sessions.reduce((sum, item) => sum + item.activeRequests, 0),
    coverageComplete: record.coverage_complete !== false && record.coverageComplete !== false,
    sessions,
    seats,
  };
};

export const normalizeCredentialSessionUsages = (
  payload: unknown
): CredentialSessionUsagesResponse => {
  const record = asRecord(payload);
  const rawItems = record && Array.isArray(record.items) ? record.items : [];
  return {
    observedAt: record ? readNullableString(record, 'observed_at', 'observedAt') : null,
    items: rawItems
      .map(normalizeUsage)
      .filter((item): item is CredentialSessionUsage => item !== null && item.credentialId !== ''),
  };
};

export const sessionUsageApi = {
  list: async (): Promise<CredentialSessionUsagesResponse> =>
    normalizeCredentialSessionUsages(await apiClient.get('/credentials/sessions')),
  patchPolicy: async (
    credentialId: string,
    patch: { maxSessions?: number; maxRequestsPerSession?: number },
    version: number
  ) =>
    apiClient.patch(`/credentials/${encodeURIComponent(credentialId)}/session-policy`, {
      version,
      ...(patch.maxSessions !== undefined ? { seat_count: patch.maxSessions } : {}),
      ...(patch.maxRequestsPerSession !== undefined
        ? { max_requests_per_seat: patch.maxRequestsPerSession }
        : {}),
    }),
};
