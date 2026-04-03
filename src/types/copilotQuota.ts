export interface CopilotQuotaSnapshot {
  entitlement: number;
  remaining: number;
  used: number;
  percent_used: number;
  unlimited: boolean;
}

export interface CopilotQuotaSnapshots {
  premium_interactions: CopilotQuotaSnapshot;
  completions: CopilotQuotaSnapshot;
  chat: CopilotQuotaSnapshot;
}

export interface CopilotAccountQuota {
  account_id: string;
  email: string;
  plan?: string;
  quota_snapshots: CopilotQuotaSnapshots;
  reset_date?: string;
  cached_at: string;
  error?: string;
}

export interface CopilotQuotaResponse {
  accounts: CopilotAccountQuota[];
  cache_ttl_seconds: number;
  message?: string;
}

export interface CopilotDeviceCodeResponse {
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  device_code: string;
}

export type CopilotPollResponse = 
  | { status: 'complete'; email: string }
  | { status: 'error'; message: string };

export interface CopilotAccountListResponse {
  accounts: string[];
}
