import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { antigravitySubscriptionApi, type AntigravitySubscriptionSummary } from '@/services/api';
import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { getStatusFromError, isAntigravityFile, isRuntimeOnlyAuthFile } from '@/utils/quota';

export type AntigravitySubscriptionState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: AntigravitySubscriptionSummary;
  error?: string;
  errorStatus?: number;
};

type SubscriptionTarget = {
  file: AuthFileItem;
  authIndex: string | null;
  cacheKey: string;
};

type SubscriptionResult =
  | {
      name: string;
      cacheKey: string;
      status: 'success';
      data: AntigravitySubscriptionSummary;
    }
  | {
      name: string;
      cacheKey: string;
      status: 'error';
      error: string;
      errorStatus?: number;
    };

const buildCacheKey = (file: AuthFileItem, authIndex: string | null): string =>
  `${file.name}\n${authIndex ?? ''}`;

export function useAntigravitySubscriptions(files: AuthFileItem[]) {
  const { t } = useTranslation();
  const [subscriptions, setSubscriptions] = useState<Record<string, AntigravitySubscriptionState>>(
    {}
  );
  const cacheKeysRef = useRef(new Map<string, string>());

  const targets = useMemo(
    () =>
      files.reduce<SubscriptionTarget[]>((result, file) => {
        if (!isAntigravityFile(file) || isRuntimeOnlyAuthFile(file)) return result;
        const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
        result.push({
          file,
          authIndex,
          cacheKey: buildCacheKey(file, authIndex),
        });
        return result;
      }, []),
    [files]
  );

  useEffect(() => {
    const targetsToLoad = targets.filter(
      (target) => cacheKeysRef.current.get(target.file.name) !== target.cacheKey
    );
    if (targetsToLoad.length === 0) return;

    let cancelled = false;
    const requestTargets = targetsToLoad.filter((target) => target.authIndex);

    setSubscriptions((prev) => {
      const next = { ...prev };
      targetsToLoad.forEach((target) => {
        cacheKeysRef.current.set(target.file.name, target.cacheKey);
        next[target.file.name] = target.authIndex
          ? { status: 'loading' }
          : {
              status: 'error',
              error: t('antigravity_subscription.missing_auth_index'),
            };
      });
      return next;
    });

    if (requestTargets.length === 0) return;

    void (async () => {
      const results = await Promise.all(
        requestTargets.map(async (target): Promise<SubscriptionResult> => {
          try {
            const data = await antigravitySubscriptionApi.get(target.authIndex as string);
            if (!data) {
              return {
                name: target.file.name,
                cacheKey: target.cacheKey,
                status: 'error',
                error: t('antigravity_subscription.empty_data'),
              };
            }
            return {
              name: target.file.name,
              cacheKey: target.cacheKey,
              status: 'success',
              data,
            };
          } catch (err: unknown) {
            return {
              name: target.file.name,
              cacheKey: target.cacheKey,
              status: 'error',
              error: err instanceof Error ? err.message : t('common.unknown_error'),
              errorStatus: getStatusFromError(err),
            };
          }
        })
      );

      if (cancelled) return;

      setSubscriptions((prev) => {
        const next = { ...prev };
        results.forEach((result) => {
          if (cacheKeysRef.current.get(result.name) !== result.cacheKey) return;
          if (result.status === 'success') {
            next[result.name] = { status: 'success', data: result.data };
          } else {
            next[result.name] = {
              status: 'error',
              error: result.error,
              errorStatus: result.errorStatus,
            };
          }
        });
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [t, targets]);

  return subscriptions;
}
