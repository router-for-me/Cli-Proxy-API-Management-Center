import { useNotificationStore } from '@/stores';

export function NotificationContainer() {
  const { notifications, removeNotification } = useNotificationStore();

  if (!notifications.length) return null;

  return (
    <div className="notification-container">
      {notifications.map((notification) => (
        <div key={notification.id} className={`notification ${notification.type}`}>
          <div className="message">{notification.message}</div>
          <button className="close-btn" onClick={() => removeNotification(notification.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
