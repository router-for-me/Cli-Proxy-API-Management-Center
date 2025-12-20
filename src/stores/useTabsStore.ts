import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Tab {
  path: string;
  label: string;
}

interface TabsState {
  tabs: Tab[];
  activeTab: string | null;
  openTab: (tab: Tab) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  closeOtherTabs: (path: string) => void;
  closeAllTabs: () => void;
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTab: null,

      openTab: (tab: Tab) => {
        const { tabs } = get();
        const exists = tabs.find(t => t.path === tab.path);
        if (!exists) {
          set({ tabs: [...tabs, tab], activeTab: tab.path });
        } else {
          set({ activeTab: tab.path });
        }
      },

      closeTab: (path: string) => {
        const { tabs, activeTab } = get();
        const newTabs = tabs.filter(t => t.path !== path);
        let newActiveTab = activeTab;
        
        if (activeTab === path) {
          const closedIndex = tabs.findIndex(t => t.path === path);
          if (newTabs.length > 0) {
            newActiveTab = newTabs[Math.min(closedIndex, newTabs.length - 1)]?.path || null;
          } else {
            newActiveTab = null;
          }
        }
        
        set({ tabs: newTabs, activeTab: newActiveTab });
      },

      setActiveTab: (path: string) => {
        set({ activeTab: path });
      },

      closeOtherTabs: (path: string) => {
        const { tabs } = get();
        const tab = tabs.find(t => t.path === path);
        if (tab) {
          set({ tabs: [tab], activeTab: path });
        }
      },

      closeAllTabs: () => {
        set({ tabs: [], activeTab: null });
      },
    }),
    {
      name: 'cli-proxy-tabs',
    }
  )
);
