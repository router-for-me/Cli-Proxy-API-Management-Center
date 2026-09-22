export const CODEX_RESET_OVERRIDES_KEY = 'codex-reset-overrides';

export type CodexResetOverrides = Record<string, number>;

type ResetOverrideStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const parseResetOverride = (value: unknown): number | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const atMs = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(atMs) ? atMs : null;
};

export function parseCodexResetOverrides(value: string | null): CodexResetOverrides {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([name, resetAt]) => [name, parseResetOverride(resetAt)] as const)
        .filter((entry): entry is [string, number] => entry[1] !== null)
    );
  } catch {
    return {};
  }
}

export function readCodexResetOverrides(storage?: ResetOverrideStorage): CodexResetOverrides {
  const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  if (!target) return {};

  try {
    return parseCodexResetOverrides(target.getItem(CODEX_RESET_OVERRIDES_KEY));
  } catch {
    return {};
  }
}

export function writeCodexResetOverrides(
  overrides: CodexResetOverrides,
  storage?: ResetOverrideStorage
): void {
  const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  if (!target) return;

  try {
    const serialized = Object.fromEntries(
      Object.entries(overrides).map(([name, resetAtMs]) => [
        name,
        new Date(resetAtMs).toISOString(),
      ])
    );
    if (Object.keys(serialized).length === 0) {
      target.removeItem(CODEX_RESET_OVERRIDES_KEY);
      return;
    }
    target.setItem(CODEX_RESET_OVERRIDES_KEY, JSON.stringify(serialized));
  } catch {
    // localStorage may be disabled or full. The in-memory UI state still works.
  }
}

export function formatLocalDateTimeInput(atMs: number): string {
  const date = new Date(atMs);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function parseLocalDateTimeInput(value: string): number | null {
  if (!value) return null;
  const atMs = new Date(value).getTime();
  return Number.isFinite(atMs) ? atMs : null;
}
