import type { UsageDetail } from '@/utils/usage';

export type UsageDetailsBySource = Map<string, UsageDetail[]>;

const EMPTY_USAGE_DETAILS: UsageDetail[] = [];

export function indexUsageDetailsBySource(usageDetails: UsageDetail[]): UsageDetailsBySource {
  const map: UsageDetailsBySource = new Map();

  usageDetails.forEach((detail) => {
    const sourceId = detail.source;
    if (!sourceId) return;

    const bucket = map.get(sourceId);
    if (bucket) {
      bucket.push(detail);
    } else {
      map.set(sourceId, [detail]);
    }
  });

  return map;
}

export function collectUsageDetailsForCandidates(
  usageDetailsBySource: UsageDetailsBySource,
  candidates: readonly string[]
): UsageDetail[] {
  if (!candidates.length) return EMPTY_USAGE_DETAILS;

  let firstDetails: UsageDetail[] | null = null;
  let hasMultiple = false;

  for (const candidate of candidates) {
    const details = usageDetailsBySource.get(candidate);
    if (!details || details.length === 0) continue;

    if (!firstDetails) {
      firstDetails = details;
      continue;
    }

    hasMultiple = true;
    break;
  }

  if (!hasMultiple) {
    return firstDetails ?? EMPTY_USAGE_DETAILS;
  }

  const merged: UsageDetail[] = [];
  for (const candidate of candidates) {
    const details = usageDetailsBySource.get(candidate);
    if (!details || details.length === 0) continue;

    details.forEach((detail) => merged.push(detail));
  }

  return merged;
}

