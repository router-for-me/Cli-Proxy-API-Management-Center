/**
 * OpenCode Go subscription usage report (CLIProxyAPI management API).
 *
 * GET lists every subscription leg with its usage windows; POST refresh polls
 * the console usage endpoint now (bounded server-side) and returns the same
 * shape with fresh windows. Neither response ever carries key material.
 */

import { apiClient } from './client';

export interface OpenCodeUsageWindow {
  name: string;
  status?: string;
  percent?: number;
  resets_at?: string;
}

export interface OpenCodeUsageSubscription {
  auth_id: string;
  label?: string;
  disabled?: boolean;
  state: string;
  windows?: OpenCodeUsageWindow[];
  fetched_at?: string;
  last_attempt?: string;
  next_attempt?: string;
  last_error?: string;
}

type OpenCodeUsageResponse = { subscriptions?: OpenCodeUsageSubscription[] };

const readSubscriptions = (payload: OpenCodeUsageResponse | undefined): OpenCodeUsageSubscription[] =>
  Array.isArray(payload?.subscriptions) ? payload.subscriptions : [];

export const opencodeUsageApi = {
  /** Read-only listing; safe against servers that predate the endpoint (404). */
  list: async (): Promise<OpenCodeUsageSubscription[]> =>
    readSubscriptions(await apiClient.get<OpenCodeUsageResponse>('/quota/opencode')),

  /** Poll now and report; falls back to the read-only listing on older servers. */
  refresh: async (): Promise<OpenCodeUsageSubscription[]> => {
    try {
      return readSubscriptions(
        await apiClient.post<OpenCodeUsageResponse>('/quota/opencode/refresh')
      );
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 404 && status !== 405) throw error;
      return readSubscriptions(await apiClient.get<OpenCodeUsageResponse>('/quota/opencode'));
    }
  },
};
