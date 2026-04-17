import type { AuthState } from '@/types';
import { STORAGE_KEY_AUTH, STORAGE_KEY_AUTH_SESSION } from '@/utils/constants';
import { obfuscatedStorage } from './secureStorage';
import { deobfuscateData, isObfuscated, obfuscateData } from '@/utils/encryption';

export interface AuthSessionSnapshot {
  apiBase: string;
  managementKey: string;
  rememberPassword: boolean;
}

type PersistedAuthPayload = {
  state?: Partial<AuthState>;
};

const normalizeSnapshot = (
  snapshot?: Partial<AuthSessionSnapshot> | null
): AuthSessionSnapshot | null => {
  const apiBase = typeof snapshot?.apiBase === 'string' ? snapshot.apiBase : '';
  const managementKey =
    typeof snapshot?.managementKey === 'string' ? snapshot.managementKey : '';
  if (!apiBase || !managementKey) {
    return null;
  }

  return {
    apiBase,
    managementKey,
    rememberPassword: Boolean(snapshot?.rememberPassword),
  };
};

export const readSessionSnapshot = (): AuthSessionSnapshot | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.sessionStorage.getItem(STORAGE_KEY_AUTH_SESSION);
  if (!raw) {
    return null;
  }

  try {
    const payload = isObfuscated(raw) ? deobfuscateData(raw) : raw;
    return normalizeSnapshot(JSON.parse(payload) as Partial<AuthSessionSnapshot>);
  } catch {
    return null;
  }
};

export const writeSessionSnapshot = (snapshot: AuthSessionSnapshot): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const payload = obfuscateData(JSON.stringify(snapshot));
  window.sessionStorage.setItem(STORAGE_KEY_AUTH_SESSION, payload);
};

export const clearSessionSnapshot = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(STORAGE_KEY_AUTH_SESSION);
};

export const readRememberedAuthSnapshot = (): AuthSessionSnapshot | null => {
  const persisted = obfuscatedStorage.getItem<PersistedAuthPayload>(STORAGE_KEY_AUTH);
  if (!persisted || typeof persisted !== 'object') {
    return null;
  }

  const candidate =
    persisted.state && typeof persisted.state === 'object' ? persisted.state : persisted;
  return normalizeSnapshot(candidate as Partial<AuthSessionSnapshot>);
};
