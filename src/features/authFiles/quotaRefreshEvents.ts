import type { QuotaProviderType } from '@/features/authFiles/constants';

export const AUTH_FILES_QUOTA_REFRESH_EVENT = 'auth-files:quota-refresh';

export interface AuthFilesQuotaRefreshDetail {
  quotaType: QuotaProviderType | null;
  fileNames: string[];
  reason?: 'header-refresh';
}

export const triggerAuthFilesQuotaRefresh = (detail: AuthFilesQuotaRefreshDetail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<AuthFilesQuotaRefreshDetail>(AUTH_FILES_QUOTA_REFRESH_EVENT, { detail })
  );
};

export const subscribeAuthFilesQuotaRefresh = (
  listener: (detail: AuthFilesQuotaRefreshDetail) => void
) => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler: EventListener = (event) => {
    const customEvent = event as CustomEvent<AuthFilesQuotaRefreshDetail>;
    if (!customEvent.detail) return;
    listener(customEvent.detail);
  };

  window.addEventListener(AUTH_FILES_QUOTA_REFRESH_EVENT, handler);
  return () => {
    window.removeEventListener(AUTH_FILES_QUOTA_REFRESH_EVENT, handler);
  };
};
