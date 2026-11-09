import { apiClient } from './client';
import { guardConfigConnection } from './configValue';

export interface CodexResetPolicy {
  account_key: string;
  enabled: boolean;
  before_expiry_seconds: number;
  pending: boolean;
  result: string;
  last_checked_at: number;
  last_reset_at: number;
}

function parsePolicy(value: unknown): CodexResetPolicy {
  const policy = value as Partial<CodexResetPolicy> | null;
  if (
    !policy ||
    typeof policy.account_key !== 'string' ||
    !/^codex-reset:[a-f0-9]{64}$/.test(policy.account_key) ||
    typeof policy.enabled !== 'boolean' ||
    typeof policy.pending !== 'boolean' ||
    typeof policy.before_expiry_seconds !== 'number' ||
    !Number.isInteger(policy.before_expiry_seconds) ||
    policy.before_expiry_seconds < 60 ||
    policy.before_expiry_seconds > 86400 ||
    typeof policy.result !== 'string' ||
    typeof policy.last_checked_at !== 'number' ||
    !Number.isInteger(policy.last_reset_at)
  )
    throw new Error('Invalid automatic reset policy response');
  return policy as CodexResetPolicy;
}

const path = (authIndex: string) =>
  `/routing/codex-reset-policy?auth_index=${encodeURIComponent(authIndex)}`;

export const codexResetPolicyApi = {
  async read(authIndex: string): Promise<CodexResetPolicy> {
    const current = guardConfigConnection();
    const policy = parsePolicy(await apiClient.get(path(authIndex)));
    current();
    return policy;
  },
  async save(
    authIndex: string,
    previous: CodexResetPolicy,
    seconds: number
  ): Promise<CodexResetPolicy> {
    if (!Number.isInteger(seconds) || (seconds !== 0 && (seconds < 60 || seconds > 86400))) {
      throw new Error('Invalid automatic reset expiry lead time');
    }
    const current = guardConfigConnection();
    const policy = parsePolicy(
      await apiClient.put(path(authIndex), {
        account_key: previous.account_key,
        enabled: seconds !== 0,
        before_expiry_seconds: seconds || previous.before_expiry_seconds,
      })
    );
    current();
    if (policy.account_key !== previous.account_key) throw new Error('Credential identity changed');
    return policy;
  },
};
