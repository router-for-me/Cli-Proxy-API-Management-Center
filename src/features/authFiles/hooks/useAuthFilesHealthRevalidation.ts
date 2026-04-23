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

const isTransientCodexCandidate = (file: AuthFileItem): boolean => {
  if (resolveAuthProvider(file) !== 'codex') return false;
  if (file.disabled === true) return false;
  const statusMessage = getAuthFileStatusMessage(file);
  return isTransientAuthFileStatusMessage(statusMessage);
};

export function useAuthFilesHealthRevalidation(files: AuthFileItem[]): AuthFileItem[] {
  const [revalidatedByName, setRevalidatedByName] = useState<Record<string, true>>({});
  const cacheRef = useRef<Map<string, RevalidationCacheEntry>>(new Map());
  const inflightRef = useRef<Map<string, Promise<void>>>(new Map());

  useEffect(() => {
    const now = Date.now();
    const candidateNames = new Set<string>();

    files.forEach((file) => {
      const name = String(file.name || '').trim();
      if (!name || !isTransientCodexCandidate(file)) return;
      candidateNames.add(name);
    });

    files.forEach((file) => {
      const name = String(file.name || '').trim();
      if (!name || !candidateNames.has(name)) {
        return;
      }

      const cached = cacheRef.current.get(name);
      if (cached && cached.expiresAt > now) {
        return;
      }

      if (inflightRef.current.has(name)) {
        return;
      }

      const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
      const accountId = resolveCodexChatgptAccountId(file);
      if (!authIndex || !accountId) {
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

        cacheRef.current.set(name, {
          expiresAt: Date.now() + REVALIDATION_TTL_MS,
          success,
        });

        setRevalidatedByName((prev) => {
          if (success) {
            return prev[name] ? prev : { ...prev, [name]: true };
          }

          if (!prev[name]) {
            return prev;
          }

          const next = { ...prev };
          delete next[name];
          return next;
        });
      })().finally(() => {
        inflightRef.current.delete(name);
      });

      inflightRef.current.set(name, promise);
    });
  }, [files]);

  return useMemo(
    () =>
      files.map((file) => {
        const name = String(file.name || '').trim();
        if (!name || !isTransientCodexCandidate(file) || !revalidatedByName[name]) {
          return file;
        }

        return {
          ...file,
          healthRevalidated: true,
        };
      }),
    [files, revalidatedByName]
  );
}
