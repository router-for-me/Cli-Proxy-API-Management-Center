export const AUTH_FILES_CHANGED_EVENT = 'auth-files-changed';

export const notifyAuthFilesChanged = () => {
  window.dispatchEvent(new Event(AUTH_FILES_CHANGED_EVENT));
};

/** Routing state changed without replacing the credential or invalidating its quota. */
export const AUTH_FILE_COOLDOWN_RESET_EVENT = 'auth-file-cooldown-reset';

export const notifyAuthFileCooldownReset = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_FILE_COOLDOWN_RESET_EVENT));
  }
};
