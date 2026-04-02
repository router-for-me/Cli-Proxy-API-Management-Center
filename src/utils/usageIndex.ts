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
  candidates: Iterable<string>
): UsageDetail[] {
  let firstDetails: UsageDetail[] | null = null;
  let merged: UsageDetail[] | null = null;

  for (const candidate of candidates) {
    const details = usageDetailsBySource.get(candidate);
    if (!details || details.length === 0) continue;

    if (!firstDetails) {
      firstDetails = details;
      continue;
    }

    if (!merged) {
      merged = [...firstDetails];
    }
    for (const detail of details) {
      merged.push(detail);
    }
  }

  return merged ?? firstDetails ?? EMPTY_USAGE_DETAILS;
}
