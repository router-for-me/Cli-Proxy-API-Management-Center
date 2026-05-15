import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { secureStorage } from '@/services/storage/secureStorage';
import type {
  WebdavConnectionConfig,
  ConnectionStatus,
  BackupScope,
  AutoBackupInterval,
} from '../types';
import { WEBDAV_STORE_KEY, DEFAULT_BASE_PATH, DEFAULT_MAX_BACKUP_COUNT, AUTO_BACKUP_INTERVALS } from '../constants';

interface WebdavStoreState {
  // 持久化字段
  connection: WebdavConnectionConfig;
  backupScope: BackupScope;
  autoBackupEnabled: boolean;
  autoBackupInterval: AutoBackupInterval;
  maxBackupCount: number;
  lastBackupTime: string | null;

  // 运行时字段
  connectionStatus: ConnectionStatus;
  isBackingUp: boolean;
  isRestoring: boolean;
  isLoadingHistory: boolean;

  // 操作
  setConnection: (config: Partial<WebdavConnectionConfig>) => void;
  setBackupScope: (scope: Partial<BackupScope>) => void;
  setAutoBackupEnabled: (enabled: boolean) => void;
  setAutoBackupInterval: (interval: AutoBackupInterval) => void;
  setMaxBackupCount: (count: number) => void;
  setLastBackupTime: (time: string | null) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setIsBackingUp: (val: boolean) => void;
  setIsRestoring: (val: boolean) => void;
  setIsLoadingHistory: (val: boolean) => void;
}

export const useWebdavStore = create<WebdavStoreState>()(
  persist(
    (set) => ({
      connection: {
        serverUrl: '',
        username: '',
        password: '',
        basePath: DEFAULT_BASE_PATH,
      },
      backupScope: {
        localStorage: true,
        config: false,
        usage: true,
      },
      autoBackupEnabled: false,
      autoBackupInterval: '24h',
      maxBackupCount: DEFAULT_MAX_BACKUP_COUNT,
      lastBackupTime: null,

      connectionStatus: 'idle',
      isBackingUp: false,
      isRestoring: false,
      isLoadingHistory: false,

      setConnection: (config) =>
        set((state) => ({
          connection: { ...state.connection, ...config },
        })),
      setBackupScope: (scope) =>
        set((state) => ({
          backupScope: { ...state.backupScope, ...scope },
        })),
      setAutoBackupEnabled: (enabled) => set({ autoBackupEnabled: enabled }),
      setAutoBackupInterval: (interval) => set({ autoBackupInterval: interval }),
      setMaxBackupCount: (count) => set({ maxBackupCount: count }),
      setLastBackupTime: (time) => set({ lastBackupTime: time }),
      setConnectionStatus: (status) => set({ connectionStatus: status }),
      setIsBackingUp: (val) => set({ isBackingUp: val }),
      setIsRestoring: (val) => set({ isRestoring: val }),
      setIsLoadingHistory: (val) => set({ isLoadingHistory: val }),
    }),
    {
      name: WEBDAV_STORE_KEY,
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          const data = secureStorage.getItem<WebdavStoreState>(name);
          return data ? JSON.stringify(data) : null;
        },
        setItem: (name, value) => {
          try {
            secureStorage.setItem(name, JSON.parse(value));
          } catch {
            // 反序列化失败时跳过写入，避免存储损坏扩散
          }
        },
        removeItem: (name) => {
          secureStorage.removeItem(name);
        },
      })),
      version: 1,
      migrate: (persisted: unknown) => {
        const state = persisted as Record<string, unknown>;
        // 旧版间隔值迁移：always→5m, 12h→24h, 7d→3d
        const interval = state?.autoBackupInterval as string | undefined;
        if (interval && !AUTO_BACKUP_INTERVALS.some((i) => i.value === interval)) {
          const migration: Record<string, AutoBackupInterval> = {
            always: '5m',
            '12h': '24h',
            '7d': '3d',
          };
          state.autoBackupInterval = migration[interval] ?? '24h';
        }
        return state;
      },
      partialize: (state) => ({
        connection: state.connection,
        backupScope: state.backupScope,
        autoBackupEnabled: state.autoBackupEnabled,
        autoBackupInterval: state.autoBackupInterval,
        maxBackupCount: state.maxBackupCount,
        lastBackupTime: state.lastBackupTime,
      }),
    }
  )
);
