/**
 * 通知状态管理
 * 当前全局关闭操作反馈弹窗与提示通知，仅保留兼容调用接口。
 */

import { create } from 'zustand';
import type { ReactNode } from 'react';
import type { Notification, NotificationType } from '@/types';
import { NOTIFICATION_DURATION_MS } from '@/utils/constants';

interface ConfirmationOptions {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary' | 'secondary';
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

interface NotificationState {
  notifications: Notification[];
  confirmation: {
    isOpen: boolean;
    isLoading: boolean;
    options: ConfirmationOptions | null;
  };
  showNotification: (message: string, type?: NotificationType, duration?: number) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  showConfirmation: (options: ConfirmationOptions) => void;
  hideConfirmation: () => void;
  setConfirmationLoading: (loading: boolean) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  confirmation: {
    isOpen: false,
    isLoading: false,
    options: null
  },

  showNotification: (message, type = 'info', duration = NOTIFICATION_DURATION_MS) => {
    void message;
    void type;
    void duration;
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id)
    }));
  },

  clearAll: () => {
    set({ notifications: [] });
  },

  showConfirmation: (options) => {
    set({
      confirmation: {
        isOpen: false,
        isLoading: false,
        options: null
      }
    });

    void Promise.resolve()
      .then(() => options.onConfirm())
      .catch((error: unknown) => {
        console.error('Confirmation action failed:', error);
      });
  },

  hideConfirmation: () => {
    set((state) => ({
      confirmation: {
        ...state.confirmation,
        isOpen: false,
        options: null // Cleanup
      }
    }));
  },

  setConfirmationLoading: (loading) => {
    set((state) => ({
      confirmation: {
        ...state.confirmation,
        isLoading: loading
      }
    }));
  }
}));
