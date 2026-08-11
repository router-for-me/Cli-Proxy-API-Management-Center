import { apiClient } from '@/services/api/client';

export { AGENT_IDENTITY_PLUGIN_ID } from './pluginResources';

export const AGENT_IDENTITY_MANAGEMENT_API_PATH = '/codex-agent-identity/open';
export const AGENT_IDENTITY_MANAGEMENT_ROUTE = '/v0/management/codex-agent-identity/open';

const POPUP_BOOTSTRAP_PATH = '/management.html#codex-agent-identity';
const POPUP_READY_TIMEOUT_MS = 10_000;
const MAX_MANAGEMENT_HTML_LENGTH = 512 * 1024;
const MAX_CONTENT_SECURITY_POLICY_LENGTH = 16 * 1024;
const MAX_REFERRER_POLICY_LENGTH = 1024;

const readHeader = (headers: unknown, name: string): string => {
  if (!headers || typeof headers !== 'object') return '';
  const getter = (headers as { get?: (headerName: string) => unknown }).get;
  if (typeof getter === 'function') {
    const value = getter.call(headers, name);
    return value == null ? '' : String(value).trim();
  }
  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()];
  return value == null ? '' : String(value).trim();
};

const escapeHTMLAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const hardenAgentIdentityManagementDocument = (
  html: string,
  contentSecurityPolicy: string,
  referrerPolicy: string
): string => {
  const trimmed = html.trim();
  if (!trimmed || trimmed.length > MAX_MANAGEMENT_HTML_LENGTH) {
    throw new Error('Agent Identity Management API returned an invalid HTML document size');
  }
  if (!/^<!doctype\s+html/i.test(trimmed) || !/<html(?:\s|>)/i.test(trimmed)) {
    throw new Error('Agent Identity Management API returned an invalid HTML document');
  }

  const normalizedCSP = contentSecurityPolicy.trim();
  if (!normalizedCSP || normalizedCSP.length > MAX_CONTENT_SECURITY_POLICY_LENGTH) {
    throw new Error('Agent Identity Management API returned an invalid Content-Security-Policy');
  }
  const normalizedReferrerPolicy = referrerPolicy.trim() || 'no-referrer';
  if (normalizedReferrerPolicy.length > MAX_REFERRER_POLICY_LENGTH) {
    throw new Error('Agent Identity Management API returned an invalid Referrer-Policy');
  }

  const metadata = [
    `<meta http-equiv="Content-Security-Policy" content="${escapeHTMLAttribute(normalizedCSP)}">`,
    `<meta name="referrer" content="${escapeHTMLAttribute(normalizedReferrerPolicy)}">`,
  ].join('');
  const hardened = trimmed.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${metadata}`);
  if (hardened === trimmed) {
    throw new Error('Agent Identity Management API returned HTML without a head element');
  }
  return hardened;
};

export const buildAgentIdentityManagementURL = (apiBase: string): string | null => {
  try {
    const base = new URL(apiBase);
    if (
      (base.protocol !== 'http:' && base.protocol !== 'https:') ||
      base.username ||
      base.password
    ) {
      return null;
    }
    return new URL(AGENT_IDENTITY_MANAGEMENT_ROUTE, base.origin).toString();
  } catch {
    return null;
  }
};

export const isAgentIdentityManagementHTMLContentType = (value: string): boolean =>
  /^text\/html(?:\s*;|$)/i.test(value.trim());

const waitForSameOriginPopup = async (popup: Window, expectedOrigin: string): Promise<void> => {
  const deadline = Date.now() + POPUP_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (popup.closed) {
      throw new Error('Agent Identity management window was closed');
    }
    try {
      if (popup.location.origin === expectedOrigin && popup.document.readyState !== 'loading') {
        return;
      }
    } catch {
      // The bootstrap navigation has not reached the expected same-origin page yet.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
  throw new Error('Agent Identity management window did not become ready');
};

export const openAgentIdentityManagement = async (apiBase: string): Promise<void> => {
  const managementURL = buildAgentIdentityManagementURL(apiBase);
  if (!managementURL) {
    throw new Error('Agent Identity Management API URL is invalid');
  }

  const managementOrigin = new URL(managementURL).origin;
  const bootstrapURL = new URL(POPUP_BOOTSTRAP_PATH, managementOrigin).toString();
  const popup = window.open(bootstrapURL, '_blank');
  if (!popup) {
    throw new Error('The browser blocked the Agent Identity management window');
  }
  popup.opener = null;

  try {
    const [response] = await Promise.all([
      apiClient.getRaw(AGENT_IDENTITY_MANAGEMENT_API_PATH, {
        responseType: 'text',
        headers: { Accept: 'text/html' },
      }),
      waitForSameOriginPopup(popup, managementOrigin),
    ]);
    const contentType = readHeader(response.headers, 'content-type');
    if (!isAgentIdentityManagementHTMLContentType(contentType)) {
      throw new Error('Agent Identity Management API returned a non-HTML response');
    }
    const responseHTML = typeof response.data === 'string' ? response.data : '';
    const html = hardenAgentIdentityManagementDocument(
      responseHTML,
      readHeader(response.headers, 'content-security-policy'),
      readHeader(response.headers, 'referrer-policy')
    );

    popup.stop();
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
  } catch (error) {
    popup.close();
    throw error;
  }
};
