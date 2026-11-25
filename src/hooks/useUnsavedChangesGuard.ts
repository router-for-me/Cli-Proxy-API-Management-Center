import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { BlockerFunction, Location } from 'react-router';
import { NavigationType, useBlocker, useLocation } from 'react-router';
import { useNotificationStore } from '@/stores/useNotificationStore';

type ConfirmationVariant = 'danger' | 'primary' | 'secondary';

export type UnsavedChangesDialog = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant?: ConfirmationVariant;
};

export type UseUnsavedChangesGuardOptions = {
  enabled?: boolean;
  shouldBlock: boolean | BlockerFunction;
  dialog: UnsavedChangesDialog;
};

export function guardDocumentExit(
  target: EventTarget,
  enabled: boolean,
  shouldBlock: UseUnsavedChangesGuardOptions['shouldBlock'],
  currentLocation: Location
) {
  if (!enabled) return;
  // A document exit leaves every app route, even when reloading the same URL.
  // An empty pathname represents no in-app destination for route-aware predicates.
  const dirty =
    typeof shouldBlock === 'function'
      ? shouldBlock({
          currentLocation,
          nextLocation: { pathname: '', search: '', hash: '', state: null, key: '' },
          historyAction: NavigationType.Pop,
        })
      : shouldBlock;
  if (!dirty) return;

  const confirmExit = (event: Event) => {
    event.preventDefault();
    // Legacy browsers also require a non-empty returnValue on BeforeUnloadEvent.
    (event as BeforeUnloadEvent).returnValue = '1';
  };
  target.addEventListener('beforeunload', confirmExit);
  return () => target.removeEventListener('beforeunload', confirmExit);
}

export function useUnsavedChangesGuard(options: UseUnsavedChangesGuardOptions) {
  const { enabled = true, shouldBlock, dialog } = options;
  const { showConfirmation } = useNotificationStore();
  const lastBlockedRef = useRef<string>('');
  const allowNextNavigationUntilRef = useRef(0);
  const allowNextNavigationKeyRef = useRef('');
  const location = useLocation();

  useEffect(
    () => guardDocumentExit(window, enabled, shouldBlock, location),
    [enabled, shouldBlock, location]
  );

  const allowNextNavigation = useCallback(() => {
    // Allow one programmatic navigation after successful save.
    // A short window is used to avoid stale flags lingering when no navigation happens.
    allowNextNavigationUntilRef.current = Date.now() + 2_000;
    allowNextNavigationKeyRef.current = '';
  }, []);

  const allowNavigationTo = useCallback((nextLocationKey: string) => {
    allowNextNavigationUntilRef.current = Date.now() + 2_000;
    allowNextNavigationKeyRef.current = nextLocationKey;
  }, []);

  const shouldBlockFunction = useCallback<BlockerFunction>(
    (args) => {
      if (!enabled) return false;
      const now = Date.now();

      if (allowNextNavigationUntilRef.current > now) {
        const nextKey = `${args.nextLocation.pathname}${args.nextLocation.search}${args.nextLocation.hash}`;
        if (!allowNextNavigationKeyRef.current) {
          allowNextNavigationKeyRef.current = nextKey;
        }
        if (allowNextNavigationKeyRef.current === nextKey) {
          return false;
        }
      } else if (allowNextNavigationUntilRef.current !== 0) {
        allowNextNavigationUntilRef.current = 0;
        allowNextNavigationKeyRef.current = '';
      }

      return typeof shouldBlock === 'function' ? shouldBlock(args) : shouldBlock;
    },
    [enabled, shouldBlock]
  );

  const blocker = useBlocker(shouldBlockFunction);

  useEffect(() => {
    if (allowNextNavigationUntilRef.current === 0) return;
    allowNextNavigationUntilRef.current = 0;
    allowNextNavigationKeyRef.current = '';
  }, [location.key]);

  const blockedKey = useMemo(() => {
    if (blocker.state !== 'blocked' || !blocker.location) return '';
    return `${blocker.location.pathname}${blocker.location.search}${blocker.location.hash}`;
  }, [blocker.location, blocker.state]);

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      lastBlockedRef.current = '';
      return;
    }

    if (!blockedKey || lastBlockedRef.current === blockedKey) {
      return;
    }
    lastBlockedRef.current = blockedKey;

    showConfirmation({
      title: dialog.title,
      message: dialog.message,
      confirmText: dialog.confirmText,
      cancelText: dialog.cancelText,
      variant: dialog.variant ?? 'danger',
      onConfirm: () => blocker.proceed(),
      onCancel: () => blocker.reset(),
    });
  }, [blockedKey, blocker, dialog, showConfirmation]);

  return { allowNextNavigation, allowNavigationTo };
}
