import { DEFAULT_API_PORT, MANAGEMENT_API_PREFIX } from './constants';

export const normalizeApiBase = (input: string): string => {
  let base = (input || '').trim();
  if (!base) return '';
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  try {
    const url = new URL(base);
    url.search = '';
    url.hash = '';
    base = url.toString();
  } catch {
    // Keep best-effort normalization for partial or non-standard inputs.
  }
  base = base.replace(/\/management\.html\/?$/i, '');
  base = base.replace(/\/?v0\/management\/?$/i, '');
  base = base.replace(/\/+$/i, '');
  return base;
};

export const computeApiUrl = (base: string): string => {
  const normalized = normalizeApiBase(base);
  if (!normalized) return '';
  return `${normalized}${MANAGEMENT_API_PREFIX}`;
};

export const detectApiBaseFromHref = (href: string): string => {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/management\.html$/i, '');
  return normalizeApiBase(url.toString());
};

export const shouldPreferDetectedApiBase = (savedBase: string, detectedBase: string): boolean => {
  const normalizedSaved = normalizeApiBase(savedBase);
  const normalizedDetected = normalizeApiBase(detectedBase);

  if (!normalizedSaved || !normalizedDetected || normalizedSaved === normalizedDetected) {
    return false;
  }

  try {
    const savedUrl = new URL(normalizedSaved);
    const detectedUrl = new URL(normalizedDetected);
    const savedIsOriginOnly = savedUrl.pathname === '' || savedUrl.pathname === '/';
    const detectedHasPathPrefix = detectedUrl.pathname !== '' && detectedUrl.pathname !== '/';

    return detectedHasPathPrefix && savedIsOriginOnly && savedUrl.origin === detectedUrl.origin;
  } catch {
    return false;
  }
};

export const resolveApiBase = (savedBase: string, detectedBase: string): string => {
  const normalizedSaved = normalizeApiBase(savedBase);
  const normalizedDetected = normalizeApiBase(detectedBase);

  if (shouldPreferDetectedApiBase(normalizedSaved, normalizedDetected)) {
    return normalizedDetected;
  }

  return normalizedSaved || normalizedDetected;
};

export const detectApiBaseFromLocation = (): string => {
  try {
    return detectApiBaseFromHref(window.location.href);
  } catch (error) {
    console.warn('Failed to detect api base from location, fallback to default', error);
    return normalizeApiBase(`http://localhost:${DEFAULT_API_PORT}`);
  }
};

export const isLocalhost = (hostname: string): boolean => {
  const value = (hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '[::1]';
};
