/**
 * OpenCode Go credential import.
 *
 * OpenCode has no OAuth or device flow: the docs tell you to sign in at
 * opencode.ai/auth and copy an API key, and every client in the ecosystem
 * stores that key verbatim. So this is an import, not a login handshake — the
 * shape it shares with `vertex_import` rather than with the OAuth providers.
 *
 * Pure and DOM-free so the naming and payload rules are directly testable; the
 * page owns the requests.
 */

/** Where the key comes from; surfaced in the card hint. */
export const OPENCODE_CONSOLE_URL = 'https://opencode.ai/auth';

/** Auth files are `<provider>-<slug>.json`; the slug identifies the account. */
export const OPENCODE_AUTH_FILE_PREFIX = 'opencode-';

/**
 * Account slug for a user-supplied label.
 *
 * The result becomes a file name, so it is restricted to `[a-z0-9-]` rather
 * than merely escaped — that rules out separators and traversal by
 * construction instead of by sanitizing after the fact.
 */
export function slugifyOpencodeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildOpencodeAuthFileName(label: string): string | null {
  const slug = slugifyOpencodeLabel(label);
  return slug ? `${OPENCODE_AUTH_FILE_PREFIX}${slug}.json` : null;
}

export interface OpencodeCredentialFile {
  name: string;
  /** Pretty-printed so the file stays readable when edited by hand. */
  content: string;
}

/**
 * The credential written to the auth dir.
 *
 * `access_token` rather than `api_key`: the management `api-call` proxy
 * resolves `$TOKEN$` from `metadata.access_token` first, and that is how the
 * quota card reads the key back. `label` is what the auth-file and quota cards
 * show, since the usage API returns no account identity of its own.
 */
export function buildOpencodeCredentialFile(
  label: string,
  apiKey: string
): OpencodeCredentialFile | null {
  const name = buildOpencodeAuthFileName(label);
  const key = apiKey.trim();
  if (!name || !key) return null;

  return {
    name,
    content: `${JSON.stringify(
      {
        type: 'opencode',
        access_token: key,
        label: label.trim(),
      },
      null,
      2
    )}\n`,
  };
}

/** i18n key explaining why the upstream rejected a key, by status. */
export function opencodeKeyErrorKey(statusCode: number): string {
  if (statusCode === 401) return 'opencode_login.key_rejected';
  // The Go windows are entitlement-gated; a valid Zen key without the
  // subscription reaches this branch rather than 401.
  if (statusCode === 403) return 'opencode_login.no_subscription';
  return 'opencode_login.validate_failed';
}
