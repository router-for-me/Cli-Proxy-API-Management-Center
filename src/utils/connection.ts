import { DEFAULT_API_PORT, MANAGEMENT_API_PREFIX } from './constants';

export const normalizeApiBase = (input: string): string => {
  let base = (input || '').trim();
  if (!base) return '';
  base = base.replace(/\/+$/i, '');
  base = base.replace(/\/v8\/management$/i, '');
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  return base;
};

export const computeApiUrl = (base: string): string => {
  const normalized = normalizeApiBase(base);
  if (!normalized) return '';
  return `${normalized}${MANAGEMENT_API_PREFIX}`;
};

const DASHBOARD_DOCUMENT_FILE = /^(?:management|index)\.html?$/i;
const STATIC_ASSET_FILE =
  /\.(?:css|[cm]?js|json|map|svg|png|jpe?g|gif|webp|avif|ico|wasm|txt|xml|woff2?|ttf|eot)$/i;

export const resolvePanelBasePath = (pathname: string): string => {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const hasTrailingSlash = /\/$/.test(normalizedPath);
  const withoutTrailingSlash = normalizedPath.replace(/\/+$/, '');
  if (!withoutTrailingSlash) return '';
  if (hasTrailingSlash) return withoutTrailingSlash;

  const lastSlash = withoutTrailingSlash.lastIndexOf('/');
  const lastSegment = withoutTrailingSlash.slice(lastSlash + 1);
  const parentPath = withoutTrailingSlash.slice(0, lastSlash);
  const isKnownStaticAsset = /(?:^|\/)(?:assets|static)$/.test(parentPath) &&
    STATIC_ASSET_FILE.test(lastSegment);
  // Arbitrary dotted segments are ambiguous and therefore treated as mounts.
  // Strip only dashboard document names or files under explicit asset folders.
  if (DASHBOARD_DOCUMENT_FILE.test(lastSegment) || isKnownStaticAsset) {
    return withoutTrailingSlash.slice(0, lastSlash).replace(/\/+$/, '');
  }

  return withoutTrailingSlash;
};

export const detectApiBaseFromLocation = (): string => {
  if (typeof window === 'undefined') {
    return normalizeApiBase(`http://localhost:${DEFAULT_API_PORT}`);
  }
  try {
    const { protocol, hostname, port, pathname } = window.location;
    const normalizedPort = port ? `:${port}` : '';
    const basePath = resolvePanelBasePath(pathname || '/');
    return normalizeApiBase(`${protocol}//${hostname}${normalizedPort}${basePath}`);
  } catch (error) {
    console.warn('Failed to detect api base from location, fallback to default', error);
    return normalizeApiBase(`http://localhost:${DEFAULT_API_PORT}`);
  }
};
