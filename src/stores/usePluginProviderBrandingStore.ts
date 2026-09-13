/**
 * Display branding (label + logo) declared by plugin OAuth providers.
 *
 * Built-in providers keep their bundled labels and icons; this map only fills
 * the gap for provider keys owned by plugins.
 */

import { create } from 'zustand';

export interface PluginProviderBranding {
  label: string;
  logo: string;
}

export type PluginProviderBrandingMap = Record<string, PluginProviderBranding>;

interface PluginProviderBrandingState {
  branding: PluginProviderBrandingMap;
  setBranding: (branding: PluginProviderBrandingMap) => void;
}

export const usePluginProviderBrandingStore = create<PluginProviderBrandingState>((set) => ({
  branding: {},
  setBranding: (branding) => set({ branding }),
}));
