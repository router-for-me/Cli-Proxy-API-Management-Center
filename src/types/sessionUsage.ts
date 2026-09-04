export type SessionUsageProtocol = 'codex' | 'claude' | string;

export interface SessionRequestUsage {
  leaseId: string;
  requestId: string;
  state: string;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  expiresAt: string | null;
}

export interface CredentialSessionUsageItem {
  protocol: SessionUsageProtocol;
  sessionId: string;
  homeSessionId: string;
  seatId: string;
  parentHomeSessionId: string;
  isSeat: boolean;
  state: string;
  lastSeenAt: string | null;
  expiresAt: string | null;
  activeRequests: number;
  requests: SessionRequestUsage[];
}

export interface CredentialSessionSeatUsage {
  seatId: string;
  ordinal: number;
  protocol: SessionUsageProtocol;
  state: string;
  activeRequests: number;
  sessions: CredentialSessionUsageItem[];
  sessionHistory: CredentialSessionUsageItem[];
}

export interface CredentialSessionUsage {
  credentialId: string;
  maxSessions: number;
  maxRequestsPerSession: number;
  maxRequestsPerSeat: number;
  policyVersion: number;
  seatCount: number;
  claimedSeatCount: number;
  availableSeatCount: number;
  retiringSeatCount: number;
  frozenSeatCount: number;
  remainingSessions: number;
  admittedSessions: number;
  observedSessions: number;
  activeRequestCount: number;
  coverageComplete: boolean;
  sessions: CredentialSessionUsageItem[];
  seats: CredentialSessionSeatUsage[];
}

export interface CredentialSessionUsagesResponse {
  observedAt: string | null;
  items: CredentialSessionUsage[];
}
