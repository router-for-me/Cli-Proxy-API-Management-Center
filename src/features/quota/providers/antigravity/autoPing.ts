import { apiCallApi } from '@/services/api';
import { ANTIGRAVITY_REQUEST_HEADERS } from '@/utils/quota';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { AntigravityQuotaBucket } from '@/types';

/** Cooldown period per bucket to prevent redundant probes (4.5 hours) */
export const AUTO_PING_COOLDOWN_MS = 4.5 * 3600 * 1000;

/** Five-hour window in milliseconds */
const FIVE_HOURS_MS = 5 * 3600 * 1000;

/** Timestamp map recording the last successful ping per bucket key `${cacheKey}:${bucket.id}` */
export const lastPingAtMap = new Map<string, number>();

/** Lock set preventing concurrent in-flight probe requests for the same bucket */
export const inFlightPings = new Set<string>();

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
      // If deltaMs > 0, Google's rolling countdown timer is already actively counting down
      if (deltaMs > 0) {
        return false;
      }
    }
  }
  return true;
}

export function triggerAutoPingIfIdle(
  cacheKey: string,
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
  } else if (groupLower.includes('claude') || groupLower.includes('gpt')) {
    groupType = 'claude_gpt';
  }

  if (!groupType) return;

  const lockKey = `${cacheKey}:${bucket.id}`;
  if (inFlightPings.has(lockKey)) return;

  const lastPingAt = lastPingAtMap.get(lockKey);
  if (lastPingAt !== undefined && nowMs - lastPingAt < AUTO_PING_COOLDOWN_MS) {
    return;
  }

  inFlightPings.add(lockKey);

  void pingAntigravityBucket(authIndex, projectId, groupType)
    .then((success) => {
      if (success) {
        const pingTime = Date.now();
        lastPingAtMap.set(lockKey, pingTime);

        const resetInstantMs = pingTime + FIVE_HOURS_MS;
        const resetTimeIso = new Date(resetInstantMs).toISOString();

        // Update in-place so returned groups from the current fetch carry the new countdown
        bucket.remainingFraction = 0.99999;
        bucket.resetTime = resetTimeIso;
        bucket.resetAtMs = resetInstantMs;
        bucket.description =
          'You have used some of your 5-hour limit, it will fully refresh in 4 hours, 59 minutes.';

        // Synchronize through Zustand store under the correct cacheKey
        useQuotaStore.getState().setAntigravityQuota((prev) => {
          const current = prev[cacheKey];
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
            [cacheKey]: {
              ...current,
              groups: updatedGroups,
            },
          };
        });
      }
    })
    .finally(() => {
      inFlightPings.delete(lockKey);
    });
}
