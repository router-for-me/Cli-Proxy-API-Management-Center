/**
 * 通知状态管理
 * 替代原项目中的 showNotification 方法
 */

import { create } from 'zustand';
import type { Notification, NotificationType } from '@/types';
import { generateId } from '@/utils/helpers';
import { NOTIFICATION_DURATION_MS } from '@/utils/constants';

interface NotificationState {
  notifications: Notification[];
  showNotification: (message: string, type?: NotificationType, duration?: number) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],

  showNotification: (message, type = 'info', duration = NOTIFICATION_DURATION_MS) => {
    const id = generateId();
    const notification: Notification = {
      id,
      message,
      type,
      duration
    };

    set((state) => ({
      notifications: [...state.notifications, notification]
    }));

    // 自动移除通知
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id)
        }));
      }, duration);
    }
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id)
    }));
  },

  clearAll: () => {
    set({ notifications: [] });
  }
}));
