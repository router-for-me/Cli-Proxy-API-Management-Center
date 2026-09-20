import type {
  AggregatedBreakdownResult,
  AggregatedBreakdownRow,
  BreakdownRow,
  UsageBucket,
  UsageRange,
  UsageRangeQuery,
  UsageRecord,
  UsageSummary,
} from './types';

export function buildUsageRange(range: UsageRange, now = new Date()): UsageRangeQuery {
  const to = new Date(now.getTime());
  const from = new Date(now.getTime());
  if (range === '24h') {
    from.setHours(from.getHours() - 24);
    return { from: from.toISOString(), to: to.toISOString(), step: 'hour', range_mode: 'exact' };
  }
  from.setDate(from.getDate() - 7);
  return { from: from.toISOString(), to: to.toISOString(), step: 'day', range_mode: 'exact' };
}

export function summarizeBuckets(buckets: UsageBucket[]): UsageSummary {
  let totalTokens = 0;
  let uncachedInputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let nonReasoningOutputTokens = 0;
  let reasoningTokens = 0;
  let requests = 0;
  let failures = 0;
  let latencyMsSum = 0;
  let latencySamples = 0;
  let ttftMsSum = 0;
  let ttftSamples = 0;

  for (const bucket of buckets) {
    totalTokens += bucket.total_tokens ?? 0;
    uncachedInputTokens += bucket.uncached_input_tokens ?? 0;
    cacheReadTokens += bucket.cache_read_tokens ?? 0;
    cacheWriteTokens += bucket.cache_write_tokens ?? 0;
    nonReasoningOutputTokens += bucket.non_reasoning_output_tokens ?? 0;
    reasoningTokens += bucket.reasoning_tokens ?? 0;
    requests += bucket.records ?? 0;
    failures += bucket.failures ?? 0;

    latencyMsSum += bucket.latency_ms_sum ?? 0;
    latencySamples += bucket.latency_samples ?? 0;
    ttftMsSum += bucket.ttft_ms_sum ?? 0;
    ttftSamples += bucket.ttft_samples ?? 0;
  }

  const outputTokens = nonReasoningOutputTokens + reasoningTokens;
  const errorRate = requests > 0 ? (failures / requests) * 100 : 0;
  const avgLatencyMs = latencySamples > 0 ? latencyMsSum / latencySamples : null;
  const avgTtftMs = ttftSamples > 0 ? ttftMsSum / ttftSamples : null;
  const cacheHitDenominator = uncachedInputTokens + cacheReadTokens;
  const cacheHitRate =
    cacheHitDenominator > 0 ? (cacheReadTokens / cacheHitDenominator) * 100 : null;

  return {
    totalTokens,
    inputTokens: uncachedInputTokens,
    uncachedInputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    requests,
    failures,
    errorRate,
    avgLatencyMs,
    avgTtftMs,
    cacheHitRate,
  };
}

export function metricValue(bucket: UsageBucket, metric: 'tokens' | 'requests'): number {
  return metric === 'requests' ? bucket.records : bucket.total_tokens;
}

export function formatCompactNumber(value: number | null | undefined, maxDecimals = 2): string {
  if (value === null || value === undefined || isNaN(value)) return '0';
  if (value === 0) return '0';
  const isNegative = value < 0;
  const abs = Math.abs(value);

  if (abs < 1000) {
    return value.toLocaleString();
  }

  const units = [
    { limit: 1_000_000_000, symbol: 'B' },
    { limit: 1_000_000, symbol: 'M' },
    { limit: 1_000, symbol: 'K' },
  ];

  for (const u of units) {
    if (abs >= u.limit) {
      const scaled = abs / u.limit;
      const formatted = scaled.toFixed(maxDecimals).replace(/\.?0+$/, '');
      const prefix = isNegative ? '-' : '';
      return `${prefix}${formatted}${u.symbol}`;
    }
  }

  return value.toLocaleString();
}

export function formatTokenCount(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value) || value <= 0) {
    return '0';
  }
  return formatCompactNumber(value);
}

export interface NiceScale {
  max: number;
  step: number;
  ticks: number[];
}

export function computeNiceScale(rawMax: number, tickCount = 5, isInteger = false): NiceScale {
  if (rawMax <= 0 || isNaN(rawMax)) {
    const step = 1;
    const max = step * tickCount;
    const ticks = Array.from({ length: tickCount + 1 }, (_, i) => max - i * step);
    return { max, step, ticks };
  }

  const roughStep = rawMax / tickCount;
  const exp = Math.floor(Math.log10(roughStep));
  const mag = Math.pow(10, exp);
  const frac = roughStep / mag;

  let niceMultiplier: number;
  if (frac <= 1) {
    niceMultiplier = 1;
  } else if (frac <= 2) {
    niceMultiplier = 2;
  } else if (frac <= 2.5) {
    niceMultiplier = 2.5;
  } else if (frac <= 5) {
    niceMultiplier = 5;
  } else {
    niceMultiplier = 10;
  }

  let step = niceMultiplier * mag;
  if (isInteger) {
    if (step < 1) {
      step = 1;
    } else if (step % 1 !== 0) {
      step = Math.ceil(step);
    }
  }

  const max = step * tickCount;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const val = max - i * step;
    return Math.round(val * 1e6) / 1e6;
  });

  return { max, step, ticks };
}

export interface ChartPoint {
  x: number;
  y: number;
}

export function buildSmoothPath(
  points: (ChartPoint | null)[],
  tension = 0.35,
  yMin = 0,
  yMax = 100
): string {
  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];

  for (const pt of points) {
    if (pt === null) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
    } else {
      current.push(pt);
    }
  }
  if (current.length > 0) {
    segments.push(current);
  }

  let fullPath = '';

  for (const pts of segments) {
    if (pts.length === 0) continue;
    if (pts.length === 1) {
      fullPath += ` M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
      continue;
    }
    if (pts.length === 2) {
      fullPath += ` M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)} L ${pts[1].x.toFixed(2)},${pts[1].y.toFixed(2)}`;
      continue;
    }

    fullPath += ` M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(n - 1, i + 2)];

      const cp1x = p1.x + ((p2.x - p0.x) / 6) * tension * 2;
      let cp1y = p1.y + ((p2.y - p0.y) / 6) * tension * 2;

      const cp2x = p2.x - ((p3.x - p1.x) / 6) * tension * 2;
      let cp2y = p2.y - ((p3.y - p1.y) / 6) * tension * 2;

      if (p1.y === yMax && p2.y === yMax) {
        cp1y = yMax;
        cp2y = yMax;
      } else {
        cp1y = Math.max(yMin, Math.min(yMax, cp1y));
        cp2y = Math.max(yMin, Math.min(yMax, cp2y));
      }

      fullPath += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
    }
  }

  return fullPath.trim();
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || isNaN(ms) || ms <= 0) return '—';
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatLatency(record: UsageRecord): string {
  return formatDuration(record.latency_ms);
}

export function formatStatus(record: UsageRecord): string {
  return record.failed ? `${record.status_code || 500}` : `${record.status_code || 200}`;
}

export function cleanAccountName(account: string | null | undefined): string {
  if (account == null) return '—';
  const trimmed = account.trim();
  if (trimmed === '') return '—';
  return trimmed.replace(/\.json$/i, '');
}

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);

  const str = String(value);
  let prefix = '';

  // Prevent formula injection in spreadsheet applications (RFC 4180 / OWASP)
  if (/^\s*[=+\-@]/.test(str)) {
    prefix = "'";
  }

  const needsQuotes =
    prefix !== '' ||
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r');

  if (needsQuotes) {
    return `"${prefix}${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateUsageCsv(records: UsageRecord[]): string {
  const headers = [
    'Timestamp',
    'Provider',
    'Model',
    'Alias',
    'Account',
    'Endpoint',
    'Reasoning Effort',
    'Executor Type',
    'Stream',
    'Failed',
    'Status Code',
    'Latency (ms)',
    'TTFT (ms)',
    'Uncached Input Tokens',
    'Cache Read Tokens',
    'Cache Write Tokens',
    'Output Tokens',
    'Reasoning Tokens',
    'Total Tokens',
    'Error Message',
  ];

  const rows = records.map((r) => {
    const input = r.token_breakdown?.input;
    const output = r.token_breakdown?.output;
    const uncachedInput = input?.uncached_tokens ?? 0;
    const cacheRead = input?.cache_read_tokens ?? 0;
    const cacheWrite = input?.cache_write_tokens ?? 0;
    const reasoning = output?.reasoning_tokens ?? 0;
    const nonReasoningOutput = output?.non_reasoning_tokens ?? 0;
    const outputTotal = nonReasoningOutput + reasoning;
    const total = r.token_breakdown?.total_tokens ?? uncachedInput + cacheRead + cacheWrite + outputTotal;

    return [
      escapeCsvCell(r.timestamp),
      escapeCsvCell(r.provider),
      escapeCsvCell(r.model),
      escapeCsvCell(r.alias),
      escapeCsvCell(cleanAccountName(r.account)),
      escapeCsvCell(r.endpoint ?? ''),
      escapeCsvCell(r.reasoning_effort ?? ''),
      escapeCsvCell(r.executor_type),
      escapeCsvCell(r.stream ? 'true' : 'false'),
      escapeCsvCell(r.failed ? 'true' : 'false'),
      escapeCsvCell(r.status_code),
      escapeCsvCell(r.latency_ms),
      escapeCsvCell(r.ttft_ms ?? ''),
      escapeCsvCell(uncachedInput),
      escapeCsvCell(cacheRead),
      escapeCsvCell(cacheWrite),
      escapeCsvCell(outputTotal),
      escapeCsvCell(reasoning),
      escapeCsvCell(total),
      escapeCsvCell(r.error_message ?? ''),
    ].join(',');
  });

  const content = [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n') + '\r\n';
  return '﻿' + content;
}

export function aggregateBreakdownRows(
  rows: BreakdownRow[],
  topN = 5,
  metric: 'tokens' | 'requests' = 'tokens'
): AggregatedBreakdownResult {
  const totalTokens = rows.reduce((sum, r) => sum + r.total_tokens, 0);
  const totalRecords = rows.reduce((sum, r) => sum + r.records, 0);

  const sorted = [...rows].sort((a, b) => {
    if (metric === 'requests') {
      return b.records - a.records || b.total_tokens - a.total_tokens;
    }
    return b.total_tokens - a.total_tokens || b.records - a.records;
  });

  const getShare = (tokens: number, records: number) => {
    if (metric === 'requests') {
      return totalRecords > 0 ? records / totalRecords : 0;
    }
    return totalTokens > 0 ? tokens / totalTokens : 0;
  };

  if (sorted.length <= topN) {
    return {
      displayed: sorted.map((r) => ({
        ...r,
        share: getShare(r.total_tokens, r.records),
      })),
      totalTokens,
      totalRecords,
    };
  }

  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);

  const otherRow: AggregatedBreakdownRow = {
    key: '__other__',
    isOther: true,
    records: rest.reduce((sum, r) => sum + r.records, 0),
    failures: rest.reduce((sum, r) => sum + r.failures, 0),
    uncached_input_tokens: rest.reduce((sum, r) => sum + r.uncached_input_tokens, 0),
    cache_read_tokens: rest.reduce((sum, r) => sum + r.cache_read_tokens, 0),
    cache_write_tokens: rest.reduce((sum, r) => sum + r.cache_write_tokens, 0),
    non_reasoning_output_tokens: rest.reduce((sum, r) => sum + r.non_reasoning_output_tokens, 0),
    reasoning_tokens: rest.reduce((sum, r) => sum + r.reasoning_tokens, 0),
    total_tokens: rest.reduce((sum, r) => sum + r.total_tokens, 0),
    latency_ms_sum: rest.reduce((sum, r) => sum + r.latency_ms_sum, 0),
    latency_samples: rest.reduce((sum, r) => sum + r.latency_samples, 0),
    ttft_ms_sum: rest.reduce((sum, r) => sum + r.ttft_ms_sum, 0),
    ttft_samples: rest.reduce((sum, r) => sum + r.ttft_samples, 0),
    share: 0,
  };
  otherRow.share = getShare(otherRow.total_tokens, otherRow.records);

  const displayed: AggregatedBreakdownRow[] = [
    ...top.map((r) => ({
      ...r,
      share: getShare(r.total_tokens, r.records),
    })),
    otherRow,
  ];

  return {
    displayed,
    totalTokens,
    totalRecords,
  };
}
