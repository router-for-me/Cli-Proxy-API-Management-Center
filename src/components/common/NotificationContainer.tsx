import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/stores';
import { IconX } from '@/components/ui/icons';

export function NotificationContainer() {
  const { t } = useTranslation();
  const { notifications, removeNotification } = useNotificationStore();

  if (!notifications.length) return null;

  return (
    <div className="notification-container">
      {notifications.map((notification) => (
        <div key={notification.id} className={`notification ${notification.type}`}>
          <div className="message">{notification.message}</div>
          <button
            type="button"
            className="close-btn"
            onClick={() => removeNotification(notification.id)}
            aria-label={t('common.close')}
          >
            <IconX size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
