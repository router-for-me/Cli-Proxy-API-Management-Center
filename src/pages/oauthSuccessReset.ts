import { createNotificationTimer, type TimerClock } from '@/components/common/notificationTimer';
import type { OAuthAttempt } from './oauthAttempts';

export interface PageVisibility {
  isHidden: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

const documentVisibility: PageVisibility = {
  isHidden: () => document.hidden,
  subscribe: (listener) => {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

/**
 * Runs `reset` once the page has been visible for `delay` ms while `attempt` is current.
 *
 * Status polling usually reports success while the user is still on the provider's
 * page in another tab. Counting that time would clear the result before they come
 * back, so hidden time is skipped, as it is for notifications.
 */
export function scheduleSuccessReset(
  attempt: OAuthAttempt,
  reset: () => void,
  delay: number,
  visibility: PageVisibility = documentVisibility,
  timing?: TimerClock
): void {
  if (!attempt.isCurrent()) return;
  let unsubscribe = () => {};
  const timer = createNotificationTimer(
    delay,
    () => {
      unsubscribe();
      if (attempt.isCurrent()) reset();
    },
    timing
  );
  const sync = () => timer.setPaused('hidden', visibility.isHidden());
  sync();
  unsubscribe = visibility.subscribe(sync);
  // A new login, a connection change or unmounting the page invalidates the attempt.
  attempt.signal.addEventListener(
    'abort',
    () => {
      timer.dispose();
      unsubscribe();
    },
    { once: true }
  );
}
