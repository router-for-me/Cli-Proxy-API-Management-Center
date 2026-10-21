import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { guardConfigConnection } from '@/services/api/configValue';
import { useNotificationStore } from '@/stores';
import { greetingTargets, sendGreeting } from '../usageWindowTrigger';

interface GreetingProgress {
  done: number;
  total: number;
  success: number;
  failed: number;
}

export function useUsageWindowTrigger(
  files: AuthFileItem[],
  disabled: boolean,
  sessionGeneration: number
) {
  const { t } = useTranslation();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const targets = useMemo(() => greetingTargets(files), [files]);
  const [progress, setProgress] = useState<GreetingProgress | null>(null);
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      controllerRef.current?.abort();
      setProgress(null);
    }
  }, [disabled]);

  useEffect(() => {
    controllerRef.current?.abort();
    setProgress(null);
  }, [sessionGeneration]);

  const trigger = useCallback(() => {
    if (disabled || runningRef.current) return;
    if (targets.length === 0) {
      showNotification(t('quota_management.greeting_none'), 'info');
      return;
    }

    const assertConnection = guardConfigConnection();
    showConfirmation({
      title: t('quota_management.greeting_confirm_title'),
      message: t('quota_management.greeting_confirm_message', { count: targets.length }),
      confirmText: t('quota_management.greeting_confirm_button'),
      variant: 'primary',
      onConfirm: () => {
        if (runningRef.current) return;
        try {
          assertConnection();
        } catch {
          return;
        }

        const controller = new AbortController();
        controllerRef.current = controller;
        runningRef.current = true;
        setRunning(true);
        setProgress({ done: 0, total: targets.length, success: 0, failed: 0 });

        void (async () => {
          let success = 0;
          let failed = 0;
          const failedNames: string[] = [];
          try {
            for (const [index, target] of targets.entries()) {
              if (controller.signal.aborted) return;
              assertConnection();
              try {
                const result = await sendGreeting(
                  target,
                  controller.signal,
                  undefined,
                  assertConnection
                );
                assertConnection();
                if (result.success) success += 1;
                else {
                  failed += 1;
                  failedNames.push(result.name);
                }
              } catch {
                if (controller.signal.aborted) return;
                assertConnection();
                failed += 1;
                failedNames.push(target.file.name);
              }
              if (mountedRef.current) {
                setProgress({ done: index + 1, total: targets.length, success, failed });
              }
            }
            if (mountedRef.current) {
              const summary = t('quota_management.greeting_result', { success, failed });
              const failures = failedNames.length
                ? ` ${t('quota_management.greeting_failed', {
                    names: failedNames.slice(0, 3).join(', '),
                  })}`
                : '';
              showNotification(summary + failures, failed ? 'warning' : 'success');
            }
          } catch {
            // A changed management connection invalidates the whole run.
          } finally {
            runningRef.current = false;
            if (controllerRef.current === controller) controllerRef.current = null;
            if (mountedRef.current) setRunning(false);
          }
        })();
      },
    });
  }, [disabled, showConfirmation, showNotification, t, targets]);

  return { trigger, targetCount: targets.length, progress, running };
}
