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

export interface CodexUsagePayload {
    plan_type?: string;
    planType?: string;
    rate_limit?: CodexRateLimitInfo | null;
    rateLimit?: CodexRateLimitInfo | null;
    code_review_rate_limit?: CodexRateLimitInfo | null;
    codeReviewRateLimit?: CodexRateLimitInfo | null;
}

export interface CopilotQuotaDetail {
    entitlement?: number | string;
    overage_count?: number | string;
    overage_permitted?: boolean;
    percent_remaining?: number | string;
    quota_id?: string;
    quota_remaining?: number | string;
    remaining?: number | string;
    unlimited?: boolean;
}

export interface CopilotQuotaSnapshots {
    chat?: CopilotQuotaDetail;
    completions?: CopilotQuotaDetail;
    premium_interactions?: CopilotQuotaDetail;
}

export interface CopilotQuotaPayload {
    access_type_sku?: string;
    copilot_plan?: string;
    quota_reset_date?: string;
    quota_snapshots?: CopilotQuotaSnapshots;
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

export interface CopilotQuotaCategory {
    id: string;
    labelKey: string;
    percentRemaining: number | null;
    remaining: number | null;
    entitlement: number | null;
    unlimited: boolean;
    overagePermitted: boolean;
    overageCount: number;
}

export interface CopilotQuotaState {
    status: 'idle' | 'loading' | 'success' | 'error';
    categories: CopilotQuotaCategory[];
    planType?: string | null;
    resetDate?: string | null;
    error?: string;
    errorStatus?: number;
}
