/**
 * Local nickname overrides for credentials.
 *
 * The API returns an account email as `label`, which is precise but hard to
 * scan — "alice@example.com" says nothing about what that credential is *for*.
 * A nickname ("Alice · design") does.
 *
 * Deliberately local-only: persisting server-side needs a writable field on the
 * auth file and a management endpoint, which is a separate feature. These live
 * in localStorage, so they don't sync across browsers — an acceptable trade for
 * something purely presentational.
 */

export const QUOTA_NICKNAME_STORAGE_KEY = 'cpamc.nicknames';

export type NicknameMap = Record<string, string>;

/** Read all overrides. Returns an empty map when storage is unavailable. */
export function readNicknames(): NicknameMap {
  try {
    const raw = window.localStorage.getItem(QUOTA_NICKNAME_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: NicknameMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Set or clear one override. An empty/blank name removes it, so clearing the
 * field in the UI restores the account email rather than blanking the card.
 */
export function writeNickname(map: NicknameMap, name: string, nickname: string): NicknameMap {
  const next = { ...map };
  const trimmed = nickname.trim();
  if (trimmed) {
    next[name] = trimmed;
  } else {
    delete next[name];
  }
  try {
    window.localStorage.setItem(QUOTA_NICKNAME_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode, disabled) — the rename just won't persist */
  }
  return next;
}

/**
 * Display name for a credential: nickname, else the API's label/email, else the
 * filename. Same precedence the card title has always used, with the override
 * in front.
 */
export function resolveDisplayName(
  fileName: string,
  label: string | undefined,
  email: string | undefined,
  nicknames: NicknameMap
): string {
  return nicknames[fileName] || label?.trim() || email?.trim() || fileName;
}
