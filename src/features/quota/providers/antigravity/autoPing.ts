import { apiCallApi } from '@/services/api';
import { ANTIGRAVITY_REQUEST_HEADERS } from '@/utils/quota';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { AntigravityQuotaBucket } from '@/types';

/** Cooldown period per bucket to prevent redundant probes (4.5 hours) */
export const AUTO_PING_COOLDOWN_MS = 4.5 * 3600 * 1000;

/** Five-hour window in milliseconds */
const FIVE_HOURS_MS = 5 * 3600 * 1000;

/** Margin buffer to detect unstarted countdown (60 seconds) */
const IDLE_DELTA_MARGIN_MS = 60 * 1000;

/** Timestamp map recording the last successful ping per bucket key `${authIndex}:${bucket.id}` */
export const lastPingAtMap = new Map<string, number>();

/** Candidate model lists for each model group */
const CANDIDATE_MODELS = {
  gemini: ['gemini-3.1-pro-low', 'gemini-2.5-flash', 'gemini-3.5-flash'],
  claude_gpt: ['claude-sonnet-4-6', 'gpt-oss-120b-medium', 'claude-opus-4-6-thinking'],
} as const;

export async function pingAntigravityBucket(
  authIndex: string,
  projectId: string,
  groupType: 'gemini' | 'claude_gpt'
): Promise<boolean> {
  const models = CANDIDATE_MODELS[groupType];

  for (const model of models) {
    try {
      const result = await apiCallApi.request({
        authIndex,
        method: 'POST',
        url: 'https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent',
        header: { ...ANTIGRAVITY_REQUEST_HEADERS },
        data: JSON.stringify({
          project: projectId || 'aicode-consumers',
          model,
          request: {
            contents: [
              {
                role: 'user',
                parts: [{ text: groupType === 'gemini' ? 'Hello' : 'ping' }],
              },
            ],
            generationConfig: {
              maxOutputTokens: groupType === 'gemini' ? 2 : 1,
            },
          },
        }),
      });

      if (result.statusCode === 200) {
        return true;
      }
    } catch {
      // Continue to next candidate model on error
    }
  }

  return false;
}

export function isFiveHourBucket(bucket: AntigravityQuotaBucket): boolean {
  if (bucket.periodHours === 5) return true;
  const windowLower = (bucket.window ?? '').trim().toLowerCase();
  if (windowLower === '5h' || windowLower === 'five-hour' || windowLower === 'five_hour') {
    return true;
  }
  return bucket.id.toLowerCase().includes('5h');
}

export function isFiveHourBucketIdle(bucket: AntigravityQuotaBucket, nowMs: number): boolean {
  if (!isFiveHourBucket(bucket)) return false;
  if (typeof bucket.remainingFraction === 'number' && bucket.remainingFraction < 0.99999) {
    return false;
  }
  if (bucket.description && /used some of your 5-hour limit/i.test(bucket.description)) {
    return false;
  }
  if (bucket.resetTime) {
    const resetMs = new Date(bucket.resetTime).getTime();
    if (!Number.isNaN(resetMs)) {
      const deltaMs = resetMs - nowMs;
      // If deltaMs is between 0 and (5h - 1min), the countdown has actively begun
      if (deltaMs > 0 && deltaMs <= FIVE_HOURS_MS - IDLE_DELTA_MARGIN_MS) {
        return false;
      }
    }
  }
  return true;
}

export function triggerAutoPingIfIdle(
  authIndex: string,
  projectId: string,
  groupLabel: string,
  bucket: AntigravityQuotaBucket,
  nowMs: number
): void {
  if (!isFiveHourBucketIdle(bucket, nowMs)) return;

  const groupLower = groupLabel.toLowerCase();
  let groupType: 'gemini' | 'claude_gpt' | null = null;
  if (groupLower.includes('gemini')) {
    groupType = 'gemini';
  } else if (
    groupLower.includes('claude') ||
    groupLower.includes('gpt') ||
    groupLower.includes('3p')
  ) {
    groupType = 'claude_gpt';
  }

  if (!groupType) return;

  const key = `${authIndex}:${bucket.id}`;
  const lastPingAt = lastPingAtMap.get(key);
  if (lastPingAt !== undefined && nowMs - lastPingAt < AUTO_PING_COOLDOWN_MS) {
    return;
  }

  void pingAntigravityBucket(authIndex, projectId, groupType).then((success) => {
    if (success) {
      const pingTime = Date.now();
      lastPingAtMap.set(key, pingTime);

      const resetInstantMs = pingTime + FIVE_HOURS_MS;
      const resetTimeIso = new Date(resetInstantMs).toISOString();

      // Synchronize through Zustand store so all React components re-render with the new countdown
      useQuotaStore.getState().setAntigravityQuota((prev) => {
        const current = prev[authIndex];
        if (!current || !Array.isArray(current.groups)) return prev;

        const updatedGroups = current.groups.map((group) => ({
          ...group,
          buckets: group.buckets.map((b) => {
            if (b.id !== bucket.id) return b;
            return {
              ...b,
              remainingFraction: 0.99999,
              resetTime: resetTimeIso,
              resetAtMs: resetInstantMs,
              description:
                'You have used some of your 5-hour limit, it will fully refresh in 4 hours, 59 minutes.',
            };
          }),
        }));

        return {
          ...prev,
          [authIndex]: {
            ...current,
            groups: updatedGroups,
          },
        };
      });
    }
  });
}
