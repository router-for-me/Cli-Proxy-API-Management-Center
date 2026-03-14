/**
 * Quota management types.
 */

// Theme types
export type ThemeColors = { bg: string; text: string; border?: string };
export type TypeColorSet = { light: ThemeColors; dark?: ThemeColors };
export type ResolvedTheme = 'light' | 'dark';

// API payload types
export interface GeminiCliQuotaBucket {
  modelId?: string;
  model_id?: string;
  tokenType?: string;
  token_type?: string;
  remainingFraction?: number | string;
  remaining_fraction?: number | string;
  remainingAmount?: number | string;
  remaining_amount?: number | string;
  resetTime?: string;
  reset_time?: string;
}

export interface GeminiCliQuotaPayload {
  buckets?: GeminiCliQuotaBucket[];
}

export interface AntigravityQuotaInfo {
  displayName?: string;
  quotaInfo?: {
    remainingFraction?: number | string;
    remaining_fraction?: number | string;
    remaining?: number | string;
    resetTime?: string;
    reset_time?: string;
  };
  quota_info?: {
    remainingFraction?: number | string;
    remaining_fraction?: number | string;
    remaining?: number | string;
    resetTime?: string;
    reset_time?: string;
  };
}

export type AntigravityModelsPayload = Record<string, AntigravityQuotaInfo>;

export interface AntigravityQuotaGroupDefinition {
  id: string;
  label: string;
  identifiers: string[];
  labelFromModel?: boolean;
}

export interface GeminiCliQuotaGroupDefinition {
  id: string;
  label: string;
  preferredModelId?: string;
  modelIds: string[];
}

export interface GeminiCliParsedBucket {
  modelId: string;
  tokenType: string | null;
  remainingFraction: number | null;
  remainingAmount: number | null;
  resetTime: string | undefined;
}

export interface CodexUsageWindow {
  used_percent?: number | string;
  usedPercent?: number | string;
  limit_window_seconds?: number | string;
  limitWindowSeconds?: number | string;
  reset_after_seconds?: number | string;
  resetAfterSeconds?: number | string;
  reset_at?: number | string;
  resetAt?: number | string;
}

export interface CodexRateLimitInfo {
  allowed?: boolean;
  limit_reached?: boolean;
  limitReached?: boolean;
  primary_window?: CodexUsageWindow | null;
  primaryWindow?: CodexUsageWindow | null;
  secondary_window?: CodexUsageWindow | null;
  secondaryWindow?: CodexUsageWindow | null;
}

export interface CodexAdditionalRateLimit {
  limit_name?: string;
  limitName?: string;
  metered_feature?: string;
  meteredFeature?: string;
  rate_limit?: CodexRateLimitInfo | null;
  rateLimit?: CodexRateLimitInfo | null;
}

export interface CodexUsagePayload {
  plan_type?: string;
  planType?: string;
  rate_limit?: CodexRateLimitInfo | null;
  rateLimit?: CodexRateLimitInfo | null;
  code_review_rate_limit?: CodexRateLimitInfo | null;
  codeReviewRateLimit?: CodexRateLimitInfo | null;
  additional_rate_limits?: CodexAdditionalRateLimit[] | null;
  additionalRateLimits?: CodexAdditionalRateLimit[] | null;
}

// Claude API payload types
export interface ClaudeUsageWindow {
  utilization: number;
  resets_at: string;
}

export interface ClaudeExtraUsage {
  is_enabled: boolean;
  monthly_limit: number;
  used_credits: number;
  utilization: number | null;
}

export interface ClaudeUsagePayload {
  five_hour?: ClaudeUsageWindow | null;
  seven_day?: ClaudeUsageWindow | null;
  seven_day_oauth_apps?: ClaudeUsageWindow | null;
  seven_day_opus?: ClaudeUsageWindow | null;
  seven_day_sonnet?: ClaudeUsageWindow | null;
  seven_day_cowork?: ClaudeUsageWindow | null;
  iguana_necktie?: ClaudeUsageWindow | null;
  extra_usage?: ClaudeExtraUsage | null;
}

export interface ClaudeProfileResponse {
  account?: {
    uuid?: string;
    full_name?: string;
    display_name?: string;
    email?: string;
    has_claude_max?: boolean;
    has_claude_pro?: boolean;
    created_at?: string;
  };
  organization?: {
    uuid?: string;
    name?: string;
    organization_type?: string;
    billing_type?: string;
    rate_limit_tier?: string;
    has_extra_usage_enabled?: boolean;
    subscription_status?: string;
    subscription_created_at?: string;
  };
}

export interface ClaudeQuotaWindow {
  id: string;
  label: string;
  labelKey?: string;
  usedPercent: number | null;
  resetLabel: string;
}

export interface ClaudeQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  windows: ClaudeQuotaWindow[];
  extraUsage?: ClaudeExtraUsage | null;
  planType?: string | null;
  error?: string;
  errorStatus?: number;
}

// Quota state types
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
  labelKey?: string;
  labelParams?: Record<string, string | number>;
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

// Kiro API payload types
export interface KiroSubscriptionInfo {
  subscriptionTitle?: string;
  type?: string;
  overageCapability?: string;
  upgradeCapability?: string;
}

export interface KiroFreeTrialInfo {
  freeTrialStatus?: string;
  usageLimitWithPrecision?: number | string;
  currentUsageWithPrecision?: number | string;
  freeTrialExpiry?: number | string;
}

export interface KiroUsageBreakdown {
  resourceType?: string;
  usageLimitWithPrecision?: number | string;
  currentUsageWithPrecision?: number | string;
  nextDateReset?: number | string;
  freeTrialInfo?: KiroFreeTrialInfo;
  overageRate?: number;
  currency?: string;
}

export interface KiroQuotaPayload {
  daysUntilReset?: number;
  nextDateReset?: number | string;
  subscriptionInfo?: KiroSubscriptionInfo;
  usageBreakdownList?: KiroUsageBreakdown[];
  userInfo?: { userId?: string };
}

export interface KiroQuotaErrorPayload {
  __type?: string;
  message?: string;
  reason?: string;
}

export interface KiroBaseQuota {
  used: number;
  limit: number;
  resetTime: number;
}

export interface KiroFreeTrialQuota {
  used: number;
  limit: number;
  expiry: number;
  status: string;
}

export interface KiroQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  subscriptionTitle: string | null;
  baseQuota: KiroBaseQuota | null;
  freeTrialQuota: KiroFreeTrialQuota | null;
  error?: string;
  errorStatus?: number;
}

// GitHub Copilot API payload types
export interface CopilotLimitedQuotas {
  chat?: number | string;
  completions?: number | string;
}

export interface CopilotQuotaSnapshot {
  entitlement?: number | string;
  remaining?: number | string;
  percent_remaining?: number | string;
  unlimited?: boolean;
  overage_permitted?: boolean;
  overage_count?: number;
}

export interface CopilotQuotaSnapshots {
  chat?: CopilotQuotaSnapshot;
  completions?: CopilotQuotaSnapshot;
  premium_interactions?: CopilotQuotaSnapshot;
}

export interface CopilotQuotaPayload {
  login?: string;
  copilot_plan?: string;
  access_type_sku?: string;
  chat_enabled?: boolean;
  limited_user_quotas?: CopilotLimitedQuotas;
  monthly_quotas?: CopilotLimitedQuotas;
  limited_user_reset_date?: string;
  quota_reset_date?: string;
  quota_snapshots?: CopilotQuotaSnapshots;
}

export interface CopilotQuotaItem {
  id: string;
  label: string;
  used: number;
  limit: number;
  percent: number;
  unlimited: boolean;
}

export interface CopilotQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  plan: string | null;
  items: CopilotQuotaItem[];
  resetDate: string | null;
  error?: string;
  errorStatus?: number;
}

// Kimi API payload types
export interface KimiUsageDetail {
  used?: number;
  limit?: number;
  remaining?: number;
  name?: string;
  title?: string;
  resetAt?: string;
  reset_at?: string;
  resetTime?: string;
  reset_time?: string;
  resetIn?: number;
  reset_in?: number;
  ttl?: number;
}

export interface KimiLimitWindow {
  duration?: number;
  timeUnit?: string;
}

export interface KimiLimitItem {
  name?: string;
  title?: string;
  scope?: string;
  detail?: KimiUsageDetail;
  window?: KimiLimitWindow;
  used?: number;
  limit?: number;
  remaining?: number;
  duration?: number;
  timeUnit?: string;
  resetAt?: string;
  reset_at?: string;
  resetIn?: number;
  reset_in?: number;
  ttl?: number;
}

export interface KimiUsagePayload {
  usage?: KimiUsageDetail;
  limits?: KimiLimitItem[];
}

export interface KimiQuotaRow {
  id: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  used: number;
  limit: number;
  resetHint?: string;
}

export interface KimiQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  rows: KimiQuotaRow[];
  error?: string;
  errorStatus?: number;
}
