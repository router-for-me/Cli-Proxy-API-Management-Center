/** DB-backed quota snapshots exposed by CPA Home's Management API. */

export type ManagementQuotaStatus =
  | 'healthy'
  | 'low'
  | 'exhausted'
  | 'unknown'
  | 'error'
  | 'unsupported'
  | string;

export type ManagementQuotaFreshness = 'fresh' | 'stale' | 'never' | string;
export type ManagementQuotaCollectionStatus =
  | 'idle'
  | 'collecting'
  | 'success'
  | 'partial'
  | 'failed'
  | 'unsupported'
  | string;

export interface ManagementQuotaWindow {
  id: string;
  label: string | null;
  scope: string;
  scopeId: string | null;
  mode: string;
  status: string;
  unit: string;
  currency: string | null;
  used: number | null;
  remaining: number | null;
  limit: number | null;
  usedRatio: number | null;
  remainingRatio: number | null;
  isUnlimited: boolean;
  resetAt: string | null;
  windowSeconds: number | null;
  periodUnit: string;
  periodValue: number | null;
  source: string;
  observedAt: string | null;
  expiresAt: string | null;
}

export interface ManagementQuotaError {
  code: string;
  message: string;
  retryable: boolean;
  occurredAt: string | null;
  upstreamStatusCode: number | null;
  requestId: string | null;
}

export interface ManagementQuotaPlan {
  name: string;
  premium: boolean;
}

export interface ManagementQuotaRuntime {
  homeId: string;
  homeLabel: string;
  cpaNodeId: string;
  cpaNodeLabel: string;
}

export interface ManagementQuotaResetCredit {
  status: string;
  grantedAt: string | null;
  expiresAt: string | null;
}

export interface ManagementQuotaResetCredits {
  availableCount: number | null;
  observedAt: string | null;
  credits: ManagementQuotaResetCredit[];
}

export interface ManagementQuotaCredentialSnapshot {
  credentialId: string;
  authIndex: string | null;
  provider: string;
  credentialType: string;
  label: string;
  account: string | null;
  project: string | null;
  credentialStatus: string;
  quotaStatus: ManagementQuotaStatus;
  freshness: ManagementQuotaFreshness;
  collectionStatus: ManagementQuotaCollectionStatus;
  source: string | null;
  observedAt: string | null;
  expiresAt: string | null;
  earliestResetAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextProbeAt: string | null;
  consecutiveFailure: number;
  primaryWindows: ManagementQuotaWindow[];
  windowCount: number;
  error: ManagementQuotaError | null;
  runtime: ManagementQuotaRuntime | null;
  plan: ManagementQuotaPlan | null;
}

export interface ManagementQuotaCredentialDetails extends ManagementQuotaCredentialSnapshot {
  windows: ManagementQuotaWindow[];
  resetCredits: ManagementQuotaResetCredits | null;
  generatedAt: string | null;
}

export interface ManagementQuotaListResponse {
  items: ManagementQuotaCredentialSnapshot[];
  total: number;
  generatedAt: string | null;
}

export interface ManagementQuotaCollectionState {
  accepted: number;
  running: boolean;
}
