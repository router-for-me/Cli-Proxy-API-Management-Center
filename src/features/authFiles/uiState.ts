export const AUTH_FILES_SORT_MODES = ['default', 'az', 'priority'] as const;

export type AuthFilesSortMode = (typeof AUTH_FILES_SORT_MODES)[number];

export type AuthFilesUiState = {
  filter?: string;
  problemOnly?: boolean;
  compactMode?: boolean;
  search?: string;
  regexSearchMode?: boolean;
  page?: number;
  pageSize?: number;
  regularPageSize?: number;
  compactPageSize?: number;
  sortMode?: AuthFilesSortMode;
};

const AUTH_FILES_UI_STATE_KEY = 'authFilesPage.uiState';
const AUTH_FILES_COMPACT_MODE_KEY = 'authFilesPage.compactMode';
const AUTH_FILES_SORT_MODE_SET = new Set<AuthFilesSortMode>(AUTH_FILES_SORT_MODES);

export const isAuthFilesSortMode = (value: unknown): value is AuthFilesSortMode =>
  typeof value === 'string' && AUTH_FILES_SORT_MODE_SET.has(value as AuthFilesSortMode);

export const readAuthFilesUiState = (): AuthFilesUiState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(AUTH_FILES_UI_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthFilesUiState;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const writeAuthFilesUiState = (state: AuthFilesUiState) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(AUTH_FILES_UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
};

export const readPersistedAuthFilesCompactMode = (): boolean | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_FILES_COMPACT_MODE_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) === true;
  } catch {
    return null;
  }
};

export const writePersistedAuthFilesCompactMode = (compactMode: boolean) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTH_FILES_COMPACT_MODE_KEY, JSON.stringify(compactMode));
  } catch {
    // ignore
  }
};
