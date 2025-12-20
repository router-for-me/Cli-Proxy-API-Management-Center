/**
 * 通知状态管理
 * 使用 sonner toast 库 + 自定义样式
 */

import { create } from 'zustand';
import { showCustomToast } from '@/components/ui/CustomToast';
import type { NotificationType } from '@/types';

interface NotificationState {
  showNotification: (message: string, type?: NotificationType) => void;
}

export const useNotificationStore = create<NotificationState>(() => ({
  showNotification: (message, type = 'info') => {
    showCustomToast(message, type);
  },
}));
