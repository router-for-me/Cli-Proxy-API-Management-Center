/**
 * Usage statistics types — mirrors backend usagestats API response.
 * All fields are safe metadata only (no prompts, messages, raw keys, or tokens).
 */

/** Token breakdown from a usage record. */
export interface TokenSummary {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
}

/** Cost breakdown with known/unknown semantics. */
export interface CostSummary {
  /** If false, pricing data was incomplete; total_usd should not be trusted. */
  known: boolean;
  /** Total cost in USD. */
  total_usd: number;
  /** Number of requests where cost could not be calculated. */
  unknown_requests: number;
  /** Number of tokens in requests without pricing. */
  unknown_tokens: number;
}

/** Aggregate totals for the queried time range. */
export interface SummaryTotal {
  requests: number;
  success: number;
  failed: number;
  tokens: TokenSummary;
  cost: CostSummary;
}

/** One row in the grouped breakdown. */
export interface SummaryRow {
  /** Group key — date string, provider name, model name, key prefix, or auth id. */
  key: string;
  requests: number;
  success: number;
  failed: number;
  tokens: TokenSummary;
  cost: CostSummary;
}

/** A single recent request record (safe metadata only). */
export interface RecentRecord {
  time: string;
  request_id: string;
  provider: string;
  model: string;
  alias: string;
  status_code: number;
  failed: boolean;
  tokens: TokenSummary;
  cost: CostSummary;
  /** Hashed API key prefix — safe to display. */
  api_key_id: string;
  auth_index: string;
  auth_type: string;
  latency_ms: number;
  error_type: string;
  reasoning_effort: string;
}

/** Full response from GET /usage-statistics/summary. */
export interface UsageStatisticsSummaryResponse {
  from: string;
  to: string;
  group_by: string;
  summary: SummaryTotal;
  groups: SummaryRow[];
  recent?: RecentRecord[];
}

/** Valid group_by values. */
export type GroupByValue = 'day' | 'provider' | 'model' | 'api_key' | 'auth' | 'call_type';

/** Query parameters for the summary endpoint. */
export interface UsageStatisticsQuery {
  from?: string;
  to?: string;
  group_by?: GroupByValue;
  recent_limit?: number;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** Currency symbol constant — easy to change or make configurable later. */
export const COST_CURRENCY_SYMBOL = '$';

/**
 * Format a cost value for display.
 * Returns `"-"` when cost is unknown to avoid misleading zeros.
 */
export function formatCost(cost: CostSummary): string {
  if (!cost.known) return '-';
  return `${COST_CURRENCY_SYMBOL}${cost.total_usd.toFixed(4)}`;
}

/**
 * Format a token count with locale-appropriate separators.
 */
export function formatTokens(n: number): string {
  return n.toLocaleString();
}
