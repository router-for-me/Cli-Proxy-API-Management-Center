export interface CodexRuntimeQuotaWindow {
  remaining?: number | null;
  limit?: number | null;
  reset_at?: string | number | null;
}

export interface CodexRuntimeQuotaState {
  five_hour?: CodexRuntimeQuotaWindow | null;
  weekly?: CodexRuntimeQuotaWindow | null;
  last_refresh_at?: string | number | null;
  refresh_status?: string;
  refresh_error?: string;
}

export interface CodexScoreExplanation {
  score_available: boolean;
  computed_score_live?: number | null;
  weekly_remaining?: number | null;
  weekly_limit?: number | null;
  hours_until_weekly_reset?: number | null;
  manual_adjustment?: number;
  refresh_is_fresh: boolean;
  refresh_status?: string;
  disqualifier_reason?: string;
  formula?: string;
  formula_label?: string;
}

export interface CodexStateEntry {
  id: string;
  auth_index?: string;
  name?: string;
  provider?: string;
  on_device?: boolean;
  status?: string;
  disabled?: boolean;
  unavailable?: boolean;
  email?: string;
  note?: string;
  account_type?: string;
  account?: string;
  codex_quota?: CodexRuntimeQuotaState | null;
  codex_manual_score_adjustment?: number;
  codex_computed_score?: number;
  codex_score_reason?: string;
  codex_last_selection_reason?: string;
  codex_score_explanation?: CodexScoreExplanation | null;
}

export interface CodexStateListResponse {
  'codex-state': CodexStateEntry[];
}

export interface CodexStateManualScorePatchRequest {
  id?: string;
  name?: string;
  auth_index?: string;
  value: number;
}

export interface CodexStateManualScorePatchResponse {
  status: string;
  id: string;
  auth_index?: string;
  name?: string;
  codex_manual_score_adjustment?: number;
}

export interface CodexStateRefreshResponse {
  status: string;
  refreshed?:
    | { id: string; auth_index?: string; name?: string }
    | Array<{ id: string; auth_index?: string; name?: string }>;
}

export interface CodexStateRecalcResponse {
  status: string;
  on_device?: {
    id: string;
    auth_index?: string;
    name?: string;
    email?: string;
    note?: string;
    account?: string;
  } | null;
}
