import { DEFAULT_API_PORT, MANAGEMENT_API_PREFIX } from './constants';

const DEV_PROXY_PREFIX = '/__dev_proxy__';

export const normalizeApiBase = (input: string): string => {
  let base = (input || '').trim();
  if (!base) return '';
  base = base.replace(/\/?v0\/management\/?$/i, '');
  base = base.replace(/\/+$/i, '');
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  return base;
};

export const computeApiUrl = (base: string): string => {
  const normalized = normalizeApiBase(base);
  if (!normalized) return '';

  if (shouldUseDevProxy(normalized)) {
    return `${DEV_PROXY_PREFIX}/${encodeURIComponent(normalized)}${MANAGEMENT_API_PREFIX}`;
  }

  return `${normalized}${MANAGEMENT_API_PREFIX}`;
};

export const detectApiBaseFromLocation = (): string => {
  try {
    const { protocol, hostname, port } = window.location;
    const normalizedPort = port ? `:${port}` : '';
    return normalizeApiBase(`${protocol}//${hostname}${normalizedPort}`);
  } catch (error) {
    console.warn('Failed to detect api base from location, fallback to default', error);
    return normalizeApiBase(`http://localhost:${DEFAULT_API_PORT}`);
  }
};

export const isLocalhost = (hostname: string): boolean => {
  const value = (hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '[::1]';
};

const shouldUseDevProxy = (normalizedBase: string): boolean => {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return false;
  }

  try {
    const target = new URL(normalizedBase);
    const current = new URL(window.location.origin);
    return isLocalhost(current.hostname) && target.origin !== current.origin;
  } catch {
    return false;
  }
};
