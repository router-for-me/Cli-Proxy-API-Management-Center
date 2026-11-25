import {
  RECENT_REQUEST_BLOCK_COUNT,
  mergeRecentRequestBucketGroups,
  type RecentRequestBucket,
} from '@/utils/recentRequests';
import { TRAFFIC_BUCKET_MINUTES } from './types';

export interface TrafficSample {
  buckets: RecentRequestBucket[];
  sampledAt: number;
}

const bucketMs = TRAFFIC_BUCKET_MINUTES * 60_000;
const bucketsPerDay = (24 * 60) / TRAFFIC_BUCKET_MINUTES;

function tailMinute(sample: TrafficSample) {
  const label = sample.buckets[sample.buckets.length - 1]?.time;
  const match = label?.match(/^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function mergeTrafficSamples(samples: TrafficSample[]): RecentRequestBucket[] {
  // The server labels contiguous buckets in local time, without a date or timezone.
  // Use elapsed sample time for the day, and labels to resolve request timing at a boundary.
  const reference = samples.find((sample) => tailMinute(sample) !== null);
  if (!reference) return mergeRecentRequestBucketGroups(samples.map((sample) => sample.buckets));
  const origin = tailMinute(reference)!;
  const ends = samples.map((sample) => {
    const minute = tailMinute(sample);
    if (minute === null) return null;
    const elapsed =
      Math.floor(sample.sampledAt / bucketMs) - Math.floor(reference.sampledAt / bucketMs);
    const clock = (minute - origin) / TRAFFIC_BUCKET_MINUTES;
    const offset = clock + Math.round((elapsed - clock) / bucketsPerDay) * bucketsPerDay;
    // A larger disagreement can be a server daylight-saving transition.
    return Number.isInteger(offset) && Math.abs(offset - elapsed) <= 1 ? offset : elapsed;
  });
  const latest = ends.reduce<number>((max, end) => Math.max(max, end ?? max), 0);
  return mergeRecentRequestBucketGroups(
    samples.map(({ buckets }, index) => {
      const lag = latest - (ends[index] ?? latest); // Legacy unlabeled groups stay tail-aligned.
      if (lag === 0) return buckets;
      if (lag >= RECENT_REQUEST_BLOCK_COUNT) return [];
      return [...buckets, ...Array.from({ length: lag }, () => ({ success: 0, failed: 0 }))];
    })
  );
}
