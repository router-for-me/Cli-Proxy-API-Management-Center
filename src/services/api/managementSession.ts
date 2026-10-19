import { computeApiUrl } from '@/utils/connection';

export interface ManagementSession {
  oidcEnabled: boolean;
  authenticated: boolean;
}

function managementSessionEndpoint(apiBase: string, endpoint: 'session' | 'login' | 'logout') {
  if (typeof window === 'undefined') return null;
  const apiUrl = computeApiUrl(apiBase);
  if (!apiUrl) return null;
  try {
    const url = new URL(apiUrl);
    if (url.origin !== window.location.origin) return null;
    return `${apiUrl}/oidc/${endpoint}`;
  } catch {
    return null;
  }
}

export function canUseManagementSession(apiBase: string): boolean {
  return managementSessionEndpoint(apiBase, 'session') !== null;
}

export function getManagementLoginUrl(apiBase: string): string | null {
  return managementSessionEndpoint(apiBase, 'login');
}

export async function discoverManagementSession(
  apiBase: string
): Promise<ManagementSession | null> {
  const endpoint = managementSessionEndpoint(apiBase, 'session');
  if (!endpoint) return null;
  try {
    const response = await fetch(endpoint, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const session: unknown = await response.json();
    if (
      !session ||
      typeof session !== 'object' ||
      !('oidcEnabled' in session) ||
      typeof session.oidcEnabled !== 'boolean' ||
      !('authenticated' in session) ||
      typeof session.authenticated !== 'boolean'
    ) {
      return null;
    }
    return { oidcEnabled: session.oidcEnabled, authenticated: session.authenticated };
  } catch {
    return null;
  }
}

export async function endManagementSession(apiBase: string): Promise<void> {
  const endpoint = managementSessionEndpoint(apiBase, 'logout');
  if (!endpoint) throw new Error('Browser management sessions require a same-origin API');
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'X-Management-CSRF': '1' },
  });
  if (!response.ok) throw new Error('Could not sign out. Please try again.');
}
