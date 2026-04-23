import { useEffect, useMemo, useRef, useState } from 'react';
import { apiCallApi, authFilesApi } from '@/services/api';
import type { AuthFileItem } from '@/types';
import {
  CODEX_REQUEST_HEADERS,
  CODEX_USAGE_URL,
  resolveAuthProvider,
  resolveCodexChatgptAccountId,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/usage';
import {
  getAuthFileStatusMessage,
  isTransientAuthFileStatusMessage,
} from '@/features/authFiles/constants';

const REVALIDATION_TTL_MS = 5 * 60 * 1000;

type RevalidationCacheEntry = {
  expiresAt: number;
  success: boolean;
};

type RevalidationTarget = {
  name: string;
  authIndex: string;
  accountId: string;
  cacheKey: string;
};

const resolveTransientCodexTarget = (file: AuthFileItem): RevalidationTarget | null => {
  const name = String(file.name || '').trim();
  if (!name) return null;
  if (resolveAuthProvider(file) !== 'codex') return null;
  if (file.disabled === true) return null;
  const statusMessage = getAuthFileStatusMessage(file);
  if (!isTransientAuthFileStatusMessage(statusMessage)) return null;

  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  const accountId = resolveCodexChatgptAccountId(file);
  if (!authIndex || !accountId) return null;

  return {
    name,
    authIndex,
    accountId,
    cacheKey: `${name}::${authIndex}::${accountId}`,
  };
};

export function useAuthFilesHealthRevalidation(files: AuthFileItem[]): AuthFileItem[] {
  const [revalidatedByKey, setRevalidatedByKey] = useState<Record<string, true>>({});
  const cacheRef = useRef<Map<string, RevalidationCacheEntry>>(new Map());
  const inflightRef = useRef<Map<string, Promise<void>>>(new Map());

  useEffect(() => {
    const now = Date.now();

    files.forEach((file) => {
      const target = resolveTransientCodexTarget(file);
      if (!target) return;

      const { name, authIndex, accountId, cacheKey } = target;
      const cached = cacheRef.current.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return;
      }

      if (inflightRef.current.has(cacheKey)) {
        return;
      }

      const promise = (async () => {
        let success = false;

        try {
          await authFilesApi.getModelsForAuthFile(name);
          const result = await apiCallApi.request({
            authIndex,
            method: 'GET',
            url: CODEX_USAGE_URL,
            header: {
              ...CODEX_REQUEST_HEADERS,
              'Chatgpt-Account-Id': accountId,
            },
          });
          success = result.statusCode >= 200 && result.statusCode < 300;
        } catch {
          success = false;
        }

        cacheRef.current.set(cacheKey, {
          expiresAt: Date.now() + REVALIDATION_TTL_MS,
          success,
        });

        setRevalidatedByKey((prev) => {
          if (success) {
            return prev[cacheKey] ? prev : { ...prev, [cacheKey]: true };
          }

          if (!prev[cacheKey]) {
            return prev;
          }

          const next = { ...prev };
          delete next[cacheKey];
          return next;
        });
      })().finally(() => {
        inflightRef.current.delete(cacheKey);
      });

      inflightRef.current.set(cacheKey, promise);
    });
  }, [files]);

  return useMemo(
    () =>
      files.map((file) => {
        const target = resolveTransientCodexTarget(file);
        if (!target || !revalidatedByKey[target.cacheKey]) {
          return file;
        }

        return {
          ...file,
          healthRevalidated: true,
        };
      }),
    [files, revalidatedByKey]
  );
}
