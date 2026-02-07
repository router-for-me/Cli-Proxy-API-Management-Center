/**
 * Quota aggregation utilities for provider-wide statistics.
 */

import type {
  AntigravityQuotaState,
  AntigravityQuotaGroup,
  AggregatedAntigravityGroup,
  CodexQuotaState,
  CodexQuotaWindow,
  AggregatedCodexWindow,
  GeminiCliQuotaState,
  GeminiCliQuotaBucketState,
  AggregatedGeminiCliBucket,
} from '@/types';

/**
 * Aggregates Antigravity quota data across all successful credentials.
 * Groups are matched by ID and averaged.
 */
export function aggregateAntigravityQuota(
  quotaMap: Record<string, AntigravityQuotaState>
): AggregatedAntigravityGroup[] {
  const successQuotas = Object.values(quotaMap).filter(
    (q) => q.status === 'success' && q.groups && q.groups.length > 0
  );

  if (successQuotas.length === 0) return [];

  // Collect all unique group IDs while preserving order from first occurrence
  const groupIdOrder: string[] = [];
  const groupIdSet = new Set<string>();
  successQuotas.forEach((q) =>
    q.groups.forEach((g) => {
      if (!groupIdSet.has(g.id)) {
        groupIdSet.add(g.id);
        groupIdOrder.push(g.id);
      }
    })
  );

  return groupIdOrder.map((groupId) => {
    const matchingGroups: AntigravityQuotaGroup[] = [];
    successQuotas.forEach((q) => {
      const group = q.groups.find((g) => g.id === groupId);
      if (group) matchingGroups.push(group);
    });

    const avgFraction =
      matchingGroups.reduce((sum, g) => sum + g.remainingFraction, 0) /
      matchingGroups.length;

    const resetTimes = matchingGroups
      .map((g) => g.resetTime)
      .filter((t): t is string => Boolean(t))
      .sort();

    const firstGroup = matchingGroups[0];

    return {
      id: groupId,
      label: firstGroup.label,
      models: firstGroup.models,
      averageRemainingFraction: avgFraction,
      credentialCount: matchingGroups.length,
      resetTimeRange:
        resetTimes.length > 0
          ? { earliest: resetTimes[0], latest: resetTimes[resetTimes.length - 1] }
          : null,
    };
  });
}

/**
 * Aggregates Codex quota data across all successful credentials.
 * Windows are matched by ID and averaged.
 */
export function aggregateCodexQuota(
  quotaMap: Record<string, CodexQuotaState>
): AggregatedCodexWindow[] {
  const successQuotas = Object.values(quotaMap).filter(
    (q) => q.status === 'success' && q.windows && q.windows.length > 0
  );

  if (successQuotas.length === 0) return [];

  // Collect all unique window IDs while preserving order
  const windowIdOrder: string[] = [];
  const windowIdSet = new Set<string>();
  successQuotas.forEach((q) =>
    q.windows.forEach((w) => {
      if (!windowIdSet.has(w.id)) {
        windowIdSet.add(w.id);
        windowIdOrder.push(w.id);
      }
    })
  );

  return windowIdOrder.map((windowId) => {
    const matchingWindows: CodexQuotaWindow[] = [];
    successQuotas.forEach((q) => {
      const window = q.windows.find((w) => w.id === windowId);
      if (window) matchingWindows.push(window);
    });

    // Calculate average remaining percent (Codex uses usedPercent, so we invert)
    const validWindows = matchingWindows.filter((w) => w.usedPercent !== null);
    let avgRemainingPercent: number | null = null;
    if (validWindows.length > 0) {
      const sum = validWindows.reduce((acc, w) => acc + (100 - w.usedPercent!), 0);
      avgRemainingPercent = sum / validWindows.length;
    }

    // Collect reset labels for range
    const resetLabels = matchingWindows
      .map((w) => w.resetLabel)
      .filter((l) => l && l !== '-')
      .sort();

    const firstWindow = matchingWindows[0];

    return {
      id: windowId,
      label: firstWindow.label,
      labelKey: firstWindow.labelKey ?? '',
      averageRemainingPercent: avgRemainingPercent,
      credentialCount: matchingWindows.length,
      resetLabelRange:
        resetLabels.length > 0
          ? { earliest: resetLabels[0], latest: resetLabels[resetLabels.length - 1] }
          : null,
    };
  });
}

/**
 * Aggregates Gemini CLI quota data across all successful credentials.
 * Buckets are matched by ID and averaged.
 */
export function aggregateGeminiCliQuota(
  quotaMap: Record<string, GeminiCliQuotaState>
): AggregatedGeminiCliBucket[] {
  const successQuotas = Object.values(quotaMap).filter(
    (q) => q.status === 'success' && q.buckets && q.buckets.length > 0
  );

  if (successQuotas.length === 0) return [];

  // Collect all unique bucket IDs while preserving order
  const bucketIdOrder: string[] = [];
  const bucketIdSet = new Set<string>();
  successQuotas.forEach((q) =>
    q.buckets.forEach((b) => {
      if (!bucketIdSet.has(b.id)) {
        bucketIdSet.add(b.id);
        bucketIdOrder.push(b.id);
      }
    })
  );

  return bucketIdOrder.map((bucketId) => {
    const matchingBuckets: GeminiCliQuotaBucketState[] = [];
    successQuotas.forEach((q) => {
      const bucket = q.buckets.find((b) => b.id === bucketId);
      if (bucket) matchingBuckets.push(bucket);
    });

    // Calculate average remaining fraction
    const validBuckets = matchingBuckets.filter((b) => b.remainingFraction !== null);
    let avgFraction: number | null = null;
    if (validBuckets.length > 0) {
      const sum = validBuckets.reduce((acc, b) => acc + (b.remainingFraction ?? 0), 0);
      avgFraction = sum / validBuckets.length;
    }

    const resetTimes = matchingBuckets
      .map((b) => b.resetTime)
      .filter((t): t is string => Boolean(t))
      .sort();

    const firstBucket = matchingBuckets[0];

    return {
      id: bucketId,
      label: firstBucket.label,
      averageRemainingFraction: avgFraction,
      credentialCount: matchingBuckets.length,
      resetTimeRange:
        resetTimes.length > 0
          ? { earliest: resetTimes[0], latest: resetTimes[resetTimes.length - 1] }
          : null,
      tokenType: firstBucket.tokenType,
      modelIds: firstBucket.modelIds,
    };
  });
}
