/**
 * Quota history recorded by the backend collector (`GET /quota/history`).
 *
 * The backend samples Claude/Codex usage windows in the background, so the
 * forecast charts have history even for periods when no dashboard was open.
 * Raw snake_case fields are normalized here; UI code only sees the camelCase shape.
 */

import { isRecord } from '@/utils/helpers';
import { apiClient } from './client';

const QUOTA_HISTORY_TIMEOUT_MS = 20 * 1000;

export type QuotaHistoryPoint = {
  /** Sample instant, epoch ms. */
  t: number;
  /** Used share of the window, 0..100. */
  used: number;
  /** When the window resets, epoch ms, if the provider reported it. */
  resetAt: number | null;
};

export type QuotaHistoryWindow = {
  id: string;
  periodSeconds: number | null;
  points: QuotaHistoryPoint[];
};

export type QuotaHistoryAccount = {
  authId: string;
  authIndex: string;
  fileName: string;
  provider: string;
  label: string;
  email: string;
  plan: string;
  windows: QuotaHistoryWindow[];
};

export type QuotaHistory = {
  enabled: boolean;
  now: number | null;
  pollIntervalSeconds: number | null;
  accounts: QuotaHistoryAccount[];
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizePoint = (raw: unknown): QuotaHistoryPoint | null => {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const t = toFiniteNumber(raw[0]);
  const used = toFiniteNumber(raw[1]);
  if (t === null || used === null) return null;
  const resetAt = toFiniteNumber(raw[2]);
  return { t, used: Math.min(100, Math.max(0, used)), resetAt };
};

const normalizeWindow = (raw: unknown): QuotaHistoryWindow | null => {
  if (!isRecord(raw)) return null;
  const id = toText(raw.id);
  if (!id) return null;
  const points = (Array.isArray(raw.points) ? raw.points : [])
    .map(normalizePoint)
    .filter((point): point is QuotaHistoryPoint => point !== null)
    .sort((a, b) => a.t - b.t);
  return { id, periodSeconds: toFiniteNumber(raw.period_seconds), points };
};

const normalizeAccount = (raw: unknown): QuotaHistoryAccount | null => {
  if (!isRecord(raw)) return null;
  const provider = toText(raw.provider).toLowerCase();
  const authId = toText(raw.auth_id);
  if (!provider || !authId) return null;
  return {
    authId,
    authIndex: toText(raw.auth_index),
    fileName: toText(raw.file_name),
    provider,
    label: toText(raw.label),
    email: toText(raw.email),
    plan: toText(raw.plan).toLowerCase(),
    windows: (Array.isArray(raw.windows) ? raw.windows : [])
      .map(normalizeWindow)
      .filter((window): window is QuotaHistoryWindow => window !== null),
  };
};

export const normalizeQuotaHistory = (raw: unknown): QuotaHistory => {
  if (!isRecord(raw)) {
    return { enabled: false, now: null, pollIntervalSeconds: null, accounts: [] };
  }
  return {
    enabled: raw.enabled !== false,
    now: toFiniteNumber(raw.now),
    pollIntervalSeconds: toFiniteNumber(raw.poll_interval_seconds),
    accounts: (Array.isArray(raw.accounts) ? raw.accounts : [])
      .map(normalizeAccount)
      .filter((account): account is QuotaHistoryAccount => account !== null),
  };
};

export const quotaHistoryApi = {
  get: async (fromMs: number, toMs: number): Promise<QuotaHistory> => {
    const raw = await apiClient.get<unknown>('/quota/history', {
      params: { from: Math.floor(fromMs), to: Math.ceil(toMs) },
      timeout: QUOTA_HISTORY_TIMEOUT_MS,
    });
    return normalizeQuotaHistory(raw);
  },
};
