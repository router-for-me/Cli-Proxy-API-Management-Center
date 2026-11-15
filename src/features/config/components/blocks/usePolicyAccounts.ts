import { useEffect, useState } from 'react';
import { authFilesApi } from '@/services/api/authFiles';
import type { AuthFileItem } from '@/types/authFile';

export interface PolicyAccount {
  authIndex: string;
  label: string;
  provider: string;
  state: 'active' | 'cooldown' | 'disabled';
}

function toPolicyAccount(item: AuthFileItem): PolicyAccount | null {
  const authIndex =
    item.authIndex === null || item.authIndex === undefined ? '' : String(item.authIndex).trim();
  if (!authIndex) return null;
  const provider =
    String(item.provider || item.type || 'other')
      .trim()
      .toLowerCase() || 'other';
  const label = String(item.email || item.projectId || item.name || authIndex).trim();
  const coolingDown =
    (item.cooldownSnapshot?.records?.length ?? 0) > 0 || item.unavailable === true;
  const state: PolicyAccount['state'] = item.disabled
    ? 'disabled'
    : coolingDown
      ? 'cooldown'
      : 'active';
  return { authIndex, label, provider, state };
}

/** Loads credentials once per mount; the list is only needed while the editor is open. */
export function usePolicyAccounts(enabled: boolean) {
  const [accounts, setAccounts] = useState<PolicyAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    authFilesApi
      .list()
      .then((response) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const next: PolicyAccount[] = [];
        for (const item of response.files) {
          const account = toPolicyAccount(item);
          if (!account || seen.has(account.authIndex)) continue;
          seen.add(account.authIndex);
          next.push(account);
        }
        next.sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label));
        setAccounts(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { accounts, loading, error };
}
