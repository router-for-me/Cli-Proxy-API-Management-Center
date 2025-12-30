/**
 * Quota management types.
 */

export interface AntigravityQuotaGroup {
  id: string;
  label: string;
  models: string[];
  remainingFraction: number;
  resetTime?: string;
}

export interface AntigravityQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  groups: AntigravityQuotaGroup[];
  error?: string;
  errorStatus?: number;
}

export interface GeminiCliQuotaBucketState {
  id: string;
  label: string;
  remainingFraction: number | null;
  remainingAmount: number | null;
  resetTime: string | undefined;
  tokenType: string | null;
  modelIds?: string[];
}

export interface GeminiCliQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  buckets: GeminiCliQuotaBucketState[];
  error?: string;
  errorStatus?: number;
}

export interface CodexQuotaWindow {
  id: string;
  label: string;
  usedPercent: number | null;
  resetLabel: string;
}

export interface CodexQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  windows: CodexQuotaWindow[];
  planType?: string | null;
  error?: string;
  errorStatus?: number;
}

export interface ClaudeCodeQuotaInfo {
  unified_status: string;
  five_hour_status: string;
  five_hour_reset: number;
  five_hour_utilization: number;
  seven_day_status: string;
  seven_day_reset: number;
  seven_day_utilization: number;
  overage_status: string;
  overage_reset: number;
  overage_utilization: number;
  representative_claim: string;
  fallback_percentage: number;
  unified_reset: number;
  last_updated: string;
}

export interface ClaudeCodeQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  quota: ClaudeCodeQuotaInfo | null;
  email?: string;
  label?: string;
  error?: string;
  errorStatus?: number;
}
