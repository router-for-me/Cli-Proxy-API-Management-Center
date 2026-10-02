import { apiCallApi } from '@/services/api';
import { ANTIGRAVITY_REQUEST_HEADERS } from '@/utils/quota';
import type { AntigravityQuotaBucket } from '@/types';

const pingedBuckets = new Set<string>();

export async function pingAntigravityBucket(
  authIndex: string,
  projectId: string,
  groupType: 'gemini' | 'claude_gpt'
): Promise<boolean> {
  const models =
    groupType === 'gemini'
      ? ['gemini-3.1-pro-low', 'gemini-2.5-flash', 'gemini-3.5-flash']
      : ['claude-sonnet-4-6', 'gpt-oss-120b-medium', 'claude-opus-4-6-thinking'];

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
      // Continue to next candidate model
    }
  }

  return false;
}

export function isFiveHourBucketIdle(bucket: AntigravityQuotaBucket, nowMs: number): boolean {
  if (bucket.window !== '5h' && !bucket.id.includes('5h')) return false;
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
      // If deltaMs is significantly less than 5 hours (e.g. < 4h 55m), countdown is already active
      if (deltaMs > 0 && deltaMs < (5 * 3600 - 300) * 1000) {
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
  if (pingedBuckets.has(key)) return;
  pingedBuckets.add(key);

  void pingAntigravityBucket(authIndex, projectId, groupType).then((success) => {
    if (success) {
      bucket.remainingFraction = 0.99999;
      bucket.resetTime = new Date(Date.now() + 5 * 3600 * 1000).toISOString();
      bucket.description =
        'You have used some of your 5-hour limit, it will fully refresh in 4 hours, 59 minutes.';
    }
  });
}
